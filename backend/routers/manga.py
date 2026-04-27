"""Manga library and translation REST API."""

import asyncio
import json
import logging
import os
import threading
import uuid

from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel
from typing import Optional

from .. import db
from ..sse_utils import sse_format as _sse_format
try:
    from ..license import require_license
except ImportError:
    from ..license_stub import require_license
from ..manga_store import (
    images_path, image_file, get_image_path, generate_thumbnail,
    delete_manga_files, thumbnail_file, list_images,
    reorder_images, delete_image, add_images,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/manga", tags=["manga"])

# --- Models ---


class MangaUpdate(BaseModel):
    title: str | None = None
    artist: str | None = None
    tags: str | None = None
    category_id: int | None = -1  # -1 means "not provided", None means "uncategorize"


class BulkMoveRequest(BaseModel):
    ids: list[int]
    category_id: int | None = None


class BulkDeleteRequest(BaseModel):
    ids: list[int]


class TranslatePageRequest(BaseModel):
    page: int
    model: str = "gemini-2.0-flash"
    detector: str = "gemini"  # "gemini" | "local"


class ReorderRequest(BaseModel):
    order: list[int]


def _ext_from_ct(content_type: str) -> str:
    ct_map = {"image/webp": "webp", "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/avif": "avif"}
    return ct_map.get(content_type.split(";")[0].strip(), "webp")


# --- Endpoints ---


@router.get("")
async def list_manga_items(search: str = "", source_type: str = ""):
    return await db.list_manga(search=search, source_type=source_type)


@router.get("/fonts")
async def list_fonts():
    """List available fonts for manga rendering."""
    from ..manga_renderer import list_fonts as _list_fonts
    return {"fonts": _list_fonts()}


@router.post("/fonts/{font_id}/download")
async def download_font(font_id: str):
    """Download a font file."""
    from ..manga_renderer import FONT_REGISTRY, FONTS_DIR
    info = FONT_REGISTRY.get(font_id)
    if not info:
        raise HTTPException(404, "Unknown font")

    dest = os.path.join(FONTS_DIR, info["file"])
    if os.path.isfile(dest):
        return {"ok": True, "message": "Already installed"}

    import httpx
    try:
        async with httpx.AsyncClient(timeout=120, follow_redirects=True) as client:
            resp = await client.get(info["url"])
            resp.raise_for_status()
            os.makedirs(FONTS_DIR, exist_ok=True)
            with open(dest, "wb") as f:
                f.write(resp.content)
        return {"ok": True}
    except Exception as e:
        raise HTTPException(500, f"Font download failed: {e}")


@router.post("/bulk-move")
async def bulk_move_manga(body: BulkMoveRequest):
    if not body.ids:
        raise HTTPException(400, "ids must not be empty")
    await db.bulk_move_manga(body.ids, body.category_id)
    return {"ok": True, "moved": len(body.ids)}


@router.post("/bulk-delete")
async def bulk_delete_manga(body: BulkDeleteRequest):
    if not body.ids:
        raise HTTPException(400, "ids must not be empty")
    deleted = 0
    for mid in body.ids:
        manga = await db.get_manga(mid)
        if manga:
            delete_manga_files(mid)
            await db.delete_manga(mid)
            deleted += 1
    return {"ok": True, "deleted": deleted}


@router.put("/{manga_id}")
async def update_manga_item(manga_id: int, body: MangaUpdate):
    manga = await db.get_manga(manga_id)
    if not manga:
        raise HTTPException(404, "Manga not found")
    fields = {}
    if body.title is not None:
        fields["title"] = body.title
    if body.artist is not None:
        fields["artist"] = body.artist
    if body.tags is not None:
        fields["tags"] = body.tags
    if body.category_id != -1:  # -1 means not provided
        fields["category_id"] = body.category_id
    if not fields:
        return manga
    return await db.update_manga(manga_id, **fields)


@router.post("/upload")
async def upload_manga(
    title: str = Form(...),
    files: list[UploadFile] = File(...),
):
    """Create a manga from uploaded image files."""
    if not files:
        raise HTTPException(400, "At least one image file is required")

    source_url = f"manual://{uuid.uuid4()}"
    manga = await db.create_manga(
        title=title,
        source_url=source_url,
        source_type="manual",
        page_count=0,
    )
    manga_id = manga["id"]

    # Save images
    image_list: list[tuple[bytes, str]] = []
    for f in files:
        data = await f.read()
        ext = _ext_from_ct(f.content_type or "image/webp")
        image_list.append((data, ext))

    page_count = add_images(manga_id, image_list)

    # Generate thumbnail from first image
    thumb = generate_thumbnail(manga_id)
    if thumb:
        await db.update_manga(manga_id, page_count=page_count, thumbnail_path=thumb)
    else:
        await db.update_manga(manga_id, page_count=page_count)

    return await db.get_manga(manga_id)


@router.post("/{manga_id}/images")
async def add_manga_images(manga_id: int, files: list[UploadFile] = File(...)):
    """Add images to an existing manga."""
    manga = await db.get_manga(manga_id)
    if not manga:
        raise HTTPException(404, "Manga not found")

    image_list: list[tuple[bytes, str]] = []
    for f in files:
        data = await f.read()
        ext = _ext_from_ct(f.content_type or "image/webp")
        image_list.append((data, ext))

    page_count = add_images(manga_id, image_list)
    await db.update_manga(manga_id, page_count=page_count)
    return await db.get_manga(manga_id)


@router.post("/{manga_id}/reorder")
async def reorder_manga_images(manga_id: int, body: ReorderRequest):
    """Reorder manga images. body.order is the new page order."""
    manga = await db.get_manga(manga_id)
    if not manga:
        raise HTTPException(404, "Manga not found")

    try:
        page_count = reorder_images(manga_id, body.order)
    except ValueError as e:
        raise HTTPException(400, str(e))

    await db.update_manga(manga_id, page_count=page_count)

    # Clear translation cache (order changed = translations invalid)
    async with db.get_db() as conn:
        await conn.execute("DELETE FROM manga_translations WHERE manga_id = ?", (manga_id,))
        await conn.commit()

    return await db.get_manga(manga_id)


@router.delete("/{manga_id}/images/{page}")
async def delete_manga_image(manga_id: int, page: int):
    """Delete a single image and reindex remaining pages."""
    manga = await db.get_manga(manga_id)
    if not manga:
        raise HTTPException(404, "Manga not found")

    try:
        page_count = delete_image(manga_id, page)
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))

    await db.update_manga(manga_id, page_count=page_count)

    # Regenerate thumbnail if page 1 was deleted
    if page == 1 and page_count > 0:
        thumb = generate_thumbnail(manga_id)
        if thumb:
            await db.update_manga(manga_id, thumbnail_path=thumb)

    # Clear translations for affected pages
    async with db.get_db() as conn:
        await conn.execute(
            "DELETE FROM manga_translations WHERE manga_id = ? AND page >= ?",
            (manga_id, page),
        )
        await conn.commit()

    return {"ok": True, "page_count": page_count}


