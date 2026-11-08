"""Seed sample sheets, questions and activity for the staging student."""

from datetime import timedelta
from hashlib import sha256
from io import BytesIO
from os import environ
from uuid import NAMESPACE_URL, uuid5
from zoneinfo import ZoneInfo

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.files.base import ContentFile
from django.db import connection, transaction
from django.utils import timezone
from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject

from apps.content.active_study import DIFFICULTIES
from apps.content.admin_services import (
    create_sheet,
    save_active_study_question_content,
    update_active_study_settings,
)
from apps.content.catalog_subjects import project_subject_node
from apps.content.models import (
    ActiveStudyQuestionContent, ActiveStudySettings, CatalogDocument, LearningObject, SheetSummary,
)
from apps.content.sheet_summaries import SummaryChanges, create_summary, update_summary
from apps.education.models import CreatorScope, EducationNode
from apps.files.models import ManagedFile
from apps.focus.models import FocusSession, FocusTeam
from apps.focus.services import FocusTeamLimitError, create_focus_team
from apps.notifications.services import create_notification
from apps.progress.models import Bookmark, LearningProgress
from apps.progress.services import set_catalog_bookmark
from apps.questions.admin_services import import_questions
from apps.questions.answering import answer_question
from apps.questions.models import Question
from apps.streaks.services import active_policy, record_activity
from apps.study_plans.models import StudyPlanItem, StudyPlanProfile


AUTHOR_EMAIL = "staging-sheet-author@lockin.example"
SHEETS = (
    ("general-histology", "Demo - Epithelial Tissue", (
        ("Classification", "Simple epithelium has one layer of cells.",
         "Stratified epithelium has multiple layers and is named by its surface cells."),
        ("Basement membrane", "Epithelial cells rest on a basement membrane.",
         "Most epithelia receive nutrients by diffusion from underlying connective tissue."),
        ("Review", "Which type of epithelium has several layers of cells?",
         "Answer: stratified epithelium."),
    )),
    ("dental-anatomy", "Demo - Tooth Surfaces", (
        ("Proximal surfaces", "Mesial faces the midline of the dental arch.",
         "Distal faces away from the midline."),
        ("Other surfaces", "Buccal faces the cheek; lingual faces the tongue.",
         "Occlusal is the chewing surface of a posterior tooth."),
        ("Review", "Which surface of a molar faces the cheek?", "Answer: buccal."),
    )),
    ("physiology", "Demo - Cell Membrane Transport", (
        ("Passive transport", "Diffusion moves particles down a concentration gradient.",
         "Facilitated diffusion uses membrane proteins without directly consuming ATP."),
        ("Active transport", "Primary active transport uses energy from ATP.",
         "The sodium-potassium pump moves sodium out of the cell and potassium in."),
        ("Review", "Does facilitated diffusion move a solute against its gradient?",
         "Answer: no, it moves down its electrochemical gradient."),
    )),
)


QUESTIONS = {
    "general-histology": (
        (1, "How many layers does simple epithelium have?", ("One", "Two", "Three", "Four")),
        (1, "What names the type of stratified epithelium?", ("Surface cells", "Blood vessels", "Total cell count", "Nerve endings")),
        (2, "What structure supports epithelial cells?", ("Basement membrane", "Enamel", "Periosteum", "Myelin sheath")),
        (2, "How do most epithelia receive nutrients?", ("Diffusion from connective tissue", "Direct arterial flow", "Secretion by neurons", "Contraction of muscle")),
        (3, "Which epithelium has several layers of cells?", ("Stratified", "Simple", "A single-cell lining", "None of these")),
    ),
    "dental-anatomy": (
        (1, "Which surface faces the midline of the dental arch?", ("Mesial", "Distal", "Buccal", "Occlusal")),
        (1, "Which proximal surface faces away from the midline?", ("Distal", "Mesial", "Lingual", "Incisal")),
        (2, "Which molar surface faces the cheek?", ("Buccal", "Lingual", "Mesial", "Distal")),
        (2, "What is the chewing surface of a posterior tooth?", ("Occlusal", "Distal", "Buccal", "Lingual")),
        (3, "Which term describes the surface facing the tongue?", ("Lingual", "Buccal", "Mesial", "Distal")),
    ),
    "physiology": (
        (1, "Which process moves particles down a concentration gradient?", ("Diffusion", "Primary active transport", "Endocytosis", "Exocytosis")),
        (1, "What does facilitated diffusion use?", ("Membrane proteins", "Direct ATP hydrolysis", "Secretory vesicles", "Contractile fibers")),
        (2, "What powers primary active transport?", ("Energy from ATP", "Osmosis alone", "Passive diffusion", "Gravity")),
        (2, "Where does the sodium-potassium pump move sodium?", ("Out of the cell", "Into the cell", "Into the nucleus", "Into vesicles")),
        (3, "Which gradient drives facilitated diffusion?", ("The electrochemical gradient", "An ATP gradient", "A pressure wave", "None of these")),
    ),
}


