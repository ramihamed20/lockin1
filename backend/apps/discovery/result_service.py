"""Small, permission-aware result records for the student global search."""

from __future__ import annotations

from collections.abc import Sequence
from typing import TypedDict
from urllib.parse import quote
from uuid import UUID

from django.db.models import Q

from apps.accounts.models import User
from apps.education.models import EducationNode
from apps.progress.models import Bookmark
from apps.questions.models import Question
from apps.review.models import ReviewItem

from .indexing import normalize_search_text
from .models import SearchEntry
from .selectors import search


class GlobalSearchResult(TypedDict):
    title: str
    subtitle: str
    type: str
    destination: str
    metadata: dict[str, bool]


_ENTRY_TYPE = {
    "subject": "subject",
    "learning_object": "material",
    "quiz": "quiz",
    "question": "question",
}


def _path_node_ids(path: str) -> tuple[UUID, ...]:
    values: list[UUID] = []
    for token in path.split("/"):
        if not token:
            continue
        try:
            values.append(UUID(token))
        except ValueError:
            # A malformed historical projection must not prevent the rest of
            # the student's results from rendering.
            continue
    return tuple(values)


def _subject_labels(entries: Sequence[SearchEntry]) -> dict[UUID, str]:
    path_ids = {node_id for entry in entries for node_id in _path_node_ids(entry.academic_path)}
    nodes = EducationNode.objects.filter(id__in=path_ids).only("id", "kind", "title")
    by_id = {node.id: node for node in nodes}
    labels: dict[UUID, str] = {}
    for entry in entries:
        lineage = [
            by_id[node_id] for node_id in _path_node_ids(entry.academic_path) if node_id in by_id
        ]
        subject = next(
            (node for node in lineage if node.kind == EducationNode.Kind.SUBJECT),
            None,
        )
        if subject is not None and subject.id != entry.resource_id:
            labels[entry.id] = subject.title
    return labels


def _question_destinations(entries: Sequence[SearchEntry]) -> dict[UUID, str]:
    question_ids = [entry.resource_id for entry in entries if entry.resource_kind == "question"]
    if not question_ids:
        return {}
    questions = Question.objects.filter(id__in=question_ids).select_related(
        "published_version__source_learning_object"
    )
    destinations: dict[UUID, str] = {}
    for question in questions:
        source_id = (
            question.published_version.source_learning_object_id
            if question.published_version
            else None
        )
        # Published questions may be linked to an actual sheet. That page is
        # the safe, direct student destination; standalone questions do not
        # have a public detail route and therefore use the question hub.
        destinations[question.id] = f"/materials/objects/{source_id}" if source_id else "/questions"
    return destinations


def _entry_destination(entry: SearchEntry, question_destinations: dict[UUID, str]) -> str:
    if entry.resource_kind == "learning_object":
        return f"/materials/objects/{entry.resource_id}"
    if entry.resource_kind == "quiz":
        return f"/questions/quizzes/{entry.resource_id}"
    if entry.resource_kind == "question":
        return question_destinations.get(entry.resource_id, "/questions")
    return f"/materials/{entry.resource_id}"


def _entry_result(
    entry: SearchEntry,
    *,
    subject_labels: dict[UUID, str],
    question_destinations: dict[UUID, str],
    bookmarked_ids: set[UUID],
) -> GlobalSearchResult:
    entry_type = _ENTRY_TYPE.get(entry.resource_kind, "topic")
    if entry.resource_kind == "learning_object" and entry.content_type == "pdf":
        entry_type = "pdf"
    metadata = {"bookmarked": True} if entry.resource_id in bookmarked_ids else {}
    return {
        "title": entry.title,
        "subtitle": subject_labels.get(entry.id, ""),
        "type": entry_type,
        "destination": _entry_destination(entry, question_destinations),
        "metadata": metadata,
    }


def _review_results(*, user: User, raw_query: str, limit: int) -> list[GlobalSearchResult]:
    # Review content is inherently user-scoped. Hidden and mastered questions
    # are intentionally absent, even though they share the same table.
    matches = (
        ReviewItem.objects.filter(user=user, state=ReviewItem.State.ACTIVE)
        .filter(
            Q(prompt_snapshot__icontains=raw_query)
            | Q(subject_label_snapshot__icontains=raw_query)
            | Q(source_label_snapshot__icontains=raw_query)
        )
        .only("prompt_snapshot", "subject_key", "subject_label_snapshot")
        .order_by("-last_mistake_at", "id")[:limit]
    )
    return [
        {
            "title": item.prompt_snapshot[:220],
            "subtitle": item.subject_label_snapshot,
            "type": "review",
            "destination": f"/review/bank/{quote(item.subject_key, safe='')}",
            "metadata": {},
        }
        for item in matches
    ]


def _rank(result: GlobalSearchResult, normalized_query: str) -> tuple[int, str, str, str]:
    title = normalize_search_text(result["title"])
    subtitle = normalize_search_text(result["subtitle"])
    if title == normalized_query:
        rank = 0
    elif title.startswith(normalized_query):
        rank = 1
    elif normalized_query in title:
        rank = 2
    elif subtitle.startswith(normalized_query) or normalized_query in subtitle:
        rank = 3
    else:
        rank = 4
    return (rank, title, result["type"], result["destination"])


def global_search(
    *,
    user: User,
    query: str,
    limit: int = 12,
    resource_kinds: Sequence[str] = (),
    content_types: Sequence[str] = (),
    academic_path: str | None = None,
) -> list[GlobalSearchResult]:
    """Return compact search cards without leaking projection or admin data."""

    normalized_query = normalize_search_text(query)[:120]
    if not normalized_query:
        return []

    result_limit = max(1, min(int(limit), 24))
    candidates = list(
        search(
            query=query,
            resource_kinds=resource_kinds,
            content_types=content_types,
            academic_path=academic_path,
        )[: result_limit * 3]
    )
    subject_labels = _subject_labels(candidates)
    question_destinations = _question_destinations(candidates)
    bookmarked_ids = set(
        Bookmark.objects.filter(
            user=user,
            learning_object_id__in=[
                entry.resource_id
                for entry in candidates
                if entry.resource_kind == "learning_object"
            ],
        ).values_list("learning_object_id", flat=True)
    )
    results = [
        _entry_result(
            entry,
            subject_labels=subject_labels,
            question_destinations=question_destinations,
            bookmarked_ids=bookmarked_ids,
        )
        for entry in candidates
    ]
    if not resource_kinds or "review" in resource_kinds:
        results.extend(_review_results(user=user, raw_query=query, limit=result_limit * 2))
    results.sort(key=lambda result: _rank(result, normalized_query))
    return results[:result_limit]
