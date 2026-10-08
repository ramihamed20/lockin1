import pytest
from rest_framework.test import APIClient

from apps.accounts.tests.helpers import create_user

from ..models import FeedbackSuggestion

pytestmark = pytest.mark.django_db


def client_for(user):
    client = APIClient()
    client.force_authenticate(user)
    return client


def test_student_submits_and_lists_own_suggestions() -> None:
    student = create_user(with_trial=True)
    other = create_user(email="other@example.com", with_trial=True)
    FeedbackSuggestion.objects.create(user=other, message="Someone else's idea")
    client = client_for(student)

    created = client.post(
        "/api/v1/feedback",
        {"category": "feature", "message": "Add flashcards for anatomy"},
        format="json",
    )
    assert created.status_code == 201
    assert created.json()["status"] == "new"

    listed = client.get("/api/v1/feedback").json()["results"]
    assert [item["message"] for item in listed] == ["Add flashcards for anatomy"]


def test_short_message_is_rejected() -> None:
    client = client_for(create_user(with_trial=True))
    assert client.post("/api/v1/feedback", {"message": "hi"}, format="json").status_code == 400


def test_submissions_are_rate_limited() -> None:
    client = client_for(create_user(with_trial=True))
    codes = [
        client.post("/api/v1/feedback", {"message": f"Idea number {i}"}, format="json").status_code
        for i in range(7)
    ]
    assert codes[:5] == [201] * 5
    assert 429 in codes[5:]


def test_students_cannot_open_the_admin_inbox() -> None:
    client = client_for(create_user(with_trial=True))
    assert client.get("/api/v1/operations/admin/feedback").status_code == 403


def test_admin_reads_inbox_and_updates_status() -> None:
    student = create_user(with_trial=True)
    item = FeedbackSuggestion.objects.create(user=student, message="Dark mode please")
    admin = create_user(email="owner@example.com", is_superuser=True, is_staff=True)
    client = client_for(admin)

    listed = client.get("/api/v1/operations/admin/feedback").json()
    assert listed["results"][0]["user"]["email"] == student.email

    updated = client.patch(
        f"/api/v1/operations/admin/feedback/{item.id}",
        {"status": "planned", "admin_note": "Next sprint"},
        format="json",
    )
    assert updated.status_code == 200
    item.refresh_from_db()
    assert item.status == "planned"
    assert item.admin_note == "Next sprint"
