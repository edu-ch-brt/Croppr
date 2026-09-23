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
