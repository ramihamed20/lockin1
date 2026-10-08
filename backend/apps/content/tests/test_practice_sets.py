import io
import struct
import zipfile
import zlib
from typing import Any

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.accounts.tests.helpers import create_user
from apps.content.models import CatalogSubject, PracticeSet, PracticeSlide, PracticeSlideProgress
from apps.content.practice_sets import is_correct, is_near_miss, normalize_answer
from apps.education.models import AcademicProgram, StudentCohort
from apps.education.tests.helpers import create_admin
from apps.files.models import ManagedFile
from apps.xp.models import XpTransaction

pytestmark = pytest.mark.django_db


def png(name: str = "slide.png", shade: int = 0) -> SimpleUploadedFile:
    def chunk(kind: bytes, data: bytes) -> bytes:
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    header = struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)
    pixels = zlib.compress(b"\x00" + bytes([shade, shade, shade]))
    content = (
        b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", pixels) + chunk(b"IEND", b"")
    )
    return SimpleUploadedFile(name, content, content_type="image/png")


def client_for(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user)
    return client


@pytest.fixture
def subjects() -> tuple[CatalogSubject, CatalogSubject]:
    program = AcademicProgram.objects.create(
        code="practice-program", name_en="Dentistry", name_ar="Dentistry"
    )
    own = StudentCohort.objects.create(
        program=program, code="practice-own", name_en="Year 2", name_ar="Year 2"
    )
    other = StudentCohort.objects.create(
        program=program, code="practice-other", name_en="Year 4", name_ar="Year 4"
    )
    anatomy = CatalogSubject.objects.create(
        cohort=own, title="Anatomy", slug="anatomy", material_slug="year-2-anatomy"
    )
    surgery = CatalogSubject.objects.create(
        cohort=other, title="Surgery", slug="surgery", material_slug="year-4-surgery"
    )
    return anatomy, surgery


@pytest.fixture
def admin() -> APIClient:
    return client_for(create_admin(email="practice-admin@example.com"))


def admin_url(path: str) -> str:
    return f"/api/v1/operations/admin/content/{path}"


def build_set(
    admin: APIClient,
    subject: CatalogSubject,
    title: str = "Skull bones",
    answers=("Femur", "Tibia"),
) -> dict[str, Any]:
    created = admin.post(
        admin_url(f"subjects/{subject.id}/practice"), {"title": title}, format="json"
    )
    assert created.status_code == 201, created.content
    set_id = created.json()["set"]["id"]
    uploaded = admin.post(
        admin_url(f"practice/{set_id}/slides"),
        {"files": [png(f"{index}.png", index) for index, _ in enumerate(answers)]},
        format="multipart",
    )
    assert uploaded.status_code == 201, uploaded.content
    saved = admin.post(
        admin_url(f"practice/{set_id}/answers"), {"answers": list(answers)}, format="json"
    )
    assert saved.status_code == 200, saved.content
    return saved.json()


def publish(admin: APIClient, set_id: str):
    return admin.patch(admin_url(f"practice/{set_id}"), {"is_published": True}, format="json")


def test_only_case_and_spaces_are_forgiven() -> None:
    assert is_correct(typed="  fE mUr ", expected="Femur")
    assert is_correct(typed="THE   hyoid\tBONE", expected="The hyoid bone")
    assert not is_correct(typed="Femer", expected="Femur")
    assert not is_correct(typed="Fémur", expected="Femur")
    assert not is_correct(typed="Femur.", expected="Femur")
    assert not is_correct(typed="Femur-", expected="Femur")
    assert not is_correct(typed="", expected="Femur")
    assert not is_correct(typed="anything", expected="")
    assert normalize_answer("a‏b​ c") == "ab" + "c"
    # An Arabic answer is compared as typed, apart from the spaces.
    assert is_correct(typed="عظم  الفخذ", expected="عظمالفخذ")
    assert not is_correct(typed="عظم الفخد", expected="عظم الفخذ")


