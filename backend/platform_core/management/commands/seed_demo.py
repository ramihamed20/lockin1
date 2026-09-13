"""Development-only, repeatable data for trying Lock-in locally."""

from __future__ import annotations

import hashlib
import uuid
from datetime import timedelta
from decimal import Decimal

from django.conf import settings
from django.core.files.base import ContentFile
from django.core.management import BaseCommand, CommandError, call_command
from django.utils import timezone

DEMO_ACCOUNTS = (
    ("admin@lockin.local", "Admin123!", "Lock-in Super Admin", True, True),
    ("developer@lockin.local", "Dev123!", "Lock-in Developer", True, False),
    ("creator@lockin.local", "Creator123!", "Amina Content Creator", False, False),
    ("student@lockin.local", "Student123!", "Maya Student", False, False),
    ("student1@lockin.local", "Student123!", "Omar Hassan", False, False),
    ("student2@lockin.local", "Student123!", "Sara Ali", False, False),
    ("student3@lockin.local", "Student123!", "Yousef Nasser", False, False),
    ("student4@lockin.local", "Student123!", "Lina Faraj", False, False),
    ("student5@lockin.local", "Student123!", "Noor Salem", False, False),
)

# These accounts exist only when the explicit E2E option is selected.  Keeping
# them out of the normal demo dataset prevents test-only payment states from
# appearing in ordinary local demos.
SUBSCRIPTION_E2E_ACCOUNTS = (
    ("qa.google@lockin.local", "StudyQA123!", "QA Google", None, True),
    ("qa.trial@lockin.local", "StudyQA123!", "QA Trial", "qa_trial", False),
    ("qa.expired@lockin.local", "StudyQA123!", "QA Expired", "qa_expired", False),
    ("qa.renewal@lockin.local", "StudyQA123!", "QA Renewal", "qa_renewal", False),
    ("qa.renewal-early@lockin.local", "StudyQA123!", "QA Renewal Early", "qa_renewal_early", False),
    ("qa.review@lockin.local", "StudyQA123!", "QA Review", "qa_review", False),
)


def stable_uuid(value: str) -> uuid.UUID:
    return uuid.uuid5(uuid.NAMESPACE_URL, f"https://lockin.local/demo/{value}")


def demo_pdf_payload(number: int) -> bytes:
    """Build a small, valid single-page PDF for the local Focus workspace."""
    stream = (f"BT\n/F1 20 Tf\n72 720 Td\n(Lock-in demo study guide {number}) Tj\nET\n").encode(
        "ascii"
    )
    objects = (
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
        b"/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Length "
        + str(len(stream)).encode("ascii")
        + b" >>\nstream\n"
        + stream
        + b"endstream",
    )
    document = bytearray(b"%PDF-1.4\n")
    offsets: list[int] = []
    for index, value in enumerate(objects, 1):
        offsets.append(len(document))
        document.extend(f"{index} 0 obj\n".encode("ascii"))
        document.extend(value)
        document.extend(b"\nendobj\n")
    xref_offset = len(document)
    document.extend(f"xref\n0 {len(objects) + 1}\n".encode("ascii"))
    document.extend(b"0000000000 65535 f \n")
    for offset in offsets:
        document.extend(f"{offset:010d} 00000 n \n".encode("ascii"))
    document.extend(
        (
            f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\n"
            f"startxref\n{xref_offset}\n%%EOF\n"
        ).encode("ascii")
    )
    return bytes(document)