def seed_questions(*, actor, sheet, slug):
    existing = Question.objects.filter(
        owner=actor, published_version__source_learning_object=sheet,
        published_version__metadata__staging_demo="v1",
    ).select_related("published_version").order_by("published_version__source_page", "id")
    if not existing.exists():
        rows = []
        for index, (page, prompt, choices) in enumerate(QUESTIONS[slug]):
            rotated = choices[index:] + choices[:index]
            rows.append({
                "type": "mcq", "question": prompt, "choices": list(rotated),
                "correct_answer": choices[0], "explanation": f"Correct answer: {choices[0]}.",
                "difficulty": "easy", "source_page": page,
            })
        for source, questions in (("ai-sheet", rows[:-1]), ("exam", rows[-1:])):
            import_questions(
                actor=actor, sheet=sheet, publish=True,
                metadata={"staging_demo": "v1", "source": source},
                payload={"version": "lockin_questions_v1", "questions": questions},
            )
    return list(existing)


def seed_active_study(*, actor, sheet, slug, page_count):
    settings = ActiveStudySettings.objects.filter(sheet=sheet, edition="university").first()
    if settings is None:
        update_active_study_settings(
            actor=actor, sheet_id=sheet.id, expected_revision=0, enabled=True,
            total_pdf_pages=page_count, excluded_start_pages=0, excluded_end_pages=0,
            confirm_boundary_change=True, questions_per_checkpoint=1, final_exam_questions=1,
        )
    elif not settings.enabled:
        return

    def bank_question(row, index):
        _, prompt, choices = row
        rotated = choices[index:] + choices[:index]
        return {
            "question": prompt, "options": dict(zip("ABCD", rotated, strict=True)),
            "correct_answer": "ABCD"[rotated.index(choices[0])],
            "explanation": f"Correct answer: {choices[0]}.",
        }

    rows = QUESTIONS[slug]
    payload = {
        "pages": [
            {"page": page, "questions": [bank_question(next(row for row in rows if row[0] == page), page)]}
            for page in range(1, page_count + 1)
        ],
        "final_exam": {"questions": [bank_question(rows[1], 2)]},
    }
    for difficulty in DIFFICULTIES:
        if not ActiveStudyQuestionContent.objects.filter(sheet=sheet, difficulty=difficulty.key).exists():
            save_active_study_question_content(
                actor=actor, sheet_id=sheet.id, difficulty_key=difficulty.key,
                payload=payload, expected_revision=0,
            )


def fixture_id(student, key):
    return uuid5(NAMESPACE_URL, f"lockin-staging:{student.pk}:{key}")


def seed_activity(*, student, sheet, document, branch, questions, title, notes, offset, now):
    for index, question in enumerate(questions[:2]):
        option = question.published_version.options.filter(is_correct=(index == 0)).first()
        answer_question(user=student, question=question, choice_ids=[option.id])

    LearningProgress.objects.get_or_create(
        user=student, learning_object=sheet,
        defaults={"version": document.version, "status": "in_progress",
                  "completion_percent": 33, "position": {"page": 2}},
    )
    if not Bookmark.objects.filter(
        user=student, catalog_material_slug=document.material_slug,
        catalog_sheet_slug=document.sheet_slug,
    ).exists():
        set_catalog_bookmark(
            user=student, material_slug=document.material_slug, material_title=branch.title,
            sheet_slug=document.sheet_slug, sheet_title=title, position={"page": 2},
        )
    today = now.astimezone(ZoneInfo("Africa/Tripoli")).date()
    StudyPlanItem.objects.get_or_create(
        user=student, client_request_id=fixture_id(student, f"plan:{sheet.pk}"),
        defaults={
            "title": title, "subject": branch.title, "catalog_subject": branch,
            "catalog_document": document, "content_version": document.version,
            "source_file": document.managed_file, "activity": "reading",
            "page_start": 1, "page_end": document.managed_file.pdf_page_count,
            "scheduled_date": today + timedelta(days=offset), "duration_minutes": 20,
        },
    )
    ended = now - timedelta(days=offset, minutes=30)
    FocusSession.objects.get_or_create(
        id=fixture_id(student, f"focus:{sheet.pk}"),
        defaults={
            "user": student, "status": "completed", "session_type": "material",
            "context_type": "study", "context_id": document.version_id,
            "topic": title, "started_at": ended - timedelta(minutes=20),
            "ended_at": ended, "last_activity_at": ended,
            "planned_duration_seconds": 1200, "active_duration_seconds": 1200,
        },
    )
    if "focus.deep_session" in active_policy().qualifying_activity_types:
        record_activity(
            user_id=student.pk, source_key=f"staging:focus:{sheet.pk}",
            activity_type="focus.deep_session", source_object_id=fixture_id(student, f"focus:{sheet.pk}"),
            occurred_at=ended, metadata={"staging_demo": True},
        )

    summary_title = f"Notes - {title}"
    summaries = SheetSummary.objects.filter(user=student, document=document)
    if not summaries.exists():
        summary = create_summary(
            user=student, document=document, title=summary_title, mode="keyboard", color="blue",
        )
        update_summary(
            user=student, summary_id=summary.pk,
            changes=SummaryChanges(expected_revision=summary.revision, pages={"1": notes}, finished=True),
        )
    create_notification(
        recipient_id=student.pk, category="learning", template_key="staging.sample_sheet",
        title=f"Sample sheet: {title}", body=f"Open {branch.title} to try the sample PDF.",
        deduplication_key=f"staging:sheet:{sheet.pk}", target_route="/materials",
    )


