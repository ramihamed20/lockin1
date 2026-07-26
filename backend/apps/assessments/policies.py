from apps.accounts.models import User
from apps.education.policies import is_assessment_administrator

from .models import Quiz


def can_edit_quiz(*, user: User, quiz: Quiz) -> bool:
    return is_assessment_administrator(user) or quiz.owner_id == user.id
