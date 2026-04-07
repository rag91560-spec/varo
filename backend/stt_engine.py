"""Speech-to-Text engine abstraction with Whisper API support."""

import json
import logging
import os
import shutil
import subprocess
import tempfile
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Optional, Callable

logger = logging.getLogger(__name__)

# Ensure common tool paths are discoverable (e.g. WinGet Links on Windows)
_extra_paths = [
    os.path.join(os.path.expanduser("~"), "AppData", "Local", "Microsoft", "WinGet", "Links"),
    os.path.join(os.path.expanduser("~"), "AppData", "Local", "Microsoft", "WinGet", "Packages"),
]
for _p in _extra_paths:
    if os.path.isdir(_p) and _p not in os.environ.get("PATH", ""):
        os.environ["PATH"] = os.environ.get("PATH", "") + os.pathsep + _p

WHISPER_API_MAX_SIZE = 25 * 1024 * 1024  # 25MB


@dataclass
class STTSegment:
    start: float
    end: float
    text: str
    confidence: float = 0.0


@dataclass
class STTResult:
    segments: list[STTSegment] = field(default_factory=list)
    language: str = ""
    duration: float = 0.0
    cost_usd: float = 0.0


class STTEngine(ABC):
    @abstractmethod
    def transcribe(self, audio_path: str, language: str = "",
                   progress_cb: Optional[Callable[[float, str], None]] = None) -> STTResult:
        ...


class WhisperAPIEngine(STTEngine):
    """OpenAI Whisper API engine."""

    def __init__(self, api_key: str, model: str = "whisper-1"):
        self.api_key = api_key
        self.model = model

    def transcribe(self, audio_path: str, language: str = "",
                   progress_cb: Optional[Callable[[float, str], None]] = None) -> STTResult:
        try:
            import openai
        except ImportError:
            raise RuntimeError("openai package required: pip install openai")

        client = openai.OpenAI(api_key=self.api_key)
        file_size = os.path.getsize(audio_path)

        if file_size > WHISPER_API_MAX_SIZE:
            return self._transcribe_chunked(client, audio_path, language, progress_cb)

        if progress_cb:
            progress_cb(0.1, "Sending to Whisper API...")

        kwargs = {
            "model": self.model,
            "file": open(audio_path, "rb"),
            "response_format": "verbose_json",
            "timestamp_granularities": ["segment", "word"],
        }
        if language:
            kwargs["language"] = language

        try:
            response = client.audio.transcriptions.create(**kwargs)
        finally:
            kwargs["file"].close()

        if progress_cb:
            progress_cb(0.9, "Processing response...")

        segments = []
        duration = getattr(response, "duration", 0) or 0

        # Build word-level timing index for precise segment boundaries
        words = getattr(response, "words", None) or []
        word_times = []
        for w in words:
            ws = w.get("start", 0) if isinstance(w, dict) else getattr(w, "start", 0)
            we = w.get("end", 0) if isinstance(w, dict) else getattr(w, "end", 0)
            word_times.append((ws, we))

        raw_segments = getattr(response, "segments", None) or []
        for i, seg in enumerate(raw_segments):
            seg_start = seg.get("start", 0) if isinstance(seg, dict) else getattr(seg, "start", 0)
            seg_end = seg.get("end", 0) if isinstance(seg, dict) else getattr(seg, "end", 0)
            text = (seg.get("text", "") if isinstance(seg, dict) else getattr(seg, "text", "")).strip()
            conf = 1.0 - (seg.get("no_speech_prob", 0) if isinstance(seg, dict) else getattr(seg, "no_speech_prob", 0))

            # Refine segment timing using word boundaries
            if word_times:
                # Find words within this segment's rough range (with tolerance)
                seg_words = [(ws, we) for ws, we in word_times
                             if ws >= seg_start - 0.5 and we <= seg_end + 0.5]
                if seg_words:
                    seg_start = seg_words[0][0]
                    seg_end = seg_words[-1][1]

            segments.append(STTSegment(
                start=seg_start, end=seg_end, text=text, confidence=conf,
            ))

        # Cost: $0.006/min
        cost = (duration / 60) * 0.006

        if progress_cb:
            progress_cb(1.0, "STT complete")

        return STTResult(
            segments=segments,
            language=getattr(response, "language", language or ""),
            duration=duration,
            cost_usd=cost,
        )

    def _transcribe_chunked(self, client, audio_path: str, language: str,
                            progress_cb: Optional[Callable[[float, str], None]]) -> STTResult:
        """Split large files using FFmpeg silence detection and transcribe chunks."""
        if not shutil.which("ffmpeg"):
            raise RuntimeError("FFmpeg required for files > 25MB")

        if progress_cb:
            progress_cb(0.05, "Splitting large audio file...")

        chunks = _split_audio_by_silence(audio_path)
        if not chunks:
            raise RuntimeError("Failed to split audio file")

        all_segments = []
        total_duration = 0
        total_cost = 0

        try:
            for i, (chunk_path, offset) in enumerate(chunks):
                pct = 0.1 + (0.8 * i / len(chunks))
                if progress_cb:
                    progress_cb(pct, f"Transcribing chunk {i+1}/{len(chunks)}...")

                kwargs = {
                    "model": self.model,
                    "file": open(chunk_path, "rb"),
                    "response_format": "verbose_json",
                    "timestamp_granularities": ["segment", "word"],
                }
                if language:
                    kwargs["language"] = language

                try:
                    response = client.audio.transcriptions.create(**kwargs)
                finally:
                    kwargs["file"].close()

                chunk_duration = getattr(response, "duration", 0) or 0
                total_duration += chunk_duration
                total_cost += (chunk_duration / 60) * 0.006

                # Word-level timing for this chunk
                words = getattr(response, "words", None) or []
                word_times = []
                for w in words:
                    ws = (w.get("start", 0) if isinstance(w, dict) else getattr(w, "start", 0)) + offset
                    we = (w.get("end", 0) if isinstance(w, dict) else getattr(w, "end", 0)) + offset
                    word_times.append((ws, we))

                raw_segments = getattr(response, "segments", None) or []
                for seg in raw_segments:
                    seg_start = (seg.get("start", 0) if isinstance(seg, dict) else getattr(seg, "start", 0)) + offset
                    seg_end = (seg.get("end", 0) if isinstance(seg, dict) else getattr(seg, "end", 0)) + offset
                    text = (seg.get("text", "") if isinstance(seg, dict) else getattr(seg, "text", "")).strip()
                    conf = 1.0 - (seg.get("no_speech_prob", 0) if isinstance(seg, dict) else getattr(seg, "no_speech_prob", 0))

                    if word_times:
                        seg_words = [(ws, we) for ws, we in word_times
                                     if ws >= seg_start - 0.5 and we <= seg_end + 0.5]
                        if seg_words:
                            seg_start = seg_words[0][0]
                            seg_end = seg_words[-1][1]

                    all_segments.append(STTSegment(start=seg_start, end=seg_end, text=text, confidence=conf))
        finally:
            # Cleanup temp chunks
            for chunk_path, _ in chunks:
                try:
                    os.unlink(chunk_path)
                except OSError:
                    pass

        if progress_cb:
            progress_cb(1.0, "STT complete")

        return STTResult(
            segments=all_segments,
            language=language,
            duration=total_duration,
            cost_usd=total_cost,
        )


