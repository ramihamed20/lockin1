from rest_framework.generics import ListAPIView

from apps.administration.catalog import Capability
from apps.administration.permissions import HasOperationalCapability

from .models import AuditRecord
from .selectors import audit_records
from .serializers import AuditRecordSerializer


class AuditRecordListView(ListAPIView[AuditRecord]):
    permission_classes = [HasOperationalCapability]
    required_capability = Capability.AUDIT_VIEW
    serializer_class = AuditRecordSerializer

    def get_queryset(self):  # type: ignore[no-untyped-def]
        return audit_records(
            domain=self.request.query_params.get("domain", "")[:60],
            actor_id=self.request.query_params.get("actor_id", "")[:40],
            target_id=self.request.query_params.get("target_id", "")[:100],
        )
