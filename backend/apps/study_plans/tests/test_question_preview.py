from datetime import timedelta

import pytest
from django.utils import timezone

from apps.questions.models import Question, QuestionAnswer, QuestionVersion

from ..models import StudyPlanItem
from .test_apply_preview import apply
from .test_foundation import curriculum
from .test_reading_preview import preview, setup_plan


pytestmark = pytest.mark.django_db


def make_question(data, *, source="ai-sheet", index=1):
    question = Question.objects.create(owner=data["admin"])
    version = QuestionVersion.objects.create(
        question=question, version_number=1,
        academic_node=data["sheet"].published_version.academic_node,
        source_learning_object=data["sheet"], question_type="single_choice",
        prompt=f"Question {index}", created_by=data["admin"],
        metadata={"source": source},
    )
    question.current_version = version
    question.published_version = version
    question.workflow_status = "published"
    question.published_at = timezone.now()
    question.save()
    return question


def test_question_inventory_and_scheduled_exam_questions(curriculum):
    setup_plan(curriculum)
    first = make_question(curriculum, index=1)
    exam = make_question(curriculum, source="exam", index=2)
    QuestionAnswer.objects.create(
        user=curriculum["user"], question=first, version=first.published_version,
        selected_option_ids=[], is_correct=False, answered_at=timezone.now(),
    )
    response = preview(curriculum, include_questions=True)
    assert response.status_code == 200, response.json()
    body = response.json()
    assert body["question_inventory"]["available"] == 2
    assert body["question_inventory"]["answered"] == 1
    assert body["question_inventory"]["remaining"] == 1
    tasks = [task for task in body["assignments"] if task["activity"] == "questions"]
    assert len(tasks) == 1
    assert tasks[0]["question_ids"] == [str(exam.pk)]
    assert tasks[0]["start_url"].startswith("/questions/categories/years/")
    assert body["required_question_minutes"] >= 5


def test_question_tasks_complete_from_answers_without_awarding_xp(curriculum):
    setup_plan(curriculum)
    question = make_question(curriculum)
    value = preview(curriculum, include_questions=True).json()
    saved = apply(curriculum, value, include_questions=True)
    assert saved.status_code == 200, saved.json()
    task = StudyPlanItem.objects.get(activity="questions")
    assert task.question_ids == [str(question.pk)]
    assert preview(curriculum, include_questions=True).json()["required_question_minutes"] == 0

    QuestionAnswer.objects.create(
        user=curriculum["user"], question=question, version=question.published_version,
        selected_option_ids=[], is_correct=False, answered_at=timezone.now() + timedelta(seconds=1),
    )
    from .test_api import authenticated_client

    today = timezone.localdate()
    response = authenticated_client(curriculum["user"]).get(
        f"/api/v1/study-plan?from={today}&to={today}"
    )
    assert response.status_code == 200
    task.refresh_from_db()
    assert task.status == "completed"


def test_later_published_questions_append_only_new_question_ids(curriculum):
    setup_plan(curriculum)
    first = make_question(curriculum)
    original = preview(curriculum, include_questions=True).json()
    assert apply(curriculum, original, include_questions=True).status_code == 200
    second = make_question(curriculum, index=2)
    new_preview = preview(curriculum, include_questions=True).json()
    pending = [
        qid for task in new_preview["assignments"] if task["activity"] == "questions"
        for qid in task["question_ids"]
    ]
    assert str(second.pk) in pending
    assert str(first.pk) not in pending
    assert new_preview["question_inventory"]["remaining"] == 2
