"""Translation start/cancel/apply endpoints + SSE progress."""

import asyncio
import json
import logging
import os
from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import StreamingResponse

from ..models import TranslateRequest, BulkUpdateStringsRequest, UpdateStringRequest
from .. import db
from .. import engine_bridge
from .. import job_manager
try:
    from ..license import require_license, verify_license
except ImportError:
    from ..license_stub import require_license, verify_license
from ..sse_utils import sse_format as _sse_format

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/games/{game_id}/translate", tags=["translate"])


OFFLINE_PROVIDERS = {"offline", "test"}


@router.post("")
async def start_translation(game_id: int, body: TranslateRequest):
    # License required only for AI providers
    if body.provider not in OFFLINE_PROVIDERS:
        await require_license()

    game = await db.get_game(game_id)
    if not game:
        raise HTTPException(404, "Game not found")

    if not game.get("engine"):
        raise HTTPException(400, "Game engine not detected. Run scan first.")

    try:
        job = await job_manager.start_translation(
            game_id=game_id,
            provider=body.provider,
            api_key="",  # Backend reads from DB settings
            model=body.model,
            source_lang=body.source_lang or game.get("source_lang", "auto"),
            target_lang=body.target_lang,
            preset_id=body.preset_id,
            start_index=body.start_index,
            end_index=body.end_index,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        logger.exception("start_translation failed for game %s", game_id)
        raise HTTPException(500, f"Translation start failed: {type(e).__name__}: {e}")

    # extraction 실패 등으로 job이 이미 에러 상태면 HTTP 에러로 반환
    if job.status == "error":
        raise HTTPException(400, job.error_message or "Translation failed to start")

    return {
        "job_id": job.job_id,
        "status": job.status,
        "total_strings": job.total_strings,
        "error_message": job.error_message,
    }


@router.get("/poll")
async def translation_poll(game_id: int):
    """Simple JSON endpoint for polling translation progress."""
    job = job_manager.get_latest_game_job(game_id)
    if job:
        return {
            "status": job.status,
            "progress": round(job.progress, 1),
            "translated": job.translated_strings,
            "total": job.total_strings,
            "message": getattr(job, '_last_message', ''),
            "error_message": job.error_message or "",
        }
    # DB fallback — 메모리에 없으면 DB에서 최신 job 조회
    game = await db.get_game(game_id)
    if game and game.get("status") == "translating":
        db_job = await db.get_latest_job(game_id)
        if db_job:
            return {
                "status": db_job["status"],
                "progress": round(db_job.get("progress", 0) or 0, 1),
                "translated": db_job.get("translated_strings", 0) or 0,
                "total": db_job.get("total_strings", 0) or 0,
                "message": "",
                "error_message": db_job.get("error_message", "") or "",
            }
    return {"status": "idle", "progress": 0, "translated": 0, "total": 0}


@router.get("/status")
async def translation_status_sse(game_id: int):
    """SSE endpoint for real-time translation progress."""
    job = job_manager.get_game_job(game_id)
    if not job:
        # No active job — return idle status as proper SSE stream
        game = await db.get_game(game_id)
        if not game:
            raise HTTPException(404, "Game not found")

        async def idle_stream():
            yield _sse_format("idle", {"status": "idle", "progress": 0})

        return StreamingResponse(
            idle_stream(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
        )

    async def event_stream():
        queue = job.add_sse_listener()
        try:
            # Send initial state
            yield _sse_format("progress", {
                "progress": round(job.progress, 1),
                "translated": job.translated_strings,
                "total": job.total_strings,
                "status": job.status,
            })

            heartbeat_count = 0
            max_heartbeats = 120  # 30s × 120 = 1 hour max

            while job.status == "running":
                try:
                    msg = await asyncio.wait_for(queue.get(), timeout=30)
                    heartbeat_count = 0  # Reset on real message
                    yield _sse_format(msg["event"], msg["data"])
                    if msg["event"] in ("complete", "error", "cancelled"):
                        break
                except asyncio.TimeoutError:
                    heartbeat_count += 1
                    if heartbeat_count > max_heartbeats:
                        break
                    yield _sse_format("heartbeat", {"status": job.status})

        finally:
            job.remove_sse_listener(queue)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/cancel")
async def cancel_translation(game_id: int):
    job = job_manager.get_game_job(game_id)
    if not job:
        raise HTTPException(404, "No active translation job")

    job_manager.cancel_job(job.job_id)
    return {"ok": True, "job_id": job.job_id}


@router.post("/apply")
async def apply_translation(game_id: int):
    """Apply translated strings back to game files."""
    # 라이선스 유저는 전체 적용, 미인증은 60%만 적용
    try:
        license_info = await verify_license()
        is_licensed = license_info.get("valid", False)
    except Exception:
        is_licensed = False
    partial_ratio = 1.0 if is_licensed else 0.6

    game = await db.get_game(game_id)
    if not game:
        raise HTTPException(404, "Game not found")

    # Get the latest project
    project_row = await db.get_project(game_id)
    if not project_row:
        raise HTTPException(400, "No translation project found. Run translation first.")

    try:
        project_entries = json.loads(project_row["project_json"])
    except (json.JSONDecodeError, TypeError):
        raise HTTPException(400, "Invalid project data")

    # Rebuild project object
    from .. import engine_bridge
    try:
        engine_bridge._ensure_ue_translator()
    except RuntimeError as e:
        raise HTTPException(500, str(e))
    ue_translator = engine_bridge.ue_translator
    if ue_translator is None:
        raise HTTPException(500, "ue_translator 모듈 로드 실패 — 설치 경로를 확인하세요")

    project = ue_translator.TranslationProject()
    project.game_path = game["path"]
    project.engine_name = game["engine"]
    project.source_lang = game.get("source_lang", "ja")
    project.entries = project_entries

    # Create backup first
    backup_mgr = engine_bridge.create_backup(game["path"])

    # Get engine and resources (pass AES key for encrypted UE4 paks)
    engine_obj = engine_bridge._get_engine_by_name(game["engine"], aes_key=game.get("aes_key", ""))
    if not engine_obj:
        raise HTTPException(400, f"Unknown engine: {game['engine']}")

    resources = engine_obj.scan(game["path"])

    # Create backups for relevant files
    for res in resources:
        if res.get("path"):
            backup_mgr.create_backup(res["path"])

    try:
        patch_path = engine_bridge.apply_translations_to_game(
            game["path"], game["engine"], project, resources,
            aes_key=game.get("aes_key", ""),
            partial_ratio=partial_ratio,
        )
        await db.update_game(game_id, status="applied")
        return {"ok": True, "patch_path": patch_path}
    except Exception as e:
        logger.exception("Failed to apply translations for game %s", game_id)
        # Auto-rollback on failure using backup manager
        try:
            for backup in backup_mgr.list_backups():
                backup_mgr.restore(backup["backup_path"])
        except Exception:
            logger.warning("Auto-rollback also failed for game %s", game_id)
        raise HTTPException(500, f"Failed to apply: {e}")


@router.post("/rollback")
async def rollback_translation(game_id: int):
    """통합 롤백: restore.bat 실행. 없으면 _translation_backup 직접 복원."""
    import subprocess
    from pathlib import Path

    game = await db.get_game(game_id)
    if not game:
        raise HTTPException(404, "Game not found")

    game_path = game["path"]
    backup_dir = os.path.join(game_path, "_translation_backup")
    restore_bat = os.path.join(backup_dir, "restore.bat")

    # BAT 파일이 있으면 실행 (bat이 자기 폴더를 삭제하므로 returncode 무시)
    if os.path.isfile(restore_bat):
        subprocess.run(
            f'cmd /c "{restore_bat}"', capture_output=True, timeout=60,
            cwd=game_path, shell=True,
        )
        await db.update_game(game_id, status="idle", translated_count=0)
        return {"ok": True, "restored_count": 1}

    # 백업 없으면 이미 원본 상태
    await db.update_game(game_id, status="idle", translated_count=0)
    return {"ok": True, "restored_count": 0, "message": "이미 원본 상태입니다"}


# ---------------------------------------------------------------------------
# Strings CRUD
# ---------------------------------------------------------------------------

from fastapi import Query
from datetime import datetime, timezone


@router.get("/strings")
async def get_strings(
    game_id: int,
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    status: str = Query(""),
    search: str = Query(""),
    tag: str = Query(""),
    qa_only: bool = Query(False),
    safety: str = Query(""),  # "safe", "risky", "unsafe", or "" for all
):
    """Return paginated, filtered translation entries for a game."""
    game = await db.get_game(game_id)
    if not game:
        raise HTTPException(404, "Game not found")

    result = await db.get_project_entries_paginated(
        game_id=game_id,
        page=page,
        per_page=per_page,
        status=status,
        search=search,
        tag=tag,
        qa_only=qa_only,
        safety=safety,
    )
    return result


@router.put("/strings/bulk")
async def bulk_update_strings(game_id: int, body: BulkUpdateStringsRequest):
    """Bulk update status/review_status for a list of entry indices."""
    game = await db.get_game(game_id)
    if not game:
        raise HTTPException(404, "Game not found")

    try:
        fields = body.validated_fields()
    except ValueError as e:
        raise HTTPException(400, str(e))

    if not fields:
        raise HTTPException(400, "No updatable fields provided")

    updated = await db.bulk_update_project_entries(game_id, body.indices, fields)
    return {"ok": True, "updated": updated}


@router.put("/strings/{entry_index}")
async def update_string(game_id: int, entry_index: int, body: UpdateStringRequest):
    """Update a single translation entry by its index."""
    game = await db.get_game(game_id)
    if not game:
        raise HTTPException(404, "Game not found")

    try:
        fields = body.validated_fields()
    except ValueError as e:
        raise HTTPException(400, str(e))

    # Auto-stamp edited_at
    fields["edited_at"] = datetime.now(timezone.utc).isoformat()

    ok = await db.update_project_entry(game_id, entry_index, fields)
    if not ok:
        raise HTTPException(404, f"Entry index {entry_index} not found")

    return {"ok": True}
