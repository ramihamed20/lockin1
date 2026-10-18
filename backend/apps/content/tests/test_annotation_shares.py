import json
from typing import Any

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.accounts.tests.helpers import create_user
from apps.content.models import (
    CatalogDocument,
    CatalogSubject,
    PersonalSheet,
    SharedAnnotationSet,
)
from apps.education.models import StudentCohort
from apps.education.tests.helpers import create_admin
from apps.files.models import ManagedFile

from .test_catalog_workspace import catalog_fixture, client_for, grant_focus

pytestmark = pytest.mark.django_db

PIXEL = "data:image/png;base64,iVBORw0KGgo="


def snapshot(**extra: Any) -> dict[str, Any]:
    return {
        "annotations": [
            {"id": "a-1", "type": "pen", "page": 1, "color": "#111111", "points": []},
            {"id": "a-2", "type": "text", "page": 2, "text": "hi", "x": 1, "y": 1},
            {"id": "a-3", "type": "image", "page": 2, "src": PIXEL, "x": 1, "y": 1},
            {"id": "a-4", "type": "card", "page": -7, "cardKind": "sticky", "text": "s"},
        ],
        "notes": [{"id": "n-1", "page": 1, "text": "note"}],
        "virtualPages": [{"id": -7, "afterPage": 2, "background": "lined"}],
        **extra,
    }


def upload(raw: Any) -> SimpleUploadedFile:
    return SimpleUploadedFile(
        "marks.json", json.dumps(raw).encode(), content_type="application/json"
    )


@pytest.fixture
def sheet() -> tuple[CatalogDocument, StudentCohort]:
    document, own, _ = catalog_fixture()
    CatalogSubject.objects.create(
        cohort=own, title="Anatomy", slug="anatomy", material_slug="anatomy"
    )
    return document, own


def student(email: str, cohort: StudentCohort) -> User:
    user = create_user(email=email, cohort=cohort)
    grant_focus(user)
    return user


def base(document: CatalogDocument) -> str:
    return f"/api/v1/catalog/documents/{document.id}/annotation-shares"


def publish(client: APIClient, document: CatalogDocument, raw: Any = None, **fields: Any):
    body = {"display_name": "Sara", "snapshot": upload(raw or snapshot()), **fields}
    return client.post(base(document), body, format="multipart")


@override_settings(COHORT_CONTENT_ENFORCEMENT=True)
def test_publish_lists_updates_in_place_and_hides_snapshot(sheet) -> None:
    document, cohort = sheet
    owner = student("share-owner@example.com", cohort)
    reader = student("share-reader@example.com", cohort)

    created = publish(client_for(owner), document, note="  Good luck  ")
    assert created.status_code == 201, created.content
    assert created.json()["marks"] == 5
    assert created.json()["pages"] == 3  # pages 1 and 2 plus the added page

    # Publishing again replaces the one share and bumps its version.
    again = publish(client_for(owner), document, raw=snapshot(), note="  Good luck  ")
    assert again.status_code == 200
    assert again.json()["version"] == 2
    assert SharedAnnotationSet.objects.filter(owner=owner).count() == 1

    listed = client_for(reader).get(base(document)).json()
    assert len(listed["results"]) == 1
    item = listed["results"][0]
    assert item["author"] == "Sara"
    assert item["note"] == "Good luck"
    assert item["mine"] is False
    assert "snapshot" not in item
    assert listed["mine_id"] is None
    assert client_for(owner).get(base(document)).json()["mine_id"] == item["id"]


@override_settings(COHORT_CONTENT_ENFORCEMENT=True)
def test_anonymous_share_hides_the_name_from_students_but_not_moderators(sheet) -> None:
    document, cohort = sheet
    owner = student("anon-owner@example.com", cohort)
    reader = student("anon-reader@example.com", cohort)
    admin = create_admin(email="anon-admin@example.com")
    grant_focus(admin)
    admin.cohort = cohort
    admin.save()

    assert (
        publish(client_for(owner), document, anonymous=True, display_name="Secret").status_code
        == 201
    )

    student_view = client_for(reader).get(base(document)).json()["results"][0]
    assert student_view["author"] == ""
    assert student_view["anonymous"] is True
    assert "owner_email" not in student_view
    admin_view = client_for(admin).get(base(document)).json()
    assert admin_view["moderator"] is True
    assert admin_view["results"][0]["owner_email"] == "anon-owner@example.com"


