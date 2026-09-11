"""Community is closed at the API, not only on the screen.

The front end shows "coming soon", but the endpoints behind it stayed routed,
authenticated and writable. Anyone could skip the screen and post into an
unlaunched, unmoderated surface. The flag defaults to off so a new environment
cannot expose it by omission.
"""

from uuid import uuid4

import pytest
from django.test import override_settings
from rest_framework.test import APIClient

from apps.accounts.tests.helpers import create_user
from apps.education.tests.helpers import create_admin, published_path

from ..models import Discussion

pytestmark = pytest.mark.django_db


def _authenticated_client() -> APIClient:
    client = APIClient()
    client.force_authenticate(create_user(email="community-probe@example.com"))
    return client


@override_settings(COMMUNITY_ENABLED=False)
def test_writes_are_refused_while_the_feature_is_off() -> None:
    admin = create_admin()
    _, _, lesson = published_path(admin=admin)
    client = _authenticated_client()

    response = client.post(
        "/api/v1/community/discussions",
        {
            "context_type": "lesson",
            "context_id": str(lesson.id),
            "title": "Posting straight past the coming-soon screen",
            "body": "The front end hides this, so the server has to be the one that says no.",
            "client_request_id": str(uuid4()),
        },
        format="json",
    )

    assert response.status_code == 403
    assert not Discussion.objects.exists()


@override_settings(COMMUNITY_ENABLED=False)
def test_reads_are_refused_while_the_feature_is_off() -> None:
    client = _authenticated_client()

    assert client.get("/api/v1/community/discussions").status_code == 403
    assert client.get("/api/v1/community/spaces").status_code == 403


@override_settings(COMMUNITY_ENABLED=True)
def test_a_deployment_can_turn_the_feature_on_deliberately() -> None:
    client = _authenticated_client()

    assert client.get("/api/v1/community/spaces").status_code == 200


def test_the_flag_defaults_to_off_so_omission_cannot_expose_it() -> None:
    """Read the default from base settings rather than the test overrides."""

    import os
    from importlib import reload

    from config.settings import base

    previous = os.environ.pop("COMMUNITY_ENABLED", None)
    try:
        reloaded = reload(base)
        assert reloaded.COMMUNITY_ENABLED is False
    finally:
        if previous is not None:
            os.environ["COMMUNITY_ENABLED"] = previous
        reload(base)


@override_settings(COMMUNITY_ENABLED=False)
def test_the_flag_does_not_close_unrelated_domains() -> None:
    """The gate is per app; turning Community off must not touch anything else."""

    client = APIClient()
    client.force_authenticate(create_user(email="unaffected@example.com"))

    assert client.get("/api/v1/notifications").status_code == 200
