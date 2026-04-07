"""Android game management API endpoints."""

import asyncio
import json

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional
from ..sse_utils import sse_format as _sse_format

from .. import db
from .. import android_manager
from .games import _validate_path

router = APIRouter(prefix="/api/android", tags=["android"])


class ScanApksRequest(BaseModel):
    path: str


class ImportApkRequest(BaseModel):
    path: str
    title: Optional[str] = None


class ConnectEmulatorRequest(BaseModel):
    port: int = 5555


# --- APK Scanning & Import ---

@router.post("/scan-apks")
async def scan_apks(body: ScanApksRequest):
    """Scan a folder for APK files."""
    validated = _validate_path(body.path)
    results = android_manager.scan_apks(str(validated))
    return {"apks": results}


@router.post("/import")
async def import_apk(body: ImportApkRequest):
    """Import an APK file: move to managed folder, extract metadata, register as game."""
    validated = _validate_path(body.path)
    path = str(validated)
    try:
        result = android_manager.import_apk(path)
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))
    except Exception as e:
        raise HTTPException(500, f"Import failed: {e}")

    # Register as game in DB
    title = body.title or result["title"]
    cover_path = result["icon_path"] if result["icon_path"] else ""

    game = await db.create_game(
        title=title,
        path=result["path"],
        exe_path="",
        engine="android",
        source_lang="auto",
    )

    # Update with android-specific fields
    await db.update_game(
        game["id"],
        platform="android",
        package_name=result["package_name"],
        original_path=result["original_path"],
        cover_path=cover_path,
    )

    updated_game = await db.get_game(game["id"])
    return {"game": updated_game, "import_result": result}


# --- Emulator Management ---

@router.get("/emulators")
async def get_emulators():
    """List detected emulators."""
    emulators = android_manager.detect_emulators()
    return {"emulators": emulators}


@router.post("/emulator/connect")
async def connect_emulator(body: ConnectEmulatorRequest):
    """Connect to an emulator via ADB."""
    result = android_manager.connect_emulator(body.port)
    if not result["ok"]:
        raise HTTPException(400, result["message"])
    return result


@router.get("/emulator/status")
async def emulator_status():
    """Get overall emulator and ADB status."""
    return android_manager.get_emulator_status()


# --- Game Operations ---

@router.post("/install/{game_id}")
async def install_game(game_id: int):
    """Install APK to emulator."""
    game = await db.get_game(game_id)
    if not game:
        raise HTTPException(404, "Game not found")
    if game.get("platform") != "android":
        raise HTTPException(400, "Not an Android game")

    package_name = game.get("package_name", "")
    apk_path = game.get("path", "")

    if not apk_path or not android_manager.get_apk_path(package_name):
        raise HTTPException(400, "APK file not found")

    # Find active device
    devices = android_manager.list_devices()
    active = [d for d in devices if d["status"] == "device"]
    if not active:
        raise HTTPException(400, "No connected emulator. Start an emulator and connect via ADB first.")

    device_id = active[0]["device_id"]
    result = android_manager.install_apk(device_id, apk_path)
    if not result["ok"]:
        raise HTTPException(500, result["message"])

    return {"ok": True, "device_id": device_id, "message": result["message"]}


@router.post("/launch/{game_id}")
async def launch_game(game_id: int):
    """Launch Android game on emulator."""
    game = await db.get_game(game_id)
    if not game:
        raise HTTPException(404, "Game not found")
    if game.get("platform") != "android":
        raise HTTPException(400, "Not an Android game")

    result = await android_manager.install_and_launch(game)
    if not result["ok"]:
        raise HTTPException(400, result["message"])

    # Update last played
    from datetime import datetime, timezone
    await db.update_game(game_id, last_played_at=datetime.now(timezone.utc).isoformat())

    return result


