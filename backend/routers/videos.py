"""Video library REST API."""

import asyncio
import json
import logging
import os
import shutil
import subprocess
import uuid

from fastapi import APIRouter, HTTPException, UploadFile, File
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel
from typing import Optional, List

from .. import db
from ..sse_utils import sse_format as _sse_format
from .. import video_job_manager
from ..video_analyzer import probe_media_duration

logger = logging.getLogger(__name__)

_data_dir = os.environ.get("GT_DATA_DIR") or os.path.join(os.path.dirname(__file__), "..", "..", "data")
UPLOAD_DIR = os.path.join(_data_dir, "videos")
THUMB_DIR = os.path.join(_data_dir, "thumbnails", "video")
os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(THUMB_DIR, exist_ok=True)

router = APIRouter(prefix="/api/videos", tags=["videos"])


def _extract_video_thumbnail(video_path: str, video_id: int) -> str | None:
    """Extract a thumbnail from video at 1s using ffmpeg. Returns thumb URL or None."""
    if not shutil.which("ffmpeg"):
        return None
    try:
        thumb_path = os.path.join(THUMB_DIR, f"{video_id}.jpg")
        subprocess.run(
            ["ffmpeg", "-y", "-i", video_path, "-ss", "1", "-frames:v", "1", "-q:v", "5", thumb_path],
            capture_output=True, timeout=30,
        )
        if os.path.exists(thumb_path) and os.path.getsize(thumb_path) > 0:
            return f"/api/thumbnails/video/{video_id}.jpg"
    except Exception as e:
        logger.debug("ffmpeg thumbnail extraction failed: %s", e)
    return None


class VideoCreate(BaseModel):
    title: str
    type: str  # 'local' | 'url'
    source: str
    thumbnail: str = ""
    duration: int = 0
    size: int = 0
    category_id: Optional[int] = None
    sort_order: int = 0


class VideoUpdate(BaseModel):
    title: Optional[str] = None
    type: Optional[str] = None
    source: Optional[str] = None
    thumbnail: Optional[str] = None
    duration: Optional[int] = None
    size: Optional[int] = None
    category_id: Optional[int] = None
    sort_order: Optional[int] = None


class DownloadUrlRequest(BaseModel):
    url: str
    category_id: Optional[int] = None


class BulkMoveRequest(BaseModel):
    ids: List[int]
    category_id: Optional[int] = None


class BulkDeleteRequest(BaseModel):
    ids: List[int]


class ScanFolderRequest(BaseModel):
    path: str
    category_id: Optional[int] = None  # legacy: assign everything to one category
    parent_category_id: Optional[int] = None  # new: where to root the scanned tree
    preserve_structure: bool = True  # if True, create sub-categories mirroring folders


_VIDEO_EXTS = {".mp4", ".mkv", ".webm", ".avi", ".mov", ".m4v", ".ts", ".mpg", ".mpeg", ".wmv", ".flv"}


