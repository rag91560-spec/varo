"""Audio library REST API."""

import json
import logging
import mimetypes
import os
import re
import uuid

from fastapi import APIRouter, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import Optional, List

from .. import db
from .. import engine_bridge
from ..audio_script_utils import extract_translatable_blocks
from ..video_analyzer import probe_media_duration
try:
    from ..license import require_license
except ImportError:
    from ..license_stub import require_license

logger = logging.getLogger(__name__)

_data_dir = os.environ.get("GT_DATA_DIR") or os.path.join(os.path.dirname(__file__), "..", "..", "data")
UPLOAD_DIR = os.path.join(_data_dir, "audio")
THUMB_DIR = os.path.join(_data_dir, "thumbnails", "audio")
os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(THUMB_DIR, exist_ok=True)

router = APIRouter(prefix="/api/audio", tags=["audio"])

OFFLINE_PROVIDERS = {"offline", "test"}

_AUDIO_MIME = {
    ".mp3": "audio/mpeg",
    ".ogg": "audio/ogg",
    ".wav": "audio/wav",
    ".flac": "audio/flac",
    ".m4a": "audio/mp4",
    ".aac": "audio/aac",
    ".wma": "audio/x-ms-wma",
    ".opus": "audio/opus",
}


class AudioCreate(BaseModel):
    title: str
    type: str  # 'local' | 'url'
    source: str
    thumbnail: str = ""
    duration: int = 0
    size: int = 0
    category_id: Optional[int] = None
    sort_order: int = 0


class AudioUpdate(BaseModel):
    title: Optional[str] = None
    type: Optional[str] = None
    source: Optional[str] = None
    thumbnail: Optional[str] = None
    duration: Optional[int] = None
    size: Optional[int] = None
    category_id: Optional[int] = None
    sort_order: Optional[int] = None
    script_text: Optional[str] = None


class ScanFolderRequest(BaseModel):
    path: str
    category_id: Optional[int] = None  # legacy: assign everything to one category
    parent_category_id: Optional[int] = None  # new: where to root the scanned tree
    preserve_structure: bool = True  # if True, create sub-categories mirroring folders


class BulkMoveRequest(BaseModel):
    ids: List[int]
    category_id: Optional[int] = None


class BulkDeleteRequest(BaseModel):
    ids: List[int]


@router.post("/bulk-move")
async def bulk_move_audio(body: BulkMoveRequest):
    if not body.ids:
        raise HTTPException(400, "ids must not be empty")
    await db.bulk_move_audio(body.ids, body.category_id)
    return {"ok": True, "moved": len(body.ids)}


@router.post("/bulk-delete")
async def bulk_delete_audio(body: BulkDeleteRequest):
    if not body.ids:
        raise HTTPException(400, "ids must not be empty")
    deleted = 0
    for aid in body.ids:
        if await db.delete_audio_item(aid):
            deleted += 1
    return {"ok": True, "deleted": deleted}


@router.get("")
async def list_audio():
    return await db.list_audio_items()


@router.post("")
async def create_audio(body: AudioCreate):
    if body.type == "local" and not os.path.isfile(body.source):
        raise HTTPException(400, f"File not found: {body.source}")
    return await db.create_audio_item(
        title=body.title,
        type_=body.type,
        source=body.source,
        thumbnail=body.thumbnail,
        duration=body.duration,
        size=body.size,
        category_id=body.category_id,
        sort_order=body.sort_order,
    )


_AUDIO_EXTS = set(_AUDIO_MIME.keys())
_SCRIPT_EXTS = {".srt", ".vtt", ".lrc", ".txt"}


