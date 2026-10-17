"""Public question identities shared by Active Study, Review and Explain links."""

from typing import Any

from apps.content.page_question_bank import select_page_questions


def question_key(
    run: Any, kind: str, part: int | None, position: int, source_key: str | None = None
) -> str:
    prefix = f"active-study:{run.sheet_id}:{run.difficulty}:"
    if source_key:
        return f"{prefix}bank:{run.plan_signature.get('content_revision')}:{source_key}"
    return f"{prefix}{kind}:{part}:{position}"


def canonical_keys_for_attempt(attempt: Any, bank: Any) -> dict[int, str]:
    """Resolve selected questions without treating custom groups as legacy parts."""
    run = attempt.run
    if "pages" not in bank.payload or attempt.kind == "final":
        return {
            position: question_key(run, attempt.kind, attempt.part_number, position)
            for position in range(1, attempt.total + 1)
        }
    if run.plan_signature.get("content_revision") != bank.revision:
        return {}
    try:
        if run.study_mode == "custom":
            source_range = run.plan_signature["page_ranges"][attempt.part_number - 1]
            offset = run.plan_signature["source_page_offset"]
        else:
            source_range = bank.plan_signature["page_ranges"][attempt.part_number - 1]
            offset = 0
        questions = select_page_questions(
            bank.payload,
            source_range["start_page"] + offset,
            source_range["end_page"] + offset,
            run.plan_signature["questions_per_checkpoint"],
        )
    except (KeyError, IndexError, TypeError, ValueError):
        return {}
    return {
        position: question_key(
            run, attempt.kind, attempt.part_number, position, question["source_key"]
        )
        for position, question in enumerate(questions, 1)
    }
