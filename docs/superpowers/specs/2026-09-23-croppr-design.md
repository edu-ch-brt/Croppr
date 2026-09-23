# Croppr — Design Spec

**Date:** 2026-09-23  
**Repo:** Croppr  
**Status:** Draft for user review  

## Goal

Staff-intranet web app for cropping a single uploaded photo and downloading a fixed-size JPEG for either **ID Card** or **Arbor**. Hosted as a Docker Compose service on an Ubuntu server behind Caddy. No background removal, no app login, no server-side photo library.

## Decisions locked

| Topic | Choice |
|--------|--------|
| Product name / repo | Croppr |
| Hosting | Docker Compose on Ubuntu; Caddy reverse proxy |
| Auth | Open on the intranet — no app login |
| Background removal | Out of scope (v1) |
| Architecture | FastAPI + browser crop UI; server decode on upload; server emits final JPG on Save; live preview client-side |
| Modes | ID Card (3:4 → 300×400 JPG); Arbor (1:1 → 200×200 JPG) |
| Download names | `{stem}_ID.jpg` / `{stem}_Arbor.jpg` |
| Max upload | 10 MB |
| Min image size | 200×200 px (both width and height) |
| Upscale | Always resample selection to exact output size (up or down), including live preview |
| GIF / animated WebP | First frame only |
| Session | Short-lived; cleared by Start again, new upload, or ~1 hour expiry |

## Architecture

### Compose shape

One service: FastAPI (Uvicorn) serving static UI and JSON/file API. Caddy reverse-proxies HTTPS to the container port. README includes a sample Caddy `reverse_proxy` snippet; it does not rewrite the operator’s full Caddyfile.

No GPU. No rembg. No required persistent volume for v1 (in-memory / temp sessions only).

### Stack

- Python 3.12  
- FastAPI + Uvicorn  
- Pillow + HEIF / JPEG XL decode helpers as needed  
- Vanilla HTML / CSS / JS for the UI (no heavy SPA framework required)

### Package layout (proposed)

```
Croppr/
  README.md
  docker-compose.yml
  Dockerfile
  pyproject.toml / requirements.txt
  app/
    main.py              # FastAPI app, routes
    session_store.py     # short-lived image sessions
    image_io.py          # decode, EXIF orient, validate size
    export.py            # crop + resample + JPEG encode
    static/              # css, crop.js
    templates/           # index.html (or static index)
  docs/superpowers/specs/
  tests/
  caddy/                 # example Caddyfile snippet only
```

### API

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/` | UI |
| `POST` | `/api/upload` | multipart image → session; returns `image_id`, stem, working-image URL, natural width/height |
| `GET` | `/api/image/{image_id}` | browser-friendly working image (PNG or JPEG) |
| `POST` | `/api/save` | JSON: `image_id`, mode (`id` \| `arbor`), crop rect in natural pixels → file download |
| `POST` | `/api/reset` | optional; discard session (Start again can also be client-only until next upload) |

## UI & interaction

Two-column layout, calm styling similar in spirit to the existing LAN ID photo UI.

- **Top / upload:** file picker; accept list covers jpg/jpeg, png, gif, webp, heic/heif, jxl.  
- **Left:** fit-to-pane source image. Under it, radios **ID Card** / **Arbor** (default ID Card).  
- **Selection:** click-drag to draw at locked aspect; drag to move; corner handles resize with locked ratio; clamped to image bounds. Redraw replaces the previous box. Switching mode clears the box but keeps the upload.  
- **Right:** live preview of the selection resampled to output aspect/size. **Save** under the preview — enabled only with a valid selection — triggers download.  
- **Start again:** clears upload, box, preview, and server session so staff can choose a new file.

Staff may switch modes and Save repeatedly on the same upload. Duplicate download filenames are left to the browser / OS.

Coordinates used for Save are **natural image pixels**, not CSS pixels.

## Upload & formats

1. Reject if over 10 MB.  
2. Decode with Pillow (+ HEIF/JXL plugins). Apply EXIF orientation when present.  
3. Reject if width &lt; 200 or height &lt; 200.  
4. Convert to RGB working image; animated GIF/WebP → first frame.  
5. Store in session with original filename **stem** (no extension).  
6. Return a browser-usable representation for the canvas.

Unsupported or corrupt files: clear error, no session.

## Crop & save flow

1. Upload creates `image_id` + stem + decoded RGB.  
2. User selects mode, draws/adjusts box; right pane previews via client canvas (resampled to 300×400 or 200×200 as appropriate).  
3. Save → `POST /api/save` with mode and rectangle. Server validates bounds against the session image, crops, resamples with high-quality filter to exact output size, encodes JPEG (~quality 92), responds with `Content-Disposition: attachment; filename="{stem}_ID.jpg"` or `"{stem}_Arbor.jpg"`.  
4. Session remains until Start again, replacement upload, or expiry (~1 hour) so multiple downloads work.

## Errors, limits & hardening

| Case | Behaviour |
|------|-----------|
| Unsupported / corrupt file | Message; no session |
| Over 10 MB | Reject with size message |
| Under 200×200 | Reject with dimension message |
| Missing / expired `image_id` | 400; UI asks to re-upload |
| Crop outside image / invalid aspect for mode | 400; UI asks to redraw |
| Memory pressure | Cap concurrent sessions; drop oldest |

No app auth. Perimeter trust via intranet / Caddy as the operator configures.

## Testing

- **Unit:** aspect lock and clamp; output sizes; filename stem + `_ID` / `_Arbor`; EXIF orientation; first-frame GIF; reject &lt;200×200 and &gt;10 MB; upscale path when crop smaller than target.  
- **Manual:** `docker compose up` with sample Caddy snippet; exercise each accepted format; both modes; Start again; repeated saves.

## Out of scope (v1)

- rembg / background removal  
- App login / SSO inside Croppr  
- Persisting crops on the server  
- Batch folder processing  
- Animated output  
- Editing a downloaded file in-app  

## Success criteria

1. Staff open Croppr on the intranet with no login.  
2. Upload a supported image (within 10 MB and ≥200×200); see it on the left; draw ID Card or Arbor selection; see live preview on the right.  
3. Save downloads the correctly named, exact-size JPEG; upscaling applies when the selection is smaller than the target.  
4. Start again clears state for a new upload; both modes can be used repeatedly on one upload.  
5. Ships as Docker Compose with a documented Caddy reverse-proxy example.

## Open points for implementation plan (non-blocking)

- Exact HEIF / JXL system packages inside the Dockerfile.  
- Whether Start again calls `/api/reset` or only clears client state until the next upload replaces the session.  
- JPEG quality fine-tune (default 92).  
