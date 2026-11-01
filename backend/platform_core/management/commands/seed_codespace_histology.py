"""Isolated Codespaces Intro Histology (Tripoli) demo; never runs in production."""

import hashlib
from datetime import timedelta
from typing import Any

from django.conf import settings
from django.core.files.base import ContentFile
from django.core.management import BaseCommand, CommandError
from django.utils import timezone

from apps.accounts.models import User
from apps.content.models import (
    CatalogDocument,
    CatalogSubject,
    LearningObject,
    LearningObjectAsset,
    LearningObjectVersion,
    StudyAssistanceIdea,
)
from apps.education.models import EducationNode
from apps.files.models import ManagedFile
from apps.questions.models import Question, QuestionOption, QuestionVersion
from apps.study_plans.exam_models import ExamPeriod, ExamSchedule, ExamSyllabusScope
from apps.study_plans.models import StudySheetDifficulty

MATERIAL_SLUG = "codespace-tripoli-intro-histology"
SHEET_SLUG = "intro-histology-sample"
SHEET_TITLE = "Intro Histology - Tripoli (Demo Sheet 01)"
PDF_NAME = "intro-histology-tripoli-demo.pdf"

PAGES = (
    (
        "01 / WHAT IS HISTOLOGY?",
        (
            "Histology examines the microscopic structure of tissues and organs.",
            "A tissue contains cells and extracellular material with a shared role.",
            "Cells and extracellular matrix determine many tissue properties.",
            "Microscopes reveal structures that are too small for the naked eye.",
            "Four basic tissue types organize most of the human body.",
            "They are epithelial, connective, muscular and nervous tissues.",
        ),
    ),
    (
        "02 / EPITHELIAL TISSUE",
        (
            "Epithelium covers surfaces, lines cavities and forms many glands.",
            "Epithelial cells are tightly packed with little extracellular matrix.",
            "Apical surfaces face a lumen or the external environment.",
            "Basal surfaces attach to an underlying basement membrane.",
            "Simple epithelium has one layer; stratified has multiple layers.",
            "Functions include protection, absorption and secretion.",
        ),
    ),
    (
        "03 / OTHER TISSUES",
        (
            "Connective tissue supports and links other tissues.",
            "It usually has cells embedded in an extracellular matrix.",
            "Collagen fibers add tensile strength to many connective tissues.",
            "Muscle tissue is specialized to contract and generate force.",
            "Nervous tissue includes neurons and supporting glial cells.",
            "Neurons transmit electrical and chemical signals.",
        ),
    ),
    (
        "04 / HISTOLOGY SLIDES",
        (
            "Tissues are often fixed, embedded, sectioned and stained.",
            "Hematoxylin commonly colors nuclei blue to purple.",
            "Eosin commonly colors many cytoplasmic proteins pink.",
            "The objective lens is a major source of microscope magnification.",
            "Start at low power to find the tissue and its orientation.",
            "Assess cell shape, arrangement, matrix and tissue boundaries.",
        ),
    ),
)

# Source page, prompt, four options (correct answer first), explanation.
QUESTIONS = (
    (1, "What does histology study?", ("Microscopic tissue structure", "Only organ function", "Only bone fractures", "Only blood pressure"), "Histology studies microscopic tissue structure."),
    (1, "How many basic tissue types are commonly described?", ("Four", "Two", "Six", "Ten"), "Epithelial, connective, muscle and nervous are the four basic types."),
    (2, "Which tissue covers and lines many body surfaces?", ("Epithelial tissue", "Muscle tissue", "Nervous tissue", "Bone tissue"), "Epithelium covers surfaces and lines cavities."),
    (2, "Which side of an epithelial cell faces a lumen?", ("Apical", "Basal", "Periosteal", "Deep dermal"), "The apical surface faces the lumen or exterior."),
    (3, "Which component gives many connective tissues tensile strength?", ("Collagen fibers", "Neuronal axons", "Epithelial cilia", "Hemoglobin"), "Collagen is a major tensile-strength fiber."),
    (3, "What is the primary specialization of muscle tissue?", ("Contraction", "Signal storage", "Mineral filtration", "Light detection"), "Muscle tissue contracts to generate force."),
    (4, "Which stain commonly colors nuclei blue-purple?", ("Hematoxylin", "Eosin", "Oil red O", "Sudan black"), "Hematoxylin commonly stains nuclei blue to purple."),
    (4, "What is the best first magnification for exploring a new slide?", ("Low power", "Maximum oil immersion", "Maximum zoom immediately", "No objective lens"), "Low power helps orient the specimen."),
)