@override_settings(COHORT_CONTENT_ENFORCEMENT=True)
def test_publish_rejects_empty_oversized_and_unnamed_uploads(sheet) -> None:
    document, cohort = sheet
    owner = student("reject-owner@example.com", cohort)
    client = client_for(owner)

    empty = publish(client, document, raw={"annotations": [], "notes": [], "virtualPages": []})
    assert empty.status_code == 400
    assert empty.json()["error"]["code"] == "annotation_share_empty"

    unnamed = publish(client, document, display_name="  ")
    assert unnamed.status_code == 400

    with override_settings(ANNOTATION_SHARE_MAX_BYTES=100):
        large = publish(client, document)
    assert large.status_code == 400
    assert large.json()["error"]["code"] == "annotation_share_too_large"

    garbage = client.post(
        base(document),
        {"display_name": "Sara", "snapshot": SimpleUploadedFile("m.json", b"not json")},
        format="multipart",
    )
    assert garbage.status_code == 400


@override_settings(COHORT_CONTENT_ENFORCEMENT=True)
def test_snapshot_drops_unsafe_or_unknown_marks(sheet) -> None:
    document, cohort = sheet
    owner = student("clean-owner@example.com", cohort)
    raw = snapshot()
    raw["annotations"] += [
        {"id": "x-1", "type": "image", "page": 1, "src": "data:image/svg+xml;base64,AAAA"},
        {"id": "x-2", "type": "script", "page": 1},
        {"id": "x-3", "type": "pen", "page": 99_999},
        {"id": "x-4", "type": "pen", "page": -99},
    ]
    assert publish(client_for(owner), document, raw=raw).status_code == 201
    stored = SharedAnnotationSet.objects.get(owner=owner).snapshot
    assert {item["id"] for item in stored["annotations"]} == {"a-1", "a-2", "a-3", "a-4"}


def test_only_students_with_the_sheet_can_see_or_publish(sheet) -> None:
    document, cohort = sheet
    outsider_cohort = StudentCohort.objects.create(
        program=cohort.program, code="outsider", name_en="Out", name_ar="Out"
    )
    outsider = student("outsider@example.com", outsider_cohort)
    with override_settings(COHORT_CONTENT_ENFORCEMENT=True):
        assert client_for(outsider).get(base(document)).status_code == 403
        assert publish(client_for(outsider), document).status_code == 403


@override_settings(COHORT_CONTENT_ENFORCEMENT=True)
def test_likes_are_counted_once_per_student_and_order_the_list(sheet) -> None:
    document, cohort = sheet
    first = student("like-first@example.com", cohort)
    second = student("like-second@example.com", cohort)
    fan = student("like-fan@example.com", cohort)
    publish(client_for(first), document, display_name="First")
    publish(client_for(second), document, display_name="Second")
    second_id = SharedAnnotationSet.objects.get(owner=second).id

    like = f"{base(document)}/{second_id}/like"
    assert client_for(fan).put(like).json() == {"liked": True, "likes": 1}
    assert client_for(fan).put(like).json() == {"liked": True, "likes": 1}
    listed = client_for(fan).get(base(document)).json()["results"]
    assert [item["author"] for item in listed] == ["Second", "First"]
    assert listed[0]["liked"] is True
    assert client_for(fan).delete(like).json() == {"liked": False, "likes": 0}
    assert client_for(fan).delete(like).json() == {"liked": False, "likes": 0}


