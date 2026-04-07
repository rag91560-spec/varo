"""Manga page inpainting + text rendering pipeline.

5-stage pipeline: mask → inpaint → color detect → text render → save
"""

import io
import logging
import math
import os
from dataclasses import dataclass, field
from typing import Optional, Callable

import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

logger = logging.getLogger(__name__)

_APPDATA = os.environ.get("APPDATA") or os.path.join(os.path.expanduser("~"), ".local", "share")
FONTS_DIR = os.path.join(_APPDATA, "게임번역기", "fonts")
os.makedirs(FONTS_DIR, exist_ok=True)

# Font registry — Free Korean fonts
# Sources: 디시인사이드 만갤, 아카라이브 역식 채널, 루리웹 손번역 커뮤니티 기준
FONT_REGISTRY: dict[str, dict] = {
    # ── 대사용 (말풍선 내 일반 대사) ──────────────────────────────
    "nanummyeongjo": {
        "name": "나눔명조 ★추천",
        "file": "NanumMyeongjo-Regular.ttf",
        "type": "serif",
        "description": "만갤/역식 채널 대사용 정석. 가장 자연스러운 만화 느낌.",
        "url": "https://github.com/google/fonts/raw/main/ofl/nanummyeongjo/NanumMyeongjo-Regular.ttf",
    },
    "nanummyeongjo-bold": {
        "name": "나눔명조 Bold",
        "file": "NanumMyeongjo-Bold.ttf",
        "type": "serif",
        "description": "나눔명조 굵게. 강조 대사에 사용.",
        "url": "https://github.com/google/fonts/raw/main/ofl/nanummyeongjo/NanumMyeongjo-Bold.ttf",
    },
    "dohyeon": {
        "name": "도현체 (배민)",
        "file": "DoHyeon-Regular.ttf",
        "type": "bold",
        "description": "굵고 강한 고딕. 소리치거나 강조할 때.",
        "url": "https://github.com/google/fonts/raw/main/ofl/dohyeon/DoHyeon-Regular.ttf",
    },
    "jua": {
        "name": "주아체 (배민)",
        "file": "Jua-Regular.ttf",
        "type": "round",
        "description": "동글동글 손글씨. 캐주얼한 대사, 귀여운 캐릭터.",
        "url": "https://github.com/google/fonts/raw/main/ofl/jua/Jua-Regular.ttf",
    },
    # ── 기타 ──────────────────────────────────────────────────────
    "nanum-square-round": {
        "name": "나눔스퀘어라운드",
        "file": "NanumSquareRoundB.ttf",
        "type": "round",
        "description": "깔끔한 둥근 고딕. 웹툰 스타일.",
        "url": "https://github.com/innks/NanumSquareRound/raw/master/NanumSquareRoundB.ttf",
    },
    "nanum-pen": {
        "name": "나눔손글씨 펜",
        "file": "NanumPen.ttf",
        "type": "handwriting",
        "description": "손글씨체. 편지/일기/속삭임 대사.",
        "url": "https://github.com/google/fonts/raw/main/ofl/nanumpenscript/NanumPenScript-Regular.ttf",
    },
    "noto-sans-kr": {
        "name": "Noto Sans KR",
        "file": "NotoSansKR-Medium.otf",
        "type": "sans",
        "description": "범용 고딕체.",
        "url": "https://github.com/google/fonts/raw/main/ofl/notosanskr/NotoSansKR%5Bwght%5D.ttf",
    },
}

# Bundled fallback font path (Pillow default)
_FALLBACK_FONT: Optional[str] = None


@dataclass
class RenderConfig:
    inpaint_mode: str = "telea"  # solid | telea | ns | lama
    font_id: str = "nanummyeongjo"
    auto_color: bool = True
    outline_enabled: bool = True
    outline_width: int = 2
    direction: str = "auto"  # auto | horizontal | vertical
    font_size_override: int = 0  # 0 = auto


