from uuid import UUID

from django.db.models import Q, QuerySet

from apps.accounts.models import User

from .models import ModerationAuditEntry, Report
from .policies import is_administrator, is_moderator, moderated_private_space_ids


def reports_for_user(*, user: User) -> QuerySet[Report]:
    queryset = Report.objects.select_related("reporter", "assigned_to", "duplicate_of")
    if is_administrator(user):
        return queryset.order_by("-created_at", "-id")
    private_spaces = moderated_private_space_ids(user=user)
    manageable = Q(private_space_id__in=private_spaces)
    if is_moderator(user):
        manageable |= Q(private_space_id__isnull=True)
    manageable &= ~Q(reporter=user) & ~Q(target_author_id=user.id)
    return queryset.filter(Q(reporter=user) | manageable).distinct().order_by("-created_at", "-id")


def report_for_user(*, user: User, report_id: UUID) -> Report:
    return reports_for_user(user=user).get(id=report_id)


def audit_for_user(*, user: User) -> QuerySet[ModerationAuditEntry]:
    queryset = ModerationAuditEntry.objects.select_related("actor", "report")
    if is_administrator(user):
        return queryset.order_by("-created_at", "-id")
    private_spaces = moderated_private_space_ids(user=user)
    return (
        queryset.filter(
            Q(actor=user)
            | Q(report__assigned_to=user)
            | Q(report__reporter=user)
            | Q(report__private_space_id__in=private_spaces)
        )
        .distinct()
        .order_by("-created_at", "-id")
    )
