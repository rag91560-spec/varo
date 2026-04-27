"""Subtitle pipeline REST API — STT, translation, export/import."""

import asyncio
import json
import logging
import os
import shutil

from fastapi import APIRouter, Body, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse, Response, FileResponse
from pydantic import BaseModel
from typing import Optional

from .. import db
from .. import subtitle_job_manager as sjm
try:
    from ..license import require_license
except ImportError:
    from ..license_stub import require_license
from ..stt_engine import extract_audio
from ..subtitle_formats import (
    Segment, segments_to_srt, segments_to_vtt, segments_to_ass,
    parse_srt_to_segments, parse_vtt_to_segments, parse_ass_to_segments,
    detect_and_parse,
)

logger = logging.getLogger(__name__)

_data_dir = os.environ.get("GT_DATA_DIR") or os.path.join(os.path.dirname(__file__), "..", "..", "data")
AUDIO_EXTRACT_DIR = os.path.join(_data_dir, "subtitle_audio")
os.makedirs(AUDIO_EXTRACT_DIR, exist_ok=True)

router = APIRouter(prefix="/api/subtitle", tags=["subtitle"])

OFFLINE_PROVIDERS = {"offline", "test"}

# --- Pydantic models ---

class ExtractAudioRequest(BaseModel):
    media_id: int
    media_type: str  # 'video' | 'audio'


class STTRequest(BaseModel):
    subtitle_id: int
    provider: str = "whisper_api"
    model: str = "whisper-1"
    language: str = ""


class SubtitleTranslateRequest(BaseModel):
    source_lang: str = "ja"
    target_lang: str = "ko"
    provider: str = ""
    model: str = ""
    context_window: int = 20
    context_overlap: int = 5
    context: str = ""


class ExportRequest(BaseModel):
    format: str = "srt"  # srt | vtt | ass
    use_translated: bool = True
    # ASS style options
    font_name: str = "Arial"
    font_size: int = 20
    primary_color: str = "&H00FFFFFF"       # white (ASS &HAABBGGRR)
    outline_color: str = "&H00000000"       # black
    alignment: int = 2                       # numpad: 2=bottom, 8=top, 5=center
    margin_v: int = 30                       # vertical margin (px)


class HardsubRequest(BaseModel):
    font_name: str = "Arial"
    font_size: int = 28                     # hardsub는 burn-in이므로 export(20)보다 크게
    primary_color: str = "&H00FFFFFF"
    outline_color: str = "&H00000000"
    alignment: int = 2
    margin_v: int = 30
    outline_width: int = 2


class SegmentUpdate(BaseModel):
    original_text: Optional[str] = None
    translated_text: Optional[str] = None
    start_time: Optional[float] = None
    end_time: Optional[float] = None
    pos_x: Optional[float] = None
    pos_y: Optional[float] = None


class SegmentCreate(BaseModel):
    start_time: float
    end_time: float
    original_text: str = ""
    translated_text: str = ""


class SegmentSplit(BaseModel):
    split_time: float


class ImportSubtitleRequest(BaseModel):
    media_id: int
    media_type: str  # 'video' | 'audio'
    label: str = ""
    source_lang: str = ""


# --- Audio extraction ---

@router.post("/extract-audio")
async def extract_audio_endpoint(body: ExtractAudioRequest):
    """Extract audio from video as 16kHz mono WAV."""
    if body.media_type == "video":
        video = await db.get_video(body.media_id)
        if not video:
            raise HTTPException(404, "Video not found")
        source = video["source"]
        if video["type"] != "local":
            raise HTTPException(400, "Audio extraction only works for local files")
        # Resolve relative paths
        video_dir = os.path.join(_data_dir, "videos")
        if not os.path.isabs(source):
            source = os.path.join(video_dir, source)
    elif body.media_type == "audio":
        audio = await db.get_audio_item(body.media_id)
        if not audio:
            raise HTTPException(404, "Audio not found")
        source = audio["source"]
        audio_dir = os.path.join(_data_dir, "audio")
        if not os.path.isabs(source):
            source = os.path.join(audio_dir, source)
    else:
        raise HTTPException(400, "media_type must be 'video' or 'audio'")

    if not os.path.exists(source):
        raise HTTPException(404, f"Source file not found: {source}")

    output_path = os.path.join(AUDIO_EXTRACT_DIR, f"{body.media_type}_{body.media_id}.wav")

    try:
        result_path = extract_audio(source, output_path)
        size = os.path.getsize(result_path)
        return {"path": result_path, "size": size}
    except Exception as e:
        raise HTTPException(500, f"Audio extraction failed: {e}")


