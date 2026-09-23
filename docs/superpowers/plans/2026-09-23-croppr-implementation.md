# Croppr Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Croppr — a FastAPI + browser crop UI that uploads a photo, locks ID Card (3:4 → 300×400) or Arbor (1:1 → 200×200) selection, live-previews the crop, and downloads a correctly named JPEG — as a Docker Compose service for Caddy on Ubuntu.

**Architecture:** One Uvicorn/FastAPI process serves static UI and three API routes. Upload decodes (Pillow + HEIF/JXL plugins) into an in-memory session; the browser draws the box and previews; Save posts natural-pixel coords and the server crops, resamples to exact output size, and returns a JPEG attachment. No rembg, no login, no persistent photo store.

**Tech Stack:** Python 3.12, FastAPI, Uvicorn, Pillow, pillow-heif, pillow-jxl (or equivalent), pytest, Docker Compose, vanilla HTML/CSS/JS.

**Spec:** `docs/superpowers/specs/2026-09-23-croppr-design.md`

## Global Constraints

- Max upload: **10 MB**
- Min image: **200×200** (both width and height)
- Modes: ID Card **3:4 → 300×400 JPG**; Arbor **1:1 → 200×200 JPG**
- Download names: `{stem}_ID.jpg` / `{stem}_Arbor.jpg`
- Always resample crop to exact output size (upscale or downscale), including live preview
- GIF / animated WebP: first frame only
- No app auth; no rembg; no server-side photo library
- Crop coordinates: natural image pixels
- JPEG quality default: **92**
- Session TTL: ~**1 hour**; cap concurrent sessions and drop oldest under pressure

---

## File map

| Path | Responsibility |
|------|----------------|
| `pyproject.toml` | Package metadata, deps, pytest config |
| `requirements.txt` | Pinned runtime deps for Docker |
| `app/__init__.py` | Package marker |
| `app/constants.py` | Limits, mode specs, JPEG quality |
| `app/image_io.py` | Decode bytes → RGB `PIL.Image`; EXIF orient; size checks |
| `app/session_store.py` | In-memory `image_id` → session; TTL; eviction |
| `app/export.py` | Validate rect + mode; crop; resample; JPEG bytes + filename |
| `app/main.py` | FastAPI routes + static mount |
| `app/static/style.css` | Two-column layout |
| `app/static/crop.js` | Upload, radios, draw/move/resize box, preview, save, start again |
| `app/templates/index.html` | Page shell |
| `Dockerfile` | Python 3.12 slim + system libs for HEIF/JXL if needed |
| `docker-compose.yml` | Single `croppr` service |
| `caddy/Caddyfile.example` | Sample `reverse_proxy` |
| `README.md` | Run / deploy / Caddy notes |
| `tests/test_constants_modes.py` | Mode output sizes / aspects |
| `tests/test_image_io.py` | Decode, reject rules, EXIF, first frame |
| `tests/test_session_store.py` | Create / get / reset / expiry / eviction |
| `tests/test_export.py` | Crop, upscale, downscale, filenames |
| `tests/test_api.py` | Upload / save / reset HTTP contract |

---

### Task 1: Project skeleton + mode constants

**Files:**
- Create: `pyproject.toml`
- Create: `requirements.txt`
- Create: `app/__init__.py`
- Create: `app/constants.py`
- Create: `tests/test_constants_modes.py`

**Interfaces:**
- Produces: `MODES: dict[str, ModeSpec]` where `ModeSpec` has `aspect: tuple[int,int]`, `width: int`, `height: int`, `suffix: str`; `MAX_UPLOAD_BYTES = 10 * 1024 * 1024`; `MIN_SIDE = 200`; `JPEG_QUALITY = 92`; `SESSION_TTL_SECONDS = 3600`; `MAX_SESSIONS = 64`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_constants_modes.py
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /workspace/Croppr && python -m pytest tests/test_constants_modes.py -v`  
Expected: FAIL (module not found / MODES missing)

- [ ] **Step 3: Write minimal implementation**

```toml
# pyproject.toml
[project]
name = "croppr"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
  "fastapi>=0.115",
  "uvicorn[standard]>=0.30",
  "python-multipart>=0.0.9",
  "pillow>=10.4",
  "pillow-heif>=0.18",
]

[project.optional-dependencies]
dev = ["pytest>=8.0", "httpx>=0.27"]

[tool.pytest.ini_options]
pythonpath = ["."]
testpaths = ["tests"]
```

```text
# requirements.txt
fastapi>=0.115
uvicorn[standard]>=0.30
python-multipart>=0.0.9
pillow>=10.4
pillow-heif>=0.18
# Optional JPEG XL if wheels available for the base image:
# pillow-jxl-plugin>=1.0
```

```python
# app/__init__.py
```

```python
# app/constants.py
from dataclasses import dataclass

