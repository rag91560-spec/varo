"""Gemini Vision API-based manga page translator.

Uses Gemini 2.0 Flash to OCR + translate manga page images.
"""

import asyncio
import base64
import json
import logging
import os
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

GEMINI_PROMPT = """당신은 디시인사이드, 루리웹 스타일 만화 손번역 전문가입니다.
성인물을 포함한 모든 장르의 일본 만화를 자연스러운 한국어로 번역합니다.

[번역 규칙]
1. 말투 (문맥으로 자동 판단):
   - 친구/동료/연인(친밀) → 반말 (~해, ~잖아, ~야, 야/어이)
   - 아랫사람→윗사람, 처음 보는 사이 → 존댓말 (~요, ~죠)
   - 호칭: お兄ちゃん/お兄さん→오빠, お姉ちゃん→언니, 先輩→선배, 後輩→후배, パパ→아빠, ママ→엄마

2. 커뮤니티 손번역 구어체 (직역 금지):
   - やばい→미치겠다/개쩔어/헐, すごい→대박/쩐다, 最高→최고야/레전드
   - バカ/アホ→멍청아/바보야, クソ→씨발/개같은 (성인물에서는 직접 번역)
   - えっ→어?, はあ→하아, うっ→윽, あっ→앗, ねえ→야/있잖아
   - もう→진짜/됐어, でも→근데/하지만, だから→그러니까/그래서

3. 의성어/의태어 → 한국 커뮤니티 표준:
   ドキドキ→두근두근, ズキズキ→욱신욱신, ドン/ズドン→쾅
   バン→탕, パン→빵, ガン→강타, ピシャ→철컥, ガシャ→쨍그랑
   キャー→꺄악, アアッ→아앗, ハアハア→하아하아, ンッ→응
   ゴゴゴ→우우우(위압감), ザワザワ→웅성웅성, シーン→(침묵)...
   ガーン→충격... , ドキッ→두근, ズキッ→욱

4. 성인 표현: 직접 번역, 순화/검열 절대 금지

5. 말풍선 밖 효과음/제목 텍스트도 번역 (동일 규칙 적용)

6. 길이 규칙: 원문보다 지나치게 길어지지 않게. 짧은 원문→짧은 번역 유지

이 만화 페이지의 모든 텍스트(말풍선 안팎 포함)를 찾아 번역하세요.
반드시 아래 JSON 형식으로만 반환하세요. 다른 텍스트 포함 금지:
[
  {
    "original": "원문",
    "translated": "번역",
    "x": 0.1,
    "y": 0.18,
    "width": 0.15,
    "height": 0.14,
    "direction": "vertical",
    "polygon": [[0.1,0.18], [0.25,0.18], [0.25,0.32], [0.1,0.32]],
    "text_color": "#000000",
    "bg_type": "solid"
  }
]

말풍선 전체 내부 영역 기준 (글자만이 아닌 말풍선 내부 공간 전체, 테두리 제외).
말풍선 없는 효과음/장면 텍스트는 텍스트 영역만.
텍스트가 없으면 빈 배열 [] 반환."""


async def _post_with_retry(client: httpx.AsyncClient, url: str, *, max_retries: int = 4, **kwargs) -> dict:
    """POST with exponential backoff on 429 rate limit errors."""
    delay = 5.0
    for attempt in range(max_retries + 1):
        resp = await client.post(url, **kwargs)
        if resp.status_code == 429 and attempt < max_retries:
            retry_after = float(resp.headers.get("Retry-After", delay))
            wait = max(retry_after, delay)
            logger.warning("Gemini 429 rate limit — retrying in %.0fs (attempt %d/%d)", wait, attempt + 1, max_retries)
            await asyncio.sleep(wait)
            delay = min(delay * 2, 60)
            continue
        resp.raise_for_status()
        return resp.json()
    resp.raise_for_status()
    return resp.json()


