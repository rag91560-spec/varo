"""Game CRUD, scan, and launch endpoints."""

import asyncio
import json
import logging
import mimetypes
import os
import zipfile
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pathlib import Path

from pydantic import BaseModel as _PydanticBase
from ..models import GameCreate, GameUpdate, GameResponse, ScanDirectoryRequest, ScanDirectoryResult, SubtitleImportRequest
from .. import db
from .. import engine_bridge
from .. import structure_parser


# ── Folder models ──
class FolderCreate(_PydanticBase):
    name: str
    parent_id: int | None = None

class FolderUpdate(_PydanticBase):
    name: str | None = None
    sort_order: int | None = None
    parent_id: int | None = None

logger = logging.getLogger(__name__)

HTML_ENGINES = {"rpg maker mv/mz", "tyranoscript", "gdevelop", "html"}

# Blocked system directories (path traversal defense)
_BLOCKED_PREFIXES_WIN = ["C:\\Windows", "C:\\Program Files", "C:\\ProgramData"]
_BLOCKED_PREFIXES_UNIX = ["/etc", "/usr", "/bin", "/sbin", "/var", "/proc", "/sys"]

# Allowed file extensions for HTML game serving (#27)
_SERVE_ALLOWED_EXTENSIONS = frozenset({
    ".html", ".htm", ".js", ".mjs", ".css", ".json", ".xml", ".txt", ".csv",
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico", ".bmp",
    ".mp3", ".ogg", ".wav", ".m4a", ".flac", ".aac",
    ".mp4", ".webm", ".ogv",
    ".woff", ".woff2", ".ttf", ".otf", ".eot",
    ".wasm", ".map", ".rpgmvp", ".rpgmvo", ".ogg_", ".png_", ".m4a_",
})

router = APIRouter(prefix="/api/games", tags=["games"])

# ── Folder router (separate prefix) ──
folder_router = APIRouter(prefix="/api/folders", tags=["folders"])


@folder_router.get("")
async def list_folders():
    return await db.list_folders()


@folder_router.post("")
async def create_folder(body: FolderCreate):
    if not body.name.strip():
        raise HTTPException(400, "Folder name cannot be empty")
    return await db.create_folder(body.name.strip(), parent_id=body.parent_id)


@folder_router.put("/{folder_id}")
async def update_folder(folder_id: int, body: FolderUpdate):
    folder = await db.get_folder(folder_id)
    if not folder:
        raise HTTPException(404, "Folder not found")
    fields = body.model_dump(exclude_unset=True)
    if "name" in fields:
        name = (fields["name"] or "").strip()
        if not name:
            raise HTTPException(400, "Folder name cannot be empty")
        fields["name"] = name
    return await db.update_folder(folder_id, **fields)


@folder_router.delete("/{folder_id}")
async def delete_folder(folder_id: int):
    deleted = await db.delete_folder(folder_id)
    if not deleted:
        raise HTTPException(404, "Folder not found")
    return {"ok": True}


def _validate_path(path: str) -> Path:
    """Validate and normalize a user-supplied path. Raises HTTPException on violation."""
    if not path or not path.strip():
        raise HTTPException(400, "Path cannot be empty")

    # Reject null bytes
    if "\0" in path:
        raise HTTPException(400, "Invalid path: null byte detected")

    # Reject .. traversal
    if ".." in path:
        raise HTTPException(400, "Invalid path: directory traversal not allowed")

    resolved = Path(path).resolve()

    # Block system directories
    resolved_str = str(resolved)
    for prefix in _BLOCKED_PREFIXES_WIN + _BLOCKED_PREFIXES_UNIX:
        if resolved_str.lower().startswith(prefix.lower()):
            raise HTTPException(400, f"Access denied: system directory blocked")

    return resolved


# ── Fixed-path routes FIRST (before {game_id} param routes) ──

@router.get("/media-game-ids")
async def media_game_ids(type: str = ""):
    """Return game IDs that have media folders of the given type (audio/video)."""
    if type and type in ("audio", "video", "script"):
        ids = await db.media_games_with_type(type)
    else:
        audio = await db.media_games_with_type("audio")
        video = await db.media_games_with_type("video")
        ids = audio | video
    return {"game_ids": list(ids)}


