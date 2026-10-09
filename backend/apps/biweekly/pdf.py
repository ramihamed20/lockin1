"""Render one persistent private PDF from a frozen snapshot only."""

import base64
from datetime import timedelta
from pathlib import Path
from typing import Any

from django.conf import settings
from django.core.files.base import ContentFile
from django.db import transaction
from django.template.loader import render_to_string

from .models import BiweeklySnapshot


def _logo_data() -> str:
    path = Path(__file__).parent / "assets" / "lockin-logo.png"
    if not path.exists():
        return ""
    return "data:image/png;base64," + base64.b64encode(path.read_bytes()).decode("ascii")


def _duration(seconds: int | None) -> str:
    if seconds is None:
        return "—"
    hours, remainder = divmod(int(seconds), 3600)
    minutes = remainder // 60
    return f"{hours}h {minutes:02d}m" if hours else f"{minutes}m"


def _analysis_context(report: BiweeklySnapshot) -> dict[str, Any]:
    data = report.data
    metrics = data["metrics"]
    previous = data.get("previous_period_metrics")
    comparisons = []
    for key, label, unit in (
        ("study_time_seconds", "Study time", "duration"),
        ("questions_answered", "Questions answered", "count"),
        ("accuracy", "Accuracy", "percent"),
        ("active_days", "Active days", "count"),
        ("mistakes_mastered", "Mistakes mastered", "count"),
        ("hard_accuracy", "Hard question accuracy", "percent"),
    ):
        current = metrics.get(key)
        old = previous.get(key) if previous else None
        if current is None or old is None:
            continue
        if unit == "duration":
            old_display, current_display = _duration(old), _duration(current)
        elif unit == "percent":
            old_display, current_display = f"{old}%", f"{current}%"
        else:
            old_display, current_display = str(old), str(current)
        difference = current - old
        change = (
            f"{difference:+d} percentage points"
            if unit == "percent"
            else f"{difference:+d}"
            if unit == "count"
            else f"{difference / old:+.0%}"
            if old
            else "New activity"
        )
        comparisons.append(
            {
                "label": label,
                "previous": old_display,
                "current": current_display,
                "change": change,
            }
        )
    snapshot_metrics = [
        ("STUDY TIME", _duration(metrics["study_time_seconds"])),
        ("QUESTIONS", metrics["questions_answered"]),
        ("ACCURACY", f"{metrics['accuracy']}%" if metrics["accuracy"] is not None else "—"),
        ("XP EARNED", metrics["xp_earned"]),
        ("ACTIVE DAYS", f"{metrics['active_days']} / 7"),
        ("SHEETS COMPLETED", metrics["sheets_completed"]),
        ("CHECKPOINTS", metrics["active_study_checkpoints"]),
        ("FINAL EXAMS", metrics["final_exams_completed"]),
        ("MISTAKES MASTERED", metrics["mistakes_mastered"]),
    ]
    personal_bests = [
        {"label": "LONGEST FOCUS SESSION", "value": _duration(metrics["longest_session_seconds"])},
        {"label": "AVERAGE FOCUS SESSION", "value": _duration(metrics["average_session_seconds"])},
        {"label": "QUESTIONS PRACTICED", "value": metrics["questions_answered"]},
        {"label": "ACTIVE DAYS", "value": f"{metrics['active_days']} / 7"},
    ]
    next_steps = []
    if metrics["active_days"] < 7:
        next_steps.append("Aim for more regular study days in your next week.")
    if metrics["questions_answered"] < 10:
        next_steps.append("Try a short question practice set to build a clearer performance trend.")
    elif metrics["accuracy"] is not None and metrics["accuracy"] < 70:
        next_steps.append("Return to the questions you missed and read their explanations.")
    if metrics["mistakes_unresolved"]:
        next_steps.append("Open Review and revisit your unresolved mistakes.")
    if not next_steps:
        next_steps.append("Keep a steady study rhythm and review your next report in 7 days.")
    return {
        "metrics": metrics,
        "study_time": _duration(metrics["study_time_seconds"]),
        "average_session": _duration(metrics["average_session_seconds"]),
        "longest_session": _duration(metrics["longest_session_seconds"]),
        "subjects": data.get("subject_performance", []),
        "insights": data.get("insights", []),
        "comparisons": comparisons,
        "snapshot_metrics": snapshot_metrics,
        "personal_bests": personal_bests,
        "subject_study_time": [
            {**row, "duration": _duration(row["seconds"])}
            for row in data.get("subject_study_time", [])
        ],
        "most_studied_sheet": data.get("most_studied_sheet"),
        "difficulty_performance": data.get("difficulty_performance", []),
        "next_steps": next_steps[:3],
    }


def _review_context(report: BiweeklySnapshot) -> dict[str, Any]:
    questions = report.data.get("questions", [])
    pages = []
    for index in range(0, len(questions), 3):
        chunk = questions[index : index + 3]
        pages.append(
            {
                "questions": [
                    {
                        **question,
                        "number": index + offset + 1,
                        "question_type_label": {
                            "single_choice": "MCQ",
                            "true_false": "TRUE / FALSE",
                            "multiple_select": "MULTIPLE CHOICE",
                        }.get(
                            question["question_type"],
                            question["question_type"].replace("_", " ").upper(),
                        ),
                        "long": len(
                            question["prompt"]
                            + question["explanation"]
                            + "".join(option["text"] for option in question["options"])
                        )
                        > 1200,
                    }
                    for offset, question in enumerate(chunk)
                ]
            }
        )
    return {"pages": pages, "mistake_count": report.data.get("mistake_count", 0)}


def render_pdf(report: BiweeklySnapshot) -> bytes:
    from weasyprint import HTML, default_url_fetcher

    def safe_fetch(url: str) -> dict[str, Any]:
        if url.startswith("data:image/png;base64,"):
            fetched: dict[str, Any] = default_url_fetcher(url)
            return fetched
        raise ValueError("External resources are not permitted in a study report.")

    context = {
        "report": report,
        "logo_data": _logo_data(),
        "period_label": (
            f"{report.period_start:%d %b} – {report.period_end - timedelta(days=1):%d %b %Y}"
        ),
    }
    if report.report_type == BiweeklySnapshot.Type.ANALYSIS:
        context.update(_analysis_context(report))
        template = "biweekly/analysis.html"
    else:
        context.update(_review_context(report))
        template = "biweekly/review.html"
    html = render_to_string(template, context)
    document = HTML(string=html, base_url=str(settings.BASE_DIR), url_fetcher=safe_fetch)
    rendered: bytes = document.write_pdf()
    return rendered


@transaction.atomic
def ensure_pdf(report: BiweeklySnapshot) -> BiweeklySnapshot:
    locked = BiweeklySnapshot.objects.select_for_update().get(pk=report.pk)
    if locked.pdf and locked.pdf.storage.exists(locked.pdf.name):
        return locked
    content = render_pdf(locked)
    filename = f"{locked.id}.pdf"
    locked.pdf.save(filename, ContentFile(content), save=True)
    return locked
