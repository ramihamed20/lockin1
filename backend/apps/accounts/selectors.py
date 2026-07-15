from typing import Any

from django.db.models import Count, Q
from django.utils import timezone

from .models import AccountSession, User
from .roles import Role, get_user_roles, user_has_role


def dashboard_summary(*, user: User) -> dict[str, Any]:
    active_sessions = AccountSession.objects.filter(
        user=user, expires_at__gt=timezone.now()
    ).count()
    summary: dict[str, Any] = {
        "roles": get_user_roles(user),
        "account": {
            "email_verified": user.is_email_verified,
            "active_sessions": active_sessions,
            "preferred_language": user.preferred_language,
        },
        "workspaces": [role for role in get_user_roles(user) if role != Role.STUDENT.value],
    }
    if user_has_role(user, Role.ADMINISTRATOR):
        counts = User.objects.aggregate(
            total=Count("id"),
            verified=Count("id", filter=Q(email_verified_at__isnull=False)),
            suspended=Count("id", filter=Q(status=User.Status.SUSPENDED)),
        )
        summary["administration"] = counts
    return summary
