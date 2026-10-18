from django.db import transaction
from django.utils import timezone
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import serializers
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.audit.services import record_audit
from platform_core.api.serializers import StrictSerializer

from .models import User
from .policies import USER_POLICY_VERSION, policy_effective_at
from .serializers import UserSerializer


class PolicyAcceptanceSerializer(StrictSerializer):
    version = serializers.CharField(max_length=64)
    accept_policies = serializers.BooleanField()


class PolicyMetadataView(APIView):
    permission_classes = [AllowAny]

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request: Request) -> Response:
        return Response(
            {
                "version": USER_POLICY_VERSION,
                "issued_at": "2026-10-16",
                "effective_at": policy_effective_at(),
                "document_url": "/policies/Lockin_User_Policies_2026.pdf",
            }
        )


class PolicyAcceptanceView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(request=PolicyAcceptanceSerializer, responses=OpenApiTypes.OBJECT)
    @transaction.atomic
    def post(self, request: Request) -> Response:
        serializer = PolicyAcceptanceSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        if (
            serializer.validated_data["version"] != USER_POLICY_VERSION
            or serializer.validated_data["accept_policies"] is not True
        ):
            raise ValidationError({"version": ["Read and accept the current policies."]})
        if not isinstance(request.user, User):
            raise ValidationError({"account": ["Sign in before accepting policies."]})
        user = User.objects.select_for_update().get(id=request.user.id)
        if user.policy_version != USER_POLICY_VERSION or user.policy_accepted_at is None:
            user.policy_version = USER_POLICY_VERSION
            user.policy_accepted_at = timezone.now()
            user.save(update_fields=("policy_version", "policy_accepted_at", "updated_at"))
            record_audit(
                actor=user,
                action="account.policies.accepted",
                domain="accounts",
                target_type="accounts.user",
                target_id=str(user.id),
                reason="User explicitly accepted the published policies.",
                source="accounts.self_service",
                new_state={
                    "version": USER_POLICY_VERSION,
                    "accepted_at": user.policy_accepted_at.isoformat(),
                },
            )
        return Response({"user": UserSerializer(user).data})


class PersonalDataExportView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request: Request) -> Response:
        from .personal_data import export_personal_data
        from .views import _enforce_sensitive_request_limit

        if not isinstance(request.user, User):
            raise ValidationError({"account": ["Sign in to export your data."]})
        _enforce_sensitive_request_limit(
            request=request, scope="personal_data_export", identifier=str(request.user.id)
        )
        return Response(export_personal_data(request.user))