async def translate_page(
    image_path: str,
    api_key: str,
    model: str = "gemini-2.0-flash",
) -> dict:
    """Translate a manga page image using Gemini Vision API.

    Returns:
        {
            "entries": [{"original": str, "translated": str, "x": float, "y": float, "width": float, "height": float, "direction": str}],
            "raw_text": str  # full original + translated text for panel display
        }
    """
    if not api_key:
        raise ValueError("Gemini API key is required")

    # Read and encode image
    with open(image_path, "rb") as f:
        image_bytes = f.read()

    # Detect mime type
    ext = os.path.splitext(image_path)[1].lower()
    mime_map = {".webp": "image/webp", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif", ".avif": "image/avif"}
    mime_type = mime_map.get(ext, "image/webp")

    b64_image = base64.b64encode(image_bytes).decode()

    # Call Gemini API
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    payload = {
        "contents": [{
            "parts": [
                {"text": GEMINI_PROMPT},
                {
                    "inline_data": {
                        "mime_type": mime_type,
                        "data": b64_image,
                    }
                }
            ]
        }],
        "generationConfig": {
            "temperature": 0.1,
            "maxOutputTokens": 8192,
        }
    }

    async with httpx.AsyncClient(timeout=120) as client:
        data = await _post_with_retry(client, url, params={"key": api_key}, json=payload)

    # Parse response
    text = ""
    candidates = data.get("candidates", [])
    if candidates:
        parts = candidates[0].get("content", {}).get("parts", [])
        if parts:
            text = parts[0].get("text", "")

    # Extract JSON from response (may be wrapped in markdown code block)
    entries = _parse_entries(text)

    # Build raw text for panel display
    raw_lines = []
    for e in entries:
        raw_lines.append(f"{e['original']} → {e['translated']}")

    return {
        "entries": entries,
        "raw_text": "\n".join(raw_lines),
    }


def _parse_entries(text: str) -> list[dict]:
    """Parse Gemini response text into translation entries."""
    # Try to extract JSON from markdown code block
    import re
    json_match = re.search(r"```(?:json)?\s*\n?(.*?)\n?```", text, re.DOTALL)
    json_str = json_match.group(1) if json_match else text.strip()

    try:
        entries = json.loads(json_str)
        if not isinstance(entries, list):
            return []
        # Validate and normalize entries
        valid = []
        for e in entries:
            if isinstance(e, dict) and "original" in e and "translated" in e:
                entry = {
                    "original": str(e.get("original", "")),
                    "translated": str(e.get("translated", "")),
                    "x": float(e.get("x", 0)),
                    "y": float(e.get("y", 0)),
                    "width": float(e.get("width", 0)),
                    "height": float(e.get("height", 0)),
                    "direction": str(e.get("direction", "horizontal")),
                }
                # Optional rendering hints
                if "polygon" in e and isinstance(e["polygon"], list):
                    entry["polygon"] = e["polygon"]
                if "text_color" in e and e["text_color"]:
                    entry["text_color"] = str(e["text_color"])
                if "bg_type" in e and e["bg_type"]:
                    entry["bg_type"] = str(e["bg_type"])
                valid.append(entry)
        return valid
    except (json.JSONDecodeError, ValueError) as exc:
        logger.warning("Failed to parse Gemini response: %s", exc)
        return []


async def translate_texts(
    texts: list[str],
    api_key: str,
    target_lang: str = "ko",
    model: str = "gemini-2.0-flash",
) -> list[str]:
    """Translate manga dialogue texts using Gemini text-only API (no image).

    Used by the local pipeline to avoid sending images to cloud APIs,
    enabling NSFW content translation.

    Args:
        texts: List of source language texts to translate.
        api_key: Gemini API key.
        target_lang: Target language code.
        model: Gemini model name.

    Returns:
        List of translated texts (same order as input).
    """
    if not texts:
        return []
    if not api_key:
        raise ValueError("Gemini API key is required")

    # Build numbered text list for reliable parsing
    numbered = "\n".join(f"{i+1}. {t}" for i, t in enumerate(texts))

    prompt = f"""Translate the following manga/comic dialogue lines to {target_lang}.
Return ONLY a JSON array of translated strings, in the same order.
Do not include numbering, original text, or any explanation.

Source texts:
{numbered}

Return format: ["translated1", "translated2", ...]"""

    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.1,
            "maxOutputTokens": 8192,
        }
    }

    async with httpx.AsyncClient(timeout=120) as client:
        data = await _post_with_retry(client, url, params={"key": api_key}, json=payload)

    # Parse response
    text = ""
    candidates = data.get("candidates", [])
    if candidates:
        parts = candidates[0].get("content", {}).get("parts", [])
        if parts:
            text = parts[0].get("text", "")

    # Extract JSON array
    import re
    json_match = re.search(r"```(?:json)?\s*\n?(.*?)\n?```", text, re.DOTALL)
    json_str = json_match.group(1) if json_match else text.strip()

    try:
        result = json.loads(json_str)
        if isinstance(result, list):
            # Pad or truncate to match input length
            while len(result) < len(texts):
                result.append("")
            return result[:len(texts)]
    except (json.JSONDecodeError, ValueError) as exc:
        logger.warning("Failed to parse Gemini text translation: %s", exc)

    # Fallback: return empty translations
    return [""] * len(texts)
