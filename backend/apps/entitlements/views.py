from rest_framework import status
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User
from apps.accounts.permissions import IsAdministrator

from .selectors import active_grants_for_user
from .serializers import EntitlementGrantSerializer, ManualGrantSerializer
from .services import entitlement_decision, grant_manual_entitlement


class MyEntitlementsView(APIView):
    def get(self, request: Request) -> Response:
        user = request.user
        if not isinstance(user, User):
            raise NotFound()
        grants = active_grants_for_user(user=user)
        return Response({"results": EntitlementGrantSerializer(grants, many=True).data})


class MyEntitlementDecisionView(APIView):
    def get(self, request: Request, entitlement_code: str) -> Response:
        user = request.user
        if not isinstance(user, User):
            raise NotFound()
        try:
            decision = entitlement_decision(user=user, entitlement_code=entitlement_code)
        except ValueError as error:
            raise NotFound() from error
        return Response(
            {
                "code": decision.code,
                "allowed": decision.allowed,
                "reason": decision.reason,
                "expires_at": decision.expires_at,
                "quantity_limit": decision.quantity_limit,
                "configuration": decision.configuration or {},
            }
        )


class AdminManualEntitlementView(APIView):
    permission_classes = [IsAdministrator]

    def post(self, request: Request) -> Response:
        serializer = ManualGrantSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        actor = request.user
        if not isinstance(actor, User):
            raise NotFound()
        try:
            user = User.objects.get(id=serializer.validated_data["user_id"])
            grant, created = grant_manual_entitlement(
                user=user,
                entitlement_code=str(serializer.validated_data["entitlement_code"]),
                source_id=serializer.validated_data["source_id"],
                starts_at=serializer.validated_data["starts_at"],
                ends_at=serializer.validated_data.get("ends_at"),
                actor=actor,
                reason_code=str(serializer.validated_data["reason_code"]),
            )
        except (User.DoesNotExist, ValueError) as error:
            raise ValidationError({"grant": [str(error)]}) from error
        return Response(
            EntitlementGrantSerializer(grant).data,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )
