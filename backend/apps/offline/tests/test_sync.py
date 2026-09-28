from unittest.mock import patch
from uuid import uuid4

import pytest
from rest_framework.test import APIClient

from apps.accounts.tests.helpers import create_user
from apps.entitlements.offline_lease import issue_offline_lease
from apps.entitlements.services import EntitlementDecision


def _lease(user):
    with patch(
        "apps.entitlements.offline_lease.subscription_access_decision",
        return_value=EntitlementDecision(code="content.premium", allowed=True, reason="granted"),
    ):
        return issue_offline_lease(user=user)["token"]


pytestmark = pytest.mark.django_db


def _client(user):
    client = APIClient()
    client.force_authenticate(user)
    return client


def test_sync_receipts_are_idempotent_and_account_scoped() -> None:
    first = create_user(email="offline-first@example.com", verified=False)
    second = create_user(email="offline-second@example.com", verified=False)
    operation = {
        "operation_id": str(uuid4()),
        "operation_type": "question_answer",
        "payload": {
            "sheet_id": str(uuid4()),
            "question_id": str(uuid4()),
            "choice_ids": [str(uuid4())],
            "xp_to_add": 999,
        },
    }
    with patch("apps.offline.sync._question_answer", return_value={"xp_awarded": 5}) as grade:
        first_lease, second_lease = _lease(first), _lease(second)
        first_response = _client(first).post(
            "/api/v1/offline/sync/",
            {"lease_token": first_lease, "operations": [operation]},
            format="json",
        )
        retry_response = _client(first).post(
            "/api/v1/offline/sync/",
            {"lease_token": first_lease, "operations": [operation]},
            format="json",
        )
        other_response = _client(second).post(
            "/api/v1/offline/sync/",
            {"lease_token": second_lease, "operations": [operation]},
            format="json",
        )
    assert (
        first_response.status_code
        == retry_response.status_code
        == other_response.status_code
        == 200
    )
    assert len(first_response.json()["accepted"]) == 1
    assert first_response.json()["accepted"] == retry_response.json()["accepted"]
    assert grade.call_count == 2  # one grade per account, never one per retry


def test_sync_rejects_reused_operation_with_changed_evidence() -> None:
    user = create_user(email="offline-conflict@example.com", verified=False)
    operation = {
        "operation_id": str(uuid4()),
        "operation_type": "question_answer",
        "payload": {
            "sheet_id": str(uuid4()),
            "question_id": str(uuid4()),
            "choice_ids": [str(uuid4())],
        },
    }
    with patch("apps.offline.sync._question_answer", return_value={"xp_awarded": 0}):
        lease = _lease(user)
        _client(user).post(
            "/api/v1/offline/sync/",
            {"lease_token": lease, "operations": [operation]},
            format="json",
        )
        changed = {**operation, "payload": {**operation["payload"], "choice_ids": [str(uuid4())]}}
        response = _client(user).post(
            "/api/v1/offline/sync/", {"lease_token": lease, "operations": [changed]}, format="json"
        )
    assert response.status_code == 200
    assert response.json()["accepted"] == []
    assert len(response.json()["rejected"]) == 1


def test_sync_requires_a_user_bound_signed_lease() -> None:
    first = create_user(email="offline-proof-first@example.com", verified=False)
    second = create_user(email="offline-proof-second@example.com", verified=False)
    body = {"operations": []}
    assert _client(first).post("/api/v1/offline/sync/", body, format="json").status_code == 403
    assert (
        _client(second)
        .post("/api/v1/offline/sync/", {**body, "lease_token": _lease(first)}, format="json")
        .status_code
        == 403
    )
