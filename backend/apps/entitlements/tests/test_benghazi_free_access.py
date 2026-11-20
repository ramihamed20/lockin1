from datetime import timedelta

import pytest
from rest_framework.test import APIClient

from apps.accounts.tests.helpers import create_user
from apps.education.models import StudentCohort
from apps.entitlements import free_access
from apps.entitlements.services import entitlement_decision

pytestmark = pytest.mark.django_db


@pytest.mark.parametrize("year", ["year-1", "year-2"])
def test_benghazi_dentistry_free_until_december_25(year: str) -> None:
    user = create_user(email=f"benghazi-{year}@example.com", username=f"benghazi_{year}")
    user.cohort = StudentCohort.objects.get(
        program__code="dentistry-benghazi", code=year
    )
    user.save(update_fields=("cohort", "updated_at"))
    deadline = free_access.BENGHAZI_FREE_ACCESS_ENDS_AT
    before = deadline - timedelta(days=1)
    decision = entitlement_decision(
        user=user, entitlement_code="content.premium", at=before
    )
    assert decision.allowed is True
    assert decision.reason == "free_access_window"
    assert decision.expires_at == deadline
    assert (
        entitlement_decision(
            user=user,
            entitlement_code="content.premium",
            at=deadline + timedelta(microseconds=1),
        ).allowed
        is False
    )


def test_benghazi_offer_does_not_include_tripoli() -> None:
    user = create_user(email="tripoli-not-free@example.com", username="tripoli_not_free")
    user.cohort = StudentCohort.objects.get(
        program__code="dentistry-tripoli", code="year-1"
    )
    user.save(update_fields=("cohort", "updated_at"))
    assert free_access.free_access_ends_at(
        user, at=free_access.BENGHAZI_FREE_ACCESS_ENDS_AT - timedelta(days=1)
    ) is None


def test_benghazi_free_window_is_visible_in_current_subscription(monkeypatch) -> None:
    before = free_access.BENGHAZI_FREE_ACCESS_ENDS_AT - timedelta(days=1)
    monkeypatch.setattr(free_access.timezone, "now", lambda: before)
    user = create_user(email="benghazi-api@example.com", username="benghazi_api")
    user.cohort = StudentCohort.objects.get(
        program__code="dentistry-benghazi", code="year-1"
    )
    user.save(update_fields=("cohort", "updated_at"))
    client = APIClient()
    client.force_authenticate(user)
    response = client.get("/api/v1/subscriptions/current")
    assert response.status_code == 200
    subscription = response.json()["subscription"]
    assert subscription["access_exempt"] is True
    assert subscription["free_access_until"].startswith("2026-12-25")
