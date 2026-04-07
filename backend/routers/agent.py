"""Agent router — AI analysis endpoints."""

import asyncio
import logging

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from .. import db
from ..models import AgentStartRequest
try:
    from ..license import require_license
except ImportError:
    from ..license_stub import require_license
from ..sse_utils import sse_format
from ..agent import job_manager

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/games/{game_id}/agent", tags=["agent"])


class AgentMessageRequest(BaseModel):
    text: str


@router.post("")
async def start_agent(game_id: int, body: AgentStartRequest):
    """Start an AI agent session for a game."""
    await require_license()
    game = await db.get_game(game_id)
    if not game:
        raise HTTPException(404, "Game not found")

    if not body.api_key:
        raise HTTPException(400, "API key is required")

    job = await job_manager.start_agent(
        game_id=game_id,
        game_path=game["path"],
        game_title=game.get("title", ""),
        api_key=body.api_key,
        provider=body.provider,
        model=body.model,
        max_turns=body.max_turns,
        instructions=body.instructions,
    )

    return {
        "job_id": job.job_id,
        "status": job.status,
        "model": job.model,
        "max_turns": job.max_turns,
    }


@router.post("/message")
async def send_message(game_id: int, body: AgentMessageRequest):
    """Send a user message to the waiting agent."""
    if not body.text.strip():
        raise HTTPException(400, "Message text is required")

    sent = await job_manager.send_message(game_id, body.text.strip())
    if not sent:
        raise HTTPException(404, "No waiting agent found for this game")
    return {"ok": True}


@router.get("/status")
async def agent_status_sse(game_id: int):
    """SSE stream of agent events."""
    job = job_manager.get_game_job(game_id)
    if not job:
        async def idle_stream():
            yield sse_format("idle", {"status": "idle"})
        return StreamingResponse(idle_stream(), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    async def event_stream():
        queue = job.add_sse_listener()
        try:
            # Send current state first
            yield sse_format("init", {
                "job_id": job.job_id,
                "status": job.status,
                "model": job.model,
                "turns": job.turns,
                "max_turns": job.max_turns,
                "input_tokens": job.input_tokens,
                "output_tokens": job.output_tokens,
            })

            # Replay existing messages
            for msg in list(job.messages):
                yield sse_format(msg["event"], msg["data"])

            if job.status not in ("running", "waiting"):
                return

            # Stream new events
            heartbeat_count = 0
            while job.status in ("running", "waiting"):
                try:
                    msg = await asyncio.wait_for(queue.get(), timeout=30)
                    yield sse_format(msg["event"], msg["data"])
                    heartbeat_count = 0
                    if msg["event"] in ("complete", "error", "cancelled"):
                        break
                except asyncio.TimeoutError:
                    heartbeat_count += 1
                    if heartbeat_count > 120:
                        break
                    yield sse_format("heartbeat", {"status": job.status, "turns": job.turns})
        finally:
            job.remove_sse_listener(queue)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/poll")
async def agent_poll(game_id: int):
    """JSON polling endpoint (fallback for SSE)."""
    job = job_manager.get_game_job(game_id)
    if not job:
        # Check DB for latest session
        session = await db.get_latest_agent_session(game_id)
        if session:
            return {
                "status": session["status"],
                "turns": session["turns"],
                "max_turns": session["max_turns"],
                "input_tokens": session["input_tokens"],
                "output_tokens": session["output_tokens"],
                "result_summary": session["result_summary"],
                "error_message": session["error_message"],
                "messages": [],
            }
        return {"status": "idle"}

    return {
        "job_id": job.job_id,
        "status": job.status,
        "model": job.model,
        "turns": job.turns,
        "max_turns": job.max_turns,
        "input_tokens": job.input_tokens,
        "output_tokens": job.output_tokens,
        "result_summary": job.result_summary,
        "error_message": job.error_message,
        "messages": job.messages[-50:],
    }


@router.post("/cancel")
async def cancel_agent(game_id: int):
    """Cancel the running agent."""
    cancelled = await job_manager.cancel_agent(game_id)
    if not cancelled:
        raise HTTPException(404, "No running agent found for this game")
    return {"ok": True}