# Page, kind, teaser, question, explanation, follow-up question and answer.
# These ideas are reviewed against PAGES above; they are not live AI responses.
ASSISTANCE_IDEAS = (
    (
        1, "understand", "What does Histology really study?",
        "Why is histology different from looking at organs with the naked eye?",
        "Histology studies the microscopic arrangement of cells and tissues. "
        "A microscope helps us see structures that cannot be resolved by the naked eye.",
        "What tool lets us examine these details?",
        "A microscope.",
    ),
    (
        1, "memory", "Remember the four tissue families",
        "Which four basic tissues organize the human body?",
        "The four basic tissue types are epithelial, connective, muscular and nervous. "
        "Recognizing their distinctive cells and matrix is a starting point for histology.",
        "Name the tissue specialized for contraction.",
        "Muscular tissue.",
    ),
    (
        1, "organize", "Cells + matrix = tissue structure",
        "Why should you look beyond the cells in a tissue?",
        "The extracellular matrix surrounding the cells also contributes to tissue "
        "structure and function. The proportion of cells and matrix can differ by tissue.",
        "What is the material outside the cells called?",
        "Extracellular matrix.",
    ),
    (
        2, "understand", "Find the apical surface",
        "How do you identify the apical surface of epithelium?",
        "The apical surface faces a lumen or the outside environment. "
        "The basal surface faces the underlying basement membrane.",
        "Which side attaches to the basement membrane?",
        "The basal surface.",
    ),
    (
        2, "memory", "Simple vs. stratified",
        "What is the difference between simple and stratified epithelium?",
        "Simple epithelium has one cell layer. Stratified epithelium "
        "has more than one layer. This is a useful first distinction on a slide.",
        "Which one has multiple layers?",
        "Stratified epithelium.",
    ),
    (
        2, "organize", "Think: cover, absorb, secrete",
        "What are three functions of epithelial tissue?",
        "Epithelial tissue forms surface and cavity linings as well as many glands. "
        "Its functions include protection, absorption and secretion.",
        "Does epithelium generally have a large extracellular matrix?",
        "No. The cells are tightly packed, with relatively little extracellular matrix.",
    ),
    (
        3, "understand", "Why collagen matters",
        "How does collagen help connective tissue?",
        "Collagen fibers provide tensile strength in many connective tissues. "
        "The extracellular matrix is an important part of their structure.",
        "What provides tensile strength in many connective tissues?",
        "Collagen fibers.",
    ),
    (
        3, "memory", "Muscle = movement through contraction",
        "What is the key specialization of muscle tissue?",
        "Muscle tissue is specialized to contract and generate force. "
        "That ability distinguishes it from the other basic tissue types.",
        "What produces force in muscle tissue?",
        "Contraction.",
    ),
    (
        3, "organize", "Neurons and their supporting cells",
        "What two kinds of cells are noted for nervous tissue here?",
        "Nervous tissue contains neurons and supporting glial cells. "
        "Neurons transmit electrical and chemical signals.",
        "Which cells transmit signals?",
        "Neurons.",
    ),
    (
        4, "understand", "How a histology slide is made",
        "Which preparation steps commonly precede microscopic examination?",
        "Tissue is commonly fixed, embedded, sectioned and stained. "
        "These steps help make the microscopic structures visible.",
        "Why is tissue stained?",
        "To help different structures become visible and distinguishable.",
    ),
    (
        4, "memory", "Hematoxylin vs. eosin",
        "What are the common colors produced by hematoxylin and eosin?",
        "Hematoxylin commonly stains nuclei blue to purple; eosin "
        "commonly stains many cytoplasmic proteins pink.",
        "Which one commonly makes nuclei blue-purple?",
        "Hematoxylin.",
    ),
    (
        4, "organize", "Start low, then inspect",
        "Why should you begin studying a slide at low power?",
        "Low magnification makes it easier to find the tissue and establish its "
        "orientation. Then look for cell shape, arrangement, matrix and boundaries.",
        "Name one useful structure to assess after orienting the slide.",
        "Cell shape, cell arrangement, extracellular matrix or tissue boundaries.",
    ),
)