@dataclass
class TextRegion:
    """A detected text region on a manga page."""
    original: str = ""
    translated: str = ""
    x: float = 0  # 0-1 ratio
    y: float = 0
    width: float = 0
    height: float = 0
    direction: str = "horizontal"
    polygon: list = field(default_factory=list)  # [[x1,y1], ...] optional
    text_color: str = ""   # hint from Gemini
    bg_type: str = ""      # solid | gradient | complex


def get_font_path(font_id: str) -> Optional[str]:
    """Get font file path. Returns None if not installed."""
    info = FONT_REGISTRY.get(font_id)
    if not info:
        return None
    path = os.path.join(FONTS_DIR, info["file"])
    if os.path.isfile(path):
        return path
    # Try alternative name (variable font)
    alt = os.path.join(FONTS_DIR, info["file"].replace("-Medium", ""))
    if os.path.isfile(alt):
        return alt
    return None


def list_fonts() -> list[dict]:
    """List available fonts with install status."""
    result = []
    for fid, info in FONT_REGISTRY.items():
        path = get_font_path(fid)
        result.append({
            "id": fid,
            "name": info["name"],
            "type": info["type"],
            "installed": path is not None,
            "file": info["file"],
        })
    return result


def _get_font(font_id: str, size: int) -> ImageFont.FreeTypeFont:
    """Load font at given size. Falls back to default if not installed."""
    path = get_font_path(font_id)
    if path:
        return ImageFont.truetype(path, size)
    # Fallback: try system fonts
    for name in ["NotoSansCJK-Regular.ttc", "malgun.ttf", "arial.ttf"]:
        try:
            return ImageFont.truetype(name, size)
        except (OSError, IOError):
            continue
    return ImageFont.load_default()


# --- Stage 1: Mask Generation ---

def generate_text_mask(image: Image.Image, regions: list[TextRegion],
                       expand_px: int = 4) -> Image.Image:
    """Generate a binary mask of text regions (white = text, black = background).

    When regions represent speech bubble bounds (not just text bounds), a small
    inset is applied to preserve the bubble's outline stroke.
    """
    w, h = image.size
    mask = Image.new("L", (w, h), 0)
    draw = ImageDraw.Draw(mask)

    for r in regions:
        if r.polygon and len(r.polygon) >= 3:
            # Polygon from Gemini: draw as-is (already tight around text)
            pts = [(int(p[0] * w), int(p[1] * h)) for p in r.polygon]
            draw.polygon(pts, fill=255)
        else:
            x1 = int(r.x * w)
            y1 = int(r.y * h)
            x2 = int((r.x + r.width) * w)
            y2 = int((r.y + r.height) * h)
            # Inset by 2px to preserve bubble border strokes
            border_inset = 2
            x1 = max(0, x1 + border_inset)
            y1 = max(0, y1 + border_inset)
            x2 = min(w, x2 - border_inset)
            y2 = min(h, y2 - border_inset)
            # Fix 6: skip degenerate (zero-size) regions to avoid mask errors
            if x2 <= x1 or y2 <= y1:
                continue
            draw.rectangle([x1, y1, x2, y2], fill=255)

    # Dilate mask slightly to catch anti-aliased text edges
    dilation = max(expand_px, 3)
    mask = mask.filter(ImageFilter.MaxFilter(dilation * 2 + 1))

    return mask


# --- Stage 2: Inpainting ---