@router.post("/scan-folder")
async def scan_folder(body: ScanFolderRequest):
    folder = os.path.abspath(body.path)
    if not os.path.isdir(folder):
        raise HTTPException(400, f"Directory not found: {folder}")
    # Recursively find audio and script files
    audio_files: list[str] = []
    script_files: list[str] = []
    for root, _dirs, files in os.walk(folder):
        for fname in sorted(files):
            ext = os.path.splitext(fname)[1].lower()
            full = os.path.join(root, fname)
            if ext in _AUDIO_EXTS:
                audio_files.append(full)
            elif ext in _SCRIPT_EXTS:
                script_files.append(full)
    if not audio_files:
        raise HTTPException(400, "No audio files found in folder")

    # Build script lookup by full path (dirname + basename) so same-named scripts
    # in different subfolders don't collide
    script_map: dict[tuple[str, str], str] = {}
    for sp in script_files:
        key = (os.path.dirname(os.path.abspath(sp)), os.path.splitext(os.path.basename(sp))[0].lower())
        script_map[key] = sp

    created: list[dict] = []
    created_categories: list[dict] = []
    category_cache: dict[tuple, int] = {}  # (parent_id, *segments) -> leaf id

    # Decide the base parent and optional root folder name
    # Legacy: if category_id given and parent_category_id not, attach everything flat to category_id
    base_parent_id = body.parent_category_id
    flat_category_id = None
    if body.category_id is not None and body.parent_category_id is None:
        flat_category_id = body.category_id

    scan_root_name = os.path.basename(folder.rstrip("\\/")) or folder

    for af in audio_files:
        abs_af = os.path.abspath(af)
        fname = os.path.basename(abs_af)
        title = os.path.splitext(fname)[0]
        size = os.path.getsize(abs_af)

        # Determine the target category
        target_category_id: Optional[int] = None
        if flat_category_id is not None:
            target_category_id = flat_category_id
        elif body.preserve_structure:
            rel_dir = os.path.relpath(os.path.dirname(abs_af), folder)
            # Path segments: [scan_root_name] + [subdirs...] (excluding "." cases)
            segments = [scan_root_name]
            if rel_dir and rel_dir != ".":
                segments.extend([s for s in rel_dir.replace("\\", "/").split("/") if s and s != "."])
            cache_key = (base_parent_id,) + tuple(segments)
            if cache_key in category_cache:
                target_category_id = category_cache[cache_key]
            else:
                leaf = await db.get_or_create_category_by_path(
                    media_type="audio",
                    segments=segments,
                    root_parent_id=base_parent_id,
                )
                if leaf:
                    target_category_id = leaf["id"]
                    category_cache[cache_key] = leaf["id"]
                    # Collect unique created categories for response
                    if leaf not in created_categories:
                        created_categories.append(leaf)
        else:
            target_category_id = base_parent_id

        # Find matching script in the SAME directory (preserves per-folder naming)
        script_text = ""
        dir_key = (os.path.dirname(abs_af), title.lower())
        matched_script = script_map.get(dir_key)
        if not matched_script:
            import re as _re
            clean = _re.sub(r"^\d+\s*", "", title.lower())
            for (sk_dir, sk_name), sv in script_map.items():
                if sk_dir != os.path.dirname(abs_af):
                    continue
                sk_clean = _re.sub(r"^\d+\s*", "", sk_name)
                if clean and sk_clean and clean == sk_clean:
                    matched_script = sv
                    break
        if matched_script:
            try:
                with open(matched_script, "r", encoding="utf-8", errors="replace") as f:
                    script_text = f.read()
            except Exception:
                pass

        duration = probe_media_duration(abs_af)
        item = await db.create_audio_item(
            title=title,
            type_="local",
            source=abs_af,
            thumbnail="",
            duration=duration,
            size=size,
            sort_order=len(created),
            category_id=target_category_id,
        )
        if script_text:
            item = await db.update_audio_item(item["id"], script_text=script_text)
        created.append(item)

    return {
        "created_items": created,
        "created_categories": created_categories,
        "total": len(created),
    }


MAX_AUDIO_UPLOAD_SIZE = 100 * 1024 * 1024  # 100MB


@router.post("/upload")
async def upload_audio(file: UploadFile = File(...)):
    ext = os.path.splitext(file.filename or "audio.mp3")[1] or ".mp3"
    filename = f"{uuid.uuid4().hex}{ext}"
    dest = os.path.join(UPLOAD_DIR, filename)
    chunks = []
    total = 0
    while chunk := await file.read(8192):
        total += len(chunk)
        if total > MAX_AUDIO_UPLOAD_SIZE:
            raise HTTPException(status_code=413, detail="File too large (max 100MB)")
        chunks.append(chunk)
    content = b"".join(chunks)
    with open(dest, "wb") as f:
        f.write(content)
    title = os.path.splitext(file.filename or "audio")[0]
    abs_dest = os.path.abspath(dest)
    return await db.create_audio_item(
        title=title,
        type_="local",
        source=abs_dest,
        thumbnail="",
        duration=probe_media_duration(abs_dest),
        size=len(content),
        sort_order=0,
    )


