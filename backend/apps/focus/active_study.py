from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import NotRequired, TypedDict
from uuid import UUID

from django.db import transaction
from django.utils import timezone

from apps.accounts.models import User
from apps.review.contracts import QuestionAttemptEvent
from apps.review.models import ReviewItem
from apps.review.services import record_question_attempt
from apps.xp.services import award_xp

from .models import ActiveStudyRun


class ActiveStudyRuleError(ValueError):
    pass


@dataclass(frozen=True)
class StudyQuestion:
    id: str
    page: int
    batch: int
    prompt: str
    answer: str


class StudyOptionPayload(TypedDict):
    id: str
    text: str


class StudyQuestionPayload(TypedDict):
    id: str
    page: int
    prompt: str
    options: list[StudyOptionPayload]
    correct_option_id: NotRequired[str]


# This bank is derived from the 16-page Oral Histology test PDF bundled with the
# catalogue. Answers never leave the server until an attempt has been scored.
_RAW_QUESTIONS = (
    # Pages 1-3
    ("b1-01", 3, 0, "How many primordial prominences surround the primitive oral pit?", "Five"),
    ("b1-02", 3, 0, "What is the central facial depression called?", "The primitive oral pit"),
    (
        "b1-03",
        3,
        0,
        "During which week do ectomesenchymal cells migrate in two streams?",
        "The fourth week",
    ),
    (
        "b1-04",
        3,
        0,
        "What does the cranial ectomesenchymal stream form?",
        "The frontonasal process",
    ),
    (
        "b1-05",
        3,
        0,
        "Where does the caudal ectomesenchymal stream enter?",
        "The first pharyngeal arches",
    ),
    (
        "b1-06",
        3,
        0,
        "Which processes are established bilaterally from the first pharyngeal arches?",
        "The maxillary and mandibular processes",
    ),
    (
        "b1-07",
        3,
        0,
        "What happens to the two mandibular processes at the midline?",
        "They merge with each other",
    ),
    ("b1-08", 3, 0, "What major bone develops from the mandibular processes?", "The mandible"),
    (
        "b1-09",
        3,
        0,
        "Which soft-tissue regions arise from the mandibular processes?",
        "The lower lip and lower cheek",
    ),
    (
        "b1-10",
        3,
        0,
        "What disappears when the mandibular processes merge?",
        "The midline groove between them",
    ),
    # Pages 4-6
    (
        "b2-01",
        4,
        1,
        "What causes a median cleft of the mandible?",
        "Failure of the mandibular processes to merge",
    ),
    ("b2-02", 4, 1, "When do the nasal placodes develop?", "The fifth week"),
    (
        "b2-03",
        4,
        1,
        "Rapid mesenchymal proliferation transforms nasal placodes into what?",
        "Nasal pits",
    ),
    (
        "b2-04",
        4,
        1,
        "Which arms of the horseshoe elevations form the medial nasal processes?",
        "The long arms",
    ),
    ("b2-05", 4, 1, "Which arms form the lateral nasal processes?", "The short arms"),
    (
        "b2-06",
        5,
        1,
        "What are the grooves between medial nasal and maxillary processes called?",
        "Bucconasal grooves",
    ),
    ("b2-07", 5, 1, "What is the first external sign of eye development?", "The lens placodes"),
    (
        "b2-08",
        6,
        1,
        "What structure forms when the nasolacrimal groove's epithelial cord canalizes?",
        "The nasolacrimal duct",
    ),
    (
        "b2-09",
        6,
        1,
        "Where does the nasolacrimal duct drain excess tears?",
        "From the eye to the nasal cavity",
    ),
    (
        "b2-10",
        6,
        1,
        "What do the medial nasal processes form after merging in week six?",
        "The intermaxillary segment",
    ),
    # Pages 7-9
    (
        "b3-01",
        7,
        2,
        "By which week has the face acquired a more human appearance?",
        "The seventh week",
    ),
    (
        "b3-02",
        7,
        2,
        "At about what age do the orbital cavities reach adult dimensions?",
        "Seven years",
    ),
    ("b3-03", 7, 2, "When does the nose acquire its inherited size and shape?", "At puberty"),
    (
        "b3-04",
        7,
        2,
        "What moves the ears cranially into the middle third of the face?",
        "Vertical growth of the face",
    ),
    ("b3-05", 7, 2, "The mandible develops lateral to which cartilage?", "Meckel's cartilage"),
    (
        "b3-06",
        8,
        2,
        "What does the dorsal end of Meckel's cartilage form?",
        "The malleus and incus",
    ),
    ("b3-07", 8, 2, "When does ossification of the mandible begin?", "The sixth week in utero"),
    (
        "b3-08",
        8,
        2,
        "Where is each primary mandibular ossification center located?",
        "Near the future mental foramen",
    ),
    (
        "b3-09",
        8,
        2,
        "How does the mandibular alveolar process begin to develop?",
        "Upward growth of inner and outer bony plates",
    ),
    (
        "b3-10",
        9,
        2,
        "Until roughly what age is condylar cartilage an important mandibular growth center?",
        "Twenty-one years",
    ),
    # Pages 10-12
    (
        "b4-01",
        10,
        3,
        "In which direction does condylar growth usually occur?",
        "Backward, upward, and outward",
    ),
    (
        "b4-02",
        10,
        3,
        "Upward and backward condylar growth moves the mandible in which direction?",
        "Downward and forward",
    ),
    (
        "b4-03",
        10,
        3,
        "How does vertical growth of the mandibular body occur?",
        "Surface apposition of bone",
    ),
    (
        "b4-04",
        10,
        3,
        "Where does bone apposition occur during anteroposterior mandibular growth?",
        "On the posterior border of the ramus",
    ),
    (
        "b4-05",
        10,
        3,
        "What produces transverse growth of the mandible?",
        "Periosteal apposition on the external surface",
    ),
    ("b4-06", 11, 3, "What is the approximate mandibular angle at birth?", "170 degrees"),
    ("b4-07", 11, 3, "What is the approximate mandibular angle in an adult?", "110 degrees"),
    (
        "b4-08",
        12,
        3,
        "Where is the mental foramen found after tooth loss in old age?",
        "Very near the upper border",
    ),
    (
        "b4-09",
        12,
        3,
        "Which two bones compose the human maxilla?",
        "The maxilla proper and premaxilla",
    ),
    (
        "b4-10",
        12,
        3,
        "What marks the union of maxilla and premaxilla on a young palate?",
        "The incisive fissure",
    ),
    # Pages 13-15
    (
        "b5-01",
        13,
        4,
        "When does ossification of the maxilla commence?",
        "The seventh week in utero",
    ),
    (
        "b5-02",
        13,
        4,
        "Where is the primary maxillary ossification center?",
        "Near the future canine fossa",
    ),
    (
        "b5-03",
        13,
        4,
        "Which process is formed by upward spread of maxillary ossification?",
        "The frontal process",
    ),
    ("b5-04", 13, 4, "Which teeth are supported by each premaxilla?", "The maxillary incisors"),
    (
        "b5-05",
        13,
        4,
        "Which secondary cartilage contributes to maxillary development?",
        "The zygomatic cartilage",
    ),
    (
        "b5-06",
        14,
        4,
        "What are the two main types of maxillary growth?",
        "Sutural growth and surface apposition",
    ),
    (
        "b5-07",
        14,
        4,
        "Where does maxillary surface apposition occur posteriorly?",
        "At the maxillary tuberosity",
    ),
    ("b5-08", 14, 4, "How does the lower lip develop?", "By merging of the mandibular processes"),
    (
        "b5-09",
        14,
        4,
        "Which processes form the upper lip?",
        "The maxillary and medial nasal processes",
    ),
    (
        "b5-10",
        15,
        4,
        "What causes a unilateral cleft lip?",
        "Failure of one maxillary process to fuse with the intermaxillary segment",
    ),
    # Page 16 is assessed only after it has been unlocked.
    (
        "final-01",
        16,
        5,
        "What causes a bilateral cleft lip?",
        "Failure of both maxillary processes to fuse with the intermaxillary segment",
    ),
    (
        "final-02",
        16,
        5,
        "What causes the rare median cleft lip?",
        "Failure of the medial nasal processes to merge",
    ),
)

