"""Zawiya Dentistry Year 2 end to end, and answering a question exactly once.

The fixture uses the seeded education tree rather than a synthetic one, so these
tests fail if the real Zawiya Year 2 branch ever stops reaching its students.
"""

from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier
from unittest.mock import patch
from uuid import uuid4

import pytest
from django.db import close_old_connections
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.accounts.tests.helpers import create_user
from apps.content.models import CatalogSubject, LearningObject
from apps.education.models import StudentCohort
from apps.education.tests.helpers import create_admin
from apps.entitlements.models import EntitlementDefinition, EntitlementGrant
from apps.questions.admin_services import import_questions
from apps.questions.answering import answer_question
from apps.questions.models import Question, QuestionAnswer
from apps.xp.models import XpBalance, XpTransaction

from .helpers import published_pdf
from .test_catalog_questions import _year_fixture

pytestmark = pytest.mark.django_db

SECOND_YEAR_SLUGS = [
    "conservative",
    "microbiology",
    "pharmacy",
    "general-pathology",
    "oral-histology",
    "fixed-prosthodontic",
    "removable-prosthodontic",
]


def _student(email: str, cohort: StudentCohort) -> User:
    student = create_user(email=email, cohort=cohort)
    EntitlementGrant.objects.create(
        user=student,
        entitlement=EntitlementDefinition.objects.get(code="content.premium"),
        source_type=EntitlementGrant.SourceType.MANUAL,
        source_id=uuid4(),
        starts_at=timezone.now() - timedelta(minutes=1),
    )
    return student


def _client(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user)
    return client


def _question(prompt: str, difficulty: str) -> dict[str, object]:
    return {
        "type": "mcq",
        "question": prompt,
        "choices": ["Basal", "Spinous", "Granular", "Cornified"],
        "correct_answer": "Basal",
        "explanation": f"Explained: {prompt}",
        "difficulty": difficulty,
    }


def _sheet(admin: User, program: str, title: str, prompts: list[tuple[str, str]]) -> LearningObject:
    subject = CatalogSubject.objects.get(material_slug=f"{program}-year-2-conservative")
    assert subject.source_node is not None
    sheet = published_pdf(actor=admin, node=subject.source_node, title=title)
    import_questions(
        actor=admin,
        sheet=sheet,
        payload={
            "version": "lockin_questions_v1",
            "questions": [_question(prompt, level) for prompt, level in prompts],
        },
        publish=True,
    )
    return sheet


def _cohort(program: str) -> StudentCohort:
    return StudentCohort.objects.get(program__code=program, code="year-2")


def _fixture() -> dict[str, object]:
    admin = create_admin(email="zawiya-questions-admin@example.com")
    zawiya = _sheet(
        admin,
        "dentistry-zawiya",
        "Zawiya Conservative Sheet 1",
        [("Zawiya easy", "easy"), ("Zawiya medium", "medium"), ("Zawiya hard", "hard")],
    )
    tripoli = _sheet(
        admin, "dentistry-tripoli", "Tripoli Conservative Sheet 1", [("Tripoli", "easy")]
    )
    return {
        "admin": admin,
        "zawiya_sheet": zawiya,
        "tripoli_sheet": tripoli,
        "zawiya_student": _student("zawiya-y2@example.com", _cohort("dentistry-zawiya")),
        "tripoli_student": _student("tripoli-y2@example.com", _cohort("dentistry-tripoli")),
    }


def _answer(client: APIClient, sheet: LearningObject, question: dict, choice: str):  # type: ignore[no-untyped-def,type-arg]
    choice_id = next(item["id"] for item in question["choices"] if item["text"] == choice)
    return client.post(
        f"/api/v1/catalog/sheets/{sheet.id}/questions/{question['id']}/answer",
        {"choice_ids": [choice_id]},
        format="json",
    )


