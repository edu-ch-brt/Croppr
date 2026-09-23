from __future__ import annotations

import io

from PIL import Image

from app.constants import JPEG_QUALITY, MODES


class ExportError(ValueError):
    pass


def export_jpeg(
    image: Image.Image,
    mode: str,
    left: int,
    top: int,
    right: int,
    bottom: int,
    stem: str,
) -> tuple[bytes, str]:
    spec = MODES.get(mode)
    if spec is None:
        raise ExportError("Unknown mode.")
    w, h = image.size
    if left < 0 or top < 0 or right > w or bottom > h or right <= left or bottom <= top:
        raise ExportError("Crop rectangle is outside the image.")
    cw, ch = right - left, bottom - top
    aw, ah = spec.aspect
    # allow 1px tolerance after integer math
    if abs(cw * ah - ch * aw) > max(aw, ah):
        raise ExportError("Crop aspect does not match the selected mode.")
    cropped = image.crop((left, top, right, bottom))
    out = cropped.resize((spec.width, spec.height), Image.Resampling.LANCZOS)
    buf = io.BytesIO()
    out.save(buf, format="JPEG", quality=JPEG_QUALITY, optimize=True)
    filename = f"{stem}{spec.suffix}.jpg"
    return buf.getvalue(), filename
