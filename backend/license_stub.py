"""License stub — replace with your own license verification logic."""

from fastapi import HTTPException


async def verify_license(force_refresh: bool = False) -> dict:
    """Stub: always returns valid. Replace with your own verification."""
    return {"valid": True, "plan": "open-source", "is_admin": False, "verified_at": ""}


async def require_license():
    """Stub: no-op dependency. Replace with your own license gate."""
    return {"valid": True, "plan": "open-source"}
