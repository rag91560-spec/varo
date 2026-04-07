"""Media pipeline: audio/video/script folder management and file serving."""

import logging
import mimetypes
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from .. import db
try:
    from ..license import require_license
except ImportError:
    from ..license_stub import require_license

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/media", tags=["media"])

# Extension whitelists
_AUDIO_EXT = frozenset({".mp3", ".ogg", ".wav", ".flac", ".m4a"})
_VIDEO_EXT = frozenset({".mp4", ".webm", ".mkv"})
_SCRIPT_EXT = frozenset({".txt", ".json", ".srt", ".ass", ".vtt"})
_ALL_EXT = _AUDIO_EXT | _VIDEO_EXT | _SCRIPT_EXT

_TYPE_EXTENSIONS = {
    "audio": _AUDIO_EXT,
    "video": _VIDEO_EXT,
    "script": _SCRIPT_EXT,
}

_VALID_MEDIA_TYPES = frozenset({"audio", "video", "script"})

# Auto-scan: folder name → media type mapping
_AUTO_SCAN_FOLDERS = {
    "audio": {"audio", "bgm", "se", "sound", "sounds", "music", "voice", "voices", "wav", "ogg"},
    "video": {"video", "videos", "movie", "movies", "cutscene", "cutscenes", "opening", "op", "ed"},
    "script": {"script", "scripts", "scenario", "text", "texts", "dialog", "dialogue", "subtitle"},
}

# Blocked system directories (reuse pattern from games.py)
_BLOCKED_PREFIXES_WIN = ["C:\\Windows", "C:\\Program Files", "C:\\ProgramData"]
_BLOCKED_PREFIXES_UNIX = ["/etc", "/usr", "/bin", "/sbin", "/var", "/proc", "/sys"]


def _validate_path(path: str) -> Path:
    if not path or not path.strip():
        raise HTTPException(400, "Path cannot be empty")
    if "\0" in path:
        raise HTTPException(400, "Invalid path: null byte detected")
    if ".." in path:
        raise HTTPException(400, "Invalid path: directory traversal not allowed")
    resolved = Path(path).resolve()
    resolved_str = str(resolved)
    for prefix in _BLOCKED_PREFIXES_WIN + _BLOCKED_PREFIXES_UNIX:
        if resolved_str.lower().startswith(prefix.lower()):
            raise HTTPException(400, "Access denied: system directory blocked")
    return resolved


def _ext_to_type(ext: str) -> str:
    ext = ext.lower()
    if ext in _AUDIO_EXT:
        return "audio"
    if ext in _VIDEO_EXT:
        return "video"
    if ext in _SCRIPT_EXT:
        return "script"
    return ""


# --- Models ---

class AddFolderRequest(BaseModel):
    folder_path: str
    media_type: str  # audio | video | script
    label: Optional[str] = None


class TranslateScriptRequest(BaseModel):
    script_path: str
    source_lang: str = "auto"
    target_lang: str = "ko"


# --- Endpoints ---

@router.get("/{game_id}/folders")
async def list_folders(game_id: int):
    """List all registered media folders for a game."""
    game = await db.get_game(game_id)
    if not game:
        raise HTTPException(404, "Game not found")
    folders = await db.media_list_folders(game_id)
    return {"folders": folders}


@router.post("/{game_id}/folders")
async def add_folder(game_id: int, body: AddFolderRequest):
    """Register a media folder for a game."""
    game = await db.get_game(game_id)
    if not game:
        raise HTTPException(404, "Game not found")

    if body.media_type not in _VALID_MEDIA_TYPES:
        raise HTTPException(400, f"Invalid media_type: {body.media_type}")

    resolved = _validate_path(body.folder_path)
    if not resolved.is_dir():
        raise HTTPException(400, f"Not a directory: {body.folder_path}")

    folder = await db.media_add_folder(
        game_id=game_id,
        folder_path=str(resolved),
        media_type=body.media_type,
        label=body.label,
    )
    return folder


@router.delete("/{game_id}/folders/{folder_id}")
async def remove_folder(game_id: int, folder_id: int):
    """Unregister a media folder."""
    ok = await db.media_delete_folder(folder_id, game_id)
    if not ok:
        raise HTTPException(404, "Folder not found")
    return {"ok": True}


@router.get("/{game_id}/files")
async def list_files(game_id: int, type: Optional[str] = None):
    """Scan registered folders and return file list."""
    game = await db.get_game(game_id)
    if not game:
        raise HTTPException(404, "Game not found")

    folders = await db.media_list_folders(game_id)
    if type and type in _VALID_MEDIA_TYPES:
        folders = [f for f in folders if f["media_type"] == type]

    files = []
    for folder in folders:
        folder_path = Path(folder["folder_path"])
        if not folder_path.is_dir():
            continue
        allowed_ext = _TYPE_EXTENSIONS.get(folder["media_type"], _ALL_EXT)
        try:
            for entry in sorted(folder_path.iterdir()):
                if not entry.is_file():
                    continue
                ext = entry.suffix.lower()
                if ext not in allowed_ext:
                    continue
                file_type = _ext_to_type(ext)
                if not file_type:
                    continue
                try:
                    size = entry.stat().st_size
                except OSError:
                    size = 0
                files.append({
                    "name": entry.name,
                    "path": str(entry),
                    "type": file_type,
                    "size": size,
                    "folder_id": folder["id"],
                })
        except PermissionError:
            logger.warning("Permission denied scanning folder: %s", folder_path)

    return {"files": files}


