from collections.abc import Sequence

from django.db.models import Case, IntegerField, Q, QuerySet, Value, When

from .indexing import normalize_search_text, search_terms
from .models import SearchEntry


def search(
    *,
    query: str,
    resource_kinds: Sequence[str] = (),
    content_types: Sequence[str] = (),
    academic_path: str | None = None,
) -> QuerySet[SearchEntry]:
    queryset = SearchEntry.objects.filter(is_discoverable=True)
    if resource_kinds:
        queryset = queryset.filter(resource_kind__in=resource_kinds)
    if content_types:
        queryset = queryset.filter(content_type__in=content_types)
    if academic_path:
        queryset = queryset.filter(academic_path__startswith=academic_path)

    normalized = normalize_search_text(query)[:120]
    if not normalized:
        return queryset.order_by("-published_at", "title", "resource_id")

    terms = search_terms(normalized)
    if not terms:
        queryset = queryset.filter(normalized_title__startswith=normalized)
    for term in terms:
        queryset = queryset.filter(
            Q(normalized_title__startswith=term) | Q(terms__term__startswith=term)
        )
    return (
        queryset.annotate(
            search_rank=Case(
                When(normalized_title=normalized, then=Value(0)),
                When(normalized_title__startswith=normalized, then=Value(1)),
                default=Value(2),
                output_field=IntegerField(),
            )
        )
        .distinct()
        .order_by("search_rank", "title", "resource_kind", "resource_id")
    )
