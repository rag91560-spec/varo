"""Offline AI model management endpoints."""

import asyncio
import json
import logging
import os
import shutil
import threading
import time

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from ..sse_utils import sse_format as _sse_format

router = APIRouter(prefix="/api/models", tags=["models"])

logger = logging.getLogger(__name__)

_APPDATA = os.environ.get("APPDATA") or os.path.join(os.path.expanduser("~"), ".local", "share")
MODELS_DIR = os.path.join(_APPDATA, "게임번역기", "models")

# Placeholder download URLs — replace with real URLs when available
MODEL_DOWNLOAD_URLS: dict[str, str] = {
    "nllb-600m": "https://closedclaws.com/downloads/nllb-600m-game-v1.zip",
    "game-translator-7b": "https://models.closedclaws.com/game-translator-7b/game-translator-7b-q4.gguf",
    "lama-manga": "https://closedclaws.com/downloads/lama-manga-onnx.zip",
    "comic-text-detector": "https://closedclaws.com/downloads/comic-text-detector-onnx.zip",
    "manga-ocr": "https://closedclaws.com/downloads/manga-ocr-onnx.zip",
}

MODEL_CHECK_FILES: dict[str, str] = {
    "nllb-600m": "nllb-600m-game-v1",
    "game-translator-7b": "game-translator-7b-q4.gguf",
    "lama-manga": "lama-manga",
    "comic-text-detector": "comic-text-detector",
    "manga-ocr": "manga-ocr",
}

# Active downloads: model_id -> DownloadTask
_active_downloads: dict[str, "DownloadTask"] = {}


class DownloadTask:
    """Tracks a background model download."""

    def __init__(self, model_id: str, url: str, dest_path: str):
        self.model_id = model_id
        self.url = url
        self.dest_path = dest_path
        self.total_bytes: int = 0
        self.downloaded_bytes: int = 0
        self.speed_bps: float = 0.0
        self.eta_seconds: float = 0.0
        self.status: str = "pending"  # pending | downloading | completed | failed | cancelled
        self.error: str | None = None
        self._cancel_event = threading.Event()
        self._thread: threading.Thread | None = None
        self._lock = threading.Lock()

    @property
    def progress(self) -> float:
        if self.total_bytes <= 0:
            return 0.0
        return min(self.downloaded_bytes / self.total_bytes * 100, 100.0)

    def start(self):
        self.status = "downloading"
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def cancel(self):
        self._cancel_event.set()

    def to_dict(self) -> dict:
        with self._lock:
            return {
                "model_id": self.model_id,
                "status": self.status,
                "progress": round(self.progress, 1),
                "downloaded_bytes": self.downloaded_bytes,
                "total_bytes": self.total_bytes,
                "speed_bps": round(self.speed_bps),
                "eta_seconds": round(self.eta_seconds, 1),
                "error": self.error,
            }

    def _run(self):
        tmp_path = self.dest_path + ".download"
        try:
            os.makedirs(os.path.dirname(self.dest_path), exist_ok=True)

            with httpx.Client(timeout=httpx.Timeout(30.0, read=600.0), follow_redirects=True) as client:
                with client.stream("GET", self.url) as resp:
                    resp.raise_for_status()
                    self.total_bytes = int(resp.headers.get("content-length", 0))

                    chunk_size = 1024 * 256  # 256KB chunks
                    last_time = time.monotonic()
                    last_bytes = 0
                    speed_window: list[float] = []

                    with open(tmp_path, "wb") as f:
                        for chunk in resp.iter_bytes(chunk_size):
                            if self._cancel_event.is_set():
                                with self._lock:
                                    self.status = "cancelled"
                                logger.info("Download cancelled: %s", self.model_id)
                                return

                            f.write(chunk)
                            with self._lock:
                                self.downloaded_bytes += len(chunk)

                            # Calculate speed every 0.5s
                            now = time.monotonic()
                            elapsed = now - last_time
                            if elapsed >= 0.5:
                                bytes_delta = self.downloaded_bytes - last_bytes
                                current_speed = bytes_delta / elapsed
                                speed_window.append(current_speed)
                                if len(speed_window) > 10:
                                    speed_window.pop(0)
                                avg_speed = sum(speed_window) / len(speed_window)
                                with self._lock:
                                    self.speed_bps = avg_speed
                                    remaining = self.total_bytes - self.downloaded_bytes
                                    self.eta_seconds = remaining / avg_speed if avg_speed > 0 else 0
                                last_time = now
                                last_bytes = self.downloaded_bytes

            # Download complete — move temp file to final location
            if self._cancel_event.is_set():
                with self._lock:
                    self.status = "cancelled"
                return

            # If it's a zip (CT2 models), extract; otherwise just rename
            if tmp_path.endswith(".zip.download"):
                import zipfile
                extract_dir = os.path.dirname(self.dest_path)
                with zipfile.ZipFile(tmp_path, "r") as zf:
                    # ZipSlip prevention: validate all member paths
                    real_extract = os.path.realpath(extract_dir)
                    for member in zf.namelist():
                        target = os.path.realpath(os.path.join(extract_dir, member))
                        if not target.startswith(real_extract + os.sep) and target != real_extract:
                            raise ValueError(f"Zip path traversal detected: {member}")
                    zf.extractall(extract_dir)
                os.remove(tmp_path)
            else:
                if os.path.exists(self.dest_path):
                    os.remove(self.dest_path)
                os.rename(tmp_path, self.dest_path)

            with self._lock:
                self.downloaded_bytes = self.total_bytes
                self.speed_bps = 0
                self.eta_seconds = 0
                self.status = "completed"
            logger.info("Download completed: %s", self.model_id)

        except Exception as exc:
            with self._lock:
                self.status = "failed"
                self.error = str(exc)
            logger.error("Download failed for %s: %s", self.model_id, exc)
        finally:
            # Clean up temp file on failure/cancel
            if self.status in ("cancelled", "failed"):
                try:
                    if os.path.exists(tmp_path):
                        os.remove(tmp_path)
                except OSError:
                    pass
            # Remove from active downloads after a short delay so clients can read final status
            def _cleanup():
                time.sleep(5)
                _active_downloads.pop(self.model_id, None)

            if self.status in ("completed", "failed", "cancelled"):
                threading.Thread(target=_cleanup, daemon=True).start()