class Command(BaseCommand):
    help = "Create safe, idempotent local development data. Refuses production settings."

    def add_arguments(self, parser):
        parser.add_argument(
            "--subscription-e2e",
            action="store_true",
            help="Add deterministic subscription browser-test accounts (testing settings only).",
        )
        parser.add_argument(
            "--manual-qa",
            action="store_true",
            help="Add idempotent Founder and student accounts for local manual QA.",
        )

    def handle(self, *args, **options):
        if getattr(settings, "ENVIRONMENT", "") not in {
            "development",
            "development-demo",
            "demo",
            "testing",
        }:
            raise CommandError(
                "seed_demo is available only in the development or public demo environment."
            )
        if options["subscription_e2e"] and settings.ENVIRONMENT != "testing":
            raise CommandError("--subscription-e2e is available only with testing settings.")
        # This command deliberately writes an idempotent public demo dataset.
        # Keeping every record in one transaction blocks sign-in for the whole
        # seed on a hosted database, so persist each operation normally instead.
        data = self._seed()
        manual_qa = self._seed_manual_qa() if options["manual_qa"] else None
        e2e_data = self._seed_subscription_e2e() if options["subscription_e2e"] else None
        self.stdout.write(self.style.SUCCESS("Lock-in demo data is ready."))
        self.stdout.write("\nCredentials (development only):")
        for email, password, _, _, _ in DEMO_ACCOUNTS:
            self.stdout.write(f"  {email} / {password}")
        self.stdout.write("\nCommand: python manage.py seed_demo")
        self.stdout.write(
            "Reset local database: python manage.py flush --noinput && "
            "python manage.py migrate && python manage.py seed_demo"
        )
        self.stdout.write(
            "Seeded "
            f"{data['content']} documents, {data['questions']} questions, "
            f"and {data['students']} learners."
        )
        if e2e_data:
            self.stdout.write(
                "Prepared subscription E2E accounts: " + ", ".join(e2e_data["emails"])
            )
        if manual_qa:
            self.stdout.write("Prepared local manual-QA accounts:")
            self.stdout.write("  local_founder@lockin.local / FounderLocal123!")
            self.stdout.write("  local_student@lockin.local / StudentLocal123!")

    def _seed_manual_qa(self):
        """Create the two repeatable accounts used for local browser testing only."""
        from apps.accounts.models import User
        from apps.accounts.roles import Role, replace_managed_roles
        from apps.education.models import StudentCohort
        from apps.entitlements.services import sync_subscription_entitlements
        from apps.product_catalog.models import Plan
        from apps.subscriptions.models import Subscription, SubscriptionAccount

        now = timezone.now()
        cohort = (
            StudentCohort.objects.filter(is_active=True)
            .exclude(code="year-3")
            .order_by("position", "id")
            .first()
        )
        if cohort is None:
            raise CommandError("Manual QA fixtures require an active student cohort.")
        plan = Plan.objects.select_related("current_version").get(code="lockin-plus-monthly")
        if plan.current_version is None:
            raise CommandError("Manual QA fixtures require the local demo plan version.")

        founder, _ = User.objects.update_or_create(
            email="local_founder@lockin.local",
            defaults={
                "username": "local_founder",
                "full_name": "Local QA Founder",
                "cohort": cohort,
                "preferred_language": User.Language.ENGLISH,
                "profile_completion_required": False,
                "welcome_completed_at": now,
                "email_verified_at": now,
                "policy_accepted_at": now,
                "policy_version": "local-manual-qa-v1",
                "status": User.Status.ACTIVE,
                "is_staff": True,
                "is_superuser": True,
            },
        )
        founder.set_password("FounderLocal123!")
        founder.save(update_fields=["password", "updated_at"])
        replace_managed_roles(
            target=founder, actor=founder, roles={Role.ADMINISTRATOR, Role.CREATOR}
        )

        student, _ = User.objects.update_or_create(
            email="local_student@lockin.local",
            defaults={
                "username": "local_student",
                "full_name": "Local QA Student",
                "cohort": cohort,
                "preferred_language": User.Language.ENGLISH,
                "profile_completion_required": False,
                "welcome_completed_at": now,
                "email_verified_at": now,
                "policy_accepted_at": now,
                "policy_version": "local-manual-qa-v1",
                "status": User.Status.ACTIVE,
                "is_staff": False,
                "is_superuser": False,
            },
        )
        student.set_password("StudentLocal123!")
        student.save(update_fields=["password", "updated_at"])
        replace_managed_roles(target=student, actor=founder, roles=set())

        account, _ = SubscriptionAccount.objects.update_or_create(
            primary_user=student,
            kind=SubscriptionAccount.Kind.INDIVIDUAL,
            defaults={
                "display_name": student.full_name,
                "status": SubscriptionAccount.Status.ACTIVE,
            },
        )
        subscription, _ = Subscription.objects.update_or_create(
            account=account,
            status__in=[
                Subscription.Status.TRIALING,
                Subscription.Status.ACTIVE,
                Subscription.Status.GRACE,
            ],
            defaults={
                "plan_version": plan.current_version,
                "status": Subscription.Status.ACTIVE,
                "payment_verification": Subscription.PaymentVerification.VERIFIED,
                "started_at": now - timedelta(days=1),
                "current_period_started_at": now - timedelta(days=1),
                "current_period_ends_at": now + timedelta(days=30),
                "status_reason": "local_manual_qa",
            },
        )
        sync_subscription_entitlements(subscription_id=subscription.id)
        return {
            "founder": founder,
            "student": student,
            "cohort": cohort,
            "subscription": subscription,
        }

    def _seed_subscription_e2e(self):
        """Prepare the exact state consumed by ``subscription-live.spec.js``.

        This is intentionally an explicit testing-only extension of the normal
        demo seed. It creates ordinary users and persisted subscription state;
        browser tests still authenticate and call the production payment and
        review endpoints.
        """
        from apps.accounts.models import User
        from apps.education.models import StudentCohort
        from apps.entitlements.services import sync_subscription_entitlements
        from apps.payments.manual_services import submit_manual_recharge
        from apps.payments.models import ManualRechargeSubmission
        from apps.product_catalog.models import Plan, Price
        from apps.subscriptions.models import Subscription, SubscriptionAccount

        now = timezone.now()
        paid_price = Price.objects.select_related("plan_version").get(code="lockin_monthly_10_lyd")
        trial_plan = Plan.objects.select_related("current_version").get(
            code=settings.DEFAULT_TRIAL_PLAN_CODE
        )
        if trial_plan.current_version is None:
            raise CommandError("The configured trial plan has no current version.")
        qa_cohort = StudentCohort.objects.order_by("position", "id").first()
        if qa_cohort is None:
            raise CommandError("Subscription E2E fixtures require a seeded student cohort.")

        users = {}
        for email, password, name, username, needs_profile in SUBSCRIPTION_E2E_ACCOUNTS:
            user, _ = User.objects.update_or_create(
                email=email,
                defaults={
                    "full_name": name,
                    "username": username,
                    "cohort": qa_cohort,
                    "preferred_language": (
                        User.Language.ARABIC
                        if email == "qa.expired@lockin.local"
                        else User.Language.ENGLISH
                    ),
                    "profile_completion_required": needs_profile,
                    "welcome_completed_at": (
                        None
                        if email in {"qa.google@lockin.local", "qa.trial@lockin.local"}
                        else now
                    ),
                    "email_verified_at": now,
                    "policy_accepted_at": now,
                    "policy_version": "e2e-fixture-v1",
                    "status": User.Status.ACTIVE,
                },
            )
            user.set_password(password)
            user.save(update_fields=["password", "updated_at"])
            users[email] = user
        users["admin@lockin.local"] = User.objects.get(email="admin@lockin.local")
        admin_user = users["admin@lockin.local"]
        admin_user.welcome_completed_at = now
        admin_user.save(update_fields=["welcome_completed_at", "updated_at"])

        def account_for(user):
            return SubscriptionAccount.objects.update_or_create(
                primary_user=user,
                kind=SubscriptionAccount.Kind.INDIVIDUAL,
                defaults={
                    "display_name": user.full_name,
                    "status": SubscriptionAccount.Status.ACTIVE,
                },
            )[0]

        def set_subscription(*, email, status, plan_version, starts_at, ends_at, trial=False):
            account = account_for(users[email])
            subscription, _ = Subscription.objects.update_or_create(
                account=account,
                defaults={
                    "plan_version": plan_version,
                    "status": status,
                    "payment_verification": Subscription.PaymentVerification.VERIFIED,
                    "provisional_payment_id": None,
                    "started_at": starts_at,
                    "trial_started_at": starts_at if trial else None,
                    "trial_ends_at": ends_at if trial else None,
                    "current_period_started_at": starts_at,
                    "current_period_ends_at": ends_at,
                    "grace_ends_at": None,
                    "cancel_at_period_end": False,
                    "cancellation_requested_at": None,
                    "cancelled_at": None,
                    "suspended_at": None,
                    "ended_at": ends_at if status == Subscription.Status.EXPIRED else None,
                    "status_reason": "subscription_e2e_fixture",
                },
            )
            sync_subscription_entitlements(subscription_id=subscription.id)
            return subscription

        set_subscription(
            email="qa.google@lockin.local",
            status=Subscription.Status.TRIALING,
            plan_version=trial_plan.current_version,
            starts_at=now,
            ends_at=now + timedelta(days=7),
            trial=True,
        )
        set_subscription(
            email="qa.trial@lockin.local",
            status=Subscription.Status.TRIALING,
            plan_version=trial_plan.current_version,
            starts_at=now,
            ends_at=now + timedelta(days=7),
            trial=True,
        )
        set_subscription(
            email="qa.expired@lockin.local",
            status=Subscription.Status.EXPIRED,
            plan_version=paid_price.plan_version,
            starts_at=now - timedelta(days=34),
            ends_at=now - timedelta(days=4),
        )
        set_subscription(
            email="qa.renewal@lockin.local",
            status=Subscription.Status.ACTIVE,
            plan_version=paid_price.plan_version,
            starts_at=now - timedelta(days=26),
            ends_at=now + timedelta(days=4),
        )
        set_subscription(
            email="qa.renewal-early@lockin.local",
            status=Subscription.Status.ACTIVE,
            plan_version=paid_price.plan_version,
            starts_at=now - timedelta(days=22),
            ends_at=now + timedelta(days=8),
        )
        set_subscription(
            email="admin@lockin.local",
            status=Subscription.Status.ACTIVE,
            plan_version=paid_price.plan_version,
            starts_at=now - timedelta(days=10),
            ends_at=now + timedelta(days=20),
        )
        review_submission = (
            ManualRechargeSubmission.objects.filter(
                user=users["qa.review@lockin.local"],
                status=ManualRechargeSubmission.Status.PENDING,
            )
            .select_related("payment")
            .first()
        )
        if review_submission is None:
            set_subscription(
                email="qa.review@lockin.local",
                status=Subscription.Status.EXPIRED,
                plan_version=paid_price.plan_version,
                starts_at=now - timedelta(days=34),
                ends_at=now - timedelta(days=4),
            )
            submit_manual_recharge(
                user=users["qa.review@lockin.local"],
                price=paid_price,
                recharge_codes=["5656565612345"],
                idempotency_key="subscription-e2e-review-payment",
            )
        return {"emails": tuple(email for email, *_ in SUBSCRIPTION_E2E_ACCOUNTS)}

    def _seed(self):
        from apps.accounts.models import User
        from apps.accounts.roles import Role, replace_managed_roles
        from apps.achievements.models import AchievementDefinition, EarnedAchievement
        from apps.analytics.models import AnalyticsFact, DailyActiveLearner, DailyMetric
        from apps.assessments.models import (
            Attempt,
            AttemptAnswer,
            AttemptQuestion,
            AttemptResult,
            Quiz,
            QuizVersion,
            QuizVersionQuestion,
        )
        from apps.community.models import (
            Comment,
            CommunitySpace,
            Discussion,
            LearningContextType,
            SpaceMembership,
        )
        from apps.content.models import LearningObject, LearningObjectAsset, LearningObjectVersion
        from apps.education.models import CreatorScope, EducationNode
        from apps.entitlements.models import EntitlementDefinition, PlanEntitlementRule
        from apps.entitlements.services import sync_subscription_entitlements
        from apps.files.models import ManagedFile
        from apps.focus.models import (
            FocusAnnotation,
            FocusAnnotationCollection,
            FocusSession,
            FocusSessionActivity,
            FocusWorkspaceSnapshot,
        )
        from apps.moderation.models import Report
        from apps.notifications.models import (
            Notification,
            NotificationCounter,
            NotificationPreference,
        )
        from apps.product_catalog.models import Plan, PlanVersion, Price, Product
        from apps.progress.models import Bookmark, LearningProgress, LessonProgress, QuestionReview
        from apps.questions.models import Question, QuestionOption, QuestionVersion
        from apps.streaks.models import StreakActivity, StreakPolicy
        from apps.subscriptions.models import Subscription, SubscriptionAccount
        from apps.xp.models import XpTransaction

        now = timezone.now()
        users = {}
        for email, password, name, staff, superuser in DEMO_ACCOUNTS:
            user, _ = User.objects.update_or_create(
                email=email,
                defaults={
                    "full_name": name,
                    "is_staff": staff or superuser,
                    "is_superuser": superuser,
                    "email_verified_at": now,
                    "policy_accepted_at": now,
                    "policy_version": "demo-v1",
                },
            )
            user.set_password(password)
            user.save(update_fields=["password", "updated_at"])
            users[email] = user
        admin, creator, primary = (
            users["admin@lockin.local"],
            users["creator@lockin.local"],
            users["student@lockin.local"],
        )
        replace_managed_roles(target=admin, actor=admin, roles={Role.ADMINISTRATOR})
        replace_managed_roles(target=creator, actor=admin, roles={Role.CREATOR})

        def node(parent, kind, slug, title, position):
            # Production hierarchy paths use stable node UUID segments with a
            # leading and trailing slash. Looking up demo rows by their
            # parent/slug also repairs legacy demo rows that used title slugs
            # for ``path`` while preserving all objects that reference them.
            obj = EducationNode.objects.filter(parent=parent, slug=slug).first()
            if obj is None:
                obj = EducationNode(parent=parent, kind=kind, slug=slug)
            obj.kind = kind
            obj.title = title
            obj.position = position
            obj.status = EducationNode.Status.PUBLISHED
            obj.is_discoverable = True
            obj.depth = 0 if parent is None else parent.depth + 1
            obj.path = f"/{obj.id}/" if parent is None else f"{parent.path}{obj.id}/"
            obj.full_clean()
            obj.save()
            return obj

        institution = node(
            None, "institution", "lockin-demo-university", "Lock-in Demo University", 1
        )
        college = node(institution, "college", "health-sciences", "College of Health Sciences", 1)
        department = node(college, "department", "dentistry", "Dentistry", 1)
        year = node(department, "academic_year", "year-2", "Second Year", 1)
        semester = node(year, "semester", "fall-2026", "Fall 2026", 1)
        CreatorScope.objects.update_or_create(
            user=creator,
            node=department,
            defaults={
                "can_create_content": True,
                "can_review_content": True,
                "can_publish_content": True,
                "can_create_assessments": True,
                "can_review_assessments": True,
                "can_publish_assessments": True,
                "can_manage_hierarchy": False,
                "granted_by": admin,
            },
        )
        lessons = []
        for si, subject_title in enumerate(
            ("Oral Anatomy", "Dental Materials", "Oral Pathology"), 1
        ):
            subject = node(
                semester, "subject", subject_title.lower().replace(" ", "-"), subject_title, si
            )
            for ui in range(1, 3):
                unit = node(subject, "unit", f"chapter-{ui}", f"Chapter {ui}: Core Concepts", ui)
                for li in range(1, 3):
                    lessons.append(
                        node(
                            unit,
                            "lesson",
                            f"lesson-{li}",
                            f"Lesson {li}: Applied {subject_title}",
                            li,
                        )
                    )

        def demo_file(index: int) -> ManagedFile:
            payload = demo_pdf_payload(index + 1)
            digest = hashlib.sha256(payload).hexdigest()
            managed, _ = ManagedFile.objects.get_or_create(
                owner=creator,
                original_name=f"lockin-demo-{index + 1}.pdf",
                defaults={
                    "kind": "pdf",
                    "content_type": "application/pdf",
                    "size_bytes": len(payload),
                    "checksum_sha256": digest,
                    "validation_status": "ready",
                    "scan_status": "not_configured",
                    "blob": ContentFile(payload, name=f"lockin-demo-{index + 1}.pdf"),
                },
            )
            if not managed.blob.name or not managed.blob.storage.exists(managed.blob.name):
                managed.blob.save(f"lockin-demo-{index + 1}.pdf", ContentFile(payload), save=False)
                managed.kind = "pdf"
                managed.content_type = "application/pdf"
                managed.size_bytes = len(payload)
                managed.checksum_sha256 = digest
                managed.validation_status = "ready"
                managed.scan_status = "not_configured"
                managed.save(
                    update_fields=(
                        "blob",
                        "kind",
                        "content_type",
                        "size_bytes",
                        "checksum_sha256",
                        "validation_status",
                        "scan_status",
                    )
                )
            return managed

        documents = []
        for index, lesson in enumerate(lessons):
            managed = demo_file(index)
            title = f"{lesson.title} — Study Guide"
            version = (
                LearningObjectVersion.objects.filter(title=title, created_by=creator)
                .select_related("learning_object")
                .first()
            )
            if not version:
                obj = LearningObject.objects.create(
                    owner=creator, workflow_status="published", published_at=now
                )
                version = LearningObjectVersion.objects.create(
                    learning_object=obj,
                    version_number=1,
                    academic_node=lesson,
                    content_type="pdf",
                    title=title,
                    summary=f"A concise, exam-focused guide for {lesson.title}.",
                    language="en",
                    allow_download=True,
                    metadata={
                        "tags": ["dentistry", "study-guide", lesson.parent.parent.title.lower()]
                    },
                    created_by=creator,
                )
                LearningObjectAsset.objects.create(
                    version=version, managed_file=managed, role="primary", position=0
                )
                obj.current_version = version
                obj.published_version = version
                obj.save(update_fields=["current_version", "published_version"])
            documents.append(version)

        question_versions = []
        for index, lesson in enumerate(lessons):
            prompt = f"Which statement best describes the main learning outcome of {lesson.title}?"
            version = (
                QuestionVersion.objects.filter(prompt=prompt, created_by=creator)
                .select_related("question")
                .first()
            )
            if not version:
                question = Question.objects.create(
                    owner=creator, workflow_status="published", published_at=now
                )
                version = QuestionVersion.objects.create(
                    question=question,
                    version_number=1,
                    academic_node=lesson,
                    question_type="single_choice",
                    prompt=prompt,
                    explanation="The study guide highlights this core concept.",
                    difficulty=("easy", "medium", "hard")[index % 3],
                    language="en",
                    metadata={"tags": ["review", "demo"]},
                    created_by=creator,
                )
                for pos, text in enumerate(
                    (
                        "It is a foundational concept applied in clinical reasoning.",
                        "It is unrelated to the chapter.",
                        "It only applies after graduation.",
                        "It replaces evidence-based practice.",
                    )
                ):
                    QuestionOption.objects.create(
                        version=version, text=text, position=pos, is_correct=pos == 0
                    )
                question.current_version = version
                question.published_version = version
                question.save(update_fields=["current_version", "published_version"])
            question_versions.append(version)
        quiz_versions = []
        for qi, (title, mode) in enumerate(
            (
                ("Oral Anatomy Practice", "practice"),
                ("Dental Materials Mastery", "mastery"),
                ("Semester Readiness Exam", "quiz"),
            )
        ):
            version = (
                QuizVersion.objects.filter(title=title, created_by=creator)
                .select_related("quiz")
                .first()
            )
            if not version:
                quiz = Quiz.objects.create(
                    owner=creator, workflow_status="published", published_at=now
                )
                version = QuizVersion.objects.create(
                    quiz=quiz,
                    version_number=1,
                    academic_node=lessons[qi * 2],
                    title=title,
                    instructions="Use this assessment to identify what to review next.",
                    mode=mode,
                    selection_mode="fixed",
                    question_count=4,
                    duration_seconds=900,
                    maximum_attempts=0,
                    randomize_questions=True,
                    randomize_options=True,
                    pass_percent=Decimal("70.00"),
                    ranking_eligible=True,
                    achievement_eligible=True,
                    created_by=creator,
                )
                unique_questions = list({item.id: item for item in question_versions}.values())
                for pos, question_version in enumerate(unique_questions[qi * 4 : qi * 4 + 4]):
                    QuizVersionQuestion.objects.create(
                        quiz_version=version, question_version=question_version, position=pos
                    )
                quiz.current_version = version
                quiz.published_version = version
                quiz.save(update_fields=["current_version", "published_version"])
            quiz_versions.append(version)

        students = [primary] + [users[f"student{i}@lockin.local"] for i in range(1, 6)]
        policy = StreakPolicy.objects.filter(is_active=True).first()
        for student_index, student in enumerate(students):
            completed = min(len(lessons), 2 + student_index * 2)
            for lesson, document in zip(lessons[:completed], documents[:completed], strict=True):
                LessonProgress.objects.update_or_create(
                    user=student,
                    lesson=lesson,
                    defaults={"completed_at": now - timedelta(days=completed), "revision": 1},
                )
                LearningProgress.objects.update_or_create(
                    user=student,
                    learning_object=document.learning_object,
                    defaults={
                        "version": document,
                        "status": "completed",
                        "completion_percent": 100,
                        "position": {"page": 4},
                        "completed_at": now - timedelta(days=completed),
                    },
                )
            if completed < len(documents):
                doc = documents[completed]
                LearningProgress.objects.update_or_create(
                    user=student,
                    learning_object=doc.learning_object,
                    defaults={
                        "version": doc,
                        "status": "in_progress",
                        "completion_percent": 45 + student_index * 5,
                        "position": {"page": 3},
                        "completed_at": None,
                    },
                )
                Bookmark.objects.get_or_create(user=student, learning_object=doc.learning_object)
            for qv in question_versions[:4]:
                QuestionReview.objects.update_or_create(
                    user=student,
                    question=qv.question,
                    defaults={
                        "last_question_version": qv,
                        "due_at": now + timedelta(days=(student_index % 3) - 1),
                        "interval_days": 3,
                        "ease_factor": Decimal("2.50"),
                        "repetitions": student_index + 1,
                        "lapses": 0,
                        "last_was_correct": True,
                        "last_reviewed_at": now - timedelta(days=1),
                    },
                )
            for offset in range(7 + student_index):
                occurred = now - timedelta(days=offset)
                XpTransaction.objects.get_or_create(
                    user=student,
                    source_key=f"demo-{student_index}-xp-{offset}",
                    rule_code="demo_learning",
                    defaults={
                        "source_event_name": "education.lesson.completed",
                        "rule_version": 1,
                        "points": 30 + student_index * 10,
                        "category": "learning",
                        "reason": "Completed a demo lesson",
                        "ranking_eligible": True,
                        "occurred_at": occurred,
                    },
                )
                if policy:
                    StreakActivity.objects.get_or_create(
                        user=student,
                        source_key=f"demo-{student_index}-streak-{offset}",
                        defaults={
                            "policy": policy,
                            "activity_type": "lesson_completed",
                            "qualified_on": occurred.date(),
                            "occurred_at": occurred,
                            "metadata": {"source": "demo"},
                        },
                    )
            quiz_version = quiz_versions[student_index % len(quiz_versions)]
            attempt, created = Attempt.objects.get_or_create(
                user=student,
                start_idempotency_key=stable_uuid(f"attempt-{student_index}"),
                defaults={
                    "quiz": quiz_version.quiz,
                    "quiz_version": quiz_version,
                    "status": "submitted",
                    "requested_question_count": quiz_version.question_count,
                    "started_at": now - timedelta(days=student_index + 1, minutes=18),
                    "completed_at": now - timedelta(days=student_index + 1),
                },
            )
            if created:
                score = Decimal("3.00") if student_index % 3 else Decimal("4.00")
                for position, link in enumerate(quiz_version.question_links.all()):
                    options = list(link.question_version.options.all())
                    correct = options[0]
                    snapshot = [{"id": str(option.id), "text": option.text} for option in options]
                    item = AttemptQuestion.objects.create(
                        attempt=attempt,
                        question_version=link.question_version,
                        position=position,
                        prompt=link.question_version.prompt,
                        question_type=link.question_version.question_type,
                        difficulty=link.question_version.difficulty,
                        language="en",
                        explanation=link.question_version.explanation,
                        option_snapshot=snapshot,
                        correct_option_ids=[str(correct.id)],
                        max_points=Decimal("1.00"),
                    )
                    selected = correct if position < int(score) else options[1]
                    AttemptAnswer.objects.create(
                        attempt_question=item,
                        selected_option_ids=[str(selected.id)],
                        client_revision=1,
                        server_revision=1,
                    )
                AttemptResult.objects.create(
                    attempt=attempt,
                    score_points=score,
                    maximum_points=Decimal("4.00"),
                    percentage=score * Decimal("25"),
                    passed=score >= Decimal("3.00"),
                    answered_count=4,
                    unanswered_count=0,
                    ranking_eligible=True,
                    achievement_eligible=True,
                    submitted_at=attempt.completed_at,
                )

        for day_offset in range(14):
            occurred = now - timedelta(days=day_offset)
            event_id = stable_uuid(f"analytics-{day_offset}")
            AnalyticsFact.objects.update_or_create(
                event_id=event_id,
                metric="learning_activity",
                defaults={
                    "actor_id": primary.id,
                    "source_event": "education.lesson.completed",
                    "source_object_id": str(lessons[day_offset % len(lessons)].id),
                    "value": 1,
                    "dimensions": {"source": "demo"},
                    "occurred_at": occurred,
                },
            )
            DailyActiveLearner.objects.update_or_create(
                day=occurred.date(), user_id=primary.id, defaults={"first_event_id": event_id}
            )
            DailyMetric.objects.update_or_create(
                day=occurred.date(),
                metric="learning_activity",
                dimensions_key="demo",
                defaults={"dimensions": {"source": "demo"}, "value": 5 + day_offset},
            )

        doc = documents[0]
        session, _ = FocusSession.objects.update_or_create(
            user=primary,
            client_instance_id=stable_uuid("focus-primary"),
            defaults={
                "context_type": "study",
                "context_id": doc.learning_object_id,
                "status": "completed",
                "started_at": now - timedelta(hours=2),
                "last_activity_at": now - timedelta(hours=1),
                "ended_at": now - timedelta(hours=1),
                "planned_duration_seconds": 3600,
                "active_duration_seconds": 2875,
            },
        )
        FocusSessionActivity.objects.update_or_create(
            session=session,
            sequence=1,
            defaults={
                "activity_type": "started",
                "occurred_at": session.started_at,
                "metadata": {},
            },
        )
        FocusSessionActivity.objects.update_or_create(
            session=session,
            sequence=2,
            defaults={
                "activity_type": "completed",
                "occurred_at": session.ended_at,
                "metadata": {"duration": 2875},
            },
        )
        file_id = doc.assets.first().managed_file_id
        FocusWorkspaceSnapshot.objects.update_or_create(
            session=session,
            defaults={
                "user": primary,
                "document_id": doc.learning_object_id,
                "document_version_id": doc.id,
                "file_id": file_id,
                "current_page": 4,
                "page_count": 24,
                "zoom": Decimal("1.25"),
                "sidebar": "notes",
                "active_tool": "highlighter",
                "layout": {"theme": "dark"},
                "open_tabs": [str(doc.id)],
            },
        )
        collection, _ = FocusAnnotationCollection.objects.get_or_create(
            user=primary,
            document_id=doc.learning_object_id,
            merged_into__isnull=True,
            defaults={"document_version_id": doc.id},
        )
        FocusAnnotation.objects.get_or_create(
            collection=collection,
            page_number=4,
            tool="sticky_note",
            layer_key="personal",
            defaults={
                "bounds": {"x": 0.2, "y": 0.3, "width": 0.2, "height": 0.1},
                "payload": {"text": "Review this before the mastery check."},
                "color": "#F5C451",
                "thickness": Decimal("2.00"),
                "opacity": Decimal("0.900"),
            },
        )

        space, _ = CommunitySpace.objects.update_or_create(
            owner=creator,
            context_type=LearningContextType.LESSON,
            context_id=lessons[0].id,
            defaults={
                "context_title": lessons[0].title,
                "context_route": f"/learn/{lessons[0].id}",
                "title": "Oral Anatomy study room",
                "description": "Ask evidence-based questions about this lesson.",
                "status": "active",
            },
        )
        for student in students:
            SpaceMembership.objects.update_or_create(
                space=space,
                user=student,
                defaults={"role": "member", "status": "active", "invited_by": creator},
            )
        discussion, _ = Discussion.objects.get_or_create(
            author=primary,
            client_request_id=stable_uuid("demo-discussion"),
            defaults={
                "space": space,
                "context_type": "lesson",
                "context_id": lessons[0].id,
                "context_title": lessons[0].title,
                "context_route": f"/learn/{lessons[0].id}",
                "title": "How are you remembering the key landmarks?",
                "body": (
                    "I am using the chapter guide, then a short practice set. "
                    "What is working for you?"
                ),
                "body_digest": hashlib.sha256(b"demo-discussion").hexdigest(),
                "status": "active",
                "last_activity_at": now,
            },
        )
        comment, _ = Comment.objects.get_or_create(
            author=users["student1@lockin.local"],
            client_request_id=stable_uuid("demo-comment"),
            defaults={
                "discussion": discussion,
                "body": "I annotate the diagram first, then revisit the questions due today.",
                "body_digest": hashlib.sha256(b"demo-comment").hexdigest(),
                "status": "active",
            },
        )
        Report.objects.get_or_create(
            reporter=users["student2@lockin.local"],
            client_request_id=stable_uuid("demo-report"),
            defaults={
                "target_type": "comment",
                "target_id": comment.id,
                "target_author_id": comment.author_id,
                "target_label": "Demo comment",
                "reason": "duplicate",
                "description": "Example moderation item for testing the queue.",
                "evidence_snapshot": {"source": "demo"},
                "status": "open",
                "priority": "routine",
            },
        )

        product, _ = Product.objects.update_or_create(
            code="lockin-plus",
            defaults={
                "title": "Lock-in Plus",
                "description": "Premium study tools for focused learners.",
                "status": "active",
            },
        )
        plan, _ = Plan.objects.update_or_create(
            code="lockin-plus-monthly", defaults={"product": product, "status": "active"}
        )
        plan_version, _ = PlanVersion.objects.update_or_create(
            plan=plan,
            version=1,
            defaults={
                "title": "Lock-in Plus Monthly",
                "description": "A local demo subscription.",
                "trial_days": 14,
                "grace_days": 3,
                "published_at": now,
                "terms": {"demo": True},
            },
        )
        if plan.current_version_id != plan_version.id:
            plan.current_version = plan_version
            plan.save(update_fields=["current_version"])
        demo_entitlements = EntitlementDefinition.objects.filter(
            code__in=("focus.workspace", "content.premium", "files.download")
        )
        for entitlement in demo_entitlements:
            PlanEntitlementRule.objects.get_or_create(
                plan_version=plan_version,
                entitlement=entitlement,
                defaults={"configuration": {}},
            )
        Price.objects.update_or_create(
            code="lockin-plus-monthly-usd",
            defaults={
                "plan_version": plan_version,
                "amount_minor": 799,
                "currency": "USD",
                "interval": "month",
                "status": "active",
                "published_at": now,
            },
        )
        account, _ = SubscriptionAccount.objects.get_or_create(
            primary_user=primary,
            kind="individual",
            defaults={"display_name": "Maya Student", "status": "active"},
        )
        subscription, _ = Subscription.objects.update_or_create(
            account=account,
            status__in=["trialing", "active", "grace", "suspended"],
            defaults={
                "plan_version": plan_version,
                "status": "active",
                "started_at": now - timedelta(days=10),
                "current_period_started_at": now - timedelta(days=10),
                "current_period_ends_at": now + timedelta(days=20),
                "status_reason": "demo subscription",
            },
        )
        # Use the normal subscription synchronizer so the official local demo
        # plan grants every study entitlement its API routes require.
        sync_subscription_entitlements(subscription_id=subscription.id)

        for index, title in enumerate(
            (
                "Your review queue is ready",
                "Focus session saved",
                "You are close to the next achievement",
                "New discussion reply",
            )
        ):
            Notification.objects.update_or_create(
                recipient=primary,
                deduplication_key=f"demo-notification-{index}",
                defaults={
                    "actor": creator,
                    "category": ("learning", "learning", "achievement", "community")[index],
                    "template_key": "demo",
                    "title": title,
                    "body": "Development-only notification data for testing the dashboard.",
                    "data": {"demo": True},
                    "target_route": "/dashboard",
                    "is_required": False,
                },
            )
        NotificationCounter.objects.update_or_create(
            user=primary, defaults={"unread_count": 4, "revision": 1}
        )
        NotificationPreference.objects.get_or_create(
            user=primary, category="learning", channel="in_app", defaults={"enabled": True}
        )
        for definition in AchievementDefinition.objects.filter(is_active=True)[:3]:
            EarnedAchievement.objects.get_or_create(
                user=primary,
                definition=definition,
                defaults={
                    "version": definition.current_version,
                    "evidence_snapshot": {"source": "demo"},
                    "earned_at": now - timedelta(days=2),
                },
            )
        call_command("rebuild_motivation", verbosity=0)
        return {
            "content": len(documents),
            "questions": len(question_versions),
            "students": len(students),
        }
