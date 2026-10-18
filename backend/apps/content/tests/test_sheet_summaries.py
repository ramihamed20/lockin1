import pytest
from django.test import override_settings

from apps.accounts.models import User
from apps.accounts.tests.helpers import create_user
from apps.content.models import CatalogDocument, SheetSummary
from apps.education.models import StudentCohort

from .test_catalog_workspace import catalog_fixture, client_for, grant_focus

pytestmark = pytest.mark.django_db


@pytest.fixture
def sheet() -> tuple[CatalogDocument, StudentCohort]:
    document, own, _ = catalog_fixture()
    return document, own


def student(email: str, cohort: StudentCohort) -> User:
    user = create_user(email=email, cohort=cohort)
    grant_focus(user)
    return user


def collection(document: CatalogDocument) -> str:
    return f"/api/v1/catalog/documents/{document.id}/summaries"


def test_a_sheet_holds_two_summaries_each_with_a_name_and_a_mode(sheet) -> None:
    document, cohort = sheet
    client = client_for(student("summary-a@example.com", cohort))

    pen = client.post(collection(document), {"title": "  Week  1 ", "mode": "pen"}, format="json")
    assert pen.status_code == 201, pen.content
    body = pen.json()["summary"]
    assert body["title"] == "Week 1" and body["mode"] == "pen" and body["color"] == "blue"
    assert body["status"] == "writing" and body["visible"] is True
    assert body["document"]["id"] == str(document.id)

    typed = {"title": "Typed", "mode": "keyboard", "color": "green"}
    assert client.post(collection(document), typed, format="json").status_code == 201
    third = client.post(collection(document), {"title": "Third", "mode": "pen"}, format="json")
    assert third.status_code == 400 and third.json()["error"]["code"] == "sheet_summary_limit"

    listed = client.get(collection(document)).json()
    assert listed["max_per_sheet"] == 2 and len(listed["results"]) == 2
    assert len(client.get("/api/v1/catalog/summaries").json()["results"]) == 2

    for bad in (
        {"title": " ", "mode": "pen"},
        {"title": "x", "mode": "crayon"},
        {"title": "x", "mode": "pen", "color": "pink"},
    ):
        SheetSummary.objects.filter(title="x").delete()
        assert client.post(collection(document), bad, format="json").status_code == 400


def test_keyboard_pages_merge_per_page_and_settings_need_the_current_revision(sheet) -> None:
    document, cohort = sheet
    client = client_for(student("summary-b@example.com", cohort))
    created = client.post(
        collection(document), {"title": "Typed", "mode": "keyboard"}, format="json"
    ).json()["summary"]
    detail = f"/api/v1/catalog/summaries/{created['id']}"

    first = client.patch(detail, {"pages": {"3": "Cells"}}, format="json").json()["summary"]
    # A second tab writing another page merges instead of overwriting.
    second = client.patch(detail, {"pages": {"5": "Tissue"}}, format="json").json()["summary"]
    assert second["pages"] == {"3": "Cells", "5": "Tissue"}
    cleared = client.patch(detail, {"pages": {"3": "  "}}, format="json").json()["summary"]
    assert cleared["pages"] == {"5": "Tissue"}

    stale = client.patch(
        detail, {"expected_revision": first["revision"], "title": "New"}, format="json"
    )
    assert stale.status_code == 409
    renamed = client.patch(
        detail,
        {"expected_revision": cleared["revision"], "title": "New", "visible": False},
        format="json",
    ).json()["summary"]
    assert renamed["title"] == "New" and renamed["visible"] is False

    finished = client.patch(detail, {"finished": True}, format="json").json()["summary"]
    assert finished["status"] == "finished" and finished["finished_at"]

    for bad in ({"pages": {"0": "x"}}, {"pages": {"03": "x"}}, {"pages": {"2": "x" * 5001}}):
        assert client.patch(detail, bad, format="json").status_code == 400


def test_pen_summaries_have_no_typed_pages_and_only_the_owner_can_reach_them(sheet) -> None:
    document, cohort = sheet
    owner = client_for(student("summary-owner@example.com", cohort))
    created = owner.post(collection(document), {"title": "Ink", "mode": "pen"}, format="json")
    detail = f"/api/v1/catalog/summaries/{created.json()['summary']['id']}"
    assert owner.patch(detail, {"pages": {"1": "x"}}, format="json").status_code == 400

    stranger = client_for(student("summary-stranger@example.com", cohort))
    assert stranger.patch(detail, {"title": "Mine"}, format="json").status_code == 404
    assert stranger.delete(detail).status_code == 404
    assert stranger.get("/api/v1/catalog/summaries").json()["results"] == []

    assert owner.delete(detail).status_code == 204
    assert not SheetSummary.objects.exists()


@override_settings(COHORT_CONTENT_ENFORCEMENT=True)
def test_a_student_outside_the_sheet_cannot_start_a_summary(sheet) -> None:
    document, _ = sheet
    _, _, other = catalog_fixture_other()
    outsider = client_for(student("summary-outsider@example.com", other))
    response = outsider.post(collection(document), {"title": "x", "mode": "pen"}, format="json")
    assert response.status_code in (403, 404)


def catalog_fixture_other() -> tuple[None, None, StudentCohort]:
    return None, None, StudentCohort.objects.get(code="other")
