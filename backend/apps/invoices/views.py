from rest_framework.generics import ListAPIView

from apps.accounts.models import User

from .models import Invoice
from .selectors import invoices_for_user
from .serializers import InvoiceSerializer


class MyInvoicesView(ListAPIView[Invoice]):
    serializer_class = InvoiceSerializer

    def get_queryset(self):  # type: ignore[no-untyped-def]
        user = self.request.user
        if not isinstance(user, User):
            return Invoice.objects.none()
        return invoices_for_user(user=user)