def inpaint_solid(image: Image.Image, mask: Image.Image) -> Image.Image:
    """Simple solid-color inpainting — fills masked areas with border median color."""
    result = image.copy()
    img_arr = np.array(result)
    mask_arr = np.array(mask)

    # For each connected region, sample border colors
    from PIL import ImageFilter as IF
    # Dilate mask slightly to get border
    border_mask = np.array(mask.filter(IF.MaxFilter(21))) - mask_arr
    border_mask = np.clip(border_mask, 0, 255)

    if np.sum(border_mask > 0) > 0:
        border_pixels = img_arr[border_mask > 128]
        if len(border_pixels) > 0:
            fill_color = np.median(border_pixels, axis=0).astype(np.uint8)
        else:
            fill_color = np.array([255, 255, 255], dtype=np.uint8)
    else:
        fill_color = np.array([255, 255, 255], dtype=np.uint8)

    # Fill
    img_arr[mask_arr > 128] = fill_color
    result = Image.fromarray(img_arr)

    # Gaussian blur at edges for smooth blending
    blurred = result.filter(ImageFilter.GaussianBlur(2))
    edge_mask = mask.filter(ImageFilter.GaussianBlur(3))
    result = Image.composite(blurred, result, edge_mask)

    return result


def inpaint_opencv(image: Image.Image, mask: Image.Image,
                   method: str = "telea") -> Image.Image:
    """OpenCV inpainting (Telea or Navier-Stokes)."""
    try:
        import cv2
    except ImportError:
        logger.warning("OpenCV not available, falling back to solid inpaint")
        return inpaint_solid(image, mask)

    img_arr = np.array(image.convert("RGB"))
    mask_arr = np.array(mask)

    # Ensure binary mask
    _, mask_bin = cv2.threshold(mask_arr, 128, 255, cv2.THRESH_BINARY)

    flag = cv2.INPAINT_TELEA if method == "telea" else cv2.INPAINT_NS
    result = cv2.inpaint(img_arr, mask_bin, inpaintRadius=5, flags=flag)

    return Image.fromarray(result)


async def inpaint_lama(image: Image.Image, mask: Image.Image) -> Image.Image:
    """LaMa ONNX inpainting for high-quality results."""
    try:
        from . import lama_engine
        if not lama_engine.is_available():
            logger.warning("LaMa model not available, falling back to telea")
            return inpaint_opencv(image, mask, "telea")

        img_arr = np.array(image.convert("RGB"))
        mask_arr = np.array(mask)
        result = lama_engine.inpaint(img_arr, mask_arr)
        return Image.fromarray(result)
    except Exception as e:
        logger.warning("LaMa inpaint failed: %s, falling back to telea", e)
        return inpaint_opencv(image, mask, "telea")


def inpaint_image(image: Image.Image, mask: Image.Image,
                  mode: str = "telea") -> Image.Image:
    """Inpaint image using specified mode (sync wrapper)."""
    if mode == "solid":
        return inpaint_solid(image, mask)
    elif mode == "ns":
        return inpaint_opencv(image, mask, "ns")
    elif mode == "lama":
        # LaMa is async but we provide sync fallback
        import asyncio
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                # Can't await in sync context — fall back
                return inpaint_opencv(image, mask, "telea")
            return loop.run_until_complete(inpaint_lama(image, mask))
        except RuntimeError:
            return inpaint_opencv(image, mask, "telea")
    else:  # telea (default)
        return inpaint_opencv(image, mask, "telea")


# --- Stage 3: Color/Font Detection ---

