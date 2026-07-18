from dataclasses import dataclass
from decimal import Decimal
from typing import Any
from uuid import UUID


@dataclass(frozen=True, slots=True)
class FocusDocumentReference:
    document_id: UUID
    document_version_id: UUID
    file_id: UUID
    title: str
    language: str
    view_url: str
    size_bytes: int
    checksum_sha256: str
    page_count: int | None = None


@dataclass(frozen=True, slots=True)
class WorkspaceStateInput:
    current_page: int
    page_count: int | None
    zoom: Decimal
    sidebar: str
    active_tool: str
    layout: dict[str, Any]
    open_tabs: list[str]


@dataclass(frozen=True, slots=True)
class AnnotationMutation:
    annotation_id: UUID
    page_number: int
    tool: str
    layer_key: str
    bounds: dict[str, Any]
    payload: dict[str, Any]
    color: str
    thickness: Decimal
    opacity: Decimal


@dataclass(frozen=True, slots=True)
class AnnotationSyncResult:
    collection_revision: int
    saved_at: str
    annotations: tuple[dict[str, Any], ...]
    deleted_ids: tuple[str, ...]
    replayed: bool = False
