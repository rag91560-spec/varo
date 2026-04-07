"""Filesystem browsing API for FolderBrowser component."""

import os
import sys
import string
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse

router = APIRouter(prefix="/api/filesystem", tags=["filesystem"])


@router.get("/browse")
async def browse(
    path: str = Query("", description="Directory path to browse. Empty = drive list (Windows)"),
    filter: Optional[str] = Query(None, description="Comma-separated extensions e.g. '.mp4,.mkv'"),
    folders_only: bool = Query(False, description="Show only folders"),
):
    """Browse filesystem — returns drives, folders and files."""
    extensions = None
    if filter:
        extensions = {e.strip().lower() for e in filter.split(",") if e.strip()}

    # Empty path → drive list (Windows) or root (Unix)
    if not path:
        if sys.platform == "win32":
            drives = []
            for letter in string.ascii_uppercase:
                drive = f"{letter}:\\"
                if os.path.exists(drive):
                    drives.append({
                        "name": drive,
                        "path": drive,
                        "type": "drive",
                        "size": None,
                        "modified": None,
                    })
            return {"path": "", "parent": None, "entries": drives}
        else:
            path = "/"

    path = os.path.normpath(path)
    if not os.path.isdir(path):
        return {"path": path, "parent": None, "entries": [], "error": "Not a directory"}

    parent = os.path.dirname(path)
    if parent == path:
        parent = ""  # root → drive list

    entries = []
    try:
        with os.scandir(path) as scanner:
            for entry in scanner:
                try:
                    is_dir = entry.is_dir(follow_symlinks=False)
                except OSError:
                    continue

                if is_dir:
                    try:
                        stat = entry.stat()
                        mtime = datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat()
                    except OSError:
                        mtime = None
                    entries.append({
                        "name": entry.name,
                        "path": entry.path,
                        "type": "folder",
                        "size": None,
                        "modified": mtime,
                    })
                elif not folders_only:
                    ext = os.path.splitext(entry.name)[1].lower()
                    if extensions and ext not in extensions:
                        continue
                    try:
                        stat = entry.stat()
                        size = stat.st_size
                        mtime = datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat()
                    except OSError:
                        size = None
                        mtime = None
                    entries.append({
                        "name": entry.name,
                        "path": entry.path,
                        "type": "file",
                        "size": size,
                        "modified": mtime,
                    })
    except PermissionError:
        return {"path": path, "parent": parent, "entries": [], "error": "Permission denied"}

    # Sort: folders first, then files, both alphabetical
    entries.sort(key=lambda e: (0 if e["type"] in ("drive", "folder") else 1, e["name"].lower()))

    return {"path": path, "parent": parent, "entries": entries}


@router.get("/serve")
async def serve_file(path: str = Query(..., description="Absolute file path to serve")):
    """Serve a local file (images only, for manga browser)."""
    if not os.path.isfile(path):
        raise HTTPException(404, "File not found")
    # Only allow image files
    ext = os.path.splitext(path)[1].lower()
    allowed = {".jpg", ".jpeg", ".png", ".bmp", ".webp", ".gif"}
    if ext not in allowed:
        raise HTTPException(403, "Only image files are allowed")
    return FileResponse(path)
