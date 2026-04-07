"""Subtitle format parsing and generation (SRT, VTT, ASS)."""

import re
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class Segment:
    seq: int
    start_time: float
    end_time: float
    original_text: str = ""
    translated_text: str = ""
    confidence: float = 0.0
    pos_x: Optional[float] = None
    pos_y: Optional[float] = None


def _format_time_srt(seconds: float) -> str:
    """Format seconds to SRT timestamp: 00:01:23,456"""
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    ms = int(round((seconds % 1) * 1000))
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def _format_time_vtt(seconds: float) -> str:
    """Format seconds to VTT timestamp: 00:01:23.456"""
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    ms = int(round((seconds % 1) * 1000))
    return f"{h:02d}:{m:02d}:{s:02d}.{ms:03d}"


def _format_time_ass(seconds: float) -> str:
    """Format seconds to ASS timestamp: 0:01:23.46"""
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    cs = int(round((seconds % 1) * 100))
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def _parse_time_srt(ts: str) -> float:
    """Parse SRT timestamp: 00:01:23,456"""
    m = re.match(r"(\d+):(\d+):(\d+)[,.](\d+)", ts.strip())
    if not m:
        return 0.0
    return int(m[1]) * 3600 + int(m[2]) * 60 + int(m[3]) + int(m[4]) / 1000


def _parse_time_vtt(ts: str) -> float:
    """Parse VTT timestamp: 00:01:23.456 or 01:23.456"""
    parts = re.split(r"[:.]+", ts.strip())
    if len(parts) == 4:
        return int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2]) + int(parts[3]) / 1000
    if len(parts) == 3:
        return int(parts[0]) * 60 + int(parts[1]) + int(parts[2]) / 1000
    return 0.0


def _parse_time_ass(ts: str) -> float:
    """Parse ASS timestamp: 0:01:23.46"""
    m = re.match(r"(\d+):(\d+):(\d+)\.(\d+)", ts.strip())
    if not m:
        return 0.0
    return int(m[1]) * 3600 + int(m[2]) * 60 + int(m[3]) + int(m[4]) / 100


# --- Generators ---

def segments_to_srt(segments: list[Segment], use_translated: bool = False) -> str:
    """Generate SRT string from segments."""
    lines = []
    for i, seg in enumerate(segments):
        text = seg.translated_text if (use_translated and seg.translated_text) else seg.original_text
        if not text:
            continue
        lines.append(str(i + 1))
        lines.append(f"{_format_time_srt(seg.start_time)} --> {_format_time_srt(seg.end_time)}")
        lines.append(text)
        lines.append("")
    return "\n".join(lines)


def segments_to_vtt(segments: list[Segment], use_translated: bool = False) -> str:
    """Generate WebVTT string from segments."""
    lines = ["WEBVTT", ""]
    for i, seg in enumerate(segments):
        text = seg.translated_text if (use_translated and seg.translated_text) else seg.original_text
        if not text:
            continue
        lines.append(str(i + 1))
        lines.append(f"{_format_time_vtt(seg.start_time)} --> {_format_time_vtt(seg.end_time)}")
        lines.append(text)
        lines.append("")
    return "\n".join(lines)


