"""Offline Active Study: bundle download, manifest dependencies and replay.

These tests use only ORM behavior shared by SQLite and PostgreSQL. Row locking
(`select_for_update`) is exercised for real only by the PostgreSQL CI job.
"""

from datetime import timedelta
from typing import Any
from unittest.mock import patch
from uuid import uuid4

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.tests.helpers import create_user
from apps.content.models import ActiveStudyQuestionContent, CatalogDocument, CatalogSubject
from apps.content.tests.test_catalog_workspace import catalog_fixture
from apps.entitlements.models import EntitlementDefinition, EntitlementGrant
from apps.entitlements.offline_lease import issue_offline_lease
from apps.entitlements.services import EntitlementDecision
from apps.focus.managed_active_study import (
    complete_part_reading,
    questions,
    start,
    submit,
)
from apps.focus.models import ActiveStudyAttempt, ActiveStudyRun
from apps.focus.tests.test_managed_active_study import _answer_count, _setup
from apps.review.models import ReviewItem
from apps.xp.models import XpTransaction

pytestmark = pytest.mark.django_db


def _grant(user: Any, code: str, *, hours: int = 2) -> None:
    EntitlementGrant.objects.create(
        user=user,
        entitlement=EntitlementDefinition.objects.get(code=code),
        source_type=EntitlementGrant.SourceType.MANUAL,
        source_id=uuid4(),
        starts_at=timezone.now() - timedelta(minutes=1),
        ends_at=timezone.now() + timedelta(hours=hours),
    )


def _entitled(user: Any) -> Any:
    _grant(user, "content.premium")
    _grant(user, "focus.workspace")
    return user


def _client(user: Any) -> APIClient:
    client = APIClient()
    client.force_authenticate(user)
    return client


def _lease(user: Any, *, now: Any = None) -> str:
    with patch(
        "apps.entitlements.offline_lease.subscription_access_decision",
        return_value=EntitlementDecision(code="content.premium", allowed=True, reason="granted"),
    ):
        return issue_offline_lease(user=user, now=now)["token"]


def _answers(total: int, correct: int) -> list[dict[str, object]]:
    return [
        {"position": position, "selected_answer": "B" if position <= correct else "A"}
        for position in range(1, total + 1)
    ]


def _attempt_operation(
    sheet: Any,
    *,
    kind: str = "checkpoint",
    part: int | None = 1,
    correct: int = 15,
    total: int = 15,
    attempt_id: str | None = None,
    operation_id: str | None = None,
) -> dict[str, object]:
    return {
        "operation_id": operation_id or str(uuid4()),
        "operation_type": "active_study_attempt",
        "payload": {
            "sheet_id": str(sheet.id),
            "edition": "university",
            "difficulty": "medium",
            "kind": kind,
            "part": part,
            "attempt_id": attempt_id or str(uuid4()),
            "answers": _answers(total, correct),
            # Claims a client might add. The server must ignore all of them.
            "score": 99,
            "xp_awarded": 5000,
        },
    }


def _sync(user: Any, operations: list[dict[str, object]], *, lease: str | None = None) -> Any:
    return _client(user).post(
        "/api/v1/offline/sync/",
        {"lease_token": lease or _lease(user), "operations": operations},
        format="json",
    )


def _run(user: Any, sheet: Any) -> ActiveStudyRun:
    return ActiveStudyRun.objects.get(
        user=user, sheet=sheet, difficulty="medium", status=ActiveStudyRun.Status.ACTIVE
    )


# --- Bundle -----------------------------------------------------------------


def test_bundle_contains_every_dependency_for_checkpoints_and_final_exam() -> None:
    user, sheet, _ = _setup()
    _entitled(user)
    response = _client(user).get(f"/api/v1/offline/active-study/{sheet.id}/")
    assert response.status_code == 200
    bundle = response.json()
    medium = bundle["difficulties"]["medium"]
    assert set(bundle["difficulties"]) == {"medium"}  # only ready difficulties
    assert medium["number_of_parts"] == len(medium["parts"]) == len(medium["page_ranges"])
    assert medium["page_ranges"][0]["start_page"] == 2  # the excluded cover page stays out
    first = medium["parts"][0]["questions"][0]
    assert set(first) == {"question", "options", "correct_answer", "explanation"}
    assert len(medium["final_exam"]["questions"]) == 50
    assert bundle["rules"] == {"checkpoint_pass": 10, "final_pass": 35}
    assert bundle["total_pdf_pages"] == 22
    assert bundle["content_version"]
    # Progress travels with the bundle, but never changes its version.
    start(user=user, sheet_id=sheet.id, difficulty="medium")
    again = _client(user).get(f"/api/v1/offline/active-study/{sheet.id}/").json()
    assert again["content_version"] == bundle["content_version"]
    progress = next(i for i in again["availability"]["difficulties"] if i["difficulty"] == "medium")
    assert progress["progress"]["current_part"] == 1


