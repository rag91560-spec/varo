"""Settings GET/PUT endpoints + License status + Crash log."""

import os

import httpx
from fastapi import APIRouter
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel
from ..models import SettingsUpdate
from .. import db
try:
    from ..license import verify_license
except ImportError:
    from ..license_stub import verify_license

router = APIRouter(prefix="/api/settings", tags=["settings"])

_data_dir = os.environ.get("GT_DATA_DIR") or os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "data"
)


class TestKeyRequest(BaseModel):
    provider: str
    key: str


@router.get("")
async def get_settings():
    return await db.get_settings()


@router.put("")
async def put_settings(body: SettingsUpdate):
    """Update settings with Pydantic validation (#19). Only allowed keys pass through."""
    fields = body.model_dump(exclude_none=True)
    return await db.put_settings(fields)


@router.post("/test-key")
async def test_api_key(body: TestKeyRequest):
    """Test if an API key is valid by making a minimal request."""
    provider = body.provider
    key = body.key.strip()
    if not key:
        return {"ok": False, "error": "키가 비어 있습니다."}

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            if provider == "claude_api":
                r = await client.get(
                    "https://api.anthropic.com/v1/models",
                    headers={
                        "x-api-key": key,
                        "anthropic-version": "2023-06-01",
                    },
                )
                if r.status_code == 200:
                    return {"ok": True}
                elif r.status_code == 401:
                    return {"ok": False, "error": "유효하지 않은 API 키입니다."}
                else:
                    return {"ok": False, "error": f"API 오류 ({r.status_code})"}

            elif provider == "openai":
                r = await client.get(
                    "https://api.openai.com/v1/models",
                    headers={"Authorization": f"Bearer {key}"},
                )
                if r.status_code == 200:
                    return {"ok": True}
                elif r.status_code == 401:
                    return {"ok": False, "error": "유효하지 않은 API 키입니다."}
                else:
                    return {"ok": False, "error": f"API 오류 ({r.status_code})"}

            elif provider == "gemini":
                r = await client.get(
                    f"https://generativelanguage.googleapis.com/v1beta/models?key={key}",
                )
                if r.status_code == 200:
                    return {"ok": True}
                elif r.status_code in (400, 401, 403):
                    return {"ok": False, "error": "유효하지 않은 API 키입니다."}
                else:
                    return {"ok": False, "error": f"API 오류 ({r.status_code})"}

            elif provider == "deepseek":
                r = await client.get(
                    "https://api.deepseek.com/models",
                    headers={"Authorization": f"Bearer {key}"},
                )
                if r.status_code == 200:
                    return {"ok": True}
                elif r.status_code == 401:
                    return {"ok": False, "error": "유효하지 않은 API 키입니다."}
                else:
                    return {"ok": False, "error": f"API 오류 ({r.status_code})"}

            else:
                return {"ok": False, "error": f"지원하지 않는 프로바이더: {provider}"}

    except httpx.TimeoutException:
        return {"ok": False, "error": "연결 시간 초과"}
    except httpx.ConnectError:
        return {"ok": False, "error": "서버 연결 실패"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@router.get("/crash-log")
async def get_crash_log():
    """Return the last 200 lines of crash.log for debugging."""
    crash_log = os.path.join(_data_dir, "crash.log")
    if not os.path.isfile(crash_log):
        return PlainTextResponse("")
    try:
        with open(crash_log, "r", encoding="utf-8", errors="replace") as f:
            lines = f.readlines()
        # Return last 200 lines (most recent crashes)
        tail = lines[-200:] if len(lines) > 200 else lines
        return PlainTextResponse("".join(tail))
    except Exception:
        return PlainTextResponse("")


@router.delete("/crash-log")
async def clear_crash_log():
    """Clear the crash log."""
    crash_log = os.path.join(_data_dir, "crash.log")
    if os.path.isfile(crash_log):
        os.remove(crash_log)
    return {"ok": True}


@router.get("/license/status")
async def license_status():
    """Return cached license status."""
    result = await verify_license()
    return result


@router.post("/license/verify")
async def license_verify():
    """Force re-verification against remote API."""
    result = await verify_license(force_refresh=True)
    return result
