"""Comic Text Detector (CTD) ONNX wrapper.

Detects text regions in manga/comic pages using the CTD ONNX model.
Uses cv2.dnn for inference — no PyTorch dependency.

Model: comictextdetector.pt.onnx (~90MB)
Path:  %APPDATA%/게임번역기/models/comic-text-detector/comictextdetector.pt.onnx
"""

import logging
import os
import threading
from dataclasses import dataclass, field

import cv2
import numpy as np

logger = logging.getLogger(__name__)

_APPDATA = os.environ.get("APPDATA") or os.path.join(os.path.expanduser("~"), ".local", "share")
MODEL_DIR = os.path.join(_APPDATA, "게임번역기", "models", "comic-text-detector")
ONNX_PATH = os.path.join(MODEL_DIR, "comictextdetector.pt.onnx")

_net = None
_net_lock = threading.Lock()

INPUT_SIZE = 1024
CONF_THRESHOLD = 0.35
NMS_THRESHOLD = 0.5


@dataclass
class TextRegion:
    """Detected text region."""
    bbox: tuple[int, int, int, int]  # x1, y1, x2, y2 (pixels)
    polygon: list[list[float]] = field(default_factory=list)  # 4-point coords (pixels)
    direction: str = "horizontal"  # "vertical" | "horizontal"
    confidence: float = 0.0
    mask: np.ndarray | None = None  # segmentation mask for inpainting


def is_available() -> bool:
    """Check if CTD ONNX model file exists."""
    return os.path.isfile(ONNX_PATH)


def _load_net():
    """Load OpenCV DNN network (lazy, thread-safe)."""
    global _net
    with _net_lock:
        if _net is not None:
            return _net
        if not is_available():
            raise RuntimeError("CTD model not installed. Download it from Settings > Models.")
        try:
            _net = cv2.dnn.readNetFromONNX(ONNX_PATH)
            logger.info("CTD ONNX model loaded via cv2.dnn")
            return _net
        except Exception as e:
            logger.error("Failed to load CTD model: %s", e)
            raise


def unload_model():
    """Unload the model to free memory."""
    global _net
    with _net_lock:
        _net = None
    logger.info("CTD model unloaded")


def detect(image_path: str) -> list[TextRegion]:
    """Detect text regions in a manga page image.

    Args:
        image_path: Path to the image file.

    Returns:
        List of TextRegion with pixel coordinates.
    """
    net = _load_net()

    # Read image
    img = cv2.imread(image_path)
    if img is None:
        raise ValueError(f"Cannot read image: {image_path}")

    orig_h, orig_w = img.shape[:2]

    # Preprocess: resize to INPUT_SIZE x INPUT_SIZE
    blob = cv2.dnn.blobFromImage(
        img,
        scalefactor=1.0 / 255.0,
        size=(INPUT_SIZE, INPUT_SIZE),
        swapRB=True,
        crop=False,
    )

    # Run inference
    with _net_lock:
        net.setInput(blob)
        out_names = net.getUnconnectedOutLayersNames()
        outputs = net.forward(out_names)

    # Parse detections
    regions = _parse_detections(outputs, orig_w, orig_h)
    return regions


