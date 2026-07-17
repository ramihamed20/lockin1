from apps.accounts.models import User
from apps.content.models import LearningObject, LearningObjectVersion
from apps.content.services import (
    LearningObjectInput,
    create_learning_object,
    publish_learning_object,
    submit_for_review,
)
from apps.education.models import EducationNode
from apps.education.tests.helpers import pdf_upload
from apps.files.services import create_managed_file


def published_pdf(
    *,
    actor: User,
    node: EducationNode,
    allow_download: bool = False,
    title: str = "Cranial nerves guide",
) -> LearningObject:
    managed_file = create_managed_file(owner=actor, upload=pdf_upload(), kind="pdf")
    learning_object = create_learning_object(
        actor=actor,
        data=LearningObjectInput(
            academic_node=node,
            content_type=LearningObjectVersion.ContentType.PDF,
            title=title,
            summary="A structured study document.",
            allow_download=allow_download,
            primary_file=managed_file,
        ),
    )
    learning_object = submit_for_review(
        actor=actor,
        learning_object_id=learning_object.id,
        expected_revision=learning_object.revision,
    )
    return publish_learning_object(
        actor=actor,
        learning_object_id=learning_object.id,
        expected_revision=learning_object.revision,
    )