QUESTIONS = tuple(StudyQuestion(*item) for item in _RAW_QUESTIONS)
CATALOG_MATERIAL_SLUGS = frozenset(
    {
        "conservative",
        "microbiology",
        "pharmacy",
        "general-pathology",
        "oral-histology",
        "fixed-prosthodontic",
        "removeable-prosthodontic",
    }
)
SUPPORTED_SHEETS = frozenset(
    {
        (material_slug, f"sheet-{number}")
        for material_slug in CATALOG_MATERIAL_SLUGS
        for number in (1, 2, 3)
    }
    | {("oral-histology", "sheet-4")}
)
OPTION_COUNTS = {"easy": 3, "medium": 4, "hard": 5}
XP_BY_DIFFICULTY = {"easy": 100, "medium": 150, "hard": 200}


def _stable_order(seed: str, values: list[str]) -> list[str]:
    return sorted(values, key=lambda value: hashlib.sha256(f"{seed}:{value}".encode()).hexdigest())


def _question_ids(run: ActiveStudyRun) -> list[str]:
    if run.unlocked_pages >= run.page_count:
        # Include the last page while keeping the final assessment at exactly 50 questions.
        return [question.id for question in QUESTIONS[:48]] + ["final-01", "final-02"]
    batch = max(0, min(4, (run.unlocked_pages // 3) - 1))
    return [question.id for question in QUESTIONS if question.batch == batch]


def _questions_for_run(
    run: ActiveStudyRun, *, include_answers: bool = False
) -> list[StudyQuestionPayload]:
    by_id = {question.id: question for question in QUESTIONS}
    selected = [by_id[question_id] for question_id in _question_ids(run)]
    all_answers = [question.answer for question in selected]
    option_count = OPTION_COUNTS[run.difficulty]
    payload = []
    for question in selected:
        distractors = _stable_order(
            f"{run.id}:{run.difficulty}:{question.id}",
            [answer for answer in all_answers if answer != question.answer],
        )[: option_count - 1]
        answers = _stable_order(f"options:{run.id}:{question.id}", [question.answer, *distractors])
        options: list[StudyOptionPayload] = [
            {
                "id": hashlib.sha256(f"{run.id}:{question.id}:{answer}".encode()).hexdigest()[:16],
                "text": answer,
            }
            for answer in answers
        ]
        item: StudyQuestionPayload = {
            "id": question.id,
            "page": question.page,
            "prompt": question.prompt,
            "options": options,
        }
        if include_answers:
            item["correct_option_id"] = next(
                option["id"] for option in options if option["text"] == question.answer
            )
        payload.append(item)
    return payload


def active_study_payload(run: ActiveStudyRun) -> dict[str, object]:
    final_ready = run.unlocked_pages >= run.page_count
    return {
        "id": str(run.id),
        "material_slug": run.material_slug,
        "sheet_slug": run.sheet_slug,
        "difficulty": run.difficulty,
        "page_count": run.page_count,
        "unlocked_pages": min(run.unlocked_pages, run.page_count),
        "status": run.status,
        "last_score": run.last_score,
        "last_outcome": run.last_outcome,
        "checkpoint_attempts": run.checkpoint_attempts,
        "final_attempts": run.final_attempts,
        "final_ready": final_ready,
        "quiz_question_count": 50 if final_ready else 10,
        "xp_reward": XP_BY_DIFFICULTY[run.difficulty],
        "xp_awarded": run.xp_awarded,
    }


@transaction.atomic
def start_active_study(
    *, user: User, material_slug: str, sheet_slug: str, difficulty: str, page_count: int
) -> tuple[ActiveStudyRun, bool]:
    if (material_slug, sheet_slug) not in SUPPORTED_SHEETS:
        raise ActiveStudyRuleError("Active Study is not available for this sheet yet.")
    if difficulty not in OPTION_COUNTS:
        raise ActiveStudyRuleError("Choose easy, medium, or hard difficulty.")
    if page_count != 16:
        raise ActiveStudyRuleError("This Active Study plan expects the 16-page published sheet.")
    existing = (
        ActiveStudyRun.objects.select_for_update()
        .filter(
            user=user,
            material_slug=material_slug,
            sheet_slug=sheet_slug,
            status=ActiveStudyRun.Status.ACTIVE,
        )
        .order_by("-updated_at")
        .first()
    )
    if existing is not None:
        return existing, False
    run = ActiveStudyRun.objects.create(
        user=user,
        material_slug=material_slug,
        sheet_slug=sheet_slug,
        difficulty=difficulty,
        page_count=page_count,
        unlocked_pages=min(3, page_count),
    )
    return run, True


def active_quiz(*, user: User, run_id: UUID) -> tuple[ActiveStudyRun, list[StudyQuestionPayload]]:
    try:
        run = ActiveStudyRun.objects.get(id=run_id, user=user)
    except ActiveStudyRun.DoesNotExist as error:
        raise ActiveStudyRuleError("Active Study run was not found.") from error
    if run.status != ActiveStudyRun.Status.ACTIVE:
        raise ActiveStudyRuleError("This Active Study run is already complete.")
    return run, _questions_for_run(run)


@transaction.atomic
def submit_active_quiz(
    *, user: User, run_id: UUID, answers: dict[str, str]
) -> tuple[ActiveStudyRun, dict[str, object]]:
    try:
        run = ActiveStudyRun.objects.select_for_update().get(id=run_id, user=user)
    except ActiveStudyRun.DoesNotExist as error:
        raise ActiveStudyRuleError("Active Study run was not found.") from error
    if run.status != ActiveStudyRun.Status.ACTIVE:
        raise ActiveStudyRuleError("This Active Study run is already complete.")
    questions = _questions_for_run(run, include_answers=True)
    expected_ids = {str(question["id"]) for question in questions}
    if set(answers) != expected_ids:
        raise ActiveStudyRuleError("Answer every question before submitting the test.")
    score = sum(
        1 for question in questions if answers[str(question["id"])] == question["correct_option_id"]
    )
    answered_at = timezone.now()
    attempt_number = run.checkpoint_attempts + run.final_attempts + 1
    subject_label = run.material_slug.replace("-", " ").title()
    source_label = run.sheet_slug.replace("-", " ").title()
    for position, question in enumerate(questions, start=1):
        selected_id = answers[str(question["id"])]
        correct_id = str(question["correct_option_id"])
        record_question_attempt(
            event=QuestionAttemptEvent(
                user=user,
                event_key=(
                    f"active-study:{run.id}:attempt:{attempt_number}:question:{question['id']}"
                ),
                canonical_key=(
                    f"active-study:{run.material_slug}:{run.sheet_slug}:{question['id']}"
                ),
                subject_key=f"catalog:{run.material_slug}",
                subject_label=subject_label,
                source_type=ReviewItem.SourceType.SHEET,
                source_id=f"{run.material_slug}:{run.sheet_slug}",
                source_label=source_label,
                source_question_index=position,
                prompt=str(question["prompt"]),
                explanation="",
                options=tuple(
                    {"id": option["id"], "text": option["text"]} for option in question["options"]
                ),
                selected_option_ids=(selected_id,),
                correct_option_ids=(correct_id,),
                is_correct=selected_id == correct_id,
                answered_at=answered_at,
            )
        )
    final = run.unlocked_pages >= run.page_count
    run.last_score = score
    if final:
        run.final_attempts += 1
        passed = score >= 35
        run.last_outcome = "passed" if passed else "blocked"
        if passed:
            run.status = ActiveStudyRun.Status.COMPLETED
            points = XP_BY_DIFFICULTY[run.difficulty]
            award, created = award_xp(
                user_id=user.id,
                source_key=f"active-study:{user.id}:{run.material_slug}:{run.sheet_slug}:{run.difficulty}",
                source_event_id=None,
                source_event_name="focus.active_study.completed",
                source_object_id=run.id,
                rule_code=f"active_study_{run.difficulty}_v1",
                points=points,
                category="learning",
                reason=f"{run.difficulty.title()} Active Study completed",
                occurred_at=answered_at,
                ranking_eligible=True,
            )
            run.xp_awarded = award.points if created else 0
    else:
        run.checkpoint_attempts += 1
        if score >= 7:
            run.last_outcome = "passed"
            run.unlocked_pages = min(run.page_count, run.unlocked_pages + 3)
        elif score >= 5:
            run.last_outcome = "advisory"
        else:
            run.last_outcome = "blocked"
    run.save()
    return run, {
        "score": score,
        "total": len(questions),
        "outcome": run.last_outcome,
        "can_continue": not final and run.last_outcome == "advisory",
        "completed": run.status == ActiveStudyRun.Status.COMPLETED,
        "xp_awarded": run.xp_awarded,
    }


@transaction.atomic
def continue_active_study(*, user: User, run_id: UUID) -> ActiveStudyRun:
    try:
        run = ActiveStudyRun.objects.select_for_update().get(id=run_id, user=user)
    except ActiveStudyRun.DoesNotExist as error:
        raise ActiveStudyRuleError("Active Study run was not found.") from error
    if run.status != ActiveStudyRun.Status.ACTIVE or run.last_outcome != "advisory":
        raise ActiveStudyRuleError("This checkpoint cannot be continued.")
    run.unlocked_pages = min(run.page_count, run.unlocked_pages + 3)
    run.last_outcome = "continued"
    run.save(update_fields=("unlocked_pages", "last_outcome", "updated_at"))
    return run
