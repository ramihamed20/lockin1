from decimal import Decimal
from typing import Any

from django.utils import timezone
from rest_framework import serializers

from platform_core.api.serializers import StrictSerializer

from .attempt_services import result_is_released
from .models import (
    Attempt,
    AttemptActivity,
    AttemptAnswer,
    AttemptQuestion,
    AttemptResult,
    QuestionIssueReport,
    Quiz,
    QuizVersion,
    QuizVersionQuestion,
)


class QuizVersionQuestionManagementSerializer(serializers.ModelSerializer[QuizVersionQuestion]):
    question_id = serializers.UUIDField(source="question_version.question_id", read_only=True)
    question_version_id = serializers.UUIDField(read_only=True)
    prompt = serializers.CharField(source="question_version.prompt", read_only=True)

    class Meta:
        model = QuizVersionQuestion
        fields = ("id", "position", "question_id", "question_version_id", "prompt")
        read_only_fields = fields


class QuizVersionManagementSerializer(serializers.ModelSerializer[QuizVersion]):
    academic_node_id = serializers.UUIDField(read_only=True)
    academic_node_title = serializers.CharField(source="academic_node.title", read_only=True)
    question_links = QuizVersionQuestionManagementSerializer(many=True, read_only=True)

    class Meta:
        model = QuizVersion
        fields = (
            "id",
            "version_number",
            "academic_node_id",
            "academic_node_title",
            "title",
            "instructions",
            "mode",
            "selection_mode",
            "question_count",
            "duration_seconds",
            "maximum_attempts",
            "available_from",
            "available_until",
            "randomize_questions",
            "randomize_options",
            "result_release",
            "pass_percent",
            "ranking_eligible",
            "achievement_eligible",
            "focus_required",
            "allowed_difficulties",
            "language",
            "metadata",
            "question_links",
            "created_at",
        )
        read_only_fields = fields


class QuizManagementSerializer(serializers.ModelSerializer[Quiz]):
    owner_name = serializers.CharField(source="owner.full_name", read_only=True)
    owner_email = serializers.EmailField(source="owner.email", read_only=True)
    current_version = QuizVersionManagementSerializer(read_only=True)
    published_version_id = serializers.UUIDField(read_only=True, allow_null=True)

    class Meta:
        model = Quiz
        fields = (
            "id",
            "owner",
            "owner_name",
            "owner_email",
            "current_version",
            "published_version_id",
            "workflow_status",
            "review_note",
            "revision",
            "published_at",
            "retired_at",
            "updated_at",
        )
        read_only_fields = fields


class QuizVersionPublicSerializer(serializers.ModelSerializer[QuizVersion]):
    academic_node_id = serializers.UUIDField(read_only=True)
    academic_node_title = serializers.CharField(source="academic_node.title", read_only=True)

    class Meta:
        model = QuizVersion
        fields = (
            "id",
            "version_number",
            "academic_node_id",
            "academic_node_title",
            "title",
            "instructions",
            "mode",
            "selection_mode",
            "question_count",
            "duration_seconds",
            "maximum_attempts",
            "available_from",
            "available_until",
            "randomize_questions",
            "randomize_options",
            "result_release",
            "pass_percent",
            "focus_required",
            "allowed_difficulties",
            "language",
        )
        read_only_fields = fields


class QuizPublicSerializer(serializers.ModelSerializer[Quiz]):
    version = QuizVersionPublicSerializer(source="published_version", read_only=True)

    class Meta:
        model = Quiz
        fields = ("id", "version", "published_at")
        read_only_fields = fields