# --- STT ---

@router.post("/stt")
async def start_stt(body: STTRequest):
    """Start Speech-to-Text job."""
    subtitle = await db.get_subtitle(body.subtitle_id)
    if not subtitle:
        raise HTTPException(404, "Subtitle not found")

    media_id = subtitle["media_id"]
    media_type = subtitle["media_type"]

    # Find audio file
    audio_path = os.path.join(AUDIO_EXTRACT_DIR, f"{media_type}_{media_id}.wav")
    if not os.path.exists(audio_path):
        # Try to use media source directly
        if media_type == "audio":
            audio = await db.get_audio_item(media_id)
            if audio and audio["type"] == "local":
                audio_dir = os.path.join(_data_dir, "audio")
                source = audio["source"]
                if not os.path.isabs(source):
                    source = os.path.join(audio_dir, source)
                audio_path = source
        if not os.path.exists(audio_path):
            raise HTTPException(400, "Audio file not found. Extract audio first.")

    # Get API key
    api_key = ""
    if body.provider == "whisper_api":
        settings = await db.get_settings()
        api_keys = settings.get("api_keys", {})
        if isinstance(api_keys, str):
            api_keys = json.loads(api_keys)
        api_key = api_keys.get("openai", "")
        if not api_key:
            raise HTTPException(400, "OpenAI API key required for Whisper API")

    job = await sjm.start_stt(
        subtitle_id=body.subtitle_id,
        media_id=media_id,
        media_type=media_type,
        audio_path=audio_path,
        provider=body.provider,
        api_key=api_key,
        model=body.model,
        language=body.language,
    )

    return {"job_id": job.job_id, "status": "running"}


@router.get("/stt/{job_id}/status")
async def stt_status(job_id: str):
    """SSE stream for STT job progress."""
    job = sjm.get_job(job_id)
    if not job:
        # Check DB
        db_job = await db.get_subtitle_job(job_id)
        if db_job:
            return {"status": db_job["status"], "progress": db_job["progress"],
                    "error_message": db_job.get("error_message", "")}
        raise HTTPException(404, "Job not found")

    q = job.add_sse_listener()

    async def event_generator():
        try:
            # Send initial state
            yield f"data: {json.dumps({'event': 'init', 'data': {'status': job.status, 'progress': job.progress}})}\n\n"
            while True:
                try:
                    msg = await asyncio.wait_for(q.get(), timeout=30)
                    yield f"data: {json.dumps(msg)}\n\n"
                    if msg.get("event") in ("complete", "error", "cancelled"):
                        break
                except asyncio.TimeoutError:
                    yield f"data: {json.dumps({'event': 'heartbeat', 'data': {}})}\n\n"
                    if job.status != "running":
                        break
        finally:
            job.remove_sse_listener(q)

    return StreamingResponse(event_generator(), media_type="text/event-stream")


# --- Translation ---

@router.post("/{subtitle_id}/translate")
async def start_translate(subtitle_id: int, body: SubtitleTranslateRequest):
    """Start subtitle translation job with context-window batching."""
    if body.provider not in OFFLINE_PROVIDERS:
        await require_license()
    subtitle = await db.get_subtitle(subtitle_id)
    if not subtitle:
        raise HTTPException(404, "Subtitle not found")

    segments = await db.get_subtitle_segments(subtitle_id)
    if not segments:
        raise HTTPException(400, "No segments to translate. Run STT first.")

    # Get API key and provider
    settings = await db.get_settings()
    provider = body.provider or settings.get("default_provider", "")
    if not provider:
        raise HTTPException(400, "No translation provider configured. Set a default provider in Settings.")
    api_keys = settings.get("api_keys", {})
    if isinstance(api_keys, str):
        api_keys = json.loads(api_keys)
    api_key = api_keys.get(provider, "")
    # Providers that don't need an API key
    NO_KEY_PROVIDERS = {"claude_oauth", "offline", "offline_hq"}
    if not api_key and provider not in NO_KEY_PROVIDERS:
        raise HTTPException(400, f"No API key configured for provider: {provider}")

    # Resolve media file path for video analysis
    media_path = ""
    if subtitle["media_type"] == "video":
        video = await db.get_video(subtitle["media_id"])
        if video and video.get("type") == "local":
            source = video["source"]
            video_dir = os.path.join(_data_dir, "videos")
            if not os.path.isabs(source):
                source = os.path.join(video_dir, source)
            if os.path.exists(source):
                media_path = source

    job = await sjm.start_subtitle_translate(
        subtitle_id=subtitle_id,
        media_id=subtitle["media_id"],
        media_type=subtitle["media_type"],
        source_lang=body.source_lang,
        target_lang=body.target_lang,
        provider=provider,
        api_key=api_key,
        model=body.model,
        context_window=body.context_window,
        context_overlap=body.context_overlap,
        context=body.context,
        media_path=media_path,
    )

    return {"job_id": job.job_id, "status": "running"}