@router.get("/{game_id}/serve")
async def serve_file(game_id: int, path: str):
    """Serve a media file with extension whitelist validation."""
    game = await db.get_game(game_id)
    if not game:
        raise HTTPException(404, "Game not found")

    resolved = _validate_path(path)
    if not resolved.is_file():
        raise HTTPException(404, "File not found")

    ext = resolved.suffix.lower()
    if ext not in _ALL_EXT:
        raise HTTPException(403, f"File type not allowed: {ext}")

    # Verify the file belongs to a registered folder
    folders = await db.media_list_folders(game_id)
    file_str = str(resolved)
    authorized = False
    for folder in folders:
        if file_str.startswith(folder["folder_path"]):
            authorized = True
            break
    if not authorized:
        raise HTTPException(403, "File not in a registered media folder")

    content_type = mimetypes.guess_type(str(resolved))[0] or "application/octet-stream"
    return FileResponse(str(resolved), media_type=content_type)


@router.post("/{game_id}/scan")
async def auto_scan_media(game_id: int):
    """Auto-detect media subfolders in the game directory and register them."""
    game = await db.get_game(game_id)
    if not game:
        raise HTTPException(404, "Game not found")

    game_root = Path(game["path"])
    if not game_root.is_dir():
        raise HTTPException(400, "Game directory not found")

    # Get already-registered folder paths
    existing = await db.media_list_folders(game_id)
    existing_paths = {f["folder_path"] for f in existing}

    added = []
    skipped = []

    # Walk up to depth 3 from game root
    def _scan_dir(base: Path, depth: int):
        if depth > 3:
            return
        try:
            entries = sorted(base.iterdir())
        except (PermissionError, OSError):
            return
        for entry in entries:
            if not entry.is_dir():
                continue
            folder_lower = entry.name.lower()
            # Check if folder name matches any media type
            for media_type, names in _AUTO_SCAN_FOLDERS.items():
                if folder_lower in names:
                    resolved = str(entry.resolve())
                    if resolved in existing_paths:
                        skipped.append(resolved)
                        break
                    # Verify at least one matching file exists
                    allowed_ext = _TYPE_EXTENSIONS[media_type]
                    file_count = 0
                    try:
                        for f in entry.iterdir():
                            if f.is_file() and f.suffix.lower() in allowed_ext:
                                file_count += 1
                    except (PermissionError, OSError):
                        pass
                    if file_count > 0:
                        added.append({
                            "folder_path": resolved,
                            "media_type": media_type,
                            "file_count": file_count,
                        })
                        existing_paths.add(resolved)
                    break
            else:
                # No match — recurse deeper
                _scan_dir(entry, depth + 1)

    _scan_dir(game_root, 1)

    # Register discovered folders
    for item in added:
        await db.media_add_folder(
            game_id=game_id,
            folder_path=item["folder_path"],
            media_type=item["media_type"],
            label=None,
        )

    total_files = sum(item["file_count"] for item in added)
    return {"added": added, "skipped": skipped, "total_files": total_files}


@router.post("/{game_id}/script/translate")
async def translate_script(game_id: int, body: TranslateScriptRequest):
    """Translate a script file using the existing translation pipeline."""
    await require_license()
    game = await db.get_game(game_id)
    if not game:
        raise HTTPException(404, "Game not found")

    resolved = _validate_path(body.script_path)
    if not resolved.is_file():
        raise HTTPException(404, "Script file not found")

    ext = resolved.suffix.lower()
    if ext not in _SCRIPT_EXT:
        raise HTTPException(400, f"Not a script file: {ext}")

    # Verify file belongs to a registered folder
    folders = await db.media_list_folders(game_id)
    file_str = str(resolved)
    authorized = False
    for folder in folders:
        if file_str.startswith(folder["folder_path"]):
            authorized = True
            break
    if not authorized:
        raise HTTPException(403, "File not in a registered media folder")

    # Read the script file
    try:
        text = resolved.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        try:
            text = resolved.read_text(encoding="shift_jis")
        except Exception:
            raise HTTPException(400, "Cannot read script file: unsupported encoding")

    lines = [line for line in text.splitlines() if line.strip()]
    if not lines:
        return {"original": [], "translated": [], "source_path": str(resolved)}

    # Use TM lookup first, then return lines that need translation
    tm_results = await db.tm_lookup_batch(lines, body.source_lang, body.target_lang)

    original = []
    translated = []
    for line in lines:
        original.append(line)
        if line in tm_results:
            translated.append(tm_results[line]["translated_text"])
        else:
            translated.append("")

    return {
        "original": original,
        "translated": translated,
        "source_path": str(resolved),
        "total": len(lines),
        "cached": sum(1 for t in translated if t),
    }
