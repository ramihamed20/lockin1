"""Pilot sheet and curated Arabic translation for 'General Pathology — Introduction' (University).

Used in isolated development/demo/testing environments and automated tests to
demonstrate and verify the Gemini sheet-translation preview-before-save workflow
without touching production or student data.
"""

from __future__ import annotations

import hashlib
from typing import Any

from django.conf import settings
from django.contrib.auth.models import Group
from django.core.files.base import ContentFile
from django.db import transaction
from django.utils import timezone

from apps.accounts.models import User
from apps.accounts.roles import Role
from apps.education.models import CreatorScope, EducationNode, StudentCohort
from apps.files.models import ManagedFile

from .admin_services import create_sheet
from .catalog_subjects import project_subject_node
from .editions import UNIVERSITY, normalize_edition
from .models import LearningObject, SheetPageTranslation
from .services import ContentRuleError
from .sheet_translation import _source
from .sheet_translation_batch import SINGLE_FORMAT_V1, extract_pdf_pages_text

PILOT_SUBJECT_SLUG = "general-pathology"
PILOT_SUBJECT_TITLE = "General Pathology"
PILOT_SHEET_TITLE = "General Pathology — Introduction"
PILOT_FILE_NAME = "general-pathology-introduction-university.pdf"
ALLOWED_SEED_ENVIRONMENTS = frozenset({"development", "development-demo", "demo", "testing"})