class AnalyzeRequest(BaseModel):
    provider: str = ""
    model: str = ""


@router.post("/{subtitle_id}/analyze")
async def analyze_video_context_endpoint(subtitle_id: int, body: AnalyzeRequest = Body(...)):
    """Analyze video frames + audio to generate translation context."""
    subtitle = await db.get_subtitle(subtitle_id)
    if not subtitle:
        raise HTTPException(404, "Subtitle not found")

    if subtitle["media_type"] != "video":
        raise HTTPException(400, "Video analysis is only available for video subtitles")

    # Resolve media path
    video = await db.get_video(subtitle["media_id"])
    if not video or video.get("type") != "local":
        raise HTTPException(400, "Video file not found")

    source = video["source"]
    video_dir = os.path.join(_data_dir, "videos")
    if not os.path.isabs(source):
        source = os.path.join(video_dir, source)
    if not os.path.exists(source):
        raise HTTPException(400, f"Video file does not exist: {source}")

    # Get provider + API key
    settings = await db.get_settings()
    provider = body.provider or settings.get("default_provider", "")
    if not provider:
        raise HTTPException(400, "No provider configured")
    api_keys = settings.get("api_keys", {})
    if isinstance(api_keys, str):
        api_keys = json.loads(api_keys)
    api_key = api_keys.get(provider, "")
    NO_KEY_PROVIDERS = {"claude_oauth"}
    if not api_key and provider not in NO_KEY_PROVIDERS:
        raise HTTPException(400, f"No API key for provider: {provider}")

    # Get STT texts
    segments = await db.get_subtitle_segments(subtitle_id)
    stt_texts = [s["original_text"] for s in segments if s.get("original_text")]

    # Run analysis (blocking but fast enough ~5-10s)
    from ..video_analyzer import extract_sample_frames, extract_audio_sample, analyze_video_context

    frames = extract_sample_frames(source, count=6)
    if not frames:
        raise HTTPException(500, "Failed to extract frames from video")

    audio_sample = extract_audio_sample(source, duration_sec=30)
    model = body.model or ""
    result = analyze_video_context(frames, stt_texts, provider, api_key, model, audio_sample=audio_sample)

    if not result or not result.strip():
        raise HTTPException(500, "Video analysis returned empty result")

    return {"context": result.strip()}


@router.get("/translate/{job_id}/status")
async def translate_status(job_id: str):
    """SSE stream for translation job progress."""
    job = sjm.get_job(job_id)
    if not job:
        db_job = await db.get_subtitle_job(job_id)
        if db_job:
            return {"status": db_job["status"], "progress": db_job["progress"],
                    "error_message": db_job.get("error_message", "")}
        raise HTTPException(404, "Job not found")

    q = job.add_sse_listener()

    async def event_generator():
        try:
            yield f"data: {json.dumps({'event': 'init', 'data': {'status': job.status, 'progress': job.progress}})}\n\n"
            while True:
                try:
                    msg = await asyncio.wait_for(q.get(), timeout=30)
                    yield f"data: {json.dumps(msg)}\n\n"
                    if msg.get("event") in ("complete", "error", "cancelled"):
                        break
                except asyncio.TimeoutError:
                    yield f"data: {json.dumps({'event': 'heartbeat', 'data': {}})}\n\n"
                    if job.status != "running":
                        break
        finally:
            job.remove_sse_listener(q)

    return StreamingResponse(event_generator(), media_type="text/event-stream")


# --- Segments CRUD ---

