from django.conf import settings
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from .adapters import ProviderVerificationError
from .services import ingest_webhook


class ProviderWebhookView(APIView):
    authentication_classes: list[type] = []
    permission_classes = [AllowAny]

    def post(self, request: Request, provider: str) -> Response:
        if provider != "fake":
            return Response({"detail": "Unknown provider."}, status=status.HTTP_404_NOT_FOUND)
        content_length = request.META.get("CONTENT_LENGTH", "")
        if content_length:
            try:
                if int(content_length) > settings.PAYMENT_WEBHOOK_MAX_BYTES:
                    return Response(
                        {"detail": "Invalid webhook."},
                        status=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                    )
            except ValueError:
                return Response({"detail": "Invalid webhook."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            result = ingest_webhook(raw_body=request.body, headers=request.headers)
        except ProviderVerificationError:
            return Response({"detail": "Invalid webhook."}, status=status.HTTP_400_BAD_REQUEST)
        return Response(
            {"accepted": True, "duplicate": not result.created},
            status=status.HTTP_200_OK,
        )