def test_admin_builds_a_set_in_order_and_publishes_it(subjects, admin) -> None:
    anatomy, _ = subjects
    detail = build_set(admin, anatomy, answers=("Femur", "Tibia", "Fibula"))

    assert [slide["position"] for slide in detail["slides"]] == [1, 2, 3]
    assert [slide["answer"] for slide in detail["slides"]] == ["Femur", "Tibia", "Fibula"]
    assert detail["set"]["slide_count"] == 3 and detail["set"]["answered_count"] == 3
    assert detail["slides"][0]["image_url"].startswith("/api/v1/files/")
    assert publish(admin, detail["set"]["id"]).json()["set"]["is_published"] is True


def test_a_set_cannot_be_published_while_a_slide_has_no_answer(subjects, admin) -> None:
    anatomy, _ = subjects
    detail = build_set(admin, anatomy, answers=("Femur", ""))

    refused = publish(admin, detail["set"]["id"])

    assert refused.status_code == 400
    assert refused.json()["error"]["code"] == "practice_not_ready"
    empty = admin.post(
        admin_url(f"subjects/{anatomy.id}/practice"), {"title": "Empty"}, format="json"
    )
    assert publish(admin, empty.json()["set"]["id"]).status_code == 400


def test_bulk_answers_apply_by_position_and_reject_extras(subjects, admin) -> None:
    anatomy, _ = subjects
    detail = build_set(admin, anatomy, answers=("A", "B", "C"))
    set_id = detail["set"]["id"]

    changed = admin.post(
        admin_url(f"practice/{set_id}/answers"),
        {"answers": ["  Femur ", "", "Fibula"]},
        format="json",
    )
    too_many = admin.post(
        admin_url(f"practice/{set_id}/answers"), {"answers": ["1", "2", "3", "4"]}, format="json"
    )

    assert changed.json()["changed"] == 2
    assert [slide["answer"] for slide in changed.json()["slides"]] == ["Femur", "B", "Fibula"]
    assert too_many.status_code == 400
    assert [s.answer for s in PracticeSlide.objects.order_by("position")] == [
        "Femur",
        "B",
        "Fibula",
    ]


def test_reorder_delete_and_edit_keep_positions_contiguous(subjects, admin) -> None:
    anatomy, _ = subjects
    detail = build_set(admin, anatomy, answers=("One", "Two", "Three"))
    set_id = detail["set"]["id"]
    ids = [slide["id"] for slide in detail["slides"]]

    reordered = admin.post(
        admin_url(f"practice/{set_id}/reorder"), {"ids": ids[::-1]}, format="json"
    )
    partial = admin.post(admin_url(f"practice/{set_id}/reorder"), {"ids": ids[:2]}, format="json")
    assert [slide["answer"] for slide in reordered.json()["slides"]] == ["Three", "Two", "One"]
    assert partial.status_code == 400

    edited = admin.patch(
        admin_url(f"practice/{set_id}/slides/{ids[1]}"), {"answer": " Second  one "}, format="json"
    )
    assert edited.json()["slides"][1]["answer"] == "Second one"

    removed = admin.delete(admin_url(f"practice/{set_id}/slides/{ids[2]}"))
    assert [slide["position"] for slide in removed.json()["slides"]] == [1, 2]
    assert [slide["answer"] for slide in removed.json()["slides"]] == ["Second one", "One"]


def test_students_get_images_never_answers_and_are_graded_server_side(subjects, admin) -> None:
    anatomy, _ = subjects
    detail = build_set(admin, anatomy)
    set_id = detail["set"]["id"]
    publish(admin, set_id)
    student = client_for(create_user(email="practice-student@example.com", cohort=anatomy.cohort))

    directory = student.get("/api/v1/catalog/practice").json()["results"]
    opened = student.get(f"/api/v1/catalog/practice/{set_id}")

    assert len(directory) == 1 and directory[0]["slideCount"] == 2
    assert directory[0]["sets"][0]["stats"]["new"] == 2
    assert opened.status_code == 200
    body = opened.json()
    assert "Femur" not in opened.content.decode() and "answer" not in str(body["slides"])
    first, second = body["slides"]
    assert student.get(first["image_url"]).status_code == 200

    check = f"/api/v1/catalog/practice/{set_id}/slides/{first['id']}/check"
    right = student.post(check, {"answer": "  FEMUR"}, format="json").json()
    wrong = student.post(check, {"answer": "Femor"}, format="json").json()
    blank = student.post(check, {"answer": ""}, format="json").json()
    assert right["correct"] is True and right["expected"] == "Femur"
    assert wrong["correct"] is False and wrong["expected"] == "Femur"
    assert blank["correct"] is False
    # The second slide's name is not shared by checking the first.
    assert student.post(
        f"/api/v1/catalog/practice/{set_id}/slides/{second['id']}/check",
        {"answer": "tibia"},
        format="json",
    ).json()["correct"]


