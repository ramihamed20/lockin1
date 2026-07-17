import re
import unicodedata
from datetime import datetime
from uuid import UUID

from django.db import transaction

from .models import SearchEntry, SearchTerm

TOKEN_PATTERN = re.compile(r"[^\W_]+", flags=re.UNICODE)


def normalize_search_text(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value).casefold()
    return " ".join(normalized.split())


def search_terms(*values: str) -> tuple[str, ...]:
    terms: set[str] = set()
    for value in values:
        for match in TOKEN_PATTERN.finditer(normalize_search_text(value)):
            term = match.group(0)[:80]
            if len(term) >= 2:
                terms.add(term)
    return tuple(sorted(terms))


@transaction.atomic
def upsert_search_entry(
    *,
    resource_kind: str,
    resource_id: UUID,
    title: str,
    summary: str,
    academic_path: str,
    language: str,
    content_type: str = "",
    published_at: datetime | None = None,
) -> SearchEntry:
    entry, _ = SearchEntry.objects.update_or_create(
        resource_kind=resource_kind,
        resource_id=resource_id,
        defaults={
            "content_type": content_type,
            "title": title,
            "normalized_title": normalize_search_text(title),
            "summary": summary,
            "language": language,
            "academic_path": academic_path,
            "is_discoverable": True,
            "published_at": published_at,
        },
    )
    entry.terms.all().delete()
    SearchTerm.objects.bulk_create(
        [SearchTerm(entry=entry, term=term) for term in search_terms(title, summary)],
        ignore_conflicts=True,
    )
    return entry


def upsert_education_entry(
    *,
    resource_id: UUID,
    resource_kind: str,
    title: str,
    summary: str,
    academic_path: str,
    language: str,
) -> SearchEntry:
    return upsert_search_entry(
        resource_kind=resource_kind,
        resource_id=resource_id,
        title=title,
        summary=summary,
        academic_path=academic_path,
        language=language,
    )


def remove_search_entry(*, resource_kind: str, resource_id: UUID) -> None:
    SearchEntry.objects.filter(resource_kind=resource_kind, resource_id=resource_id).delete()


def set_academic_path_visibility(*, academic_path: str, is_discoverable: bool) -> int:
    return SearchEntry.objects.filter(academic_path=academic_path).update(
        is_discoverable=is_discoverable
    )


@transaction.atomic
def replace_academic_path_prefix(*, old_prefix: str, new_prefix: str) -> int:
    entries = list(SearchEntry.objects.filter(academic_path__startswith=old_prefix))
    for entry in entries:
        entry.academic_path = new_prefix + entry.academic_path.removeprefix(old_prefix)
    SearchEntry.objects.bulk_update(entries, ("academic_path",))
    return len(entries)
