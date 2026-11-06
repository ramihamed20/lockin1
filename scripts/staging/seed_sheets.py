"""Publish sample PDFs from a staging Django shell; uses no production content."""

from hashlib import sha256
from io import BytesIO
from os import environ

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.files.base import ContentFile
from django.db import connection, transaction
from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject

from apps.content.admin_services import create_sheet
from apps.content.catalog_subjects import project_subject_node
from apps.content.models import CatalogDocument, LearningObject
from apps.education.models import CreatorScope, EducationNode
from apps.files.models import ManagedFile


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
    student = users.select_for_update().select_related("cohort__program").get(
        email=environ["LOCKIN_DEMO_STUDENT"], cohort__program__code="dentistry-tripoli", cohort__code="year-1",
        cohort__is_active=True,
    )
    cohort = student.cohort
    author = users.filter(email=AUTHOR_EMAIL).first()
    if author is None:
        author = users.create_user(email=AUTHOR_EMAIL, full_name="Lock-in staging sheets", password=None)
    if author.has_usable_password() or author.is_staff or author.is_superuser:
        raise RuntimeError("The demo author must be an unprivileged account without a password.")

    roots = tuple(cohort.content_nodes.values_list("path", flat=True))
    results = []
    for position, (slug, title, pages) in enumerate(SHEETS, start=901):
        candidates = EducationNode.objects.filter(kind=EducationNode.Kind.SUBJECT, slug=slug)
        subject, = [node for node in candidates if node.path.startswith(roots)]
        branch, _ = project_subject_node(subject, cohort=cohort)
        if branch is None or not branch.is_active or branch.cohort_id != cohort.id:
            raise RuntimeError(f"Missing active catalog branch for {slug}.")

        sheet = LearningObject.objects.filter(
            owner=author, published_version__academic_node=subject, published_version__title=title,
        ).first()
        if sheet is None:
            scope = CreatorScope.objects.create(
                user=author, node=subject, granted_by=author, can_publish_content=True,
            )
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
            scope.delete()

        document = CatalogDocument.objects.get(
            version_id=sheet.published_version_id, edition="university",
            is_active=True, material_slug=branch.material_slug,
        )
        results.append((branch.title, title, document.managed_file.pdf_page_count))
    return results


for subject_title, sheet_title, page_count in seed():
    print(f"{subject_title}: {sheet_title} ({page_count} pages)")