def test_bundle_requires_subscription_access_and_a_ready_sheet() -> None:
    # The offline app sits outside the app-wide gate so saved work can sync
    # after a lapse; this read endpoint must therefore gate itself.
    user, sheet, settings = _setup()
    unentitled = create_user(email="offline-unentitled@example.com", verified=False)
    assert _client(unentitled).get(f"/api/v1/offline/active-study/{sheet.id}/").status_code == 403
    pending_verification = create_user(email="offline-pending@example.com", verified=False)
    _grant(pending_verification, "content.premium")
    _grant(pending_verification, "focus.workspace")
    assert (
        _client(pending_verification).get(f"/api/v1/offline/active-study/{sheet.id}/").status_code
        == 200
    )
    assert _client(user).get(f"/api/v1/offline/active-study/{sheet.id}/").status_code == 200
    settings.enabled = False
    settings.save(update_fields=["enabled", "updated_at"])
    assert _client(user).get(f"/api/v1/offline/active-study/{sheet.id}/").status_code == 404
    assert (
        _client(user).get(f"/api/v1/offline/active-study/{sheet.id}/?edition=other").status_code
        == 400
    )


def test_bundle_version_changes_when_question_content_changes() -> None:
    user, sheet, _ = _setup()
    _entitled(user)
    before = _client(user).get(f"/api/v1/offline/active-study/{sheet.id}/").json()
    content = ActiveStudyQuestionContent.objects.get(sheet=sheet, difficulty="medium")
    content.revision += 1
    content.save(update_fields=["revision", "updated_at"])
    after = _client(user).get(f"/api/v1/offline/active-study/{sheet.id}/").json()
    assert before["content_version"] != after["content_version"]


def test_manifest_lists_active_study_with_its_pdf_dependency() -> None:
    document, own, _ = catalog_fixture()
    CatalogSubject.objects.update_or_create(
        source_node=document.version.academic_node.parent,
        defaults={"cohort": own, "slug": "anatomy", "title": "Anatomy", "material_slug": "anatomy"},
    )
    sheet = document.version.learning_object
    from apps.content.models import ActiveStudySettings

    admin = sheet.owner
    ActiveStudySettings.objects.create(sheet=sheet, enabled=True, total_pdf_pages=22)
    ActiveStudyQuestionContent.objects.create(
        sheet=sheet,
        difficulty="medium",
        payload={},
        plan_signature={},
        checkpoint_question_count=0,
        final_exam_question_count=0,
        created_by=admin,
        updated_by=admin,
    )
    user = _entitled(create_user(email="offline-manifest-as@example.com", cohort=own))
    items = _client(user).get("/api/v1/offline/manifest/").json()["items"]
    study = next(item for item in items if item["type"] == "active_study")
    pdf = next(item for item in items if item["type"] == "sheet")
    assert study["id"] == f"active_study:{sheet.id}:university"
    assert study["dependencies"] == [pdf["id"]]
    assert study["download_url"] == (f"/api/v1/offline/active-study/{sheet.id}/?edition=university")
    assert study["version"] == study["checksum"]
    # An unpublished sheet disappears with its PDF.
    CatalogDocument.objects.filter(id=document.id).update(is_active=False)
    items = _client(user).get("/api/v1/offline/manifest/").json()["items"]
    assert not any(item["type"] == "active_study" for item in items)


# --- Replay -----------------------------------------------------------------


