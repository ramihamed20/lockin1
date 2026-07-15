from urllib.parse import parse_qs, urlparse

from django.core import mail
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User

PASSWORD = "Lock-in-test-pass-2026"


def create_user(
    *,
    email: str = "student@example.com",
    full_name: str = "Student Name",
    verified: bool = True,
    **extra_fields: object,
) -> User:
    if verified:
        extra_fields["email_verified_at"] = timezone.now()
    return User.objects.create_user(
        email=email,
        full_name=full_name,
        password=PASSWORD,
        **extra_fields,
    )


def csrf_client() -> tuple[APIClient, str]:
    client = APIClient(enforce_csrf_checks=True)
    response = client.get("/api/v1/auth/csrf")
    assert response.status_code == 200
    return client, response.json()["csrf_token"]


def token_from_latest_email() -> str:
    assert mail.outbox
    links = [line for line in mail.outbox[-1].body.splitlines() if line.startswith("http")]
    assert len(links) == 1
    return parse_qs(urlparse(links[0]).query)["token"][0]
