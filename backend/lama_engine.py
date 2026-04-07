"""LaMa (Large Mask) ONNX inpainting engine — manga-specific variant.

Uses dreMaz/AnimeMangaInpainting model for better manga/comic results.
Tiling approach: crop each text region individually for high-quality inpainting
instead of resizing the entire page to 512x512.
"""

import logging
import os
import threading

import numpy as np

logger = logging.getLogger(__name__)

_APPDATA = os.environ.get("APPDATA") or os.path.join(os.path.expanduser("~"), ".local", "share")
LAMA_MODEL_DIR = os.path.join(_APPDATA, "게임번역기", "models", "lama-manga")
LAMA_ONNX_FILE = os.path.join(LAMA_MODEL_DIR, "lama.onnx")
LAMA_DOWNLOAD_URL = "https://closedclaws.com/downloads/lama-manga-onnx.zip"

_TILE_SIZE = 512   # Model input resolution
_TILE_MARGIN = 32  # Context margin added around each masked region

_session = None
_session_lock = threading.Lock()


def is_available() -> bool:
    """Check if LaMa ONNX model file exists."""
    return os.path.isfile(LAMA_ONNX_FILE)


def load_model():
    """Load ONNX Runtime session (lazy, thread-safe)."""
    global _session
    with _session_lock:
        if _session is not None:
            return _session
        if not is_available():
            raise RuntimeError("LaMa model not installed. Download it from Settings > Models.")
        try:
            import onnxruntime as ort
            providers = ["CPUExecutionProvider"]
            if "CUDAExecutionProvider" in ort.get_available_providers():
                providers.insert(0, "CUDAExecutionProvider")
            _session = ort.InferenceSession(LAMA_ONNX_FILE, providers=providers)
            logger.info("LaMa ONNX model loaded (providers: %s)", _session.get_providers())
            return _session
        except Exception as e:
            logger.error("Failed to load LaMa model: %s", e)
            raise


def unload_model():
    """Unload the model to free memory."""
    global _session
    with _session_lock:
        _session = None
    logger.info("LaMa model unloaded")


def _run_lama(session, img_512: np.ndarray, mask_512: np.ndarray) -> np.ndarray:
    """Run LaMa inference on a 512x512 tile. Returns HWC uint8 RGB."""
    img_f = img_512.astype(np.float32) / 255.0
    mask_f = (mask_512.astype(np.float32) / 255.0)
    mask_f = (mask_f > 0.5).astype(np.float32)

    img_input = np.transpose(img_f, (2, 0, 1))[np.newaxis]   # (1, 3, 512, 512)
    mask_input = mask_f[np.newaxis, np.newaxis]               # (1, 1, 512, 512)

    input_names = [inp.name for inp in session.get_inputs()]
    output_names = [out.name for out in session.get_outputs()]

    if len(input_names) >= 2:
        feeds = {
            input_names[0]: img_input,
            input_names[1]: mask_input,
        }
    else:
        feeds = {input_names[0]: np.concatenate([img_input, mask_input], axis=1)}

    outputs = session.run(output_names, feeds)
    result = outputs[0]  # (1, 3, H, W)

    if result.ndim == 4:
        result = result[0]
    if result.shape[0] == 3:
        result = np.transpose(result, (1, 2, 0))  # CHW → HWC

    return np.clip(result * 255, 0, 255).astype(np.uint8)


def _mask_bbox(mask: np.ndarray) -> tuple[int, int, int, int] | None:
    """Return (x1, y1, x2, y2) bounding box of non-zero mask pixels, or None."""
    rows = np.any(mask > 128, axis=1)
    cols = np.any(mask > 128, axis=0)
    if not rows.any():
        return None
    y1, y2 = int(np.where(rows)[0][[0, -1]].tolist()[0]), int(np.where(rows)[0][[0, -1]].tolist()[1])
    x1, x2 = int(np.where(cols)[0][[0, -1]].tolist()[0]), int(np.where(cols)[0][[0, -1]].tolist()[1])
    return x1, y1, x2, y2


def inpaint(image: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """Run manga-optimized LaMa inpainting using region-crop tiling.

    Crops each masked region (+ context margin), runs LaMa at 512x512,
    then composites only the masked pixels back into the original image.
    This preserves full-resolution detail outside each text bubble.

    Args:
        image: HWC uint8 RGB image
        mask:  HW uint8 mask (255 = inpaint region)

    Returns:
        HWC uint8 RGB inpainted image
    """
    from PIL import Image as PILImage

    session = load_model()
    orig_h, orig_w = image.shape[:2]
    result = image.copy()

    bbox = _mask_bbox(mask)
    if bbox is None:
        return result

    cx1, cy1, cx2, cy2 = bbox

    # Expand by margin for surrounding context
    x1 = max(0, cx1 - _TILE_MARGIN)
    y1 = max(0, cy1 - _TILE_MARGIN)
    x2 = min(orig_w, cx2 + _TILE_MARGIN)
    y2 = min(orig_h, cy2 + _TILE_MARGIN)

    crop_w = x2 - x1
    crop_h = y2 - y1
    if crop_w < 1 or crop_h < 1:
        return result

    img_crop = image[y1:y2, x1:x2]
    mask_crop = mask[y1:y2, x1:x2]

    # Resize crop to model input size
    img_pil = PILImage.fromarray(img_crop).resize((_TILE_SIZE, _TILE_SIZE), PILImage.LANCZOS)
    mask_pil = PILImage.fromarray(mask_crop).resize((_TILE_SIZE, _TILE_SIZE), PILImage.NEAREST)

    inpainted_512 = _run_lama(session, np.array(img_pil), np.array(mask_pil))

    # Resize back to original crop dimensions
    inpainted_crop = np.array(
        PILImage.fromarray(inpainted_512).resize((crop_w, crop_h), PILImage.LANCZOS)
    )

    # Soft composite: inpainted pixels blend smoothly at mask edges
    mask_f = (mask_crop / 255.0)[..., np.newaxis]  # (H, W, 1) float
    blended = (inpainted_crop * mask_f + img_crop * (1.0 - mask_f)).astype(np.uint8)

    result[y1:y2, x1:x2] = blended
    return result
