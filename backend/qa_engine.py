"""QA engine for translation quality checks. Pure Python, no DB dependency."""

import re
from collections import Counter
from datetime import datetime, timezone


# --- Placeholder patterns per engine ---

_COMMON_PLACEHOLDERS = [
    r"\{[^}]+\}",        # {0}, {name}, {color=red}
    r"%[sd%]",            # %s, %d, %%
    r"%\d*\.?\d*[dfsxo]", # %2d, %3.1f
    r"\\n",               # \n literal
    r"<br\s*/?>",         # <br>, <br/>
    r"<[^>]+>",           # HTML tags
]

_ENGINE_PLACEHOLDERS = {
    "rpgmaker": [
        r"\\[A-Z]\[\d+\]",     # \C[1], \V[2], \N[3], \P[1], \G, \I[n]
        r"\\[><!.$|^]",         # \>, \<, \!, \., \$, \|, \^
        r"\\{|\\}",             # \{, \}
    ],
    "renpy": [
        r"\{[^}]+\}",           # {color=red}, {b}, {/b}, {size=+2}
        r"\[.+?\]",             # [name], [player_name]
    ],
    "kirikiri": [
        r"\[lr?\]",             # [l], [r]
        r"\[p\]",               # [p]
        r"\[.+?\]",             # [ruby text=...]
    ],
    "tyranoscript": [
        r"\[.+?\]",             # [emb exp="..."]
    ],
    "wolf": [
        r"\\[A-Za-z]+\[\d*\]",  # \cself[0], \v[1]
        r"\\[><!.$|^]",
    ],
    "godot": [
        r"\{[^}]+\}",           # {name}, {0}
        r"%[sd]",
    ],
}


def _get_placeholders(text: str, engine: str = "") -> list[str]:
    """Extract placeholders from text using engine-specific + common patterns."""
    patterns = list(_COMMON_PLACEHOLDERS)
    engine_lower = engine.lower() if engine else ""
    for key, extra in _ENGINE_PLACEHOLDERS.items():
        if key in engine_lower:
            patterns.extend(extra)
            break

    found = []
    for pat in patterns:
        found.extend(re.findall(pat, text, re.IGNORECASE))
    return found


def _is_cjk(ch: str) -> bool:
    cp = ord(ch)
    return (
        (0x4E00 <= cp <= 0x9FFF) or     # CJK Unified
        (0x3400 <= cp <= 0x4DBF) or     # CJK Extension A
        (0xAC00 <= cp <= 0xD7AF) or     # Hangul
        (0x3040 <= cp <= 0x30FF) or     # Hiragana + Katakana
        (0xFF00 <= cp <= 0xFFEF)        # Fullwidth
    )


def _visual_length(text: str) -> float:
    """Approximate visual width: CJK chars count as 2, others as 1."""
    return sum(2 if _is_cjk(ch) else 1 for ch in text)


# --- Check functions ---

def check_untranslated(entries: list[dict]) -> list[dict]:
    """Detect entries that should be translated but aren't."""
    issues = []
    for i, entry in enumerate(entries):
        status = entry.get("status", "")
        translated = (entry.get("translated") or "").strip()
        original = (entry.get("original") or "").strip()

        if not original:
            continue

        if status == "translated" and not translated:
            issues.append({
                "entry_index": i,
                "check_type": "untranslated",
                "severity": "error",
                "message": "Status is 'translated' but translation is empty",
                "detail_json": {"original": original[:100]},
            })
        elif status in ("", "pending") and not translated:
            issues.append({
                "entry_index": i,
                "check_type": "untranslated",
                "severity": "warning",
                "message": "Entry is not translated",
                "detail_json": {"original": original[:100]},
            })
    return issues


def check_length_overflow(entries: list[dict], max_ratio: float = 2.0) -> list[dict]:
    """Detect translations that are significantly longer than the original."""
    issues = []
    for i, entry in enumerate(entries):
        original = (entry.get("original") or "").strip()
        translated = (entry.get("translated") or "").strip()
        if not original or not translated:
            continue

        orig_len = _visual_length(original)
        trans_len = _visual_length(translated)

        if orig_len > 0 and trans_len / orig_len > max_ratio:
            issues.append({
                "entry_index": i,
                "check_type": "length_overflow",
                "severity": "warning",
                "message": f"Translation is {trans_len/orig_len:.1f}x longer than original",
                "detail_json": {
                    "original_length": orig_len,
                    "translated_length": trans_len,
                    "ratio": round(trans_len / orig_len, 2),
                },
            })
    return issues


def check_placeholder_mismatch(entries: list[dict], engine: str = "") -> list[dict]:
    """Detect placeholders in original that are missing or altered in translation."""
    issues = []
    for i, entry in enumerate(entries):
        original = (entry.get("original") or "").strip()
        translated = (entry.get("translated") or "").strip()
        if not original or not translated:
            continue

        orig_ph = Counter(_get_placeholders(original, engine))
        trans_ph = Counter(_get_placeholders(translated, engine))

        if orig_ph != trans_ph:
            missing_c = orig_ph - trans_ph
            extra_c = trans_ph - orig_ph
            missing = list(missing_c.elements())
            extra = list(extra_c.elements())

            if missing or extra:
                severity = "error" if missing else "warning"
                parts = []
                if missing:
                    parts.append(f"Missing: {', '.join(missing)}")
                if extra:
                    parts.append(f"Extra: {', '.join(extra)}")

                issues.append({
                    "entry_index": i,
                    "check_type": "placeholder_mismatch",
                    "severity": severity,
                    "message": "; ".join(parts),
                    "detail_json": {
                        "original_placeholders": orig_ph,
                        "translated_placeholders": trans_ph,
                        "missing": missing,
                        "extra": extra,
                    },
                })
    return issues


def check_consistency(entries: list[dict]) -> list[dict]:
    """Detect identical originals with different translations."""
    # Group by original text
    by_original: dict[str, list[tuple[int, str]]] = {}
    for i, entry in enumerate(entries):
        original = (entry.get("original") or "").strip()
        translated = (entry.get("translated") or "").strip()
        if original and translated:
            by_original.setdefault(original, []).append((i, translated))

    issues = []
    for original, pairs in by_original.items():
        translations = set(t for _, t in pairs)
        if len(translations) > 1:
            for idx, trans in pairs:
                issues.append({
                    "entry_index": idx,
                    "check_type": "consistency",
                    "severity": "info",
                    "message": f"Same original has {len(translations)} different translations",
                    "detail_json": {
                        "original": original[:100],
                        "translations": list(translations)[:5],
                    },
                })
    return issues


def run_all_checks(entries: list[dict], engine: str = "") -> list[dict]:
    """Run all QA checks and return sorted results."""
    all_issues = []
    all_issues.extend(check_untranslated(entries))
    all_issues.extend(check_length_overflow(entries))
    all_issues.extend(check_placeholder_mismatch(entries, engine))
    all_issues.extend(check_consistency(entries))

    severity_order = {"error": 0, "warning": 1, "info": 2}
    all_issues.sort(key=lambda x: (severity_order.get(x["severity"], 9), x["entry_index"]))

    return all_issues