def _get_model_info():
    """Check which offline models are installed."""
    models = [
        {
            "id": "nllb-600m",
            "name": "NLLB-600M (Quick)",
            "desc_key": "quickModelDesc",
            "size": "~500MB",
            "speed_key": "speedFast",
            "quality_key": "qualityBasic",
            "check_file": "nllb-600m-game-v1",
            "installed": False,
        },
        {
            "id": "game-translator-7b",
            "name": "Game Translator 7B (Quality)",
            "desc_key": "qualityModelDesc",
            "size": "~4.5GB",
            "speed_key": "speedNormal",
            "quality_key": "qualityBest",
            "check_file": "game-translator-7b-q4.gguf",
            "installed": False,
            "status": "dev",
        },
        {
            "id": "lama-manga",
            "name": "LaMa Manga Inpainter",
            "desc_key": "lamaModelDesc",
            "size": "~200MB",
            "speed_key": "speedNormal",
            "quality_key": "qualityBest",
            "check_file": "lama-manga",
            "installed": False,
        },
        {
            "id": "comic-text-detector",
            "name": "Comic Text Detector",
            "desc_key": "ctdModelDesc",
            "size": "~90MB",
            "speed_key": "speedFast",
            "quality_key": "qualityBest",
            "check_file": "comic-text-detector",
            "installed": False,
        },
        {
            "id": "manga-ocr",
            "name": "Manga OCR",
            "desc_key": "mangaOcrModelDesc",
            "size": "~400MB",
            "speed_key": "speedNormal",
            "quality_key": "qualityBest",
            "check_file": "manga-ocr",
            "installed": False,
        },
    ]

    for m in models:
        check_path = os.path.join(MODELS_DIR, m["check_file"])
        m["installed"] = os.path.exists(check_path)
        # Also check if the directory exists (for CT2 models)
        if not m["installed"] and os.path.isdir(check_path):
            m["installed"] = True
        del m["check_file"]

    return models