@router.get("/{subtitle_id}/segments")
async def get_segments(subtitle_id: int):
    """Get all segments for a subtitle."""
    subtitle = await db.get_subtitle(subtitle_id)
    if not subtitle:
        raise HTTPException(404, "Subtitle not found")
    segments = await db.get_subtitle_segments(subtitle_id)
    return {"segments": segments, "subtitle": subtitle}


@router.put("/segments/{segment_id}")
async def update_segment(segment_id: int, body: SegmentUpdate):
    """Update a single segment."""
    fields = body.model_dump(exclude_none=True)
    # pos_x/pos_y: allow explicit null (reset to default position)
    provided = body.model_fields_set
    for pos_field in ("pos_x", "pos_y"):
        if pos_field in provided:
            fields[pos_field] = getattr(body, pos_field)  # None or float
    if "original_text" in fields or "translated_text" in fields:
        fields["edited"] = 1
    updated = await db.update_subtitle_segment(segment_id, **fields)
    if not updated:
        raise HTTPException(404, "Segment not found")
    return updated


class BulkPositionUpdate(BaseModel):
    pos_x: Optional[float] = None
    pos_y: Optional[float] = None


@router.put("/{subtitle_id}/segments/position")
async def bulk_update_position(subtitle_id: int, body: BulkPositionUpdate):
    """Update pos_x/pos_y for ALL segments of a subtitle."""
    from ..db import get_db
    async with get_db() as conn:
        await conn.execute(
            "UPDATE subtitle_segments SET pos_x = ?, pos_y = ? WHERE subtitle_id = ?",
            (body.pos_x, body.pos_y, subtitle_id),
        )
        await conn.commit()
        rows = await conn.execute_fetchall(
            "SELECT * FROM subtitle_segments WHERE subtitle_id = ? ORDER BY seq",
            (subtitle_id,),
        )
    return {"segments": [dict(r) for r in rows]}


@router.post("/{subtitle_id}/segments")
async def create_segment(subtitle_id: int, body: SegmentCreate):
    """Create a new segment in a subtitle."""
    subtitle = await db.get_subtitle(subtitle_id)
    if not subtitle:
        raise HTTPException(404, "Subtitle not found")
    seg = await db.create_subtitle_segment(
        subtitle_id=subtitle_id,
        start_time=body.start_time,
        end_time=body.end_time,
        original_text=body.original_text,
        translated_text=body.translated_text,
    )
    await db.reorder_subtitle_segments(subtitle_id)
    return seg


@router.delete("/segments/{segment_id}")
async def delete_segment(segment_id: int):
    """Delete a single segment."""
    subtitle_id = await db.delete_subtitle_segment(segment_id)
    if subtitle_id is None:
        raise HTTPException(404, "Segment not found")
    await db.reorder_subtitle_segments(subtitle_id)
    return {"ok": True}


@router.post("/segments/{segment_id}/split")
async def split_segment(segment_id: int, body: SegmentSplit):
    """Split a segment at the given time. Copies text to both halves."""
    from ..db import get_db
    async with get_db() as conn:
        rows = await conn.execute_fetchall(
            "SELECT * FROM subtitle_segments WHERE id = ?", (segment_id,)
        )
    if not rows:
        raise HTTPException(404, "Segment not found")
    existing = dict(rows[0])

    if body.split_time <= existing["start_time"] or body.split_time >= existing["end_time"]:
        raise HTTPException(400, "Split time must be within segment bounds")

    subtitle_id = existing["subtitle_id"]

    # Update original segment to end at split point
    await db.update_subtitle_segment(segment_id, end_time=body.split_time)

    # Create new segment from split point to original end
    new_seg = await db.create_subtitle_segment(
        subtitle_id=subtitle_id,
        start_time=body.split_time,
        end_time=existing["end_time"],
        original_text=existing.get("original_text", ""),
        translated_text=existing.get("translated_text", ""),
    )
    await db.reorder_subtitle_segments(subtitle_id)
    return new_seg


# --- Export ---