class QuizWriteSerializer(StrictSerializer):
    academic_node_id = serializers.UUIDField()
    title = serializers.CharField(max_length=220, trim_whitespace=True)
    instructions = serializers.CharField(
        max_length=10_000,
        trim_whitespace=True,
        required=False,
        default="",
    )
    mode = serializers.ChoiceField(choices=QuizVersion.Mode.choices)
    selection_mode = serializers.ChoiceField(choices=QuizVersion.SelectionMode.choices)
    question_count = serializers.IntegerField(min_value=1, max_value=100)
    question_ids = serializers.ListField(
        child=serializers.UUIDField(),
        required=False,
        default=list,
        max_length=100,
    )
    duration_seconds = serializers.IntegerField(
        min_value=60,
        max_value=14_400,
        allow_null=True,
        required=False,
        default=None,
    )
    maximum_attempts = serializers.IntegerField(min_value=0, max_value=100, default=0)
    available_from = serializers.DateTimeField(allow_null=True, required=False, default=None)
    available_until = serializers.DateTimeField(allow_null=True, required=False, default=None)
    randomize_questions = serializers.BooleanField(default=True)
    randomize_options = serializers.BooleanField(default=True)
    result_release = serializers.ChoiceField(
        choices=QuizVersion.ResultRelease.choices,
        default=QuizVersion.ResultRelease.IMMEDIATE,
    )
    pass_percent = serializers.DecimalField(
        max_digits=5,
        decimal_places=2,
        min_value=0,
        max_value=100,
        default=Decimal("60.00"),
    )
    ranking_eligible = serializers.BooleanField(default=False)
    achievement_eligible = serializers.BooleanField(default=False)
    focus_required = serializers.BooleanField(default=False)
    allowed_difficulties = serializers.ListField(
        child=serializers.ChoiceField(choices=("easy", "medium", "hard")),
        required=False,
        default=list,
        max_length=3,
    )
    language = serializers.CharField(max_length=12, default="en")
    metadata = serializers.JSONField(required=False, default=dict)

    def validate_question_ids(self, value: list[Any]) -> list[Any]:
        if len(set(value)) != len(value):
            raise serializers.ValidationError("Question identifiers must be unique.")
        return value

    def validate_metadata(self, value: Any) -> dict[str, object]:
        if not isinstance(value, dict):
            raise serializers.ValidationError("Metadata must be an object.")
        return value


class QuizUpdateSerializer(QuizWriteSerializer):
    expected_revision = serializers.IntegerField(min_value=1)


class RevisionActionSerializer(StrictSerializer):
    expected_revision = serializers.IntegerField(min_value=1)


class RejectQuizSerializer(RevisionActionSerializer):
    review_note = serializers.CharField(max_length=4000, trim_whitespace=True)


class AttemptStartSerializer(StrictSerializer):
    idempotency_key = serializers.UUIDField()
    question_count = serializers.IntegerField(min_value=1, max_value=100, required=False)
    difficulties = serializers.ListField(
        child=serializers.ChoiceField(choices=("easy", "medium", "hard")),
        required=False,
        default=list,
        max_length=3,
    )
    review_only = serializers.BooleanField(default=False)

    def validate_difficulties(self, value: list[str]) -> list[str]:
        if len(set(value)) != len(value):
            raise serializers.ValidationError("Difficulty filters must be unique.")
        return value


class AttemptAnswerSerializer(serializers.ModelSerializer[AttemptAnswer]):
    class Meta:
        model = AttemptAnswer
        fields = (
            "selected_option_ids",
            "client_revision",
            "server_revision",
            "saved_at",
        )
        read_only_fields = fields


class AttemptQuestionSerializer(serializers.ModelSerializer[AttemptQuestion]):
    answer = serializers.SerializerMethodField()

    class Meta:
        model = AttemptQuestion
        fields = (
            "id",
            "position",
            "prompt",
            "question_type",
            "difficulty",
            "language",
            "option_snapshot",
            "max_points",
            "answer",
        )
        read_only_fields = fields

    def get_answer(self, question: AttemptQuestion) -> dict[str, Any] | None:
        answer = getattr(question, "answer", None)
        return AttemptAnswerSerializer(answer).data if answer is not None else None


class AttemptSerializer(serializers.ModelSerializer[Attempt]):
    quiz_title = serializers.CharField(source="quiz_version.title", read_only=True)
    mode = serializers.CharField(source="quiz_version.mode", read_only=True)
    focus_required = serializers.BooleanField(source="quiz_version.focus_required", read_only=True)
    questions = AttemptQuestionSerializer(many=True, read_only=True)
    server_time = serializers.SerializerMethodField()
    focus_context = serializers.SerializerMethodField()
    result_id = serializers.SerializerMethodField()

    class Meta:
        model = Attempt
        fields = (
            "id",
            "quiz_id",
            "quiz_version_id",
            "quiz_title",
            "mode",
            "status",
            "review_only",
            "requested_question_count",
            "server_revision",
            "started_at",
            "deadline_at",
            "completed_at",
            "focus_required",
            "focus_context",
            "server_time",
            "result_id",
            "questions",
        )
        read_only_fields = fields

    def get_server_time(self, attempt: Attempt) -> Any:
        return timezone.now()

    def get_focus_context(self, attempt: Attempt) -> dict[str, str]:
        return {"context_type": "quiz", "context_id": str(attempt.id)}

    def get_result_id(self, attempt: Attempt) -> str | None:
        try:
            return str(attempt.result.id)
        except AttemptResult.DoesNotExist:
            return None


class AnswerSaveSerializer(StrictSerializer):
    selected_option_ids = serializers.ListField(
        child=serializers.UUIDField(),
        min_length=0,
        max_length=1,
    )
    client_revision = serializers.IntegerField(min_value=1)


