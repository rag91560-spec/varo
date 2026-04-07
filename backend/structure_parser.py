"""Parse game script entries into nodes/edges for flow graph visualization."""

from __future__ import annotations

import re
from collections import defaultdict
from typing import Any


# Branch/choice keywords that indicate a decision node
_BRANCH_KEYWORDS = re.compile(
    r"branch|choice|menu|select|condition|if|fork|jump|glink|route|end",
    re.IGNORECASE,
)

# Common/shared section keywords
_COMMON_KEYWORDS = re.compile(
    r"common|shared|system|global|ui|message|misc|other",
    re.IGNORECASE,
)


def _node_type(namespace: str) -> str:
    """Determine node type based on namespace name."""
    if _BRANCH_KEYWORDS.search(namespace):
        return "branch"
    if _COMMON_KEYWORDS.search(namespace):
        return "common"
    return "section"


def parse_game_structure(entries: list[dict], engine: str) -> dict:
    """Convert translation entries into a node/edge graph.

    Args:
        entries: List of translation entries. Each entry has at least:
                 {original, translated, status, namespace, tag, ...}
        engine:  Engine name (e.g. "rpgmaker", "renpy", "tyranoscript")

    Returns:
        {
            nodes: [{id, label, total, translated, errors, type}],
            edges: [{source, target, label?}]
        }
    """
    if not entries:
        return {"nodes": [], "edges": []}

    engine_lower = (engine or "").lower().replace(" ", "").replace("_", "").replace("/", "")

    # Group entries by namespace
    grouped: dict[str, list[dict]] = defaultdict(list)
    for entry in entries:
        ns = entry.get("namespace") or entry.get("tag") or "Unknown"
        grouped[ns].append(entry)

    # Build nodes in insertion order (preserves script order)
    nodes: list[dict[str, Any]] = []
    ns_order = list(grouped.keys())

    for ns in ns_order:
        ns_entries = grouped[ns]
        total = len(ns_entries)
        translated = sum(
            1 for e in ns_entries
            if e.get("status") in ("translated", "reviewed", "applied")
            or (e.get("translated") and e["translated"].strip())
        )
        errors = sum(
            1 for e in ns_entries
            if e.get("qa_error") or e.get("has_error")
        )

        nodes.append({
            "id": ns,
            "label": ns,
            "total": total,
            "translated": translated,
            "errors": errors,
            "type": _node_type(ns),
        })

    # Build edges based on engine-specific rules
    edges = _build_edges(ns_order, grouped, engine_lower)

    return {"nodes": nodes, "edges": edges}


def _build_edges(
    ns_order: list[str],
    grouped: dict[str, list[dict]],
    engine_lower: str,
) -> list[dict]:
    """Build edge list from namespace order and engine heuristics."""
    edges: list[dict] = []
    seen: set[tuple[str, str]] = set()

    def add_edge(src: str, dst: str, label: str | None = None) -> None:
        key = (src, dst)
        if key not in seen:
            seen.add(key)
            edge: dict = {"source": src, "target": dst}
            if label:
                edge["label"] = label
            edges.append(edge)

    # Engine-specific branching detection
    if "rpgmaker" in engine_lower or "rpg" in engine_lower:
        _build_rpgmaker_edges(ns_order, grouped, add_edge)
    elif "renpy" in engine_lower or "ren'py" in engine_lower:
        _build_renpy_edges(ns_order, grouped, add_edge)
    elif "tyrano" in engine_lower:
        _build_tyrano_edges(ns_order, grouped, add_edge)
    else:
        # Default: sequential connections
        _build_sequential_edges(ns_order, add_edge)

    return edges


def _build_sequential_edges(ns_order: list[str], add_edge) -> None:
    """Connect namespaces sequentially (linear story flow)."""
    for i in range(len(ns_order) - 1):
        add_edge(ns_order[i], ns_order[i + 1])


def _build_rpgmaker_edges(
    ns_order: list[str],
    grouped: dict[str, list[dict]],
    add_edge,
) -> None:
    """RPGMaker: namespace groups connected sequentially.
    ConditionalBranch entries (tag=108) create branch edges."""
    for i, ns in enumerate(ns_order):
        # Sequential connection to next namespace
        if i < len(ns_order) - 1:
            add_edge(ns, ns_order[i + 1])

        # Check entries for conditional branch tags
        for entry in grouped[ns]:
            tag = str(entry.get("tag", ""))
            # Tag 108 = ConditionalBranch in RPGMaker MV/MZ
            if tag == "108" or "conditionalbranch" in tag.lower():
                # Look for a nearby branch target namespace
                for j in range(i + 1, min(i + 5, len(ns_order))):
                    candidate = ns_order[j]
                    if _BRANCH_KEYWORDS.search(candidate):
                        add_edge(ns, candidate, label="branch")
                        break


def _build_renpy_edges(
    ns_order: list[str],
    grouped: dict[str, list[dict]],
    add_edge,
) -> None:
    """Ren'Py: label: namespaces connected, menu tags create branches."""
    for i, ns in enumerate(ns_order):
        if i < len(ns_order) - 1:
            add_edge(ns, ns_order[i + 1])

        # menu tags indicate player choices → branch out
        for entry in grouped[ns]:
            tag = str(entry.get("tag", "")).lower()
            if "menu" in tag or "choice" in tag:
                # Connect to next few namespaces as branch targets
                for j in range(i + 1, min(i + 4, len(ns_order))):
                    target = ns_order[j]
                    if "label" in target.lower() or _BRANCH_KEYWORDS.search(target):
                        add_edge(ns, target, label="choice")


def _build_tyrano_edges(
    ns_order: list[str],
    grouped: dict[str, list[dict]],
    add_edge,
) -> None:
    """TyranoScript: *label namespaces, @jump/@glink patterns create branches."""
    for i, ns in enumerate(ns_order):
        if i < len(ns_order) - 1:
            add_edge(ns, ns_order[i + 1])

        for entry in grouped[ns]:
            original = (entry.get("original") or "").lower()
            tag = str(entry.get("tag", "")).lower()
            # @jump or @glink commands indicate branching
            if "@jump" in original or "@glink" in tag or "jump" in tag:
                for j in range(i + 1, min(i + 5, len(ns_order))):
                    target = ns_order[j]
                    if target.startswith("*") or _BRANCH_KEYWORDS.search(target):
                        add_edge(ns, target, label="jump")
                        break