@router.post("/{subtitle_id}/export")
async def export_subtitle(subtitle_id: int, body: ExportRequest):
    """Export subtitle as SRT/VTT/ASS."""
    subtitle = await db.get_subtitle(subtitle_id)
    if not subtitle:
        raise HTTPException(404, "Subtitle not found")

    db_segments = await db.get_subtitle_segments(subtitle_id)
    if not db_segments:
        raise HTTPException(400, "No segments to export")

    segments = [
        Segment(
            seq=s["seq"],
            start_time=s["start_time"],
            end_time=s["end_time"],
            original_text=s.get("original_text", ""),
            translated_text=s.get("translated_text", ""),
            confidence=s.get("confidence", 0),
            pos_x=s.get("pos_x"),
            pos_y=s.get("pos_y"),
        )
        for s in db_segments
    ]

    fmt = body.format.lower()
    if fmt == "srt":
        content = segments_to_srt(segments, use_translated=body.use_translated)
        media_type = "application/x-subrip"
        ext = "srt"
    elif fmt == "vtt":
        content = segments_to_vtt(segments, use_translated=body.use_translated)
        media_type = "text/vtt"
        ext = "vtt"
    elif fmt == "ass":
        content = segments_to_ass(
            segments, use_translated=body.use_translated,
            title=subtitle.get("label", "Untitled"),
            font_name=body.font_name,
            font_size=body.font_size,
            primary_color=body.primary_color,
            outline_color=body.outline_color,
            alignment=body.alignment,
            margin_v=body.margin_v,
        )
        media_type = "text/x-ssa"
        ext = "ass"
    else:
        raise HTTPException(400, f"Unsupported format: {fmt}")

    filename = f"subtitle_{subtitle_id}.{ext}"
    return Response(
        content=content.encode("utf-8-sig" if fmt == "srt" else "utf-8"),
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# --- Auto Sync (FFT-based) ---


@router.post("/{subtitle_id}/sync")
async def start_sync(subtitle_id: int):
    """Start FFT-based auto-sync job."""
    subtitle = await db.get_subtitle(subtitle_id)
    if not subtitle:
        raise HTTPException(404, "Subtitle not found")

    segments = await db.get_subtitle_segments(subtitle_id)
    if not segments:
        raise HTTPException(400, "No segments to sync")

    media_id = subtitle["media_id"]
    media_type = subtitle["media_type"]

    # Find extracted audio file
    audio_dir = os.path.join(_data_dir, "audio_extracted")
    audio_path = os.path.join(audio_dir, f"{media_type}_{media_id}.wav")
    if not os.path.isfile(audio_path):
        raise HTTPException(400, "Audio not extracted yet. Run 'Extract Audio' first.")

    job = await sjm.start_sync(subtitle_id, media_id, media_type, audio_path)
    return {"job_id": job.job_id, "status": job.status}


@router.get("/sync/{job_id}/status")
async def sync_status_sse(job_id: str):
    """SSE stream for sync job progress."""
    job = sjm.get_job(job_id)
    if not job:
        raise HTTPException(404, "Job not found")

    q = job.add_sse_listener()

    async def event_generator():
        try:
            yield f"data: {json.dumps({'event': 'init', 'data': {'status': job.status, 'progress': job.progress}})}\n\n"
            while True:
                try:
                    msg = await asyncio.wait_for(q.get(), timeout=30)
                    yield f"data: {json.dumps(msg)}\n\n"
                    if msg.get("event") in ("complete", "error", "cancelled"):
                        break
                except asyncio.TimeoutError:
                    yield f"data: {json.dumps({'event': 'heartbeat', 'data': {}})}\n\n"
                    if job.status != "running":
                        break
        finally:
            job.remove_sse_listener(q)

    return StreamingResponse(event_generator(), media_type="text/event-stream")


# --- Hardsub (burn-in) ---

@router.post("/{subtitle_id}/hardsub")
async def start_hardsub(subtitle_id: int, body: HardsubRequest = Body(default_factory=HardsubRequest)):
    """Start hardsub (subtitle burn-in) export job."""
    subtitle = await db.get_subtitle(subtitle_id)
    if not subtitle:
        raise HTTPException(404, "Subtitle not found")

    segments = await db.get_subtitle_segments(subtitle_id)
    if not segments:
        raise HTTPException(400, "No segments to burn in")

    media_id = subtitle["media_id"]
    media_type = subtitle["media_type"]

    # Locate the original media file
    if media_type == "video":
        video = await db.get_video(media_id)
        if not video:
            raise HTTPException(404, "Video not found")
        source = video["source"]
        if video["type"] != "local":
            raise HTTPException(400, "Hardsub only works for local video files")
        video_dir = os.path.join(_data_dir, "videos")
        if not os.path.isabs(source):
            source = os.path.join(video_dir, source)
    else:
        raise HTTPException(400, "Hardsub is only available for video media")

    if not os.path.exists(source):
        raise HTTPException(404, f"Source file not found: {source}")

    style_options = {
        "font_name": body.font_name,
        "font_size": body.font_size,
        "primary_color": body.primary_color,
        "outline_color": body.outline_color,
        "alignment": body.alignment,
        "margin_v": body.margin_v,
        "outline_width": body.outline_width,
    }

    job = await sjm.start_hardsub(
        subtitle_id=subtitle_id,
        media_id=media_id,
        media_type=media_type,
        media_path=source,
        style_options=style_options,
    )

    return {"job_id": job.job_id, "status": "running"}


@router.get("/hardsub/{job_id}/status")
async def hardsub_status(job_id: str):
    """SSE stream for hardsub job progress."""
    job = sjm.get_job(job_id)
    if not job:
        db_job = await db.get_subtitle_job(job_id)
        if db_job:
            return {"status": db_job["status"], "progress": db_job["progress"],
                    "error_message": db_job.get("error_message", "")}
        raise HTTPException(404, "Job not found")

    q = job.add_sse_listener()

    async def event_generator():
        try:
            yield f"data: {json.dumps({'event': 'init', 'data': {'status': job.status, 'progress': job.progress}})}\n\n"
            while True:
                try:
                    msg = await asyncio.wait_for(q.get(), timeout=30)
                    yield f"data: {json.dumps(msg)}\n\n"
                    if msg.get("event") in ("complete", "error", "cancelled"):
                        break
                except asyncio.TimeoutError:
                    yield f"data: {json.dumps({'event': 'heartbeat', 'data': {}})}\n\n"
                    if job.status != "running":
                        break
        finally:
            job.remove_sse_listener(q)

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.get("/hardsub/{job_id}/download")
async def download_hardsub(job_id: str):
    """Download completed hardsub video file."""
    # Check in-memory job first
    job = sjm.get_job(job_id)
    if not job:
        raise HTTPException(404, "Job not found")

    if job.status != "completed":
        raise HTTPException(400, f"Job not complete (status: {job.status})")

    # Find the output file
    output_dir = sjm.HARDSUB_OUTPUT_DIR
    # Match pattern: hardsub_{subtitle_id}_{job_id[:8]}.mp4
    prefix = f"hardsub_{job.subtitle_id}_{job_id[:8]}"
    output_path = os.path.join(output_dir, f"{prefix}.mp4")

    if not os.path.exists(output_path):
        raise HTTPException(404, "Output file not found")

    return FileResponse(
        output_path,
        media_type="video/mp4",
        filename=f"hardsub_{job.subtitle_id}.mp4",
    )


# --- Import ---

@router.post("/import")
async def import_subtitle(
    media_id: int,
    media_type: str,
    file: UploadFile = File(...),
    label: str = "",
    source_lang: str = "",
):
    """Import SRT/VTT/ASS file as a new subtitle."""
    content = (await file.read()).decode("utf-8-sig", errors="replace")

    fmt, segments = detect_and_parse(content)
    if not segments:
        raise HTTPException(400, "Could not parse subtitle file. Supported: SRT, VTT, ASS")

    # Create subtitle record
    subtitle = await db.create_subtitle(
        media_id=media_id,
        media_type=media_type,
        label=label or file.filename or "",
        source_lang=source_lang,
        stt_provider="manual",
        status="transcribed",
    )

    # Insert segments
    db_segments = [
        {
            "seq": seg.seq,
            "start_time": seg.start_time,
            "end_time": seg.end_time,
            "original_text": seg.original_text,
        }
        for seg in segments
    ]
    count = await db.insert_subtitle_segments(subtitle["id"], db_segments)

    duration = segments[-1].end_time if segments else 0
    await db.update_subtitle(subtitle["id"], duration=duration, segment_count=count)

    return {
        "subtitle": await db.get_subtitle(subtitle["id"]),
        "segments_imported": count,
        "format": fmt,
    }


# --- Subtitle CRUD ---

@router.post("/create")
async def create_subtitle(body: dict):
    """Create a new empty subtitle record."""
    media_id = body.get("media_id")
    media_type = body.get("media_type")
    if not media_id or not media_type:
        raise HTTPException(400, "media_id and media_type required")

    subtitle = await db.create_subtitle(
        media_id=media_id,
        media_type=media_type,
        label=body.get("label", ""),
        source_lang=body.get("source_lang", ""),
        target_lang=body.get("target_lang", ""),
    )
    return subtitle


@router.get("/list/{media_type}/{media_id}")
async def list_subtitles(media_type: str, media_id: int):
    """List all subtitles for a media item."""
    subtitles = await db.list_subtitles(media_id=media_id, media_type=media_type)
    return {"subtitles": subtitles}


@router.delete("/{subtitle_id}")
async def delete_subtitle(subtitle_id: int):
    """Delete a subtitle and all its segments."""
    ok = await db.delete_subtitle(subtitle_id)
    if not ok:
        raise HTTPException(404, "Subtitle not found")
    return {"ok": True}


# --- Glossary CRUD ---

class GlossaryEntry(BaseModel):
    source: str
    target: str
    category: str = "general"


@router.get("/{subtitle_id}/glossary")
async def get_glossary(subtitle_id: int):
    """Get glossary entries for a subtitle."""
    entries = await db.get_subtitle_glossary(subtitle_id)
    return {"entries": entries}


@router.post("/{subtitle_id}/glossary")
async def upsert_glossary(subtitle_id: int, entry: GlossaryEntry):
    """Add or update a glossary entry."""
    result = await db.upsert_subtitle_glossary(
        subtitle_id, entry.source, entry.target, entry.category,
    )
    return result


@router.post("/{subtitle_id}/glossary/bulk")
async def bulk_upsert_glossary(subtitle_id: int, body: dict):
    """Bulk add/update glossary entries."""
    entries = body.get("entries", [])
    if not entries:
        raise HTTPException(400, "entries required")
    count = await db.bulk_upsert_subtitle_glossary(subtitle_id, entries)
    return {"count": count}


@router.delete("/glossary/{glossary_id}")
async def delete_glossary(glossary_id: int):
    """Delete a glossary entry."""
    ok = await db.delete_subtitle_glossary(glossary_id)
    if not ok:
        raise HTTPException(404, "Glossary entry not found")
    return {"ok": True}


# --- Waveform ---

@router.get("/waveform/{media_type}/{media_id}")
async def get_waveform(media_type: str, media_id: int, samples: int = 1000):
    """Extract audio waveform peak data for timeline visualization."""
    import struct
    import subprocess as sp

    # Find audio file
    audio_dir = AUDIO_EXTRACT_DIR
    pattern = f"{media_type}_{media_id}"
    audio_path = None
    if os.path.isdir(audio_dir):
        for f in os.listdir(audio_dir):
            if f.startswith(pattern):
                audio_path = os.path.join(audio_dir, f)
                break

    if not audio_path:
        # Try to find original media
        if media_type == "video":
            video = await db.get_video(media_id)
            if video and video.get("source"):
                audio_path = video["source"]
        elif media_type == "audio":
            audio = await db.get_audio_item(media_id)
            if audio and audio.get("source"):
                audio_path = audio["source"]

    if not audio_path or not os.path.exists(audio_path):
        raise HTTPException(404, "Audio file not found")

    # Use ffmpeg to extract raw PCM s16le mono
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise HTTPException(500, "ffmpeg not found")

    try:
        proc = sp.run(
            [ffmpeg, "-i", audio_path, "-ac", "1", "-ar", "8000",
             "-f", "s16le", "-acodec", "pcm_s16le", "-"],
            capture_output=True, timeout=60,
        )
        if proc.returncode != 0:
            raise HTTPException(500, "Failed to extract audio data")

        raw = proc.stdout
        total_samples = len(raw) // 2
        if total_samples == 0:
            return {"peaks": [], "duration": 0}

        # Downsample to requested number of peaks
        chunk_size = max(1, total_samples // samples)
        peaks = []
        for i in range(0, total_samples, chunk_size):
            end = min(i + chunk_size, total_samples)
            chunk = raw[i * 2:end * 2]
            if not chunk:
                break
            vals = struct.unpack(f"<{len(chunk)//2}h", chunk)
            peak = max(abs(v) for v in vals) / 32768.0
            peaks.append(round(peak, 3))

        duration = total_samples / 8000.0
        return {"peaks": peaks[:samples], "duration": duration}

    except sp.TimeoutExpired:
        raise HTTPException(500, "Waveform extraction timed out")


# --- Cancel job ---

@router.post("/job/{job_id}/cancel")
async def cancel_job(job_id: str):
    """Cancel a running subtitle job."""
    job = sjm.get_job(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    job.cancel_event.set()
    return {"ok": True}