@override_settings(COHORT_CONTENT_ENFORCEMENT=True)
def test_reports_count_once_and_cannot_target_your_own_marks(sheet) -> None:
    document, cohort = sheet
    owner = student("report-owner@example.com", cohort)
    reader = student("report-reader@example.com", cohort)
    publish(client_for(owner), document)
    share_id = SharedAnnotationSet.objects.get(owner=owner).id
    url = f"{base(document)}/{share_id}/report"

    assert client_for(owner).post(url, {"reason": "x"}, format="json").status_code == 400
    assert client_for(reader).post(url, {"reason": "spam"}, format="json").status_code == 201
    assert client_for(reader).post(url, {"reason": "spam"}, format="json").status_code == 201
    assert SharedAnnotationSet.objects.get(id=share_id).report_count == 1


@override_settings(COHORT_CONTENT_ENFORCEMENT=True)
def test_import_copies_chosen_pages_into_a_private_sheet_with_fresh_ids(sheet) -> None:
    document, cohort = sheet
    owner = student("import-owner@example.com", cohort)
    reader = student("import-reader@example.com", cohort)
    publish(client_for(owner), document, note="n")
    share = SharedAnnotationSet.objects.get(owner=owner)
    file_id = document.managed_file_id

    response = client_for(reader).post(
        f"{base(document)}/{share.id}/import", {"pages": [2]}, format="json"
    )

    assert response.status_code == 201, response.content
    copy = PersonalSheet.objects.get(owner=reader)
    assert copy.managed_file_id == file_id
    assert copy.source_document_id == document.id
    assert copy.copy_author == "Sara"
    assert copy.title.endswith("- Sara")
    seed = copy.seed
    assert {item["page"] for item in seed["annotations"]} == {2}
    assert seed["notes"] == []
    assert seed["virtualPages"] == []
    assert not {item["id"] for item in seed["annotations"]} & {"a-1", "a-2", "a-3", "a-4"}

    # Everything is copied when no pages are named, added pages included.
    everything = client_for(reader).post(f"{base(document)}/{share.id}/import", {}, format="json")
    assert everything.status_code == 201
    second_copy = PersonalSheet.objects.get(id=everything.json()["sheet_id"])
    assert len(second_copy.seed["annotations"]) == 4
    assert second_copy.seed["virtualPages"][0]["id"] == -7
    assert second_copy.title != copy.title  # titles stay unique


@override_settings(COHORT_CONTENT_ENFORCEMENT=True)
def test_copy_limit_and_deleting_a_copy_keeps_the_catalog_file(sheet) -> None:
    document, cohort = sheet
    owner = student("limit-owner@example.com", cohort)
    reader = student("limit-reader@example.com", cohort)
    publish(client_for(owner), document)
    share = SharedAnnotationSet.objects.get(owner=owner)
    url = f"{base(document)}/{share.id}/import"

    with override_settings(ANNOTATION_COPIES_MAX_PER_ACCOUNT=1):
        assert client_for(reader).post(url, {}, format="json").status_code == 201
        blocked = client_for(reader).post(url, {}, format="json")
    assert blocked.status_code == 400
    assert blocked.json()["error"]["code"] == "annotation_copy_limit_reached"

    copy = PersonalSheet.objects.get(owner=reader)
    deleted = client_for(reader).post(
        "/api/v1/personal-sheets/delete", {"ids": [str(copy.id)]}, format="json"
    )
    assert deleted.status_code == 200
    assert not PersonalSheet.objects.filter(owner=reader).exists()
    assert ManagedFile.objects.filter(id=document.managed_file_id).exists()


@override_settings(COHORT_CONTENT_ENFORCEMENT=True)
def test_copies_stay_out_of_my_sheets_and_the_uploaded_sheet_allowance(sheet) -> None:
    document, cohort = sheet
    owner = student("allow-owner@example.com", cohort)
    reader = student("allow-reader@example.com", cohort)
    publish(client_for(owner), document)
    share = SharedAnnotationSet.objects.get(owner=owner)
    client_for(reader).post(f"{base(document)}/{share.id}/import", {}, format="json")

    listing = client_for(reader).get("/api/v1/catalog/materials/anatomy/personal-sheets").json()
    assert listing["limits"]["used"] == 0
    # A copy lives inside the sheet it marks, not in My sheets.
    assert listing["results"] == []
    copies = client_for(reader).get(f"/api/v1/catalog/documents/{document.id}/annotation-copies")
    assert [item["author"] for item in copies.json()["results"]] == ["Sara"]
    assert client_for(owner).get(
        f"/api/v1/catalog/documents/{document.id}/annotation-copies"
    ).json() == {"results": []}


