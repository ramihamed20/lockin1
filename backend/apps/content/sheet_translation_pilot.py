# ruff: noqa: E501
"""Real 10-page University sheet for 'General Pathology — Introduction' (علم الأمراض 1.pdf).

Reconstructed from the real Lock-in database records for:
- Subject: ``General Pathology`` (``4d4d8d23-d129-4f47-9a4f-adf5f5016693``)
- Sheet: ``Introduction`` / ``General Pathology — Introduction`` (``f18424d8-b5e8-4871-a812-dfe3bcd3cabf``)
- Version: ``76f0ff68-624d-4ded-9608-03b5cef895c8`` (10 pages, University edition)
- CatalogDocument: ``151802f2-28de-4fd1-af4f-10e2e83ba978`` (``edition="university"``)
- ManagedFile: ``75535a65-b0b6-411d-8d9a-d676090f5d39`` (``علم الأمراض 1.pdf``, 10 pages)

Used in isolated development/demo/testing environments and automated tests without
modifying production or student data.
"""

from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any
from uuid import UUID

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
from .models import (
    CatalogDocument,
    LearningObject,
    LearningObjectAsset,
    SheetPageTranslation,
)
from .services import ContentRuleError
from .sheet_translation import _source
from .sheet_translation_batch import SINGLE_FORMAT_V1, extract_pdf_pages_text

PILOT_SUBJECT_NODE_ID = UUID("4d4d8d23-d129-4f47-9a4f-adf5f5016693")
PILOT_SHEET_ID = UUID("f18424d8-b5e8-4871-a812-dfe3bcd3cabf")
PILOT_FILE_ID = UUID("75535a65-b0b6-411d-8d9a-d676090f5d39")
PILOT_SUBJECT_SLUG = "general-pathology"
PILOT_SUBJECT_TITLE = "General Pathology"
PILOT_SHEET_TITLE = "General Pathology — Introduction"
PILOT_FILE_NAME = "علم الأمراض 1.pdf"
PILOT_BLOB_NAME = "managed/pdf/75535a65-b0b6-411d-8d9a-d676090f5d39.pdf"
PILOT_PAGE_COUNT = 10
ALLOWED_SEED_ENVIRONMENTS = frozenset({"development", "development-demo", "demo", "testing"})

