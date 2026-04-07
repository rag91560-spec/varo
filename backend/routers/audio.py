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
    category_id: Optional[int] = None


class BulkMoveRequest(BaseModel):
    ids: List[int]
    category_id: Optional[int] = None


@router.post("/bulk-move")
async def bulk_move_audio(body: BulkMoveRequest):
    if not body.ids:
        raise HTTPException(400, "ids must not be empty")
    await db.bulk_move_audio(body.ids, body.category_id)
    return {"ok": True, "moved": len(body.ids)}


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
    folder = body.path
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
    # Build script lookup by base name (without extension)
    script_map: dict[str, str] = {}
    for sp in script_files:
        base = os.path.splitext(os.path.basename(sp))[0].lower()
        # strip leading number prefix like "1 " for matching "01 xxx"
        script_map[base] = sp
    created = []
    for af in audio_files:
        fname = os.path.basename(af)
        title = os.path.splitext(fname)[0]
        size = os.path.getsize(af)
        # Try to find matching script
        base = title.lower()
        script_text = ""
        matched_script = script_map.get(base)
        if not matched_script:
            # Try stripping leading numbers for fuzzy match
            import re
            clean = re.sub(r'^\d+\s*', '', base)
            for sk, sv in script_map.items():
                sk_clean = re.sub(r'^\d+\s*', '', sk)
                if clean and sk_clean and clean == sk_clean:
                    matched_script = sv
                    break
        if matched_script:
            try:
                with open(matched_script, "r", encoding="utf-8", errors="replace") as f:
                    script_text = f.read()
            except Exception:
                pass
        item = await db.create_audio_item(
            title=title,
            type_="local",
            source=os.path.abspath(af),
            thumbnail="",
            duration=0,
            size=size,
            sort_order=len(created),
            category_id=body.category_id,
        )
        if script_text:
            item = await db.update_audio_item(item["id"], script_text=script_text)
        created.append(item)
    return created


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
    return await db.create_audio_item(
        title=title,
        type_="local",
        source=os.path.abspath(dest),
        thumbnail="",
        duration=0,
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
    real_path = os.path.realpath(file_path)
    allowed_dir = os.path.realpath(_data_dir)
    if not real_path.startswith(allowed_dir + os.sep) and not real_path.startswith(allowed_dir):
        raise HTTPException(403, "Access denied: path outside allowed directory")
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

_SRT_TS_RE = re.compile(
    r"^\d+$|"                                          # SRT index
    r"^\d{2}:\d{2}:\d{2}[.,]\d{3}\s*-->|"             # SRT timestamp
    r"^WEBVTT|^NOTE\s|^Kind:|^Language:",              # VTT header
)


def _extract_translatable_lines(script_text: str) -> list[str]:
    """Return only translatable text lines from SRT/VTT/plain script."""
    lines = []
    for line in script_text.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        if _SRT_TS_RE.match(stripped):
            continue
        lines.append(stripped)
    return lines


class TranslateScriptRequest(BaseModel):
    source_lang: str = "ja"
    target_lang: str = "ko"


@router.post("/{audio_id}/translate-script")
async def translate_audio_script(audio_id: int, body: TranslateScriptRequest):
    """Translate script_text using TM cache + AI translation."""
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
        settings = await db.get_settings()
        provider = settings.get("default_provider", "claude")
        api_keys = settings.get("api_keys", {})
        if isinstance(api_keys, str):
            api_keys = json.loads(api_keys)
        api_key = api_keys.get(provider, "")
        model = settings.get("model", "")

        if not api_key:
            raise HTTPException(400, f"No API key configured for provider: {provider}")

        try:
            translator = engine_bridge.create_translator(
                provider=provider,
                api_key=api_key,
                model=model,
                source_lang=body.source_lang,
            )
            ai_results = translator.translate_all(ai_texts)

            # Fill in results + save to TM
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
                        "context_tag": "audio_script",
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
