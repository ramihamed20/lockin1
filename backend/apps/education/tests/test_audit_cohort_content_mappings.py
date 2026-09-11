from io import StringIO

import pytest
from django.core.management import call_command

from apps.content.tests.helpers import published_pdf

from ..models import AcademicProgram, EducationNode, StudentCohort
from ..services import create_node, set_node_status
from .helpers import create_admin, published_path

pytestmark = pytest.mark.django_db


def test_audit_reports_cohort_scopes_and_unmapped_published_content() -> None:
    admin = create_admin(email="audit-mappings-admin@example.com")
    institution, subject, mapped_lesson = published_path(admin=admin)
    other_subject = create_node(
        actor=admin,
        parent=institution,
        kind=EducationNode.Kind.SUBJECT,
        title="Dental Materials",
    )
    other_subject = set_node_status(
        actor=admin,
        node_id=other_subject.id,
        expected_revision=other_subject.revision,
        status=EducationNode.Status.PUBLISHED,
    )
    unmapped_lesson = create_node(
        actor=admin,
        parent=other_subject,
        kind=EducationNode.Kind.LESSON,
        title="Impression materials",
    )
    unmapped_lesson = set_node_status(
        actor=admin,
        node_id=unmapped_lesson.id,
        expected_revision=unmapped_lesson.revision,
        status=EducationNode.Status.PUBLISHED,
    )
    mapped = published_pdf(actor=admin, node=mapped_lesson, title="Mapped guide")
    unmapped = published_pdf(actor=admin, node=unmapped_lesson, title="Unmapped guide")

    program = AcademicProgram.objects.create(code="audit-program", name_en="Audit", name_ar="Audit")
    scoped = StudentCohort.objects.create(
        program=program, code="scoped", name_en="Scoped", name_ar="Scoped"
    )
    scoped.content_nodes.add(subject)
    unassigned = StudentCohort.objects.create(
        program=program, code="unassigned", name_en="Unassigned", name_ar="Unassigned"
    )

    stdout = StringIO()
    call_command("audit_cohort_content_mappings", stdout=stdout)
    report = stdout.getvalue()

    assert f"COHORT {scoped.id} audit-program/scoped: {subject.path}" in report
    assert f"COHORT {unassigned.id} audit-program/unassigned: UNASSIGNED" in report
    assert f"UNMAPPED {unmapped.id} {unmapped_lesson.path}" in report
    assert f"UNMAPPED {mapped.id}" not in report