@override_settings(COHORT_CONTENT_ENFORCEMENT=True)
def test_updates_and_removals_reach_the_students_who_copied(sheet) -> None:
    document, cohort = sheet
    owner = student("notice-owner@example.com", cohort)
    reader = student("notice-reader@example.com", cohort)
    publish(client_for(owner), document)
    share = SharedAnnotationSet.objects.get(owner=owner)
    notices = f"{base(document)}/notices"
    client_for(reader).post(f"{base(document)}/{share.id}/import", {}, format="json")
    assert client_for(reader).get(notices).json()["results"] == []

    publish(client_for(owner), document)
    update = client_for(reader).get(notices).json()["results"]
    assert [(item["kind"], item["version"]) for item in update] == [("updated", 2)]
    client_for(reader).post(f"{base(document)}/{share.id}/dismiss")
    assert client_for(reader).get(notices).json()["results"] == []

    removed = client_for(owner).delete(f"{base(document)}/{share.id}")
    assert removed.status_code == 204
    gone = client_for(reader).get(notices).json()["results"]
    assert [item["kind"] for item in gone] == ["removed"]
    assert client_for(reader).get(base(document)).json()["results"] == []
    # The copy stays with the student who made it.
    assert PersonalSheet.objects.filter(owner=reader).exists()
    client_for(reader).post(f"{base(document)}/{share.id}/dismiss")
    assert client_for(reader).get(notices).json()["results"] == []
    assert (
        client_for(reader)
        .post(f"{base(document)}/{share.id}/import", {}, format="json")
        .status_code
        == 404
    )


@override_settings(COHORT_CONTENT_ENFORCEMENT=True)
def test_only_the_owner_or_a_moderator_can_remove_a_share(sheet) -> None:
    document, cohort = sheet
    owner = student("remove-owner@example.com", cohort)
    reader = student("remove-reader@example.com", cohort)
    admin = create_admin(email="remove-admin@example.com")
    grant_focus(admin)
    publish(client_for(owner), document)
    share = SharedAnnotationSet.objects.get(owner=owner)
    url = f"{base(document)}/{share.id}"

    assert client_for(reader).delete(url).status_code == 403
    assert client_for(admin).delete(url).status_code == 204
    share.refresh_from_db()
    assert share.deleted_at is not None
    assert share.snapshot == {}
    # The owner can publish again after a removal.
    assert publish(client_for(owner), document).status_code == 201


@override_settings(COHORT_CONTENT_ENFORCEMENT=True)
def test_a_copy_reports_its_seed_until_the_reader_stores_it(sheet) -> None:
    document, cohort = sheet
    owner = student("seed-owner@example.com", cohort)
    reader = student("seed-reader@example.com", cohort)
    publish(client_for(owner), document)
    share = SharedAnnotationSet.objects.get(owner=owner)
    created = client_for(reader).post(f"{base(document)}/{share.id}/import", {}, format="json")
    sheet_id = created.json()["sheet_id"]

    detail = client_for(reader).get(f"/api/v1/personal-sheets/{sheet_id}").json()
    assert len(detail["sheet"]["seed"]["annotations"]) == 4
    assert client_for(owner).get(f"/api/v1/personal-sheets/{sheet_id}").status_code == 404
    assert client_for(reader).post(f"/api/v1/personal-sheets/{sheet_id}/seeded").status_code == 200
    assert (
        client_for(reader).get(f"/api/v1/personal-sheets/{sheet_id}").json()["sheet"]["seed"]
        is None
    )
    # The copy's file stays readable by its owner.
    from apps.content.policies import can_access_managed_file

    assert can_access_managed_file(user=reader, managed_file=document.managed_file, download=False)
