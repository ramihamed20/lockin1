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
    with_trial: bool = False,
    **extra_fields: object,
) -> User:
    if verified:
        extra_fields["email_verified_at"] = timezone.now()
    user = User.objects.create_user(
        email=email,
        full_name=full_name,
        password=PASSWORD,
        **extra_fields,
    )
    if verified and with_trial:
        from apps.entitlements.services import sync_subscription_entitlements
        from apps.subscriptions.services import create_trial_for_user

        subscription, _ = create_trial_for_user(
            user=user,
            source_reference="test-helper",
        )
        # pytest's database fixture wraps a test in a transaction, so ordinary
        # on_commit subscribers do not run until teardown. Materialize the same
        # grants here before protected endpoint and query-budget assertions.
        sync_subscription_entitlements(subscription_id=subscription.id)
    return user


def csrf_client() -> tuple[APIClient, str]:
    client = APIClient(enforce_csrf_checks=True)
    response = client.get("/api/v1/auth/csrf")
    assert response.status_code == 200
    return client, response.json()["csrf_token"]


def token_from_latest_email() -> str:
    assert mail.outbox
    links = [line for line in mail.outbox[-1].body.splitlines() if line.startswith("http")]
    assert len(links) == 1
    parsed = urlparse(links[0])
    query = parsed.query
    if not query and "?" in parsed.fragment:
        query = parsed.fragment.split("?", 1)[1]
    return parse_qs(query)["token"][0]
