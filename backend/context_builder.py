"""Context builder for translation chunks.

Collects surrounding translated entries as reference context for each
item in a chunk, scoped to the same namespace.
"""

from typing import Optional


def build_context_for_chunk(
    entries: list[dict],
    chunk_indices: list[int],
    window: int = 5,
) -> dict[int, str]:
    """Build context strings for each index in a chunk.

    For each entry in chunk_indices, collect up to `window` translated
    entries before and after it that share the same namespace.
    Returns a mapping of {chunk_index: context_string}.

    Args:
        entries: Full list of TranslationEntry dicts (all entries in project).
        chunk_indices: Indices within `entries` that form the current chunk.
        window: Number of surrounding translated entries to include per side.

    Returns:
        Dict mapping each chunk index to a formatted context string.
        Value is empty string if no context is available.
    """
    chunk_set = set(chunk_indices)
    result: dict[int, str] = {}

    for idx in chunk_indices:
        entry = entries[idx]
        namespace = entry.get("namespace", "")

        # Collect translated neighbors in the same namespace
        before: list[tuple[str, str]] = []
        after: list[tuple[str, str]] = []

        # Walk backwards
        i = idx - 1
        while i >= 0 and len(before) < window:
            e = entries[i]
            if e.get("namespace", "") == namespace:
                if e.get("status") in ("translated", "reviewed") and e.get("translated"):
                    before.append((e["original"], e["translated"]))
            i -= 1
        before.reverse()

        # Walk forwards (skip entries already in the chunk)
        i = idx + 1
        while i < len(entries) and len(after) < window:
            e = entries[i]
            if i not in chunk_set and e.get("namespace", "") == namespace:
                if e.get("status") in ("translated", "reviewed") and e.get("translated"):
                    after.append((e["original"], e["translated"]))
            i += 1

        context_pairs = before + after
        if not context_pairs:
            result[idx] = ""
            continue

        lines = ["Reference translations:"]
        for orig, tran in context_pairs:
            orig_short = orig[:80].replace("\n", " ")
            tran_short = tran[:80].replace("\n", " ")
            lines.append(f"{orig_short} → {tran_short}")

        result[idx] = "\n".join(lines)

    return result


def get_context_string(
    entries: list[dict],
    index: int,
    window: int = 5,
    namespace: Optional[str] = None,
) -> str:
    """Convenience wrapper for a single entry.

    Args:
        entries: Full list of entry dicts.
        index: Target entry index.
        window: Context window size.
        namespace: Override namespace filter. Uses entry's own namespace if None.

    Returns:
        Formatted context string, or empty string.
    """
    result = build_context_for_chunk(entries, [index], window=window)
    return result.get(index, "")
