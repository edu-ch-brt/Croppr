import io
import pytest
from PIL import Image
from app.image_io import load_rgb_image, stem_from_filename, ImageValidationError
from app.constants import MAX_UPLOAD_BYTES

def _png_bytes(w: int, h: int, color=(10, 20, 30)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (w, h), color).save(buf, format="PNG")
    return buf.getvalue()

def test_stem_from_filename():
    assert stem_from_filename("34576.png") == "34576"
    assert stem_from_filename("/tmp/foo.bar.JPEG") == "foo.bar"
    assert stem_from_filename("") == "image"

def test_load_accepts_png_200():
    img = load_rgb_image(_png_bytes(200, 200))
    assert img.size == (200, 200)
    assert img.mode == "RGB"

def test_reject_under_200():
    with pytest.raises(ImageValidationError, match="200"):
        load_rgb_image(_png_bytes(199, 200))

def test_reject_over_max_bytes():
    data = b"x" * (MAX_UPLOAD_BYTES + 1)
    with pytest.raises(ImageValidationError, match="10"):
        load_rgb_image(data)

def test_reject_corrupt():
    with pytest.raises(ImageValidationError):
        load_rgb_image(b"not-an-image")