@router.post("/scan-all")
async def scan_all_games():
    """Scan all games in the library concurrently (#26)."""
    games = await db.list_games()

    async def _scan_one(game: dict) -> dict:
        if game.get("platform") == "android":
            return {"game_id": game["id"], "ok": True, "skipped": True}
        try:
            result = await asyncio.to_thread(
                engine_bridge.scan_game, game["path"], game["engine"] or None
            )
            await db.update_game(
                game["id"],
                engine=result["engine"],
                string_count=result["string_count"],
            )
            if not game.get("exe_path"):
                exe = await asyncio.to_thread(engine_bridge.find_game_exe, game["path"])
                if exe:
                    await db.update_game(game["id"], exe_path=exe)
            return {
                "game_id": game["id"],
                "ok": True,
                "engine": result["engine"],
                "string_count": result["string_count"],
            }
        except Exception as e:
            logger.warning("scan-all failed for game %s: %s", game["id"], e)
            return {"game_id": game["id"], "ok": False, "error": str(e)}

    sem = asyncio.Semaphore(5)

    async def _limited(game: dict) -> dict:
        async with sem:
            return await _scan_one(game)

    results = await asyncio.gather(*[_limited(g) for g in games])
    return {"total": len(games), "results": list(results)}


@router.post("/scan-directory")
async def scan_directory(body: ScanDirectoryRequest):
    resolved = _validate_path(body.path)
    if not resolved.is_dir():
        raise HTTPException(400, f"Directory not found: {body.path.strip()}")

    games = await asyncio.to_thread(engine_bridge.scan_directory_for_games, str(resolved))
    return games


_SUBTITLE_EXTENSIONS = frozenset({".srt", ".ass", ".ssa", ".vtt", ".txt"})


@router.post("/import-files")
async def import_subtitle_files(body: SubtitleImportRequest):
    """Import subtitle/text files directly as a project."""
    if not body.files:
        raise HTTPException(400, "No files provided")

    # Validate all files
    valid_files = []
    for f in body.files:
        p = _validate_path(f)
        if not p.is_file():
            raise HTTPException(400, f"File not found: {f}")
        if p.suffix.lower() not in _SUBTITLE_EXTENSIONS:
            raise HTTPException(400, f"Unsupported format: {p.suffix}")
        valid_files.append(p)

    # Use the common parent folder as game_path
    parents = [f.parent for f in valid_files]
    common = parents[0]
    for p in parents[1:]:
        while common not in p.parents and common != p:
            common = common.parent
    game_path = str(common)

    title = body.title or valid_files[0].stem

    game = await db.create_game(
        title=title,
        path=game_path,
        exe_path="",
        engine="Subtitle",
        source_lang=body.source_lang,
        variant_lang="",
    )

    # Auto-scan
    try:
        result = await asyncio.to_thread(
            engine_bridge.scan_game, game_path, "Subtitle"
        )
        await db.update_game(
            game["id"],
            engine="Subtitle",
            string_count=result["string_count"],
        )
        game = await db.get_game(game["id"])
    except Exception as e:
        logger.warning("Auto-scan after import failed: %s", e)

    return game


# ── Collection routes ──

@router.get("")
async def list_games(search: str = ""):
    games = await db.list_games(search)
    return games


def _safe_extractall(zf: zipfile.ZipFile, extract_dir: str):
    """Extract zip with ZipSlip path traversal prevention."""
    real_extract = os.path.realpath(extract_dir)
    for member in zf.namelist():
        target = os.path.realpath(os.path.join(extract_dir, member))
        if not target.startswith(real_extract + os.sep) and target != real_extract:
            raise ValueError(f"Zip path traversal detected: {member}")
    zf.extractall(extract_dir)


def _extract_zip(zip_path: Path) -> Path:
    """Extract a ZIP file to a sibling folder named after the ZIP stem.

    Returns the game root directory (unwraps single-folder wrapper if present).
    """
    extract_dir = zip_path.parent / zip_path.stem
    if extract_dir.exists():
        # Already extracted — reuse
        pass
    else:
        extract_dir.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(str(zip_path), "r") as zf:
            _safe_extractall(zf, str(extract_dir))

    # If ZIP contains a single top-level folder, unwrap it
    children = [p for p in extract_dir.iterdir()]
    if len(children) == 1 and children[0].is_dir():
        return children[0]
    return extract_dir


