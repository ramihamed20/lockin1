from typing import Any

import pytest
from rest_framework.test import APIClient

from apps.education.tests.helpers import create_admin, pdf_upload, published_path
from apps.files.services import create_managed_file

from ..active_study import ActiveStudyPlanError, page_ranges, part_sizes
from ..admin_services import create_sheet

pytestmark = pytest.mark.django_db


@pytest.mark.parametrize(
    ("eligible", "target", "expected"),
    [
        (21, 5, (5, 5, 5, 6)),
        (22, 5, (5, 5, 5, 7)),
        (17, 5, (5, 5, 7)),
        (20, 5, (5, 5, 5, 5)),
        (4, 5, (4,)),
    ],
)
def test_active_study_remainder_is_only_added_to_final_part(
    eligible: int, target: int, expected: tuple[int, ...]
) -> None:
    assert part_sizes(eligible_pages=eligible, target_pages_per_part=target) == expected


def test_active_study_page_ranges_honor_start_and_end_exclusions() -> None:
    assert page_ranges(
        total_pdf_pages=22,
        excluded_start_pages=1,
        excluded_end_pages=0,
        target_pages_per_part=5,
    ) == ((2, 6), (7, 11), (12, 16), (17, 22))
    assert page_ranges(
        total_pdf_pages=30,
        excluded_start_pages=1,
        excluded_end_pages=2,
        target_pages_per_part=5,
    )[-1] == (22, 28)


@pytest.mark.parametrize(
    ("total", "start", "end"), [(0, 0, 0), (22, -1, 0), (22, 22, 0), (22, 20, 2)]
)
def test_active_study_rejects_invalid_exclusions(total: int, start: int, end: int) -> None:
    with pytest.raises(ActiveStudyPlanError):
        page_ranges(
            total_pdf_pages=total,
            excluded_start_pages=start,
            excluded_end_pages=end,
            target_pages_per_part=5,
        )


def _sheet(*, admin: Any, subject: Any, title: str, position: int):
    return create_sheet(
        actor=admin,
        subject=subject,
        managed_file=create_managed_file(
            owner=admin, upload=pdf_upload(name=f"{title}.pdf"), kind="pdf"
        ),
        title=title,
        summary="",
        position=position,
        publish=False,
        notify_students=False,
        allow_download=False,
    )


def test_admin_active_study_settings_are_persisted_recalculated_and_can_be_disabled() -> None:
    admin = create_admin()
    _, subject, _ = published_path(admin=admin)
    sheet = _sheet(admin=admin, subject=subject, title="Biochemistry", position=0)
    client = APIClient()
    client.force_authenticate(admin)
    endpoint = f"/api/v1/operations/admin/content/sheets/{sheet.id}/active-study"

    initial = client.get(endpoint)
    assert initial.status_code == 200
    assert initial.json()["enabled"] is False
    assert initial.json()["revision"] == 0
    assert initial.json()["difficulties"][0]["readiness"]["reason"] == "Active Study is disabled."

    saved = client.patch(
        endpoint,
        {
            "expected_revision": 0,
            "enabled": True,
            "total_pdf_pages": 22,
            "excluded_start_pages": 1,
            "excluded_end_pages": 0,
        },
        format="json",
    )
    assert saved.status_code == 200
    payload = saved.json()
    assert payload["enabled"] is True
    assert payload["eligible_study_pages"] == 21
    medium = next(item for item in payload["difficulties"] if item["difficulty"] == "medium")
    assert medium["readiness"]["ready"] is False
    assert "not been imported" in medium["readiness"]["reason"]
    assert medium["number_of_parts"] == 4
    assert medium["page_ranges"] == [
        {"part": 1, "start_page": 2, "end_page": 6},
        {"part": 2, "start_page": 7, "end_page": 11},
        {"part": 3, "start_page": 12, "end_page": 16},
        {"part": 4, "start_page": 17, "end_page": 22},
    ]

    changed = client.patch(
        endpoint,
        {
            "expected_revision": payload["revision"],
            "enabled": True,
            "total_pdf_pages": 22,
            "excluded_start_pages": 2,
            "excluded_end_pages": 1,
        },
        format="json",
    )
    assert changed.status_code == 200
    assert changed.json()["eligible_study_pages"] == 19

    disabled = client.patch(
        endpoint,
        {
            "expected_revision": changed.json()["revision"],
            "enabled": False,
            "total_pdf_pages": 22,
            "excluded_start_pages": 2,
            "excluded_end_pages": 1,
        },
        format="json",
    )
    assert disabled.status_code == 200
    assert disabled.json()["enabled"] is False
    assert disabled.json()["eligible_study_pages"] == 19

    invalid = client.patch(
        endpoint,
        {
            "expected_revision": disabled.json()["revision"],
            "enabled": True,
            "total_pdf_pages": 22,
            "excluded_start_pages": 20,
            "excluded_end_pages": 2,
        },
        format="json",
    )
    assert invalid.status_code == 400


def test_admin_reorder_persists_and_content_permissions_guard_settings() -> None:
    admin = create_admin()
    _, subject, _ = published_path(admin=admin)
    first = _sheet(admin=admin, subject=subject, title="Vitamin 1", position=0)
    second = _sheet(admin=admin, subject=subject, title="Vitamin 2", position=1)
    last = _sheet(admin=admin, subject=subject, title="Metabolism", position=2)
    client = APIClient()
    client.force_authenticate(admin)
    reorder = client.post(
        f"/api/v1/operations/admin/content/sheets/{last.id}/reorder",
        {"expected_revision": last.revision, "target_sheet_id": first.id, "placement": "before"},
        format="json",
    )
    assert reorder.status_code == 200
    listed = client.get(f"/api/v1/operations/admin/content/subjects/{subject.id}/sheets")
    assert [item["id"] for item in listed.json()["results"]] == [
        str(last.id),
        str(first.id),
        str(second.id),
    ]

    anonymous = APIClient()
    endpoint = f"/api/v1/operations/admin/content/sheets/{first.id}/active-study"
    assert anonymous.get(endpoint).status_code in {401, 403}
    assert anonymous.patch(
        endpoint, {"expected_revision": 0, "enabled": False}, format="json"
    ).status_code in {401, 403}