PILOT_UNIVERSITY_PAGES: tuple[tuple[str, tuple[str, ...]], ...] = (
    (
        "PAGE 01 / COVER PAGE — UNIVERSITY OF TRIPOLI — GENERAL PATHOLOGY",
        (
            "University of Tripoli - Faculty of Dentistry - Year 2 (2nd Year Dental Students)",
            "Department of General Pathology - Academic Study Sheet 1",
            "Sheet Title: General Pathology - Introduction (Sheet 1 / 10 Pages)",
            "Edition: University Official Lecture Sheet (University Edition)",
            "[Table 1.0] Sheet Structure Overview (Pages 1 to 10):",
            "  - Page 1: Cover Page & Course Overview (General Pathology - Sheet 1: Introduction)",
            "  - Pages 2-5 (Part 1): Definition of Pathology & Disease, Diagnosis, Etiology, Pathogenesis, Morphology, Clinical Manifestations, Onset, Course, Fate, Prognosis, Complications & Sequelae",
            "  - Pages 6-10 (Part 2): Acquired & Congenital Causes, Multifactorial Etiology, Disease Classification, Special Terminology, Subdivisions of Clinical Pathology, Autopsy, Biopsy & Cytology",
        ),
    ),
    (
        "PAGE 02 / DEFINITION OF PATHOLOGY, DISEASE & SUBDIVISIONS",
        (
            "Definition of Pathology: The word Pathology is derived from two Greek words: 'pathos' = disease (suffering) and 'logos' = study.",
            "Pathology is the scientific study of structural, molecular, biochemical, and functional changes in cells, tissues, and organs that underlie disease.",
            "Why is Pathology important? Because if we understand disease, we can diagnose, manage, treat, and prevent it.",
            "Definition of Disease: Disease is 'loss of ease' - a departure from normal, representing a state of ill health associated with structural and functional changes in the body.",
            "[Table 2.1] The Study of Disease Includes 8 Essential Elements:",
            "  1. Epidemiology (incidence and distribution) | 2. Etiology (causes of disease)",
            "  3. Pathogenesis (evolution and mechanisms) | 4. Morphology (structural changes)",
            "  5. Clinical significance (functional changes) | 6. Management and prognosis",
            "  7. Complications, fate, and sequelae | 8. Prevention of disease",
            "[Diagram 2.1] Division of the Study of Pathology:",
            "  Pathology -> (A) General Pathology: studies the common reactions of cells and tissues to abnormal stimuli and inherited defects.",
            "  Pathology -> (B) Systemic Pathology: studies the specific alterations in specialized organs and tissues.",
        ),
    ),
    (
        "PAGE 03 / DIAGNOSIS & THE FOUR CORE ASPECTS OF A DISEASE PROCESS",
        (
            "Diagnosis: Identification of a disease; the formal name(s) used to describe a patient's disease.",
            "Importance of Diagnosis: Essential for planning treatment and prevention of disease.",
            "Basis of Diagnosis: Based on (1) the patient's symptoms, (2) the doctor's physical findings (signs), and (3) investigations and laboratory tests (including histopathological and cytopathological examinations).",
            "Requirements to make a Diagnosis: (1) A system of classification that supplies names, definitions, and criteria, and (2) the means to ascertain the defining characteristics in the patient.",
            "[Diagram 3.1] The 4 Core Aspects of a Disease Process that Form the Core of Pathology:",
            "  1. Etiology (Cause) -> 2. Pathogenesis (Mechanisms of development) -> 3. Molecular & Morphologic Changes (Biochemical & structural alterations) -> 4. Clinical Manifestations (Functional consequences).",
            "1. Etiology (Cause of Disease): Divided into two major classes of etiologic factors:",
            "  (A) Genetic (Intrinsic) Causes: such as inherited mutations and genetic variants.",
            "  (B) Acquired (Environmental) Causes: such as infectious, nutritional, chemical, and physical factors.",
        ),
    ),
    (
        "PAGE 04 / PATHOGENESIS, MORPHOLOGIC CHANGES, SYMPTOMS, SIGNS & ONSET",
        (
            "2. Pathogenesis: The sequence of events in the response of cells or tissues to the etiologic agent, from the initial stimulus to the ultimate expression of the disease (the mechanisms by which etiology produces morphological changes).",
            "3. Molecular and Morphologic Changes: Biochemical and structural alterations induced in cells and organs that are characteristic of a disease or diagnostic of an etiologic process.",
            "Pathological / Structural Features are divided into: (A) Gross Appearance (macroscopic changes seen by the naked eye) and (B) Microscopic Features (histologic changes).",
            "4. Clinical Manifestations (Functional Derangements): The end results of genetic, biochemical, and structural changes in cells and tissues are functional abnormalities, which lead to clinical manifestations (symptoms and signs) as well as the clinical course and outcome.",
            "[Table 4.1] Comparison Between Symptoms and Signs:",
            "  - Symptoms: Subjective complaints expressed in the words given by the patient (e.g., headache, pain, vomiting).",
            "  - Signs: Objective findings discovered by the doctor during examination (e.g., tenderness = pain on pressure).",
            "Onset of the Disease: Means the mode to the start of the disease:",
            "  1. Sudden Onset: e.g., sudden coronary artery occlusion.",
            "  2. Rapid Onset: occurs in acute inflammatory conditions such as common cold and influenza.",
            "  3. Insidious (Gradual) Onset: occurs in many chronic diseases such as tuberculosis, leprosy, and metabolic diseases.",
        ),
    ),
    (
        "PAGE 05 / COURSE, FATE, PROGNOSIS, COMPLICATIONS, SEQUELAE & CAUSES",
        (
            "Course of the Disease: Means the duration of the disease:",
            "  - Short Course: characteristic of acute diseases such as influenza.",
            "  - Prolonged Course: characteristic of chronic diseases.",
            "Fate of the Disease: Describes the possible results of the disease, which include both Complications and Prognosis.",
            "Prognosis: Means (1) the outcome of the course, (2) the termination of disease, and (3) the future of the patient.",
            "Complications: Added difficulties that occur during the course of the disease and affect the prognosis.",
            "Sequelae (Sequela): The residual effects of the disease remaining after recovery.",
            "[Diagram 5.1] Major Classification of Causes of Disease (Etiology):",
            "  - Group 1: Genetic Factors -> Age and Genes.",
            "  - Group 2: Environmental (Acquired) Causes -> (1) Physical, (2) Chemical, (3) Nutritional, (4) Infectious, (5) Immunological, and (6) Psychological (Psychogenic) causes.",
        ),
    ),
    (
        "PAGE 06 / ACQUIRED CAUSES OF DISEASE (PART 1): NUTRITIONAL, PHYSICAL, CHEMICAL & INFECTIOUS",
        (
            "Acquired (Environmental) Causes are divided into: (A) Existing (Direct) Causes that lead to direct structural changes, and (B) Predisposing Factors (Risk Factors).",
            "Clinical Example - Tuberculosis (TB): Existing cause = Mycobacteria (TB bacilli); Predisposing factors = Decreased body resistance, Low immunity (as in AIDS), and Race / genetic factor (common in Black populations).",
            "1. Nutritional Disturbances: Include (A) Deficiency Diseases and (B) Obesity:",
            "  [Table 6.1] Nutritional Disturbances and Their Associated Diseases:",
            "  - Low protein intake -> Marasmus | Vitamin D deficiency -> Nutritional rickets | Iron deficiency -> Anaemia",
            "  - Obesity -> Predisposes to Atherosclerosis, Diabetes mellitus, and Hypertension",
            "2. Physical Causes: Mechanical trauma (e.g., Road Traffic Accident - RTA), Excessive heat or cold (e.g., Burns, Frostbite), Strong electricity, and Radiation.",
            "3. Chemical Causes: Act on tissues in 3 distinct ways:",
            "  (a) Local action on exposed tissues: e.g., concentrated acids and concentrated alkalis.",
            "  (b) Action on distal tissues: e.g., alcohol and some drugs acting on the liver.",
            "  (c) General effects: e.g., cyanide poisoning acting on cytochrome (cellular respiratory system) -> sudden death.",
            "4. Infectious Micro-organisms: Include (1) Bacteria, (2) Viruses, (3) Fungi, and (4) Parasites.",
        ),
    ),
    (
        "PAGE 07 / ACQUIRED CAUSES (PART 2): IMMUNOLOGICAL, PSYCHOGENIC & CONGENITAL DISEASES",
        (
            "5. Immunological Factors: Produce disease through 3 mechanisms:",
            "  (a) Decreased immunity -> permits invasion of tissue by microbes that cause infections.",
            "  (b) Abnormal immune response -> leads to hypersensitivity reactions or allergic diseases.",
            "  (c) Autoimmune disease -> antibodies and T-lymphocytes react with the body's own cells and tissues causing injury (e.g., autoimmune disease of the thyroid gland).",
            "6. Psychogenic (Psychological) Factors: Due to mental stress, which may lead to:",
            "  (a) Mental depression, (b) Drug addiction (e.g., tobacco, heroin), and (c) Psychosomatic disorders (e.g., Hypertension, Bronchial asthma, and Peptic ulcer).",
            "Congenital Diseases: Diseases found from birth (born with the individual).",
            "Etiology of Congenital Diseases: May be (1) Inherited from parents (genetic) OR (2) Acquired during pregnancy affecting the pregnant female (non-genetic, e.g., viral infection such as Rubella, or bacterial infection such as Syphilis).",
            "[Diagram 7.1] Two Main Genetic Types of Congenital Diseases:",
            "  1. Single Gene Defects -> (a) Autosomal dominant, (b) Autosomal recessive, (c) Sex-linked diseases.",
            "  2. Chromosomal Defects -> (a) Autosomal chromosomal disorders, (b) Sex chromosomal disorders.",
        ),
    ),
    (
        "PAGE 08 / MULTIFACTORIAL ETIOLOGY & CLASSIFICATION OF DISEASES",
        (
            "Internal vs. External Factors: Diseases are caused due to internal (genetic) or external (environmental) factors.",
            "Multifactorial Etiology: Means more than 'one cause to one disease'. Genetic factors affect acquired diseases, and the environment has a profound effect on genetic diseases.",
            "[Diagram 8.1] Three Relations Between Etiologic Agents and Disease:",
            "  (1) One etiologic agent -> One disease | (2) Several etiologic agents -> One disease | (3) One etiologic agent -> Several diseases.",
            "[Table 8.1] Classification of Diseases (By Nature of Process vs. By Cause):",
            "  (A) Classification According to the Nature of the Disease Process (4 Categories):",
            "      1. Developmental: genetic and congenital diseases.",
            "      2. Inflammatory: trauma, infections, immune diseases, etc.",
            "      3. Neoplastic: tumors and cancers.",
            "      4. Degenerative: ageing diseases.",
            "  (B) Classification According to the Cause (9 Categories):",
            "      1. Acquired diseases | 2. Inherited | 3. Congenital | 4. Nutritional | 5. Infection | 6. Metabolic | 7. Autoimmune | 8. Allergic | 9. Iatrogenic.",
        ),
    ),
    (
        "PAGE 09 / SPECIAL DISEASE TERMINOLOGY & EPIDEMIOLOGIC / CLINICAL PATTERNS",
        (
            "1. Iatrogenic Disease: A hospital-acquired / healthcare-associated disease; may occur by error of the treating doctor, clinical pharmacist, or nurse, or due to nosocomial infection (hospital-acquired infection) when there is no sterilization.",
            "2. Idiopathic Disease: A disease in which the cause is not well known.",
            "3. Syndrome (Greek = 'running together'): An aggregate / collection of symptoms not due to a specific disease, resulting from interference at any point with a chain of physiological processes and impairment of body function.",
            "4. Communicable Disease: A disease that can be transmitted from one person to another.",
            "[Table 9.1] Epidemiologic & Clinical Distribution Patterns of Disease:",
            "  - Epidemic Disease: Affects many people in a given region at the same time.",
            "  - Endemic Disease: Appears to be indigenous to a particular area and is not of epidemic proportions.",
            "  - Pandemic Disease: Affects the whole world (e.g., COVID-19).",
            "  - Localized Disease: Confined to one area of the body.",
            "  - Systemic (Generalized) Disease: Spreads throughout the body or to many systems.",
            "  - Self-limiting Disease: Resolves on its own without requiring treatment to be cured.",
            "  - Intermittent Disease: Has relapsing and remitting symptoms (e.g., Rheumatoid arthritis, Bronchial asthma).",
            "  - Asymptomatic (Sub-clinical) Disease: Symptoms are not noticeable; detected only by routine physical examination or testing.",
        ),
    ),
    (
        "PAGE 10 / SUBDIVISIONS OF CLINICAL PATHOLOGY & METHODS OF STUDY (AUTOPSY, BIOPSY, CYTOLOGY)",
        (
            "[Table 10.1] Eight Subdivisions of Clinical Pathology:",
            "  1. Morbid Anatomy (Forensic Pathology): Description of gross and microscopic changes specially done after postmortem dissection.",
            "  2. Cellular Pathology: Includes (a) Histopathology (study of tissues) and (b) Cytology / Cytopathology (microscopic study of separated cells by smear / cellular morphology).",
            "  3. Haematology: Laboratory study of diseases of the blood.",
            "  4. Chemical Pathology: Study of chemicals in fluids such as blood, urine, and cerebro-spinal fluid (CSF).",
            "  5. Microbiology: Study of infections or infectious diseases.",
            "  6. Immunology: Study of body defences and hypersensitivity reactions.",
            "  7. Genetics: Study of inherited diseases.",
            "  8. Molecular Biology: Study of biochemistry at a molecular level (overlaps particularly with genetics and biochemistry).",
            "[Table 10.2] Three Methods for the Study of Pathology:",
            "  1. Autopsy (Post-mortem examination): Means 'see for yourself'; performed on a dead body (cadaver) by a forensic pathologist to learn the truth about the person's health during life and how the person really died (specimen = autopsy specimen).",
            "  2. Biopsy (Ante-mortem = during the patient's life): Removal of very small samples of tissue from a living patient for histopathological examination to reach diagnosis (internal organ biopsy can be done during endoscopy under ultrasound [US] guide).",
            "  3. Cytology (Smear): Microscopic study of cellular morphology using separated cells.",
        ),
    ),
)