@router.post("")
async def create_game(body: GameCreate):
    resolved = _validate_path(body.path)

    # ZIP auto-extract: if user selected a .zip file, extract and use the folder
    if resolved.is_file() and resolved.suffix.lower() == ".zip":
        try:
            extract_root = await asyncio.to_thread(_extract_zip, resolved)
            resolved = extract_root
        except zipfile.BadZipFile:
            raise HTTPException(400, "유효하지 않은 ZIP 파일입니다.")
        except ValueError as e:
            raise HTTPException(400, str(e))
        except Exception as e:
            raise HTTPException(500, f"ZIP 해제 실패: {e}")

    path = str(resolved)
    if not resolved.is_dir():
        raise HTTPException(400, f"Directory not found: {body.path.strip()}")

    title = body.title or Path(path).name
    try:
        exe_path = body.exe_path or await asyncio.to_thread(engine_bridge.find_game_exe, path) or ""
    except Exception:
        exe_path = ""
    engine = body.engine

    # Auto-detect engine if not specified
    if not engine:
        try:
            result = await asyncio.to_thread(engine_bridge.detect_engine, path)
            if result:
                engine = result["name"]
                # Mumu: 중첩 폴더일 때 실제 게임 루트로 경로 보정
                if result.get("real_root"):
                    path = result["real_root"]
                    title = Path(path).name
            elif engine_bridge.is_html_game(path):
                engine = "HTML"
        except Exception:
            engine = ""

    try:
        game = await db.create_game(
            title=title,
            path=path,
            exe_path=exe_path,
            engine=engine or "",
            source_lang=body.source_lang,
            variant_lang=body.variant_lang or "",
        )
    except Exception as e:
        if "UNIQUE" in str(e):
            raise HTTPException(409, "이미 등록된 게임 경로입니다.")
        raise HTTPException(500, f"게임 등록 실패: {e}")

    # Auto-find AES key for UE4/5 games
    aes_key = ""
    if engine and "unreal" in engine.lower():
        try:
            aes_key = await asyncio.to_thread(engine_bridge.find_aes_key, path) or ""
            if aes_key:
                await db.update_game(game["id"], aes_key=aes_key)
                game["aes_key"] = aes_key
                logger.info("Auto-found AES key for game %s", game["id"])
        except Exception as e:
            logger.warning("AES key search failed for game %s: %s", game["id"], e)

    # Auto-scan strings if engine was detected
    if engine:
        try:
            result = await asyncio.to_thread(engine_bridge.scan_game, path, engine, aes_key)
            await db.update_game(
                game["id"],
                engine=result["engine"],
                string_count=result["string_count"],
            )
            game["engine"] = result["engine"]
            game["string_count"] = result["string_count"]
        except Exception as e:
            logger.warning("Auto-scan failed for game %s: %s", game["id"], e)

    return game


# ── Per-game routes ──

@router.get("/{game_id}")
async def get_game(game_id: int):
    game = await db.get_game(game_id)
    if not game:
        raise HTTPException(404, "Game not found")
    return game


@router.put("/{game_id}")
async def update_game(game_id: int, body: GameUpdate):
    game = await db.get_game(game_id)
    if not game:
        raise HTTPException(404, "Game not found")

    fields = body.model_dump(exclude_none=True)
    updated = await db.update_game(game_id, **fields)
    return updated


@router.delete("/{game_id}")
async def delete_game(game_id: int):
    deleted = await db.delete_game(game_id)
    if not deleted:
        raise HTTPException(404, "Game not found")
    return {"ok": True}


