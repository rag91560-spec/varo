"""Glossary analysis utilities.

Provides term frequency analysis, TM-based suggestions, and proper noun
extraction from translation project entries.
"""

import re
from collections import Counter
from typing import Optional


# ---------------------------------------------------------------------------
# Tokenization helpers
# ---------------------------------------------------------------------------

# Katakana block (full-width): U+30A0–U+30FF
_RE_KATAKANA = re.compile(r"[ァ-ヶー]{2,}")

# Uppercase Latin runs (e.g. "HP", "EXP", "STATUS")
_RE_UPPER_LATIN = re.compile(r"[A-Z]{2,}")

# Quoted text: 「…」『…』"…" '…'
_RE_QUOTED = re.compile(r'[「『"\'](.*?)[」』"\'"]')

# CJK word splitter: split on whitespace, punctuation, control chars
_RE_SPLIT = re.compile(r'[\s\u3000\u3001\u3002\uff01\uff1f\uff0e\u30fb\u30a1-\u30ff\u0021-\u002f\u003a-\u0040\u005b-\u0060\u007b-\u007e]+')


def _tokenize_cjk(text: str) -> list[str]:
    """Very lightweight CJK tokenizer.

    Splits text on whitespace/punctuation, then returns tokens with
    2+ characters.  Works reasonably for Japanese without MeCab.
    """
    tokens = _RE_SPLIT.split(text)
    return [t for t in tokens if len(t) >= 2]


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def analyze_term_frequency(entries: list[dict]) -> list[dict]:
    """Count token frequency across all original strings.

    Tokens are 2+ character sequences split on whitespace/punctuation.
    Returns list sorted by frequency desc.

    Args:
        entries: List of TranslationEntry dicts with "original" key.

    Returns:
        List of dicts: {source, frequency, source_type="frequency"}
    """
    counter: Counter = Counter()
    for entry in entries:
        original = entry.get("original", "")
        if not original:
            continue
        for token in _tokenize_cjk(original):
            counter[token] += 1

    # Filter: appear at least twice
    results = []
    for token, freq in counter.most_common():
        if freq < 2:
            break
        results.append({
            "source": token,
            "target": "",
            "frequency": freq,
            "source_type": "frequency",
        })
    return results


def suggest_from_tm(tm_entries: list[dict]) -> list[dict]:
    """Suggest glossary terms from Translation Memory patterns.

    Looks for short (1–6 token), high-usage TM entries as candidate terms.

    Args:
        tm_entries: List of TM dicts with source_text, translated_text,
                    usage_count fields.

    Returns:
        List of dicts: {source, target, confidence, count}
        Sorted by usage_count desc.
    """
    suggestions: list[dict] = []
    seen: set[str] = set()

    for entry in sorted(tm_entries, key=lambda e: e.get("usage_count", 0), reverse=True):
        src = (entry.get("source_text") or "").strip()
        tgt = (entry.get("translated_text") or "").strip()
        if not src or not tgt:
            continue
        if src in seen:
            continue

        # Keep only short phrases likely to be terms
        token_count = len(src.split())
        char_count = len(src)
        if token_count > 6 or char_count > 30:
            continue

        usage = entry.get("usage_count", 1)
        # Confidence: clamp usage-based score to [0, 1]
        confidence = min(1.0, usage / 10.0)

        seen.add(src)
        suggestions.append({
            "source": src,
            "target": tgt,
            "confidence": round(confidence, 2),
            "count": usage,
        })

    return suggestions


def extract_proper_nouns(entries: list[dict]) -> list[dict]:
    """Extract likely proper nouns from original strings.

    Detects:
    - Katakana sequences (2+ chars) — Japanese loanwords / names
    - Consecutive uppercase Latin (2+ chars) — acronyms / system terms
    - Quoted content from 「」『』"" '' — character names, item names

    Returns list of dicts: {source, frequency, source_type}
    sorted by frequency desc.  Only includes terms appearing 2+ times.

    Args:
        entries: List of TranslationEntry dicts.
    """
    kata_counter: Counter = Counter()
    upper_counter: Counter = Counter()
    quoted_counter: Counter = Counter()

    for entry in entries:
        original = entry.get("original", "")
        if not original:
            continue

        for m in _RE_KATAKANA.finditer(original):
            token = m.group()
            if len(token) >= 2:
                kata_counter[token] += 1

        for m in _RE_UPPER_LATIN.finditer(original):
            token = m.group()
            upper_counter[token] += 1

        for m in _RE_QUOTED.finditer(original):
            token = m.group(1).strip()
            if len(token) >= 2:
                quoted_counter[token] += 1

    results: list[dict] = []
    seen: set[str] = set()

    def _add(counter: Counter, source_type: str):
        for token, freq in counter.most_common():
            if freq < 2:
                continue
            if token in seen:
                continue
            seen.add(token)
            results.append({
                "source": token,
                "target": "",
                "frequency": freq,
                "source_type": source_type,
            })

    _add(kata_counter, "katakana")
    _add(upper_counter, "uppercase")
    _add(quoted_counter, "quoted")

    results.sort(key=lambda x: x["frequency"], reverse=True)
    return results


def merge_and_rank(
    freq_terms: list[dict],
    proper_nouns: list[dict],
    top_n: Optional[int] = None,
) -> list[dict]:
    """Merge frequency analysis and proper noun extraction, deduplicated.

    Args:
        freq_terms: Output of analyze_term_frequency().
        proper_nouns: Output of extract_proper_nouns().
        top_n: If set, limit to top N results.

    Returns:
        Merged list sorted by frequency desc.
    """
    seen: set[str] = set()
    merged: list[dict] = []

    for item in freq_terms + proper_nouns:
        key = item["source"]
        if key in seen:
            continue
        seen.add(key)
        merged.append(item)

    merged.sort(key=lambda x: x.get("frequency", 0), reverse=True)
    if top_n:
        merged = merged[:top_n]
    return merged
