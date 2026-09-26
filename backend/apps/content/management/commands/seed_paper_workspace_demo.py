"""Development-only demo sheet for trying the Paper Workspace locally.

Publishes one 12-page sheet into the local student cohort and gives it Active
Study questions for every difficulty, through the same services the admin
Content Studio uses, so the sheet is "ready" exactly as a real one would be.
Running it again changes nothing.
"""

from __future__ import annotations

import hashlib
from typing import Any, cast

from django.conf import settings
from django.core.files.base import ContentFile
from django.core.management import BaseCommand, CommandError, call_command
from django.db import transaction

SHEET_TITLE = "Paper Workspace Demo · Epithelial Tissue"
TOTAL_PAGES = 12
FILE_NAME = "paper-workspace-demo.pdf"
DEMO_STUDENTS = ("local_student@lockin.local", "student@lockin.local")
LOCAL_ENVIRONMENTS = {"development", "development-demo", "demo", "testing"}

# Real stems; each generated question also carries its own place in the sheet,
# because the importer rejects repeated question text within one difficulty.
QUESTION_BANK = (
    (
        "Which junction forms a seal between neighbouring epithelial cells?",
        ("Tight junction", "Gap junction", "Desmosome", "Hemidesmosome"),
        "A",
        "Tight junctions (zonula occludens) fuse neighbouring membranes into a seal.",
    ),
    (
        "Epithelium receives its nutrients mainly by…",
        ("Its own capillaries", "Diffusion from the lamina propria", "Lymph vessels", "Saliva"),
        "B",
        "Epithelium is avascular and relies on diffusion from the connective tissue.",
    ),
    (
        "The hard palate is lined by which epithelium?",
        (
            "Non-keratinized stratified squamous",
            "Keratinized stratified squamous",
            "Simple columnar",
            "Pseudostratified columnar",
        ),
        "B",
        "Masticatory mucosa (gingiva and hard palate) is keratinized.",
    ),
    (
        "Which layer shows keratohyalin granules?",
        ("Stratum basale", "Stratum spinosum", "Stratum granulosum", "Stratum corneum"),
        "C",
        "Keratohyalin granules define the granular layer.",
    ),
    (
        "Hemidesmosomes anchor basal cells to the basal lamina through which integrin?",
        ("α5β1", "α6β4", "αvβ3", "α2β1"),
        "B",
        "α6β4 integrin links keratin filaments to laminin-332.",
    ),
    (
        "Parakeratinized epithelium is recognised by…",
        (
            "No granular layer and no nuclei",
            "Pyknotic nuclei kept in the surface layer",
            "Only two cell layers",
            "Goblet cells",
        ),
        "B",
        "Surface squames keep shrunken (pyknotic) nuclei.",
    ),
    (
        "Merkel cells in oral epithelium are identified by staining for…",
        ("S-100", "CK20", "HMB-45", "CD1a"),
        "B",
        "CK20 marks Merkel cells; CD1a marks Langerhans cells.",
    ),
    (
        "The junctional epithelium attaches to enamel through…",
        (
            "Desmosomes",
            "Tight junctions",
            "An internal basal lamina with hemidesmosomes",
            "Gap junctions",
        ),
        "C",
        "Its internal basal lamina and hemidesmosomes form the epithelial attachment.",
    ),
    (
        "Which keratin pair dominates non-keratinized lining mucosa suprabasally?",
        ("K1/K10", "K4/K13", "K5/K14", "K8/K18"),
        "B",
        "K4/K13 are characteristic of non-keratinized stratified epithelium.",
    ),
    (
        "Langerhans cells in the epithelium mainly…",
        ("Produce melanin", "Present antigen", "Sense touch", "Secrete keratin"),
        "B",
        "They are dendritic antigen-presenting cells.",
    ),
    (
        "Where are the dividing cells of stratified squamous epithelium?",
        ("Surface layer", "Granular layer", "Basal layer", "Keratin layer"),
        "C",
        "The basal (germinative) layer holds the progenitor cells.",
    ),
    (
        "The prickle-cell appearance of the spinous layer comes from…",
        ("Microvilli", "Desmosomes", "Cilia", "Gap junctions"),
        "B",
        "Cells shrink during fixation but stay joined at desmosomes.",
    ),
    (
        "Which lamina of the basal lamina lies next to the epithelial cells?",
        ("Lamina densa", "Lamina lucida", "Reticular lamina", "Lamina propria"),
        "B",
        "The lamina lucida lies between the cell membrane and the lamina densa.",
    ),
    (
        "Melanocytes are found in which layer?",
        ("Basal layer", "Spinous layer", "Granular layer", "Keratin layer"),
        "A",
        "Melanocytes sit among the basal cells.",
    ),
    (
        "Gap junctions allow…",
        (
            "Cell adhesion to the basal lamina",
            "Direct passage of small molecules between cells",
            "A barrier to diffusion",
            "Attachment of actin to the membrane only",
        ),
        "B",
        "Connexon channels connect the cytoplasm of neighbouring cells.",
    ),
    (
        "The lining mucosa of the cheek is…",
        ("Keratinized", "Non-keratinized", "Parakeratinized only", "Simple squamous"),
        "B",
        "Lining mucosa is non-keratinized to stay flexible.",
    ),
    (
        "Rete ridges are…",
        (
            "Folds of the basal lamina only",
            "Epithelial projections into the connective tissue",
            "Surface grooves",
            "Salivary ducts",
        ),
        "B",
        "Rete ridges interdigitate with connective tissue papillae.",
    ),
    (
        "Membrane-coating granules first appear in which layer?",
        ("Basal", "Upper spinous", "Keratin", "Lamina propria"),
        "B",
        "They form in the upper spinous layer and release lipid into the intercellular space.",
    ),
    (
        "The dorsal tongue is covered by…",
        (
            "Lining mucosa",
            "Specialized mucosa",
            "Simple columnar epithelium",
            "Transitional epithelium",
        ),
        "B",
        "Its papillae and taste buds make it specialized mucosa.",
    ),
    (
        "Which cell type is not derived from the epithelium itself?",
        ("Keratinocyte", "Langerhans cell", "Basal cell", "Spinous cell"),
        "B",
        "Langerhans cells come from the bone marrow.",
    ),
)


