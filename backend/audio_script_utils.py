"""Shared utilities for extracting translatable blocks from audio scripts.

The critical invariant is that the returned list index MUST match the cue index
produced by the frontend parser (lib/script-parser.ts). Otherwise translations
line up on the wrong cue.

Supported formats:
  - SRT  (block-based, multi-line body joined with "\n")
  - WEBVTT (same block structure as SRT, optional short timestamps MM:SS.mmm)
  - LRC  ("[mm:ss.xx]text" per line; multiple stamps on one line → N blocks)
  - plain text (one line per block)
"""

from __future__ import annotations

import re


# Timestamp / header lines we must strip when walking a block body.
# Handles both SRT (HH:MM:SS,mmm) and short VTT (MM:SS.mmm).
_TS_LINE_RE = re.compile(
    r"^\d+$|"                                              # SRT index
    r"^\d{2}:\d{2}:\d{2}[.,]\d{3}\s*-->|"                  # SRT/long VTT
    r"^\d{2}:\d{2}[.,]\d{3}\s*-->|"                        # short VTT
    r"^WEBVTT|^NOTE(\s|$)|^Kind:|^Language:|^STYLE$|^REGION$"
)

_LRC_META_RE = re.compile(r"^\[(ar|ti|al|by|offset|length|re|ve|au|la):", re.IGNORECASE)
_LRC_STAMP_RE = re.compile(r"\[(\d+):(\d+)(?:[.:](\d+))?\]")


def _is_srt_or_vtt(text: str) -> bool:
    head = text.lstrip()
    if head.startswith("WEBVTT"):
        return True
    # First non-empty block contains "-->"?
    first_block = re.split(r"\n\s*\n", head, maxsplit=1)[0]
    return "-->" in first_block


def _is_lrc(text: str) -> bool:
    # Any line starting with [mm:ss...]
    for line in text.splitlines():
        stripped = line.lstrip()
        if not stripped:
            continue
        if _LRC_META_RE.match(stripped):
            continue
        if re.match(r"^\[\d+:\d+", stripped):
            return True
        # Give up after first non-meta line
        return False
    return False


def _extract_srt_vtt_blocks(text: str) -> list[str]:
    """Block-based extraction matching frontend parseSRT / parseVTT.

    Each cue's body lines are joined with "\n" so that the index matches
    the frontend's cue array exactly.
    """
    content = text.replace("\r\n", "\n").strip()
    blocks = re.split(r"\n\s*\n+", content)
    out: list[str] = []
    for block in blocks:
        lines = [ln for ln in block.split("\n")]
        # Skip a leading WEBVTT/NOTE/STYLE/REGION header block
        if lines and (
            lines[0].strip().startswith("WEBVTT")
            or lines[0].strip().startswith("NOTE")
            or lines[0].strip() in ("STYLE", "REGION")
        ):
            continue
        # Locate the "-->" line
        ts_idx = next((i for i, ln in enumerate(lines) if "-->" in ln), -1)
        if ts_idx < 0:
            continue
        body_lines = [ln for ln in lines[ts_idx + 1 :]]
        # Strip trailing empties
        while body_lines and not body_lines[-1].strip():
            body_lines.pop()
        body = "\n".join(body_lines).strip()
        if body:
            out.append(body)
    return out


def _extract_lrc_blocks(text: str) -> list[str]:
    """LRC extraction: one entry per timestamp (matches parseLRC)."""
    content = text.replace("\r\n", "\n")
    entries: list[tuple[float, str]] = []
    for line in content.split("\n"):
        stripped = line.strip()
        if not stripped:
            continue
        if _LRC_META_RE.match(stripped):
            continue
        stamps: list[float] = []
        cursor = 0
        while True:
            m = _LRC_STAMP_RE.match(stripped, cursor)
            if not m:
                break
            mm = int(m.group(1))
            ss = int(m.group(2))
            frac_s = m.group(3) or ""
            frac = int(frac_s) if frac_s else 0
            frac_ms = frac if len(frac_s) >= 3 else frac * 10
            stamps.append(mm * 60 + ss + frac_ms / 1000)
            cursor = m.end()
        if not stamps:
            continue
        body = stripped[cursor:].strip()
        if not body:
            continue
        for start in stamps:
            entries.append((start, body))
    entries.sort(key=lambda x: x[0])
    return [body for _, body in entries]


def _extract_plain_blocks(text: str) -> list[str]:
    out: list[str] = []
    for line in text.replace("\r\n", "\n").split("\n"):
        stripped = line.strip()
        if not stripped:
            continue
        out.append(stripped)
    return out


def extract_translatable_blocks(script_text: str) -> list[str]:
    """Return a list where index matches the frontend cue index.

    Handles SRT, WEBVTT, LRC, and plain text.
    """
    if not script_text or not script_text.strip():
        return []
    if _is_srt_or_vtt(script_text):
        blocks = _extract_srt_vtt_blocks(script_text)
        if blocks:
            return blocks
    if _is_lrc(script_text):
        blocks = _extract_lrc_blocks(script_text)
        if blocks:
            return blocks
    return _extract_plain_blocks(script_text)