def test_unpublished_and_other_cohort_sets_stay_hidden(subjects, admin) -> None:
    anatomy, surgery = subjects
    draft = build_set(admin, anatomy, title="Draft")
    foreign = build_set(admin, surgery, title="Foreign")
    publish(admin, foreign["set"]["id"])
    student = client_for(create_user(email="practice-hidden@example.com", cohort=anatomy.cohort))

    assert student.get("/api/v1/catalog/practice").json()["results"] == []
    assert student.get(f"/api/v1/catalog/practice/{draft['set']['id']}").status_code == 404
    assert student.get(f"/api/v1/catalog/practice/{foreign['set']['id']}").status_code == 404
    assert student.get(draft["slides"][0]["image_url"]).status_code == 404
    assert student.get(foreign["slides"][0]["image_url"]).status_code == 404
    check = (
        f"/api/v1/catalog/practice/{foreign['set']['id']}/slides/{foreign['slides'][0]['id']}/check"
    )
    assert student.post(check, {"answer": "Femur"}, format="json").status_code == 404


def test_students_cannot_use_the_admin_routes(subjects, admin) -> None:
    anatomy, _ = subjects
    detail = build_set(admin, anatomy)
    student = client_for(create_user(email="practice-nope@example.com", cohort=anatomy.cohort))

    assert student.get(admin_url(f"subjects/{anatomy.id}/practice")).status_code == 403
    assert student.get(admin_url(f"practice/{detail['set']['id']}")).status_code == 403
    assert (
        student.post(
            admin_url(f"practice/{detail['set']['id']}/answers"), {"answers": ["x"]}, format="json"
        ).status_code
        == 403
    )
    assert student.delete(admin_url(f"practice/{detail['set']['id']}")).status_code == 403


def test_a_bad_image_is_reported_and_the_good_ones_still_go_in(subjects, admin) -> None:
    anatomy, _ = subjects
    created = admin.post(
        admin_url(f"subjects/{anatomy.id}/practice"), {"title": "Mixed"}, format="json"
    )
    set_id = created.json()["set"]["id"]
    broken = SimpleUploadedFile("notes.png", b"not an image at all", content_type="image/png")
    pdf = SimpleUploadedFile("doc.pdf", b"%PDF-1.7", content_type="application/pdf")

    response = admin.post(
        admin_url(f"practice/{set_id}/slides"),
        {"files": [png("a.png"), broken, pdf, png("b.png", 9)]},
        format="multipart",
    )

    body = response.json()
    assert body["added"] == 2
    assert [item["name"] for item in body["rejected"]] == ["notes.png", "doc.pdf"]
    assert [slide["file_name"] for slide in body["slides"]] == ["a.png", "b.png"]
    assert ManagedFile.objects.filter(kind=ManagedFile.Kind.PRACTICE_IMAGE).count() == 2
    assert (
        admin.post(admin_url(f"practice/{set_id}/slides"), {}, format="multipart").status_code
        == 400
    )


@override_settings(PRACTICE_SLIDES_MAX_PER_SET=2)
def test_a_set_holds_a_limited_number_of_slides(subjects, admin) -> None:
    anatomy, _ = subjects
    created = admin.post(
        admin_url(f"subjects/{anatomy.id}/practice"), {"title": "Capped"}, format="json"
    )
    set_id = created.json()["set"]["id"]

    body = admin.post(
        admin_url(f"practice/{set_id}/slides"),
        {"files": [png("1.png", 1), png("2.png", 2), png("3.png", 3)]},
        format="multipart",
    ).json()

    assert body["added"] == 2 and len(body["rejected"]) == 1


