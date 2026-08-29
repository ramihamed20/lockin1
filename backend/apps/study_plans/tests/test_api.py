from datetime import date, timedelta

import pytest
from rest_framework.test import APIClient

from apps.accounts.tests.helpers import create_user

from ..models import StudyPlanItem

pytestmark = pytest.mark.django_db


def authenticated_client(user):
    client = APIClient()
    client.force_authenticate(user)
    return client


def test_study_plan_create_list_complete_and_delete() -> None:
    user = create_user(with_trial=True)
    client = authenticated_client(user)
    scheduled = date.today() + timedelta(days=1)
    created = client.post(
        "/api/v1/study-plan/items",
        {
            "title": "Review oral pathology",
            "subject": "Pathology",
            "scheduled_date": scheduled.isoformat(),
            "duration_minutes": 40,
        },
        format="json",
    )
    item_id = created.json()["id"]
    start = date.today()
    end = start + timedelta(days=6)
    listed = client.get(f"/api/v1/study-plan?from={start.isoformat()}&to={end.isoformat()}")
    completed = client.patch(
        f"/api/v1/study-plan/items/{item_id}", {"status": "completed"}, format="json"
    )
    deleted = client.delete(f"/api/v1/study-plan/items/{item_id}")

    assert created.status_code == 201
    assert listed.status_code == 200
    assert listed.json()["summary"]["planned_minutes"] == 40
    assert completed.status_code == 200
    assert completed.json()["completed_at"] is not None
    assert deleted.status_code == 204
    assert not StudyPlanItem.objects.filter(user=user).exists()


def test_study_plan_is_isolated_per_user_and_validates_ranges() -> None:
    owner = create_user(email="plan-owner@example.com", with_trial=True)
    stranger = create_user(email="plan-stranger@example.com", with_trial=True)
    owner_client = authenticated_client(owner)
    stranger_client = authenticated_client(stranger)
    created = owner_client.post(
        "/api/v1/study-plan/items",
        {
            "title": "Private plan",
            "scheduled_date": date.today().isoformat(),
            "duration_minutes": 25,
        },
        format="json",
    )

    hidden = stranger_client.get(
        f"/api/v1/study-plan?from={date.today().isoformat()}&to={date.today().isoformat()}"
    )
    denied = stranger_client.patch(
        f"/api/v1/study-plan/items/{created.json()['id']}", {"status": "completed"}, format="json"
    )
    start = date.today()
    end = start + timedelta(days=42)
    too_wide = owner_client.get(f"/api/v1/study-plan?from={start.isoformat()}&to={end.isoformat()}")

    assert hidden.json()["count"] == 0
    assert denied.status_code == 404
    assert too_wide.status_code == 400