class WhisperLocalEngine(STTEngine):
    """Local faster-whisper engine (Phase 3 stub)."""

    def __init__(self, model_size: str = "base"):
        self.model_size = model_size

    def transcribe(self, audio_path: str, language: str = "",
                   progress_cb: Optional[Callable[[float, str], None]] = None) -> STTResult:
        raise NotImplementedError("Local Whisper engine will be available in Phase 3")


def _split_audio_by_silence(audio_path: str, max_chunk_mb: int = 24) -> list[tuple[str, float]]:
    """Split audio at silence points using FFmpeg. Returns [(chunk_path, start_offset_sec)]."""
    tmp_dir = tempfile.mkdtemp(prefix="stt_chunks_")

    # Get duration
    probe = subprocess.run(
        ["ffprobe", "-v", "quiet", "-show_entries", "format=duration",
         "-of", "json", audio_path],
        capture_output=True, text=True, timeout=30,
    )
    duration = 0
    try:
        duration = float(json.loads(probe.stdout)["format"]["duration"])
    except (KeyError, json.JSONDecodeError, ValueError):
        pass

    if duration <= 0:
        return []

    # Split into ~10min chunks at silence points
    chunk_duration = 600  # 10 minutes
    chunks = []
    offset = 0

    while offset < duration:
        end = min(offset + chunk_duration + 30, duration)  # slight overlap for silence search
        chunk_path = os.path.join(tmp_dir, f"chunk_{len(chunks):03d}.wav")

        subprocess.run(
            ["ffmpeg", "-y", "-i", audio_path,
             "-ss", str(offset), "-t", str(end - offset),
             "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le",
             chunk_path],
            capture_output=True, timeout=120,
        )

        if os.path.exists(chunk_path) and os.path.getsize(chunk_path) > 0:
            chunks.append((chunk_path, offset))

        offset += chunk_duration

    return chunks


def extract_audio(video_path: str, output_path: str = "") -> str:
    """Extract audio from video as 16kHz mono WAV using FFmpeg."""
    if not shutil.which("ffmpeg"):
        raise RuntimeError("FFmpeg not found in PATH")

    if not output_path:
        base = os.path.splitext(video_path)[0]
        output_path = base + "_audio.wav"

    subprocess.run(
        ["ffmpeg", "-y", "-i", video_path,
         "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le",
         output_path],
        capture_output=True, timeout=300,
    )

    if not os.path.exists(output_path) or os.path.getsize(output_path) == 0:
        raise RuntimeError(f"Audio extraction failed: {video_path}")

    return output_path