def detect_text_color(image: Image.Image, region: TextRegion) -> tuple:
    """Detect appropriate text and background colors for a region.

    Samples the edge area of the region (not the center, which may still have
    residual text pixels) for a more accurate background estimate.
    Falls back to high-contrast color if the sampled area is ambiguous.

    Returns (text_rgb, bg_rgb) as (R, G, B) tuples.
    """
    w, h = image.size
    bx = int(region.x * w)
    by = int(region.y * h)
    bw = int(region.width * w)
    bh = int(region.height * h)

    if bw < 4 or bh < 4:
        return ((0, 0, 0), (255, 255, 255))

    # Fix 4: clamp coordinates to image bounds before sampling
    by = max(0, by)
    bx = max(0, bx)
    bx2 = min(image.width, bx + bw)
    by2 = min(image.height, by + bh)
    bw = bx2 - bx
    bh = by2 - by
    if bw < 4 or bh < 4:
        return ((0, 0, 0), (255, 255, 255))

    img_arr = np.array(image.convert("RGB"))

    # Sample from the four edges of the bounding box (border strip, ~15% inward)
    border = max(2, int(min(bw, bh) * 0.15))
    edge_pixels = []

    # Top strip
    y1, y2 = by, min(by + border, by + bh)
    edge_pixels.append(img_arr[y1:y2, bx:bx + bw].reshape(-1, 3))
    # Bottom strip
    y1, y2 = max(by, by + bh - border), by + bh
    edge_pixels.append(img_arr[y1:y2, bx:bx + bw].reshape(-1, 3))
    # Left strip
    x1, x2 = bx, min(bx + border, bx + bw)
    edge_pixels.append(img_arr[by:by + bh, x1:x2].reshape(-1, 3))
    # Right strip
    x1, x2 = max(bx, bx + bw - border), bx + bw
    edge_pixels.append(img_arr[by:by + bh, x1:x2].reshape(-1, 3))

    all_edge = np.concatenate([p for p in edge_pixels if len(p) > 0], axis=0)
    if len(all_edge) == 0:
        return ((0, 0, 0), (255, 255, 255))

    bg_rgb = tuple(int(v) for v in np.median(all_edge, axis=0))

    # Text color: pick black or white based on contrast with background
    bg_brightness = 0.299 * bg_rgb[0] + 0.587 * bg_rgb[1] + 0.114 * bg_rgb[2]

    # Use high contrast threshold with hysteresis (avoid mid-grey ambiguity)
    if bg_brightness > 160:
        text_rgb = (10, 10, 10)    # Near-black on light bg
    elif bg_brightness < 80:
        text_rgb = (245, 245, 245) # Near-white on dark bg
    else:
        # Mid-grey: pick based on which gives more contrast
        text_rgb = (10, 10, 10) if bg_brightness > 128 else (245, 245, 245)

    return (text_rgb, bg_rgb)


def detect_font_type(region: TextRegion) -> str:
    """Detect appropriate font type based on text direction."""
    if region.direction == "vertical":
        return "serif"
    return "sans"


# --- Stage 4: Text Rendering ---

# CJK horizontal-to-vertical punctuation map (H2V)
# Source: Unicode CJK Compatibility Forms (U+FE30..FE4F) + Vertical Forms (U+FE10..FE1F)
_CJK_H2V: dict[str, str] = {
    "。": "︒",  # ideographic full stop
    "「": "﹁",  # left corner bracket
    "」": "﹂",  # right corner bracket
    "『": "﹃",  # left white corner bracket
    "』": "﹄",  # right white corner bracket
    "【": "︻",  # left black lenticular bracket
    "】": "︼",  # right black lenticular bracket
    "《": "︽",  # left double angle bracket
    "》": "︾",  # right double angle bracket
    "〈": "︿",  # left angle bracket
    "〉": "﹀",  # right angle bracket
    "—": "︱",  # em dash
    "…": "︙",  # horizontal ellipsis → vertical
    "、": "︑",  # ideographic comma
    "：": "︓",  # fullwidth colon
    "；": "︔",  # fullwidth semicolon
    "！": "︕",  # fullwidth exclamation
    "？": "︖",  # fullwidth question
    "(": "︵",  # left parenthesis
    ")": "︶",  # right parenthesis
    "（": "︵",  # fullwidth left paren
    "）": "︶",  # fullwidth right paren
    "〔": "︹",  # left tortoise shell bracket
    "〕": "︺",  # right tortoise shell bracket
    "「": "﹁",
    "」": "﹂",
}


def _apply_h2v(text: str) -> str:
    """Convert horizontal CJK punctuation to vertical equivalents."""
    return "".join(_CJK_H2V.get(ch, ch) for ch in text)


def _is_cjk(char: str) -> bool:
    """Check if character is CJK."""
    cp = ord(char)
    return (
        0x4E00 <= cp <= 0x9FFF or   # CJK Unified
        0x3400 <= cp <= 0x4DBF or   # CJK Extension A
        0xAC00 <= cp <= 0xD7AF or   # Korean Hangul
        0x3040 <= cp <= 0x309F or   # Hiragana
        0x30A0 <= cp <= 0x30FF or   # Katakana
        0xFF00 <= cp <= 0xFFEF      # Fullwidth
    )


