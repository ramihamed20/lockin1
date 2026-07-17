from uuid import uuid4

from django.contrib.auth.models import Group

from apps.accounts.models import User
from apps.accounts.roles import Role
from apps.accounts.tests.helpers import create_user
from apps.education.models import CreatorScope, EducationNode
from apps.education.tests.helpers import create_creator

from ..models import Discussion
from ..services import create_discussion


def create_moderator(*, email: str = "moderator@example.com") -> User:
    user = create_user(email=email, full_name="Community Moderator")
    Group.objects.get(name=Role.MODERATOR.value).user_set.add(user)
    return user


def scoped_creator(*, admin: User, node: EducationNode) -> User:
    creator = create_creator()
    CreatorScope.objects.create(
        user=creator,
        node=node,
        can_create_content=True,
        granted_by=admin,
    )
    return creator


def lesson_discussion(
    *, author: User, lesson: EducationNode, title: str = "How should I remember this pathway?"
) -> Discussion:
    return create_discussion(
        actor=author,
        context_type="lesson",
        context_id=lesson.id,
        title=title,
        body="I understand the first step, but I need help connecting it to the clinical example.",
        client_request_id=uuid4(),
    )
