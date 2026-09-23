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
