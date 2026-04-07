"""FastAPI application entry point."""

import logging
import os
import traceback
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

logger = logging.getLogger(__name__)

from . import db
from .routers import games, translate, settings, covers, presets, memory, models, sync, android, qa, export_import, glossary, media, live, videos, manga, audio, categories, agent, filesystem, subtitle

_data_dir = os.environ.get("GT_DATA_DIR") or os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")
COVERS_DIR = os.path.join(_data_dir, "covers")
THUMBS_DIR = os.path.join(_data_dir, "thumbnails")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.init_db()
    # Pre-load NLLB model in background to avoid first-request timeout
    try:
        from .offline_translate import _load as preload_nllb, is_available
        if is_available():
            import asyncio
            await asyncio.to_thread(preload_nllb)
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning("NLLB preload skipped: %s", e)
    yield


app = FastAPI(
    title="Game Translator API",
    version="1.0.0",
    lifespan=lifespan,
)

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Catch all unhandled exceptions — log full traceback and return structured 500."""
    tb = traceback.format_exception(type(exc), exc, exc.__traceback__)
    logger.error(
        "Unhandled %s at %s %s\n%s",
        type(exc).__name__, request.method, request.url.path, "".join(tb),
    )
    # Collect request context for debugging
    ctx_lines = []
    try:
        ctx_lines.append(f"Query: {dict(request.query_params)}" if request.query_params else "")
        ctx_lines.append(f"Path params: {request.path_params}" if request.path_params else "")
        # Try to read body (may already be consumed)
        try:
            body = await request.body()
            if body:
                body_str = body.decode("utf-8", errors="replace")[:2000]
                ctx_lines.append(f"Body: {body_str}")
        except Exception:
            pass
    except Exception:
        pass
    ctx_str = "\n".join(line for line in ctx_lines if line)

    # Write to crash.log for persistent debugging
    crash_log = os.path.join(_data_dir, "crash.log")
    try:
        with open(crash_log, "a", encoding="utf-8") as f:
            from datetime import datetime, timezone
            f.write(f"\n{'='*60}\n")
            f.write(f"[{datetime.now(timezone.utc).isoformat()}] {request.method} {request.url.path}\n")
            if ctx_str:
                f.write(ctx_str + "\n")
            f.write("".join(tb))
    except Exception:
        pass
    return JSONResponse(
        status_code=500,
        content={"detail": f"{type(exc).__name__}: {exc}"},
    )


app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3100"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type"],
)

app.include_router(games.router)
app.include_router(games.folder_router)
app.include_router(translate.router)
app.include_router(settings.router)
app.include_router(covers.game_router)
app.include_router(covers.batch_router)
app.include_router(presets.router)
app.include_router(memory.router)
app.include_router(models.router)
app.include_router(sync.router)
app.include_router(android.router)
app.include_router(qa.router)
app.include_router(export_import.router)
app.include_router(glossary.router)
app.include_router(media.router)
app.include_router(live.router)
app.include_router(videos.router)
app.include_router(manga.router)
app.include_router(audio.router)
app.include_router(categories.router)
app.include_router(agent.router)
app.include_router(filesystem.router)
app.include_router(subtitle.router)

# Serve cover images
os.makedirs(COVERS_DIR, exist_ok=True)
app.mount("/api/covers", StaticFiles(directory=COVERS_DIR), name="covers")

# Serve thumbnail images
os.makedirs(THUMBS_DIR, exist_ok=True)
os.makedirs(os.path.join(THUMBS_DIR, "video"), exist_ok=True)
os.makedirs(os.path.join(THUMBS_DIR, "audio"), exist_ok=True)
app.mount("/api/thumbnails", StaticFiles(directory=THUMBS_DIR), name="thumbnails")


@app.get("/api/health")
async def health():
    return {"status": "ok"}
