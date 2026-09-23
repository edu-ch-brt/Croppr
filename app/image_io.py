from __future__ import annotations

import io
from pathlib import PurePosixPath

from PIL import Image, ImageOps

from app.constants import MAX_UPLOAD_BYTES, MIN_SIDE

try:
    from pillow_heif import register_heif_opener
    register_heif_opener()
except Exception:
    pass

class ImageValidationError(ValueError):
    pass

def stem_from_filename(filename: str) -> str:
    if not filename or not str(filename).strip():
        return "image"
    stem = PurePosixPath(filename.replace("\\", "/")).stem
    return stem or "image"

def load_rgb_image(data: bytes, filename: str | None = None) -> Image.Image:
    if len(data) > MAX_UPLOAD_BYTES:
        raise ImageValidationError("File exceeds the 10 MB upload limit.")
    if not data:
        raise ImageValidationError("Empty file.")
    try:
        img = Image.open(io.BytesIO(data))
        img.load()
    except Exception as exc:
        raise ImageValidationError("Unsupported or corrupt image.") from exc
    img = ImageOps.exif_transpose(img) or img
    if getattr(img, "n_frames", 1) > 1:
        img.seek(0)
    if img.mode != "RGB":
        img = img.convert("RGB")
    w, h = img.size
    if w < MIN_SIDE or h < MIN_SIDE:
        raise ImageValidationError(
            f"Image must be at least {MIN_SIDE}×{MIN_SIDE} pixels."
        )
    return img
