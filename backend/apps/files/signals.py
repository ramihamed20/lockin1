from typing import Any

from platform_core import object_cache


def forget_cached_copy(sender: Any, instance: Any, **kwargs: Any) -> None:
    """A deleted file's bytes leave the shared delivery cache with it."""

    object_cache.forget(instance.blob.name or "")
