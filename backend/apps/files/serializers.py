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
            "scan_attempts",
            "scan_requested_at",
            "scan_started_at",
            "scan_completed_at",
            "scan_next_attempt_at",
            "scan_engine",
            "scan_error_code",
            "created_at",
        )
        read_only_fields = fields


class FileUploadSerializer(StrictSerializer):
    kind = serializers.ChoiceField(choices=ManagedFile.Kind.choices)
    file = serializers.FileField(write_only=True)


class FileScanDecisionSerializer(StrictSerializer):
    decision = serializers.ChoiceField(
        choices=(
            ManagedFile.ScanStatus.CLEAN,
            ManagedFile.ScanStatus.QUARANTINED,
            ManagedFile.ScanStatus.FAILED,
        )
    )
    reason = serializers.CharField(min_length=10, max_length=500, trim_whitespace=True)
