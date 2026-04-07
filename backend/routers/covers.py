"""Cover art fetch/search/select endpoints."""

import asyncio
import logging
import os
from fastapi import APIRouter, HTTPException, UploadFile, File
from pydantic import BaseModel
from typing import Optional

from .. import db
from .. import cover_fetcher

logger = logging.getLogger(__name__)

router = APIRouter(tags=["covers"])

MAX_IMAGE_SIZE = 10 * 1024 * 1024  # 10 MB

# --- Game-specific cover routes ---
game_router = APIRouter(prefix="/api/games/{game_id}/cover", tags=["covers"])


class CoverFetchRequest(BaseModel):
    search_term: Optional[str] = None


class CoverSearchRequest(BaseModel):
    query: str
    sources: list[str] = ["vndb", "dlsite", "web"]


class CoverSelectRequest(BaseModel):
    url: str
    source: str
    external_id: Optional[str] = None


@game_router.post("/fetch")
async def fetch_cover(game_id: int, body: CoverFetchRequest = CoverFetchRequest()):
    """Auto-fetch best matching cover art."""
    game = await db.get_game(game_id)
    if not game:
        raise HTTPException(404, "Game not found")

    search_term = body.search_term or game["title"]
    result = await cover_fetcher.auto_fetch_cover(
        game_id=game_id,
        game_title=search_term,
        game_path=game.get("path", ""),
    )

    if result["cover_path"]:
        update_fields = {
            "cover_path": result["cover_path"],
            "cover_source": result["source"],
            "vndb_id": result.get("vndb_id", ""),
            "dlsite_id": result.get("dlsite_id", ""),
        }
        if result.get("developer"):
            update_fields["developer"] = result["developer"]

        await db.update_game(game_id, **update_fields)
        return {
            "cover_url": f"/api/covers/{game_id}.jpg",
            "source": result["source"],
            "vndb_id": result.get("vndb_id", ""),
            "dlsite_id": result.get("dlsite_id", ""),
            "developer": result.get("developer", ""),
        }

    raise HTTPException(404, "No cover art found")


@game_router.post("/search")
async def search_covers(game_id: int, body: CoverSearchRequest):
    """Search for cover art candidates without downloading."""
    results = []

    if "vndb" in body.sources:
        vndb_results = await cover_fetcher.search_vndb(body.query, limit=8)
        for r in vndb_results:
            results.append({
                "url": r["cover_url"],
                "thumbnail_url": r.get("thumbnail_url", r["cover_url"]),
                "title": r["title"],
                "source": "vndb",
                "external_id": r["vndb_id"],
                "sexual": r.get("sexual", 0),
                "violence": r.get("violence", 0),
                "developer": r.get("developer", ""),
            })

    if "dlsite" in body.sources:
        # Try DLsite ID detection first
        game = await db.get_game(game_id)
        if game and game.get("path"):
            dlsite_id = cover_fetcher.detect_dlsite_id(game["path"])
            if dlsite_id:
                product = await cover_fetcher.fetch_dlsite_product(dlsite_id)
                if product and product.get("cover_url"):
                    results.append({
                        "url": product["cover_url"],
                        "thumbnail_url": product["cover_url"],
                        "title": product["title"],
                        "source": "dlsite",
                        "external_id": dlsite_id,
                        "sexual": 0,
                        "violence": 0,
                        "developer": product.get("maker", ""),
                    })
        # Also do keyword search on DLsite
        dlsite_results = await cover_fetcher.search_dlsite(body.query, limit=5)
        seen_ids = {r.get("external_id") for r in results}
        for r in dlsite_results:
            if r["dlsite_id"] not in seen_ids and r.get("cover_url"):
                results.append({
                    "url": r["cover_url"],
                    "thumbnail_url": r["cover_url"],
                    "title": r["title"],
                    "source": "dlsite",
                    "external_id": r["dlsite_id"],
                    "sexual": 0,
                    "violence": 0,
                    "developer": r.get("maker", ""),
                })

    if "web" in body.sources:
        web_results = await cover_fetcher.search_web_images(body.query, limit=5)
        for r in web_results:
            results.append({
                "url": r["url"],
                "thumbnail_url": r.get("thumbnail_url", r["url"]),
                "title": r.get("title", body.query),
                "source": "web",
                "external_id": "",
                "sexual": 0,
                "violence": 0,
                "developer": "",
            })

    return {"results": results}