def test_set_names_are_distinct_within_a_subject(subjects, admin) -> None:
    anatomy, surgery = subjects
    admin.post(admin_url(f"subjects/{anatomy.id}/practice"), {"title": "Bones"}, format="json")

    duplicate = admin.post(
        admin_url(f"subjects/{anatomy.id}/practice"), {"title": " bones "}, format="json"
    )
    elsewhere = admin.post(
        admin_url(f"subjects/{surgery.id}/practice"), {"title": "Bones"}, format="json"
    )

    assert duplicate.status_code == 400
    assert duplicate.json()["error"]["code"] == "practice_title_taken"
    assert elsewhere.status_code == 201


def test_adding_a_slide_or_clearing_an_answer_takes_a_set_back_to_draft(subjects, admin) -> None:
    anatomy, _ = subjects
    detail = build_set(admin, anatomy)
    set_id = detail["set"]["id"]
    publish(admin, set_id)
    admin.post(
        admin_url(f"practice/{set_id}/slides"), {"files": [png("new.png", 7)]}, format="multipart"
    )
    assert PracticeSet.objects.get(id=set_id).is_published is False

    admin.post(
        admin_url(f"practice/{set_id}/answers"),
        {"answers": ["Femur", "Tibia", "Patella"]},
        format="json",
    )
    assert publish(admin, set_id).status_code == 200
    slide_id = detail["slides"][0]["id"]
    admin.patch(admin_url(f"practice/{set_id}/slides/{slide_id}"), {"answer": ""}, format="json")
    assert PracticeSet.objects.get(id=set_id).is_published is False


def test_deleting_a_set_removes_its_images(
    subjects, admin, django_capture_on_commit_callbacks
) -> None:
    anatomy, _ = subjects
    detail = build_set(admin, anatomy)
    files = list(ManagedFile.objects.filter(kind=ManagedFile.Kind.PRACTICE_IMAGE))
    storage = files[0].blob.storage
    names = [item.blob.name for item in files]

    with django_capture_on_commit_callbacks(execute=True):
        response = admin.delete(admin_url(f"practice/{detail['set']['id']}"))

    assert response.status_code == 204
    assert not PracticeSet.objects.exists() and not PracticeSlide.objects.exists()
    assert not ManagedFile.objects.filter(kind=ManagedFile.Kind.PRACTICE_IMAGE).exists()
    assert not any(storage.exists(name) for name in names)


def published_for(admin: APIClient, anatomy: CatalogSubject, **kwargs):
    detail = build_set(admin, anatomy, **kwargs)
    publish(admin, detail["set"]["id"])
    student = client_for(create_user(email="practice-xp@example.com", cohort=anatomy.cohort))
    return detail, student


def check_url(set_id: str, slide_id: str, action: str = "check") -> str:
    return f"/api/v1/catalog/practice/{set_id}/slides/{slide_id}/{action}"


def slides_of(student: APIClient, set_id: str) -> list[dict[str, Any]]:
    return student.get(f"/api/v1/catalog/practice/{set_id}").json()["slides"]


def test_a_typo_is_flagged_as_close_but_stays_wrong() -> None:
    assert is_near_miss(typed="Femor", expected="Femur")
    assert is_near_miss(typed="Fmeur", expected="Femur")  # swapped letters
    assert is_near_miss(typed="Femu", expected="Femur")
    assert not is_near_miss(typed="Femur", expected="Femur")
    assert not is_near_miss(typed="Tibia", expected="Femur")
    assert not is_near_miss(typed="Fem", expected="Femur")
    assert not is_near_miss(typed="", expected="Femur")
    assert not is_near_miss(typed="abc", expected="abd")  # too short to call a typo
    assert is_near_miss(typed="Temporal bone", expected="Temporal bones")
    assert not is_correct(typed="Femor", expected="Femur")


def test_first_correct_name_earns_xp_once_and_a_wrong_one_earns_none(subjects, admin) -> None:
    anatomy, _ = subjects
    detail, student = published_for(admin, anatomy)
    set_id = detail["set"]["id"]
    url = check_url(set_id, slides_of(student, set_id)[0]["id"])

    wrong = student.post(url, {"answer": "Femor"}, format="json").json()
    right = student.post(url, {"answer": "femur"}, format="json").json()
    again = student.post(url, {"answer": "femur"}, format="json").json()

    assert wrong["near_miss"] is True and wrong["xp_awarded"] == 0
    assert right["correct"] and right["xp_awarded"] == 5 and right["near_miss"] is False
    assert again["correct"] and again["xp_awarded"] == 0
    ledger = XpTransaction.objects.filter(rule_code="practice_slide_v1")
    assert ledger.count() == 1 and ledger.get().points == 5