@router.post("/{game_id}/scan")
async def scan_game(game_id: int):
    game = await db.get_game(game_id)
    if not game:
        raise HTTPException(404, "Game not found")

    # Android games don't need engine scanning
    if game.get("platform") == "android":
        return {"game": game, "resources": [], "string_count": 0}

    try:
        result = await asyncio.to_thread(
            engine_bridge.scan_game, game["path"], game["engine"] or None, game.get("aes_key", "")
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        logger.exception("Scan failed for game %s: %s", game_id, e)
        raise HTTPException(500, f"Scan failed: {e}")

    # Update game with scan results
    await db.update_game(
        game_id,
        engine=result["engine"],
        string_count=result["string_count"],
    )

    # Also try to find exe if missing
    if not game.get("exe_path"):
        exe = await asyncio.to_thread(engine_bridge.find_game_exe, game["path"])
        if exe:
            await db.update_game(game_id, exe_path=exe)

    updated = await db.get_game(game_id)
    return {
        "game": updated,
        "resources": result["resources"],
        "string_count": result["string_count"],
    }


@router.post("/{game_id}/find-aes-key")
async def find_aes_key(game_id: int):
    game = await db.get_game(game_id)
    if not game:
        raise HTTPException(404, "Game not found")

    try:
        key = await asyncio.to_thread(engine_bridge.find_aes_key, game["path"])
    except Exception as e:
        logger.exception("AES key search failed for game %s: %s", game_id, e)
        raise HTTPException(500, f"AES key search failed: {e}")

    if key:
        await db.update_game(game_id, aes_key=key)

    updated = await db.get_game(game_id)
    return {"aes_key": key or "", "game": updated}


@router.post("/{game_id}/launch")
async def launch_game(game_id: int):
    game = await db.get_game(game_id)
    if not game:
        raise HTTPException(404, "Game not found")

    # Android games: delegate to android_manager
    if game.get("platform") == "android":
        from .. import android_manager
        try:
            result = await android_manager.install_and_launch(game)
        except Exception as e:
            logger.exception("Failed to launch Android game %s", game_id)
            raise HTTPException(500, f"Failed to launch: {e}")
        if not result["ok"]:
            raise HTTPException(400, result["message"])
        await db.update_game(game_id, last_played_at=datetime.now(timezone.utc).isoformat())
        return {"ok": True, "exe_path": "", "device_id": result.get("device_id", "")}

    # HTML games: return serve URL instead of launching process
    game_engine = (game.get("engine") or "").lower()
    if game_engine in HTML_ENGINES or engine_bridge.is_html_game(game["path"]):
        html_index = engine_bridge.find_html_index(game["path"])
        if html_index:
            await db.update_game(game_id, last_played_at=datetime.now(timezone.utc).isoformat())
            return {
                "ok": True,
                "html_game": True,
                "serve_url": f"/api/games/{game_id}/serve/{html_index}",
            }

    exe_path = game.get("exe_path", "")
    if not exe_path or not Path(exe_path).is_file():
        raise HTTPException(400, "No executable found for this game")

    try:
        engine_bridge.launch_game(exe_path)
    except Exception as e:
        logger.exception("Failed to launch game %s", game_id)
        raise HTTPException(500, f"Failed to launch: {e}")

    # Update last played
    await db.update_game(game_id, last_played_at=datetime.now(timezone.utc).isoformat())

    return {"ok": True, "exe_path": exe_path}


@router.get("/{game_id}/structure")
async def get_game_structure(game_id: int):
    """Return node/edge graph for the game's translation structure."""
    game = await db.get_game(game_id)
    if not game:
        raise HTTPException(404, "Game not found")

    project_row = await db.get_project(game_id)
    if not project_row:
        return {"nodes": [], "edges": []}

    try:
        entries: list[dict] = json.loads(project_row["project_json"])
    except (json.JSONDecodeError, TypeError):
        return {"nodes": [], "edges": []}

    engine = game.get("engine") or ""
    result = structure_parser.parse_game_structure(entries, engine)
    return result


@router.get("/{game_id}/serve/{file_path:path}")
async def serve_game_file(game_id: int, file_path: str):
    """Serve static files from a game folder (for HTML games)."""
    game = await db.get_game(game_id)
    if not game:
        raise HTTPException(404, "Game not found")

    game_dir = Path(game["path"]).resolve()
    requested = (game_dir / file_path).resolve()

    # Path traversal protection (symlink-safe)
    try:
        if not requested.is_relative_to(game_dir):
            raise HTTPException(403, "Access denied")
    except (TypeError, ValueError):
        raise HTTPException(403, "Access denied")

    if not requested.is_file():
        raise HTTPException(404, "File not found")

    # Extension whitelist (#27) — only serve web-safe file types
    ext = requested.suffix.lower()
    if ext not in _SERVE_ALLOWED_EXTENSIONS:
        raise HTTPException(403, f"File type not allowed: {ext}")

    media_type, _ = mimetypes.guess_type(str(requested))
    return FileResponse(str(requested), media_type=media_type or "application/octet-stream")
