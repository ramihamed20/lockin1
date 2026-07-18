from dataclasses import dataclass


class Metric:
    REGISTRATIONS = "registrations"
    DAILY_ACTIVE_LEARNERS = "daily_active_learners"
    LESSON_COMPLETIONS = "lesson_completions"
    FOCUS_SESSIONS = "focus_sessions"
    FOCUS_MINUTES = "focus_minutes"
    QUIZ_SUBMISSIONS = "quiz_submissions"
    MASTERY_PASSES = "mastery_passes"
    COMMUNITY_CONTRIBUTIONS = "community_contributions"
    SUBSCRIPTIONS_STARTED = "subscriptions_started"
    PAYMENT_SUCCEEDED_COUNT = "payment_succeeded_count"
    GROSS_REVENUE_MINOR = "gross_revenue_minor"


@dataclass(frozen=True, slots=True)
class MetricDefinition:
    code: str
    label: str
    unit: str
    finance_only: bool = False


METRICS = {
    item.code: item
    for item in (
        MetricDefinition(Metric.REGISTRATIONS, "Registrations", "count"),
        MetricDefinition(Metric.DAILY_ACTIVE_LEARNERS, "Daily active learners", "learners"),
        MetricDefinition(Metric.LESSON_COMPLETIONS, "Lesson completions", "count"),
        MetricDefinition(Metric.FOCUS_SESSIONS, "Completed focus sessions", "count"),
        MetricDefinition(Metric.FOCUS_MINUTES, "Focused study time", "minutes"),
        MetricDefinition(Metric.QUIZ_SUBMISSIONS, "Quiz submissions", "count"),
        MetricDefinition(Metric.MASTERY_PASSES, "Mastery passes", "count"),
        MetricDefinition(
            Metric.COMMUNITY_CONTRIBUTIONS, "Learning discussions and replies", "count"
        ),
        MetricDefinition(Metric.SUBSCRIPTIONS_STARTED, "Subscriptions started", "count"),
        MetricDefinition(
            Metric.PAYMENT_SUCCEEDED_COUNT, "Successful payments", "count", finance_only=True
        ),
        MetricDefinition(
            Metric.GROSS_REVENUE_MINOR,
            "Gross collected amount",
            "minor_currency_units",
            finance_only=True,
        ),
    )
}

LEARNING_ACTIVITY_METRICS = frozenset(
    {
        Metric.LESSON_COMPLETIONS,
        Metric.FOCUS_SESSIONS,
        Metric.QUIZ_SUBMISSIONS,
        Metric.COMMUNITY_CONTRIBUTIONS,
    }
)
