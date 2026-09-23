import io
import pytest
from PIL import Image
from app.export import export_jpeg, ExportError

def test_id_card_downscale_and_name():
    img = Image.new("RGB", (600, 800), (40, 50, 60))
    data, name = export_jpeg(img, "id", 0, 0, 600, 800, "34576")
    assert name == "34576_ID.jpg"
    out = Image.open(io.BytesIO(data))
    assert out.size == (300, 400)
    assert out.format == "JPEG"

def test_arbor_upscale_and_name():
    img = Image.new("RGB", (200, 200), (1, 2, 3))
    data, name = export_jpeg(img, "arbor", 0, 0, 100, 100, "34576")
    assert name == "34576_Arbor.jpg"
    out = Image.open(io.BytesIO(data))
    assert out.size == (200, 200)

def test_rejects_out_of_bounds():
    img = Image.new("RGB", (200, 200))
    with pytest.raises(ExportError):
        export_jpeg(img, "arbor", -1, 0, 200, 200, "x")

def test_rejects_bad_mode():
    img = Image.new("RGB", (200, 200))
    with pytest.raises(ExportError):
        export_jpeg(img, "nope", 0, 0, 200, 200, "x")
