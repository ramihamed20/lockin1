from dataclasses import dataclass
from datetime import datetime

from apps.accounts.models import User
from apps.education.models import EducationNode
from apps.questions.models import QuestionVersion


@dataclass(frozen=True, slots=True)
class QuestionAttemptEvent:
    user: User
    event_key: str
    canonical_key: str
    subject_key: str
    subject_label: str
    source_type: str
    source_id: str
    source_label: str
    source_question_index: int | None
    prompt: str
    explanation: str
    options: tuple[dict[str, str], ...]
    selected_option_ids: tuple[str, ...]
    correct_option_ids: tuple[str, ...]
    is_correct: bool
    answered_at: datetime
    question_version: QuestionVersion | None = None
    subject: EducationNode | None = None