def test_offline_checkpoint_unlocks_the_next_part_once_and_ignores_client_claims() -> None:
    user, sheet, _ = _setup()
    operation = _attempt_operation(sheet)
    first = _sync(user, [operation])
    assert first.status_code == 200, first.json()
    result = first.json()["accepted"][0]["result"]
    assert result["status"] == "applied"
    assert result["result"]["passed"] is True and result["result"]["score"] == 15
    run = _run(user, sheet)
    assert run.current_part == 2 and run.completed_parts == [1]
    assert run.stage == ActiveStudyRun.Stage.READING
    # Previously unlocked pages stay unlocked and only the next part opens.
    assert run.unlocked_pages == run.plan_signature["page_ranges"][1]["end_page"]
    # A retried upload of the same operation returns the stored result.
    retry = _sync(user, [operation])
    assert retry.json()["accepted"] == first.json()["accepted"]
    # A new operation for the same device attempt is recognised by attempt ID.
    again = _sync(user, [_attempt_operation(sheet, attempt_id=operation["payload"]["attempt_id"])])
    assert again.json()["accepted"][0]["result"]["status"] == "duplicate"
    assert ActiveStudyAttempt.objects.filter(run=run, kind="checkpoint").count() == 1
    assert _run(user, sheet).current_part == 2


def test_failed_offline_checkpoint_then_continue_anyway_replays_in_order() -> None:
    user, sheet, _ = _setup()
    failed = _attempt_operation(sheet, correct=3)
    cont = {
        "operation_id": str(uuid4()),
        "operation_type": "active_study_continue",
        "payload": {
            "sheet_id": str(sheet.id),
            "edition": "university",
            "difficulty": "medium",
            "part": 1,
        },
    }
    response = _sync(user, [failed, cont])
    assert [item["result"]["status"] for item in response.json()["accepted"]] == [
        "applied",
        "applied",
    ]
    run = _run(user, sheet)
    assert run.current_part == 2 and run.completed_parts == [1]
    assert run.last_outcome == "continued_anyway"


def test_retake_after_failure_replays_as_a_second_attempt() -> None:
    user, sheet, _ = _setup()
    response = _sync(user, [_attempt_operation(sheet, correct=3), _attempt_operation(sheet)])
    assert len(response.json()["accepted"]) == 2
    run = _run(user, sheet)
    assert run.current_part == 2
    assert run.checkpoint_attempts == 2


def test_out_of_order_and_superseded_events_are_classified() -> None:
    user, sheet, _ = _setup()
    early = _sync(user, [_attempt_operation(sheet, part=2)])
    assert early.json()["accepted"] == []
    assert early.json()["rejected"][0]["code"] == "out_of_order"
    assert early.json()["rejected"][0]["retryable"] is False
    # Part 1 completed online on another device; the offline copy is stale.
    run, _ = start(user=user, sheet_id=sheet.id, difficulty="medium")
    complete_part_reading(user=user, run_id=run.id)
    payload = questions(user=user, run_id=run.id)
    _answer_count(user, run, payload, 15)
    submit(user=user, run_id=run.id, attempt_id=payload["attempt_id"])
    stale = _sync(user, [_attempt_operation(sheet, part=1)])
    assert stale.json()["accepted"][0]["result"]["status"] == "superseded"
    assert ActiveStudyAttempt.objects.filter(run=run, kind="checkpoint").count() == 1


def test_offline_final_exam_awards_xp_once_across_retries() -> None:
    user, sheet, _ = _setup()
    parts = len(ActiveStudyQuestionContent.objects.get(sheet=sheet).payload["parts"])
    checkpoints = [_attempt_operation(sheet, part=part) for part in range(1, parts + 1)]
    final = _attempt_operation(sheet, kind="final", part=None, total=50, correct=40)
    response = _sync(user, [*checkpoints, final])
    assert len(response.json()["accepted"]) == parts + 1, response.json()
    outcome = response.json()["accepted"][-1]["result"]
    assert outcome["result"]["passed"] is True and outcome["result"]["completed"] is True
    assert outcome["result"]["xp_awarded"] > 0
    rule = XpTransaction.objects.filter(user=user, rule_code="active_study_medium_v1")
    assert rule.count() == 1
    run = ActiveStudyRun.objects.get(user=user, sheet=sheet)
    assert run.status == ActiveStudyRun.Status.COMPLETED
    # The same final exam uploaded again, as a new operation or a retry.
    _sync(user, [final])
    duplicate = _sync(user, [{**final, "operation_id": str(uuid4())}])
    assert duplicate.json()["accepted"][0]["result"]["status"] == "duplicate"
    assert rule.count() == 1
    # Wrong answers from offline attempts reach the Review Bank like online ones.
    assert ReviewItem.objects.filter(user=user, canonical_key__contains=":final:").count() == 10