def _parse_detections(
    outputs: list[np.ndarray],
    orig_w: int,
    orig_h: int,
) -> list[TextRegion]:
    """Parse CTD ONNX output into TextRegion list.

    CTD outputs vary by model version. Common formats:
    - Single output: (1, N, 9) where cols = [cx, cy, w, h, conf, seg_mask_idx, ...]
    - YOLO-like: (1, N, 5+cls)

    We handle the most common CTD output format.
    """
    regions = []

    # Get the detection output (usually the first/main output)
    det = outputs[0]

    # Handle different output shapes (flatten batch dims)
    while det.ndim > 2:
        det = det[0]
    if det.ndim == 2 and det.shape[0] < det.shape[1]:
        det = det.T

    if det.shape[0] == 0:
        return []

    # Scale factors
    sx = orig_w / INPUT_SIZE
    sy = orig_h / INPUT_SIZE

    boxes = []
    confidences = []
    raw_boxes = []

    for row in det:
        if len(row) < 5:
            continue

        # Try YOLO format: cx, cy, w, h, conf, [class_scores...]
        cx, cy, w, h = row[0], row[1], row[2], row[3]

        # Confidence: either direct or obj_conf * class_conf
        if len(row) >= 6:
            obj_conf = row[4]
            cls_conf = row[5:].max() if len(row) > 5 else 1.0
            conf = float(obj_conf * cls_conf)
        else:
            conf = float(row[4])

        if conf < CONF_THRESHOLD:
            continue

        # Convert center format to corner format
        x1 = (cx - w / 2) * sx
        y1 = (cy - h / 2) * sy
        x2 = (cx + w / 2) * sx
        y2 = (cy + h / 2) * sy

        # Clamp to image bounds
        x1 = max(0, min(x1, orig_w))
        y1 = max(0, min(y1, orig_h))
        x2 = max(0, min(x2, orig_w))
        y2 = max(0, min(y2, orig_h))

        bw = x2 - x1
        bh = y2 - y1
        if bw < 5 or bh < 5:
            continue

        boxes.append([int(x1), int(y1), int(bw), int(bh)])
        confidences.append(conf)
        raw_boxes.append((x1, y1, x2, y2))

    if not boxes:
        return []

    # Non-Maximum Suppression
    indices = cv2.dnn.NMSBoxes(boxes, confidences, CONF_THRESHOLD, NMS_THRESHOLD)
    if len(indices) == 0:
        return []

    # Flatten indices (OpenCV returns different shapes across versions)
    if isinstance(indices, np.ndarray):
        indices = indices.flatten().tolist()
    elif isinstance(indices, (list, tuple)) and len(indices) > 0:
        if isinstance(indices[0], (list, tuple, np.ndarray)):
            indices = [i[0] if hasattr(i, '__len__') else i for i in indices]

    # Get segmentation mask if available (second output)
    seg_mask = outputs[1] if len(outputs) > 1 else None

    for idx in indices:
        x1, y1, x2, y2 = raw_boxes[idx]
        conf = confidences[idx]
        bw = x2 - x1
        bh = y2 - y1

        # Direction: vertical if height > width * 1.5
        direction = "vertical" if bh > bw * 1.5 else "horizontal"

        # Build polygon (4-point rectangle)
        polygon = [
            [float(x1), float(y1)],
            [float(x2), float(y1)],
            [float(x2), float(y2)],
            [float(x1), float(y2)],
        ]

        # Extract mask for this region if available
        region_mask = None
        if seg_mask is not None:
            region_mask = _extract_region_mask(seg_mask, x1, y1, x2, y2, orig_w, orig_h)

        regions.append(TextRegion(
            bbox=(int(x1), int(y1), int(x2), int(y2)),
            polygon=polygon,
            direction=direction,
            confidence=conf,
            mask=region_mask,
        ))

    # Sort by position: top-to-bottom, right-to-left (manga reading order)
    regions.sort(key=lambda r: (r.bbox[1] // 100, -r.bbox[0]))

    return regions


def _extract_region_mask(
    seg_output: np.ndarray,
    x1: float, y1: float, x2: float, y2: float,
    orig_w: int, orig_h: int,
) -> np.ndarray | None:
    """Extract and resize segmentation mask for a detected region."""
    try:
        mask = seg_output
        if mask.ndim == 4:
            mask = mask[0, 0]  # (1, 1, H, W) → (H, W)
        elif mask.ndim == 3:
            mask = mask[0]  # (1, H, W) → (H, W)

        mask_h, mask_w = mask.shape[:2]
        sx = mask_w / orig_w
        sy = mask_h / orig_h

        # Crop mask to region
        mx1 = max(0, int(x1 * sx))
        my1 = max(0, int(y1 * sy))
        mx2 = min(mask_w, int(x2 * sx))
        my2 = min(mask_h, int(y2 * sy))

        region = mask[my1:my2, mx1:mx2]
        if region.size == 0:
            return None

        # Binarize and scale to uint8
        region = (region > 0.5).astype(np.uint8) * 255

        # Resize to original region size
        rw = int(x2 - x1)
        rh = int(y2 - y1)
        if rw > 0 and rh > 0:
            region = cv2.resize(region, (rw, rh), interpolation=cv2.INTER_NEAREST)

        return region
    except Exception:
        return None


def detect_to_ratios(image_path: str) -> list[dict]:
    """Detect text and return results as 0-1 ratio coordinates.

    Returns list compatible with Gemini output format:
    [{"x": 0.1, "y": 0.2, "width": 0.15, "height": 0.08,
      "direction": "vertical", "polygon": [[x1,y1], ...], "confidence": 0.9}]
    """
    img = cv2.imread(image_path)
    if img is None:
        raise ValueError(f"Cannot read image: {image_path}")

    orig_h, orig_w = img.shape[:2]
    regions = detect(image_path)

    results = []
    for r in regions:
        x1, y1, x2, y2 = r.bbox
        results.append({
            "x": x1 / orig_w,
            "y": y1 / orig_h,
            "width": (x2 - x1) / orig_w,
            "height": (y2 - y1) / orig_h,
            "direction": r.direction,
            "polygon": [[p[0] / orig_w, p[1] / orig_h] for p in r.polygon],
            "confidence": r.confidence,
            "bbox_px": r.bbox,
        })

    return results
