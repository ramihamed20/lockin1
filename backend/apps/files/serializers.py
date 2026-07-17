from rest_framework import serializers

from platform_core.api.serializers import StrictSerializer

from .models import ManagedFile


class ManagedFileSerializer(serializers.ModelSerializer[ManagedFile]):
    class Meta:
        model = ManagedFile
        fields = (
            "id",
            "kind",
            "original_name",
            "content_type",
            "size_bytes",
            "checksum_sha256",
            "validation_status",
            "scan_status",
            "created_at",
        )
        read_only_fields = fields


class FileUploadSerializer(StrictSerializer):
    kind = serializers.ChoiceField(choices=ManagedFile.Kind.choices)
    file = serializers.FileField(write_only=True)