def test_a_hint_lowers_the_award_and_only_applies_to_one_check(subjects, admin) -> None:
    anatomy, _ = subjects
    detail, student = published_for(admin, anatomy)
    set_id = detail["set"]["id"]
    first, second = (slide["id"] for slide in slides_of(student, set_id))

    hint = student.post(check_url(set_id, first, "hint")).json()
    hinted = student.post(check_url(set_id, first), {"answer": "Femur"}, format="json").json()
    clean = student.post(check_url(set_id, second), {"answer": "Tibia"}, format="json").json()

    assert hint == {"first_letter": "F"}
    assert hinted["hinted"] is True and hinted["xp_awarded"] == 3
    assert clean["hinted"] is False and clean["xp_awarded"] == 5
    progress = PracticeSlideProgress.objects.get(slide_id=first)
    assert progress.hint_pending is False and progress.streak == 0


def test_finishing_every_slide_pays_the_set_bonus_once(subjects, admin) -> None:
    anatomy, _ = subjects
    detail, student = published_for(admin, anatomy)
    set_id = detail["set"]["id"]
    slides = slides_of(student, set_id)

    first = student.post(check_url(set_id, slides[0]["id"]), {"answer": "Femur"}, format="json")
    last = student.post(check_url(set_id, slides[1]["id"]), {"answer": "Tibia"}, format="json")
    repeat = student.post(check_url(set_id, slides[1]["id"]), {"answer": "Tibia"}, format="json")

    assert first.json()["set_xp_awarded"] == 0
    assert last.json()["set_xp_awarded"] == 20
    assert repeat.json()["set_xp_awarded"] == 0
    assert XpTransaction.objects.filter(rule_code="practice_set_complete_v1").count() == 1


def test_missed_slides_come_back_for_review_and_show_in_stats(subjects, admin) -> None:
    anatomy, _ = subjects
    detail, student = published_for(admin, anatomy)
    set_id = detail["set"]["id"]
    slides = slides_of(student, set_id)
    assert {slide["state"] for slide in slides} == {"new"}

    student.post(check_url(set_id, slides[0]["id"]), {"answer": "nope"}, format="json")
    student.post(check_url(set_id, slides[0]["id"]), {"answer": "still"}, format="json")
    student.post(check_url(set_id, slides[1]["id"]), {"answer": "Tibia"}, format="json")

    body = student.get(f"/api/v1/catalog/practice/{set_id}").json()
    assert [slide["state"] for slide in body["slides"]] == ["missed", "learned"]
    assert body["stats"]["missed"] == 1 and body["stats"]["learned"] == 1
    assert body["stats"]["review"] == 1 and body["stats"]["last_practiced_at"]
    assert [(m["expected"], m["misses"]) for m in body["most_missed"]] == [("Femur", 2)]

    row = PracticeSlideProgress.objects.get(slide_id=slides[1]["id"])
    PracticeSlideProgress.objects.filter(id=row.id).update(due_at=row.last_attempt_at)
    assert slides_of(student, set_id)[1]["state"] == "due"


def test_progress_is_per_student(subjects, admin) -> None:
    anatomy, _ = subjects
    detail, student = published_for(admin, anatomy)
    other = client_for(create_user(email="practice-other@example.com", cohort=anatomy.cohort))
    set_id = detail["set"]["id"]
    first = slides_of(student, set_id)[0]["id"]
    student.post(check_url(set_id, first), {"answer": "x"}, format="json")

    assert [slide["state"] for slide in slides_of(other, set_id)] == ["new", "new"]


def test_an_administrator_can_preview_a_draft_without_recording_anything(subjects, admin) -> None:
    anatomy, _ = subjects
    detail = build_set(admin, anatomy, title="Draft preview")
    set_id = detail["set"]["id"]

    opened = admin.get(f"/api/v1/catalog/practice/{set_id}")
    slide_id = opened.json()["slides"][0]["id"]
    checked = admin.post(check_url(set_id, slide_id), {"answer": "Femur"}, format="json").json()

    assert opened.status_code == 200 and opened.json()["preview"] is True
    assert checked["correct"] is True and checked["xp_awarded"] == 0
    assert not PracticeSlideProgress.objects.exists() and not XpTransaction.objects.exists()


