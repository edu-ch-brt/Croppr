from app.constants import MODES, MAX_UPLOAD_BYTES, MIN_SIDE, JPEG_QUALITY

def test_id_card_mode():
    m = MODES["id"]
    assert m.aspect == (3, 4)
    assert (m.width, m.height) == (300, 400)
    assert m.suffix == "_ID"

def test_arbor_mode():
    m = MODES["arbor"]
    assert m.aspect == (1, 1)
    assert (m.width, m.height) == (200, 200)
    assert m.suffix == "_Arbor"

def test_limits():
    assert MAX_UPLOAD_BYTES == 10 * 1024 * 1024
    assert MIN_SIDE == 200
    assert JPEG_QUALITY == 92
