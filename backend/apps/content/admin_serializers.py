from rest_framework import serializers

from platform_core.api.serializers import StrictSerializer


class AdminSheetCreateSerializer(StrictSerializer):
    title = serializers.CharField(max_length=220, trim_whitespace=True)
    summary = serializers.CharField(
        max_length=6000,
        trim_whitespace=True,
        required=False,
        default="",
    )
    primary_file_id = serializers.UUIDField()
    summary_file_id = serializers.UUIDField(allow_null=True, required=False, default=None)
    position = serializers.IntegerField(min_value=0, max_value=1_000_000, default=0)
    publish = serializers.BooleanField(default=False)
    notify_students = serializers.BooleanField(default=False)
    allow_download = serializers.BooleanField(default=False)


class AdminSheetUpdateSerializer(StrictSerializer):
    expected_revision = serializers.IntegerField(min_value=1)
    title = serializers.CharField(max_length=220, trim_whitespace=True, required=False)
    summary = serializers.CharField(max_length=6000, trim_whitespace=True, required=False)
    position = serializers.IntegerField(min_value=0, max_value=1_000_000, required=False)

    def validate(self, attrs):  # type: ignore[no-untyped-def]
        if len(attrs) == 1:
            raise serializers.ValidationError("Provide at least one sheet field to update.")
        return attrs


class AdminSheetActionSerializer(StrictSerializer):
    expected_revision = serializers.IntegerField(min_value=1)
    action = serializers.ChoiceField(choices=("publish", "unpublish", "archive"))
    notify_students = serializers.BooleanField(default=False)


class AdminSheetReplacePdfSerializer(StrictSerializer):
    expected_revision = serializers.IntegerField(min_value=1)
    primary_file_id = serializers.UUIDField()
    notify_students = serializers.BooleanField(default=False)


class AdminSheetSummaryPdfSerializer(StrictSerializer):
    expected_revision = serializers.IntegerField(min_value=1)
    summary_file_id = serializers.UUIDField()


class AdminSheetDeletePdfSerializer(StrictSerializer):
    expected_revision = serializers.IntegerField(min_value=1)


class AdminSheetReorderSerializer(StrictSerializer):
    expected_revision = serializers.IntegerField(min_value=1)
    target_sheet_id = serializers.UUIDField()
    placement = serializers.ChoiceField(choices=("before", "after"))


class AdminActiveStudySettingsSerializer(StrictSerializer):
    expected_revision = serializers.IntegerField(min_value=0)
    enabled = serializers.BooleanField()
    total_pdf_pages = serializers.IntegerField(
        min_value=1, max_value=10_000, allow_null=True, required=False
    )
    # No defaults: an omitted or blank field means "keep the stored value", so a
    # stale Admin form cannot silently reset saved page boundaries to zero.
    excluded_start_pages = serializers.IntegerField(
        min_value=0, max_value=9_999, allow_null=True, required=False
    )
    excluded_end_pages = serializers.IntegerField(
        min_value=0, max_value=9_999, allow_null=True, required=False
    )
    confirm_boundary_change = serializers.BooleanField(required=False, default=False)


class AdminSheetLockinPdfSerializer(StrictSerializer):
    expected_revision = serializers.IntegerField(min_value=0)
    lockin_file_id = serializers.UUIDField()


class AdminActiveStudyPlanPreviewSerializer(StrictSerializer):
    """Unsaved boundaries to plan.  Every field is optional: an omitted field
    keeps the stored value instead of resetting it to a default."""

    total_pdf_pages = serializers.IntegerField(
        min_value=1, max_value=10_000, allow_null=True, required=False
    )
    excluded_start_pages = serializers.IntegerField(
        min_value=0, max_value=9_999, allow_null=True, required=False
    )
    excluded_end_pages = serializers.IntegerField(
        min_value=0, max_value=9_999, allow_null=True, required=False
    )


class AdminActiveStudyQuestionValidateSerializer(StrictSerializer):
    payload = serializers.JSONField()


class AdminActiveStudyQuestionSaveSerializer(AdminActiveStudyQuestionValidateSerializer):
    expected_revision = serializers.IntegerField(min_value=0)


class AdminActiveStudyQuestionDeleteSerializer(StrictSerializer):
    expected_revision = serializers.IntegerField(min_value=1)
