import pytest
from rest_framework.test import APIClient

from apps.accounts.tests.helpers import create_user

pytestmark = pytest.mark.django_db


@pytest.mark.parametrize("segment", ("admin", "operations"))
def test_user_controlled_subject_path_cannot_bypass_subscription(segment: str) -> None:
    user = create_user(email=f"blocked-{segment}@example.com", verified=False)
    client = APIClient()
    client.force_authenticate(user)

    response = client.get(f"/api/v1/review-bank/subjects/course/{segment}/private")

    assert response.status_code == 403
