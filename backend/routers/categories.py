"""Media categories REST API."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from .. import db

router = APIRouter(prefix="/api/categories", tags=["categories"])


class CategoryCreate(BaseModel):
    name: str
    media_type: str  # 'video' | 'audio'
    sort_order: int = 0


class CategoryUpdate(BaseModel):
    name: Optional[str] = None
    sort_order: Optional[int] = None


@router.get("")
async def list_categories(media_type: str = ""):
    cats = await db.list_categories(media_type)
    if media_type:
        counts = await db.count_items_by_category(media_type)
        for cat in cats:
            cat["item_count"] = counts.get(cat["id"], 0)
    return cats


@router.post("")
async def create_category(body: CategoryCreate):
    if body.media_type not in ("video", "audio", "manga"):
        raise HTTPException(400, "media_type must be 'video', 'audio', or 'manga'")
    return await db.create_category(
        name=body.name,
        media_type=body.media_type,
        sort_order=body.sort_order,
    )


@router.put("/{cat_id}")
async def update_category(cat_id: int, body: CategoryUpdate):
    existing = await db.get_category(cat_id)
    if not existing:
        raise HTTPException(404, "Category not found")
    fields = body.model_dump(exclude_none=True)
    return await db.update_category(cat_id, **fields)


@router.delete("/{cat_id}")
async def delete_category(cat_id: int):
    existing = await db.get_category(cat_id)
    if not existing:
        raise HTTPException(404, "Category not found")
    await db.clear_category_from_items(cat_id)
    await db.delete_category(cat_id)
    return {"ok": True}
