"""Glossary analysis and suggestion endpoints."""

import asyncio
import json
from fastapi import APIRouter, HTTPException

from .. import db
from .. import glossary_analyzer

router = APIRouter(prefix="/api/glossary", tags=["glossary"])


@router.get("/analyze/{game_id}")
async def analyze_glossary(game_id: int):
    """Analyze term frequency and extract proper nouns from game strings."""
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

    freq_terms = await asyncio.to_thread(glossary_analyzer.analyze_term_frequency, entries)
    proper_nouns = await asyncio.to_thread(glossary_analyzer.extract_proper_nouns, entries)
    merged = glossary_analyzer.merge_and_rank(freq_terms, proper_nouns, top_n=200)

    return {"terms": merged}


@router.get("/suggest/{game_id}")
async def suggest_glossary(game_id: int):
    """Suggest glossary entries from Translation Memory patterns."""
    game = await db.get_game(game_id)
    if not game:
        raise HTTPException(404, "Game not found")

    # Pull TM entries related to this game
    source_lang = game.get("source_lang", "auto")
    tm_entries = await db.tm_search(source_lang=source_lang, limit=500)

    suggestions = glossary_analyzer.suggest_from_tm(tm_entries)

    return {"suggestions": suggestions}
