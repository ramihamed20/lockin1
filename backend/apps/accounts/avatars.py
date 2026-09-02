import hashlib
from typing import TypedDict

from .models import User


class AvatarPayload(TypedDict):
    source: str
    default_id: str
    url: str | None


DEFAULT_AVATAR_IDS = tuple(User.AvatarDefault.values)


def fallback_avatar_id(user: User) -> str:
    """Return a stable supplied avatar for accounts without an explicit choice."""
    digest = hashlib.sha256(str(user.id).encode("utf-8")).digest()
    return DEFAULT_AVATAR_IDS[digest[0] % len(DEFAULT_AVATAR_IDS)]


def avatar_payload(user: User) -> AvatarPayload:
    default_id = user.avatar_default or fallback_avatar_id(user)
    if user.profile_image_id:
        return {
            "source": "custom",
            "default_id": default_id,
            "url": f"/api/v1/files/{user.profile_image_id}/view",
        }
    return {"source": "default", "default_id": default_id, "url": None}