PILOT_UNIVERSITY_PAGES: tuple[tuple[str, tuple[str, ...]], ...] = (
    (
        "01 / INTRODUCTION TO GENERAL PATHOLOGY",
        (
            (
                "Pathology is the scientific study of structural, biochemical and functional "
                "changes in cells, tissues and organs that underlie disease."
            ),
            (
                "General Pathology examines the common cellular and tissue responses to "
                "injurious stimuli across all organs."
            ),
            (
                "Systemic Pathology examines the specific responses of specialized organs "
                "and organ systems to defined diseases."
            ),
            (
                "Homeostasis is the steady-state equilibrium maintained by normal cells "
                "within a narrow physiological range."
            ),
            (
                "The four core aspects of a disease process are Etiology, Pathogenesis, "
                "Morphologic Changes and Clinical Manifestations."
            ),
            (
                "Etiology refers to the initiating cause of disease, classified into "
                "genetic factors and acquired environmental factors."
            ),
            (
                "Pathogenesis describes the sequence of cellular, biochemical and molecular "
                "events from initial stimulus to disease expression."
            ),
            (
                "Morphologic Changes include Gross (macroscopic) and Microscopic (histologic) "
                "alterations characteristic of a disease."
            ),
            (
                "Clinical Manifestations represent the functional consequences of morphologic "
                "changes, expressed as Symptoms, Signs and Prognosis."
            ),
        ),
    ),
    (
        "02 / CELLULAR ADAPTATIONS TO STRESS",
        (
            (
                "Cellular Adaptation is a reversible structural and functional response that "
                "allows cells to survive altered physiological demands or pathological stimuli."
            ),
            (
                "Hypertrophy is an increase in the size of cells resulting in an increase in "
                "the size and functional mass of the organ, without cell division."
            ),
            (
                "Hypertrophy is characteristic of permanent non-dividing cells such as "
                "cardiac myocytes in Left Ventricular Hypertrophy."
            ),
            (
                "Hyperplasia is an increase in the number of cells in an organ or tissue "
                "capable of replication, driven by growth factors or stem cell proliferation."
            ),
            (
                "Physiologic Hyperplasia includes Hormonal Hyperplasia (such as breast and "
                "uterine epithelium) and Compensatory Hyperplasia (such as liver regeneration)."
            ),
            (
                "Atrophy is a decrease in cell size and cell number resulting in reduced "
                "tissue or organ mass due to decreased protein synthesis and increased degradation."
            ),
            (
                "Protein degradation in Atrophy occurs mainly via the Ubiquitin-Proteasome "
                "Pathway and Autophagy with residual Lipofuscin granules."
            ),
            (
                "Metaplasia is a reversible change in which one differentiated cell type "
                "(epithelial or mesenchymal) is replaced by another cell type better suited "
                "to stress."
            ),
            (
                "Classic examples of Metaplasia include Squamous Metaplasia in respiratory "
                "epithelium of smokers and Columnar Metaplasia in Barrett Esophagus."
            ),
        ),
    ),
    (
        "03 / REVERSIBLE AND IRREVERSIBLE CELL INJURY",
        (
            (
                "Cell Injury occurs when environmental stress exceeds the cell's capacity "
                "for Cellular Adaptation or when the stimulus is inherently damaging."
            ),
            (
                "Major causes of Cell Injury include Hypoxia, Ischemia, chemical toxins, "
                "infectious pathogens, immunologic reactions and nutritional imbalances."
            ),
            (
                "Ischemia (reduced blood supply) causes faster and more severe tissue injury "
                "than Hypoxia alone because glycolysis substrates are also depleted."
            ),
            (
                "Core biochemical mechanisms of Cell Injury include ATP Depletion, "
                "Mitochondrial Damage, Calcium Influx, Oxidative Stress and Membrane "
                "Permeability defects."
            ),
            (
                "Reactive Oxygen Species (ROS) cause lipid peroxidation of membranes, "
                "oxidative modification of proteins and DNA strand breaks."
            ),
            (
                "Reversible Cell Injury is characterized morphologically by Cellular Swelling "
                "(Hydropic Change) and Fatty Change (Steatosis)."
            ),
            (
                "Cellular Swelling results from failure of the ATP-dependent sodium-potassium "
                "plasma membrane pump, leading to intracellular sodium and water accumulation."
            ),
            (
                "Irreversible Cell Injury ensues when severe Mitochondrial dysfunction and "
                "plasma or lysosomal membrane rupture pass the point of no return."
            ),
        ),
    ),
    (
        "04 / CELL DEATH: NECROSIS VERSUS APOPTOSIS",
        (
            (
                "Necrosis is an unregulated pathological form of cell death resulting from "
                "severe membrane damage and enzymatic digestion of leaked cellular contents."
            ),
            (
                "Necrosis always elicits a local host reaction called Inflammation to clear "
                "necrotic debris and initiate tissue repair."
            ),
            (
                "Nuclear changes in Necrosis include Pyknosis (nuclear shrinkage and "
                "hyperchromasia), Karyorrhexis (nuclear fragmentation) and Karyolysis "
                "(chromatin dissolution)."
            ),
            (
                "Major tissue patterns of Necrosis include Coagulative Necrosis, "
                "Liquefactive Necrosis, Caseous Necrosis, Fat Necrosis and Fibrinoid Necrosis."
            ),
            (
                "Coagulative Necrosis preserves basic tissue architecture for days and is "
                "characteristic of Ischemic Infarction in solid organs except the brain."
            ),
            (
                "Apoptosis is a regulated, energy-dependent pathway of programmed cell death "
                "mediated by proteolytic enzymes called Caspases."
            ),
            (
                "Apoptosis is triggered through the Intrinsic (Mitochondrial) Pathway "
                "regulated by BCL2 family proteins and Cytochrome c, or the Extrinsic "
                "(Death Receptor) Pathway."
            ),
            (
                "In Apoptosis, cells shrink and form membrane-bound Apoptotic Bodies that "
                "are rapidly cleared by Phagocytosis without plasma membrane rupture or "
                "Inflammation."
            ),
        ),
    ),
)

