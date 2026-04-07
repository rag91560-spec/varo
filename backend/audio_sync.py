"""FFT-based audio-subtitle synchronization — inspired by ffsubsync.

Uses energy-based VAD + FFT cross-correlation to find optimal alignment
between audio speech energy and subtitle timing.
"""

import logging
import math
import struct
import wave
from dataclasses import dataclass
from typing import Callable, Optional

import numpy as np

logger = logging.getLogger(__name__)

# VAD parameters
FRAME_MS = 30           # Frame duration in ms
SAMPLE_RATE = 16000     # Expected sample rate (matches extract-audio output)
FRAME_SIZE = int(SAMPLE_RATE * FRAME_MS / 1000)  # 480 samples per frame
ENERGY_THRESHOLD_DB = -35  # dB below peak for speech detection


@dataclass
class SyncResult:
    offset_ms: float        # Global offset in milliseconds
    stretch_factor: float   # 1.0 = no stretch
    confidence: float       # 0-1
    segments_updated: int = 0


def _load_audio(audio_path: str) -> np.ndarray:
    """Load WAV file as float32 mono array at 16kHz."""
    with wave.open(audio_path, 'rb') as wf:
        channels = wf.getnchannels()
        sample_width = wf.getsampwidth()
        rate = wf.getframerate()
        n_frames = wf.getnframes()

        raw = wf.readframes(n_frames)

    # Convert to float32
    if sample_width == 2:
        samples = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    elif sample_width == 4:
        samples = np.frombuffer(raw, dtype=np.int32).astype(np.float32) / 2147483648.0
    else:
        raise ValueError(f"Unsupported sample width: {sample_width}")

    # Mix to mono if stereo
    if channels > 1:
        samples = samples.reshape(-1, channels).mean(axis=1)

    # Resample to 16kHz if needed (simple decimation/interpolation)
    if rate != SAMPLE_RATE:
        duration = len(samples) / rate
        n_target = int(duration * SAMPLE_RATE)
        indices = np.linspace(0, len(samples) - 1, n_target).astype(int)
        samples = samples[indices]

    return samples


