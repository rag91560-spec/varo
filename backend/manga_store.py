"""Manga local storage manager.

Stores manga images in a hidden folder under %APPDATA%/game-translator/.manga/
"""

import os
import json
import logging
from pathlib import Path
from typing import Optional

from PIL import Image

logger = logging.getLogger(__name__)

_APPDATA = os.environ.get("APPDATA", os.path.expanduser("~"))
MANGA_DIR = os.path.join(_APPDATA, "game-translator", ".manga")


def _ensure_dir(path: str) -> str:
    os.makedirs(path, exist_ok=True)
    return path


def manga_path(manga_id: int) -> str:
    return _ensure_dir(os.path.join(MANGA_DIR, str(manga_id)))


def images_path(manga_id: int) -> str:
    return _ensure_dir(os.path.join(manga_path(manga_id), "images"))


def translations_path(manga_id: int) -> str:
    return _ensure_dir(os.path.join(manga_path(manga_id), "translations"))


def image_file(manga_id: int, page: int, ext: str = "webp") -> str:
    return os.path.join(images_path(manga_id), f"{page:04d}.{ext}")


def thumbnail_file(manga_id: int) -> str:
    return os.path.join(manga_path(manga_id), "thumb.webp")


def meta_file(manga_id: int) -> str:
    return os.path.join(manga_path(manga_id), "meta.json")


def save_meta(manga_id: int, meta: dict) -> None:
    with open(meta_file(manga_id), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)


def load_meta(manga_id: int) -> Optional[dict]:
    path = meta_file(manga_id)
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def list_images(manga_id: int) -> list[str]:
    img_dir = images_path(manga_id)
    if not os.path.exists(img_dir):
        return []
    files = sorted(f for f in os.listdir(img_dir) if not f.startswith("."))
    return files


def generate_thumbnail(manga_id: int, source_page: int = 1) -> Optional[str]:
    """Generate a thumbnail from the first page image."""
    src = image_file(manga_id, source_page)
    # Try common extensions
    for ext in ("webp", "jpg", "jpeg", "png", "gif"):
        candidate = image_file(manga_id, source_page, ext)
        if os.path.exists(candidate):
            src = candidate
            break
    else:
        if not os.path.exists(src):
            return None

    try:
        thumb_path = thumbnail_file(manga_id)
        with Image.open(src) as img:
            img.thumbnail((300, 420))
            img.save(thumb_path, "WEBP", quality=80)
        return thumb_path
    except Exception as e:
        logger.warning("Failed to generate thumbnail for manga %d: %s", manga_id, e)
        return None


def delete_manga_files(manga_id: int) -> bool:
    """Delete all files for a manga."""
    import shutil
    path = os.path.join(MANGA_DIR, str(manga_id))
    if os.path.exists(path):
        shutil.rmtree(path)
        return True
    return False


def get_image_path(manga_id: int, page: int) -> Optional[str]:
    """Find the actual image file for a page (tries multiple extensions)."""
    for ext in ("webp", "jpg", "jpeg", "png", "gif"):
        path = image_file(manga_id, page, ext)
        if os.path.exists(path):
            return path
    return None


def _get_ext(filename: str) -> str:
    return os.path.splitext(filename)[1].lstrip(".")


def reorder_images(manga_id: int, new_order: list[int]) -> int:
    """Reorder images by renaming files. new_order is list of current page numbers in desired order.
    Returns new page count."""
    img_dir = images_path(manga_id)
    files = sorted(f for f in os.listdir(img_dir) if not f.startswith("."))
    if not files:
        return 0

    # Build mapping: current page number -> filename
    page_map: dict[int, str] = {}
    for f in files:
        stem = os.path.splitext(f)[0]
        try:
            page_map[int(stem)] = f
        except ValueError:
            continue

    # Validate order
    for p in new_order:
        if p not in page_map:
            raise ValueError(f"Page {p} does not exist")

    # Phase 1: rename all to temp names
    tmp_map: dict[int, str] = {}  # new_index -> ext
    for idx, old_page in enumerate(new_order):
        old_file = page_map[old_page]
        ext = _get_ext(old_file)
        tmp_name = f"_tmp_{idx:04d}.{ext}"
        os.rename(os.path.join(img_dir, old_file), os.path.join(img_dir, tmp_name))
        tmp_map[idx] = ext

    # Phase 2: rename temp to final sequential names
    for idx, ext in tmp_map.items():
        final_name = f"{idx + 1:04d}.{ext}"
        os.rename(os.path.join(img_dir, f"_tmp_{idx:04d}.{ext}"), os.path.join(img_dir, final_name))

    return len(new_order)


def delete_image(manga_id: int, page: int) -> int:
    """Delete a single image and shift subsequent pages down. Returns new page count."""
    img_dir = images_path(manga_id)
    target = get_image_path(manga_id, page)
    if not target:
        raise FileNotFoundError(f"Page {page} not found")

    os.remove(target)

    # Shift subsequent pages down
    files = sorted(f for f in os.listdir(img_dir) if not f.startswith(".") and not f.startswith("_"))
    # Rebuild sequential numbering
    for idx, f in enumerate(files):
        ext = _get_ext(f)
        new_name = f"{idx + 1:04d}.{ext}"
        if f != new_name:
            os.rename(os.path.join(img_dir, f), os.path.join(img_dir, new_name))

    return len(files)


def add_images(manga_id: int, files: list[tuple[bytes, str]]) -> int:
    """Add images after existing ones. files is list of (data, extension).
    Returns new total page count."""
    existing = list_images(manga_id)
    start_page = len(existing) + 1

    for i, (data, ext) in enumerate(files):
        page = start_page + i
        path = image_file(manga_id, page, ext)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as f:
            f.write(data)

    return start_page - 1 + len(files)