def demo_pdf(pages: int) -> bytes:
    """A small, valid multi-page PDF with a heading on every page."""

    kids = " ".join(f"{3 + index * 2} 0 R" for index in range(pages))
    objects: list[bytes] = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        f"<< /Type /Pages /Kids [{kids}] /Count {pages} >>".encode("ascii"),
    ]
    font_ref = 3 + pages * 2
    for index in range(pages):
        content = 4 + index * 2
        stream = (
            "BT\n/F1 22 Tf\n72 740 Td\n(Epithelial Tissue) Tj\n"
            f"/F1 13 Tf\n0 -28 Td\n(Paper Workspace demo - page {index + 1} of {pages}) Tj\n"
            "0 -40 Td\n(Read this page on paper, then press Checkpoint.) Tj\nET\n"
        ).encode("ascii")
        objects.append(
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] "
            f"/Resources << /Font << /F1 {font_ref} 0 R >> >> /Contents {content} 0 R >>".encode(
                "ascii"
            )
        )
        objects.append(
            b"<< /Length "
            + str(len(stream)).encode("ascii")
            + b" >>\nstream\n"
            + stream
            + b"endstream"
        )
    objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    document = bytearray(b"%PDF-1.4\n")
    offsets: list[int] = []
    for number, value in enumerate(objects, 1):
        offsets.append(len(document))
        document.extend(f"{number} 0 obj\n".encode("ascii") + value + b"\nendobj\n")
    xref = len(document)
    document.extend(f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode("ascii"))
    for offset in offsets:
        document.extend(f"{offset:010d} 00000 n \n".encode("ascii"))
    document.extend(
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode(
            "ascii"
        )
    )
    return bytes(document)


def _question(label: str, index: int) -> dict[str, object]:
    stem, options, correct, explanation = QUESTION_BANK[index % len(QUESTION_BANK)]
    return {
        "question": f"{stem} ({label})",
        "options": dict(zip("ABCD", options, strict=True)),
        "correct_answer": correct,
        "explanation": explanation,
    }


def question_payload(*, number_of_parts: int, per_part: int, final: int) -> dict[str, object]:
    counter = iter(range(10_000))
    return {
        "parts": [
            {
                "part": part,
                "questions": [
                    _question(f"Part {part} · Q{position}", next(counter))
                    for position in range(1, per_part + 1)
                ],
            }
            for part in range(1, number_of_parts + 1)
        ],
        "final_exam": {
            "questions": [
                _question(f"Final · Q{position}", next(counter)) for position in range(1, final + 1)
            ]
        },
    }