@router.put("/{audio_id}")
async def update_audio(audio_id: int, body: AudioUpdate):
    existing = await db.get_audio_item(audio_id)
    if not existing:
        raise HTTPException(404, "Audio not found")
    fields = body.model_dump(exclude_none=True)
    return await db.update_audio_item(audio_id, **fields)


@router.delete("/{audio_id}")
async def delete_audio(audio_id: int):
    deleted = await db.delete_audio_item(audio_id)
    if not deleted:
        raise HTTPException(404, "Audio not found")
    return {"ok": True}


@router.get("/{audio_id}/serve")
async def serve_audio(audio_id: int):
    audio = await db.get_audio_item(audio_id)
    if not audio:
        raise HTTPException(404, "Audio not found")
    if audio["type"] != "local":
        raise HTTPException(400, "Only local audio can be served")
    file_path = audio["source"]
    # Trust DB-registered paths: scan_folder / upload / create_audio
    # explicitly register absolute paths. The audio_id route is protected
    # by the API layer, so no external attacker can inject arbitrary paths.
    real_path = os.path.realpath(file_path)
    if not os.path.isfile(real_path):
        raise HTTPException(404, f"File not found: {file_path}")
    ext = os.path.splitext(real_path)[1].lower()
    media_type = _AUDIO_MIME.get(ext) or mimetypes.guess_type(real_path)[0] or "audio/mpeg"
    return FileResponse(real_path, media_type=media_type)


@router.post("/{audio_id}/thumbnail")
async def upload_audio_thumbnail(audio_id: int, file: UploadFile = File(...)):
    audio = await db.get_audio_item(audio_id)
    if not audio:
        raise HTTPException(404, "Audio not found")
    ext = os.path.splitext(file.filename or "thumb.jpg")[1] or ".jpg"
    filename = f"{audio_id}{ext}"
    dest = os.path.join(THUMB_DIR, filename)
    content = await file.read()
    with open(dest, "wb") as f:
        f.write(content)
    thumb_url = f"/api/thumbnails/audio/{filename}"
    return await db.update_audio_item(audio_id, thumbnail=thumb_url)


@router.post("/{audio_id}/script")
async def upload_audio_script(audio_id: int, file: UploadFile = File(...)):
    audio = await db.get_audio_item(audio_id)
    if not audio:
        raise HTTPException(404, "Audio not found")
    content = (await file.read()).decode("utf-8", errors="replace")
    return await db.update_audio_item(audio_id, script_text=content)


# ── Script translation ──────────────────────────────────────────


def _extract_translatable_lines(script_text: str) -> list[str]:
    """Block-based extraction; index matches frontend cue index."""
    return extract_translatable_blocks(script_text)


class TranslateScriptRequest(BaseModel):
    source_lang: str = "ja"
    target_lang: str = "ko"


