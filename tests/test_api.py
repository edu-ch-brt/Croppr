import io
from PIL import Image
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def _png(w=400, h=400) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (w, h), (9, 9, 9)).save(buf, format="PNG")
    return buf.getvalue()

def test_upload_save_id_card():
    r = client.post(
        "/api/upload",
        files={"file": ("34576.png", _png(600, 800), "image/png")},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["stem"] == "34576"
    assert body["width"] == 600
    image_id = body["image_id"]

    save = client.post(
        "/api/save",
        json={
            "image_id": image_id,
            "mode": "id",
            "left": 0,
            "top": 0,
            "right": 600,
            "bottom": 800,
        },
    )
    assert save.status_code == 200
    assert save.headers["content-type"].startswith("image/jpeg")
    assert "34576_ID.jpg" in save.headers.get("content-disposition", "")
    out = Image.open(io.BytesIO(save.content))
    assert out.size == (300, 400)

def test_upload_rejects_tiny():
    r = client.post(
        "/api/upload",
        files={"file": ("t.png", _png(100, 100), "image/png")},
    )
    assert r.status_code == 400

def test_reset():
    r = client.post(
        "/api/upload",
        files={"file": ("a.png", _png(), "image/png")},
    )
    image_id = r.json()["image_id"]
    assert client.post("/api/reset", json={"image_id": image_id}).status_code == 200
    assert client.get(f"/api/image/{image_id}").status_code == 404
