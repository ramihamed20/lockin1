from django.db.models import QuerySet

from apps.accounts.models import User

from .models import Refund


def refunds_for_user(*, user: User) -> QuerySet[Refund]:
    return Refund.objects.filter(payment__account__primary_user=user).select_related("payment")