MAX_UPLOAD_BYTES = 10 * 1024 * 1024
MIN_SIDE = 200
JPEG_QUALITY = 92
SESSION_TTL_SECONDS = 3600
MAX_SESSIONS = 64

@dataclass(frozen=True)
class ModeSpec:
    aspect: tuple[int, int]
    width: int
    height: int
    suffix: str  # "_ID" or "_Arbor"

MODES: dict[str, ModeSpec] = {
    "id": ModeSpec(aspect=(3, 4), width=300, height=400, suffix="_ID"),
    "arbor": ModeSpec(aspect=(1, 1), width=200, height=200, suffix="_Arbor"),
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pip install -e '.[dev]' && python -m pytest tests/test_constants_modes.py -v`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add pyproject.toml requirements.txt app/__init__.py app/constants.py tests/test_constants_modes.py
git commit -m "feat: add Croppr package skeleton and mode constants"
```

---

### Task 2: Image decode + validation (`image_io`)

**Files:**
- Create: `app/image_io.py`
- Create: `tests/test_image_io.py`
- Create: `tests/fixtures/` (generate tiny PNGs in the test module via Pillow; no binary fixtures required)

**Interfaces:**
- Consumes: `MAX_UPLOAD_BYTES`, `MIN_SIDE` from `app.constants`
- Produces:
  - `class ImageValidationError(ValueError)`
  - `def load_rgb_image(data: bytes, filename: str | None = None) -> Image.Image` — RGB, EXIF-oriented, first frame; raises `ImageValidationError`
  - `def stem_from_filename(filename: str) -> str` — path stem, fallback `"image"`

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_image_io.py
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_image_io.py -v`  
Expected: FAIL (import error)

- [ ] **Step 3: Write minimal implementation**

```python
# app/image_io.py
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_image_io.py -v`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/image_io.py tests/test_image_io.py
git commit -m "feat: decode and validate uploads (size, min dimensions, EXIF)"
```

---

### Task 3: Session store

**Files:**
- Create: `app/session_store.py`
- Create: `tests/test_session_store.py`

**Interfaces:**
- Consumes: `SESSION_TTL_SECONDS`, `MAX_SESSIONS` from `app.constants`
- Produces:
  - `@dataclass Session: image_id: str; stem: str; image: Image.Image; created_at: float`
  - `class SessionStore` with `create(stem, image) -> Session`, `get(image_id) -> Session | None`, `delete(image_id) -> None`, `purge_expired() -> int`

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_session_store.py
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_session_store.py -v`  
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

```python
# app/session_store.py
from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field

from PIL import Image

from app import constants


@dataclass
class Session:
    image_id: str
    stem: str
    image: Image.Image
    created_at: float = field(default_factory=time.time)


class SessionStore:
    def __init__(self) -> None:
        self._sessions: dict[str, Session] = {}

    def create(self, stem: str, image: Image.Image) -> Session:
        self.purge_expired()
        while len(self._sessions) >= constants.MAX_SESSIONS:
            oldest_id = min(self._sessions.values(), key=lambda s: s.created_at).image_id
            self._sessions.pop(oldest_id, None)
        session = Session(image_id=uuid.uuid4().hex, stem=stem, image=image.copy())
        self._sessions[session.image_id] = session
        return session

    def get(self, image_id: str) -> Session | None:
        self.purge_expired()
        return self._sessions.get(image_id)

    def delete(self, image_id: str) -> None:
        self._sessions.pop(image_id, None)

    def purge_expired(self) -> int:
        now = time.time()
        dead = [
            sid
            for sid, s in self._sessions.items()
            if now - s.created_at > constants.SESSION_TTL_SECONDS
        ]
        for sid in dead:
            self._sessions.pop(sid, None)
        return len(dead)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_session_store.py -v`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/session_store.py tests/test_session_store.py
git commit -m "feat: add in-memory image session store with TTL and eviction"
```

---

### Task 4: Export (crop + resample + JPEG name)

**Files:**
- Create: `app/export.py`
- Create: `tests/test_export.py`

**Interfaces:**
- Consumes: `MODES`, `JPEG_QUALITY` from `app.constants`
- Produces:
  - `class ExportError(ValueError)`
  - `def export_jpeg(image, mode: str, left: int, top: int, right: int, bottom: int, stem: str) -> tuple[bytes, str]`  
    Returns `(jpeg_bytes, filename)` where filename is `{stem}_ID.jpg` or `{stem}_Arbor.jpg`.  
    Validates mode, rectangle inside image, aspect matches mode within 1 px tolerance; resamples with `Image.Resampling.LANCZOS`.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_export.py
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_export.py -v`  
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

```python
# app/export.py
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_export.py -v`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/export.py tests/test_export.py
git commit -m "feat: export cropped JPEG at fixed size with ID/Arbor filenames"
```

---

### Task 5: FastAPI routes

**Files:**
- Create: `app/main.py`
- Create: `tests/test_api.py`

**Interfaces:**
- Consumes: `load_rgb_image`, `stem_from_filename`, `SessionStore`, `export_jpeg`, `MODES`
- Produces HTTP API:
  - `POST /api/upload` multipart `file` → `{image_id, stem, width, height, image_url}`
  - `GET /api/image/{image_id}` → PNG bytes
  - `POST /api/save` JSON `{image_id, mode, left, top, right, bottom}` → JPEG file download
  - `POST /api/reset` JSON `{image_id}` → `{ok: true}`
  - `GET /` → HTML (stub ok until Task 6)

- [ ] **Step 1: Write the failing API tests**

```python
# tests/test_api.py
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_api.py -v`  
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

```python
# app/main.py
from __future__ import annotations

import io
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import HTMLResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from app.export import ExportError, export_jpeg
from app.image_io import ImageValidationError, load_rgb_image, stem_from_filename
from app.session_store import SessionStore

app = FastAPI(title="Croppr")
store = SessionStore()

STATIC = Path(__file__).parent / "static"
TEMPLATES_DIR = Path(__file__).parent / "templates"
TEMPLATES_DIR.mkdir(parents=True, exist_ok=True)
STATIC.mkdir(parents=True, exist_ok=True)
app.mount("/static", StaticFiles(directory=str(STATIC)), name="static")


class SaveBody(BaseModel):
    image_id: str
    mode: str
    left: int
    top: int
    right: int
    bottom: int


class ResetBody(BaseModel):
    image_id: str = Field(min_length=1)


@app.get("/", response_class=HTMLResponse)
def index():
    index_path = TEMPLATES_DIR / "index.html"
    if index_path.exists():
        return HTMLResponse(index_path.read_text(encoding="utf-8"))
    return HTMLResponse("<!doctype html><title>Croppr</title><h1>Croppr</h1>")


@app.post("/api/upload")
async def upload(file: UploadFile = File(...)):
    data = await file.read()
    try:
        image = load_rgb_image(data, file.filename)
    except ImageValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    stem = stem_from_filename(file.filename or "image")
    session = store.create(stem, image)
    w, h = session.image.size
    return {
        "image_id": session.image_id,
        "stem": session.stem,
        "width": w,
        "height": h,
        "image_url": f"/api/image/{session.image_id}",
    }


@app.get("/api/image/{image_id}")
def get_image(image_id: str):
    session = store.get(image_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Image session expired or missing.")
    buf = io.BytesIO()
    session.image.save(buf, format="PNG")
    buf.seek(0)
    return StreamingResponse(buf, media_type="image/png")


@app.post("/api/save")
def save(body: SaveBody):
    session = store.get(body.image_id)
    if session is None:
        raise HTTPException(status_code=400, detail="Image session expired or missing.")
    try:
        data, filename = export_jpeg(
            session.image,
            body.mode,
            body.left,
            body.top,
            body.right,
            body.bottom,
            session.stem,
        )
    except ExportError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return Response(
        content=data,
        media_type="image/jpeg",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.post("/api/reset")
def reset(body: ResetBody):
    store.delete(body.image_id)
    return {"ok": True}
```

Note: serve `index.html` as static HTML (no Jinja required).

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_api.py tests/ -v`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/main.py tests/test_api.py pyproject.toml requirements.txt
git commit -m "feat: add FastAPI upload, image, save, and reset routes"
```

---

### Task 6: Browser UI (layout, crop box, preview, save, start again)

**Files:**
- Create: `app/templates/index.html`
- Create: `app/static/style.css`
- Create: `app/static/crop.js`
- Modify: `app/main.py` only if needed to serve the template cleanly

**Interfaces:**
- Consumes: `/api/upload`, `/api/image/{id}`, `/api/save`, `/api/reset`
- Produces: working staff UI matching the locked UX

**Behaviour checklist (manual):**
- Two columns: left source + radios; right live preview + Save
- Radios: ID Card (default) / Arbor; switching clears the box, keeps upload
- Draw / move / resize with locked aspect; clamp to image; natural-pixel coords on Save
- Preview canvas always 300×400 or 200×200 (upscaling when box is smaller)
- Save downloads via blob + `<a download>` using `Content-Disposition` filename when available
- Start again clears UI and calls `/api/reset` when `image_id` exists
- Save disabled until a valid box exists

- [ ] **Step 1: Add HTML shell**

`index.html` structure:
- header “Croppr”
- upload row: `<input type="file" accept=".jpg,.jpeg,.png,.gif,.webp,.heic,.heif,.jxl,image/*">`
- button Start again
- left: `<canvas id="source">` + radios `name="mode"` values `id` / `arbor`
- right: `<canvas id="preview">` + `#save-btn`
- `#status` / `#error` regions

- [ ] **Step 2: Add CSS**

Two-column flex/grid, card panels, muted status text, primary Save button. Keep calm / LAN-tool spirit; no dark-theme requirement unless it stays readable.

- [ ] **Step 3: Implement `crop.js`**

Core state: `{ imageId, stem, naturalW, naturalH, mode, box: {x,y,w,h}|null, img: HTMLImageElement|null }`.

Key functions (implement fully — no stubs):
- `setMode(mode)` — clear box; resize preview canvas to mode output size; redraw
- `onFileSelected` — `FormData` POST `/api/upload`; set state; load `image_url` into `Image`; draw source fit-to-pane with letterboxing; map pointer ↔ natural pixels
- pointer handlers for create / move / corner-resize with aspect lock from `MODES` (hardcode `{id:[3,4], arbor:[1,1]}` in JS)
- `updatePreview()` — draw cropped region scaled to preview canvas with `drawImage`
- `save()` — POST `/api/save` JSON; blob download
- `startAgain()` — reset POST + clear canvases / disable Save

- [ ] **Step 4: Manual browser check**

Run: `uvicorn app.main:app --reload --port 8080`  
Open `http://127.0.0.1:8080/`. Upload a ≥200×200 PNG; draw ID Card; confirm preview; Save → `*_ID.jpg` at 300×400; switch to Arbor; redraw; Save → `*_Arbor.jpg`; Start again clears.

- [ ] **Step 5: Commit**

```bash
git add app/templates/index.html app/static/style.css app/static/crop.js app/main.py
git commit -m "feat: add Croppr crop UI with live preview and downloads"
```

---

### Task 7: Docker Compose + Caddy example + README

**Files:**
- Create: `Dockerfile`
- Create: `docker-compose.yml`
- Create: `caddy/Caddyfile.example`
- Modify: `README.md`

- [ ] **Step 1: Dockerfile**

```dockerfile
FROM python:3.12-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    libheif1 \
    && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

- [ ] **Step 2: docker-compose.yml**

```yaml
services:
  croppr:
    build: .
    ports:
      - "8000:8000"
    restart: unless-stopped
```

- [ ] **Step 3: Caddy example**

```caddy
# caddy/Caddyfile.example
croppr.example.internal {
    reverse_proxy croppr:8000
}
```

- [ ] **Step 4: README**

Document: what Croppr is; `docker compose up -d --build`; Caddy snippet; accepted formats; ID/Arbor sizes and filenames; limits (10 MB, ≥200×200); no login / no rembg.

- [ ] **Step 5: Smoke Docker**

Run: `docker compose up -d --build` then `curl -F file=@/path/to/sample.png http://127.0.0.1:8000/api/upload`  
Expected: JSON with `image_id`

- [ ] **Step 6: Commit**

```bash
git add Dockerfile docker-compose.yml caddy/Caddyfile.example README.md
git commit -m "chore: add Docker Compose deploy and Caddy example"
```

---

### Task 8: Final verification

- [ ] **Step 1: Run full unit suite**

Run: `python -m pytest -v`  
Expected: all PASS

- [ ] **Step 2: Spec coverage sweep**

Confirm against `docs/superpowers/specs/2026-09-23-croppr-design.md`: modes/sizes, filenames, 10 MB, 200×200, upscale path, Start again, dual-mode repeat saves, Docker+Caddy, no auth/rembg.

- [ ] **Step 3: Optional HEIC smoke** (if sample available)

Upload a `.heic`; expect success or a clear unsupported message if the base image lacks codecs — document result in README if JXL/HEIC needs extra packages.

- [ ] **Step 4: Commit any doc fixes**

```bash
git add -A && git status
# commit only if there are real fixes
```

---

## Plan self-review

**Spec coverage:** Upload/formats, crop UI, save naming/sizes, session/reset, Docker/Caddy, limits, testing — each maps to Tasks 2–8.  
**Placeholders:** None intentional; Task 6 describes required JS behaviour in full checklist form (implementers write the event-handler code in-repo).  
**Type consistency:** `mode` keys `id` / `arbor`; session field `image_id`; export signature shared by API tests.

