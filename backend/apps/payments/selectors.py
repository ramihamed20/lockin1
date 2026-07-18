from django.db.models import QuerySet

from apps.accounts.models import User

from .models import Payment


def payments_for_user(*, user: User) -> QuerySet[Payment]:
    return Payment.objects.filter(account__primary_user=user).select_related(
        "subscription", "price__plan_version__plan__product"
    )
