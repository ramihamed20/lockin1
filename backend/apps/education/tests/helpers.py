from django.contrib.auth.models import Group
from django.core.files.uploadedfile import SimpleUploadedFile

from apps.accounts.models import User
from apps.accounts.roles import Role
from apps.accounts.tests.helpers import create_user
from apps.education.models import EducationNode
from apps.education.services import create_node, set_node_status


def create_admin(*, email: str = "admin@example.com") -> User:
    user = create_user(email=email, full_name="Platform Admin")
    Group.objects.get(name=Role.ADMINISTRATOR.value).user_set.add(user)
    return user


def create_creator(*, email: str = "creator@example.com") -> User:
    user = create_user(email=email, full_name="Content Creator")
    Group.objects.get(name=Role.CREATOR.value).user_set.add(user)
    return user


def published_path(*, admin: User) -> tuple[EducationNode, EducationNode, EducationNode]:
    institution = create_node(
        actor=admin,
        parent=None,
        kind=EducationNode.Kind.INSTITUTION,
        title="Lock-in University",
    )
    institution = set_node_status(
        actor=admin,
        node_id=institution.id,
        expected_revision=institution.revision,
        status=EducationNode.Status.PUBLISHED,
    )
    subject = create_node(
        actor=admin,
        parent=institution,
        kind=EducationNode.Kind.SUBJECT,
        title="Human Anatomy",
    )
    subject = set_node_status(
        actor=admin,
        node_id=subject.id,
        expected_revision=subject.revision,
        status=EducationNode.Status.PUBLISHED,
    )
    lesson = create_node(
        actor=admin,
        parent=subject,
        kind=EducationNode.Kind.LESSON,
        title="Cranial nerves",
    )
    lesson = set_node_status(
        actor=admin,
        node_id=lesson.id,
        expected_revision=lesson.revision,
        status=EducationNode.Status.PUBLISHED,
    )
    return institution, subject, lesson


def pdf_upload(*, name: str = "lesson.pdf") -> SimpleUploadedFile:
    return SimpleUploadedFile(
        name,
        b"%PDF-1.7\n%Lock-in test document\n",
        content_type="application/pdf",
    )


def audio_upload(*, name: str = "lesson.mp3") -> SimpleUploadedFile:
    return SimpleUploadedFile(
        name,
        b"ID3\x04\x00\x00\x00\x00\x00\x10Lock-in audio",
        content_type="audio/mpeg",
    )
