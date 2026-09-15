"""The two editions every managed sheet can carry.

A sheet is one body of study material with one question bank.  An *edition* is
one PDF rendering of it: the university's own sheet, and the Lock-in sheet
authored in-house.  Both editions are identical in capability -- reader, Sheet
Summary, Active Study, parts, difficulties, final exam and progress -- so
nothing here describes behaviour.  It only names the storage slots the shared
logic reads through, which is what keeps a second edition from becoming a
second copy of the code.
"""

from __future__ import annotations

import uuid

UNIVERSITY = "university"
LOCKIN = "lockin"

EDITIONS: tuple[str, ...] = (UNIVERSITY, LOCKIN)

EDITION_LABELS: dict[str, str] = {
    UNIVERSITY: "University Sheet",
    LOCKIN: "Lockin Sheet",
}

# Asset roles are per edition so a version carries both PDFs, and every
# publication, access and delivery rule already written for the university file
# applies to the Lock-in file unchanged.
PRIMARY_ROLE_BY_EDITION: dict[str, str] = {
    UNIVERSITY: "primary",
    LOCKIN: "lockin_primary",
}

SUMMARY_ROLE_BY_EDITION: dict[str, str] = {
    UNIVERSITY: "summary",
    LOCKIN: "lockin_summary",
}


class UnknownEditionError(ValueError):
    pass


def normalize_edition(value: object, *, default: str = UNIVERSITY) -> str:
    """Accept an absent edition as the university one.

    Every endpoint predates editions, so an omitted parameter has to keep
    meaning exactly what it meant before.
    """

    if value is None or value == "":
        return default
    if isinstance(value, str) and value in EDITIONS:
        return value
    raise UnknownEditionError("Edition must be university or lockin.")


def primary_role(edition: str) -> str:
    return PRIMARY_ROLE_BY_EDITION[normalize_edition(edition)]


def summary_role(edition: str) -> str:
    return SUMMARY_ROLE_BY_EDITION[normalize_edition(edition)]


def edition_label(edition: str) -> str:
    return EDITION_LABELS[normalize_edition(edition)]


def lockin_sheet_slug(university_sheet_slug: str) -> str:
    """The Catalog address of a sheet's Lock-in edition.

    The Lock-in edition is a catalog document of its own, which is what gives it
    the reader, annotations and reading position that a separate sheet has,
    without a second reader implementation.
    """

    return f"{university_sheet_slug}-lockin"[:120]


# A sheet edition can be read in two documents: the study PDF itself, and its
# Sheet Summary. They are different files, so they are different documents to
# anyone marking them up.
STUDY = "study"
SUMMARY = "summary"

VIEWS: tuple[str, ...] = (STUDY, SUMMARY)

# Fixed namespace for deriving a document's annotation identity. It must never
# change: every stored collection is addressed by the ids it produces.
ANNOTATION_NAMESPACE = uuid.UUID("2f6b4c1e-9d33-5a71-b0c6-1b8a5f0d4e27")


def normalize_view(value: object, *, default: str = STUDY) -> str:
    """Accept an absent view as the study PDF, which is what it always meant."""

    if value is None or value == "":
        return default
    if isinstance(value, str) and value in VIEWS:
        return value
    raise UnknownEditionError("View must be study or summary.")


def annotation_document_id(*, learning_object_id: uuid.UUID, edition: str, view: str) -> uuid.UUID:
    """The identity a reader's marks belong to.

    Annotations are anchored to page numbers, and page numbers only mean
    something inside one PDF. A sheet's university PDF, its Lock-in PDF and
    either one's Sheet Summary are therefore separate owners, even though they
    are one sheet with one question bank.

    The university study document keeps the bare learning-object id it has
    always used, so marks made before editions existed stay where they are.
    """

    edition = normalize_edition(edition)
    view = normalize_view(view)
    if edition == UNIVERSITY and view == STUDY:
        return learning_object_id
    return uuid.uuid5(ANNOTATION_NAMESPACE, f"{learning_object_id}:{edition}:{view}")
