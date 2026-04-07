"""Translation preset CRUD endpoints."""

import json
import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, field_validator
from typing import Optional

from .. import db

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/presets", tags=["presets"])


def _validate_json_str(v: str, expected_type: type) -> str:
    """Validate that a string is valid JSON of expected type."""
    try:
        parsed = json.loads(v)
    except (json.JSONDecodeError, TypeError):
        raise ValueError(f"Invalid JSON: {v[:100]}")
    if not isinstance(parsed, expected_type):
        raise ValueError(f"Expected {expected_type.__name__}, got {type(parsed).__name__}")
    return v


class PresetCreate(BaseModel):
    name: str
    game_id: Optional[int] = None
    engine: str = ""
    provider: str = ""
    model: str = ""
    tone: str = ""
    glossary_json: str = "{}"
    instructions: str = ""
    use_memory: bool = True
    reference_pairs_json: str = "[]"

    @field_validator("glossary_json")
    @classmethod
    def validate_glossary(cls, v: str) -> str:
        return _validate_json_str(v, dict)

    @field_validator("reference_pairs_json")
    @classmethod
    def validate_reference_pairs(cls, v: str) -> str:
        return _validate_json_str(v, list)


class PresetUpdate(BaseModel):
    name: Optional[str] = None
    engine: Optional[str] = None
    provider: Optional[str] = None
    model: Optional[str] = None
    tone: Optional[str] = None
    glossary_json: Optional[str] = None
    instructions: Optional[str] = None
    use_memory: Optional[bool] = None
    reference_pairs_json: Optional[str] = None

    @field_validator("glossary_json")
    @classmethod
    def validate_glossary(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            return _validate_json_str(v, dict)
        return v

    @field_validator("reference_pairs_json")
    @classmethod
    def validate_reference_pairs(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            return _validate_json_str(v, list)
        return v


@router.get("")
async def list_presets(game_id: int = None, engine: str = None):
    return await db.list_presets(game_id=game_id, engine=engine)


@router.get("/{preset_id}")
async def get_preset(preset_id: int):
    preset = await db.get_preset(preset_id)
    if not preset:
        raise HTTPException(404, "Preset not found")
    return preset


@router.post("")
async def create_preset(body: PresetCreate):
    return await db.create_preset(
        name=body.name,
        game_id=body.game_id,
        engine=body.engine,
        provider=body.provider,
        model=body.model,
        tone=body.tone,
        glossary_json=body.glossary_json,
        instructions=body.instructions,
        use_memory=body.use_memory,
        reference_pairs_json=body.reference_pairs_json,
    )


@router.put("/{preset_id}")
async def update_preset(preset_id: int, body: PresetUpdate):
    preset = await db.get_preset(preset_id)
    if not preset:
        raise HTTPException(404, "Preset not found")
    fields = body.model_dump(exclude_none=True)
    return await db.update_preset(preset_id, **fields)


@router.delete("/{preset_id}")
async def delete_preset(preset_id: int):
    deleted = await db.delete_preset(preset_id)
    if not deleted:
        raise HTTPException(404, "Preset not found")
    return {"ok": True}
