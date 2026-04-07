"""Translation memory endpoints."""

import json
from fastapi import APIRouter, HTTPException

from .. import db

router = APIRouter(prefix="/api/translation-memory", tags=["translation-memory"])


@router.get("")
async def search_tm(search: str = "", source_lang: str = "", limit: int = 50):
    return await db.tm_search(search=search, source_lang=source_lang, limit=limit)


@router.get("/stats")
async def tm_stats():
    return await db.tm_stats()


@router.post("/import/{game_id}")
async def import_from_game(game_id: int):
    """Import completed translations from a game project into TM."""
    project = await db.get_project(game_id)
    if not project:
        raise HTTPException(404, "No translation project found")

    game = await db.get_game(game_id)
    if not game:
        raise HTTPException(404, "Game not found")

    try:
        entries = json.loads(project["project_json"])
    except (json.JSONDecodeError, TypeError):
        raise HTTPException(400, "Invalid project data")

    tm_entries = []
    for e in entries:
        if e.get("status") in ("translated", "reviewed") and e.get("translated"):
            tm_entries.append({
                "source_text": e["original"],
                "translated_text": e["translated"],
                "source_lang": game.get("source_lang", "auto"),
                "target_lang": "ko",
                "provider": project.get("provider", ""),
                "model": project.get("model", ""),
                "context_tag": e.get("tag", ""),
                "game_id": game_id,
            })

    count = await db.tm_insert_batch(tm_entries)
    return {"imported": count, "total_entries": len(tm_entries)}


@router.delete("/{entry_id}")
async def delete_tm_entry(entry_id: int):
    deleted = await db.tm_delete(entry_id)
    if not deleted:
        raise HTTPException(404, "Entry not found")
    return {"ok": True}


@router.post("/clear")
async def clear_tm():
    count = await db.tm_clear()
    return {"deleted": count}
