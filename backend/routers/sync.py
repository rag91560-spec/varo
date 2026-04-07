"""Sync local user data to server + admin proxy endpoints."""

import os
import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from .. import db

router = APIRouter(prefix="/api/sync", tags=["sync"])

SYNC_SERVER = "https://api.closedclaws.com"


async def _get_license_key() -> Optional[str]:
    settings = await db.get_settings()
    return settings.get("license_key") if isinstance(settings.get("license_key"), str) else None


async def _is_admin() -> bool:
    key = await _get_license_key()
    if not key:
        return False
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.post(
                f"{SYNC_SERVER}/api/license/verify",
                json={"key": key},
            )
            if r.status_code == 200:
                data = r.json()
                return data.get("is_admin", False)
    except Exception:
        pass
    return False


@router.post("")
async def sync_data():
    """Push local data to server for admin visibility."""
    key = await _get_license_key()
    if not key:
        raise HTTPException(400, "라이선스 키가 설정되지 않았습니다.")

    games = await db.list_games()
    tm_stats = await db.tm_stats()

    game_data = []
    for g in games:
        game_data.append({
            "title": g.get("title", ""),
            "engine": g.get("engine", ""),
            "string_count": g.get("string_count", 0),
            "translated_count": g.get("translated_count", 0),
            "status": g.get("status", ""),
            "developer": g.get("developer", ""),
            "vndb_id": g.get("vndb_id", ""),
            "dlsite_id": g.get("dlsite_id", ""),
        })

    version = "1.0.0"
    try:
        settings = await db.get_settings()
        version = settings.get("app_version", "1.0.0")
    except Exception:
        pass

    payload = {
        "license_key": key,
        "app_version": version,
        "games": game_data,
        "stats": {
            "game_count": len(games),
            "total_strings": sum(g.get("string_count", 0) for g in games),
            "total_translated": sum(g.get("translated_count", 0) for g in games),
            "tm_count": tm_stats.get("total", 0),
        },
    }

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.post(
                f"{SYNC_SERVER}/api/license/launcher/sync",
                json=payload,
            )
            if r.status_code != 200:
                raise HTTPException(r.status_code, r.text)
            result = r.json()
            # Store admin status locally
            if result.get("is_admin"):
                await db.put_settings({"is_admin": "true"})
            return result
    except httpx.HTTPError as e:
        raise HTTPException(502, f"서버 통신 실패: {e}")


def _parse_server_error(r) -> str:
    """Extract a clean error message from server response."""
    content_type = r.headers.get("content-type", "")
    if "json" in content_type:
        try:
            data = r.json()
            return data.get("error") or data.get("message") or str(data)
        except Exception:
            pass
    # HTML or other — don't dump raw HTML
    return f"서버 오류 ({r.status_code})"


@router.get("/admin/users")
async def admin_users():
    """Proxy admin user list from server."""
    key = await _get_license_key()
    if not key:
        raise HTTPException(401, "라이선스 키 필요")

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(
                f"{SYNC_SERVER}/api/license/launcher/admin/users",
                headers={"Authorization": f"Bearer {key}"},
            )
            if r.status_code == 403:
                raise HTTPException(403, "관리자 권한이 없습니다.")
            if r.status_code != 200:
                raise HTTPException(r.status_code, _parse_server_error(r))
            return r.json()
    except httpx.HTTPError as e:
        raise HTTPException(502, f"서버 통신 실패: {e}")


@router.get("/admin/users/{user_id}/games")
async def admin_user_games(user_id: int):
    """Proxy admin user games from server."""
    key = await _get_license_key()
    if not key:
        raise HTTPException(401, "라이선스 키 필요")

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(
                f"{SYNC_SERVER}/api/license/launcher/admin/users/{user_id}/games",
                headers={"Authorization": f"Bearer {key}"},
            )
            if r.status_code == 403:
                raise HTTPException(403, "관리자 권한이 없습니다.")
            if r.status_code != 200:
                raise HTTPException(r.status_code, _parse_server_error(r))
            return r.json()
    except httpx.HTTPError as e:
        raise HTTPException(502, f"서버 통신 실패: {e}")