@router.get("/{manga_id}")
async def get_manga_item(manga_id: int):
    manga = await db.get_manga(manga_id)
    if not manga:
        raise HTTPException(404, "Manga not found")
    # Include image list
    images = list_images(manga_id)
    manga["images"] = images
    return manga


@router.delete("/{manga_id}")
async def delete_manga_item(manga_id: int):
    manga = await db.get_manga(manga_id)
    if not manga:
        raise HTTPException(404, "Manga not found")
    delete_manga_files(manga_id)
    await db.delete_manga(manga_id)
    return {"ok": True}


@router.get("/{manga_id}/images/{page}")
async def serve_manga_image(manga_id: int, page: int):
    path = get_image_path(manga_id, page)
    if not path:
        raise HTTPException(404, "Image not found")
    # Detect media type from extension
    ext = os.path.splitext(path)[1].lower()
    media_types = {".webp": "image/webp", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif", ".avif": "image/avif"}
    return FileResponse(path, media_type=media_types.get(ext, "image/webp"))


@router.get("/{manga_id}/thumbnail")
async def serve_thumbnail(manga_id: int):
    thumb = thumbnail_file(manga_id)
    if not os.path.exists(thumb):
        # Try to generate on the fly
        generated = generate_thumbnail(manga_id)
        if not generated:
            raise HTTPException(404, "Thumbnail not found")
        thumb = generated
    return FileResponse(thumb, media_type="image/webp")


@router.post("/{manga_id}/thumbnail")
async def upload_manga_thumbnail(manga_id: int, file: UploadFile = File(...)):
    manga = await db.get_manga(manga_id)
    if not manga:
        raise HTTPException(404, "Manga not found")
    dest = thumbnail_file(manga_id)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    content = await file.read()
    # Save as webp (same path as auto-generated thumbnails)
    from PIL import Image
    import io
    img = Image.open(io.BytesIO(content))
    img.save(dest, "WEBP", quality=85)
    await db.update_manga(manga_id, thumbnail_path=dest)
    return await db.get_manga(manga_id)


@router.post("/{manga_id}/translate")
async def translate_manga_page(manga_id: int, body: TranslatePageRequest):
    """Translate a manga page using Gemini Vision API."""
    await require_license()
    manga = await db.get_manga(manga_id)
    if not manga:
        raise HTTPException(404, "Manga not found")

    # Check for cached translation
    existing = await db.get_manga_translation(manga_id, body.page)
    if existing and existing["translated_text"]:
        return {
            "cached": True,
            "translation": {
                "original_text": existing["original_text"],
                "translated_text": existing["translated_text"],
                "positions": json.loads(existing["positions_json"]),
            }
        }

    # Get image path
    img_path = get_image_path(manga_id, body.page)
    if not img_path:
        raise HTTPException(404, f"Image not found for page {body.page}")

    # Get API key from settings
    settings = await db.get_settings()
    api_keys = settings.get("api_keys", {})
    if isinstance(api_keys, str):
        import json as _json
        try:
            api_keys = _json.loads(api_keys)
        except Exception:
            api_keys = {}
    gemini_key = api_keys.get("gemini", "")
    if not gemini_key:
        raise HTTPException(400, "Gemini API key not configured. Set it in Settings > API Keys.")

    # Translate
    try:
        if body.detector == "local":
            from .. import local_pipeline
            result = await local_pipeline.detect_and_translate(img_path, gemini_key, model=body.model)
        else:
            from ..gemini_translator import translate_page
            result = await translate_page(img_path, gemini_key, model=body.model)
    except Exception as e:
        raise HTTPException(500, f"Translation failed: {e}")

    # Save translation
    entries = result["entries"]
    positions_json = json.dumps(entries, ensure_ascii=False)
    originals = "\n".join(e["original"] for e in entries)
    translations = "\n".join(e["translated"] for e in entries)

    await db.save_manga_translation(
        manga_id, body.page,
        original_text=originals,
        translated_text=translations,
        positions_json=positions_json,
    )

    return {
        "cached": False,
        "translation": {
            "original_text": originals,
            "translated_text": translations,
            "positions": entries,
        }
    }


@router.get("/{manga_id}/translation/{page}")
async def get_translation(manga_id: int, page: int):
    """Get cached translation for a page."""
    t = await db.get_manga_translation(manga_id, page)
    if not t:
        return {"exists": False}
    return {
        "exists": True,
        "translation": {
            "original_text": t["original_text"],
            "translated_text": t["translated_text"],
            "positions": json.loads(t["positions_json"]),
        }
    }


# --- Region-level translate (user draws box → OCR + translate) ---

class RegionTranslateRequest(BaseModel):
    page: int
    x: float          # 0-1 ratio
    y: float
    width: float
    height: float
    model: str = "gemini-2.0-flash"
    save: bool = True  # append to page positions


@router.post("/{manga_id}/translate-region")
async def translate_region(manga_id: int, body: RegionTranslateRequest):
    """Crop a region from the page image and OCR+translate it with Gemini."""
    await require_license()
    manga = await db.get_manga(manga_id)
    if not manga:
        raise HTTPException(404, "Manga not found")

    img_path = get_image_path(manga_id, body.page)
    if not img_path:
        raise HTTPException(404, f"Image not found for page {body.page}")

    from PIL import Image
    img = Image.open(img_path).convert("RGB")
    w, h = img.size

    x1 = max(0, int(body.x * w))
    y1 = max(0, int(body.y * h))
    x2 = min(w, int((body.x + body.width) * w))
    y2 = min(h, int((body.y + body.height) * h))
    if x2 - x1 < 4 or y2 - y1 < 4:
        raise HTTPException(400, "Region too small")

    crop = img.crop((x1, y1, x2, y2))

    # Save crop to temp file and send to Gemini
    import io, base64
    buf = io.BytesIO()
    crop.save(buf, "JPEG", quality=92)
    b64 = base64.b64encode(buf.getvalue()).decode()

    settings = await db.get_settings()
    gemini_key = (settings or {}).get("api_keys", {}).get("gemini", "") or os.environ.get("GEMINI_API_KEY", "")
    if not gemini_key:
        raise HTTPException(400, "Gemini API key not configured")

    prompt = """이 이미지의 텍스트를 인식하고 한국어로 번역해주세요.
아래 JSON 형식으로만 반환하세요:
{"original": "원문", "translated": "한국어 번역", "direction": "horizontal"}
텍스트가 세로 방향이면 "vertical", 가로면 "horizontal"."""

    url = f"https://generativelanguage.googleapis.com/v1beta/models/{body.model}:generateContent?key={gemini_key}"
    payload = {
        "contents": [{"parts": [
            {"inlineData": {"mimeType": "image/jpeg", "data": b64}},
            {"text": prompt},
        ]}],
        "generationConfig": {"temperature": 0.1, "maxOutputTokens": 512},
    }

    import httpx
    from ..gemini_translator import _post_with_retry
    async with httpx.AsyncClient(timeout=60) as client:
        data = await _post_with_retry(client, url, json=payload)

    raw = data["candidates"][0]["content"]["parts"][0]["text"].strip()
    # Parse JSON from response
    import re as _re
    m = _re.search(r'\{.*\}', raw, _re.DOTALL)
    if not m:
        raise HTTPException(500, f"Unexpected Gemini response: {raw[:200]}")
    entry = json.loads(m.group())

    result = {
        "original": entry.get("original", ""),
        "translated": entry.get("translated", ""),
        "x": body.x,
        "y": body.y,
        "width": body.width,
        "height": body.height,
        "direction": entry.get("direction", "horizontal"),
        "text_color": "#000000",
        "bg_type": "solid",
    }

    if body.save:
        # Append to existing page positions
        existing = await db.get_manga_translation(manga_id, body.page)
        positions = json.loads(existing["positions_json"]) if existing and existing.get("positions_json") else []
        positions.append(result)
        originals = "\n".join(p["original"] for p in positions)
        translations = "\n".join(p["translated"] for p in positions)
        await db.save_manga_translation(manga_id, body.page,
            original_text=originals,
            translated_text=translations,
            positions_json=json.dumps(positions, ensure_ascii=False),
        )

    return result


# --- Translation Position Editing ---

class PositionEntry(BaseModel):
    original: str = ""
    translated: str = ""
    x: float = 0
    y: float = 0
    width: float = 0
    height: float = 0
    direction: str = "horizontal"
    text_color: str = ""
    bg_type: str = ""
    polygon: list = []


class UpdatePositionsRequest(BaseModel):
    positions: list[PositionEntry]


@router.patch("/{manga_id}/translation/{page}")
async def update_translation_positions(manga_id: int, page: int, body: UpdatePositionsRequest):
    """Update (patch) translation positions for a page. Used by region editor."""
    t = await db.get_manga_translation(manga_id, page)
    if not t:
        raise HTTPException(404, "Translation not found. Translate the page first.")

    entries = [p.model_dump() for p in body.positions]
    positions_json = json.dumps(entries, ensure_ascii=False)
    originals = "\n".join(e["original"] for e in entries)
    translations = "\n".join(e["translated"] for e in entries)

    await db.save_manga_translation(manga_id, page,
        original_text=originals,
        translated_text=translations,
        positions_json=positions_json,
    )
    return {"ok": True, "count": len(entries)}


# --- Rendering (Inpainting + Text) ---

_data_dir = os.environ.get("GT_DATA_DIR") or os.path.join(os.path.dirname(__file__), "..", "..", "data")
RENDERED_DIR = os.path.join(_data_dir, "manga_rendered")
os.makedirs(RENDERED_DIR, exist_ok=True)

# Batch render job tracking
_render_jobs: dict[str, dict] = {}
_render_lock = threading.Lock()


class RenderRequest(BaseModel):
    inpaint_mode: str = "telea"
    font_id: str = "noto-sans-kr"
    auto_color: bool = True
    outline_enabled: bool = True
    outline_width: int = 2
    direction: str = "auto"


@router.post("/{manga_id}/render/{page}")
async def render_page(manga_id: int, page: int, body: RenderRequest = RenderRequest()):
    """Render a single manga page with inpainting + translated text."""
    manga = await db.get_manga(manga_id)
    if not manga:
        raise HTTPException(404, "Manga not found")

    # Get translation
    trans = await db.get_manga_translation(manga_id, page)
    if not trans or not trans["positions_json"]:
        raise HTTPException(400, "Page not translated yet. Translate first.")

    # Get image path
    img_path = get_image_path(manga_id, page)
    if not img_path:
        raise HTTPException(404, f"Image not found for page {page}")

    positions = json.loads(trans["positions_json"])

    # Convert to TextRegion objects
    from ..manga_renderer import TextRegion, RenderConfig, render_page as do_render

    regions = [
        TextRegion(
            original=p.get("original", ""),
            translated=p.get("translated", ""),
            x=p.get("x", 0),
            y=p.get("y", 0),
            width=p.get("width", 0),
            height=p.get("height", 0),
            direction=p.get("direction", "horizontal"),
            polygon=p.get("polygon", []),
            text_color=p.get("text_color", ""),
            bg_type=p.get("bg_type", ""),
        )
        for p in positions
    ]

    config = RenderConfig(
        inpaint_mode=body.inpaint_mode,
        font_id=body.font_id,
        auto_color=body.auto_color,
        outline_enabled=body.outline_enabled,
        outline_width=body.outline_width,
        direction=body.direction,
    )

    # Output path
    output_dir = os.path.join(RENDERED_DIR, str(manga_id))
    os.makedirs(output_dir, exist_ok=True)
    output_path = os.path.join(output_dir, f"{page:04d}.webp")

    # Run rendering (CPU-bound, run in thread)
    await asyncio.to_thread(do_render, img_path, regions, config, output_path)

    # Save to DB
    await db.save_manga_render(manga_id, page, body.inpaint_mode, body.font_id, output_path)

    return {
        "rendered_path": output_path,
        "inpaint_mode": body.inpaint_mode,
        "font_id": body.font_id,
    }


@router.post("/{manga_id}/render-all")
async def render_all_pages(manga_id: int, body: RenderRequest = RenderRequest()):
    """Start batch rendering of all translated pages (SSE progress)."""
    manga = await db.get_manga(manga_id)
    if not manga:
        raise HTTPException(404, "Manga not found")

    job_id = str(uuid.uuid4())[:8]

    with _render_lock:
        _render_jobs[f"{manga_id}"] = {
            "job_id": job_id,
            "status": "running",
            "progress": 0,
            "total": 0,
            "done": 0,
            "cancel": threading.Event(),
        }

    # Start background thread
    loop = asyncio.get_event_loop()
    thread = threading.Thread(
        target=_run_batch_render,
        args=(manga_id, body, job_id, loop),
        daemon=True,
    )
    thread.start()

    return {"job_id": job_id, "status": "running"}


def _run_batch_render(manga_id: int, body: RenderRequest, job_id: str, loop):
    """Batch render all translated pages in background."""
    from ..manga_renderer import TextRegion, RenderConfig, render_page as do_render

    job = _render_jobs.get(f"{manga_id}")
    if not job:
        return

    try:
        # Get all translations
        import asyncio

        translations_raw = asyncio.run_coroutine_threadsafe(
            _get_all_translations(manga_id), loop
        ).result(timeout=30)

        if not translations_raw:
            job["status"] = "completed"
            job["progress"] = 1.0
            return

        job["total"] = len(translations_raw)

        config = RenderConfig(
            inpaint_mode=body.inpaint_mode,
            font_id=body.font_id,
            auto_color=body.auto_color,
            outline_enabled=body.outline_enabled,
            outline_width=body.outline_width,
            direction=body.direction,
        )

        output_dir = os.path.join(RENDERED_DIR, str(manga_id))
        os.makedirs(output_dir, exist_ok=True)

        for i, (page, trans) in enumerate(translations_raw):
            if job["cancel"].is_set():
                job["status"] = "cancelled"
                return

            positions = json.loads(trans["positions_json"])
            img_path = get_image_path(manga_id, page)
            if not img_path:
                continue

            regions = [
                TextRegion(
                    original=p.get("original", ""),
                    translated=p.get("translated", ""),
                    x=p.get("x", 0), y=p.get("y", 0),
                    width=p.get("width", 0), height=p.get("height", 0),
                    direction=p.get("direction", "horizontal"),
                    polygon=p.get("polygon", []),
                    text_color=p.get("text_color", ""),
                    bg_type=p.get("bg_type", ""),
                )
                for p in positions
            ]

            output_path = os.path.join(output_dir, f"{page:04d}.webp")
            do_render(img_path, regions, config, output_path)

            asyncio.run_coroutine_threadsafe(
                db.save_manga_render(manga_id, page, body.inpaint_mode, body.font_id, output_path),
                loop,
            )

            job["done"] = i + 1
            job["progress"] = (i + 1) / len(translations_raw)

        job["status"] = "completed"
        job["progress"] = 1.0

    except Exception as e:
        logger.error("Batch render failed: %s", e)
        job["status"] = "error"
        job["error"] = str(e)


async def _get_all_translations(manga_id: int) -> list[tuple[int, dict]]:
    """Get all translated pages for a manga."""
    async with db.get_db() as conn:
        rows = await conn.execute_fetchall(
            "SELECT * FROM manga_translations WHERE manga_id = ? AND translated_text != '' ORDER BY page ASC",
            (manga_id,),
        )
        return [(r["page"], dict(r)) for r in rows]


@router.get("/{manga_id}/render-all/status")
async def render_all_status(manga_id: int):
    """SSE stream for batch render progress."""
    job = _render_jobs.get(f"{manga_id}")
    if not job:
        raise HTTPException(404, "No active render job")

    async def event_stream():
        while True:
            data = {
                "status": job["status"],
                "progress": job.get("progress", 0),
                "done": job.get("done", 0),
                "total": job.get("total", 0),
            }
            if job.get("error"):
                data["error"] = job["error"]

            yield _sse_format("status", data)

            if job["status"] in ("completed", "error", "cancelled"):
                return

            await asyncio.sleep(0.5)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
    )


@router.get("/{manga_id}/rendered/{page}")
async def serve_rendered_image(manga_id: int, page: int):
    """Serve a rendered manga page image."""
    rendered = await db.get_manga_render(manga_id, page)
    if not rendered or not rendered["rendered_path"]:
        raise HTTPException(404, "Rendered image not found")
    path = rendered["rendered_path"]
    if not os.path.isfile(path):
        # Try fallback path
        path = os.path.join(RENDERED_DIR, str(manga_id), f"{page:04d}.webp")
        if not os.path.isfile(path):
            raise HTTPException(404, "Rendered image file not found")
    return FileResponse(path, media_type="image/webp")


@router.get("/{manga_id}/render-status")
async def render_status(manga_id: int):
    """Get render status for all pages of a manga."""
    manga = await db.get_manga(manga_id)
    if not manga:
        raise HTTPException(404, "Manga not found")

    renders = await db.list_manga_renders(manga_id)
    pages = {}
    for r in renders:
        pages[r["page"]] = {
            "rendered": True,
            "inpaint_mode": r["inpaint_mode"],
            "font_id": r["font_id"],
        }

    return {
        "manga_id": manga_id,
        "total_pages": manga["page_count"],
        "rendered_pages": len(renders),
        "pages": pages,
    }