PILOT_ARABIC_TRANSLATIONS: dict[int, str] = {
    1: (
        "الصفحة 01 / صفحة الغلاف — جامعة طرابلس — علم الأمراض العام (Page 01 / Cover Page — University of Tripoli — General Pathology)\n\n"
        "• جامعة طرابلس (University of Tripoli) - كلية طب وجراحة الفم والأسنان (Faculty of Dentistry) - السنة الثانية (Year 2 Dental Students).\n"
        "• قسم علم الأمراض العام (Department of General Pathology) - الشيت الدراسي الأول (Academic Study Sheet 1).\n"
        "• عنوان الشيت: علم الأمراض العام — مقدمة (General Pathology — Introduction) [الشيت 1 / إجمالي 10 صفحات].\n"
        "• النسخة: شيت المحاضرات الرسمي للجامعة (University Edition — علم الأمراض 1.pdf).\n"
        "• [جدول 1.0 / Table 1.0] نظرة عامة على هيكلة الشيت (الصفحات 1 إلى 10):\n"
        "  - الصفحة 1: صفحة الغلاف ونظرة عامة على المقرر (General Pathology - Sheet 1: Introduction).\n"
        "  - الصفحات 2–5 (الجزء الأول / Part 1): تعريف علم الأمراض (Pathology) والمرض (Disease)، التشخيص (Diagnosis)، السببيات (Etiology)، الإمراضية (Pathogenesis)، المورفولوجيا (Morphology)، المظاهر السريرية (Clinical Manifestations)، البداية (Onset)، السير (Course)، المصير (Fate)، المآل (Prognosis)، المضاعفات (Complications)، والعواقب (Sequelae).\n"
        "  - الصفحات 6–10 (الجزء الثاني / Part 2): الأسباب المكتسبة والخلقية (Acquired & Congenital Causes)، السببيات متعددة العوامل (Multifactorial Etiology)، تصنيف الأمراض (Disease Classification)، المصطلحات الخاصة، فروع علم الأمراض السريري (Clinical Pathology)، التشريح المرضي للجثة (Autopsy)، الخزعة (Biopsy)، وعلم الخلايا (Cytology)."
    ),
    2: (
        "الصفحة 02 / تعريف علم الأمراض والمرض وأقسام علم الأمراض (Page 02 / Definition of Pathology, Disease & Subdivisions)\n\n"
        "• تعريف علم الأمراض (Pathology): كلمة (Pathology) مشتقة من كلمتين يونانيتين: (pathos) وتعني المرض أو المعاناة (Disease)، و(logos) وتعني الدراسة (Study).\n"
        "• علم الأمراض (Pathology): هو الدراسة العلمية للتغيرات البنيوية (Structural)، والجزيئية (Molecular)، والكيميائية الحيوية (Biochemical)، والوظيفية (Functional) في الخلايا والأنسجة والأعضاء التي تكمن وراء حدوث المرض.\n"
        "• لماذا يُعد علم الأمراض (Pathology) مهمًا؟ لأننا إذا فهمنا المرض تمكّنا من تشخيصه (Diagnose)، وتدبيره وعلاجه (Treat)، والوقاية منه (Prevent).\n"
        "• تعريف المرض (Disease): يُوصف بأنه فقدان الراحة (Loss of ease) وانحراف عن الوضع الطبيعي (Departure from normal)، ويمثّل حالة اعتلال صحي ترتبط بتغيرات بنيوية (Structural) ووظيفية (Functional) في الجسم.\n"
        "• [جدول 2.1 / Table 2.1] تشمل دراسة المرض (Study of Disease) ثمانية عناصر أساسية:\n"
        "  1. الوبائيات (Epidemiology) | 2. السببيات أو أسباب المرض (Etiology)\n"
        "  3. الإمراضية وآليات تطوّر المرض (Pathogenesis) | 4. التغيرات الشكلية أو المورفولوجيا (Morphology)\n"
        "  5. الأهمية السريرية والتغيرات الوظيفية (Clinical significance) | 6. التدبير العلاجي والمآل (Management and prognosis)\n"
        "  7. المضاعفات والمصير والعواقب (Complications, fate, and sequelae) | 8. الوقاية (Prevention)\n"
        "• [رسم تخطيطي 2.1 / Diagram 2.1] أقسام دراسة علم الأمراض (Subdivisions of Pathology):\n"
        "  - (أ) علم الأمراض العام (General Pathology): يدرس التفاعلات والاستجابات المشتركة للخلايا والأنسجة تجاه المنبّهات غير الطبيعية والعيوب الموروثة (Inherited defects).\n"
        "  - (ب) علم الأمراض الجهازي (Systemic Pathology): يدرس التغيرات الخاصة التي تصيب الأعضاء والأنسجة المتخصّصة (Specialized organs and tissues)."
    ),
    3: (
        "الصفحة 03 / التشخيص والأركان الأربعة الأساسية للعملية المرضية (Page 03 / Diagnosis & The Four Core Aspects of a Disease Process)\n\n"
        "• التشخيص (Diagnosis): هو التعرّف على المرض وتحديده (Identification of a disease)، وهو الاسم الرسمي المستخدم لوصف مرض المريض.\n"
        "• أهمية التشخيص (Diagnosis): ضروري جدًا لوضع خطة العلاج (Treatment) والوقاية من المرض (Prevention).\n"
        "• أُسس التشخيص (Basis of Diagnosis): يعتمد على: (1) أعراض المريض (Symptoms)، و(2) العلامات التي يكتشفها الطبيب بالفحص (Signs / Doctor's findings)، و(3) الاستقصاءات والفحوص المختبرية (Laboratory tests) بما فيها الفحص النسيجي المرضي (Histopathological) والفحص الخلوي المرضي (Cytopathological).\n"
        "• متطلبات إجراء التشخيص (Diagnosis): (1) نظام تصنيف (Classification system) يوفّر الأسماء والتعريفات والمعايير، و(2) الوسائل اللازمة للتحقّق من هذه الخصائص المميزة لدى المريض.\n"
        "• [رسم تخطيطي 3.1 / Diagram 3.1] الجوانب الأربعة الأساسية للعملية المرضية التي تشكّل جوهر علم الأمراض (Pathology):\n"
        "  1. السببيات (Etiology) ← 2. الإمراضية (Pathogenesis) ← 3. التغيرات الجزيئية والمورفولوجية (Molecular & Morphologic Changes) ← 4. المظاهر السريرية (Clinical Manifestations).\n"
        "• 1. السببيات (Etiology — سبب المرض): تنقسم العوامل المسببة للمرض إلى فئتين رئيسيتين:\n"
        "  - (أ) عوامل وراثية (Genetic Causes): مثل الطفرات الموروثة (Inherited mutations).\n"
        "  - (ب) عوامل مكتسبة أو بيئية (Acquired / Environmental Causes): مثل العوامل المعدية (Infectious)، والغذائية (Nutritional)، والكيميائية (Chemical)، والفيزيائية (Physical)."
    ),
    4: (
        "الصفحة 04 / علم الأمراض العام (General Pathology) — الإمراضية، التغيرات المورفولوجية، الأعراض والعلامات، وبداية المرض (Page 04 / Pathogenesis, Morphologic Changes, Symptoms, Signs & Onset)\n\n"
        "• 2. الإمراضية (Pathogenesis): هي تسلسل الأحداث في استجابة الخلايا أو الأنسجة للعامل المسبّب (Etiologic agent)، بدءًا من المنبّه الأولي وحتى التعبير النهائي عن المرض (الآليات التي تُحدث بها السببيات [etiology] تغيرات مورفولوجية).\n"
        "• 3. التغيرات الجزيئية والمورفولوجية (Molecular and Morphologic Changes): هي التبدّلات الكيميائية الحيوية والبنيوية التي تحدث في الخلايا والأعضاء وتكون مميزة للمرض أو مشخصة للعملية السببية.\n"
        "• تنقسم السمات المرضية البنيوية (Pathological / Structural Features) إلى: (أ) المظهر العياني (Gross Appearance / Macroscopic) الذي يُرى بالعين المجردة، و(ب) السمات المجهرية (Microscopic / Histologic Features).\n"
        "• 4. المظاهر السريرية والاختلالات الوظيفية (Clinical Manifestations): إن النتيجة النهائية للتغيرات الوراثية والكيميائية الحيوية والبنيوية هي اختلالات وظيفية (Functional abnormalities) تؤدي إلى ظهور الأعراض والعلامات وتحدّد السير السريري للمرض.\n"
        "• [جدول 4.1 / Table 4.1] المقارنة بين الأعراض (Symptoms) والعلامات (Signs):\n"
        "  - الأعراض (Symptoms): شكاوى ذاتية يعبّر عنها المريض بكلماته مثل الصداع (Headache)، والألم (Pain)، والإقياء (Vomiting).\n"
        "  - العلامات (Signs): موجودات موضوعية يكتشفها الطبيب أثناء الفحص مثل المضض أو الإيلام بالضغط (Tenderness = pain on pressure).\n"
        "• بداية المرض (Onset of the Disease — كيفية بدء المرض):\n"
        "  1. بداية مفاجئة (Sudden Onset): مثل الانسداد المفاجئ للشريان التاجي (Sudden coronary artery occlusion).\n"
        "  2. بداية سريعة (Rapid Onset): تحدث في الحالات الالتهابية الحادة (Acute inflammatory conditions) مثل الزكام (Common cold) والإنفلونزا (Influenza).\n"
        "  3. بداية خفية أو تدريجية (Insidious / Gradual Onset): تحدث في الأمراض المزمنة مثل السل (Tuberculosis)، والجذام (Leprosy)، والأمراض الاستقلابية (Metabolic diseases)."
    ),
    5: (
        "الصفحة 05 / علم الأمراض العام (General Pathology) — سير المرض، المصير، المآل، المضاعفات، العواقب، وأسباب الأمراض (Page 05 / Course, Fate, Prognosis, Complications, Sequelae & Causes)\n\n"
        "• سير المرض (Course of the Disease): يقصد به مدة المرض (Duration of the disease):\n"
        "  - سير قصير (Short Course): يميّز الأمراض الحادة مثل الإنفلونزا (Influenza).\n"
        "  - سير طويل أو مديد (Prolonged Course): يميّز الأمراض المزمنة (Chronic diseases).\n"
        "• مصير المرض (Fate of the Disease): يصف النتائج المحتملة للمرض، ويشمل كلاً من المضاعفات (Complications) والمآل (Prognosis).\n"
        "• مآل المرض (Prognosis): يعني (1) حصيلة سير المرض، و(2) كيفية انتهاء المرض، و(3) مستقبل المريض الصحي.\n"
        "• المضاعفات (Complications): صعوبات ومشكلات إضافية تحدث أثناء سير المرض وتؤثر في مآله (Prognosis).\n"
        "• العواقب أو العقابيل (Sequelae / Sequela): الآثار المتبقية للمرض بعد الشفاء (Residual effects after recovery).\n"
        "• [رسم تخطيطي 5.1 / Diagram 5.1] التصنيف الرئيسي لأسباب الأمراض (Etiology):\n"
        "  - المجموعة الأولى: العوامل الوراثية (Genetic Factors) ← العمر (Age) والجينات (Genes).\n"
        "  - المجموعة الثانية: الأسباب البيئية أو المكتسبة (Environmental / Acquired Causes) ← (1) الفيزيائية (Physical)، (2) الكيميائية (Chemical)، (3) الغذائية (Nutritional)، (4) المعدية (Infectious)، (5) المناعية (Immunological)، و(6) النفسية (Psychological / Psychogenic)."
    ),
    6: (
        "الصفحة 06 / علم الأمراض العام (General Pathology) — الأسباب المكتسبة للمرض (الجزء 1): الغذائية والفيزيائية والكيميائية والمعدية (Page 06 / Acquired Causes Part 1)\n\n"
        "• تنقسم الأسباب المكتسبة البيئية إلى: (أ) أسباب قائمة أو مباشرة (Existing / Direct Causes) تؤدي مباشرة إلى تغيرات بنيوية، و(ب) عوامل مؤهبة أو عوامل خطورة (Predisposing / Risk Factors).\n"
        "• مثال تطبيقي — مرض السل (Tuberculosis - TB): السبب المباشر القائم هو المتفطرات السلية (Mycobacteria / TB bacilli)، بينما العوامل المؤهبة تشمل نقص مقاومة الجسم، وضعف المناعة كما في الإيدز (AIDS)، والعرق أو العامل الوراثي.\n"
        "• 1. اضطرابات التغذية (Nutritional Disturbances): تشمل (أ) أمراض العوز الغذائي (Deficiency Diseases) و(ب) السمنة (Obesity):\n"
        "  [جدول 6.1 / Table 6.1] اضطرابات التغذية والأمراض المرتبطة بها:\n"
        "  - نقص تناول البروتين ← السغل أو الهزال الشديد (Marasmus) | عوز فيتامين د (Vitamin D deficiency) ← الكساح الغذائي (Nutritional rickets) | عوز الحديد (Iron deficiency) ← فقر الدم (Anaemia)\n"
        "  - السمنة (Obesity) ← تؤهب لتصلب الشرايين (Atherosclerosis)، وداء السكري (Diabetes mellitus)، وارتفاع ضغط الدم (Hypertension)\n"
        "• 2. الأسباب الفيزيائية (Physical Causes): الرضوض الميكانيكية (Mechanical trauma) مثل حوادث الطرق (RTA)، والحرارة أو البرودة المفرطة مثل الحروق (Burns) وعضة الصقيع (Frostbite)، والكهرباء القوية، والإشعاع.\n"
        "• 3. الأسباب الكيميائية (Chemical Causes): تؤثر في الأنسجة بثلاث طرق:\n"
        "  - (أ) تأثير موضعي مباشر (Local action): مثل الأحماض المركزة والقلويات المركزة.\n"
        "  - (ب) تأثير على أنسجة بعيدة (Distal tissues): مثل الكحول وبعض الأدوية التي تؤثر في الكبد.\n"
        "  - (ج) تأثيرات عامة شاملة (General effects): مثل التسمم بالسيانيد (Cyanide poisoning) الذي يثبط السيتوكروم (Cytochrome) في جهاز التنفس الخلوي فيسبب الموت المفاجئ.\n"
        "• 4. الأحياء الدقيقة المعدية (Infectious Micro-organisms): تشمل البكتيريا (Bacteria)، والفيروسات (Viruses)، والفطريات (Fungi)، والطفيليات (Parasites)."
    ),
    7: (
        "الصفحة 07 / علم الأمراض العام (General Pathology) — الأسباب المكتسبة (الجزء 2): المناعية والنفسية والأمراض الخلقية والوراثية (Page 07 / Immunological, Psychogenic & Congenital Diseases)\n\n"
        "• 5. العوامل المناعية (Immunological Factors): تُحدث المرض عبر 3 آليات:\n"
        "  - (أ) نقص المناعة (Decreased immunity) ← يسمح بغزو الأنسجة بواسطة الميكروبات وحدوث العدوى.\n"
        "  - (ب) استجابة مناعية غير طبيعية (Abnormal immune response) ← تؤدي إلى تفاعلات فرط الحساسية أو الأمراض التحسسية (Allergic diseases).\n"
        "  - (ج) أمراض المناعة الذاتية (Autoimmune disease) ← تتفاعل الأجسام المضادة والخلايا اللمفاوية التائية (T-lymphocytes) ضد خلايا وأنسجة الجسم نفسه مسببة أذيتها (مثل مرض المناعة الذاتية في الغدة الدرقية).\n"
        "• 6. العوامل النفسية المنشأ (Psychogenic Factors): تنتج عن الضغط النفسي (Mental stress) وقد تؤدي إلى:\n"
        "  - (أ) الاكتئاب النفسي (Mental depression)، و(ب) إدمان المخدرات مثل التبغ والهيروين، و(ج) الاضطرابات النفسية الجسدية (Psychosomatic disorders) مثل ارتفاع ضغط الدم (Hypertension)، والربو القصبي (Bronchial asthma)، والقرحة الهضمية (Peptic ulcer).\n"
        "• الأمراض الخلقية (Congenital Diseases): هي أمراض موجودة منذ الولادة (يولد بها الفرد).\n"
        "• أسباب الأمراض الخلقية (Etiology of Congenital Diseases): قد تكون (1) موروثة من الوالدين (Inherited / Genetic)، أو (2) مكتسبة أثناء الحمل تصيب الأم الحامل مثل الحصبة الألمانية الفيروسية (Rubella) أو الزهري البكتيري (Syphilis).\n"
        "• [رسم تخطيطي 7.1 / Diagram 7.1] تنقسم الأمراض الخلقية الوراثية إلى نوعين رئيسيين:\n"
        "  1. عيوب الجين الواحد (Single Gene Defects): سائدة جسدية (Autosomal dominant)، ومتنحية جسدية (Autosomal recessive)، ومرتبطة بالجنس (Sex-linked).\n"
        "  2. عيوب الصبغيات أو الكروموسومات (Chromosomal Defects): اضطرابات الصبغيات الجسدية (Autosomal chromosomal) واضطرابات الصبغيات الجنسية (Sex chromosomal)."
    ),
    8: (
        "الصفحة 08 / علم الأمراض العام (General Pathology) — السببيات متعددة العوامل وتصنيف الأمراض (Page 08 / Multifactorial Etiology & Classification of Diseases)\n\n"
        "• العوامل الداخلية مقابل الخارجية: تحدث الأمراض نتيجة عوامل داخلية وراثية (Internal) أو خارجية بيئية (External).\n"
        "• السببيات متعددة العوامل (Multifactorial Etiology): تعني وجود أكثر من «سبب واحد لمرض واحد»؛ فالعوامل الوراثية تؤثر في الأمراض المكتسبة، كما أن للبيئة تأثيرًا عميقًا في الأمراض الوراثية.\n"
        "• [رسم تخطيطي 8.1 / Diagram 8.1] العلاقات الثلاث بين العوامل المسببة (Etiologic agents) والمرض:\n"
        "  (1) عامل سببي واحد ← مرض واحد | (2) عدة عوامل سببية ← مرض واحد | (3) عامل سببي واحد ← عدة أمراض.\n"
        "• [جدول 8.1 / Table 8.1] تصنيف الأمراض (حسب طبيعة العملية المرضية وحسب السبب):\n"
        "  - (أ) التصنيف حسب طبيعة العملية المرضية (Nature of Disease Process — 4 فئات):\n"
        "    1. النمائية أو التطورية (Developmental): الأمراض الوراثية والخلقية (Genetic and congenital).\n"
        "    2. الالتهابية (Inflammatory): الرضوض، والعدوى، والأمراض المناعية.\n"
        "    3. الورمية (Neoplastic): الأورام والسرطانات (Tumors and cancers).\n"
        "    4. التنكسية (Degenerative): أمراض الشيخوخة والتقدم في العمر (Ageing).\n"
        "  - (ب) التصنيف حسب السبب (According to the Cause — 9 فئات):\n"
        "    1. المكتسبة (Acquired) | 2. الموروثة (Inherited) | 3. الخلقية (Congenital) | 4. الغذائية (Nutritional) | 5. العدوى (Infection) | 6. الاستقلابية (Metabolic) | 7. المناعة الذاتية (Autoimmune) | 8. التحسسية (Allergic) | 9. العلاجية المنشأ (Iatrogenic)."
    ),
    9: (
        "الصفحة 09 / علم الأمراض العام (General Pathology) — مصطلحات الأمراض الخاصة وأنماط الانتشار الوبائي والسريري (Page 09 / Special Disease Terminology & Epidemiologic Patterns)\n\n"
        "• 1. المرض العلاجي المنشأ أو المكتسب بالمستشفى (Iatrogenic Disease): ينشأ بسبب خطأ من الطبيب المعالج أو الصيدلي السريري أو الممرض، أو نتيجة عدوى المستشفيات (Nosocomial infection) عند غياب التعقيم.\n"
        "• 2. المرض مجهول السبب (Idiopathic Disease): مرض لا يُعرف سببه بشكل واضح.\n"
        "• 3. المتلازمة (Syndrome — وتعني باليونانية الجريان معًا): مجموعة من الأعراض (Symptoms) والعلامات لا تعود لمرض نوعي واحد، بل تنتج عن تداخل في سلسلة من العمليات الفيزيولوجية واختلال وظيفة الجسم.\n"
        "• 4. المرض الساري أو المعدي (Communicable Disease): مرض يمكن انتقاله من شخص إلى آخر.\n"
        "• [جدول 9.1 / Table 9.1] أنماط انتشار الأمراض وسيرها السريري:\n"
        "  - المرض الوبائي (Epidemic Disease): يصيب عددًا كبيرًا من الناس في منطقة معينة في الوقت نفسه.\n"
        "  - المرض المتوطن (Endemic Disease): يستوطن منطقة جغرافية محددة بصورة دائمة دون أن يصل إلى حجم الوباء.\n"
        "  - الجائحة العالمية (Pandemic Disease): مرض يصيب العالم بأسره مثل كوفيد-19 (COVID-19).\n"
        "  - المرض الموضعي (Localized Disease): ينحصر في منطقة واحدة من الجسم.\n"
        "  - المرض الجهازي أو المعمّم (Systemic / Generalized Disease): ينتشر في جميع أنحاء الجسم أو يصيب عدة أجهزة.\n"
        "  - المرض محدد الذات (Self-limiting Disease): يشفى تلقائيًا دون حاجة إلى علاج.\n"
        "  - المرض المتقطع (Intermittent Disease): يتميز بنوبات انتكاس وهدوء للأعراض مثل التهاب المفاصل الروماتويدي (Rheumatoid arthritis) والربو القصبي (Bronchial asthma).\n"
        "  - المرض اللاعرضي أو تحت السريري (Asymptomatic / Sub-clinical Disease): لا تكون أعراضه ملحوظة للمريض ويُكتشف فقط بالفحص الروتيني أو الاختبارات."
    ),
    10: (
        "الصفحة 10 / فروع علم الأمراض السريري وطرق دراسة علم الأمراض (Page 10 / Subdivisions of Clinical Pathology & Methods of Study)\n\n"
        "• [جدول 10.1 / Table 10.1] الفروع الثمانية لعلم الأمراض السريري (Subdivisions of Clinical Pathology):\n"
        "  1. التشريح المرضي أو الطب الشرعي (Morbid Anatomy / Forensic Pathology): وصف التغيرات العيانية والمجهرية (Gross and microscopic changes) خاصة بعد تشريح الجثة.\n"
        "  2. علم الأمراض الخلوي (Cellular Pathology): يشمل (أ) علم أمراض الأنسجة (Histopathology) لدراسة الأنسجة، و(ب) علم الخلايا (Cytology / Cytopathology) لدراسة الخلايا المنفصلة والشكل الخلوي (Cellular morphology) بواسطة المسحة (Smear).\n"
        "  3. علم أمراض الدم (Haematology): الدراسة المختبرية لأمراض الدم.\n"
        "  4. علم الأمراض الكيميائي (Chemical Pathology): دراسة المواد الكيميائية في سوائل الجسم مثل الدم والبول والسائل الدماغي الشوكي (CSF).\n"
        "  5. علم الأحياء الدقيقة (Microbiology): دراسة العدوى والأمراض المعدية.\n"
        "  6. علم المناعة (Immunology): دراسة دفاعات الجسم وتفاعلات فرط الحساسية.\n"
        "  7. علم الوراثة (Genetics): دراسة الأمراض الموروثة.\n"
        "  8. البيولوجيا الجزيئية (Molecular Biology): دراسة الكيمياء الحيوية على المستوى الجزيئي وتتداخل مع الوراثة والكيمياء الحيوية.\n"
        "• [جدول 10.2 / Table 10.2] الطرق الثلاث لدراسة علم الأمراض (Methods for the Study of Pathology):\n"
        "  1. تشريح الجثة (Autopsy / Post-mortem examination): تعني «انظر بنفسك»، وتُجرى على الجثة (Cadaver) بواسطة طبيب التشريح المرضي الشرعي لمعرفة حقيقة صحة الشخص أثناء حياته وسبب الوفاة (العينة تُسمى Autopsy specimen).\n"
        "  2. الخزعة (Biopsy — أثناء حياة المريض / Ante-mortem): إزالة عينات صغيرة جدًا من الأنسجة من المريض الحي للفحص النسيجي (Histopathology) للوصول إلى التشخيص (Diagnosis)، ويمكن أخذ خزعة الأعضاء الداخلية أثناء التنظير (Endoscopy) بتوجيه الموجات فوق الصوتية (US guide).\n"
        "  3. الفحص الخلوي أو المسحة (Cytology / Smear): الدراسة المجهرية لشكل الخلايا المنفصلة."
    ),
}


