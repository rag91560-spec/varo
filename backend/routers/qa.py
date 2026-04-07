"""QA check endpoints for translation quality assurance."""

import asyncio
import json
from fastapi import APIRouter, HTTPException

from .. import db
from .. import qa_engine

router = APIRouter(prefix="/api/games/{game_id}/qa", tags=["qa"])


@router.post("")
async def run_qa(game_id: int):
    """Run QA checks on a game's translation project."""
    game = await db.get_game(game_id)
    if not game:
        raise HTTPException(404, "Game not found")

    project_row = await db.get_project(game_id)
    if not project_row:
        raise HTTPException(400, "No translation project found")

    try:
        entries = await asyncio.to_thread(json.loads, project_row["project_json"])
    except (json.JSONDecodeError, TypeError):
        raise HTTPException(400, "Invalid project data")

    engine = game.get("engine", "")
    issues = await asyncio.to_thread(qa_engine.run_all_checks, entries, engine)

    # Save to DB
    await db.qa_save_results(game_id, issues)

    # Update game QA counts
    error_count = sum(1 for i in issues if i["severity"] == "error")
    warning_count = sum(1 for i in issues if i["severity"] == "warning")
    await db.update_game(game_id, qa_error_count=error_count, qa_warning_count=warning_count)

    return {
        "total": len(issues),
        "errors": error_count,
        "warnings": warning_count,
        "issues": issues,
    }


@router.get("")
async def get_qa_results(game_id: int):
    """Get stored QA results for a game."""
    game = await db.get_game(game_id)
    if not game:
        raise HTTPException(404, "Game not found")

    results = await db.qa_get_results(game_id)
    return {"issues": results}


@router.get("/summary")
async def get_qa_summary(game_id: int):
    """Get QA summary counts by type and severity."""
    game = await db.get_game(game_id)
    if not game:
        raise HTTPException(404, "Game not found")

    results = await db.qa_get_results(game_id)

    by_type: dict[str, int] = {}
    by_severity: dict[str, int] = {}
    for r in results:
        by_type[r["check_type"]] = by_type.get(r["check_type"], 0) + 1
        by_severity[r["severity"]] = by_severity.get(r["severity"], 0) + 1

    return {
        "total": len(results),
        "unresolved": sum(1 for r in results if not r.get("resolved")),
        "by_type": by_type,
        "by_severity": by_severity,
    }


@router.put("/{qa_id}/resolve")
async def resolve_qa_issue(game_id: int, qa_id: int):
    """Mark a QA issue as resolved."""
    ok = await db.qa_resolve(qa_id)
    if not ok:
        raise HTTPException(404, "QA issue not found")

    # Recalculate counts
    results = await db.qa_get_results(game_id)
    unresolved = [r for r in results if not r.get("resolved")]
    error_count = sum(1 for r in unresolved if r["severity"] == "error")
    warning_count = sum(1 for r in unresolved if r["severity"] == "warning")
    await db.update_game(game_id, qa_error_count=error_count, qa_warning_count=warning_count)

    return {"ok": True}