@override_settings(COHORT_CONTENT_ENFORCEMENT=True)
def test_zawiya_second_year_materials_list_exactly_its_own_subjects() -> None:
    student = _student("zawiya-materials@example.com", _cohort("dentistry-zawiya"))

    response = _client(student).get("/api/v1/catalog/materials")

    assert response.status_code == 200
    assert [item["slug"] for item in response.json()["results"]] == [
        f"dentistry-zawiya-year-2-{slug}" for slug in SECOND_YEAR_SLUGS
    ]


@override_settings(COHORT_CONTENT_ENFORCEMENT=True)
def test_zawiya_second_year_questions_are_scoped_to_zawiya() -> None:
    fixture = _fixture()
    zawiya_sheet, tripoli_sheet = fixture["zawiya_sheet"], fixture["tripoli_sheet"]
    zawiya, tripoli = fixture["zawiya_student"], fixture["tripoli_student"]
    assert isinstance(zawiya_sheet, LearningObject) and isinstance(tripoli_sheet, LearningObject)
    assert isinstance(zawiya, User) and isinstance(tripoli, User)

    directory = _client(zawiya).get("/api/v1/catalog/questions").json()["results"]
    assert [item["slug"] for item in directory] == ["dentistry-zawiya-year-2-conservative"]
    assert [sheet["title"] for sheet in directory[0]["sheets"]] == ["Zawiya Conservative Sheet 1"]
    assert directory[0]["sheets"][0]["questionCount"] == 3

    listing = _client(zawiya).get(f"/api/v1/catalog/sheets/{zawiya_sheet.id}/questions")
    assert listing.status_code == 200
    questions = listing.json()["results"]
    assert sorted(item["prompt"] for item in questions) == [
        "Zawiya easy",
        "Zawiya hard",
        "Zawiya medium",
    ]
    # Nothing that grades the answer leaves the server before it is answered.
    assert all(item["answer"] is None for item in questions)
    assert all("is_correct" not in choice for item in questions for choice in item["choices"])
    assert all("explanation" not in item for item in questions)

    # Neither college can reach the other's sheet, by listing or by answering.
    assert (
        _client(zawiya).get(f"/api/v1/catalog/sheets/{tripoli_sheet.id}/questions").status_code
        == 403
    )
    assert (
        _client(tripoli).get(f"/api/v1/catalog/sheets/{zawiya_sheet.id}/questions").status_code
        == 403
    )
    assert _answer(_client(tripoli), zawiya_sheet, questions[0], "Basal").status_code == 403
    tripoli_directory = _client(tripoli).get("/api/v1/catalog/questions").json()["results"]
    assert [sheet["title"] for sheet in tripoli_directory[0]["sheets"]] == [
        "Tripoli Conservative Sheet 1"
    ]


def _questions(client: APIClient, sheet: LearningObject) -> dict[str, dict]:  # type: ignore[type-arg]
    listed = client.get(f"/api/v1/catalog/sheets/{sheet.id}/questions").json()["results"]
    return {item["difficulty"]: item for item in listed}


@override_settings(COHORT_CONTENT_ENFORCEMENT=True)
@pytest.mark.parametrize(("difficulty", "points"), [("easy", 5), ("medium", 10), ("hard", 15)])
def test_a_correct_answer_earns_its_difficulty_xp_exactly_once(
    difficulty: str, points: int
) -> None:
    fixture = _fixture()
    sheet, student = fixture["zawiya_sheet"], fixture["zawiya_student"]
    assert isinstance(sheet, LearningObject) and isinstance(student, User)
    client = _client(student)
    question = _questions(client, sheet)[difficulty]

    first = _answer(client, sheet, question, "Basal")
    assert first.status_code == 201
    body = first.json()
    assert body["created"] is True
    assert body["answer"]["is_correct"] is True
    assert body["answer"]["xp_awarded"] == points
    assert body["answer"]["explanation"] == f"Explained: Zawiya {difficulty}"
    assert body["xp_total"] == points

    # Double taps and retries, with the same or another choice, read the
    # recorded answer back and award nothing more.
    for choice in ("Basal", "Basal", "Granular"):
        again = _answer(client, sheet, question, choice)
        assert again.status_code == 200
        assert again.json()["created"] is False
        assert again.json()["answer"]["xp_awarded"] == points
        assert again.json()["xp_total"] == points

    assert QuestionAnswer.objects.filter(user=student).count() == 1
    assert XpTransaction.objects.filter(user=student).count() == 1
    assert XpBalance.objects.get(user=student).total_points == points