def _resolve_dest_path(model_id: str) -> str:
    """Resolve the destination file/dir path for a model."""
    url = MODEL_DOWNLOAD_URLS.get(model_id, "")
    check_file = MODEL_CHECK_FILES.get(model_id, "")
    if url.endswith(".zip"):
        # For zip archives the check_file is the extracted directory
        return os.path.join(MODELS_DIR, check_file + ".zip")
    return os.path.join(MODELS_DIR, check_file)


@router.get("")
async def list_models():
    """List available offline AI models and their install status."""
    return {
        "models_dir": MODELS_DIR,
        "models": _get_model_info(),
    }


@router.post("/{model_id}/download")
async def start_download(model_id: str):
    """Start downloading a model in the background."""
    if model_id not in MODEL_DOWNLOAD_URLS:
        raise HTTPException(status_code=404, detail={"code": "UNKNOWN_MODEL", "model_id": model_id})

    # Block downloads for models still in development
    dev_models = {m["id"] for m in _get_model_info() if m.get("status") == "dev"}
    if model_id in dev_models:
        raise HTTPException(status_code=403, detail={"code": "MODEL_IN_DEVELOPMENT"})

    # Check if already installed
    check_file = MODEL_CHECK_FILES.get(model_id, "")
    check_path = os.path.join(MODELS_DIR, check_file)
    if os.path.exists(check_path) or os.path.isdir(check_path):
        raise HTTPException(status_code=409, detail={"code": "MODEL_ALREADY_INSTALLED"})

    # Check if already downloading
    if model_id in _active_downloads:
        task = _active_downloads[model_id]
        if task.status == "downloading":
            raise HTTPException(status_code=409, detail={"code": "DOWNLOAD_IN_PROGRESS"})

    url = MODEL_DOWNLOAD_URLS[model_id]
    dest = _resolve_dest_path(model_id)

    task = DownloadTask(model_id=model_id, url=url, dest_path=dest)
    _active_downloads[model_id] = task
    task.start()

    return {"ok": True, "model_id": model_id, "status": "downloading"}


@router.get("/{model_id}/download/status")
async def download_status_sse(model_id: str):
    """SSE stream for download progress."""

    async def event_stream():
        while True:
            task = _active_downloads.get(model_id)
            if task is None:
                # No active download — check if model is installed
                check_file = MODEL_CHECK_FILES.get(model_id, "")
                if check_file:
                    check_path = os.path.join(MODELS_DIR, check_file)
                    if os.path.exists(check_path) or os.path.isdir(check_path):
                        yield _sse_format("status", {
                            "model_id": model_id,
                            "status": "completed",
                            "progress": 100,
                            "downloaded_bytes": 0,
                            "total_bytes": 0,
                            "speed_bps": 0,
                            "eta_seconds": 0,
                            "error": None,
                        })
                        return
                yield _sse_format("status", {
                    "model_id": model_id,
                    "status": "idle",
                    "progress": 0,
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


@router.post("/{model_id}/download/cancel")
async def cancel_download(model_id: str):
    """Cancel an active download."""
    task = _active_downloads.get(model_id)
    if task is None or task.status != "downloading":
        raise HTTPException(status_code=404, detail={"code": "NO_ACTIVE_DOWNLOAD"})

    task.cancel()
    return {"ok": True, "model_id": model_id}


@router.delete("/{model_id}")
async def delete_model(model_id: str):
    """Delete an installed model."""
    check_file = MODEL_CHECK_FILES.get(model_id)
    if not check_file:
        raise HTTPException(status_code=404, detail={"code": "UNKNOWN_MODEL", "model_id": model_id})

    check_path = os.path.join(MODELS_DIR, check_file)

    if os.path.isdir(check_path):
        shutil.rmtree(check_path)
        return {"ok": True, "model_id": model_id}
    elif os.path.isfile(check_path):
        os.remove(check_path)
        return {"ok": True, "model_id": model_id}
    else:
        raise HTTPException(status_code=404, detail={"code": "MODEL_NOT_FOUND"})
