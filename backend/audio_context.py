"""Audio context analysis — derive scene markers from Whisper segment timing+confidence."""

from dataclasses import dataclass


@dataclass
class SegmentContext:
    """Context metadata for a single subtitle segment."""
    gap_before: float       # gap from previous segment (seconds)
    gap_after: float        # gap to next segment (seconds)
    duration: float         # segment duration (seconds)
    confidence: float       # STT confidence (0~1)
    marker: str             # e.g. "[장면 전환]", "[빠른 대화]", "" (empty = normal)


def analyze_segments(segments: list[dict]) -> list[SegmentContext]:
    """Analyze segment timing+confidence to produce context markers.

    Each segment dict must have: start_time, end_time, confidence (optional).
    Returns a list of SegmentContext parallel to input segments.
    """
    if not segments:
        return []

    results: list[SegmentContext] = []

    for i, seg in enumerate(segments):
        start = seg["start_time"]
        end = seg["end_time"]
        duration = end - start
        confidence = seg.get("confidence", 1.0) or 1.0

        # Calculate gaps
        if i > 0:
            gap_before = start - segments[i - 1]["end_time"]
        else:
            gap_before = start  # gap from beginning

        if i < len(segments) - 1:
            gap_after = segments[i + 1]["start_time"] - end
        else:
            gap_after = 0.0

        # Determine marker
        marker = _determine_marker(gap_before, gap_after, duration, confidence)

        results.append(SegmentContext(
            gap_before=gap_before,
            gap_after=gap_after,
            duration=duration,
            confidence=confidence,
            marker=marker,
        ))

    return results


def _determine_marker(gap_before: float, gap_after: float,
                      duration: float, confidence: float) -> str:
    """Determine the context marker based on timing+confidence heuristics."""
    # Low confidence — unclear audio
    if confidence < 0.5:
        return "[불분명]"

    # Isolated utterance — large gaps on both sides (monologue/narration)
    if gap_before > 5.0 and gap_after > 5.0:
        return "[독립 발화]"

    # Scene change — large gap before
    if gap_before > 3.0:
        return "[장면 전환]"

    # Rapid dialogue — short segment + tiny gap
    if duration < 1.0 and gap_before < 0.3:
        return "[빠른 대화]"

    return ""


def format_timestamp(seconds: float) -> str:
    """Format seconds to H:MM:SS for batch prompt display."""
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    return f"{h}:{m:02d}:{s:02d}"
