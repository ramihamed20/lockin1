from django.db.models import Q, QuerySet
from django.utils import timezone

from apps.accounts.models import User

from .models import EntitlementGrant


def active_grants_for_user(*, user: User) -> QuerySet[EntitlementGrant]:
    now = timezone.now()
    return (
        EntitlementGrant.objects.filter(
            user=user,
            status=EntitlementGrant.Status.ACTIVE,
            entitlement__is_active=True,
            starts_at__lte=now,
        )
        .filter(Q(ends_at__isnull=True) | Q(ends_at__gt=now))
        .select_related("entitlement")
        .order_by("entitlement__code", "ends_at")
    )