PILOT_ARABIC_TRANSLATIONS: dict[int, str] = {
    1: (
        "01 / مقدمة في علم الأمراض العام (Introduction to General Pathology)\n\n"
        "• علم الأمراض (Pathology): هو الدراسة العلمية للتغيرات البنيوية (Structural) "
        "والكيميائية الحيوية (Biochemical) والوظيفية (Functional) التي تطرأ على الخلايا "
        "والأنسجة والأعضاء وتشكّل أساس المرض.\n"
        "• علم الأمراض العام (General Pathology): يدرس الاستجابات الخلوية والنسيجية "
        "المشتركة تجاه المؤثرات الضارة في مختلف أعضاء الجسم.\n"
        "• علم الأمراض الجهازي (Systemic Pathology): يدرس الاستجابات الخاصة بكل عضو "
        "أو جهاز عضوي متخصّص تجاه أمراض محددة.\n"
        "• الاستتباب (Homeostasis): هو حالة التوازن الفيزيولوجي المستقر التي تحافظ "
        "عليها الخلايا الطبيعية ضمن نطاق ضيق.\n"
        "• الأركان الأربعة لدراسة العملية المرضية هي: السببيات (Etiology)، وإمراضية "
        "المرض (Pathogenesis)، والتغيرات المورفولوجية (Morphologic Changes)، والمظاهر "
        "السريرية (Clinical Manifestations).\n"
        "• السببيات (Etiology): تشير إلى السبب المبدئي للمرض، وتُصنَّف إلى عوامل وراثية "
        "(Genetic factors) وعوامل مكتسبة بيئية (Acquired environmental factors).\n"
        "• الإمراضية (Pathogenesis): تصف تسلسل الأحداث الخلوية والكيميائية الحيوية "
        "والجزيئية منذ التعرض للمنبّه الأولي وحتى ظهور المرض.\n"
        "• التغيرات المورفولوجية (Morphologic Changes): تشمل التغيرات العيانية "
        "(Gross / Macroscopic) والتغيرات المجهرية النسيجية (Microscopic / Histologic) "
        "المميزة للمرض.\n"
        "• المظاهر السريرية (Clinical Manifestations): تمثل النتائج الوظيفية للتغيرات "
        "المورفولوجية، وتظهر على هيئة أعراض (Symptoms) وعلامات (Signs) وتحدّد مآل "
        "المرض (Prognosis)."
    ),
    2: (
        "02 / التكيّفات الخلوية للإجهاد — علم الأمراض العام "
        "(General Pathology — Cellular Adaptations to Stress)\n\n"
        "• التكيّف الخلوي (Cellular Adaptation): هو استجابة بنيوية ووظيفية عكوسة "
        "(Reversible) تُمكّن الخلايا من البقاء عند تغيّر المتطلبات الفيزيولوجية أو "
        "التعرّض لمنبّهات مرضية (Pathological stimuli).\n"
        "• الضخامة الخلوية (Hypertrophy): زيادة في حجم الخلايا تؤدي إلى زيادة حجم "
        "العضو وكتلته الوظيفية دون انقسام خلوي.\n"
        "• تتميز الضخامة (Hypertrophy) بحدوثها في الخلايا الدائمة غير القابلة للانقسام "
        "مثل خلايا عضلة القلب في ضخامة البطين الأيسر (Left Ventricular Hypertrophy).\n"
        "• فرط التنسّج (Hyperplasia): زيادة في عدد الخلايا داخل عضو أو نسيج قادر على "
        "التكاثر والانقسام، بتحفيز من عوامل النمو (Growth factors) أو الخلايا الجذعية "
        "(Stem cell proliferation).\n"
        "• يشمل فرط التنسّج الفيزيولوجي (Physiologic Hyperplasia) كلاً من فرط التنسّج "
        "الهرموني (Hormonal Hyperplasia) كما في ظهارة الثدي والرحم (Epithelium)، وفرط التنسّج "
        "التعويضي (Compensatory Hyperplasia) كما في تجدّد الكبد.\n"
        "• الضمور (Atrophy): نقصان في حجم الخلايا وعددها يؤدي إلى صغر حجم النسيج أو "
        "العضو نتيجة انخفاض تصنيع البروتين (Protein synthesis) وزيادة تفكيكه.\n"
        "• يتم تفكيك البروتينات في الضمور (Atrophy) بشكل رئيسي عبر مسار "
        "اليوبيكويتين-البروتيازوم (Ubiquitin-Proteasome Pathway) والالتهام الذاتي "
        "(Autophagy) مع بقاء حبيبات الليبوفوسين (Lipofuscin granules).\n"
        "• الحؤول (Metaplasia): تغيّر عكوس يُستبدل فيه نوع خلوي متمايز "
        "(Epithelial أو Mesenchymal) بنوع خلوي آخر أقدر على تحمّل الإجهاد المزمن.\n"
        "• من الأمثلة الكلاسيكية على الحؤول (Metaplasia): الحؤول الحرشفي "
        "(Squamous Metaplasia) في الظهارة التنفسية (Respiratory Epithelium) لدى المدخنين، "
        "والحؤول العمودي (Columnar Metaplasia) في مريء باريت (Barrett Esophagus)."
    ),
    3: (
        "03 / الأذية الخلوية العكوسة وغير العكوسة — علم الأمراض العام "
        "(General Pathology — Reversible and Irreversible Cell Injury)\n\n"
        "• الأذية الخلوية (Cell Injury): تحدث عندما يتجاوز الإجهاد البيئي قدرة الخلية "
        "على التكيّف الخلوي (Cellular Adaptation) أو عندما يكون العامل المؤثر ضارًا بطبيعته.\n"
        "• الأسباب الرئيسية للأذية الخلوية (Cell Injury) تشمل: نقص الأكسجة (Hypoxia)، "
        "ونقص التروية أو الإقفار (Ischemia)، والسموم الكيميائية، والعوامل الإنتانية، "
        "والتفاعلات المناعية، واضطرابات التغذية.\n"
        "• يُسبّب الإقفار (Ischemia) أذية نسيجية أسرع وأشدّ من نقص الأكسجة (Hypoxia) "
        "وحده؛ لأن انقطاع التروية يحرم الخلية أيضًا من ركائز تحلل السكر "
        "(Glycolysis substrates).\n"
        "• الآليات الكيميائية الحيوية الأساسية للأذية الخلوية (Cell Injury) تشمل: "
        "استنزاف الطاقة (ATP Depletion)، وتلف الميتوكوندريا (Mitochondrial Damage)، "
        "وتدفّق الكالسيوم داخل الخلية (Calcium Influx)، والإجهاد التأكسدي "
        "(Oxidative Stress)، واضطراب نفوذية الأغشية (Membrane Permeability).\n"
        "• تؤدي أنواع الأكسجين التفاعلية (Reactive Oxygen Species - ROS) إلى فوق أكسدة "
        "شحوم الأغشية (Lipid Peroxidation)، والتعديل التأكسدي للبروتينات، وتكسّر سلاسل "
        "الحمض النووي (DNA).\n"
        "• تتميز الأذية الخلوية العكوسة (Reversible Cell Injury) مورفولوجيًا بالتورّم "
        "الخلوي (Cellular Swelling / Hydropic Change) والتغيّر الدهني "
        "(Fatty Change / Steatosis).\n"
        "• ينتج التورّم الخلوي (Cellular Swelling) عن قصور مضخة الصوديوم والبوتاسيوم "
        "المعتمدة على الطاقة (ATP) في الغشاء البلازمي (Plasma membrane)، مما يؤدي إلى "
        "تراكم الصوديوم والماء داخل الخلية.\n"
        "• تحدث الأذية الخلوية غير العكوسة (Irreversible Cell Injury) عندما يتجاوز "
        "الخلل الشديد في الميتوكوندريا (Mitochondrial dysfunction) وتمزّق الغشاء "
        "البلازمي أو أغشية الجسيمات الحالة (Lysosomal membranes) نقطة اللاعودة."
    ),
    4: (
        "04 / موت الخلية: النخر مقابل الاستماتة — علم الأمراض العام "
        "(General Pathology — Cell Death: Necrosis versus Apoptosis)\n\n"
        "• النخر (Necrosis): شكل مرضي (Pathological) غير منظّم لموت الخلية ينجم عن "
        "تلف شديد في الأغشية وهضم إنزيمي (Enzymatic digestion) لمحتويات الخلية المتسرّبة.\n"
        "• يستدعي النخر (Necrosis) دائمًا استجابة التهابية موضعية في النسيج تُعرف "
        "بالالتهاب (Inflammation) لإزالة الحطام النخري (Necrotic debris) وبدء إصلاح النسيج.\n"
        "• التغيرات النووية (Nuclear changes) في النخر (Necrosis) تشمل: تغلّظ النواة "
        "وانكماشها وفرط اصطباعها (Pyknosis / Hyperchromasia)، وتفتّت النواة (Karyorrhexis)، "
        "وتحلّل الكروماتين (Chromatin) وزوال النواة (Karyolysis).\n"
        "• الأنماط النسيجية الرئيسية للنخر (Necrosis) تشمل: النخر التخثّري "
        "(Coagulative Necrosis)، والنخر المميّع (Liquefactive Necrosis)، والنخر التجبّني "
        "(Caseous Necrosis)، والنخر الدهني (Fat Necrosis)، والنخر الفبريني "
        "(Fibrinoid Necrosis).\n"
        "• يحافظ النخر التخثّري (Coagulative Necrosis) على البنية العامة للنسيج لعدة "
        "أيام، وهو السمة المميزة للاحتشاء الإقفاري (Ischemic Infarction) في جميع "
        "الأعضاء الصلبة باستثناء الدماغ.\n"
        "• الاستماتة أو الموت الخلوي المبرمج (Apoptosis): مسار منظّم يعتمد على الطاقة "
        "لموت الخلية المبرمج، تتوسّطه إنزيمات حالة للبروتين تُسمّى الكاسببزات "
        "(Caspases).\n"
        "• تُحفَّز الاستماتة (Apoptosis) عبر المسار الداخلي الميتوكوندري "
        "(Intrinsic Mitochondrial Pathway) المنظَّم ببروتينات عائلة BCL2 والسيتوكروم سي "
        "(Cytochrome c)، أو عبر المسار الخارجي لمستقبلات الموت "
        "(Extrinsic Death Receptor Pathway).\n"
        "• في الاستماتة (Apoptosis) تنكمش الخلايا وتشكّل أجسامًا استماتية محاطة بغشاء "
        "(Apoptotic Bodies) يتم التخلّص منها سريعًا بالبلعمة (Phagocytosis) دون تمزّق "
        "الغشاء البلازمي (Plasma membrane) ودون إثارة التهاب (Inflammation)."
    ),
}