@override_settings(COHORT_CONTENT_ENFORCEMENT=True)
def test_a_wrong_answer_earns_nothing_and_stays_locked() -> None:
    fixture = _fixture()
    sheet, student = fixture["zawiya_sheet"], fixture["zawiya_student"]
    assert isinstance(sheet, LearningObject) and isinstance(student, User)
    client = _client(student)
    hard = _questions(client, sheet)["hard"]
    basal = next(item["id"] for item in hard["choices"] if item["text"] == "Basal")

    wrong = _answer(client, sheet, hard, "Spinous")
    assert wrong.status_code == 201
    body = wrong.json()
    assert body["answer"]["is_correct"] is False
    assert body["answer"]["correct_choice_ids"] == [basal]
    assert body["answer"]["explanation"] == "Explained: Zawiya hard"
    assert body["answer"]["xp_awarded"] == 0
    assert body["xp_total"] == 0

    # Submitting the right answer afterwards cannot convert it into XP.
    retry = _answer(client, sheet, hard, "Basal")
    assert retry.status_code == 200
    assert retry.json()["created"] is False
    assert retry.json()["answer"]["is_correct"] is False
    assert retry.json()["answer"]["xp_awarded"] == 0

    assert QuestionAnswer.objects.get(user=student).is_correct is False
    assert not XpTransaction.objects.filter(user=student).exists()
    reopened = client.get(f"/api/v1/catalog/sheets/{sheet.id}/questions").json()
    assert reopened["answered"] == 1
    answered = next(item for item in reopened["results"] if item["answer"])
    assert answered["answer"] == body["answer"]


@override_settings(COHORT_CONTENT_ENFORCEMENT=True)
def test_an_answer_the_question_does_not_offer_is_rejected_without_xp() -> None:
    fixture = _fixture()
    sheet, student = fixture["zawiya_sheet"], fixture["zawiya_student"]
    assert isinstance(sheet, LearningObject) and isinstance(student, User)
    client = _client(student)
    listed = client.get(f"/api/v1/catalog/sheets/{sheet.id}/questions").json()["results"]
    question = next(item for item in listed if item["difficulty"] == "easy")
    url = f"/api/v1/catalog/sheets/{sheet.id}/questions/{question['id']}/answer"

    for payload in ({}, {"choice_ids": []}, {"choice_ids": [str(uuid4())]}, {"choice_ids": ["x"]}):
        assert client.post(url, payload, format="json").status_code == 400
    two = [choice["id"] for choice in question["choices"][:2]]
    assert client.post(url, {"choice_ids": two}, format="json").status_code == 400
    # The client cannot name its own reward.
    assert (
        client.post(
            url, {"choice_ids": two[:1], "xp": 1000, "is_correct": True}, format="json"
        ).json()["answer"]["xp_awarded"]
        == 5
    )
    assert XpBalance.objects.get(user=student).total_points == 5


