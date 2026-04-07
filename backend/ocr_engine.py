"""OCR engine using RapidOCR (bundled ONNX models) with winocr/tesseract fallbacks."""

import asyncio
import base64
import io
import logging
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)

# Lazy-init RapidOCR instance (heavy on first load)
_rapid_ocr = None


def _get_rapid_ocr():
    global _rapid_ocr
    if _rapid_ocr is None:
        from rapidocr_onnxruntime import RapidOCR
        _rapid_ocr = RapidOCR()
    return _rapid_ocr


@dataclass
class OCRTextBlock:
    text: str
    x: float
    y: float
    width: float
    height: float
    confidence: float = 1.0


@dataclass
class OCRResult:
    blocks: list[OCRTextBlock] = field(default_factory=list)
    full_text: str = ""
    language: str = ""
    engine: str = ""


def _resize_if_large(image_bytes: bytes, max_pixels: int = 2_000_000) -> bytes:
    """Resize image if too large to prevent OOM errors."""
    from PIL import Image
    img = Image.open(io.BytesIO(image_bytes))
    w, h = img.size
    if w * h <= max_pixels:
        return image_bytes
    scale = (max_pixels / (w * h)) ** 0.5
    new_w, new_h = int(w * scale), int(h * scale)
    img = img.resize((new_w, new_h), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


async def ocr_rapid(image_bytes: bytes, language: str = "ja") -> OCRResult:
    """Run OCR using RapidOCR (bundled ONNX models, no system deps)."""
    image_bytes = _resize_if_large(image_bytes)
    ocr = _get_rapid_ocr()
    result, _ = await asyncio.to_thread(ocr, image_bytes)

    blocks: list[OCRTextBlock] = []
    lines: list[str] = []

    if result:
        for item in result:
            bbox, text, confidence = item
            if not text or not text.strip():
                continue
            text = text.strip()
            lines.append(text)

            # bbox is [[x1,y1],[x2,y2],[x3,y3],[x4,y4]]
            if bbox and len(bbox) >= 4:
                x = min(p[0] for p in bbox)
                y = min(p[1] for p in bbox)
                x2 = max(p[0] for p in bbox)
                y2 = max(p[1] for p in bbox)
                blocks.append(OCRTextBlock(
                    text=text, x=x, y=y,
                    width=x2 - x, height=y2 - y,
                    confidence=confidence,
                ))
            else:
                blocks.append(OCRTextBlock(text=text, x=0, y=0, width=0, height=0, confidence=confidence))

    return OCRResult(
        blocks=blocks,
        full_text="\n".join(lines),
        language=language,
        engine="rapidocr",
    )


async def _winocr_raw(img, ocr_lang: str):
    """Run winocr on a PIL RGBA image, return (lines, blocks)."""
    import winocr

    w, h = img.size
    rgba_bytes = img.tobytes()
    result = await winocr.recognize_bytes(rgba_bytes, lang=ocr_lang, width=w, height=h)

    blocks: list[OCRTextBlock] = []
    lines: list[str] = []

    for line in result.lines:
        text = line.text.strip() if hasattr(line, "text") else ""
        if not text:
            continue
        lines.append(text)
        if hasattr(line, "words") and line.words:
            x_min = min(word.bounding_rect.x for word in line.words)
            y_min = min(word.bounding_rect.y for word in line.words)
            x_max = max(word.bounding_rect.x + word.bounding_rect.width for word in line.words)
            y_max = max(word.bounding_rect.y + word.bounding_rect.height for word in line.words)
            blocks.append(OCRTextBlock(text=text, x=x_min, y=y_min, width=x_max - x_min, height=y_max - y_min))
        else:
            blocks.append(OCRTextBlock(text=text, x=0, y=0, width=0, height=0))

    return lines, blocks


async def ocr_winocr(image_bytes: bytes, language: str = "ja") -> OCRResult:
    """Run OCR using Windows OCR API via winocr (requires language pack).

    Also attempts 90° rotated OCR to catch vertical text, then merges results.
    """
    try:
        import winocr
    except ImportError:
        raise RuntimeError("winocr is not installed")

    from PIL import Image

    lang_map = {
        "ja": "ja", "zh": "zh-Hans-CN", "zh-cn": "zh-Hans-CN",
        "zh-tw": "zh-Hant-TW", "ko": "ko", "en": "en",
    }
    ocr_lang = lang_map.get(language, language)

    img = Image.open(io.BytesIO(image_bytes)).convert("RGBA")
    orig_w, orig_h = img.size

    # 1) Normal (horizontal) OCR
    lines, blocks = await _winocr_raw(img, ocr_lang)

    # 2) Rotated 90° CCW for vertical text detection
    #    Rotate image, OCR, then map coordinates back to original
    try:
        rotated = img.rotate(90, expand=True)
        rot_lines, rot_blocks = await _winocr_raw(rotated, ocr_lang)

        if rot_lines:
            # Transform rotated coords back to original image coords
            # PIL rotate(90) = CCW 90°. Rotated image size = (orig_h, orig_w).
            # Inverse (CW 90°): orig_x = orig_w - ry - rh, orig_y = rx
            for rb in rot_blocks:
                orig_x = orig_w - rb.y - rb.height
                orig_y = rb.x
                orig_w_block = rb.height
                orig_h_block = rb.width
                # Check for duplicates (same text at similar position)
                is_dup = any(
                    b.text == rb.text and abs(b.x - orig_x) < 30 and abs(b.y - orig_y) < 30
                    for b in blocks
                )
                if not is_dup and rb.text.strip():
                    blocks.append(OCRTextBlock(
                        text=rb.text, x=orig_x, y=max(0, orig_y),
                        width=orig_w_block, height=orig_h_block,
                        confidence=rb.confidence,
                    ))
                    lines.append(rb.text)
    except Exception as e:
        logger.debug("Rotated OCR failed (non-critical): %s", e)

    return OCRResult(blocks=blocks, full_text="\n".join(lines), language=language, engine="winocr")


async def ocr_tesseract(image_bytes: bytes, language: str = "ja") -> OCRResult:
    """Fallback OCR using Tesseract."""
    try:
        import pytesseract
        from PIL import Image
    except ImportError:
        raise RuntimeError("pytesseract or Pillow is not installed")

    lang_map = {"ja": "jpn", "zh": "chi_sim", "zh-cn": "chi_sim", "zh-tw": "chi_tra", "ko": "kor", "en": "eng"}
    tess_lang = lang_map.get(language, "jpn")

    img = Image.open(io.BytesIO(image_bytes))
    data = await asyncio.to_thread(
        pytesseract.image_to_data, img, lang=tess_lang, output_type=pytesseract.Output.DICT,
    )

    blocks: list[OCRTextBlock] = []
    lines: list[str] = []
    current_line = ""
    current_block_num = -1

    for i in range(len(data["text"])):
        text = data["text"][i].strip()
        block_num = data["block_num"][i]
        conf = float(data["conf"][i])
        if block_num != current_block_num:
            if current_line:
                lines.append(current_line)
            current_line = ""
            current_block_num = block_num
        if text and conf > 0:
            current_line = f"{current_line} {text}".strip() if current_line else text
            blocks.append(OCRTextBlock(
                text=text, x=data["left"][i], y=data["top"][i],
                width=data["width"][i], height=data["height"][i], confidence=conf / 100.0,
            ))

    if current_line:
        lines.append(current_line)

    return OCRResult(blocks=blocks, full_text="\n".join(lines), language=language, engine="tesseract")


async def _auto_detect_language(image_bytes: bytes) -> OCRResult:
    """Try OCR with multiple languages and pick the best result (most text detected).

    Runs all languages concurrently for speed, then picks the one with the most text.
    The result.language field will contain the detected language code (ja/en/zh/ko).
    """
    import asyncio as _aio

    candidates = ["ja", "en", "zh", "ko"]

    async def _try_lang(lang: str) -> tuple[str, OCRResult | None]:
        try:
            result = await ocr_winocr(image_bytes, lang)
            return (lang, result)
        except Exception:
            return (lang, None)

    results = await _aio.gather(*[_try_lang(lang) for lang in candidates])

    best_result: OCRResult | None = None
    best_score = -1
    best_lang = ""

    for lang, result in results:
        if result is None:
            continue
        score = len(result.full_text.strip())
        if score > best_score:
            best_score = score
            best_result = result
            best_lang = lang

    if best_result and best_score > 0:
        best_result.language = best_lang
        return best_result

    raise RuntimeError("자동 언어 감지 실패: 텍스트를 감지할 수 없습니다.")


async def run_ocr(image_bytes: bytes, language: str = "ja", engine: str = "auto") -> OCRResult:
    """Run OCR with the specified engine. 'auto' tries rapidocr first, then winocr, then tesseract."""
    if engine == "rapidocr":
        return await ocr_rapid(image_bytes, language)
    elif engine == "winocr":
        if language == "auto":
            return await _auto_detect_language(image_bytes)
        return await ocr_winocr(image_bytes, language)
    elif engine == "tesseract":
        return await ocr_tesseract(image_bytes, language)

    # Auto engine: winocr (lightest, fastest for real-time)
    if language == "auto":
        try:
            return await _auto_detect_language(image_bytes)
        except Exception as e:
            logger.warning("Auto detect failed: %s", e)
            raise

    try:
        return await ocr_winocr(image_bytes, language)
    except Exception as e:
        logger.warning("winocr failed: %s", e)
        raise RuntimeError(
            f"OCR 언어팩이 설치되지 않았습니다. "
            f"관리자 PowerShell에서 다음 명령을 실행하세요:\n"
            f'Add-WindowsCapability -Online -Name "Language.OCR~~~ja~0.0.1.0"\n'
            f'Add-WindowsCapability -Online -Name "Language.OCR~~~en-US~0.0.1.0"'
        )


def decode_image(image_data: str) -> bytes:
    """Decode base64 image data, stripping data URI prefix if present."""
    if "," in image_data:
        image_data = image_data.split(",", 1)[1]
    return base64.b64decode(image_data)