def _escape_pdf_text(value: str) -> str:
    ascii_normalized = value.replace("—", "-").replace("–", "-")
    return ascii_normalized.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def build_pilot_pdf() -> bytes:
    """Build a valid 4-page PDF for 'General Pathology — Introduction' (University)."""

    objects: list[bytes] = [
        b"",
        b"",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
    ]
    children: list[str] = []
    total_pages = len(PILOT_UNIVERSITY_PAGES)

    for page_num, (heading, bullets) in enumerate(PILOT_UNIVERSITY_PAGES, start=1):
        header_text = _escape_pdf_text(f"{PILOT_SHEET_TITLE} - University Edition")
        footer_text = _escape_pdf_text(
            f"General Pathology | University Sheet | Page {page_num} of {total_pages}"
        )
        commands = [
            "0.08 0.12 0.22 rg",
            f"BT /F2 16 Tf 48 760 Td ({header_text}) Tj ET",
            "0.14 0.42 0.76 rg",
            f"BT /F2 13 Tf 48 730 Td ({_escape_pdf_text(heading)}) Tj ET",
            "0.13 0.18 0.26 rg",
        ]
        for idx, line in enumerate(bullets):
            y_pos = 690 - idx * 58
            commands.append(f"BT /F1 10 Tf 48 {y_pos} Td ({_escape_pdf_text(line)}) Tj ET")
        commands.append(f"BT /F1 9 Tf 48 60 Td ({footer_text}) Tj ET")
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
            b"<< /Length "
            + str(len(stream)).encode("ascii")
            + b" >>\nstream\n"
            + stream
            + b"endstream"
        )
        children.append(f"{page_ref} 0 R")

    objects[0] = b"<< /Type /Catalog /Pages 2 0 R >>"
    objects[1] = f"<< /Type /Pages /Kids [{' '.join(children)}] /Count {len(children)} >>".encode(
        "ascii"
    )

    data = bytearray(b"%PDF-1.4\n")
    offsets: list[int] = []
    for index, body in enumerate(objects, start=1):
        offsets.append(len(data))
        data.extend(f"{index} 0 obj\n".encode("ascii"))
        data.extend(body)
        data.extend(b"\nendobj\n")
    startxref = len(data)
    data.extend(f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode("ascii"))
    for offset in offsets:
        data.extend(f"{offset:010d} 00000 n \n".encode("ascii"))
    trailer = (
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{startxref}\n%%EOF\n"
    )
    data.extend(trailer.encode("ascii"))
    return bytes(data)