def _energy_vad(samples: np.ndarray) -> np.ndarray:
    """Energy-based Voice Activity Detection.

    Returns binary array: 1 = speech, 0 = silence, one value per FRAME_MS frame.
    """
    n_frames = len(samples) // FRAME_SIZE
    if n_frames == 0:
        return np.array([], dtype=np.float32)

    # Reshape into frames
    trimmed = samples[:n_frames * FRAME_SIZE]
    frames = trimmed.reshape(n_frames, FRAME_SIZE)

    # RMS energy per frame
    rms = np.sqrt(np.mean(frames ** 2, axis=1) + 1e-10)
    db = 20 * np.log10(rms + 1e-10)

    # Threshold relative to peak
    peak_db = np.max(db)
    threshold = peak_db + ENERGY_THRESHOLD_DB

    vad = (db >= threshold).astype(np.float32)

    # Smooth: median filter to remove isolated frames
    kernel = 5
    if len(vad) > kernel:
        padded = np.pad(vad, kernel // 2, mode='edge')
        smoothed = np.array([
            1.0 if np.median(padded[i:i + kernel]) >= 0.5 else 0.0
            for i in range(len(vad))
        ])
        return smoothed

    return vad


def _segments_to_binary(segments: list[dict], total_frames: int) -> np.ndarray:
    """Convert subtitle segments to binary array matching VAD frame grid."""
    binary = np.zeros(total_frames, dtype=np.float32)
    for seg in segments:
        start_s = seg.get("start_time", 0)
        end_s = seg.get("end_time", 0)
        start_frame = int(start_s * 1000 / FRAME_MS)
        end_frame = int(end_s * 1000 / FRAME_MS)
        start_frame = max(0, min(start_frame, total_frames - 1))
        end_frame = max(0, min(end_frame, total_frames))
        if start_frame < end_frame:
            binary[start_frame:end_frame] = 1.0
    return binary


def _fft_cross_correlation(a: np.ndarray, b: np.ndarray) -> tuple[int, float]:
    """FFT-based cross-correlation to find optimal offset.

    Returns (best_offset_frames, correlation_score).
    Positive offset means subtitle is ahead of audio (needs delay).
    """
    n = len(a) + len(b) - 1
    fft_size = 1 << (n - 1).bit_length()  # Next power of 2

    A = np.fft.rfft(a, fft_size)
    B = np.fft.rfft(b, fft_size)

    # Cross-correlation via FFT
    cross = np.fft.irfft(A * np.conj(B), fft_size)

    # Best offset
    best_idx = np.argmax(np.abs(cross))

    # Convert index to offset
    if best_idx > fft_size // 2:
        offset = best_idx - fft_size
    else:
        offset = best_idx

    # Normalize score
    norm = np.sqrt(np.sum(a ** 2) * np.sum(b ** 2))
    score = abs(cross[best_idx]) / norm if norm > 0 else 0.0

    return int(offset), float(score)


def _compute_stretch(audio_vad: np.ndarray, sub_binary: np.ndarray,
                     n_sections: int = 10) -> tuple[float, float]:
    """Compute stretch factor by sectioned cross-correlation + linear regression.

    Returns (stretch_factor, avg_section_confidence).
    """
    n = min(len(audio_vad), len(sub_binary))
    if n < 100:
        return 1.0, 0.0

    section_size = n // n_sections
    if section_size < 50:
        return 1.0, 0.0

    offsets = []
    positions = []
    scores = []

    for i in range(n_sections):
        start = i * section_size
        end = start + section_size
        a_sec = audio_vad[start:end]
        s_sec = sub_binary[start:end]

        if np.sum(a_sec) < 5 or np.sum(s_sec) < 5:
            continue

        offset, score = _fft_cross_correlation(a_sec, s_sec)
        if score > 0.1:  # Minimum quality threshold
            offsets.append(offset)
            positions.append((start + end) / 2.0)
            scores.append(score)

    if len(offsets) < 3:
        return 1.0, sum(scores) / len(scores) if scores else 0.0

    # Linear regression: offset = a * position + b
    # stretch_factor ≈ 1 + a * FRAME_MS / 1000
    positions = np.array(positions)
    offsets = np.array(offsets)

    # Weighted least squares (weight by correlation score)
    weights = np.array(scores)
    w_sum = np.sum(weights)
    x_mean = np.sum(weights * positions) / w_sum
    y_mean = np.sum(weights * offsets) / w_sum

    num = np.sum(weights * (positions - x_mean) * (offsets - y_mean))
    den = np.sum(weights * (positions - x_mean) ** 2)

    if abs(den) < 1e-10:
        return 1.0, sum(scores) / len(scores)

    slope = num / den
    stretch = 1.0 + slope  # Frames per frame drift

    # Clamp to reasonable range
    stretch = max(0.9, min(1.1, stretch))

    avg_confidence = sum(scores) / len(scores)
    return float(stretch), float(avg_confidence)


def compute_sync(
    audio_path: str,
    segments: list[dict],
    progress_cb: Optional[Callable[[float, str], None]] = None,
) -> SyncResult:
    """Compute synchronization parameters between audio and subtitle segments.

    Args:
        audio_path: Path to WAV file (16kHz mono preferred)
        segments: List of subtitle segments with start_time, end_time
        progress_cb: Optional callback(progress_0_1, message)

    Returns:
        SyncResult with offset, stretch, and confidence
    """
    if not segments:
        return SyncResult(offset_ms=0, stretch_factor=1.0, confidence=0.0)

    # Step 1: Load audio
    if progress_cb:
        progress_cb(0.1, "Loading audio...")
    samples = _load_audio(audio_path)
    duration_s = len(samples) / SAMPLE_RATE
    logger.info("Audio loaded: %.1fs, %d samples", duration_s, len(samples))

    # Step 2: VAD
    if progress_cb:
        progress_cb(0.3, "Detecting speech regions...")
    audio_vad = _energy_vad(samples)
    n_frames = len(audio_vad)
    speech_ratio = np.mean(audio_vad) if n_frames > 0 else 0
    logger.info("VAD: %d frames, %.1f%% speech", n_frames, speech_ratio * 100)

    if n_frames == 0:
        return SyncResult(offset_ms=0, stretch_factor=1.0, confidence=0.0)

    # Step 3: Segments to binary
    if progress_cb:
        progress_cb(0.4, "Building subtitle timeline...")
    sub_binary = _segments_to_binary(segments, n_frames)
    sub_ratio = np.mean(sub_binary) if n_frames > 0 else 0
    logger.info("Subtitle binary: %.1f%% active", sub_ratio * 100)

    if np.sum(sub_binary) < 5:
        return SyncResult(offset_ms=0, stretch_factor=1.0, confidence=0.0)

    # Step 4: Global FFT cross-correlation
    if progress_cb:
        progress_cb(0.5, "Computing global alignment...")
    offset_frames, global_score = _fft_cross_correlation(audio_vad, sub_binary)
    offset_ms = offset_frames * FRAME_MS
    logger.info("Global offset: %d frames (%.0fms), score: %.3f",
                offset_frames, offset_ms, global_score)

    # Step 5: Sectioned cross-correlation for stretch
    if progress_cb:
        progress_cb(0.7, "Computing stretch factor...")

    # Apply global offset first, then measure stretch
    shifted = np.roll(sub_binary, offset_frames)
    stretch, section_confidence = _compute_stretch(audio_vad, shifted)
    logger.info("Stretch factor: %.6f, section confidence: %.3f", stretch, section_confidence)

    # Step 6: Confidence = overlap ratio after alignment
    if progress_cb:
        progress_cb(0.9, "Calculating confidence...")

    # Apply sync and measure overlap
    aligned = np.roll(sub_binary, offset_frames)
    overlap = np.sum(audio_vad * aligned)
    total_speech = np.sum(audio_vad) + np.sum(aligned)
    confidence = (2 * overlap / total_speech) if total_speech > 0 else 0.0
    confidence = max(0.0, min(1.0, confidence))

    if progress_cb:
        progress_cb(1.0, "Sync complete")

    return SyncResult(
        offset_ms=offset_ms,
        stretch_factor=stretch,
        confidence=confidence,
    )


def apply_sync(segments: list[dict], offset_ms: float, stretch_factor: float) -> list[dict]:
    """Apply sync parameters to segments, returning updated segments.

    new_time = old_time * stretch_factor + offset_ms / 1000
    """
    offset_s = offset_ms / 1000.0
    result = []
    for seg in segments:
        new_start = seg["start_time"] * stretch_factor + offset_s
        new_end = seg["end_time"] * stretch_factor + offset_s
        # Clamp to non-negative
        new_start = max(0.0, new_start)
        new_end = max(new_start + 0.01, new_end)  # Min 10ms duration
        result.append({
            **seg,
            "start_time": round(new_start, 3),
            "end_time": round(new_end, 3),
        })
    return result