def make_pdf(title, pages):
    writer = PdfWriter()
    name = NameObject
    font = DictionaryObject({
        name("/Type"): name("/Font"),
        name("/Subtype"): name("/Type1"),
        name("/BaseFont"): name("/Helvetica"),
    })
    for index, lines in enumerate(pages, start=1):
        page = writer.add_blank_page(width=595, height=842)
        page[name("/Resources")] = DictionaryObject({
            name("/Font"): DictionaryObject({name("/F1"): font}),
        })
        stream = DecodedStreamObject()
        text_lines = (title, f"Lock-in staging | {index} / {len(pages)}", *lines)
        commands = ["BT /F1 13 Tf 22 TL 50 760 Td"]
        for line in text_lines:
            escaped = line.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
            commands.append(f"({escaped}) Tj T*")
        commands.append("ET")
        stream.set_data("\n".join(commands).encode("ascii"))
        page.replace_contents(stream)
    buffer = BytesIO()
    writer.write(buffer)
    return buffer.getvalue()


@transaction.atomic
def seed():
    if connection.settings_dict["NAME"] != "lockin_staging" or settings.CONTENT_REQUIRE_CLEAN_SCAN:
        raise RuntimeError("Expected the isolated staging database with local demo-file settings.")
    users = get_user_model().objects
    student = users.select_for_update(of=("self",)).select_related("cohort__program").get(
        email=environ["LOCKIN_DEMO_STUDENT"], cohort__program__code="dentistry-tripoli", cohort__code="year-1",
        cohort__is_active=True,
    )
    cohort = student.cohort
    StudyPlanProfile.objects.get_or_create(user=student)
    author = users.filter(email=AUTHOR_EMAIL).first()
    if author is None:
        author = users.create_user(email=AUTHOR_EMAIL, full_name="Lock-in staging sheets", password=None)
    if author.has_usable_password() or author.is_staff or author.is_superuser:
        raise RuntimeError("The demo author must be an unprivileged account without a password.")

    roots = tuple(cohort.content_nodes.values_list("path", flat=True))
    results = []
    now = timezone.now()
    for position, (slug, title, pages) in enumerate(SHEETS, start=901):
        candidates = EducationNode.objects.filter(kind=EducationNode.Kind.SUBJECT, slug=slug)
        subject, = [node for node in candidates if node.path.startswith(roots)]
        branch, _ = project_subject_node(subject, cohort=cohort)
        if branch is None or not branch.is_active or branch.cohort_id != cohort.id:
            raise RuntimeError(f"Missing active catalog branch for {slug}.")

        sheet = LearningObject.objects.filter(
            owner=author, published_version__academic_node=subject, published_version__title=title,
        ).first()
        scope = CreatorScope.objects.create(
            user=author, node=subject, granted_by=author,
            can_publish_content=True, can_create_assessments=True,
            can_publish_assessments=True,
        )
        if sheet is None:
            payload = make_pdf(title, pages)
            filename = f"staging-{slug}.pdf"
            managed = ManagedFile.objects.create(
                owner=author, original_name=filename, kind="pdf", content_type="application/pdf",
                size_bytes=len(payload), checksum_sha256=sha256(payload).hexdigest(),
                validation_status="ready", scan_status="not_configured", pdf_page_count=len(pages),
                blob=ContentFile(payload, name=filename),
            )
            sheet = create_sheet(
                actor=author, subject=subject, managed_file=managed, title=title,
                summary="Sample PDF for testing Lock-in on staging.",
                position=position, publish=True, notify_students=False, allow_download=True,
            )

        questions = seed_questions(actor=author, sheet=sheet, slug=slug)
        seed_active_study(actor=author, sheet=sheet, slug=slug, page_count=len(pages))
        scope.delete()
        document = CatalogDocument.objects.get(
            version_id=sheet.published_version_id, edition="university",
            is_active=True, material_slug=branch.material_slug,
        )
        seed_activity(
            student=student, sheet=sheet, document=document, branch=branch,
            questions=questions, title=title, notes=" ".join(pages[0][1:]),
            offset=position - 901, now=now,
        )
        results.append((branch.title, title, len(questions)))
    if not FocusTeam.objects.filter(owner=student, name="Demo Study Team").exists():
        try:
            create_focus_team(user=student, name="Demo Study Team")
        except FocusTeamLimitError:
            print("Demo team skipped: the account already has three open teams.")
    return results


for subject_title, sheet_title, question_count in seed():
    print(f"{subject_title}: {sheet_title} ({question_count} sample questions)")
