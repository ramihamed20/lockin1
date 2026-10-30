from typing import Any

from django.conf import settings
from rest_framework.exceptions import PermissionDenied

from apps.accounts.models import User
from apps.content.models import CatalogDocument

from .domain_types import FocusDocumentReference


def launch_available(user: User) -> bool:
    return bool(getattr(settings, "LOCKIN_MODE_ENABLED", False)) or str(user.id) in getattr(
        settings, "LOCKIN_MODE_PILOT_USER_IDS", ()
    )


def require_launch(user: User) -> None:
    if not launch_available(user):
        raise PermissionDenied("Lockin Mode is not available yet.")


def study_target(
    document: FocusDocumentReference | None, data: dict[str, Any]
) -> dict[str, object]:
    if document is None:
        return {}
    start, end = data["page_start"], data.get("page_end")
    if end is not None and (end < start or not document.page_count or end > document.page_count):
        raise ValueError("Choose pages within this sheet.")
    if start != 1 and (not document.page_count or start > document.page_count):
        raise ValueError("Choose pages within this sheet.")
    alias = CatalogDocument.objects.filter(
        version_id=document.document_version_id,
        managed_file_id=document.file_id,
        edition=data["edition"],
        is_active=True,
    ).first()
    return {
        "edition": data["edition"],
        "page_start": start,
        "page_end": end,
        "title": document.title,
        "reader_path": (
            f"/materials/catalog/{alias.material_slug}/sheets/{alias.sheet_slug}/workspace"
            if alias
            else None
        ),
    }
