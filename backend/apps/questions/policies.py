from apps.accounts.models import User
from apps.education.policies import is_administrator

from .models import Question


def can_edit_question(*, user: User, question: Question) -> bool:
    return is_administrator(user) or question.owner_id == user.id