def _escape_pdf_text(value: str) -> str:
    ascii_normalized = (
        value.replace("—", "-")
        .replace("–", "-")
        .replace("→", "->")
        .replace("←", "<-")
        .replace("•", "-")
    )
    safe_ascii = ascii_normalized.encode("ascii", errors="replace").decode("ascii")
    return safe_ascii.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def build_pilot_pdf() -> bytes:
    """Build the 10-page English PDF for 'General Pathology — Introduction' (University)."""

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
            f"BT /F2 14 Tf 36 760 Td ({header_text}) Tj ET",
            "0.14 0.42 0.76 rg",
            f"BT /F2 11 Tf 36 734 Td ({_escape_pdf_text(heading)}) Tj ET",
            "0.13 0.18 0.26 rg",
        ]
        for idx, line in enumerate(bullets):
            y_pos = 702 - idx * 48
            commands.append(f"BT /F1 9 Tf 36 {y_pos} Td ({_escape_pdf_text(line)}) Tj ET")
        commands.append(f"BT /F1 8 Tf 36 42 Td ({footer_text}) Tj ET")
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
    """Idempotently ensure the 10-page 'General Pathology — Introduction' (University) sheet exists."""

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
            id=PILOT_SUBJECT_NODE_ID,
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

    media_root = Path(getattr(settings, "MEDIA_ROOT", "media"))
    disk_blob_path = media_root / PILOT_BLOB_NAME
    if disk_blob_path.is_file() and disk_blob_path.stat().st_size > 100_000:
        payload = disk_blob_path.read_bytes()
    else:
        payload = build_pilot_pdf()
    checksum = hashlib.sha256(payload).hexdigest()
    expected_page_count = len(PILOT_UNIVERSITY_PAGES)

    existing = (
        LearningObject.objects.filter(
            current_version__academic_node=subject_node,
            current_version__title__in=(PILOT_SHEET_TITLE, "Introduction"),
        )
        .select_related("current_version", "published_version")
        .first()
    )
    if existing is not None:
        version = existing.published_version or existing.current_version
        if version is not None and version.page_count == expected_page_count:
            try:
                src = _source(existing, UNIVERSITY)
                if src.file.checksum_sha256 == checksum:
                    return existing
            except ContentRuleError:
                pass

        # Upgrade any older synthetic 4-page pilot to the full 10-page real sheet
        managed = ManagedFile.objects.filter(id=PILOT_FILE_ID).first()
        if managed is None:
            managed = ManagedFile.objects.create(
                id=PILOT_FILE_ID,
                owner=actor,
                original_name=PILOT_FILE_NAME,
                kind=ManagedFile.Kind.PDF,
                content_type="application/pdf",
                size_bytes=len(payload),
                checksum_sha256=checksum,
                pdf_page_count=expected_page_count,
                validation_status=ManagedFile.ValidationStatus.READY,
                scan_status=ManagedFile.ScanStatus.NOT_CONFIGURED,
                blob=ContentFile(payload, name=PILOT_FILE_NAME),
            )
        else:
            managed.original_name = PILOT_FILE_NAME
            managed.size_bytes = len(payload)
            managed.checksum_sha256 = checksum
            managed.pdf_page_count = expected_page_count
            managed.blob.save(PILOT_FILE_NAME, ContentFile(payload), save=False)
            managed.save()

        if version is not None:
            version.page_count = expected_page_count
            version.title = PILOT_SHEET_TITLE
            version.save(update_fields=["page_count", "title"])
            LearningObjectAsset.objects.filter(
                version=version,
            ).update(managed_file=managed)
            CatalogDocument.objects.filter(
                version=version,
                edition=UNIVERSITY,
            ).update(managed_file=managed)
        existing.refresh_from_db()
        return existing

    managed = ManagedFile.objects.filter(id=PILOT_FILE_ID).first()
    if managed is None:
        managed = ManagedFile.objects.create(
            id=PILOT_FILE_ID,
            owner=actor,
            original_name=PILOT_FILE_NAME,
            kind=ManagedFile.Kind.PDF,
            content_type="application/pdf",
            size_bytes=len(payload),
            checksum_sha256=checksum,
            pdf_page_count=expected_page_count,
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
                "University edition Sheet 1 (10 pages): Introduction to General Pathology, "
                "Diagnosis, Etiology, Pathogenesis, Morphology, Clinical Manifestations, "
                "Acquired & Congenital Causes, Classification, Clinical Pathology & Biopsy/Autopsy."
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