class AttemptSubmitSerializer(StrictSerializer):
    idempotency_key = serializers.UUIDField()


class ResultQuestionSerializer(serializers.ModelSerializer[AttemptQuestion]):
    selected_option_ids = serializers.SerializerMethodField()
    correct = serializers.SerializerMethodField()

    class Meta:
        model = AttemptQuestion
        fields = (
            "id",
            "position",
            "prompt",
            "question_type",
            "difficulty",
            "option_snapshot",
            "selected_option_ids",
            "correct_option_ids",
            "correct",
            "explanation",
            "max_points",
        )
        read_only_fields = fields

    def get_selected_option_ids(self, question: AttemptQuestion) -> list[str]:
        answer = getattr(question, "answer", None)
        return list(answer.selected_option_ids) if answer is not None else []

    def get_correct(self, question: AttemptQuestion) -> bool:
        return set(self.get_selected_option_ids(question)) == set(question.correct_option_ids)


class AttemptResultSerializer(serializers.ModelSerializer[AttemptResult]):
    released = serializers.SerializerMethodField()
    release_at = serializers.SerializerMethodField()
    questions = serializers.SerializerMethodField()
    quiz_title = serializers.CharField(source="attempt.quiz_version.title", read_only=True)
    mode = serializers.CharField(source="attempt.quiz_version.mode", read_only=True)
    attempt_status = serializers.CharField(source="attempt.status", read_only=True)

    class Meta:
        model = AttemptResult
        fields = (
            "id",
            "attempt_id",
            "quiz_title",
            "mode",
            "attempt_status",
            "released",
            "release_at",
            "score_points",
            "maximum_points",
            "percentage",
            "passed",
            "answered_count",
            "unanswered_count",
            "submitted_at",
            "questions",
        )
        read_only_fields = fields

    def get_released(self, result: AttemptResult) -> bool:
        return result_is_released(result=result)

    def get_release_at(self, result: AttemptResult) -> Any:
        version = result.attempt.quiz_version
        return (
            version.available_until
            if version.result_release == QuizVersion.ResultRelease.AFTER_CLOSE
            else result.submitted_at
        )

    def get_questions(self, result: AttemptResult) -> list[dict[str, Any]] | None:
        if not self.get_released(result):
            return None
        questions = result.attempt.questions.all()
        return list(ResultQuestionSerializer(questions, many=True).data)

    def to_representation(self, instance: AttemptResult) -> dict[str, Any]:
        payload = super().to_representation(instance)
        if not payload["released"]:
            for field in (
                "score_points",
                "maximum_points",
                "percentage",
                "passed",
                "answered_count",
                "unanswered_count",
            ):
                payload[field] = None
        return payload


class AttemptActivityWriteSerializer(StrictSerializer):
    client_event_id = serializers.UUIDField()
    activity_type = serializers.ChoiceField(choices=AttemptActivity.ActivityType.choices)
    client_occurred_at = serializers.DateTimeField(allow_null=True, required=False, default=None)
    metadata = serializers.JSONField(required=False, default=dict)

    def validate_metadata(self, value: Any) -> dict[str, object]:
        if not isinstance(value, dict):
            raise serializers.ValidationError("Metadata must be an object.")
        return value


class AttemptActivitySerializer(serializers.ModelSerializer[AttemptActivity]):
    class Meta:
        model = AttemptActivity
        fields = (
            "id",
            "client_event_id",
            "activity_type",
            "client_occurred_at",
            "server_received_at",
        )
        read_only_fields = fields


class QuestionIssueReportWriteSerializer(StrictSerializer):
    attempt_question_id = serializers.UUIDField()
    category = serializers.ChoiceField(choices=QuestionIssueReport.Category.choices)
    details = serializers.CharField(max_length=4000, trim_whitespace=True)


class QuestionIssueReportSerializer(serializers.ModelSerializer[QuestionIssueReport]):
    class Meta:
        model = QuestionIssueReport
        fields = (
            "id",
            "result_id",
            "attempt_question_id",
            "category",
            "details",
            "status",
            "created_at",
        )
        read_only_fields = fields


class QuestionReviewSerializer(serializers.Serializer[Any]):
    question_id = serializers.UUIDField()
    prompt = serializers.CharField()
    academic_node_id = serializers.UUIDField()
    academic_node_title = serializers.CharField()
    difficulty = serializers.CharField()
    due_at = serializers.DateTimeField()
    interval_days = serializers.IntegerField()
    repetitions = serializers.IntegerField()
    lapses = serializers.IntegerField()
    mastery_state = serializers.CharField()
