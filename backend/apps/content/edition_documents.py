"""Which file one edition's reader opens, for a study PDF or its summary.

Both the Catalog resolver a student's reader calls and the Focus endpoints that
store their marks have to agree on this exactly: if they disagree, a reader
annotates one file and the server files those marks under another.
"""

from __future__ import annotations

from apps.files.models import ManagedFile

from .editions import (
    STUDY,
    SUMMARY,
    UNIVERSITY,
    normalize_edition,
    normalize_view,
    primary_role,
    summary_role,
)
from .models import LearningObjectAsset, LearningObjectVersion


def _ready_asset(*, version: LearningObjectVersion, role: str) -> LearningObjectAsset | None:
    return (
        LearningObjectAsset.objects.filter(
            version=version,
            role=role,
            managed_file__validation_status=ManagedFile.ValidationStatus.READY,
        )
        .select_related("managed_file")
        .order_by("position", "id")
        .first()
    )


def edition_asset(
    *, version: LearningObjectVersion, edition: str, view: str = STUDY
) -> tuple[LearningObjectAsset | None, str]:
    """Return the asset to open, and the edition that owns it.

    The owning edition matters only where it can differ from the requested one:
    a Lock-in edition with no summary of its own shows the sheet's summary, and
    marks on that file belong with that one file rather than being split into a
    second collection over the same pages.
    """

    edition = normalize_edition(edition)
    view = normalize_view(view)
    if view != SUMMARY:
        return _ready_asset(version=version, role=primary_role(edition)), edition
    asset = _ready_asset(version=version, role=summary_role(edition))
    if asset is not None or edition == UNIVERSITY:
        return asset, edition
    return _ready_asset(version=version, role=summary_role(UNIVERSITY)), UNIVERSITY


def edition_page_count(
    *, version: LearningObjectVersion, asset: LearningObjectAsset, edition: str, view: str
) -> int | None:
    """The page count of the file actually being opened."""

    if normalize_view(view) == STUDY and normalize_edition(edition) == UNIVERSITY:
        return version.page_count
    return asset.managed_file.pdf_page_count