@router.post("/scan-folder")
async def scan_folder(body: ScanFolderRequest):
    folder = os.path.abspath(body.path)
    if not os.path.isdir(folder):
        raise HTTPException(400, f"Directory not found: {folder}")

    video_files: list[str] = []
    for root, _dirs, files in os.walk(folder):
        for fname in sorted(files):
            ext = os.path.splitext(fname)[1].lower()
            if ext in _VIDEO_EXTS:
                video_files.append(os.path.join(root, fname))
    if not video_files:
        raise HTTPException(400, "No video files found in folder")

    created: list[dict] = []
    created_categories: list[dict] = []
    category_cache: dict[tuple, int] = {}

    base_parent_id = body.parent_category_id
    flat_category_id = None
    if body.category_id is not None and body.parent_category_id is None:
        flat_category_id = body.category_id

    scan_root_name = os.path.basename(folder.rstrip("\\/")) or folder

    for vf in video_files:
        abs_vf = os.path.abspath(vf)
        fname = os.path.basename(abs_vf)
        title = os.path.splitext(fname)[0]
        size = os.path.getsize(abs_vf)

        target_category_id: Optional[int] = None
        if flat_category_id is not None:
            target_category_id = flat_category_id
        elif body.preserve_structure:
            rel_dir = os.path.relpath(os.path.dirname(abs_vf), folder)
            segments = [scan_root_name]
            if rel_dir and rel_dir != ".":
                segments.extend([s for s in rel_dir.replace("\\", "/").split("/") if s and s != "."])
            cache_key = (base_parent_id,) + tuple(segments)
            if cache_key in category_cache:
                target_category_id = category_cache[cache_key]
            else:
                leaf = await db.get_or_create_category_by_path(
                    media_type="video",
                    segments=segments,
                    root_parent_id=base_parent_id,
                )
                if leaf:
                    target_category_id = leaf["id"]
                    category_cache[cache_key] = leaf["id"]
                    if leaf not in created_categories:
                        created_categories.append(leaf)
        else:
            target_category_id = base_parent_id

        duration = probe_media_duration(abs_vf)
        video = await db.create_video(
            title=title,
            type_="local",
            source=abs_vf,
            thumbnail="",
            duration=duration,
            size=size,
            category_id=target_category_id,
            sort_order=len(created),
        )
        # Auto-extract thumbnail
        thumb_url = _extract_video_thumbnail(abs_vf, video["id"])
        if thumb_url:
            video = await db.update_video(video["id"], thumbnail=thumb_url)
        created.append(video)

    return {
        "created_items": created,
        "created_categories": created_categories,
        "total": len(created),
    }


@router.post("/download-url")
async def download_from_url(body: DownloadUrlRequest):
    """Start downloading a video from URL (YouTube, etc.) using yt-dlp."""
    if not body.url or not body.url.strip():
        raise HTTPException(400, "URL is required")
    try:
        job = await video_job_manager.start_download(body.url.strip(), body.category_id)
    except RuntimeError as e:
        raise HTTPException(400, str(e))
    return {"job_id": job.job_id, "status": "running"}


@router.get("/download/{job_id}/status")
async def download_status_sse(job_id: str):
    """SSE stream for video download progress."""
    job = video_job_manager.get_job(job_id)
    if not job:
        raise HTTPException(404, "Job not found")

    queue = job.add_sse_listener()

    async def event_stream():
        try:
            # Send init
            yield _sse_format("init", {
                "status": job.status,
                "progress": job.progress,
            })

            while True:
                try:
                    msg = await asyncio.wait_for(queue.get(), timeout=15)
                    yield _sse_format(msg["event"], msg["data"])
                    if msg["event"] in ("complete", "error", "cancelled"):
                        return
                except asyncio.TimeoutError:
                    yield _sse_format("heartbeat", {})
                    if job.status != "running":
                        return
        finally:
            job.remove_sse_listener(queue)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
    )


@router.post("/download/{job_id}/cancel")
async def cancel_download(job_id: str):
    """Cancel an active video download."""
    job = video_job_manager.get_job(job_id)
    if not job or job.status != "running":
        raise HTTPException(404, "No active download job")
    job.cancel_event.set()
    return {"ok": True}


@router.post("/bulk-move")
async def bulk_move_videos(body: BulkMoveRequest):
    if not body.ids:
        raise HTTPException(400, "ids must not be empty")
    await db.bulk_move_videos(body.ids, body.category_id)
    return {"ok": True, "moved": len(body.ids)}


@router.post("/bulk-delete")
async def bulk_delete_videos(body: BulkDeleteRequest):
    if not body.ids:
        raise HTTPException(400, "ids must not be empty")
    deleted = 0
    for vid in body.ids:
        if await db.delete_video(vid):
            deleted += 1
    return {"ok": True, "deleted": deleted}


@router.get("")
async def list_videos():
    return await db.list_videos()