@transaction.atomic
def ensure_general_pathology_intro_pilot(*, actor: User | None = None) -> LearningObject:
    """Idempotently ensure the 'General Pathology — Introduction' (University) sheet exists."""

    env_name = getattr(settings, "ENVIRONMENT", "")
    if env_name not in ALLOWED_SEED_ENVIRONMENTS:
        allowed_str = sorted(ALLOWED_SEED_ENVIRONMENTS)
        raise ContentRuleError(
            f"Refusing to seed pilot sheet in environment '{env_name}'. "
            f"Allowed only in {allowed_str}."
        )

    now = timezone.now()
    if actor is None:
        actor = (
            User.objects.filter(is_superuser=True, is_active=True).order_by("date_joined").first()
        )
    if actor is None:
        actor, _ = User.objects.get_or_create(
            email="admin@lockin.local",
            defaults={
                "full_name": "Lock-in Super Admin",
                "is_staff": True,
                "is_superuser": True,
                "email_verified_at": now,
                "policy_accepted_at": now,
                "policy_version": "pilot-v1",
                "status": User.Status.ACTIVE,
            },
        )
        admin_group = Group.objects.filter(name=Role.ADMINISTRATOR.value).first()
        if admin_group is not None:
            admin_group.user_set.add(actor)

    subject_node = (
        EducationNode.objects.filter(
            kind=EducationNode.Kind.SUBJECT,
            slug=PILOT_SUBJECT_SLUG,
        )
        .order_by("position", "id")
        .first()
    )
    if subject_node is None:
        root, _ = EducationNode.objects.get_or_create(
            parent=None,
            slug="libyan-universities",
            defaults={
                "kind": EducationNode.Kind.INSTITUTION,
                "title": "Libyan Universities",
                "position": 1,
                "status": EducationNode.Status.PUBLISHED,
                "is_discoverable": True,
                "depth": 0,
            },
        )
        if not root.path:
            root.path = f"/{root.id}/"
            root.save(update_fields=["path"])
        subject_node = EducationNode.objects.create(
            parent=root,
            kind=EducationNode.Kind.SUBJECT,
            slug=PILOT_SUBJECT_SLUG,
            title=PILOT_SUBJECT_TITLE,
            position=4,
            status=EducationNode.Status.PUBLISHED,
            is_discoverable=True,
            depth=root.depth + 1,
        )
        subject_node.path = f"{root.path}{subject_node.id}/"
        subject_node.save(update_fields=["path"])

    cohort = (
        StudentCohort.objects.filter(
            is_active=True, program__code="dentistry-tripoli", code="year-2"
        )
        .select_related("program")
        .first()
    )
    project_subject_node(subject_node, cohort=cohort)

    existing = (
        LearningObject.objects.filter(
            current_version__academic_node=subject_node,
            current_version__title=PILOT_SHEET_TITLE,
        )
        .select_related("current_version", "published_version")
        .first()
    )
    if existing is not None:
        return existing

    payload = build_pilot_pdf()
    checksum = hashlib.sha256(payload).hexdigest()
    managed = ManagedFile.objects.filter(
        owner=actor,
        original_name=PILOT_FILE_NAME,
        checksum_sha256=checksum,
    ).first()
    if managed is None:
        managed = ManagedFile.objects.create(
            owner=actor,
            original_name=PILOT_FILE_NAME,
            kind=ManagedFile.Kind.PDF,
            content_type="application/pdf",
            size_bytes=len(payload),
            checksum_sha256=checksum,
            pdf_page_count=len(PILOT_UNIVERSITY_PAGES),
            validation_status=ManagedFile.ValidationStatus.READY,
            scan_status=ManagedFile.ScanStatus.NOT_CONFIGURED,
            blob=ContentFile(payload, name=PILOT_FILE_NAME),
        )

    scope, created_scope = CreatorScope.objects.get_or_create(
        user=actor,
        node=subject_node,
        defaults={
            "granted_by": actor,
            "can_create_content": True,
            "can_review_content": True,
            "can_publish_content": True,
        },
    )
    try:
        sheet = create_sheet(
            actor=actor,
            subject=subject_node,
            managed_file=managed,
            title=PILOT_SHEET_TITLE,
            summary=(
                "University edition introduction to General Pathology: etiology, "
                "pathogenesis, cellular adaptations, cell injury, necrosis and apoptosis."
            ),
            position=1,
            publish=True,
            notify_students=False,
            allow_download=True,
        )
    finally:
        if created_scope:
            scope.delete()
    return sheet


