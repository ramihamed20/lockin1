from rest_framework import serializers

from .models import XpTransaction


class XpTransactionSerializer(serializers.ModelSerializer[XpTransaction]):
    class Meta:
        model = XpTransaction
        fields = ("id", "points", "category", "reason", "occurred_at")
        read_only_fields = fields