def sample_pdf() -> bytes:
    """Create a four-page educational PDF without nonstandard dependencies."""
    objects = [
        b"", b"",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
    ]
    children = []

    def esc(value: str) -> str:
        return value.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")

    for number, (heading, paragraphs) in enumerate(PAGES, 1):
        commands = [
            "0.08 0.12 0.22 rg",
            "BT /F2 20 Tf 52 731 Td (INTRO HISTOLOGY / TRIPOLI) Tj ET",
            "0.30 0.37 0.47 rg",
            "BT /F1 10 Tf 52 707 Td (SAMPLE CONTENT - NOT AN OFFICIAL UNIVERSITY HANDOUT) Tj ET",
            "0.14 0.42 0.76 rg",
            f"BT /F2 16 Tf 52 655 Td ({esc(heading)}) Tj ET",
            "0.13 0.18 0.26 rg",
        ]
        for index, paragraph in enumerate(paragraphs):
            commands.append(
                f"BT /F1 12 Tf 58 {603 - 42 * index} Td ({esc('- ' + paragraph)}) Tj ET"
            )
        commands += [
            "0.40 0.45 0.50 rg",
            "BT /F1 10 Tf 52 95 Td (Lock-in training material / Study Plan practice) Tj ET",
            f"BT /F1 10 Tf 515 95 Td ({number} / {len(PAGES)}) Tj ET",
        ]
        stream = ("\n".join(commands) + "\n").encode("ascii")
        page_ref = len(objects) + 1
        stream_ref = page_ref + 1
        objects.append(
            (
                "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
                "/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> "
                f"/Contents {stream_ref} 0 R >>"
            ).encode("ascii")
        )
        objects.append(
            b"<< /Length " + str(len(stream)).encode("ascii")
            + b" >>\nstream\n" + stream + b"endstream"
        )
        children.append(f"{page_ref} 0 R")

    objects[0] = b"<< /Type /Catalog /Pages 2 0 R >>"
    objects[1] = (
        f"<< /Type /Pages /Kids [{' '.join(children)}] /Count {len(children)} >>"
    ).encode("ascii")
    data = bytearray(b"%PDF-1.4\n")
    offsets = []
    for index, body in enumerate(objects, 1):
        offsets.append(len(data))
        data.extend(f"{index} 0 obj\n".encode("ascii"))
        data.extend(body)
        data.extend(b"\nendobj\n")
    startxref = len(data)
    data.extend(f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode("ascii"))
    for offset in offsets:
        data.extend(f"{offset:010d} 00000 n \n".encode("ascii"))
    data.extend(
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\n"
        f"startxref\n{startxref}\n%%EOF\n".encode("ascii")
    )
    return bytes(data)


def ensure_node(parent: EducationNode, kind: str, slug: str, title: str, position: int) -> EducationNode:
    node = EducationNode.objects.filter(parent=parent, slug=slug).first()
    if node is None:
        node = EducationNode(parent=parent, kind=kind, slug=slug)
    node.kind = kind
    node.title = title
    node.position = position
    node.status = EducationNode.Status.PUBLISHED
    node.is_discoverable = True
    node.depth = parent.depth + 1
    node.path = f"{parent.path}{node.id}/"
    node.full_clean()
    node.save()
    return node


