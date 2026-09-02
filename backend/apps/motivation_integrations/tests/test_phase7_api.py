import pytest
from django.contrib.auth.models import Group
from rest_framework.test import APIClient

from apps.accounts.roles import Role
from apps.accounts.tests.helpers import create_user
from apps.notifications.models import Notification, NotificationPreference
from apps.notifications.services import create_notification

pytestmark = pytest.mark.django_db


def test_progression_endpoints_are_server_owned() -> None:
    user = create_user()
    client = APIClient()
    client.force_authenticate(user)

    xp = client.get("/api/v1/progression/xp")
    streak = client.get("/api/v1/progression/streak")
    achievements = client.get("/api/v1/progression/achievements")
    ranking = client.get("/api/v1/progression/rankings/current")

    assert xp.status_code == 200
    assert xp.json()["total_points"] == 0
    assert streak.status_code == 200
    assert streak.json()["policy"]["version"] == 1
    assert achievements.status_code == 200
    assert len(achievements.json()) == 5
    assert ranking.status_code == 200
    assert ranking.json()["snapshot"] is None
    assert client.post("/api/v1/progression/xp", {"points": 10}).status_code == 405


def test_notification_api_is_scoped_and_updates_counter() -> None:
    user = create_user()
    other = create_user(email="other-api@example.com")
    notification, _ = create_notification(
        recipient_id=user.id,
        category=Notification.Category.ACCOUNT,
        template_key="account.test",
        title="Ready",
        body="Your account is ready.",
        deduplication_key="account:test",
        target_route="/dashboard",
        required=True,
    )
    assert notification is not None
    client = APIClient()
    client.force_authenticate(user)

    response = client.get("/api/v1/notifications")
    assert response.status_code == 200
    assert response.json()["results"][0]["id"] == str(notification.id)
    assert client.get("/api/v1/notifications/summary").json()["unread_count"] == 1
    opened = client.post(f"/api/v1/notifications/{notification.id}/open")
    assert opened.json()["route"] == "/dashboard"
    assert client.get("/api/v1/notifications/summary").json()["unread_count"] == 0

    client.force_authenticate(other)
    assert client.post(f"/api/v1/notifications/{notification.id}/read").status_code == 404


def test_non_admin_cannot_build_rankings_or_create_platform_notice() -> None:
    user = create_user()
    client = APIClient()
    client.force_authenticate(user)

    assert client.post("/api/v1/progression/rankings/learning_all_time/build").status_code == 403
    assert client.post("/api/v1/notifications/platform-notices", {}).status_code == 403


def test_optional_platform_notice_respects_recipient_preference() -> None:
    admin = create_user(email="admin-notice@example.com")
    recipient = create_user(email="recipient-notice@example.com")
    Group.objects.get(name=Role.ADMINISTRATOR.value).user_set.add(admin)
    NotificationPreference.objects.create(
        user=recipient,
        category=Notification.Category.PLATFORM,
        channel=NotificationPreference.Channel.IN_APP,
        enabled=False,
    )
    client = APIClient()
    client.force_authenticate(admin)

    response = client.post(
        "/api/v1/notifications/platform-notices",
        {
            "recipient_id": str(recipient.id),
            "title": "Maintenance",
            "body": "The platform will be briefly unavailable.",
            "notice_key": "maintenance-2026-08-14",
            "is_required": False,
        },
        format="json",
    )

    assert response.status_code == 202
    assert response.json()["created"] is False
    assert not Notification.objects.filter(recipient=recipient).exists()
