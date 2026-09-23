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
