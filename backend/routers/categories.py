"""Media categories REST API."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, RootModel
from typing import Optional, Dict

from .. import db

router = APIRouter(prefix="/api/categories", tags=["categories"])


class GlossaryPayload(RootModel[Dict[str, str]]):
    root: Dict[str, str]


class CategoryCreate(BaseModel):
    name: str
    media_type: str  # 'video' | 'audio' | 'manga'
    sort_order: int = 0
    parent_id: Optional[int] = None


class CategoryUpdate(BaseModel):
    name: Optional[str] = None
    sort_order: Optional[int] = None
    parent_id: Optional[int] = None


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
    if body.parent_id is not None:
        parent = await db.get_category(body.parent_id)
        if not parent:
            raise HTTPException(400, "parent category not found")
        if parent["media_type"] != body.media_type:
            raise HTTPException(400, "parent media_type mismatch")
    return await db.create_category(
        name=body.name,
        media_type=body.media_type,
        sort_order=body.sort_order,
        parent_id=body.parent_id,
    )


@router.put("/{cat_id}")
async def update_category(cat_id: int, body: CategoryUpdate):
    existing = await db.get_category(cat_id)
    if not existing:
        raise HTTPException(404, "Category not found")
    fields = body.model_dump(exclude_unset=True)
    # If moving, validate parent
    if "parent_id" in fields and fields["parent_id"] is not None:
        if fields["parent_id"] == cat_id:
            raise HTTPException(400, "cannot be its own parent")
        parent = await db.get_category(fields["parent_id"])
        if not parent:
            raise HTTPException(400, "parent category not found")
        if parent["media_type"] != existing["media_type"]:
            raise HTTPException(400, "parent media_type mismatch")
        # Prevent making a descendant the new parent (cycle)
        descendants = await db.list_category_descendants(cat_id)
        if fields["parent_id"] in descendants:
            raise HTTPException(400, "cannot move into own descendant")
    return await db.update_category(cat_id, **fields)


@router.delete("/{cat_id}")
async def delete_category(cat_id: int):
    existing = await db.get_category(cat_id)
    if not existing:
        raise HTTPException(404, "Category not found")
    # delete_category itself cascades descendants and clears items
    await db.delete_category(cat_id)
    return {"ok": True}


@router.get("/{cat_id}/ancestors")
async def get_ancestors(cat_id: int):
    """Return breadcrumb path from root to this category (inclusive)."""
    existing = await db.get_category(cat_id)
    if not existing:
        raise HTTPException(404, "Category not found")
    return await db.get_category_ancestors(cat_id)


# --- Category Glossary ---

@router.get("/{cat_id}/glossary")
async def get_category_glossary(cat_id: int):
    existing = await db.get_category(cat_id)
    if not existing:
        raise HTTPException(404, "Category not found")
    return await db.get_category_glossary(cat_id)


@router.put("/{cat_id}/glossary")
async def put_category_glossary(cat_id: int, body: GlossaryPayload):
    existing = await db.get_category(cat_id)
    if not existing:
        raise HTTPException(404, "Category not found")
    await db.set_category_glossary(cat_id, body.root)
    return await db.get_category_glossary(cat_id)


@router.patch("/{cat_id}/glossary")
async def patch_category_glossary(cat_id: int, body: GlossaryPayload):
    existing = await db.get_category(cat_id)
    if not existing:
        raise HTTPException(404, "Category not found")
    return await db.upsert_category_glossary_terms(cat_id, body.root)
