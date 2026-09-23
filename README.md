# Croppr

Staff-intranet photo cropper for **ID Card** and **Arbor** downloads. Upload a photo, lock an aspect-ratio crop, preview live, and download a fixed-size JPEG. Open on the intranet — no app login and no background removal (no rembg).

See the [design spec](docs/superpowers/specs/2026-09-23-croppr-design.md).

## Run with Docker Compose

```bash
docker compose up -d --build
```

App listens on [http://127.0.0.1:8000](http://127.0.0.1:8000).

## Reverse proxy (Caddy)

Example site block (see `caddy/Caddyfile.example`):

```caddy
croppr.example.internal {
    reverse_proxy croppr:8000
}
```

Point that hostname at the Compose network service named `croppr` (or proxy to `127.0.0.1:8000` if Caddy runs on the host).

## Accepted formats

JPG/JPEG, PNG, GIF, WebP, HEIC/HEIF (and JXL when the optional plugin is available).

## Output modes

| Mode    | Aspect | Size     | Download name        |
|---------|--------|----------|----------------------|
| ID Card | 3:4    | 300×400  | `{stem}_ID.jpg`      |
| Arbor   | 1:1    | 200×200  | `{stem}_Arbor.jpg`   |

## Limits

- Max upload: **10 MB**
- Min image size: **≥200×200** (width and height)

## Out of scope (v1)

- No app login / SSO
- No rembg / background removal
- No persistent server-side photo library