def segments_to_ass(
    segments: list[Segment],
    use_translated: bool = False,
    title: str = "Untitled",
    font_name: str = "Arial",
    font_size: int = 20,
    primary_color: str = "&H00FFFFFF",
    outline_color: str = "&H00000000",
    outline_width: int = 2,
    alignment: int = 2,
    margin_v: int = 30,
    back_color: str = "&H80000000",
    bold: int = -1,
    shadow: int = 0,
) -> str:
    """Generate ASS string from segments.

    alignment: ASS numpad alignment (1-9). Default 2 = bottom-center.
               8 = top-center, 5 = middle-center.
    margin_v: vertical margin in pixels (from alignment edge).
    """
    header = f"""[Script Info]
Title: {title}
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,{font_name},{font_size},{primary_color},&H000000FF,{outline_color},{back_color},{bold},0,0,0,100,100,0,0,1,{outline_width},{shadow},{alignment},10,10,{margin_v},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text"""

    lines = [header]
    for seg in segments:
        text = seg.translated_text if (use_translated and seg.translated_text) else seg.original_text
        if not text:
            continue
        # ASS uses \N for newlines
        ass_text = text.replace("\n", "\\N")
        start = _format_time_ass(seg.start_time)
        end = _format_time_ass(seg.end_time)
        # Per-segment position override (PlayResX=1920, PlayResY=1080)
        # \an5 sets anchor to center so \pos coordinates match the drag point
        if seg.pos_x is not None and seg.pos_y is not None:
            px = round(seg.pos_x * 1920)
            py = round(seg.pos_y * 1080)
            ass_text = f"{{\\an5\\pos({px},{py})}}{ass_text}"
        lines.append(f"Dialogue: 0,{start},{end},Default,,0,0,0,,{ass_text}")

    return "\n".join(lines)


# --- Parsers ---

def parse_srt_to_segments(content: str) -> list[Segment]:
    """Parse SRT content into segments."""
    segments = []
    content = content.strip().replace("\r\n", "\n")
    blocks = re.split(r"\n\n+", content)
    for block in blocks:
        lines = block.strip().split("\n")
        if len(lines) < 3:
            continue
        time_match = re.match(r"(.+?)\s*-->\s*(.+)", lines[1])
        if not time_match:
            continue
        start = _parse_time_srt(time_match[1])
        end = _parse_time_srt(time_match[2])
        text = "\n".join(lines[2:]).strip()
        if text:
            segments.append(Segment(
                seq=len(segments),
                start_time=start,
                end_time=end,
                original_text=text,
            ))
    return segments


def parse_vtt_to_segments(content: str) -> list[Segment]:
    """Parse WebVTT content into segments."""
    segments = []
    content = content.strip().replace("\r\n", "\n")
    blocks = re.split(r"\n\n+", content)
    for block in blocks:
        lines = block.strip().split("\n")
        time_idx = -1
        for i, line in enumerate(lines):
            if "-->" in line:
                time_idx = i
                break
        if time_idx < 0:
            continue
        time_match = re.match(r"(.+?)\s*-->\s*(.+)", lines[time_idx])
        if not time_match:
            continue
        start = _parse_time_vtt(time_match[1])
        end = _parse_time_vtt(time_match[2])
        text = "\n".join(lines[time_idx + 1:]).strip()
        if text:
            segments.append(Segment(
                seq=len(segments),
                start_time=start,
                end_time=end,
                original_text=text,
            ))
    return segments


def parse_ass_to_segments(content: str) -> list[Segment]:
    """Parse ASS/SSA Dialogue lines into segments."""
    segments = []
    for line in content.split("\n"):
        line = line.strip()
        if not line.startswith("Dialogue:"):
            continue
        # Dialogue: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text
        parts = line.split(",", 9)
        if len(parts) < 10:
            continue
        start = _parse_time_ass(parts[1])
        end = _parse_time_ass(parts[2])
        text = parts[9].replace("\\N", "\n").replace("\\n", "\n").strip()
        # Remove ASS formatting tags
        text = re.sub(r"\{[^}]*\}", "", text)
        if text:
            segments.append(Segment(
                seq=len(segments),
                start_time=start,
                end_time=end,
                original_text=text,
            ))
    return segments


def detect_and_parse(content: str) -> tuple[str, list[Segment]]:
    """Auto-detect format and parse. Returns (format_name, segments)."""
    trimmed = content.strip()
    if trimmed.startswith("WEBVTT"):
        return "vtt", parse_vtt_to_segments(trimmed)
    if "[Script Info]" in trimmed or "Dialogue:" in trimmed:
        return "ass", parse_ass_to_segments(trimmed)
    # Default: try SRT
    if "-->" in trimmed:
        return "srt", parse_srt_to_segments(trimmed)
    return "unknown", []