class Command(BaseCommand):
    help = "Add an Intro Histology Tripoli PDF and eight MCQs to the private Codespace demo."

    def handle(self, *args: Any, **options: Any) -> None:
        if (
            getattr(settings, "ENVIRONMENT", "") not in {"development", "development-demo", "demo", "testing"}
            or not settings.DEBUG
        ):
            raise CommandError("Only an isolated development demo can be seeded.")
        try:
            student = User.objects.select_related("cohort__program").get(email="student@lockin.local")
            creator = User.objects.get(email="creator@lockin.local")
            semester = EducationNode.objects.get(
                slug="fall-2026", kind=EducationNode.Kind.SEMESTER
            )
            exam = ExamPeriod.objects.get(
                title="Codespace Midterm Preview", cohort=student.cohort
            )
        except (User.DoesNotExist, EducationNode.DoesNotExist, ExamPeriod.DoesNotExist) as error:
            raise CommandError("Run seed_demo and seed_codespace_exam first.") from error
        if student.cohort is None or student.cohort.program.code != "codespace-dentistry":
            raise CommandError("Refusing to modify a non-demo cohort.")

        subject_node = ensure_node(
            semester, EducationNode.Kind.SUBJECT, "intro-histology-tripoli",
            "Intro Histology (Tripoli Demo)", 4,
        )
        unit = ensure_node(
            subject_node, EducationNode.Kind.UNIT, "histology-introduction",
            "Introduction to Histology", 1,
        )
        lesson = ensure_node(
            unit, EducationNode.Kind.LESSON, "demo-sheet-01",
            "Intro Histology - Demo Sheet 01", 1,
        )
        subject, _ = CatalogSubject.objects.get_or_create(
            cohort=student.cohort,
            slug="intro-histology-tripoli",
            defaults={
                "source_node": subject_node,
                "title": "Intro Histology - Tripoli (Demo)",
                "material_slug": MATERIAL_SLUG,
                "position": 4,
            },
        )
        if subject.source_node_id != subject_node.pk or subject.material_slug != MATERIAL_SLUG:
            raise CommandError("The demo subject conflicts with existing catalog content.")
        if not subject.is_active:
            subject.is_active = True
            subject.save(update_fields=["is_active"])

        payload = sample_pdf()
        checksum = hashlib.sha256(payload).hexdigest()
        file = ManagedFile.objects.filter(owner=creator, original_name=PDF_NAME).first()
        if file is None:
            file = ManagedFile.objects.create(
                owner=creator, original_name=PDF_NAME, kind="pdf",
                content_type="application/pdf", size_bytes=len(payload),
                checksum_sha256=checksum, pdf_page_count=len(PAGES),
                validation_status="ready", scan_status="not_configured",
                blob=ContentFile(payload, name=PDF_NAME),
            )
        elif (
            file.checksum_sha256 != checksum or not file.blob.name
            or not file.blob.storage.exists(file.blob.name)
        ):
            file.blob.save(PDF_NAME, ContentFile(payload), save=False)
            file.checksum_sha256 = checksum
            file.size_bytes = len(payload)
            file.pdf_page_count = len(PAGES)
            file.validation_status = "ready"
            file.scan_status = "not_configured"
            file.save(update_fields=[
                "blob", "checksum_sha256", "size_bytes", "pdf_page_count",
                "validation_status", "scan_status",
            ])

        version = LearningObjectVersion.objects.filter(
            academic_node=lesson, created_by=creator, title=SHEET_TITLE,
        ).select_related("learning_object").first()
        if version is None:
            sheet = LearningObject.objects.create(
                owner=creator, workflow_status=LearningObject.WorkflowStatus.PUBLISHED,
                published_at=timezone.now(),
            )
            version = LearningObjectVersion.objects.create(
                learning_object=sheet, version_number=1, academic_node=lesson,
                content_type="pdf", title=SHEET_TITLE, page_count=len(PAGES),
                summary="Four short pages introducing tissues (training material only).",
                language="en", allow_download=True,
                metadata={"tags": ["demo", "tripoli", "histology"], "demo": True},
                created_by=creator,
            )
        else:
            sheet = version.learning_object
            if version.page_count != len(PAGES):
                version.page_count = len(PAGES)
                version.save(update_fields=["page_count"])
        LearningObjectAsset.objects.update_or_create(
            version=version, role=LearningObjectAsset.Role.PRIMARY,
            position=0, defaults={"managed_file": file},
        )
        changes = []
        if sheet.current_version_id != version.pk:
            sheet.current_version = version
            changes.append("current_version")
        if sheet.published_version_id != version.pk:
            sheet.published_version = version
            changes.append("published_version")
        if sheet.workflow_status != LearningObject.WorkflowStatus.PUBLISHED:
            sheet.workflow_status = LearningObject.WorkflowStatus.PUBLISHED
            changes.append("workflow_status")
        if changes:
            sheet.save(update_fields=changes)

        alias, _ = CatalogDocument.objects.get_or_create(
            material_slug=MATERIAL_SLUG, sheet_slug=SHEET_SLUG,
            defaults={"version": version, "edition": "university", "managed_file": file},
        )
        if alias.version_id != version.id or alias.managed_file_id != file.id:
            raise CommandError("Demo document alias points at another file.")
        StudySheetDifficulty.objects.get_or_create(sheet=sheet, defaults={"level": 2})

        # Publish page-specific help so the animated character is visible immediately
        # in this isolated reader. This is curated education content, not model AI.
        for position, (page, kind, teaser, question, explanation, followup_question, followup_answer) in enumerate(
            ASSISTANCE_IDEAS, 1
        ):
            StudyAssistanceIdea.objects.get_or_create(
                source_version=version, edition="university", view="study",
                page=page, position=position,
                defaults={
                    "kind": kind, "teaser": teaser, "question": question,
                    "explanation": explanation,
                    "followup_question": followup_question,
                    "followup_answer": followup_answer,
                    "is_published": True,
                },
            )

        for page, prompt, answers, explanation in QUESTIONS:
            existing = QuestionVersion.objects.filter(
                academic_node=lesson, source_learning_object=sheet,
                created_by=creator, prompt=prompt,
            ).first()
            if existing is not None:
                continue
            question = Question.objects.create(
                owner=creator, workflow_status=Question.WorkflowStatus.PUBLISHED,
                published_at=timezone.now(),
            )
            qversion = QuestionVersion.objects.create(
                question=question, version_number=1, academic_node=lesson,
                source_learning_object=sheet,
                question_type=QuestionVersion.QuestionType.SINGLE_CHOICE,
                prompt=prompt, explanation=explanation, source_page=page,
                difficulty=(
                    QuestionVersion.Difficulty.EASY if page < 3
                    else QuestionVersion.Difficulty.MEDIUM
                ),
                language="en", metadata={"source": "ai-sheet", "demo": True},
                created_by=creator,
            )
            for index, answer in enumerate(answers):
                QuestionOption.objects.create(
                    version=qversion, position=index, text=answer,
                    is_correct=index == 0,
                )
            question.current_version = qversion
            question.published_version = qversion
            question.save(update_fields=["current_version", "published_version"])

        ExamSyllabusScope.objects.get_or_create(
            period=exam, subject=subject, defaults={"include_future_sheets": True},
        )
        ExamSchedule.objects.get_or_create(
            period=exam, subject=subject,
            exam_type=ExamSchedule.ExamType.THEORY,
            defaults={
                "scheduled_on": exam.starts_on + timedelta(days=6),
                "status": ExamPeriod.Status.CONFIRMED,
            },
        )
        self.stdout.write(self.style.SUCCESS(
            f"Tripoli Histology demo: {len(PAGES)} PDF pages, {len(QUESTIONS)} MCQs. "
            f"Open /#/materials/catalog/{MATERIAL_SLUG} as student@lockin.local."
        ))