@router.post("")
async def create_video(body: VideoCreate):
    if body.type == "local" and not os.path.isfile(body.source):
        raise HTTPException(400, f"File not found: {body.source}")
    video = await db.create_video(
        title=body.title,
        type_=body.type,
        source=body.source,
        thumbnail=body.thumbnail,
        duration=body.duration,
        size=body.size,
        category_id=body.category_id,
        sort_order=body.sort_order,
    )
    # Auto-extract thumbnail if none provided
    if not body.thumbnail and body.type == "local":
        thumb_url = _extract_video_thumbnail(body.source, video["id"])
        if thumb_url:
            video = await db.update_video(video["id"], thumbnail=thumb_url)
    return video


MAX_VIDEO_UPLOAD_SIZE = 500 * 1024 * 1024  # 500MB


@router.post("/upload")
async def upload_video(file: UploadFile = File(...)):
    ext = os.path.splitext(file.filename or "video.mp4")[1] or ".mp4"
    filename = f"{uuid.uuid4().hex}{ext}"
    dest = os.path.join(UPLOAD_DIR, filename)
    chunks = []
    total = 0
    while chunk := await file.read(8192):
        total += len(chunk)
        if total > MAX_VIDEO_UPLOAD_SIZE:
            raise HTTPException(status_code=413, detail="File too large (max 500MB)")
        chunks.append(chunk)
    content = b"".join(chunks)
    with open(dest, "wb") as f:
        f.write(content)
    title = os.path.splitext(file.filename or "video")[0]
    abs_dest = os.path.abspath(dest)
    video = await db.create_video(
        title=title,
        type_="local",
        source=abs_dest,
        thumbnail="",
        duration=probe_media_duration(abs_dest),
        size=len(content),
        sort_order=0,
    )
    # Auto-extract thumbnail
    thumb_url = _extract_video_thumbnail(abs_dest, video["id"])
    if thumb_url:
        video = await db.update_video(video["id"], thumbnail=thumb_url)
    return video


@router.put("/{video_id}")
async def update_video(video_id: int, body: VideoUpdate):
    existing = await db.get_video(video_id)
    if not existing:
        raise HTTPException(404, "Video not found")
    fields = body.model_dump(exclude_none=True)
    return await db.update_video(video_id, **fields)


@router.delete("/{video_id}")
async def delete_video(video_id: int):
    deleted = await db.delete_video(video_id)
    if not deleted:
        raise HTTPException(404, "Video not found")
    return {"ok": True}


@router.get("/{video_id}/serve")
async def serve_video(video_id: int):
    video = await db.get_video(video_id)
    if not video:
        raise HTTPException(404, "Video not found")
    if video["type"] != "local":
        raise HTTPException(400, "Only local videos can be served")
    file_path = video["source"]
    real_path = os.path.realpath(file_path)
    if not os.path.isfile(real_path):
        raise HTTPException(404, f"File not found: {file_path}")
    # Guess content type from extension
    ext = os.path.splitext(real_path)[1].lower()
    media_types = {".mp4": "video/mp4", ".mkv": "video/x-matroska", ".webm": "video/webm", ".avi": "video/x-msvideo", ".mov": "video/quicktime"}
    return FileResponse(real_path, media_type=media_types.get(ext, "video/mp4"))


@router.post("/{video_id}/thumbnail")
async def upload_video_thumbnail(video_id: int, file: UploadFile = File(...)):
    video = await db.get_video(video_id)
    if not video:
        raise HTTPException(404, "Video not found")
    ext = os.path.splitext(file.filename or "thumb.jpg")[1] or ".jpg"
    filename = f"{video_id}{ext}"
    dest = os.path.join(THUMB_DIR, filename)
    content = await file.read()
    with open(dest, "wb") as f:
        f.write(content)
    thumb_url = f"/api/thumbnails/video/{filename}"
    return await db.update_video(video_id, thumbnail=thumb_url)