@override_settings(COHORT_CONTENT_ENFORCEMENT=True)
def test_a_draft_question_cannot_be_listed_or_answered() -> None:
    fixture = _fixture()
    admin, student = fixture["admin"], fixture["zawiya_student"]
    assert isinstance(admin, User) and isinstance(student, User)
    subject = CatalogSubject.objects.get(material_slug="dentistry-zawiya-year-2-microbiology")
    assert subject.source_node is not None
    draft_sheet = published_pdf(actor=admin, node=subject.source_node, title="Draft only sheet")
    import_questions(
        actor=admin,
        sheet=draft_sheet,
        payload={"version": "lockin_questions_v1", "questions": [_question("Draft", "easy")]},
        publish=False,
    )
    draft = Question.objects.get(current_version__prompt="Draft")

    directory = _client(student).get("/api/v1/catalog/questions").json()["results"]
    assert "dentistry-zawiya-year-2-microbiology" not in [item["slug"] for item in directory]
    assert (
        _client(student).get(f"/api/v1/catalog/sheets/{draft_sheet.id}/questions").json()["count"]
        == 0
    )
    response = _client(student).post(
        f"/api/v1/catalog/sheets/{draft_sheet.id}/questions/{draft.id}/answer",
        {"choice_ids": [str(uuid4())]},
        format="json",
    )
    assert response.status_code == 404
    assert not XpTransaction.objects.filter(user=student).exists()


@override_settings(COHORT_CONTENT_ENFORCEMENT=True)
def test_a_submission_that_loses_the_race_returns_the_recorded_answer() -> None:
    """The window between the "already answered?" read and the insert.

    A second request that passes the read before the first commits must fall
    back on the unique constraint, not grade again or award again.
    """

    fixture = _fixture()
    sheet, student = fixture["zawiya_sheet"], fixture["zawiya_student"]
    assert isinstance(sheet, LearningObject) and isinstance(student, User)
    question_id = _questions(_client(student), sheet)["medium"]["id"]
    question = Question.objects.get(id=question_id)
    version = question.published_version
    assert version is not None
    correct = [option.id for option in version.options.all() if option.is_correct]
    wrong = [option.id for option in version.options.all() if not option.is_correct][:1]

    first, created = answer_question(user=student, question=question, choice_ids=correct)
    assert created is True and first.xp_awarded == 10

    class _Unseen:
        def first(self) -> None:
            return None

    with patch.object(QuestionAnswer.objects, "filter", return_value=_Unseen()):
        second, created_again = answer_question(user=student, question=question, choice_ids=wrong)

    assert created_again is False
    assert second.id == first.id
    assert second.is_correct is True
    assert QuestionAnswer.objects.filter(user=student).count() == 1
    assert XpTransaction.objects.filter(user=student).count() == 1
    assert XpBalance.objects.get(user=student).total_points == 10


@pytest.mark.postgres
@pytest.mark.django_db(transaction=True)
@override_settings(COHORT_CONTENT_ENFORCEMENT=True)
def test_concurrent_submissions_record_one_answer_and_one_award() -> None:
    """Real concurrent requests against PostgreSQL's unique index."""

    fixture = _year_fixture()
    years = fixture["years"]
    assert isinstance(years, dict)
    sheet, student = years["year-1"]["sheet"], years["year-1"]["student"]
    assert isinstance(sheet, LearningObject) and isinstance(student, User)
    question = (
        _client(student).get(f"/api/v1/catalog/sheets/{sheet.id}/questions").json()["results"][0]
    )
    url = f"/api/v1/catalog/sheets/{sheet.id}/questions/{question['id']}/answer"
    choices = [choice["id"] for choice in question["choices"]]
    barrier = Barrier(4)

    def submit(choice_id: str) -> int:
        close_old_connections()
        try:
            client = _client(student)
            barrier.wait(timeout=10)
            return client.post(url, {"choice_ids": [choice_id]}, format="json").status_code
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=4) as pool:
        statuses = list(pool.map(submit, [choices[0], choices[0], choices[1], choices[0]]))

    assert sorted(statuses) == [200, 200, 200, 201]
    answer = QuestionAnswer.objects.get(user=student)
    awards = XpTransaction.objects.filter(user=student)
    expected = 5 if answer.is_correct else 0
    assert answer.xp_awarded == expected
    assert awards.count() == (1 if answer.is_correct else 0)
    balance = XpBalance.objects.filter(user=student).first()
    assert (balance.total_points if balance else 0) == expected
