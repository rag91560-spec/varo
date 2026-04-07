"""Live translation endpoints: OCR, translate, vision, WebSocket."""

import asyncio
import base64
import hashlib
import json
import logging
import time
from typing import Optional

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from ..ocr_engine import run_ocr, decode_image, OCRResult
from ..translation_prompts import build_system_prompt, build_translate_prompt, build_batch_prompt, build_vision_prompt

try:
    from ..license import require_license, verify_license
except ImportError:
    from ..license_stub import require_license, verify_license

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/live", tags=["live"])

# --- Translation cache (in-memory, keyed by text hash) ---
_translation_cache: dict[str, dict] = {}
_CACHE_MAX = 2000


def _cache_key(text: str, source_lang: str, target_lang: str) -> str:
    return hashlib.md5(f"{text}:{source_lang}:{target_lang}".encode()).hexdigest()


def _cache_get(text: str, source_lang: str, target_lang: str) -> Optional[str]:
    entry = _translation_cache.get(_cache_key(text, source_lang, target_lang))
    if entry:
        entry["hits"] += 1
        return entry["translated"]
    return None


def _cache_put(text: str, source_lang: str, target_lang: str, translated: str):
    if len(_translation_cache) >= _CACHE_MAX:
        # Evict least-hit entries
        sorted_keys = sorted(_translation_cache, key=lambda k: _translation_cache[k]["hits"])
        for k in sorted_keys[:_CACHE_MAX // 4]:
            del _translation_cache[k]
    _translation_cache[_cache_key(text, source_lang, target_lang)] = {
        "translated": translated,
        "hits": 0,
        "time": time.time(),
    }


# --- Request models ---

class OCRRequest(BaseModel):
    image: str  # base64 encoded image
    language: str = "ja"
    engine: str = "auto"  # "auto" | "winocr" | "tesseract"


class TranslateTextRequest(BaseModel):
    text: str
    source_lang: str = "ja"
    target_lang: str = "ko"
    provider: str = "claude"
    model: str = ""


class TranslateBlocksRequest(BaseModel):
    """Translate multiple OCR blocks individually, preserving positions."""
    blocks: list[dict]  # [{text, x, y, width, height}, ...]
    source_lang: str = "ja"  # "auto" = use detected_lang from OCR
    target_lang: str = "ko"
    provider: str = "claude"
    model: str = ""
    detected_lang: str = ""  # OCR auto-detected language (used when source_lang=auto)


class VisionRequest(BaseModel):
    image: str  # base64 encoded image
    source_lang: str = "ja"
    target_lang: str = "ko"
    provider: str = "claude"
    model: str = ""


# --- Helper: translate text using existing provider infrastructure ---

async def _translate_text(text: str, source_lang: str, target_lang: str, provider: str, model: str) -> str:
    """Translate text using the app's existing AI provider setup."""
    if not text.strip():
        return ""

    # Check cache first (before any provider-specific logic)
    cached = _cache_get(text, source_lang, target_lang)
    if cached is not None:
        return cached

    # Test mode: return dummy translation without API call
    if provider == "test":
        dummy = f"[번역] {text}"
        _cache_put(text, source_lang, target_lang, dummy)
        return dummy

    # Offline mode: direct NLLB translation (no prompt formatting)
    if provider == "offline":
        from ..offline_translate import translate as offline_translate
        translated = await asyncio.to_thread(offline_translate, text, source_lang, target_lang)
        _cache_put(text, source_lang, target_lang, translated)
        return translated

    from .. import db

    settings = await db.get_settings()
    api_keys = settings.get("api_keys", {})
    if isinstance(api_keys, str):
        try:
            api_keys = json.loads(api_keys)
        except Exception:
            api_keys = {}

    system_prompt = build_system_prompt(source_lang)
    prompt = build_translate_prompt(text, source_lang, target_lang)

    translated = await asyncio.to_thread(_call_provider, provider, model, api_keys, prompt, system_prompt)

    _cache_put(text, source_lang, target_lang, translated)
    return translated


def _call_provider(provider: str, model: str, api_keys: dict, prompt: str, system_prompt: str = "") -> str:
    """Synchronous provider call (runs in thread)."""
    import httpx

    def _safe_request(url: str, headers: dict, payload: dict, extract_fn) -> str:
        """Make API request with robust error handling."""
        try:
            resp = httpx.post(url, headers=headers, json=payload, timeout=60)
        except httpx.TimeoutException:
            raise ValueError("API request timed out")
        except httpx.ConnectError:
            raise ValueError("Cannot connect to API server")
        if resp.status_code != 200:
            try:
                err_data = resp.json()
                err_msg = err_data.get("error", {})
                if isinstance(err_msg, dict):
                    err_msg = err_msg.get("message", resp.text[:200])
            except Exception:
                err_msg = resp.text[:200]
            raise ValueError(f"API error ({resp.status_code}): {err_msg}")
        try:
            data = resp.json()
            return extract_fn(data)
        except (KeyError, IndexError, TypeError) as e:
            raise ValueError(f"Unexpected API response format: {e}")

    messages_with_system = []
    if system_prompt:
        messages_with_system.append({"role": "system", "content": system_prompt})
    messages_with_system.append({"role": "user", "content": prompt})

    if provider in ("claude", "anthropic"):
        api_key = api_keys.get("claude") or api_keys.get("anthropic", "")
        if not api_key:
            raise ValueError("Claude API key not configured")
        payload = {
            "model": model or "claude-sonnet-4-20250514",
            "max_tokens": 4096,
            "messages": [{"role": "user", "content": prompt}],
        }
        if system_prompt:
            payload["system"] = system_prompt
        return _safe_request(
            "https://api.anthropic.com/v1/messages",
            {"x-api-key": api_key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
            payload,
            lambda d: d["content"][0]["text"].strip(),
        )

    elif provider in ("openai", "gpt"):
        api_key = api_keys.get("openai", "")
        if not api_key:
            raise ValueError("OpenAI API key not configured")
        return _safe_request(
            "https://api.openai.com/v1/chat/completions",
            {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            {"model": model or "gpt-4o-mini", "messages": messages_with_system, "max_tokens": 4096},
            lambda d: d["choices"][0]["message"]["content"].strip(),
        )

    elif provider in ("gemini", "google"):
        api_key = api_keys.get("gemini") or api_keys.get("google", "")
        if not api_key:
            raise ValueError("Gemini API key not configured")
        model_id = model or "gemini-2.0-flash"
        contents = []
        if system_prompt:
            contents.append({"role": "user", "parts": [{"text": system_prompt}]})
            contents.append({"role": "model", "parts": [{"text": "네, 알겠습니다. 해당 규칙을 따르겠습니다."}]})
        contents.append({"role": "user", "parts": [{"text": prompt}]})
        return _safe_request(
            f"https://generativelanguage.googleapis.com/v1beta/models/{model_id}:generateContent",
            {"Content-Type": "application/json", "x-goog-api-key": api_key},
            {"contents": contents},
            lambda d: d["candidates"][0]["content"]["parts"][0]["text"].strip(),
        )

    else:
        raise ValueError(f"Unsupported provider: {provider}")


async def _vision_translate(image_bytes: bytes, source_lang: str, target_lang: str, provider: str, model: str) -> dict:
    """Use Vision API to extract and translate text from image."""
    from .. import db

    settings = await db.get_settings()
    api_keys = settings.get("api_keys", {})
    if isinstance(api_keys, str):
        try:
            api_keys = json.loads(api_keys)
        except Exception:
            api_keys = {}

    b64 = base64.b64encode(image_bytes).decode()

    prompt = build_vision_prompt(source_lang, target_lang)
    system_prompt = build_system_prompt(source_lang)

    result = await asyncio.to_thread(
        _call_vision_provider, provider, model, api_keys, prompt, b64, system_prompt
    )
    return result


def _call_vision_provider(provider: str, model: str, api_keys: dict, prompt: str, image_b64: str, system_prompt: str = "") -> dict:
    """Synchronous vision provider call."""
    import httpx

    def _safe_vision_request(url: str, headers: dict, payload: dict, extract_fn) -> str:
        try:
            resp = httpx.post(url, headers=headers, json=payload, timeout=90)
        except httpx.TimeoutException:
            raise ValueError("Vision API request timed out")
        except httpx.ConnectError:
            raise ValueError("Cannot connect to API server")
        if resp.status_code != 200:
            try:
                err_data = resp.json()
                err_msg = err_data.get("error", {})
                if isinstance(err_msg, dict):
                    err_msg = err_msg.get("message", resp.text[:200])
            except Exception:
                err_msg = resp.text[:200]
            raise ValueError(f"Vision API error ({resp.status_code}): {err_msg}")
        try:
            data = resp.json()
            return extract_fn(data)
        except (KeyError, IndexError, TypeError) as e:
            raise ValueError(f"Unexpected vision API response format: {e}")

    if provider in ("claude", "anthropic"):
        api_key = api_keys.get("claude") or api_keys.get("anthropic", "")
        if not api_key:
            raise ValueError("Claude API key not configured")
        payload = {
            "model": model or "claude-sonnet-4-20250514",
            "max_tokens": 4096,
            "messages": [{"role": "user", "content": [
                {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": image_b64}},
                {"type": "text", "text": prompt},
            ]}],
        }
        if system_prompt:
            payload["system"] = system_prompt
        text = _safe_vision_request(
            "https://api.anthropic.com/v1/messages",
            {"x-api-key": api_key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
            payload,
            lambda d: d["content"][0]["text"].strip(),
        )

    elif provider in ("openai", "gpt"):
        api_key = api_keys.get("openai", "")
        if not api_key:
            raise ValueError("OpenAI API key not configured")
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": [
            {"type": "text", "text": prompt},
            {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{image_b64}"}},
        ]})
        text = _safe_vision_request(
            "https://api.openai.com/v1/chat/completions",
            {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            {"model": model or "gpt-4o", "messages": messages, "max_tokens": 4096},
            lambda d: d["choices"][0]["message"]["content"].strip(),
        )

    elif provider in ("gemini", "google"):
        api_key = api_keys.get("gemini") or api_keys.get("google", "")
        if not api_key:
            raise ValueError("Gemini API key not configured")
        model_id = model or "gemini-2.0-flash"
        contents = []
        if system_prompt:
            contents.append({"role": "user", "parts": [{"text": system_prompt}]})
            contents.append({"role": "model", "parts": [{"text": "네, 알겠습니다."}]})
        contents.append({"role": "user", "parts": [
            {"inline_data": {"mime_type": "image/png", "data": image_b64}},
            {"text": prompt},
        ]})
        text = _safe_vision_request(
            f"https://generativelanguage.googleapis.com/v1beta/models/{model_id}:generateContent",
            {"Content-Type": "application/json", "x-goog-api-key": api_key},
            {"contents": contents},
            lambda d: d["candidates"][0]["content"]["parts"][0]["text"].strip(),
        )

    else:
        raise ValueError(f"Unsupported provider: {provider}")

    # Parse JSON from response
    # Strip markdown code fences if present
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else text[3:]
        if text.endswith("```"):
            text = text[:-3]
        text = text.strip()

    try:
        entries = json.loads(text)
    except json.JSONDecodeError:
        entries = [{"original": text, "translated": text, "x": 0, "y": 0, "width": 100, "height": 100}]

    return {"entries": entries}


# --- Endpoints ---

@router.post("/ocr")
async def ocr_endpoint(body: OCRRequest):
    """Run OCR on a base64-encoded image."""
    try:
        image_bytes = decode_image(body.image)
    except Exception:
        return {"error": "Invalid base64 image data"}

    try:
        result = await run_ocr(image_bytes, body.language, body.engine)
    except Exception as e:
        logger.error(f"OCR error: {e}")
        return {"error": str(e)}

    return {
        "blocks": [
            {
                "text": b.text,
                "x": b.x,
                "y": b.y,
                "width": b.width,
                "height": b.height,
                "confidence": b.confidence,
            }
            for b in result.blocks
        ],
        "full_text": result.full_text,
        "language": result.language,
        "engine": result.engine,
    }


@router.post("/translate")
async def translate_endpoint(body: TranslateTextRequest):
    """Translate text using AI provider."""
    await require_license()
    try:
        translated = await _translate_text(
            body.text, body.source_lang, body.target_lang,
            body.provider, body.model,
        )
        return {"translated": translated, "source_lang": body.source_lang, "target_lang": body.target_lang}
    except Exception as e:
        logger.error(f"Translation error: {e}")
        return {"error": str(e)}


@router.post("/translate-blocks")
async def translate_blocks_endpoint(body: TranslateBlocksRequest):
    """Translate all OCR blocks in a single batched API call for speed."""
    await require_license()
    try:
        # Resolve source language: if "auto", use detected_lang from OCR
        source_lang = body.source_lang
        if source_lang == "auto":
            source_lang = body.detected_lang or "ja"

        texts = []
        block_data = []
        for block in body.blocks:
            text = block.get("text", "").strip()
            if not text:
                continue
            texts.append(text)
            block_data.append(block)

        if not texts:
            return {"blocks": []}

        # Check cache first
        cached = {}
        uncached_indices = []
        for i, text in enumerate(texts):
            hit = _cache_get(text, source_lang, body.target_lang)
            if hit:
                cached[i] = hit
            else:
                uncached_indices.append(i)

        # Batch translate uncached texts
        translations = {}
        if uncached_indices:
            uncached_texts = [texts[i] for i in uncached_indices]

            # Offline: use NLLB batch translation (fast, no API call)
            if (body.provider or "openai") == "offline":
                from ..offline_translate import translate_batch as offline_batch
                batch_results = await asyncio.to_thread(
                    offline_batch, uncached_texts, source_lang, body.target_lang
                )
                for idx_in_batch, orig_idx in enumerate(uncached_indices):
                    translations[orig_idx] = batch_results[idx_in_batch]
                    _cache_put(texts[orig_idx], source_lang, body.target_lang, batch_results[idx_in_batch])
            else:
                # AI provider: single batched API call
                from .. import db
                numbered = "\n".join(f"[{j+1}] {t}" for j, t in enumerate(uncached_texts))

                settings = await db.get_settings()
                api_keys = settings.get("api_keys", {})
                if isinstance(api_keys, str):
                    try:
                        api_keys = json.loads(api_keys)
                    except Exception:
                        api_keys = {}

                system_prompt = build_system_prompt(source_lang)
                batch_prompt = build_batch_prompt(uncached_texts, source_lang, body.target_lang)

                ai_provider = body.provider or settings.get("default_provider", "openai")
                model = body.model or ""
                batch_result = await asyncio.to_thread(
                    _call_provider, ai_provider, model, api_keys, batch_prompt, system_prompt
                )

                # Parse [N] results
                result_lines = {}
                for line in batch_result.strip().split("\n"):
                    line = line.strip()
                    if line.startswith("[") and "]" in line:
                        try:
                            num = int(line[1:line.index("]")]) - 1
                            result_lines[num] = line[line.index("]")+1:].strip()
                        except ValueError:
                            continue

                for idx_in_batch, orig_idx in enumerate(uncached_indices):
                    translated = result_lines.get(idx_in_batch, texts[orig_idx])
                    translations[orig_idx] = translated
                    _cache_put(texts[orig_idx], source_lang, body.target_lang, translated)

        # Merge cached + fresh
        translated_blocks = []
        for i, block in enumerate(block_data):
            translated = cached.get(i) or translations.get(i, texts[i])
            translated_blocks.append({
                "original": texts[i],
                "translated": translated,
                "x": block.get("x", 0),
                "y": block.get("y", 0),
                "width": block.get("width", 0),
                "height": block.get("height", 0),
            })
        return {"blocks": translated_blocks, "source_lang": source_lang}
    except Exception as e:
        logger.error(f"Block translation error: {e}")
        return {"error": str(e)}


@router.post("/vision")
async def vision_endpoint(body: VisionRequest):
    """Extract and translate text from image using Vision API."""
    await require_license()
    try:
        image_bytes = decode_image(body.image)
    except Exception:
        return {"error": "Invalid base64 image data"}

    try:
        result = await _vision_translate(
            image_bytes, body.source_lang, body.target_lang,
            body.provider, body.model,
        )
        return result
    except Exception as e:
        logger.error(f"Vision translation error: {e}")
        return {"error": str(e)}


@router.get("/cache/stats")
async def cache_stats():
    """Return translation cache statistics."""
    return {
        "size": len(_translation_cache),
        "max_size": _CACHE_MAX,
    }


@router.post("/cache/clear")
async def cache_clear():
    """Clear the translation cache."""
    _translation_cache.clear()
    return {"ok": True}


# --- WebSocket for auto mode ---

@router.websocket("/ws")
async def live_ws(ws: WebSocket):
    """WebSocket for continuous live translation.

    Client sends JSON messages:
      {"type": "ocr", "image": "<base64>", "language": "ja", "engine": "auto"}
      {"type": "translate", "text": "...", "source_lang": "ja", "target_lang": "ko", "provider": "claude"}
      {"type": "ocr_translate", "image": "<base64>", "language": "ja", "source_lang": "ja", "target_lang": "ko", "provider": "claude"}

    Server responds with JSON:
      {"type": "ocr_result", "blocks": [...], "full_text": "..."}
      {"type": "translate_result", "translated": "..."}
      {"type": "ocr_translate_result", "blocks": [...], "full_text": "...", "translated": "..."}
      {"type": "error", "message": "..."}
    """
    await ws.accept()

    # License check for WebSocket
    try:
        lic = await verify_license()
        if not lic.get("valid"):
            await ws.send_json({"type": "error", "message": "License required. Please connect Fanbox."})
            await ws.close(code=4003, reason="License required")
            return
    except Exception:
        await ws.send_json({"type": "error", "message": "License verification failed"})
        await ws.close(code=4003, reason="License check failed")
        return

    try:
        while True:
            raw = await ws.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                await ws.send_json({"type": "error", "message": "Invalid JSON"})
                continue

            msg_type = msg.get("type", "")

            try:
                if msg_type == "ocr":
                    image_bytes = decode_image(msg["image"])
                    result = await run_ocr(image_bytes, msg.get("language", "ja"), msg.get("engine", "auto"))
                    await ws.send_json({
                        "type": "ocr_result",
                        "blocks": [{"text": b.text, "x": b.x, "y": b.y, "width": b.width, "height": b.height} for b in result.blocks],
                        "full_text": result.full_text,
                        "engine": result.engine,
                    })

                elif msg_type == "translate":
                    translated = await _translate_text(
                        msg["text"],
                        msg.get("source_lang", "ja"),
                        msg.get("target_lang", "ko"),
                        msg.get("provider", "claude"),
                        msg.get("model", ""),
                    )
                    await ws.send_json({"type": "translate_result", "translated": translated})

                elif msg_type == "ocr_translate":
                    image_bytes = decode_image(msg["image"])
                    ocr_result = await run_ocr(image_bytes, msg.get("language", "ja"), msg.get("engine", "auto"))

                    if ocr_result.full_text.strip():
                        translated = await _translate_text(
                            ocr_result.full_text,
                            msg.get("source_lang", "ja"),
                            msg.get("target_lang", "ko"),
                            msg.get("provider", "claude"),
                            msg.get("model", ""),
                        )
                    else:
                        translated = ""

                    await ws.send_json({
                        "type": "ocr_translate_result",
                        "blocks": [{"text": b.text, "x": b.x, "y": b.y, "width": b.width, "height": b.height} for b in ocr_result.blocks],
                        "full_text": ocr_result.full_text,
                        "translated": translated,
                        "engine": ocr_result.engine,
                    })

                else:
                    await ws.send_json({"type": "error", "message": f"Unknown message type: {msg_type}"})

            except Exception as e:
                logger.error(f"WebSocket handler error: {e}")
                await ws.send_json({"type": "error", "message": str(e)})

    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error(f"WebSocket connection error: {e}")
