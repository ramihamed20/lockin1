from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from apps.content.admin_services import edition_primary_file, has_publication_history
from apps.content.all_questions import all_questions_context
from apps.content.editions import UNIVERSITY
from apps.content.models import ActiveStudyQuestionContent, LearningObject
from apps.content.services import ContentRuleError
from apps.files.services import managed_file_delivery_ready

from .catalog import Capability
from .models import AutomationJob


class AutomationBlocked(ValueError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class TaskDefinition:
    label: str
    view_permissions: tuple[str, ...]
    write_permissions: tuple[str, ...]
    prepare: Callable[[AutomationJob], dict[str, Any]]
    success_status: str


def sheet_task_context(sheet: LearningObject, normal_count: int) -> dict[str, Any]:
    if sheet.workflow_status != LearningObject.WorkflowStatus.DRAFT or has_publication_history(
        sheet
    ):
        raise AutomationBlocked("sheet_not_draft", "Choose a sheet with no publication history.")
    if ActiveStudyQuestionContent.objects.filter(sheet=sheet).exists():
        raise AutomationBlocked(
            "existing_questions", "This sheet already has an Active Study bank."
        )
    try:
        context = all_questions_context(sheet=sheet, edition=UNIVERSITY)
    except ContentRuleError as error:
        raise AutomationBlocked("invalid_plan", str(error)) from error
    normal = context["sheet_questions"]
    if not isinstance(normal, dict) or normal["existing_count"]:
        raise AutomationBlocked("existing_questions", "This sheet already has Normal Questions.")
    if not 0 <= normal_count <= normal["max_count"]:
        raise AutomationBlocked("invalid_count", "Normal Question count exceeds the planner limit.")
    return context


def prepare_question_task(job: AutomationJob) -> dict[str, Any]:
    sheet = job.learning_object
    if sheet is None or sheet.revision != job.input_manifest["sheet_revision"]:
        raise AutomationBlocked("stale_sheet", "The source sheet changed. Queue a fresh task.")
    file = edition_primary_file(sheet, UNIVERSITY)
    if file is None or not managed_file_delivery_ready(file):
        raise AutomationBlocked(
            "pdf_unavailable", "The PDF must pass validation and its required scan."
        )
    normal_count = int(job.input_manifest["normal_count"])
    context = sheet_task_context(sheet, normal_count)
    if context["settings_revision"] != job.input_manifest["settings_revision"]:
        raise AutomationBlocked(
            "stale_settings", "Active Study settings changed. Queue a fresh task."
        )
    return {
        "schema": "lockin.question_task.v1",
        "sheet_id": str(sheet.id),
        "source_sha256": file.checksum_sha256,
        "normal_count": normal_count,
        "plan": context,
    }


TASKS = {
    "question_package": TaskDefinition(
        label="Question task package",
        view_permissions=(Capability.CONTENT_VIEW, Capability.ASSESSMENTS_VIEW),
        write_permissions=(Capability.CONTENT_MANAGE, Capability.ASSESSMENTS_MANAGE),
        prepare=prepare_question_task,
        success_status=AutomationJob.Status.READY_FOR_AI,
    ),
}
