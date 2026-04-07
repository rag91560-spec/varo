"""Video frame extraction + Vision AI analysis for automatic context generation."""

import base64
import logging
import os
import shutil
import subprocess
import tempfile

logger = logging.getLogger(__name__)

_ffmpeg_path: str | None = None


def _find_ffmpeg(name: str = "ffmpeg") -> str | None:
    """Find ffmpeg/ffprobe, checking PATH then common install locations."""
    found = shutil.which(name)
    if found:
        return found
    # Winget install location (Windows)
    if os.name == "nt":
        winget_base = os.path.join(
            os.environ.get("LOCALAPPDATA", ""), "Microsoft", "WinGet", "Packages"
        )
        if os.path.isdir(winget_base):
            for d in os.listdir(winget_base):
                if "FFmpeg" in d:
                    for root, dirs, files in os.walk(os.path.join(winget_base, d)):
                        if f"{name}.exe" in files:
                            return os.path.join(root, f"{name}.exe")
    return None


def extract_sample_frames(video_path: str, count: int = 6) -> list[bytes]:
    """Extract N evenly-spaced frames from a video as JPEG bytes (720px width).

    Returns list of JPEG byte arrays. Empty list if ffmpeg unavailable or fails.
    """
    global _ffmpeg_path
    if _ffmpeg_path is None:
        _ffmpeg_path = _find_ffmpeg("ffmpeg") or ""
    if not _ffmpeg_path:
        logger.warning("ffmpeg not found — skipping frame extraction")
        return []

    ffprobe = _find_ffmpeg("ffprobe") or ""

    if not os.path.exists(video_path):
        logger.warning("Video file not found: %s", video_path)
        return []

    # Get video duration
    try:
        result = subprocess.run(
            [ffprobe or _ffmpeg_path.replace("ffmpeg", "ffprobe"),
             "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", video_path],
            capture_output=True, timeout=15, text=True,
        )
        duration = float(result.stdout.strip())
    except Exception as e:
        logger.warning("ffprobe duration failed: %s — using 60s fallback", e)
        duration = 60.0

    if duration <= 0:
        duration = 60.0

    frames: list[bytes] = []
    with tempfile.TemporaryDirectory() as tmpdir:
        for i in range(count):
            # Evenly space frames, avoiding very start/end
            offset = duration * (i + 1) / (count + 1)
            out_path = os.path.join(tmpdir, f"frame_{i}.jpg")
            try:
                subprocess.run(
                    [_ffmpeg_path, "-y", "-ss", str(offset), "-i", video_path,
                     "-frames:v", "1", "-vf", "scale=720:-1", "-q:v", "5", out_path],
                    capture_output=True, timeout=30,
                )
                if os.path.exists(out_path) and os.path.getsize(out_path) > 0:
                    with open(out_path, "rb") as f:
                        frames.append(f.read())
            except Exception as e:
                logger.debug("Frame extraction failed at %.1fs: %s", offset, e)

    logger.info("Extracted %d/%d frames from %s", len(frames), count, video_path)
    return frames


def extract_audio_sample(video_path: str, duration_sec: int = 30) -> bytes | None:
    """Extract a short audio clip from the middle of the video as MP3.

    Returns MP3 bytes or None if extraction fails.
    """
    global _ffmpeg_path
    if _ffmpeg_path is None:
        _ffmpeg_path = _find_ffmpeg("ffmpeg") or ""
    if not _ffmpeg_path:
        return None

    ffprobe = _find_ffmpeg("ffprobe") or ""

    # Get duration to pick the middle segment
    try:
        result = subprocess.run(
            [ffprobe or _ffmpeg_path.replace("ffmpeg", "ffprobe"),
             "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", video_path],
            capture_output=True, timeout=15, text=True,
        )
        total = float(result.stdout.strip())
    except Exception:
        total = 120.0

    # Start from ~25% into the video (avoid intros/silence)
    start = max(0, total * 0.25)
    clip_len = min(duration_sec, total - start)
    if clip_len <= 0:
        clip_len = min(duration_sec, total)
        start = 0

    with tempfile.TemporaryDirectory() as tmpdir:
        out_path = os.path.join(tmpdir, "sample.mp3")
        try:
            subprocess.run(
                [_ffmpeg_path, "-y", "-ss", str(start), "-i", video_path,
                 "-t", str(clip_len), "-vn", "-ar", "16000", "-ac", "1",
                 "-b:a", "64k", out_path],
                capture_output=True, timeout=30,
            )
            if os.path.exists(out_path) and os.path.getsize(out_path) > 0:
                with open(out_path, "rb") as f:
                    data = f.read()
                logger.info("Extracted audio sample: %.1fs, %d bytes", clip_len, len(data))
                return data
        except Exception as e:
            logger.debug("Audio sample extraction failed: %s", e)
    return None


