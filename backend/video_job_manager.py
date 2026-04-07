"""Video download job manager with SSE broadcasting — mirrors subtitle_job_manager.py pattern."""

import asyncio
import logging
import os
import shutil
import threading
import uuid
from datetime import datetime, timezone
from typing import Optional

from . import db
from .ytdlp_downloader import download_video, is_available as ytdlp_available, YtdlpResult

logger = logging.getLogger(__name__)

_data_dir = os.environ.get("GT_DATA_DIR") or os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")
DOWNLOAD_DIR = os.path.join(_data_dir, "downloads")
os.makedirs(DOWNLOAD_DIR, exist_ok=True)


class VideoDownloadJob:
    def __init__(self, job_id: str, url: str):
        self.job_id = job_id
        self.url = url
        self.status = "running"
        self.progress = 0.0
        self.message = ""
        self.error_message = ""
        self.result_video_id: Optional[int] = None
        self.cancel_event = threading.Event()
        self._sse_queues: list[asyncio.Queue] = []
        self._sse_lock = threading.Lock()
        self._loop: Optional[asyncio.AbstractEventLoop] = None

    def add_sse_listener(self) -> asyncio.Queue:
        q = asyncio.Queue()
        with self._sse_lock:
            self._sse_queues.append(q)
        return q

    def remove_sse_listener(self, q: asyncio.Queue):
        with self._sse_lock:
            try:
                self._sse_queues.remove(q)
            except ValueError:
                pass

    def broadcast(self, event_type: str, data: dict):
        msg = {"event": event_type, "data": data}
        with self._sse_lock:
            queues = list(self._sse_queues)
        for q in queues:
            try:
                if self._loop and self._loop.is_running():
                    self._loop.call_soon_threadsafe(q.put_nowait, msg)
                else:
                    q.put_nowait(msg)
            except (asyncio.QueueFull, RuntimeError):
                pass


# Global job registry
_jobs: dict[str, VideoDownloadJob] = {}
_jobs_lock = threading.Lock()
_MAX_FINISHED_JOBS = 10


def _cleanup_finished():
    finished = [jid for jid, j in _jobs.items() if j.status != "running"]
    if len(finished) > _MAX_FINISHED_JOBS:
        for jid in finished[:-_MAX_FINISHED_JOBS]:
            _jobs.pop(jid, None)


def get_job(job_id: str) -> Optional[VideoDownloadJob]:
    with _jobs_lock:
        return _jobs.get(job_id)


async def start_download(url: str, category_id: Optional[int] = None) -> VideoDownloadJob:
    """Start video download job in background thread."""
    if not ytdlp_available():
        raise RuntimeError("yt-dlp not found in PATH. Install: pip install yt-dlp")

    job_id = str(uuid.uuid4())
    job = VideoDownloadJob(job_id, url)
    job._loop = asyncio.get_event_loop()

    with _jobs_lock:
        _cleanup_finished()
        _jobs[job_id] = job

    thread = threading.Thread(
        target=_run_download,
        args=(job, url, category_id),
        daemon=True,
    )
    thread.start()
    return job


def _run_download(job: VideoDownloadJob, url: str, category_id: Optional[int]):
    """Run yt-dlp download in background thread."""
    loop = job._loop

    try:
        # Create job-specific output directory
        output_dir = os.path.join(DOWNLOAD_DIR, job.job_id[:8])
        os.makedirs(output_dir, exist_ok=True)

        def progress_cb(pct: float, msg: str):
            if job.cancel_event.is_set():
                raise InterruptedError("Cancelled")
            job.progress = pct
            job.message = msg
            job.broadcast("progress", {"progress": pct, "message": msg})

        def cancel_check() -> bool:
            return job.cancel_event.is_set()

        result: YtdlpResult = download_video(
            url=url,
            output_dir=output_dir,
            progress_cb=progress_cb,
            cancel_check=cancel_check,
        )

        if job.cancel_event.is_set():
            raise InterruptedError("Cancelled")

        if result.error:
            raise RuntimeError(result.error)

        if not result.filepath or not os.path.isfile(result.filepath):
            raise RuntimeError("Download completed but no video file found")

        # Move video to permanent videos directory
        videos_dir = os.path.join(_data_dir, "videos")
        os.makedirs(videos_dir, exist_ok=True)
        dest_path = os.path.join(videos_dir, os.path.basename(result.filepath))
        # Handle duplicates
        if os.path.exists(dest_path):
            base, ext = os.path.splitext(dest_path)
            dest_path = f"{base}_{job.job_id[:8]}{ext}"
        shutil.move(result.filepath, dest_path)

        # Handle thumbnail
        thumbnail_url = ""
        if result.thumbnail_path and os.path.isfile(result.thumbnail_path):
            thumb_dir = os.path.join(_data_dir, "thumbnails", "video")
            os.makedirs(thumb_dir, exist_ok=True)
            # Convert to jpg using PIL if needed
            thumb_dest = os.path.join(thumb_dir, f"dl_{job.job_id[:8]}.jpg")
            try:
                from PIL import Image
                img = Image.open(result.thumbnail_path)
                img = img.convert("RGB")
                img.save(thumb_dest, "JPEG", quality=85)
                thumbnail_url = f"/api/thumbnails/video/dl_{job.job_id[:8]}.jpg"
            except Exception as e:
                logger.warning("Thumbnail conversion failed: %s", e)

        # Create DB record
        video = asyncio.run_coroutine_threadsafe(
            db.create_video(
                title=result.title or "Downloaded Video",
                type_="local",
                source=os.path.abspath(dest_path),
                thumbnail=thumbnail_url,
                duration=result.duration,
                size=result.filesize or os.path.getsize(dest_path),
                category_id=category_id,
                sort_order=0,
            ),
            loop,
        ).result(timeout=30)

        video_id = video["id"]
        job.result_video_id = video_id

        # Auto-extract better thumbnail with ffmpeg if yt-dlp didn't provide one
        if not thumbnail_url:
            from .routers.videos import _extract_video_thumbnail
            thumb_url = _extract_video_thumbnail(dest_path, video_id)
            if thumb_url:
                asyncio.run_coroutine_threadsafe(
                    db.update_video(video_id, thumbnail=thumb_url),
                    loop,
                ).result(timeout=10)

        # Import subtitles if found
        imported_subs = []
        for sub_path in result.subtitle_paths:
            if os.path.isfile(sub_path):
                try:
                    imported_subs.append(os.path.basename(sub_path))
                    logger.info("Found subtitle: %s", sub_path)
                except Exception as e:
                    logger.warning("Subtitle import failed for %s: %s", sub_path, e)

        # Clean up download temp directory
        try:
            shutil.rmtree(output_dir, ignore_errors=True)
        except Exception:
            pass

        job.status = "completed"
        job.progress = 1.0
        job.broadcast("complete", {
            "video_id": video_id,
            "title": result.title,
            "duration": result.duration,
            "filesize": result.filesize or os.path.getsize(dest_path),
            "subtitle_files": imported_subs,
        })

    except InterruptedError:
        job.status = "cancelled"
        job.broadcast("cancelled", {})

    except Exception as e:
        logger.error("Video download job failed: %s", e)
        job.status = "error"
        job.error_message = str(e)
        job.broadcast("error", {"message": str(e)})
