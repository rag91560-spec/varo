"""manga-ocr ONNX engine.

Japanese manga OCR using the manga-ocr model (ONNX runtime).
Recognizes text from cropped text region images.

Model: manga-ocr ONNX (~400MB)
Path:  %APPDATA%/게임번역기/models/manga-ocr/
HuggingFace: l0wgear/manga-ocr-2025-onnx
"""

import logging
import os
import re
import threading

import numpy as np
from PIL import Image

logger = logging.getLogger(__name__)

_APPDATA = os.environ.get("APPDATA") or os.path.join(os.path.expanduser("~"), ".local", "share")
MODEL_DIR = os.path.join(_APPDATA, "게임번역기", "models", "manga-ocr")

_processor = None
_model = None
_load_lock = threading.Lock()


def is_available() -> bool:
    """Check if manga-ocr ONNX model is installed."""
    # Check for key model files
    encoder = os.path.join(MODEL_DIR, "encoder_model.onnx")
    decoder = os.path.join(MODEL_DIR, "decoder_model.onnx")
    # Some ONNX exports use different naming
    alt_model = os.path.join(MODEL_DIR, "model.onnx")
    return (os.path.isfile(encoder) and os.path.isfile(decoder)) or os.path.isfile(alt_model)


def _load():
    """Load processor and ONNX model (lazy, thread-safe)."""
    global _processor, _model
    with _load_lock:
        if _processor is not None and _model is not None:
            return _processor, _model

        if not is_available():
            raise RuntimeError("manga-ocr model not installed. Download it from Settings > Models.")

        try:
            from transformers import AutoTokenizer, AutoImageProcessor
            from optimum.onnxruntime import ORTModelForVision2Seq

            # Load tokenizer + image processor
            _processor = {
                "tokenizer": AutoTokenizer.from_pretrained(MODEL_DIR),
                "image_processor": AutoImageProcessor.from_pretrained(MODEL_DIR),
            }

            # Load ONNX model
            _model = ORTModelForVision2Seq.from_pretrained(MODEL_DIR)
            logger.info("manga-ocr ONNX model loaded from %s", MODEL_DIR)
            return _processor, _model

        except ImportError as e:
            logger.error("Missing dependency for manga-ocr: %s", e)
            raise RuntimeError(
                "manga-ocr requires 'optimum[onnxruntime]' and 'transformers'. "
                "Install them with: pip install optimum[onnxruntime] transformers"
            ) from e
        except Exception as e:
            logger.error("Failed to load manga-ocr model: %s", e)
            raise


def unload_model():
    """Unload model to free memory."""
    global _processor, _model
    with _load_lock:
        _processor = None
        _model = None
    logger.info("manga-ocr model unloaded")


def recognize(image: Image.Image) -> str:
    """Recognize text from a cropped text region image.

    Args:
        image: PIL Image of a cropped text region.

    Returns:
        Recognized text string.
    """
    proc, model = _load()

    # Preprocess image
    image_processor = proc["image_processor"]
    tokenizer = proc["tokenizer"]

    pixel_values = image_processor(image, return_tensors="np").pixel_values

    # Generate (try numpy first, fallback to torch tensor if needed)
    try:
        generated = model.generate(
            pixel_values=pixel_values,
            max_new_tokens=300,
        )
    except Exception:
        import torch as _torch
        pv = _torch.from_numpy(pixel_values)
        generated = model.generate(pixel_values=pv, max_new_tokens=300)

    # Decode
    if hasattr(generated, 'numpy'):
        generated = generated.numpy()
    text = tokenizer.decode(generated[0], skip_special_tokens=True)

    # Post-process
    text = _postprocess(text)
    return text


def recognize_from_array(image_array: np.ndarray) -> str:
    """Recognize text from a numpy array (HWC uint8 RGB).

    Args:
        image_array: numpy array of the cropped text region.

    Returns:
        Recognized text string.
    """
    image = Image.fromarray(image_array)
    return recognize(image)


def _postprocess(text: str) -> str:
    """Clean up OCR output."""
    # Remove spaces between CJK characters
    text = re.sub(r'(?<=[\u3000-\u9fff\uf900-\ufaff])\s+(?=[\u3000-\u9fff\uf900-\ufaff])', '', text)
    # Remove leading/trailing whitespace
    text = text.strip()
    # Remove repeated characters (e.g., "ああああああ" → "ああ" only if > 5 repeats)
    text = re.sub(r'(.)\1{5,}', r'\1\1\1', text)
    return text


def batch_recognize(images: list[Image.Image]) -> list[str]:
    """Recognize text from multiple cropped regions.

    Args:
        images: List of PIL Images.

    Returns:
        List of recognized text strings.
    """
    results = []
    for img in images:
        try:
            text = recognize(img)
            results.append(text)
        except Exception as e:
            logger.warning("OCR failed for a region: %s", e)
            results.append("")
    return results
