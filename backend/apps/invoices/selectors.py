from django.db.models import QuerySet

from apps.accounts.models import User

from .models import Invoice


def invoices_for_user(*, user: User) -> QuerySet[Invoice]:
    return Invoice.objects.filter(account__primary_user=user).prefetch_related("lines")