def _line_height(font_size: int) -> int:
    """Consistent line height (font size + spacing). Used in both sizing and rendering."""
    return font_size + max(2, font_size // 5)


def _wrap_text(text: str, font: ImageFont.FreeTypeFont, max_width: int,
               direction: str = "horizontal") -> list[str]:
    """Wrap text to fit within max_width pixels.

    For horizontal text uses word-level breaking first (split on spaces),
    then falls back to character-level if a single word is wider than the box.
    This avoids orphaned single characters and produces more natural line breaks.
    """
    if direction == "vertical":
        # Vertical rendering uses character list, not lines
        return list(text.replace("\n", ""))

    lines = []
    for paragraph in text.split("\n"):
        if not paragraph.strip():
            lines.append("")
            continue

        # Fix 2: detect CJK text — if most chars are CJK, use character-level
        # wrapping directly to avoid aggressive over-splitting from word-level pass
        non_space = [c for c in paragraph if not c.isspace()]
        cjk_count = sum(1 for c in non_space if ord(c) > 0x1100)
        is_cjk_text = len(non_space) > 0 and (cjk_count / len(non_space)) >= 0.5

        if is_cjk_text:
            current_line = ""
            for char in paragraph:
                if char == "\n":
                    if current_line:
                        lines.append(current_line)
                    current_line = ""
                    continue
                test = current_line + char
                tbbox = font.getbbox(test)
                tw = tbbox[2] - tbbox[0] if tbbox else 0
                if tw > max_width and current_line:
                    lines.append(current_line)
                    current_line = char
                else:
                    current_line = test
            if current_line:
                lines.append(current_line)
            continue

        words = paragraph.split(" ")
        current_line = ""

        for word in words:
            # Try appending the word (with space separator if not first)
            candidate = (current_line + " " + word).lstrip() if current_line else word

            bbox = font.getbbox(candidate)
            w = bbox[2] - bbox[0] if bbox else 0

            if w <= max_width:
                current_line = candidate
            else:
                # Word doesn't fit — flush current line
                if current_line:
                    lines.append(current_line)
                    current_line = ""

                # Check if the word alone fits; if not, break character-by-character
                word_bbox = font.getbbox(word)
                word_w = word_bbox[2] - word_bbox[0] if word_bbox else 0

                if word_w <= max_width:
                    current_line = word
                else:
                    # Character-level fallback for very long words / CJK
                    for char in word:
                        test = current_line + char
                        tbbox = font.getbbox(test)
                        tw = tbbox[2] - tbbox[0] if tbbox else 0
                        if tw > max_width and current_line:
                            lines.append(current_line)
                            current_line = char
                        else:
                            current_line = test

        if current_line:
            lines.append(current_line)

    return lines if lines else [""]


def _calculate_font_size(text: str, box_w: int, box_h: int,
                         direction: str, font_id: str,
                         min_size: int = 8, max_size: int = 0) -> int:
    """Binary search for the largest font size that fits the box."""
    if max_size <= 0:
        max_size = box_h if direction == "horizontal" else box_w

    lo, hi = min_size, min(max_size, 200)
    best = min_size

    while lo <= hi:
        mid = (lo + hi) // 2
        font = _get_font(font_id, mid)

        if direction == "vertical":
            # Vertical: chars stacked, columns right-to-left
            chars = list(_apply_h2v(text).replace("\n", ""))
            if not chars:
                break
            char_bbox = font.getbbox("가")
            char_w = char_bbox[2] - char_bbox[0] if char_bbox else mid
            char_h = char_bbox[3] - char_bbox[1] if char_bbox else mid
            spacing = max(2, mid // 8)

            chars_per_col = max(1, box_h // (char_h + spacing))
            n_cols = math.ceil(len(chars) / chars_per_col)
            total_w = n_cols * (char_w + spacing)
            total_h = min(len(chars), chars_per_col) * (char_h + spacing)

            if total_w <= box_w and total_h <= box_h:
                best = mid
                lo = mid + 1
            else:
                hi = mid - 1
        else:
            # Horizontal
            wrapped = _wrap_text(text, font, box_w, "horizontal")
            total_h = len(wrapped) * _line_height(mid)

            if total_h <= box_h:
                best = mid
                lo = mid + 1
            else:
                hi = mid - 1

    return best


def _draw_text_with_outline(draw: ImageDraw.Draw, pos: tuple, text: str,
                            font: ImageFont.FreeTypeFont,
                            fill: tuple, outline_color: tuple,
                            outline_width: int):
    """Draw text with outline using stroke or 8-direction offset."""
    x, y = pos
    if outline_width > 0:
        # Use Pillow's built-in stroke
        draw.text((x, y), text, font=font, fill=fill,
                  stroke_width=outline_width, stroke_fill=outline_color)
    else:
        draw.text((x, y), text, font=font, fill=fill)


def _render_vertical_text(draw: ImageDraw.Draw, box_x: int, box_y: int,
                          box_w: int, box_h: int,
                          text: str, font: ImageFont.FreeTypeFont,
                          font_size: int, fill: tuple,
                          outline_color: tuple, outline_width: int):
    """Render vertical text: top→bottom, columns right→left.

    Applies CJK H2V punctuation conversion so brackets/commas face correctly
    in vertical layout.
    """
    chars = list(_apply_h2v(text).replace("\n", ""))
    if not chars:
        return

    char_bbox = font.getbbox("가")
    char_w = char_bbox[2] - char_bbox[0] if char_bbox else font_size
    char_h = char_bbox[3] - char_bbox[1] if char_bbox else font_size
    spacing = max(2, font_size // 8)
    col_spacing = max(2, font_size // 6)

    chars_per_col = max(1, box_h // (char_h + spacing))

    # Start from top-right
    col = 0
    idx = 0
    while idx < len(chars):
        x = box_x + box_w - (col + 1) * (char_w + col_spacing)
        if x < box_x:
            break

        for row in range(chars_per_col):
            if idx >= len(chars):
                break
            y = box_y + row * (char_h + spacing)
            if y + char_h > box_y + box_h:
                break

            _draw_text_with_outline(draw, (x, y), chars[idx], font,
                                    fill, outline_color, outline_width)
            idx += 1
        col += 1


def render_text_on_image(image: Image.Image, regions: list[TextRegion],
                         config: RenderConfig) -> Image.Image:
    """Render translated text onto (inpainted) image.

    Each region gets its own font size, color, and layout.
    """
    result = image.copy().convert("RGB")
    draw = ImageDraw.Draw(result)
    w, h = result.size

    for region in regions:
        if not region.translated or not region.translated.strip():
            continue

        # Bounding box in pixels
        bx = int(region.x * w)
        by = int(region.y * h)
        bw = int(region.width * w)
        bh = int(region.height * h)

        if bw < 5 or bh < 5:
            continue

        # Determine direction
        direction = config.direction
        if direction == "auto":
            # Korean is always read horizontally in modern context
            has_korean = any(0xAC00 <= ord(c) <= 0xD7AF for c in region.translated)
            if has_korean:
                direction = "horizontal"
            else:
                # For non-Korean (Japanese/Chinese output), respect original direction
                aspect = bh / max(bw, 1)
                direction = "vertical" if (region.direction == "vertical" and aspect > 1.5) else "horizontal"

        # Inner padding so text doesn't hug the bubble edges
        # Fix 3: reduced padding for small bubbles so more text fits
        pad = max(4, int(min(bw, bh) * 0.07))
        inner_x = bx + pad
        inner_y = by + pad
        inner_w = max(bw - pad * 2, 10)
        inner_h = max(bh - pad * 2, 10)

        # Color detection
        if config.auto_color:
            text_rgb, bg_rgb = detect_text_color(image, region)
            outline_rgb = bg_rgb
        else:
            text_rgb = (0, 0, 0)
            outline_rgb = (255, 255, 255)

        # Hint from Gemini
        if region.text_color:
            try:
                c = region.text_color.lstrip("#")
                text_rgb = (int(c[0:2], 16), int(c[2:4], 16), int(c[4:6], 16))
            except (ValueError, IndexError):
                pass

        # Font size: scale naturally with bubble size (binary search finds what fits)
        # Cap at 52px to avoid oversized text; scale cap down for small bubbles
        if config.font_size_override > 0:
            font_size = config.font_size_override
        else:
            smaller_dim = min(inner_w, inner_h)
            manga_max = min(int(smaller_dim * 0.15), 36)
            font_size = _calculate_font_size(
                region.translated, inner_w, inner_h, direction, config.font_id,
                max_size=max(manga_max, 10),
            )

        font = _get_font(config.font_id, font_size)
        outline_w = config.outline_width if config.outline_enabled else 0

        if direction == "vertical":
            _render_vertical_text(
                draw, inner_x, inner_y, inner_w, inner_h,
                region.translated, font, font_size,
                text_rgb, outline_rgb, outline_w,
            )
        else:
            # Horizontal rendering
            wrapped = _wrap_text(region.translated, font, inner_w, "horizontal")
            line_h = _line_height(font_size)
            total_text_h = len(wrapped) * line_h

            # Fix 1: if text still overflows after initial sizing, reduce font size
            # 1px at a time until it fits or we hit min_size (never truncate silently)
            min_font_size = 8
            while total_text_h > inner_h and font_size > min_font_size:
                font_size -= 1
                font = _get_font(config.font_id, font_size)
                wrapped = _wrap_text(region.translated, font, inner_w, "horizontal")
                line_h = _line_height(font_size)
                total_text_h = len(wrapped) * line_h

            # Center vertically within padded box
            start_y = inner_y + max(0, (inner_h - total_text_h) // 2)

            for i, line in enumerate(wrapped):
                ly = start_y + i * line_h
                if ly + font_size > inner_y + inner_h:
                    break

                # Center horizontally within padded box
                bbox = font.getbbox(line)
                line_w = bbox[2] - bbox[0] if bbox else 0
                lx = inner_x + max(0, (inner_w - line_w) // 2)

                _draw_text_with_outline(
                    draw, (lx, ly), line, font,
                    text_rgb, outline_rgb, outline_w,
                )

    return result


# --- Stage 5: Full Pipeline ---

def render_page(
    image_path: str,
    regions: list[TextRegion],
    config: RenderConfig,
    output_path: str,
    progress_cb: Optional[Callable[[float, str], None]] = None,
) -> str:
    """Full rendering pipeline: mask → inpaint → render text → save.

    Returns the output file path.
    """
    if progress_cb:
        progress_cb(0.1, "Loading image...")

    image = Image.open(image_path).convert("RGB")

    if not regions:
        # No regions to render — just save original
        image.save(output_path, "WEBP", quality=90)
        return output_path

    # Stage 1: Generate mask
    if progress_cb:
        progress_cb(0.2, "Generating text mask...")
    mask = generate_text_mask(image, regions)

    # Stage 2: Inpaint
    if progress_cb:
        progress_cb(0.4, f"Inpainting ({config.inpaint_mode})...")
    inpainted = inpaint_image(image, mask, config.inpaint_mode)

    # Stage 3+4: Render text on inpainted image
    if progress_cb:
        progress_cb(0.7, "Rendering text...")
    rendered = render_text_on_image(inpainted, regions, config)

    # Stage 5: Save
    if progress_cb:
        progress_cb(0.9, "Saving...")
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    rendered.save(output_path, "WEBP", quality=90)

    if progress_cb:
        progress_cb(1.0, "Complete")

    return output_path