@router.post("/reinstall/{game_id}")
async def reinstall_game(game_id: int):
    """Reinstall game from managed APK folder."""
    game = await db.get_game(game_id)
    if not game:
        raise HTTPException(404, "Game not found")
    if game.get("platform") != "android":
        raise HTTPException(400, "Not an Android game")

    package_name = game.get("package_name", "")
    apk_path = android_manager.get_apk_path(package_name)
    if not apk_path:
        raise HTTPException(404, "APK file not found in managed folder")

    # Find active device
    devices = android_manager.list_devices()
    active = [d for d in devices if d["status"] == "device"]
    if not active:
        raise HTTPException(400, "No connected emulator")

    device_id = active[0]["device_id"]

    # Uninstall first, then reinstall
    android_manager.uninstall_app(device_id, package_name)
    result = android_manager.install_apk(device_id, apk_path)
    if not result["ok"]:
        raise HTTPException(500, result["message"])

    return {"ok": True, "device_id": device_id, "message": "Reinstalled successfully"}


# --- Embedded SDK / Emulator Management ---


@router.get("/emulator/sdk-status")
async def sdk_status():
    """Get SDK installation status."""
    return android_manager.get_sdk_status()


@router.post("/emulator/setup")
async def setup_emulator():
    """Start SDK download and installation in background."""
    if android_manager.is_sdk_installed():
        raise HTTPException(409, "SDK already installed")

    active = android_manager.get_active_sdk_setup()
    if active and active.status in ("downloading", "installing_sdk", "creating_avd"):
        raise HTTPException(409, "Setup already in progress")

    task = android_manager.start_sdk_setup()
    return {"ok": True, "status": task.status}


@router.post("/emulator/auto-setup")
async def auto_setup():
    """Auto-trigger SDK setup if not installed. Safe to call multiple times."""
    if android_manager.is_sdk_installed():
        return {"ok": True, "status": "already_installed"}
    active = android_manager.get_active_sdk_setup()
    if active and active.status in ("downloading", "installing_sdk", "creating_avd"):
        return {"ok": True, "status": "in_progress"}
    task = android_manager.start_sdk_setup()
    return {"ok": True, "status": task.status}


@router.get("/emulator/setup/active")
async def setup_active():
    """Return whether an SDK setup task is currently running (non-SSE)."""
    active = android_manager.get_active_sdk_setup()
    if active and active.status not in ("completed", "failed", "cancelled"):
        return {"active": True}
    return {"active": False}


@router.get("/emulator/setup/status")
async def setup_status_sse():
    """SSE stream for SDK setup progress."""

    async def event_stream():
        while True:
            task = android_manager.get_active_sdk_setup()
            if task is None:
                # Check if SDK is already installed
                if android_manager.is_sdk_installed():
                    yield _sse_format("status", {
                        "status": "completed",
                        "progress": 100,
                        "step": "done",
                        "step_detail": "SDK installed",
                        "downloaded_bytes": 0,
                        "total_bytes": 0,
                        "speed_bps": 0,
                        "eta_seconds": 0,
                        "error": None,
                    })
                else:
                    yield _sse_format("status", {
                        "status": "idle",
                        "progress": 0,
                        "step": "",
                        "step_detail": "",
                        "downloaded_bytes": 0,
                        "total_bytes": 0,
                        "speed_bps": 0,
                        "eta_seconds": 0,
                        "error": None,
                    })
                return

            data = task.to_dict()
            yield _sse_format("status", data)

            if data["status"] in ("completed", "failed", "cancelled"):
                return

            await asyncio.sleep(0.5)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/emulator/setup/cancel")
async def cancel_setup():
    """Cancel SDK setup."""
    if not android_manager.cancel_sdk_setup():
        raise HTTPException(404, "No active setup to cancel")
    return {"ok": True}


@router.post("/emulator/start")
async def start_emulator():
    """Start embedded emulator."""
    if not android_manager.is_sdk_installed():
        raise HTTPException(400, "SDK not installed")

    result = android_manager.start_emulator()
    if not result["ok"]:
        raise HTTPException(400, result["message"])
    return result


@router.post("/emulator/stop")
async def stop_emulator():
    """Stop embedded emulator."""
    result = android_manager.stop_emulator()
    return result
