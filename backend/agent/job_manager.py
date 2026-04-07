"""Agent job manager — SSE broadcast pattern matching TranslationJob."""

import asyncio
import json
import logging
import threading
import uuid
from datetime import datetime, timezone
from typing import Optional

from .agent_loop import AIAgent

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# AgentJob — mirrors TranslationJob SSE pattern
# ---------------------------------------------------------------------------


class AgentJob:
    """Manages a running AI agent with SSE broadcast capability."""

    def __init__(self, job_id: str, game_id: int, game_path: str):
        self.job_id = job_id
        self.game_id = game_id
        self.game_path = game_path
        self.status = "running"  # running | waiting | completed | error | cancelled
        self.error_message = ""
        self.result_summary = ""
        self.turns = 0
        self.max_turns = 20
        self.input_tokens = 0
        self.output_tokens = 0
        self.model = ""
        self.messages: list[dict] = []  # broadcast log
        self.cancel_event = threading.Event()
        self._agent: Optional[AIAgent] = None
        self._sse_queues: list[asyncio.Queue] = []
        self._lock = threading.Lock()
        self.created_at = datetime.now(timezone.utc).isoformat()
        self.completed_at: Optional[str] = None

    def add_sse_listener(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue()
        with self._lock:
            self._sse_queues.append(q)
        return q

    def remove_sse_listener(self, q: asyncio.Queue) -> None:
        with self._lock:
            try:
                self._sse_queues.remove(q)
            except ValueError:
                pass

    def broadcast(self, event: str, data: dict) -> None:
        """Thread-safe broadcast to all SSE listeners."""
        msg = {"event": event, "data": data}
        # Keep message log (capped at 500)
        if len(self.messages) < 500:
            self.messages.append(msg)
        with self._lock:
            for q in self._sse_queues:
                try:
                    q.put_nowait(msg)
                except asyncio.QueueFull:
                    pass

        # Update job state from broadcast events
        if event == "tokens":
            self.input_tokens = data.get("input_tokens", self.input_tokens)
            self.output_tokens = data.get("output_tokens", self.output_tokens)
            self.turns = data.get("turn", self.turns)
        elif event == "waiting":
            self.status = "waiting"
        elif event == "thinking":
            self.status = "running"
        elif event == "complete":
            self.status = "completed"
            self.result_summary = data.get("summary", "")
            self.completed_at = datetime.now(timezone.utc).isoformat()
        elif event == "error":
            self.status = "error"
            self.error_message = data.get("message", "Unknown error")
            self.completed_at = datetime.now(timezone.utc).isoformat()
        elif event == "cancelled":
            self.status = "cancelled"
            self.completed_at = datetime.now(timezone.utc).isoformat()

    def send_user_message(self, text: str) -> bool:
        """Send a user message to the running agent. Returns True if delivered."""
        if self._agent and self.status == "waiting":
            self._agent.send_user_message(text)
            return True
        return False


# ---------------------------------------------------------------------------
# Global job registry
# ---------------------------------------------------------------------------

_jobs: dict[str, AgentJob] = {}
_jobs_lock = threading.Lock()
_MAX_FINISHED_JOBS = 20


def get_job(job_id: str) -> Optional[AgentJob]:
    with _jobs_lock:
        return _jobs.get(job_id)


def get_game_job(game_id: int) -> Optional[AgentJob]:
    """Get the most recent (or running/waiting) agent job for a game."""
    with _jobs_lock:
        # Prefer active job (running or waiting)
        for job in reversed(list(_jobs.values())):
            if job.game_id == game_id and job.status in ("running", "waiting"):
                return job
        # Fallback to latest
        for job in reversed(list(_jobs.values())):
            if job.game_id == game_id:
                return job
    return None


def _cleanup_finished_jobs() -> None:
    """Keep max N finished jobs in memory."""
    with _jobs_lock:
        finished = [j for j in _jobs.values() if j.status not in ("running", "waiting")]
        if len(finished) > _MAX_FINISHED_JOBS:
            finished.sort(key=lambda j: j.created_at)
            for job in finished[:-_MAX_FINISHED_JOBS]:
                _jobs.pop(job.job_id, None)


async def start_agent(
    game_id: int,
    game_path: str,
    game_title: str,
    api_key: str,
    provider: str = "",
    model: str = "",
    max_turns: int = 20,
    instructions: str = "",
) -> AgentJob:
    """Start a new agent job in a background thread."""
    # Cancel any existing active job for this game
    existing = get_game_job(game_id)
    if existing and existing.status in ("running", "waiting"):
        existing.cancel_event.set()

    job_id = str(uuid.uuid4())
    job = AgentJob(job_id, game_id, game_path)
    job.model = model or "claude-sonnet-4-20250514"
    job.max_turns = min(max_turns, 50)

    with _jobs_lock:
        _jobs[job_id] = job

    agent = AIAgent(
        api_key=api_key,
        model=job.model,
        game_path=game_path,
        game_title=game_title,
        game_id=game_id,
        max_turns=job.max_turns,
        instructions=instructions,
        provider=provider,
        broadcast=job.broadcast,
    )
    agent.cancel_event = job.cancel_event
    job._agent = agent

    def _run() -> None:
        loop = asyncio.new_event_loop()
        try:
            result = loop.run_until_complete(agent.run())
            logger.info("Agent job %s finished: %s", job_id, result.get("status"))
        except Exception as e:
            logger.exception("Agent job %s crashed", job_id)
            job.broadcast("error", {"message": f"Agent crashed: {e}"})
        finally:
            job._agent = None
            loop.close()
            _cleanup_finished_jobs()

    thread = threading.Thread(target=_run, daemon=True, name=f"agent-{job_id[:8]}")
    thread.start()

    # Save to DB
    try:
        from .. import db
        await db.create_agent_session(
            session_id=job_id,
            game_id=game_id,
            model=job.model,
            max_turns=job.max_turns,
        )
    except Exception as e:
        logger.warning("Failed to save agent session to DB: %s", e)

    return job


async def send_message(game_id: int, text: str) -> bool:
    """Send a user message to the active agent for a game."""
    job = get_game_job(game_id)
    if not job:
        return False
    return job.send_user_message(text)


async def cancel_agent(game_id: int) -> bool:
    """Cancel the running agent for a game."""
    job = get_game_job(game_id)
    if not job or job.status not in ("running", "waiting"):
        return False
    job.cancel_event.set()
    # Also wake the agent if it's waiting for user input
    if job._agent:
        job._agent.send_user_message("")  # Wake with empty to trigger cancel check
    return True
