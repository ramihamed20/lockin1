from rest_framework import serializers

from .models import AuditRecord


class AuditRecordSerializer(serializers.ModelSerializer[AuditRecord]):
    actor_name = serializers.CharField(source="actor.full_name", default="System", read_only=True)

    class Meta:
        model = AuditRecord
        fields = (
            "id",
            "actor_id",
            "actor_name",
            "action",
            "domain",
            "target_type",
            "target_id",
            "reason",
            "source",
            "correlation_id",
            "ip_address",
            "previous_state",
            "new_state",
            "related_entities",
            "metadata",
            "occurred_at",
        )
        read_only_fields = fields