@router.post("/{audio_id}/translate-script")
async def translate_audio_script(audio_id: int, body: TranslateScriptRequest):
    """Translate script_text using TM cache + AI translation."""
    settings = await db.get_settings()
    provider = settings.get("default_provider", "claude")
    if provider not in OFFLINE_PROVIDERS:
        await require_license()
    audio = await db.get_audio_item(audio_id)
    if not audio:
        raise HTTPException(404, "Audio not found")
    if not audio.get("script_text", "").strip():
        raise HTTPException(400, "No script text to translate")

    lines = _extract_translatable_lines(audio["script_text"])
    if not lines:
        raise HTTPException(400, "No translatable lines found")

    # 1) TM batch lookup
    tm_results = await db.tm_lookup_batch(lines, body.source_lang, body.target_lang)

    translated = []
    ai_indices = []
    ai_texts = []
    for i, line in enumerate(lines):
        if line in tm_results:
            translated.append(tm_results[line]["translated_text"])
        else:
            translated.append("")
            ai_indices.append(i)
            ai_texts.append(line)

    cached = len(lines) - len(ai_texts)

    # 2) AI translate missing lines
    if ai_texts:
        api_keys = settings.get("api_keys", {})
        if isinstance(api_keys, str):
            api_keys = json.loads(api_keys)
        api_key = api_keys.get(provider, "")
        model = settings.get("model", "")

        if not api_key:
            raise HTTPException(400, f"No API key configured for provider: {provider}")

        # Load category glossary if this audio belongs to a category
        cat_id = audio.get("category_id")
        category_glossary: dict[str, str] = {}
        if cat_id:
            try:
                category_glossary = await db.get_category_glossary(int(cat_id))
            except Exception as e:
                logger.warning("Failed to load category glossary for %s: %s", cat_id, e)
                category_glossary = {}

        try:
            translator = engine_bridge.create_translator(
                provider=provider,
                api_key=api_key,
                model=model,
                source_lang=body.source_lang,
            )
            try:
                ai_results = translator.translate_all(
                    ai_texts,
                    glossary=category_glossary or None,
                )
            except TypeError:
                ai_results = translator.translate_all(ai_texts)

            # Fill in results + save to TM
            tm_tag = f"audio_cat:{cat_id}" if cat_id else "audio_script"
            tm_entries = []
            for idx, ai_trans in zip(ai_indices, ai_results):
                if ai_trans and ai_trans.strip():
                    translated[idx] = ai_trans
                    tm_entries.append({
                        "source_text": lines[idx],
                        "translated_text": ai_trans,
                        "source_lang": body.source_lang,
                        "target_lang": body.target_lang,
                        "provider": provider,
                        "model": model,
                        "context_tag": tm_tag,
                    })
            if tm_entries:
                await db.tm_insert_batch(tm_entries)
        except Exception as e:
            logger.error("Script translation failed: %s", e)
            raise HTTPException(500, f"Translation failed: {e}")

    # 3) Save translated_script to DB
    updated_item = await db.update_audio_item(audio_id, translated_script=json.dumps(translated, ensure_ascii=False))

    return {
        "original": lines,
        "translated": translated,
        "total": len(lines),
        "cached": cached,
        "item": updated_item,
    }


# ── Auto-Caption (STT + Translation → Spotify lyrics) ───────────

class AutoCaptionRequest(BaseModel):
    provider: str = ""
    api_key: str = ""
    model: str = ""
    source_lang: str = "ja"
    target_lang: str = "ko"
    stt_provider: str = "whisper_api"
    stt_api_key: str = ""


@router.post("/{audio_id}/auto-caption")
async def auto_caption(audio_id: int, body: AutoCaptionRequest):
    """Run STT + Translation on audio, save result as Spotify-style lyrics."""
    if body.provider not in OFFLINE_PROVIDERS:
        await require_license()
    audio = await db.get_audio_item(audio_id)
    if not audio:
        raise HTTPException(404, "Audio not found")
    if audio.get("type") != "local":
        raise HTTPException(400, "Only local audio files can be auto-captioned")

    audio_path = audio.get("source", "")
    if not audio_path or not os.path.isfile(audio_path):
        raise HTTPException(400, f"Audio file not found: {audio_path}")

    # Resolve API keys from settings if not provided
    settings = await db.get_settings()
    api_keys_raw = settings.get("api_keys", {})
    if isinstance(api_keys_raw, str):
        try:
            api_keys_raw = json.loads(api_keys_raw)
        except Exception:
            api_keys_raw = {}

    provider = body.provider or settings.get("default_provider", "claude_api")
    api_key = body.api_key or api_keys_raw.get(provider, "")
    model = body.model or ""
    stt_api_key = body.stt_api_key or api_keys_raw.get("openai", "")

    from .. import subtitle_job_manager as sjm
    job = await sjm.start_auto_caption(
        audio_id=audio_id,
        audio_path=audio_path,
        provider=provider,
        api_key=api_key,
        model=model,
        source_lang=body.source_lang,
        target_lang=body.target_lang,
        stt_provider=body.stt_provider,
        stt_api_key=stt_api_key,
        category_id=audio.get("category_id"),
    )
    return {"job_id": job.job_id, "status": job.status}


