from rest_framework import serializers

from .models import Notification


class NotificationSerializer(serializers.ModelSerializer[Notification]):
    actor_name = serializers.CharField(source="actor.full_name", allow_null=True, read_only=True)
    has_target = serializers.SerializerMethodField()

    def get_has_target(self, obj: Notification) -> bool:
        return bool(obj.target_route)

    class Meta:
        model = Notification
        fields = (
            "id",
            "category",
            "template_key",
            "title",
            "body",
            "data",
            "actor_name",
            "target_type",
            "has_target",
            "read_at",
            "created_at",
        )
        read_only_fields = fields


class PreferenceSerializer(serializers.Serializer[dict[str, object]]):
    category = serializers.ChoiceField(choices=Notification.Category.choices)
    channel = serializers.ChoiceField(choices=("in_app", "email", "push"))
    enabled = serializers.BooleanField()


class PlatformNoticeSerializer(serializers.Serializer[dict[str, object]]):
    recipient_id = serializers.UUIDField()
    title = serializers.CharField(max_length=160, trim_whitespace=True)
    body = serializers.CharField(max_length=320, trim_whitespace=True)
    notice_key = serializers.RegexField(r"^[a-zA-Z0-9][a-zA-Z0-9._:-]{2,119}$")
    is_required = serializers.BooleanField(default=False)
