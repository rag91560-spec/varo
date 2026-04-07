"""yt-dlp wrapper for downloading videos from YouTube and other sites."""

import logging
import os
import re
import subprocess
import shutil
from dataclasses import dataclass, field
from typing import Callable, Optional

logger = logging.getLogger(__name__)


@dataclass
class YtdlpResult:
    filepath: str = ""
    title: str = ""
    duration: int = 0
    filesize: int = 0
    thumbnail_path: str = ""
    subtitle_paths: list[str] = field(default_factory=list)
    error: str = ""


def is_available() -> bool:
    """Check if yt-dlp is installed."""
    return shutil.which("yt-dlp") is not None


def _parse_progress(line: str) -> Optional[float]:
    """Parse yt-dlp progress line and return percentage 0-1."""
    # [download]  45.2% of  123.45MiB at  5.67MiB/s ETA 00:15
    m = re.search(r'\[download\]\s+([\d.]+)%', line)
    if m:
        return float(m.group(1)) / 100.0
    return None


def download_video(
    url: str,
    output_dir: str,
    progress_cb: Optional[Callable[[float, str], None]] = None,
    cancel_check: Optional[Callable[[], bool]] = None,
    max_filesize: str = "2G",
) -> YtdlpResult:
    """Download video using yt-dlp with progress reporting.

    Args:
        url: Video URL (YouTube, etc.)
        output_dir: Directory to save downloaded files
        progress_cb: Callback(progress_0_1, message_str)
        cancel_check: Returns True if download should be cancelled
        max_filesize: Maximum file size (yt-dlp format, e.g. "2G")

    Returns:
        YtdlpResult with file paths and metadata
    """
    yt_dlp = shutil.which("yt-dlp")
    if not yt_dlp:
        return YtdlpResult(error="yt-dlp not found in PATH. Install: pip install yt-dlp")

    os.makedirs(output_dir, exist_ok=True)

    # Output template: title-based filename
    output_template = os.path.join(output_dir, "%(title)s.%(ext)s")

    cmd = [
        yt_dlp,
        "--newline",  # Progress on new lines for parsing
        "-f", "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
        "--merge-output-format", "mp4",
        "--write-thumbnail",
        "--write-auto-subs",
        "--sub-lang", "ja,en,ko",
        "--convert-subs", "srt",
        "--max-filesize", max_filesize,
        "--no-playlist",
        "--no-overwrites",
        "-o", output_template,
        "--print-json",  # Print JSON metadata after download
        "--no-simulate",
        url,
    ]

    logger.info("yt-dlp command: %s", " ".join(cmd))

    result = YtdlpResult()

    try:
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            encoding="utf-8",
            errors="replace",
        )

        json_lines = []
        json_started = False

        for line in iter(proc.stdout.readline, ""):
            if not line:
                break

            line = line.rstrip()

            # Check cancellation
            if cancel_check and cancel_check():
                proc.terminate()
                result.error = "Cancelled"
                return result

            # Detect JSON output (starts with { on a new line)
            if line.startswith("{"):
                json_started = True

            if json_started:
                json_lines.append(line)
                continue

            # Parse progress
            pct = _parse_progress(line)
            if pct is not None and progress_cb:
                progress_cb(pct * 0.9, line.strip())  # Reserve 10% for post-processing

            # Log non-progress lines
            if not line.startswith("[download]") or "%" not in line:
                logger.info("yt-dlp: %s", line)

        proc.wait(timeout=300)

        if proc.returncode != 0 and not result.error:
            result.error = f"yt-dlp exited with code {proc.returncode}"
            return result

        # Parse JSON metadata
        if json_lines:
            import json
            try:
                metadata = json.loads("\n".join(json_lines))
                result.title = metadata.get("title", "")
                result.duration = int(metadata.get("duration", 0))
                result.filepath = metadata.get("_filename", "") or metadata.get("filename", "")
                result.filesize = int(metadata.get("filesize", 0) or metadata.get("filesize_approx", 0) or 0)

                # Find requested subtitles
                req_subs = metadata.get("requested_subtitles") or {}
                for lang, sub_info in req_subs.items():
                    sub_path = sub_info.get("filepath", "")
                    if sub_path and os.path.isfile(sub_path):
                        result.subtitle_paths.append(sub_path)
            except (json.JSONDecodeError, ValueError) as e:
                logger.warning("Failed to parse yt-dlp JSON: %s", e)

        # If filepath not from JSON, try to find it
        if not result.filepath or not os.path.isfile(result.filepath):
            mp4_files = [
                os.path.join(output_dir, f) for f in os.listdir(output_dir)
                if f.endswith(".mp4") and os.path.isfile(os.path.join(output_dir, f))
            ]
            if mp4_files:
                # Most recently modified
                result.filepath = max(mp4_files, key=os.path.getmtime)

        if result.filepath and os.path.isfile(result.filepath):
            result.filesize = result.filesize or os.path.getsize(result.filepath)
            if not result.title:
                result.title = os.path.splitext(os.path.basename(result.filepath))[0]

        # Find thumbnail
        for ext in (".webp", ".jpg", ".png"):
            thumb_path = os.path.splitext(result.filepath)[0] + ext if result.filepath else ""
            if thumb_path and os.path.isfile(thumb_path):
                result.thumbnail_path = thumb_path
                break

        # Find subtitle files in output dir
        if not result.subtitle_paths:
            for f in os.listdir(output_dir):
                if f.endswith(".srt") and os.path.isfile(os.path.join(output_dir, f)):
                    result.subtitle_paths.append(os.path.join(output_dir, f))

        if progress_cb:
            progress_cb(1.0, "Download complete")

    except subprocess.TimeoutExpired:
        proc.kill()
        result.error = "Download timed out (5 min)"
    except Exception as e:
        result.error = str(e)
        logger.error("yt-dlp download error: %s", e)

    return result