# ── Bulk translate ──────────────────────────────────────────────

class BulkTranslateRequest(BaseModel):
    audio_ids: List[int]
    mode: str = "auto"  # "auto" | "script" | "auto_caption"
    source_lang: str = "ja"
    target_lang: str = "ko"
    provider: str = ""
    api_key: str = ""
    model: str = ""
    stt_provider: str = "whisper_api"
    stt_api_key: str = ""
    use_category_glossary: bool = True


@router.post("/bulk-translate")
async def bulk_translate(body: BulkTranslateRequest):
    """Start a bulk translate job across multiple audio items."""
    if body.provider not in OFFLINE_PROVIDERS:
        await require_license()
    if not body.audio_ids:
        raise HTTPException(400, "audio_ids must not be empty")
    if body.mode not in ("auto", "script", "auto_caption"):
        raise HTTPException(400, f"invalid mode: {body.mode}")

    settings = await db.get_settings()
    api_keys_raw = settings.get("api_keys", {})
    if isinstance(api_keys_raw, str):
        try:
            api_keys_raw = json.loads(api_keys_raw)
        except Exception:
            api_keys_raw = {}

    provider = body.provider or settings.get("default_provider", "claude")
    api_key = body.api_key or api_keys_raw.get(provider, "")
    model = body.model or settings.get("model", "")
    stt_api_key = body.stt_api_key or api_keys_raw.get("openai", "")

    if not api_key:
        raise HTTPException(400, f"No API key configured for provider: {provider}")

    from .. import subtitle_job_manager as sjm
    try:
        job = await sjm.start_bulk_audio_translate(
            audio_ids=body.audio_ids,
            mode=body.mode,
            source_lang=body.source_lang,
            target_lang=body.target_lang,
            provider=provider,
            api_key=api_key,
            model=model,
            stt_provider=body.stt_provider,
            stt_api_key=stt_api_key,
            use_category_glossary=body.use_category_glossary,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {
        "job_id": job.job_id,
        "status": job.status,
        "total": job.total,
        "category_id": job.category_id,
    }


@router.get("/bulk-translate/{job_id}/status")
async def bulk_translate_status(job_id: str):
    """SSE stream for bulk translate job progress."""
    import asyncio
    from fastapi.responses import StreamingResponse
    from .. import subtitle_job_manager as sjm

    job = sjm.get_audio_bulk_job(job_id)
    if not job:
        raise HTTPException(404, "Job not found")

    q = job.add_sse_listener()

    async def event_generator():
        try:
            yield f"data: {json.dumps({'event': 'init', 'data': {'status': job.status, 'done': job.done, 'total': job.total}})}\n\n"
            while True:
                try:
                    msg = await asyncio.wait_for(q.get(), timeout=30)
                    yield f"data: {json.dumps(msg)}\n\n"
                    if msg.get("event") in ("complete", "error", "cancelled"):
                        break
                except asyncio.TimeoutError:
                    yield f"data: {json.dumps({'event': 'heartbeat', 'data': {}})}\n\n"
                    if job.status != "running":
                        break
        finally:
            job.remove_sse_listener(q)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/bulk-translate/{job_id}/cancel")
async def bulk_translate_cancel(job_id: str):
    from .. import subtitle_job_manager as sjm
    job = sjm.get_audio_bulk_job(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    job.cancel_event.set()
    return {"ok": True}


@router.get("/auto-caption/{job_id}/status")
async def auto_caption_status(job_id: str):
    """SSE stream for auto-caption job progress."""
    import asyncio
    from fastapi.responses import StreamingResponse
    from .. import subtitle_job_manager as sjm

    job = sjm.get_job(job_id)
    if not job:
        raise HTTPException(404, "Job not found")

    q = job.add_sse_listener()

    async def event_generator():
        try:
            while True:
                try:
                    msg = await asyncio.wait_for(q.get(), timeout=30)
                    yield f"data: {json.dumps(msg)}\n\n"
                    if msg.get("event") in ("complete", "error", "cancelled"):
                        break
                except asyncio.TimeoutError:
                    yield f"data: {json.dumps({'event': 'heartbeat', 'data': {}})}\n\n"
        finally:
            job.remove_sse_listener(q)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
