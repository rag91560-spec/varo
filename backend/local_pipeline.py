"""Local manga translation pipeline.

CTD ONNX detection → manga-ocr OCR → text-only translation.
Avoids sending images to cloud APIs — NSFW safe.
"""

import logging
import os
from typing import Callable, Optional

import cv2
import numpy as np
from PIL import Image

logger = logging.getLogger(__name__)


async def detect_and_translate(
    image_path: str,
    api_key: str,
    target_lang: str = "ko",
    model: str = "gemini-2.0-flash",
    progress_cb: Optional[Callable[[str, float], None]] = None,
) -> dict:
    """Run the full local pipeline: detect → OCR → translate.

    Args:
        image_path: Path to the manga page image.
        api_key: Gemini API key (for text-only translation).
        target_lang: Target language code.
        model: Translation model name.
        progress_cb: Optional callback(stage, progress) for progress reporting.

    Returns:
        {"entries": [...], "raw_text": str} — same format as gemini_translator.translate_page()
    """
    from . import ctd_detector
    from . import manga_ocr_engine
    from .gemini_translator import translate_texts

    if progress_cb:
        progress_cb("detecting", 0.0)

    # 1. Detect text regions with CTD
    if not ctd_detector.is_available():
        raise RuntimeError("CTD model not installed. Download from Settings > Models.")

    ratio_regions = ctd_detector.detect_to_ratios(image_path)

    if not ratio_regions:
        return {"entries": [], "raw_text": ""}

    if progress_cb:
        progress_cb("detecting", 1.0)

    # 2. Crop regions and run OCR
    if not manga_ocr_engine.is_available():
        raise RuntimeError("manga-ocr model not installed. Download from Settings > Models.")

    img = cv2.imread(image_path)
    if img is None:
        raise ValueError(f"Cannot read image: {image_path}")

    img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    orig_h, orig_w = img.shape[:2]

    cropped_images = []
    for r in ratio_regions:
        x1 = int(r["x"] * orig_w)
        y1 = int(r["y"] * orig_h)
        x2 = int((r["x"] + r["width"]) * orig_w)
        y2 = int((r["y"] + r["height"]) * orig_h)

        # Clamp
        x1 = max(0, x1)
        y1 = max(0, y1)
        x2 = min(orig_w, x2)
        y2 = min(orig_h, y2)

        crop = img_rgb[y1:y2, x1:x2]
        if crop.size == 0:
            cropped_images.append(None)
            continue
        cropped_images.append(Image.fromarray(crop))

    # OCR each region
    original_texts = []
    valid_indices = []

    for i, crop_img in enumerate(cropped_images):
        if progress_cb:
            progress_cb("ocr", i / len(cropped_images))

        if crop_img is None:
            original_texts.append("")
            continue

        try:
            text = manga_ocr_engine.recognize(crop_img)
            original_texts.append(text)
            if text.strip():
                valid_indices.append(i)
        except Exception as e:
            logger.warning("OCR failed for region %d: %s", i, e)
            original_texts.append("")

    if progress_cb:
        progress_cb("ocr", 1.0)

    # Filter out empty texts
    texts_to_translate = [original_texts[i] for i in valid_indices]

    if not texts_to_translate:
        if len(cropped_images) > 0:
            logger.warning("OCR returned empty results for all %d detected regions", len(cropped_images))
        return {"entries": [], "raw_text": ""}

    # 3. Translate texts (text-only, no image sent)
    if progress_cb:
        progress_cb("translating", 0.0)

    translated_texts = await translate_texts(
        texts_to_translate, api_key, target_lang=target_lang, model=model
    )

    if progress_cb:
        progress_cb("translating", 1.0)

    # 4. Build entries in the same format as Gemini Vision output
    entries = []
    translated_idx = 0

    for i, region in enumerate(ratio_regions):
        original = original_texts[i]
        if not original.strip():
            continue

        translated = translated_texts[translated_idx] if translated_idx < len(translated_texts) else ""
        translated_idx += 1

        # Analyze text color from the cropped region
        text_color = "#000000"
        bg_type = "solid"
        if cropped_images[i] is not None:
            text_color, bg_type = _analyze_text_appearance(
                img_rgb, region, orig_w, orig_h
            )

        entry = {
            "original": original,
            "translated": translated,
            "x": region["x"],
            "y": region["y"],
            "width": region["width"],
            "height": region["height"],
            "direction": region.get("direction", "horizontal"),
        }

        if region.get("polygon"):
            entry["polygon"] = region["polygon"]
        if text_color:
            entry["text_color"] = text_color
        if bg_type:
            entry["bg_type"] = bg_type

        entries.append(entry)

    # Build raw text
    raw_lines = [f"{e['original']} → {e['translated']}" for e in entries]

    return {
        "entries": entries,
        "raw_text": "\n".join(raw_lines),
    }


def _analyze_text_appearance(
    img_rgb: np.ndarray,
    region: dict,
    orig_w: int,
    orig_h: int,
) -> tuple[str, str]:
    """Analyze text color and background type from a region.

    Returns:
        (text_color_hex, bg_type)
    """
    x1 = int(region["x"] * orig_w)
    y1 = int(region["y"] * orig_h)
    x2 = int((region["x"] + region["width"]) * orig_w)
    y2 = int((region["y"] + region["height"]) * orig_h)

    x1 = max(0, x1)
    y1 = max(0, y1)
    x2 = min(orig_w, x2)
    y2 = min(orig_h, y2)

    crop = img_rgb[y1:y2, x1:x2]
    if crop.size == 0:
        return "#000000", "solid"

    # Convert to grayscale for analysis
    gray = np.mean(crop, axis=2)

    # Background: sample edges (likely background)
    h, w = gray.shape
    edge_pixels = np.concatenate([
        gray[0, :],           # top edge
        gray[-1, :],          # bottom edge
        gray[:, 0],           # left edge
        gray[:, -1],          # right edge
    ])
    bg_mean = np.mean(edge_pixels)
    bg_std = np.std(edge_pixels)

    # Determine bg_type
    if bg_std < 15:
        bg_type = "solid"
    elif bg_std < 40:
        bg_type = "gradient"
    else:
        bg_type = "complex"

    # Text color: assume text is the minority color
    # If background is light, text is dark (and vice versa)

    if bg_mean > 128:
        # Light background → dark text
        # Sample darkest pixels in center
        dark_threshold = np.percentile(gray, 15)
        dark_pixels = crop[gray < dark_threshold]
        if len(dark_pixels) > 0:
            avg_color = np.mean(dark_pixels, axis=0).astype(int)
            text_color = f"#{avg_color[0]:02x}{avg_color[1]:02x}{avg_color[2]:02x}"
        else:
            text_color = "#000000"
    else:
        # Dark background → light text
        light_threshold = np.percentile(gray, 85)
        light_pixels = crop[gray > light_threshold]
        if len(light_pixels) > 0:
            avg_color = np.mean(light_pixels, axis=0).astype(int)
            text_color = f"#{avg_color[0]:02x}{avg_color[1]:02x}{avg_color[2]:02x}"
        else:
            text_color = "#ffffff"

    return text_color, bg_type