def test_a_mark_can_be_set_shown_to_students_and_cleared(subjects, admin) -> None:
    anatomy, _ = subjects
    detail, student = published_for(admin, anatomy)
    set_id = detail["set"]["id"]
    url = admin_url(f"practice/{set_id}/slides/{detail['slides'][0]['id']}")

    marked = admin.patch(url, {"hotspot": {"x": 0.25, "y": 0.5, "shape": "arrow"}}, format="json")
    outside = admin.patch(url, {"hotspot": {"x": 1.5, "y": 0.5, "shape": "circle"}}, format="json")
    odd = admin.patch(url, {"hotspot": {"x": 0.5, "y": 0.5, "shape": "star"}}, format="json")
    empty = admin.patch(url, {}, format="json")

    assert marked.json()["slides"][0]["hotspot"] == {"x": 0.25, "y": 0.5, "shape": "arrow"}
    assert marked.json()["slides"][0]["answer"] == "Femur"
    assert outside.status_code == 400 and odd.status_code == 400 and empty.status_code == 400
    shown = slides_of(student, set_id)
    assert shown[0]["hotspot"] == {"x": 0.25, "y": 0.5, "shape": "arrow"}
    assert shown[1]["hotspot"] is None
    cleared = admin.patch(url, {"hotspot": None}, format="json")
    assert cleared.json()["slides"][0]["hotspot"] is None


def test_a_slide_moves_to_a_chosen_position(subjects, admin) -> None:
    anatomy, _ = subjects
    detail = build_set(admin, anatomy, answers=("One", "Two", "Three", "Four"))
    set_id = detail["set"]["id"]
    last_id = detail["slides"][3]["id"]

    moved = admin.post(
        admin_url(f"practice/{set_id}/slides/{last_id}/move"), {"position": 2}, format="json"
    )
    off = admin.post(
        admin_url(f"practice/{set_id}/slides/{last_id}/move"), {"position": 9}, format="json"
    )

    assert [s["answer"] for s in moved.json()["slides"]] == ["One", "Four", "Two", "Three"]
    assert [s["position"] for s in moved.json()["slides"]] == [1, 2, 3, 4]
    assert off.status_code == 400


def test_replacing_an_image_keeps_the_name_position_and_mark(
    subjects, admin, django_capture_on_commit_callbacks
) -> None:
    anatomy, _ = subjects
    detail = build_set(admin, anatomy)
    set_id = detail["set"]["id"]
    slide = detail["slides"][0]
    url = admin_url(f"practice/{set_id}/slides/{slide['id']}")
    admin.patch(url, {"hotspot": {"x": 0.1, "y": 0.2, "shape": "circle"}}, format="json")
    before = ManagedFile.objects.get(practice_slide__id=slide["id"])
    storage, old_name = before.blob.storage, before.blob.name

    with django_capture_on_commit_callbacks(execute=True):
        replaced = admin.post(f"{url}/image", {"file": png("new.png", 99)}, format="multipart")
    broken = admin.post(
        f"{url}/image",
        {"file": SimpleUploadedFile("x.png", b"nope", content_type="image/png")},
        format="multipart",
    )

    body = replaced.json()["slides"][0]
    assert replaced.status_code == 200
    assert body["answer"] == "Femur" and body["position"] == 1 and body["file_name"] == "new.png"
    assert body["hotspot"]["shape"] == "circle"
    assert broken.status_code == 400
    assert not ManagedFile.objects.filter(id=before.id).exists() and not storage.exists(old_name)
    assert ManagedFile.objects.filter(kind=ManagedFile.Kind.PRACTICE_IMAGE).count() == 2