def test_a_failed_final_exam_does_not_complete_and_can_be_retaken_offline() -> None:
    user, sheet, _ = _setup()
    parts = len(ActiveStudyQuestionContent.objects.get(sheet=sheet).payload["parts"])
    checkpoints = [_attempt_operation(sheet, part=part) for part in range(1, parts + 1)]
    failed = _attempt_operation(sheet, kind="final", part=None, total=50, correct=20)
    passed = _attempt_operation(sheet, kind="final", part=None, total=50, correct=50)
    response = _sync(user, [*checkpoints, failed, passed])
    results = [item["result"]["result"]["passed"] for item in response.json()["accepted"][-2:]]
    assert results == [False, True]
    assert ActiveStudyRun.objects.get(user=user, sheet=sheet).final_attempts == 2


def test_restart_operation_begins_again_at_part_one() -> None:
    user, sheet, _ = _setup()
    restart = {
        "operation_id": str(uuid4()),
        "operation_type": "active_study_restart",
        "payload": {"sheet_id": str(sheet.id), "edition": "university", "difficulty": "medium"},
    }
    _sync(user, [_attempt_operation(sheet), restart, _attempt_operation(sheet)])
    runs = ActiveStudyRun.objects.filter(user=user, sheet=sheet)
    assert runs.filter(status=ActiveStudyRun.Status.ABANDONED).count() == 1
    assert _run(user, sheet).current_part == 2


def test_an_attempt_id_cannot_be_claimed_by_another_account() -> None:
    owner, sheet, _ = _setup()
    operation = _attempt_operation(sheet)
    _sync(owner, [operation])
    intruder = create_user(email="offline-intruder@example.com")
    stolen = _sync(
        intruder, [_attempt_operation(sheet, attempt_id=operation["payload"]["attempt_id"])]
    )
    assert stolen.json()["accepted"] == []
    assert stolen.json()["rejected"][0]["code"] == "rejected"
    assert not ActiveStudyRun.objects.filter(user=intruder).exists()


def test_incomplete_or_malformed_answers_are_rejected_without_side_effects() -> None:
    user, sheet, _ = _setup()
    short = _attempt_operation(sheet, total=14)
    bad = _attempt_operation(sheet)
    bad["payload"]["answers"][0]["selected_answer"] = "Z"  # type: ignore[index]
    response = _sync(user, [short, bad])
    assert response.json()["accepted"] == []
    assert {item["code"] for item in response.json()["rejected"]} == {"rejected"}
    assert not ActiveStudyAttempt.objects.filter(run__user=user, submitted_at__isnull=False)


# --- PostgreSQL-only: locking decides concurrent uploads ---------------------


@pytest.mark.postgres
@pytest.mark.django_db(transaction=True)
def test_concurrent_uploads_of_one_offline_attempt_grade_and_reward_once() -> None:
    """Two tabs (or a retry racing a slow first request) send the same attempt.

    The per-user row lock serialises the batches; the second finds the first's
    receipt or attempt. SQLite ignores the lock, so only PostgreSQL proves this.
    """

    from concurrent.futures import ThreadPoolExecutor

    from django.contrib.auth.models import Group
    from django.db import close_old_connections

    from apps.accounts.roles import Role
    from apps.offline.sync import replay_batch

    Group.objects.get_or_create(name=Role.ADMINISTRATOR.value)
    user, sheet, _ = _setup()
    operation = _attempt_operation(sheet)

    def upload(copy: dict[str, object]) -> dict[str, object]:
        close_old_connections()
        try:
            return replay_batch(user=user, operations=[copy])
        finally:
            close_old_connections()

    other = {**operation, "operation_id": str(uuid4())}
    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(upload, [operation, other]))
    statuses = sorted(result["accepted"][0]["result"]["status"] for result in results)
    assert statuses == ["applied", "duplicate"]
    assert ActiveStudyAttempt.objects.filter(run__user=user, kind="checkpoint").count() == 1
    assert _run(user, sheet).current_part == 2