class Command(BaseCommand):
    help = "Publish a demo sheet with Active Study questions for the Paper Workspace (local only)."

    def add_arguments(self, parser: Any) -> None:
        parser.add_argument(
            "--email",
            action="append",
            default=[],
            help="Also publish the sheet for this account's cohort. Repeatable.",
        )

    def handle(self, *args: Any, **options: Any) -> None:
        if getattr(settings, "ENVIRONMENT", "") not in LOCAL_ENVIRONMENTS:
            raise CommandError(
                "seed_paper_workspace_demo is available only in local or demo environments."
            )
        # The students, cohorts and subscriptions this sheet is meant for.
        call_command("seed_demo", "--manual-qa", verbosity=0, stdout=self.stdout)
        emails = [*DEMO_STUDENTS, *options["email"]]
        for email, sheet in self._seed(emails):
            self.stdout.write(
                self.style.SUCCESS(f"Paper Workspace demo sheet for {email}: {sheet.id}")
            )
        self.stdout.write("Sign in as one of these accounts and open Paper Workspace.")

    @transaction.atomic
    def _seed(self, emails: list[str]) -> list[tuple[str, Any]]:
        from apps.accounts.models import User
        from apps.content.models import CatalogSubject

        admin = User.objects.get(email="admin@lockin.local")
        branches = CatalogSubject.objects.filter(
            is_active=True, cohort__is_active=True, source_node__isnull=False
        ).select_related("cohort", "source_node")
        ordered = branches.order_by("position", "id")
        # A student whose cohort owns no subject (the manual-QA default) is moved
        # to the first cohort that does, or no sheet could ever reach them.
        fallback = (
            branches.exclude(cohort__code="year-3")
            .order_by("cohort__program__position", "cohort__position", "position", "id")
            .first()
        )
        if fallback is None:
            raise CommandError("No cohort owns a subject to publish the demo sheet into.")
        seeded = []
        for email in emails:
            user = User.objects.filter(email=email).first()
            if user is None:
                raise CommandError(f"No account uses {email}.")
            branch = ordered.filter(cohort_id=user.cohort_id).first() if user.cohort_id else None
            if branch is None:
                branch = fallback
                User.objects.filter(id=user.id).update(cohort=branch.cohort)
            seeded.append((email, self._sheet(admin=admin, branch=branch)))
        return seeded

    def _sheet(self, *, admin: Any, branch: Any) -> Any:
        from apps.content.active_study import DIFFICULTIES
        from apps.content.active_study_readiness import edition_plan
        from apps.content.admin_services import (
            create_sheet,
            save_active_study_question_content,
            update_active_study_settings,
        )
        from apps.content.models import (
            ActiveStudyQuestionContent,
            ActiveStudySettings,
            LearningObject,
        )
        from apps.files.models import ManagedFile

        sheet = LearningObject.objects.filter(
            published_version__title=SHEET_TITLE,
            published_version__academic_node=branch.source_node,
        ).first()
        if sheet is None:
            payload = demo_pdf(TOTAL_PAGES)
            managed = ManagedFile.objects.create(
                owner=admin,
                original_name=FILE_NAME,
                kind="pdf",
                content_type="application/pdf",
                size_bytes=len(payload),
                checksum_sha256=hashlib.sha256(payload).hexdigest(),
                validation_status="ready",
                scan_status="not_configured",
                pdf_page_count=TOTAL_PAGES,
                blob=ContentFile(payload, name=FILE_NAME),
            )
            sheet = create_sheet(
                actor=admin,
                subject=branch.source_node,
                managed_file=managed,
                title=SHEET_TITLE,
                summary="A demo sheet for trying the Paper Workspace and Active Study.",
                position=999,
                publish=True,
                notify_students=False,
                allow_download=True,
            )

        current = ActiveStudySettings.objects.filter(sheet=sheet, edition="university").first()
        if current is None or not current.enabled:
            update_active_study_settings(
                actor=admin,
                sheet_id=sheet.id,
                expected_revision=current.revision if current else 0,
                enabled=True,
                total_pdf_pages=TOTAL_PAGES,
                excluded_start_pages=0,
                excluded_end_pages=0,
                confirm_boundary_change=True,
            )

        plan, error = edition_plan(sheet=sheet, edition="university")
        if plan is None:
            raise CommandError(f"The demo sheet could not be planned: {error}")
        for difficulty in DIFFICULTIES:
            existing = ActiveStudyQuestionContent.objects.filter(
                sheet=sheet, difficulty=difficulty.key
            )
            if existing.exists():
                continue
            rows = cast(list[dict[str, object]], plan["difficulties"])
            row = next(item for item in rows if item["difficulty"] == difficulty.key)
            save_active_study_question_content(
                actor=admin,
                sheet_id=sheet.id,
                difficulty_key=difficulty.key,
                payload=question_payload(
                    number_of_parts=cast(int, row["number_of_parts"]),
                    per_part=difficulty.questions_per_checkpoint,
                    final=difficulty.final_exam_questions,
                ),
                expected_revision=0,
            )
        return sheet