def test_duplicating_a_set_makes_an_independent_draft_copy(subjects, admin) -> None:
    anatomy, _ = subjects
    detail = build_set(admin, anatomy, answers=("Femur", "Tibia"))
    set_id = detail["set"]["id"]
    publish(admin, set_id)
    admin.patch(
        admin_url(f"practice/{set_id}/slides/{detail['slides'][1]['id']}"),
        {"hotspot": {"x": 0.3, "y": 0.4, "shape": "arrow"}},
        format="json",
    )

    first = admin.post(admin_url(f"practice/{set_id}/duplicate"), {}, format="json")
    second = admin.post(admin_url(f"practice/{set_id}/duplicate"), {}, format="json")
    named = admin.post(
        admin_url(f"practice/{set_id}/duplicate"), {"title": "Skull, round 2"}, format="json"
    )

    copy = first.json()
    assert first.status_code == 201
    assert copy["set"]["title"] == "Copy of Skull bones" and copy["set"]["is_published"] is False
    assert second.json()["set"]["title"] == "Copy of Skull bones 2"
    assert named.json()["set"]["title"] == "Skull, round 2"
    assert [slide["answer"] for slide in copy["slides"]] == ["Femur", "Tibia"]
    assert copy["slides"][1]["hotspot"] == {"x": 0.3, "y": 0.4, "shape": "arrow"}
    original_ids = {slide["id"] for slide in detail["slides"]}
    assert not original_ids & {slide["id"] for slide in copy["slides"]}
    assert ManagedFile.objects.filter(kind=ManagedFile.Kind.PRACTICE_IMAGE).count() == 8
    assert PracticeSet.objects.get(id=set_id).is_published is True


def make_zip(entries: dict[str, bytes]) -> SimpleUploadedFile:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as bundle:
        for name, data in entries.items():
            bundle.writestr(name, data)
    return SimpleUploadedFile("slides.zip", buffer.getvalue(), content_type="application/zip")


def test_a_zip_adds_its_images_in_natural_order_and_skips_junk(subjects, admin) -> None:
    anatomy, _ = subjects
    created = admin.post(
        admin_url(f"subjects/{anatomy.id}/practice"), {"title": "From a ZIP"}, format="json"
    ).json()
    set_id = created["set"]["id"]
    image = png().read()
    archive = make_zip(
        {
            "Image10.png": image,
            "Image2.png": image,
            "Image1.png": image,
            "__MACOSX/._Image1.png": b"junk",
            ".DS_Store": b"junk",
            "pics/Image3.PNG": image,
            "notes.txt": b"hello",
            "Image4.png": b"not an image",
        }
    )

    response = admin.post(
        admin_url(f"practice/{set_id}/slides"), {"archive": archive}, format="multipart"
    )

    body = response.json()
    assert response.status_code == 201
    assert [slide["file_name"] for slide in body["slides"]] == [
        "Image1.png",
        "Image2.png",
        "Image3.PNG",
        "Image10.png",
    ]
    assert body["added"] == 4
    assert {item["name"] for item in body["rejected"]} == {"notes.txt", "Image4.png"}


def test_a_broken_empty_or_mixed_zip_is_refused(subjects, admin) -> None:
    anatomy, _ = subjects
    detail = build_set(admin, anatomy)
    url = admin_url(f"practice/{detail['set']['id']}/slides")
    broken = SimpleUploadedFile("x.zip", b"PK nope", content_type="application/zip")

    not_a_zip = admin.post(url, {"archive": broken}, format="multipart")
    empty = admin.post(url, {"archive": make_zip({})}, format="multipart")
    mixed = admin.post(
        url, {"archive": make_zip({"a.png": png().read()}), "files": png()}, format="multipart"
    )

    assert not_a_zip.status_code == 400 and empty.status_code == 400 and mixed.status_code == 400
    assert PracticeSlide.objects.filter(practice_set_id=detail["set"]["id"]).count() == 2


@override_settings(PRACTICE_SLIDES_MAX_PER_SET=3)
def test_a_zip_stops_at_the_set_limit(subjects, admin) -> None:
    anatomy, _ = subjects
    created = admin.post(
        admin_url(f"subjects/{anatomy.id}/practice"), {"title": "Tiny"}, format="json"
    ).json()
    image = png().read()
    archive = make_zip({f"Image{n}.png": image for n in range(1, 6)})

    response = admin.post(
        admin_url(f"practice/{created['set']['id']}/slides"),
        {"archive": archive},
        format="multipart",
    )

    assert response.json()["added"] == 3 and len(response.json()["rejected"]) == 2