@game_router.post("/select")
async def select_cover(game_id: int, body: CoverSelectRequest):
    """Download and set a specific cover art."""
    game = await db.get_game(game_id)
    if not game:
        raise HTTPException(404, "Game not found")

    save_path = os.path.join(cover_fetcher.COVERS_DIR, f"{game_id}.jpg")
    success = await cover_fetcher.download_image(body.url, save_path)
    if not success:
        raise HTTPException(500, "Failed to download cover image")

    update_fields = {
        "cover_path": save_path,
        "cover_source": body.source,
    }
    if body.source == "vndb" and body.external_id:
        update_fields["vndb_id"] = body.external_id
    elif body.source == "dlsite" and body.external_id:
        update_fields["dlsite_id"] = body.external_id

    await db.update_game(game_id, **update_fields)
    return {"cover_url": f"/api/covers/{game_id}.jpg", "source": body.source}


@game_router.post("/upload")
async def upload_cover(game_id: int, file: UploadFile = File(...)):
    """Upload a custom cover image from local file."""
    game = await db.get_game(game_id)
    if not game:
        raise HTTPException(404, "Game not found")

    # Validate file type
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(400, "File must be an image")

    save_path = os.path.join(cover_fetcher.COVERS_DIR, f"{game_id}.jpg")
    os.makedirs(os.path.dirname(save_path), exist_ok=True)

    try:
        from PIL import Image
        import io
        data = await file.read(MAX_IMAGE_SIZE + 1)
        if len(data) > MAX_IMAGE_SIZE:
            raise HTTPException(413, "Image too large (max 10 MB)")
        img = Image.open(io.BytesIO(data))
        # Convert to RGB for JPEG
        if img.mode in ("RGBA", "P", "LA"):
            bg = Image.new("RGB", img.size, (20, 19, 18))
            if img.mode == "P":
                img = img.convert("RGBA")
            if img.mode in ("RGBA", "LA"):
                bg.paste(img, mask=img.split()[-1])
                img = bg
        elif img.mode != "RGB":
            img = img.convert("RGB")
        img.save(save_path, "JPEG", quality=90)
    except Exception as e:
        logger.exception("Failed to process cover image for game %s", game_id)
        raise HTTPException(500, f"Failed to process image: {e}")

    await db.update_game(game_id, cover_path=save_path, cover_source="upload")
    return {"cover_url": f"/api/covers/{game_id}.jpg", "source": "upload"}


@game_router.delete("")
async def remove_cover(game_id: int):
    """Remove cover art."""
    game = await db.get_game(game_id)
    if not game:
        raise HTTPException(404, "Game not found")

    cover_path = os.path.join(cover_fetcher.COVERS_DIR, f"{game_id}.jpg")
    if os.path.exists(cover_path):
        os.remove(cover_path)

    await db.update_game(game_id, cover_path="", cover_source="")
    return {"ok": True}


# --- Batch cover operations ---
batch_router = APIRouter(prefix="/api/covers", tags=["covers"])


@batch_router.post("/fetch-all")
async def fetch_all_covers():
    """Auto-fetch covers for ALL games missing cover art (parallel, max 3 concurrent)."""
    games = await db.list_games()
    to_fetch = []
    for game in games:
        cover = game.get("cover_path", "")
        if cover and os.path.isfile(cover):
            continue
        to_fetch.append(game)

    if not to_fetch:
        return {"total": 0, "fetched": 0, "results": []}

    sem = asyncio.Semaphore(3)
    results = []

    async def _fetch_one(game: dict) -> dict:
        async with sem:
            try:
                result = await cover_fetcher.auto_fetch_cover(
                    game_id=game["id"],
                    game_title=game["title"],
                    game_path=game.get("path", ""),
                )
                if result["cover_path"]:
                    update_fields = {
                        "cover_path": result["cover_path"],
                        "cover_source": result["source"],
                        "vndb_id": result.get("vndb_id", ""),
                        "dlsite_id": result.get("dlsite_id", ""),
                    }
                    if result.get("developer"):
                        update_fields["developer"] = result["developer"]
                    await db.update_game(game["id"], **update_fields)
                    return {
                        "game_id": game["id"],
                        "title": game["title"],
                        "source": result["source"],
                        "developer": result.get("developer", ""),
                        "success": True,
                    }
                return {"game_id": game["id"], "title": game["title"], "success": False}
            except Exception as e:
                logger.warning("Cover fetch failed for game %s: %s", game["id"], e)
                return {"game_id": game["id"], "title": game["title"], "success": False, "error": str(e)}

    results = await asyncio.gather(*[_fetch_one(g) for g in to_fetch])

    return {
        "total": len(results),
        "fetched": sum(1 for r in results if r.get("success")),
        "results": list(results),
    }
