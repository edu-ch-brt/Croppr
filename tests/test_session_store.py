import time
from PIL import Image
from app.session_store import SessionStore
from app import constants

def test_create_and_get(monkeypatch):
    store = SessionStore()
    img = Image.new("RGB", (200, 200), (1, 2, 3))
    s = store.create("34576", img)
    got = store.get(s.image_id)
    assert got is not None
    assert got.stem == "34576"
    assert got.image.size == (200, 200)

def test_delete():
    store = SessionStore()
    s = store.create("x", Image.new("RGB", (200, 200)))
    store.delete(s.image_id)
    assert store.get(s.image_id) is None

def test_expiry(monkeypatch):
    store = SessionStore()
    s = store.create("x", Image.new("RGB", (200, 200)))
    monkeypatch.setattr(constants, "SESSION_TTL_SECONDS", 0)
    # force created_at into the past
    store._sessions[s.image_id].created_at = time.time() - 10
    assert store.get(s.image_id) is None

def test_evict_oldest_when_full(monkeypatch):
    monkeypatch.setattr(constants, "MAX_SESSIONS", 2)
    store = SessionStore()
    a = store.create("a", Image.new("RGB", (200, 200)))
    time.sleep(0.01)
    b = store.create("b", Image.new("RGB", (200, 200)))
    time.sleep(0.01)
    store.create("c", Image.new("RGB", (200, 200)))
    assert store.get(a.image_id) is None
    assert store.get(b.image_id) is not None
