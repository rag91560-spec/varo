"""Export/Import endpoints for translation project collaboration."""

import json
import re
from urllib.parse import quote
from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from fastapi.responses import Response, StreamingResponse

from .. import db
from .. import project_io

router = APIRouter(prefix="/api/games/{game_id}/project", tags=["export_import"])

MAX_UPLOAD_SIZE = 100 * 1024 * 1024  # 100 MB


async def _get_game_and_entries(game_id: int) -> tuple[dict, list[dict]]:
    """Shared helper: fetch game + parsed entries. Raises 404/400 as needed."""
    game = await db.get_game(game_id)
    if not game:
        raise HTTPException(404, "Game not found")

    project_row = await db.get_project(game_id)
    if not project_row:
        raise HTTPException(400, "No translation project found")

    try:
        entries = json.loads(project_row["project_json"])
    except (json.JSONDecodeError, TypeError):
        raise HTTPException(400, "Invalid project data")

    if not isinstance(entries, list):
        entries = []

    return game, entries


# ── Export ──

@router.get("/export")
async def export_json(game_id: int):
    """Export translation project as JSON."""
    game, entries = await _get_game_and_entries(game_id)

    # Optionally attach preset info
    preset = None
    if game.get("preset_id"):
        preset_row = await db.get_preset(game["preset_id"])
        if preset_row:
            preset = {
                "name": preset_row.get("name", ""),
                "provider": preset_row.get("provider", ""),
                "model": preset_row.get("model", ""),
                "tone": preset_row.get("tone", ""),
            }

    payload = project_io.export_project_json(game, entries, preset)
    safe_title = re.sub(r'[^\w\-.]', '_', game.get("title") or "project")
    filename = f"{safe_title}_export.json"

    return Response(
        content=json.dumps(payload, ensure_ascii=False, indent=2),
        media_type="application/json",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}"},
    )


@router.get("/export/csv")
async def export_csv(game_id: int):
    """Export translation project entries as CSV."""
    game, entries = await _get_game_and_entries(game_id)

    csv_content = project_io.export_project_csv(entries)
    safe_title = re.sub(r'[^\w\-.]', '_', game.get("title") or "project")
    filename = f"{safe_title}_export.csv"

    return StreamingResponse(
        iter([csv_content.encode("utf-8-sig")]),  # utf-8-sig for Excel compatibility
        media_type="text/csv; charset=utf-8-sig",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}"},
    )


# ── Import ──

@router.post("/import")
async def import_json(
    game_id: int,
    file: UploadFile = File(...),
    mode: str = Form("merge"),
):
    """Import translation project from JSON file.

    mode: 'merge' (update matching by original text) | 'replace' (overwrite all)
    """
    if mode not in ("merge", "replace"):
        raise HTTPException(400, "mode must be 'merge' or 'replace'")

    game, existing_entries = await _get_game_and_entries(game_id)

    raw = await file.read(MAX_UPLOAD_SIZE + 1)
    if len(raw) > MAX_UPLOAD_SIZE:
        raise HTTPException(413, "File too large (max 100 MB)")
    try:
        import_data = json.loads(raw)
    except (json.JSONDecodeError, ValueError):
        raise HTTPException(400, "Invalid JSON file")

    try:
        result = project_io.import_project_json(existing_entries, import_data, mode=mode)
    except ValueError as e:
        raise HTTPException(400, str(e))

    updated_entries = result["entries"]
    await db.save_project(game_id, json.dumps(updated_entries, ensure_ascii=False))

    # Update translated_count in games table
    translated_count = sum(
        1 for e in updated_entries
        if e.get("status") in ("translated", "reviewed") and e.get("translated", "").strip()
    )
    await db.update_game(game_id, translated_count=translated_count)

    return {
        "total": len(updated_entries),
        "matched": result["matched"],
        "updated": result["updated"],
        "new_entries": 0,
        "mode": mode,
    }


@router.post("/import/csv")
async def import_csv(
    game_id: int,
    file: UploadFile = File(...),
    mode: str = Form("merge"),
):
    """Import translation project from CSV file.

    mode: 'merge' (update matching by original text) | 'replace' (overwrite all)
    """
    if mode not in ("merge", "replace"):
        raise HTTPException(400, "mode must be 'merge' or 'replace'")

    game, existing_entries = await _get_game_and_entries(game_id)

    raw = await file.read(MAX_UPLOAD_SIZE + 1)
    if len(raw) > MAX_UPLOAD_SIZE:
        raise HTTPException(413, "File too large (max 100 MB)")
    # Try utf-8-sig first (Excel export), fallback to utf-8, then cp932
    csv_content = None
    for encoding in ("utf-8-sig", "utf-8", "cp932"):
        try:
            csv_content = raw.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    if csv_content is None:
        raise HTTPException(400, "Cannot decode CSV file. Supported encodings: UTF-8, CP932 (Shift-JIS)")

    result = project_io.import_project_csv(existing_entries, csv_content, mode=mode)

    updated_entries = result["entries"]
    await db.save_project(game_id, json.dumps(updated_entries, ensure_ascii=False))

    # Update translated_count in games table
    translated_count = sum(
        1 for e in updated_entries
        if e.get("status") in ("translated", "reviewed") and e.get("translated", "").strip()
    )
    await db.update_game(game_id, translated_count=translated_count)

    return {
        "total": len(updated_entries),
        "matched": result["matched"],
        "updated": result["updated"],
        "new_entries": 0,
        "mode": mode,
    }