def build_pilot_translation_payload(
    sheet: LearningObject, *, edition: str = UNIVERSITY
) -> dict[str, Any]:
    """Build the ``lockin_translation_v1`` payload for 'General Pathology — Introduction'."""

    normalized_edition = normalize_edition(edition)
    if normalized_edition != UNIVERSITY:
        raise ContentRuleError(
            "The General Pathology — Introduction pilot targets the university edition only."
        )
    source = _source(sheet, normalized_edition)
    existing_revisions = {
        row.page: row.revision
        for row in SheetPageTranslation.objects.filter(
            managed_file=source.file,
            checksum=source.file.checksum_sha256,
        )
    }

    extracted = extract_pdf_pages_text(source.file, expected_pages=source.page_count)
    pages: list[dict[str, Any]] = []
    for page_num in range(1, source.page_count + 1):
        default_source = (
            "\n".join(
                [
                    f"{PILOT_SHEET_TITLE} - University Edition",
                    PILOT_UNIVERSITY_PAGES[page_num - 1][0],
                    *PILOT_UNIVERSITY_PAGES[page_num - 1][1],
                ]
            )
            if page_num <= len(PILOT_UNIVERSITY_PAGES)
            else ""
        )
        source_text = extracted.get(page_num) or default_source
        translated_text = PILOT_ARABIC_TRANSLATIONS.get(page_num, "")
        pages.append(
            {
                "page": page_num,
                "source_text": source_text,
                "text": translated_text,
                "expected_revision": existing_revisions.get(page_num, 0),
            }
        )

    return {
        "format": SINGLE_FORMAT_V1,
        "sheet_id": str(sheet.id),
        "title": PILOT_SHEET_TITLE,
        "subject_title": PILOT_SUBJECT_TITLE,
        "edition": UNIVERSITY,
        "file_id": str(source.file.id),
        "checksum": source.file.checksum_sha256,
        "pages": pages,
    }
