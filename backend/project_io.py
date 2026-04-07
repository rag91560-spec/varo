"""Project import/export utilities for collaboration workflows."""

import json
import csv
import io
from datetime import datetime, timezone


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def export_project_json(game: dict, entries: list[dict], preset: dict = None) -> dict:
    """Export game metadata + all entries as a JSON structure."""
    return {
        "game": {
            "title": game.get("title", ""),
            "engine": game.get("engine", ""),
            "source_lang": game.get("source_lang", "auto"),
        },
        "entries": entries,
        "preset": preset,
        "exported_at": _now(),
    }


def export_project_csv(entries: list[dict]) -> str:
    """Export entries as CSV (original, translated, status, namespace, tag, review_status, reviewer_note)."""
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["original", "translated", "status", "namespace", "tag", "review_status", "reviewer_note"])
    for entry in entries:
        writer.writerow([
            entry.get("original", ""),
            entry.get("translated", ""),
            entry.get("status", ""),
            entry.get("namespace", ""),
            entry.get("tag", ""),
            entry.get("review_status", ""),
            entry.get("reviewer_note", ""),
        ])
    return output.getvalue()


def import_project_json(existing_entries: list[dict], import_data: dict, mode: str = "merge") -> dict:
    """Import from JSON.

    mode='merge': Match by original text, update translation only. Ignore new entries.
    mode='replace': Replace all entries entirely.

    Returns: {entries: list, matched: int, updated: int}
    """
    incoming_entries = import_data.get("entries", [])

    if mode == "replace":
        # Validate incoming entries have required fields
        if not isinstance(incoming_entries, list):
            incoming_entries = []
        validated = []
        for entry in incoming_entries:
            if not isinstance(entry, dict) or not entry.get("original"):
                continue
            validated.append(entry)
        if not validated and existing_entries:
            raise ValueError("Replace mode: no valid entries found in import data")
        return {
            "entries": validated,
            "matched": len(validated),
            "updated": len(validated),
        }

    # mode == "merge"
    # Build index from original text -> index in existing_entries
    original_index: dict[str, int] = {}
    for i, entry in enumerate(existing_entries):
        original_text = entry.get("original", "")
        if original_text:
            original_index[original_text] = i

    updated_entries = [dict(e) for e in existing_entries]
    matched = 0
    updated = 0

    for incoming in incoming_entries:
        original_text = incoming.get("original", "")
        if not original_text:
            continue
        if original_text in original_index:
            matched += 1
            idx = original_index[original_text]
            existing = updated_entries[idx]
            changed = False
            # Update translation-related fields only
            for field in ("translated", "status", "review_status", "reviewer_note"):
                if field in incoming and incoming[field] != existing.get(field):
                    existing[field] = incoming[field]
                    changed = True
            if changed:
                updated += 1

    return {
        "entries": updated_entries,
        "matched": matched,
        "updated": updated,
    }


def import_project_csv(existing_entries: list[dict], csv_content: str, mode: str = "merge") -> dict:
    """Import from CSV. Match by original text, update translation fields.

    Returns: {entries: list, matched: int, updated: int}
    """
    reader = csv.DictReader(io.StringIO(csv_content))
    incoming_entries = []
    for row in reader:
        incoming_entries.append({
            "original": row.get("original", ""),
            "translated": row.get("translated", ""),
            "status": row.get("status", ""),
            "namespace": row.get("namespace", ""),
            "tag": row.get("tag", ""),
            "review_status": row.get("review_status", ""),
            "reviewer_note": row.get("reviewer_note", ""),
        })

    return import_project_json(
        existing_entries=existing_entries,
        import_data={"entries": incoming_entries},
        mode=mode,
    )
