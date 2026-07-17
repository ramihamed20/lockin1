from datetime import datetime

from django.utils import timezone

from apps.accounts.models import User
from apps.education.policies import can_create_content, is_administrator
from apps.files.models import ManagedFile

from .models import LearningObject, LearningObjectAsset, LearningObjectVersion


def is_version_available(version: LearningObjectVersion, *, at: datetime | None = None) -> bool:
    now = at or timezone.now()
    if version.available_from is not None and version.available_from > now:
        return False
    return version.available_until is None or version.available_until > now


def can_view_learning_object(*, user: User, learning_object: LearningObject) -> bool:
    version = learning_object.published_version
    return bool(
        user.is_authenticated
        and learning_object.archived_at is None
        and version is not None
        and version.academic_node.is_discoverable
        and is_version_available(version)
    )


def can_edit_learning_object(*, user: User, learning_object: LearningObject) -> bool:
    version = learning_object.current_version
    if version is None:
        return False
    return is_administrator(user) or (
        learning_object.owner_id == user.id
        and can_create_content(user=user, node=version.academic_node)
    )


def can_access_managed_file(*, user: User, managed_file: ManagedFile, download: bool) -> bool:
    if is_administrator(user) or managed_file.owner_id == user.id:
        return True
    assets = LearningObjectAsset.objects.filter(
        managed_file=managed_file,
        version__published_for__archived_at__isnull=True,
        version__academic_node__is_discoverable=True,
    ).select_related("version")
    for asset in assets:
        version = asset.version
        if is_version_available(version) and (not download or version.allow_download):
            return True
    return False