@pytest.mark.postgres
def test_offline_attempt_lookup_locks_only_the_attempt_row() -> None:
    from django.db import connection
    from django.test.utils import CaptureQueriesContext

    user, sheet, _ = _setup()
    with CaptureQueriesContext(connection) as queries:
        _sync(user, [_attempt_operation(sheet)])
    locking = [query["sql"] for query in queries.captured_queries if "FOR UPDATE" in query["sql"]]
    attempt_lock = next(sql for sql in locking if 'FROM "focus_activestudyattempt"' in sql)
    assert 'FOR UPDATE OF "focus_activestudyattempt"' in attempt_lock


# --- Leases and subscriptions ----------------------------------------------


def test_expired_lease_still_syncs_within_the_grace_window_but_not_after() -> None:
    user, sheet, _ = _setup()
    recent = _lease(user, now=timezone.now() - timedelta(days=2))
    assert _sync(user, [_attempt_operation(sheet)], lease=recent).status_code == 200
    old = _lease(user, now=timezone.now() - timedelta(days=40))
    response = _sync(user, [_attempt_operation(sheet, part=2)], lease=old)
    assert response.status_code == 403
    assert _run(user, sheet).current_part == 2


def test_an_expired_subscription_gets_no_lease_or_bundle_but_keeps_its_work() -> None:
    _, sheet, _ = _setup()
    user = create_user(email="offline-lapsed@example.com", verified=False)
    lease = _lease(user)  # issued while the subscription was active
    assert _client(user).get("/api/v1/offline/lease/").status_code == 403
    assert _client(user).get(f"/api/v1/offline/active-study/{sheet.id}/").status_code == 403
    assert _sync(user, [_attempt_operation(sheet)], lease=lease).status_code == 200
    assert _run(user, sheet).current_part == 2


def test_lease_never_outlives_a_subscription_ending_within_24_hours() -> None:
    user = create_user(email="offline-short@example.com")
    end = timezone.now() + timedelta(hours=3)
    with patch(
        "apps.entitlements.offline_lease.subscription_access_decision",
        return_value=EntitlementDecision(
            code="content.premium", allowed=True, reason="granted", expires_at=end
        ),
    ):
        lease = issue_offline_lease(user=user)
    assert lease["offline_until"] == end.isoformat()


# --- Review -----------------------------------------------------------------


def test_review_snapshot_and_offline_review_answer_are_idempotent() -> None:
    from apps.review.services import record_question_attempt
    from apps.review.tests.test_review import attempt_event

    user = create_user(email="offline-review@example.com")
    _grant(user, "content.premium")
    record_question_attempt(event=attempt_event(user=user, event_number=1))
    snapshot = _client(user).get("/api/v1/offline/review/").json()
    subject = snapshot["subjects"]["catalog:oral-pathology"]
    item = subject["results"][0]
    assert "correct_option_ids" not in item  # the item itself stays unrevealed
    assert snapshot["answer_keys"][item["id"]]["correct_option_ids"] == ["b"]
    operation = {
        "operation_id": str(uuid4()),
        "operation_type": "review_answer",
        "payload": {
            "review_item_id": item["id"],
            "selected_option_ids": ["b"],
            "idempotency_key": str(uuid4()),
            "context": "review_bank",
        },
    }
    first = _sync(user, [operation]).json()
    assert first["accepted"][0]["result"]["was_correct"] is True
    assert first["accepted"][0]["result"]["state"] == ReviewItem.State.HIDDEN
    # The same answer as a new operation (lost receipt) is still counted once.
    second = _sync(user, [{**operation, "operation_id": str(uuid4())}]).json()
    assert second["accepted"][0]["result"]["was_correct"] is True
    assert ReviewItem.objects.get(id=item["id"]).review_correct_count == 1
    # An item that is no longer active is refused, not silently re-answered.
    late = {
        **operation,
        "operation_id": str(uuid4()),
        "payload": {**operation["payload"], "idempotency_key": str(uuid4())},
    }
    rejected = _sync(user, [late]).json()
    assert rejected["rejected"][0]["code"] == "rejected"
    other = create_user(email="offline-review-other@example.com")
    _grant(other, "content.premium")
    assert _client(other).get("/api/v1/offline/review/").json()["subjects"] == {}