def analyze_video_context(
    frames: list[bytes],
    stt_texts: list[str],
    provider: str,
    api_key: str,
    model: str,
    audio_sample: bytes | None = None,
) -> str:
    """Analyze video frames + audio + STT text via Vision AI to generate translation context.

    Returns free-text context string for injection into system prompt.
    """
    from .translation_prompts import VIDEO_ANALYSIS_PROMPT

    if not frames and not stt_texts:
        return ""

    # Build the prompt text with STT samples
    stt_sample = "\n".join(stt_texts[:50])  # First 50 lines to stay within token budget
    prompt_text = VIDEO_ANALYSIS_PROMPT + f"\n\n## STT 대사 (원문)\n{stt_sample}"

    try:
        if provider in ("claude", "claude_api", "claude_oauth", "anthropic"):
            # Claude doesn't support audio input
            return _analyze_claude(frames, prompt_text, api_key, model)
        elif provider in ("openai",):
            return _analyze_openai(frames, prompt_text, api_key, model, audio_sample)
        elif provider in ("gemini",):
            return _analyze_gemini(frames, prompt_text, api_key, model, audio_sample)
        else:
            logger.warning("Vision analysis not supported for provider: %s", provider)
            return ""
    except Exception as e:
        logger.error("Vision analysis failed: %s", e, exc_info=True)
        return ""


def _analyze_claude(frames: list[bytes], prompt: str, api_key: str, model: str) -> str:
    """Call Claude Vision API."""
    import anthropic

    client = anthropic.Anthropic(api_key=api_key)

    content = []
    for frame_bytes in frames:
        content.append({
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": "image/jpeg",
                "data": base64.b64encode(frame_bytes).decode("ascii"),
            },
        })
    content.append({"type": "text", "text": prompt})

    response = client.messages.create(
        model=model or "claude-sonnet-4-20250514",
        max_tokens=2048,
        messages=[{"role": "user", "content": content}],
    )
    return response.content[0].text


def _analyze_openai(frames: list[bytes], prompt: str, api_key: str, model: str,
                    audio_sample: bytes | None = None) -> str:
    """Call OpenAI Vision+Audio API."""
    import openai

    client = openai.OpenAI(api_key=api_key)

    content = []
    for frame_bytes in frames:
        b64 = base64.b64encode(frame_bytes).decode("ascii")
        content.append({
            "type": "image_url",
            "image_url": {"url": f"data:image/jpeg;base64,{b64}", "detail": "low"},
        })
    # input_audio is only supported by audio-preview models
    use_model = model or "gpt-4o"
    audio_capable = "audio" in use_model  # e.g. gpt-4o-audio-preview
    if audio_sample and audio_capable:
        b64_audio = base64.b64encode(audio_sample).decode("ascii")
        content.append({
            "type": "input_audio",
            "input_audio": {"data": b64_audio, "format": "mp3"},
        })
        prompt += "\n\n(오디오 샘플도 첨부되었습니다. 환경음, BGM, 효과음도 분석해서 장면 상황 파악에 활용하세요.)"
    content.append({"type": "text", "text": prompt})

    response = client.chat.completions.create(
        model=use_model,
        max_tokens=2048,
        messages=[{"role": "user", "content": content}],
    )
    return response.choices[0].message.content


def _analyze_gemini(frames: list[bytes], prompt: str, api_key: str, model: str,
                    audio_sample: bytes | None = None) -> str:
    """Call Gemini Vision+Audio API."""
    from google import genai

    client = genai.Client(api_key=api_key)

    parts = []
    for frame_bytes in frames:
        parts.append(genai.types.Part.from_bytes(data=frame_bytes, mime_type="image/jpeg"))
    if audio_sample:
        parts.append(genai.types.Part.from_bytes(data=audio_sample, mime_type="audio/mpeg"))
        prompt += "\n\n(오디오 샘플도 첨부되었습니다. 환경음, BGM, 효과음도 분석해서 장면 상황 파악에 활용하세요.)"
    parts.append(prompt)

    response = client.models.generate_content(
        model=model or "gemini-2.0-flash",
        contents=parts,
    )
    return response.text
