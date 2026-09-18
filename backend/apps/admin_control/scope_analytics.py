"""Platform analytics scoped by University -> Specialty -> Year.

The scope is read from the education tree the catalog already uses, never from
display names. A University is a ``college`` node, a Specialty is a
``department`` node under it, and a Year is an ``academic_year`` node under
that, which is the content root a ``StudentCohort`` points at. Two colleges
that both teach "Dentistry" have two separate department nodes, so selecting
one can never reach the other.

Each metric is answered two ways from the same scope node:

* content (subjects, sheets, questions, answers) by the tree path the content
  sits under, and
* people (students, subscriptions, XP) by the cohorts whose content root sits
  under that path.

Every figure is one grouped database query for the whole scope, and a
breakdown reuses those same grouped rows, so the number of queries does not
grow with the number of universities, specialties or years.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import timedelta
from typing import Any
from uuid import UUID

from django.db.models import Count, F, Q, QuerySet, Sum
from django.utils import timezone

from apps.accounts.models import User
from apps.accounts.roles import Role
from apps.content.models import CatalogSubject, LearningObject
from apps.education.models import EducationNode, StudentCohort
from apps.questions.models import Question, QuestionAnswer
from apps.subscriptions.models import Subscription
from apps.xp.models import XpTransaction

ACTIVE_WINDOW_DAYS = 30
_KIND_BY_LEVEL = {
    "university": EducationNode.Kind.COLLEGE,
    "specialty": EducationNode.Kind.DEPARTMENT,
    "year": EducationNode.Kind.ACADEMIC_YEAR,
}
_PAID_STATUSES = (Subscription.Status.ACTIVE, Subscription.Status.GRACE)


class ScopeRejected(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class _Node:
    id: UUID
    parent_id: UUID | None
    kind: str
    title: str
    path: str
    position: int


@dataclass(frozen=True, slots=True)
class _Tree:
    """The selectable hierarchy: only branches some active cohort studies in."""

    nodes: dict[UUID, _Node]
    cohort_paths: dict[UUID, list[str]]

    def children(self, parent: _Node | None, level: str) -> list[_Node]:
        kind = _KIND_BY_LEVEL[level]
        found = [
            node
            for node in self.nodes.values()
            if node.kind == kind
            and (parent is None or node.path.startswith(parent.path))
            and any(
                path.startswith(node.path) for paths in self.cohort_paths.values() for path in paths
            )
        ]
        return sorted(found, key=lambda node: (node.position, node.title, str(node.id)))

    def cohorts_under(self, path: str) -> set[UUID]:
        return {
            cohort_id
            for cohort_id, paths in self.cohort_paths.items()
            if any(item.startswith(path) for item in paths)
        }


def _tree() -> _Tree:
    roots: dict[UUID, list[str]] = defaultdict(list)
    for cohort_id, path in StudentCohort.objects.filter(
        is_active=True, content_nodes__isnull=False
    ).values_list("id", "content_nodes__path"):
        roots[cohort_id].append(str(path))
    nodes = {
        row["id"]: _Node(
            id=row["id"],
            parent_id=row["parent_id"],
            kind=row["kind"],
            title=row["title"],
            path=row["path"],
            position=row["position"],
        )
        for row in EducationNode.objects.filter(kind__in=_KIND_BY_LEVEL.values()).values(
            "id", "parent_id", "kind", "title", "path", "position"
        )
    }
    return _Tree(nodes=nodes, cohort_paths=dict(roots))


def _pick(tree: _Tree, parent: _Node | None, level: str, raw: str | None) -> _Node | None:
    if not raw:
        return None
    try:
        wanted = UUID(str(raw))
    except ValueError as error:
        raise ScopeRejected(f"The {level} filter is not a valid identifier.") from error
    match = next((node for node in tree.children(parent, level) if node.id == wanted), None)
    if match is None:
        # Also the answer for a real node under a different parent: a Specialty
        # is only ever resolved inside the University it belongs to.
        raise ScopeRejected(f"That {level} is not part of the selected scope.")
    return match


def _students() -> QuerySet[User]:
    return User.objects.exclude(status=User.Status.DELETED).exclude(
        Q(is_superuser=True) | Q(groups__name=Role.ADMINISTRATOR.value)
    )


def _by_path(
    queryset: QuerySet[Any], field: str, path: str | None, **aggregates: Any
) -> list[dict[str, Any]]:
    if path:
        queryset = queryset.filter(**{f"{field}__startswith": path})
    return list(queryset.values(scope_path=F(field)).annotate(**aggregates).order_by())


def _by_cohort(
    queryset: QuerySet[Any], field: str, cohorts: set[UUID] | None, **aggregates: Any
) -> list[dict[str, Any]]:
    if cohorts is not None:
        queryset = queryset.filter(**{f"{field}__in": cohorts})
    return list(queryset.values(scope_cohort=F(field)).annotate(**aggregates).order_by())


def _total(rows: list[dict[str, Any]], key: str, keep: Any = None) -> int:
    return int(sum((row[key] or 0) for row in rows if keep is None or keep(row)))


def _accuracy(correct: int, total: int) -> float | None:
    return round(correct / total * 100, 1) if total else None


def scoped_analytics(
    *, university: str | None = None, specialty: str | None = None, year: str | None = None
) -> dict[str, Any]:
    if specialty and not university:
        raise ScopeRejected("Choose a university before a specialty.")
    if year and not specialty:
        raise ScopeRejected("Choose a specialty before a year.")
    tree = _tree()
    chosen_university = _pick(tree, None, "university", university)
    chosen_specialty = _pick(tree, chosen_university, "specialty", specialty)
    chosen_year = _pick(tree, chosen_specialty, "year", year)
    scope = chosen_year or chosen_specialty or chosen_university
    path = scope.path if scope else None
    cohorts = tree.cohorts_under(path) if path else None

    active_since = timezone.now() - timedelta(days=ACTIVE_WINDOW_DAYS)
    students = _by_cohort(
        _students(),
        "cohort_id",
        cohorts,
        total=Count("id", distinct=True),
        active=Count("id", distinct=True, filter=Q(last_login__gte=active_since)),
    )
    subscriptions = _by_cohort(
        Subscription.objects.all(),
        "account__primary_user__cohort_id",
        cohorts,
        paid=Count("id", filter=Q(status__in=_PAID_STATUSES)),
        trial=Count("id", filter=Q(status=Subscription.Status.TRIALING)),
    )
    xp = _by_cohort(XpTransaction.objects.all(), "user__cohort_id", cohorts, points=Sum("points"))
    subjects = _by_path(
        CatalogSubject.objects.filter(is_active=True, cohort__is_active=True),
        "source_node__path",
        path,
        total=Count("id"),
    )
    sheets = _by_path(
        LearningObject.objects.filter(published_version__isnull=False, archived_at__isnull=True),
        "published_version__academic_node__path",
        path,
        total=Count("id"),
    )
    questions = _by_path(
        Question.objects.filter(published_version__isnull=False, retired_at__isnull=True),
        "published_version__academic_node__path",
        path,
        total=Count("id"),
    )
    answers = _by_path(
        QuestionAnswer.objects.all(),
        "version__academic_node__path",
        path,
        total=Count("id"),
        correct=Count("id", filter=Q(is_correct=True)),
    )

    level = _level(scope)
    child_level = {"overall": "university", "university": "specialty", "specialty": "year"}.get(
        level
    )
    universities = [chosen_university] if chosen_university else tree.children(None, "university")
    specialties = (
        [chosen_specialty]
        if chosen_specialty
        else [node for parent in universities for node in tree.children(parent, "specialty")]
    )
    years = (
        [chosen_year]
        if chosen_year
        else [node for parent in specialties for node in tree.children(parent, "year")]
    )

    answered = _total(answers, "total")
    correct = _total(answers, "correct")
    metrics = {
        "students": _total(students, "total"),
        "active_students": _total(students, "active"),
        "universities": len(universities),
        "specialties": len(specialties),
        "years": len(years),
        "subjects": _total(subjects, "total"),
        "sheets": _total(sheets, "total"),
        "published_questions": _total(questions, "total"),
        "question_answers": answered,
        "correct_answers": correct,
        "incorrect_answers": answered - correct,
        "accuracy": _accuracy(correct, answered),
        "xp_awarded": _total(xp, "points"),
        "active_subscriptions": _total(subscriptions, "paid"),
        "trial_subscriptions": _total(subscriptions, "trial"),
    }

    rows = []
    if child_level:
        for node in tree.children(scope, child_level):
            node_cohorts = tree.cohorts_under(node.path)
            under = lambda row, prefix=node.path: str(row["scope_path"]).startswith(prefix)  # noqa: E731
            mine = lambda row, ids=node_cohorts: row["scope_cohort"] in ids  # noqa: E731
            row_answers = _total(answers, "total", under)
            row_correct = _total(answers, "correct", under)
            rows.append(
                {
                    "id": str(node.id),
                    "title": node.title,
                    "students": _total(students, "total", mine),
                    "subjects": _total(subjects, "total", under),
                    "sheets": _total(sheets, "total", under),
                    "published_questions": _total(questions, "total", under),
                    "question_answers": row_answers,
                    "accuracy": _accuracy(row_correct, row_answers),
                }
            )

    def option(node: _Node) -> dict[str, str]:
        return {"id": str(node.id), "title": node.title}

    return {
        "scope": {
            "level": level,
            "university": option(chosen_university) if chosen_university else None,
            "specialty": option(chosen_specialty) if chosen_specialty else None,
            "year": option(chosen_year) if chosen_year else None,
        },
        "options": {
            "universities": [option(node) for node in tree.children(None, "university")],
            "specialties": [option(node) for node in tree.children(chosen_university, "specialty")]
            if chosen_university
            else [],
            "years": [option(node) for node in tree.children(chosen_specialty, "year")]
            if chosen_specialty
            else [],
        },
        "metrics": metrics,
        "active_window_days": ACTIVE_WINDOW_DAYS,
        "breakdown": {"level": child_level, "rows": rows},
    }


def _level(scope: _Node | None) -> str:
    if scope is None:
        return "overall"
    return next(level for level, kind in _KIND_BY_LEVEL.items() if kind == scope.kind)
