#!/usr/bin/env python
"""Load a realistically populated Lock-in dataset for capacity benchmarking.

This is benchmark tooling. It lives outside the application, imports no private
internals, and changes nothing: it drives the same models, the same service
functions and the same storage backend that a real deployment uses. In
particular it entitles accounts by calling ``create_trial_for_user``, so the
subscription -> entitlement grant path runs exactly as it does in production
rather than being faked with hand-written rows.

``platform_core.management.commands.seed_demo`` cannot be used here: it refuses
to run under production settings by design, and its dataset is a handful of
rows meant for a laptop. This loader is the production-settings equivalent at
benchmark scale.

Safety
------
* Refuses to run unless ``LOCKIN_BENCH_ALLOW=yes``.
* Refuses to run if the database already contains accounts that are not
  benchmark accounts, unless ``--allow-existing-users`` is passed explicitly.
* Every account it creates ends in ``@bench.invalid``, a reserved TLD that can
  never receive mail, and every password is derived from ``--password-seed``.
  No production credential is read or written.

Run it through the Compose overlay, which supplies the production settings and
the owner database role::

    docker compose --env-file .env.production -f compose.production.yaml -f bench/compose.bench.yaml \
      --profile bench run --rm seed-bench --users 2000
"""

from __future__ import annotations

import argparse
import hashlib
import os
import random
import sys
import time
import uuid
from datetime import timedelta
from decimal import Decimal

sys.path.insert(0, "/app")
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.production")

import django  # noqa: E402

django.setup()

from django.contrib.auth.hashers import make_password  # noqa: E402
from django.core.files.base import ContentFile  # noqa: E402
from django.db import transaction  # noqa: E402
from django.utils import timezone  # noqa: E402

BENCH_DOMAIN = "@bench.invalid"
BENCH_POLICY_VERSION = "bench-dataset-v1"


# ---------------------------------------------------------------- identities


def bench_email(index: int) -> str:
    return f"bench-{index:06d}{BENCH_DOMAIN}"


def bench_password(seed: str) -> str:
    """A fixed, non-guessable password shared by every benchmark account.

    Deliberately shares no substring with the e-mail addresses, so Django's
    UserAttributeSimilarityValidator would pass if it were ever applied.
    """
    digest = hashlib.sha256(f"lockin-bench-password::{seed}".encode()).hexdigest()
    return f"Lk{digest[:16]}Qz!7"


def stable_uuid(value: str) -> uuid.UUID:
    return uuid.uuid5(uuid.NAMESPACE_URL, f"https://lockin.bench/{value}")


# ------------------------------------------------------------------- payload


def pdf_payload(*, number: int, target_bytes: int) -> bytes:
    """Build one structurally valid single-page PDF of approximately N bytes.

    The padding is a comment inside the page content stream, which the PDF
    specification allows, so the file stays a real PDF that a viewer will open
    rather than a blob with a PDF header. Size matters here: the file-delivery
    test measures bytes moved through Gunicorn, and a 900-byte stand-in would
    measure nothing.
    """
    body = f"BT\n/F1 20 Tf\n72 720 Td\n(Lock-in benchmark study guide {number}) Tj\nET\n"
    overhead = 520 + len(body)
    padding = max(0, target_bytes - overhead)
    stream = body.encode("ascii") + b"% " + (b"L" * padding) + b"\n"
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


# --------------------------------------------------------------------- guard


def enforce_guards(args: argparse.Namespace) -> None:
    from apps.accounts.models import User

    if os.environ.get("LOCKIN_BENCH_ALLOW", "").strip().lower() != "yes":
        raise SystemExit(
            "Refusing to run: set LOCKIN_BENCH_ALLOW=yes to confirm this is a "
            "throwaway benchmark database and not production."
        )
    foreign = User.objects.exclude(email__endswith=BENCH_DOMAIN).count()
    if foreign and not args.allow_existing_users:
        raise SystemExit(
            f"Refusing to run: this database already holds {foreign} non-benchmark "
            "account(s). Point at a throwaway database, or pass "
            "--allow-existing-users if you are certain."
        )


# ------------------------------------------------------------------- loading


class Loader:
    def __init__(self, args: argparse.Namespace) -> None:
        self.args = args
        self.now = timezone.now()
        self.created: dict[str, int] = {}
        self.warnings: list[str] = []
        self.started = time.perf_counter()

    def note(self, key: str, count: int) -> None:
        self.created[key] = self.created.get(key, 0) + count

    def warn(self, message: str) -> None:
        self.warnings.append(message)
        print(f"  WARNING: {message}", flush=True)

    def step(self, message: str) -> None:
        elapsed = time.perf_counter() - self.started
        print(f"[{elapsed:7.1f}s] {message}", flush=True)

    # -- staff -------------------------------------------------------------

    def build_staff(self):
        from apps.accounts.models import User
        from apps.accounts.roles import Role, replace_managed_roles

        password_hash = make_password(bench_password(self.args.password_seed))
        admin, _ = User.objects.update_or_create(
            email=f"bench-admin{BENCH_DOMAIN}",
            defaults={
                "full_name": "Benchmark Administrator",
                "is_staff": True,
                "is_superuser": True,
                "email_verified_at": self.now,
                "policy_accepted_at": self.now,
                "policy_version": BENCH_POLICY_VERSION,
                "password": password_hash,
            },
        )
        creator, _ = User.objects.update_or_create(
            email=f"bench-creator{BENCH_DOMAIN}",
            defaults={
                "full_name": "Benchmark Content Creator",
                "is_staff": False,
                "is_superuser": False,
                "email_verified_at": self.now,
                "policy_accepted_at": self.now,
                "policy_version": BENCH_POLICY_VERSION,
                "password": password_hash,
            },
        )
        replace_managed_roles(target=admin, actor=admin, roles={Role.ADMINISTRATOR})
        replace_managed_roles(target=creator, actor=admin, roles={Role.CREATOR})
        self.note("staff_accounts", 2)
        return admin, creator

    # -- hierarchy ---------------------------------------------------------

    def build_hierarchy(self, admin, creator):
        from apps.education.models import CreatorScope, EducationNode

        def node(parent, kind, slug, title, position):
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

        institution = node(None, "institution", "bench-university", "Benchmark University", 1)
        college = node(institution, "college", "health-sciences", "College of Health Sciences", 1)
        department = node(college, "department", "dentistry", "Dentistry", 1)
        year = node(department, "academic_year", "year-3", "Year 3", 1)
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

        subject_names = [
            "Oral Anatomy",
            "Dental Materials",
            "Oral Pathology",
            "Periodontology",
            "Endodontics",
            "Prosthodontics",
            "Orthodontics",
            "Oral Surgery",
            "Dental Radiology",
            "Pharmacology",
            "Preventive Dentistry",
            "Paediatric Dentistry",
            "Oral Microbiology",
            "Dental Anaesthesia",
            "Implantology",
            "Community Dentistry",
        ]
        lessons = []
        subjects = []
        for si in range(self.args.subjects):
            name = subject_names[si % len(subject_names)]
            title = name if si < len(subject_names) else f"{name} {si // len(subject_names) + 1}"
            subject = node(semester, "subject", f"subject-{si + 1}", title, si + 1)
            subjects.append(subject)
            for ui in range(self.args.units_per_subject):
                unit = node(
                    subject, "unit", f"chapter-{ui + 1}", f"Chapter {ui + 1}: {title}", ui + 1
                )
                for li in range(self.args.lessons_per_unit):
                    lessons.append(
                        node(
                            unit,
                            "lesson",
                            f"lesson-{li + 1}",
                            f"Lesson {li + 1}: Applied {title}",
                            li + 1,
                        )
                    )
        self.note(
            "education_nodes",
            5 + len(subjects) * (1 + self.args.units_per_subject) + len(lessons),
        )
        self.note("lessons", len(lessons))
        return semester, lessons

    # -- content -----------------------------------------------------------

    def build_content(self, creator, lessons):
        from apps.content.models import LearningObject, LearningObjectAsset, LearningObjectVersion
        from apps.discovery.indexing import upsert_search_entry
        from apps.files.models import ManagedFile

        target_bytes = self.args.pdf_kb * 1024
        documents = []
        for index, lesson in enumerate(lessons):
            if index % 25 == 0:
                self.step(f"  content {index}/{len(lessons)}")
            with transaction.atomic():
                title = f"{lesson.title} - Study Guide {index + 1}"
                existing = (
                    LearningObjectVersion.objects.filter(title=title, created_by=creator)
                    .select_related("learning_object")
                    .first()
                )
                if existing is not None:
                    documents.append(existing)
                    continue

                payload = pdf_payload(number=index + 1, target_bytes=target_bytes)
                name = f"bench-guide-{index + 1:05d}.pdf"
                managed = ManagedFile.objects.create(
                    owner=creator,
                    original_name=name,
                    kind="pdf",
                    content_type="application/pdf",
                    size_bytes=len(payload),
                    checksum_sha256=hashlib.sha256(payload).hexdigest(),
                    validation_status="ready",
                    # The launch shape runs with CONTENT_REQUIRE_CLEAN_SCAN=false
                    # and the scanner stopped, which is the state this value
                    # represents. Delivery rejects quarantined and failed only.
                    scan_status="not_configured",
                    blob=ContentFile(payload, name=name),
                )
                obj = LearningObject.objects.create(
                    owner=creator, workflow_status="published", published_at=self.now
                )
                version = LearningObjectVersion.objects.create(
                    learning_object=obj,
                    version_number=1,
                    academic_node=lesson,
                    content_type="pdf",
                    title=title,
                    summary=(
                        f"An exam-focused revision guide covering {lesson.title}. "
                        "Includes diagrams, clinical correlations and recall prompts."
                    ),
                    language="en",
                    allow_download=True,
                    metadata={"tags": ["dentistry", "study-guide", "benchmark"]},
                    created_by=creator,
                )
                LearningObjectAsset.objects.create(
                    version=version, managed_file=managed, role="primary", position=0
                )
                obj.current_version = version
                obj.published_version = version
                obj.save(update_fields=["current_version", "published_version"])

                upsert_search_entry(
                    resource_kind="learning_object",
                    resource_id=obj.id,
                    title=title,
                    summary=version.summary,
                    academic_path=lesson.path,
                    language="en",
                    content_type="pdf",
                    published_at=self.now,
                )
                documents.append(version)
        self.note("managed_files", len(documents))
        self.note("learning_objects", len(documents))
        return documents

    # -- questions and quizzes --------------------------------------------

    def build_questions(self, creator, lessons):
        from apps.discovery.indexing import upsert_search_entry
        from apps.questions.models import Question, QuestionOption, QuestionVersion

        stems = [
            "Which structure is most directly responsible for",
            "During clinical assessment, which finding best indicates",
            "Which material property most influences the outcome of",
            "What is the primary mechanism underlying",
            "Which management step should be taken first for",
        ]
        versions = []
        total = len(lessons) * self.args.questions_per_lesson
        made = 0
        for lesson in lessons:
            batch = []
            with transaction.atomic():
                for qi in range(self.args.questions_per_lesson):
                    prompt = (
                        f"{stems[qi % len(stems)]} the core outcome of {lesson.title} "
                        f"(item {qi + 1})?"
                    )
                    if QuestionVersion.objects.filter(prompt=prompt, created_by=creator).exists():
                        continue
                    question = Question.objects.create(
                        owner=creator, workflow_status="published", published_at=self.now
                    )
                    version = QuestionVersion.objects.create(
                        question=question,
                        version_number=1,
                        academic_node=lesson,
                        question_type="single_choice",
                        prompt=prompt,
                        explanation="The published guide sets out the reasoning for this item.",
                        difficulty=("easy", "medium", "hard")[qi % 3],
                        language="en",
                        metadata={"tags": ["benchmark", "review"]},
                        created_by=creator,
                    )
                    for pos, text in enumerate(
                        (
                            "The evidence-based option applied in clinical reasoning.",
                            "A plausible but incorrect distractor.",
                            "An option that applies only in unrelated contexts.",
                            "An option contradicted by current guidance.",
                        )
                    ):
                        QuestionOption.objects.create(
                            version=version, text=text, position=pos, is_correct=pos == 0
                        )
                    question.current_version = version
                    question.published_version = version
                    question.save(update_fields=["current_version", "published_version"])
                    upsert_search_entry(
                        resource_kind="question",
                        resource_id=question.id,
                        title=prompt[:200],
                        summary=version.explanation,
                        academic_path=lesson.path,
                        language="en",
                        published_at=self.now,
                    )
                    batch.append(version)
            versions.extend(batch)
            made += len(batch)
            if made and made % 200 < self.args.questions_per_lesson:
                self.step(f"  questions {made}/{total}")
        self.note("questions", len(versions))
        return versions

    def build_quizzes(self, creator, lessons, question_versions):
        from apps.assessments.models import Quiz, QuizVersion, QuizVersionQuestion
        from apps.discovery.indexing import upsert_search_entry

        if not question_versions:
            self.warn("No question versions available; skipping quiz creation.")
            return []
        per_quiz = self.args.questions_per_quiz
        quizzes = []
        for qi in range(self.args.quizzes):
            title = f"Benchmark Assessment {qi + 1:03d}"
            existing = (
                QuizVersion.objects.filter(title=title, created_by=creator)
                .select_related("quiz")
                .first()
            )
            if existing is not None:
                quizzes.append(existing)
                continue
            lesson = lessons[qi % len(lessons)]
            with transaction.atomic():
                quiz = Quiz.objects.create(
                    owner=creator, workflow_status="published", published_at=self.now
                )
                version = QuizVersion.objects.create(
                    quiz=quiz,
                    version_number=1,
                    academic_node=lesson,
                    title=title,
                    instructions="Use this assessment to identify what to review next.",
                    mode=("practice", "mastery", "quiz")[qi % 3],
                    selection_mode="fixed",
                    question_count=per_quiz,
                    duration_seconds=900,
                    maximum_attempts=0,
                    randomize_questions=True,
                    randomize_options=True,
                    pass_percent=Decimal("70.00"),
                    ranking_eligible=True,
                    achievement_eligible=True,
                    created_by=creator,
                )
                start = (qi * per_quiz) % max(1, len(question_versions) - per_quiz)
                for pos, qv in enumerate(question_versions[start : start + per_quiz]):
                    QuizVersionQuestion.objects.create(
                        quiz_version=version, question_version=qv, position=pos
                    )
                quiz.current_version = version
                quiz.published_version = version
                quiz.save(update_fields=["current_version", "published_version"])
                upsert_search_entry(
                    resource_kind="quiz",
                    resource_id=quiz.id,
                    title=title,
                    summary=version.instructions,
                    academic_path=lesson.path,
                    language="en",
                    published_at=self.now,
                )
            quizzes.append(version)
        self.note("quizzes", len(quizzes))
        return quizzes

    # -- accounts ----------------------------------------------------------

    def build_accounts(self):
        from apps.accounts.models import User
        from apps.subscriptions.services import create_trial_for_user

        # One PBKDF2 derivation, reused as the stored hash for every benchmark
        # account. Deriving it 2,000 times would add minutes of pure CPU and
        # change nothing: verification cost at login is identical either way,
        # and that cost is measured separately by the login-storm test.
        password_hash = make_password(bench_password(self.args.password_seed))

        existing = set(
            User.objects.filter(email__endswith=BENCH_DOMAIN).values_list("email", flat=True)
        )
        pending = [
            User(
                email=bench_email(index),
                full_name=f"Benchmark Learner {index}",
                email_verified_at=self.now - timedelta(days=30),
                policy_accepted_at=self.now - timedelta(days=30),
                policy_version=BENCH_POLICY_VERSION,
                password=password_hash,
            )
            for index in range(1, self.args.users + 1)
            if bench_email(index) not in existing
        ]
        for offset in range(0, len(pending), self.args.batch_size):
            chunk = pending[offset : offset + self.args.batch_size]
            User.objects.bulk_create(chunk, batch_size=self.args.batch_size)
            self.step(f"  accounts {min(offset + len(chunk), len(pending))}/{len(pending)}")
        self.note("accounts", len(pending))

        users = list(
            User.objects.filter(email__endswith=BENCH_DOMAIN)
            .exclude(email__in=[f"bench-admin{BENCH_DOMAIN}", f"bench-creator{BENCH_DOMAIN}"])
            .order_by("email")[: self.args.users]
        )

        # Entitle through the real subscription path so the per-request
        # entitlement check that guards every study endpoint resolves the same
        # way it will in production.
        entitled = 0
        failures = 0
        for index, user in enumerate(users):
            try:
                _, created = create_trial_for_user(user=user, source_reference="benchmark-dataset")
                entitled += 1 if created else 0
            except Exception as error:  # noqa: BLE001 - reported, never swallowed
                failures += 1
                if failures <= 3:
                    self.warn(f"Trial creation failed for {user.email}: {error!r}")
            if index and index % 250 == 0:
                self.step(f"  trials {index}/{len(users)}")
        if failures:
            self.warn(
                f"{failures} of {len(users)} accounts have no trial and will be refused by the "
                "subscription gate. Investigate before trusting any result."
            )
        self.note("trials_created", entitled)
        return users

    # -- learner history ---------------------------------------------------

    def build_history(self, users, lessons, documents, question_versions):
        from apps.notifications.models import Notification, NotificationCounter
        from apps.progress.models import Bookmark, LearningProgress, LessonProgress
        from apps.review.models import ReviewItem
        from apps.xp.models import XpTransaction

        active = users[: self.args.active_learners]
        progress_rows: list = []
        lesson_rows: list = []
        bookmark_rows: list = []
        review_rows: list = []
        notification_rows: list = []
        counter_rows: list = []
        xp_rows: list = []

        for position, user in enumerate(active):
            rng = random.Random(f"{self.args.password_seed}:{user.email}")
            completed = rng.randint(3, max(4, min(len(documents), 40)))
            for document in rng.sample(documents, min(completed, len(documents))):
                progress_rows.append(
                    LearningProgress(
                        user=user,
                        learning_object=document.learning_object,
                        version=document,
                        status="completed",
                        completion_percent=100,
                        position={"page": rng.randint(1, 12)},
                        completed_at=self.now - timedelta(days=rng.randint(1, 60)),
                    )
                )
            for lesson in rng.sample(lessons, min(completed, len(lessons))):
                lesson_rows.append(
                    LessonProgress(
                        user=user,
                        lesson=lesson,
                        completed_at=self.now - timedelta(days=rng.randint(1, 60)),
                        revision=1,
                    )
                )
            for document in rng.sample(
                documents, min(self.args.bookmarks_per_learner, len(documents))
            ):
                bookmark_rows.append(Bookmark(user=user, learning_object=document.learning_object))

            for item in range(self.args.review_items_per_learner):
                if not question_versions:
                    break
                qv = question_versions[(position * 7 + item) % len(question_versions)]
                mistake_at = self.now - timedelta(days=rng.randint(1, 45))
                review_rows.append(
                    ReviewItem(
                        user=user,
                        canonical_key=f"bench:{qv.question_id}",
                        question=qv.question,
                        last_question_version=qv,
                        subject=qv.academic_node,
                        subject_key=str(qv.academic_node_id),
                        subject_label_snapshot=qv.academic_node.title[:220],
                        source_type=ReviewItem.SourceType.QUIZ,
                        source_id=str(qv.question_id),
                        source_label_snapshot="Benchmark Assessment",
                        prompt_snapshot=qv.prompt,
                        explanation_snapshot=qv.explanation,
                        options_snapshot=[],
                        correct_option_ids_snapshot=[],
                        state=ReviewItem.State.ACTIVE,
                        mastery_level=rng.randint(0, 3),
                        mistake_count=rng.randint(1, 4),
                        first_mistake_at=mistake_at,
                        last_mistake_at=mistake_at,
                        next_review_at=self.now + timedelta(days=rng.randint(-2, 7)),
                    )
                )

            for item in range(self.args.notifications_per_learner):
                notification_rows.append(
                    Notification(
                        recipient=user,
                        deduplication_key=f"bench-{user.id}-{item}",
                        category=("learning", "achievement", "community", "system")[item % 4],
                        template_key="benchmark",
                        title=(
                            "Your review queue is ready",
                            "Focus session saved",
                            "You are close to the next achievement",
                            "New discussion reply",
                        )[item % 4],
                        body="Benchmark dataset notification.",
                        data={"benchmark": True},
                        target_route="/dashboard",
                        is_required=False,
                    )
                )
            counter_rows.append(
                NotificationCounter(
                    user=user, unread_count=self.args.notifications_per_learner, revision=1
                )
            )

            for offset in range(self.args.xp_events_per_learner):
                occurred = self.now - timedelta(days=offset)
                xp_rows.append(
                    XpTransaction(
                        user=user,
                        source_key=f"bench-{position}-xp-{offset}",
                        rule_code="bench_learning",
                        source_event_name="education.lesson.completed",
                        rule_version=1,
                        points=rng.randint(10, 80),
                        category="learning",
                        reason="Completed a benchmark lesson",
                        ranking_eligible=True,
                        occurred_at=occurred,
                    )
                )

            if position and position % 200 == 0:
                self.step(f"  history {position}/{len(active)}")

        self._bulk("LearningProgress", LearningProgress, progress_rows)
        self._bulk("LessonProgress", LessonProgress, lesson_rows)
        self._bulk("Bookmark", Bookmark, bookmark_rows)
        self._bulk("ReviewItem", ReviewItem, review_rows)
        self._bulk("Notification", Notification, notification_rows)
        self._bulk("NotificationCounter", NotificationCounter, counter_rows)
        self._bulk("XpTransaction", XpTransaction, xp_rows)

    def _bulk(self, label: str, model, rows: list) -> None:
        if not rows:
            self.warn(f"{label}: nothing to insert.")
            return
        try:
            model.objects.bulk_create(rows, batch_size=self.args.batch_size, ignore_conflicts=True)
        except Exception as error:  # noqa: BLE001 - reported, never swallowed
            self.warn(f"{label}: bulk insert failed ({error!r}). Dataset is incomplete.")
            return
        self.note(label, len(rows))
        self.step(f"  inserted {len(rows)} {label} rows")

    # -- run ---------------------------------------------------------------

    def run(self) -> int:
        self.step("Creating staff accounts")
        admin, creator = self.build_staff()
        self.step("Creating education hierarchy")
        _, lessons = self.build_hierarchy(admin, creator)
        self.step(f"Creating {len(lessons)} learning objects with {self.args.pdf_kb} KiB PDFs")
        documents = self.build_content(creator, lessons)
        self.step("Creating questions")
        question_versions = self.build_questions(creator, lessons)
        self.step("Creating quizzes")
        self.build_quizzes(creator, lessons, question_versions)
        self.step(f"Creating {self.args.users} learner accounts and trials")
        users = self.build_accounts()
        self.step("Creating learner history")
        self.build_history(users, lessons, documents, question_versions)

        print("\n" + "=" * 68)
        print("Benchmark dataset summary")
        print("=" * 68)
        for key in sorted(self.created):
            print(f"  {key:<24} {self.created[key]:>10,}")
        print(f"  {'elapsed_seconds':<24} {time.perf_counter() - self.started:>10.1f}")
        if self.warnings:
            print("\nWARNINGS (the dataset is not what was asked for):")
            for warning in self.warnings:
                print(f"  - {warning}")
        print(
            "\nAccounts: "
            f"{bench_email(1)} .. {bench_email(self.args.users)}"
            f"\nPassword: {bench_password(self.args.password_seed)}"
            "\n\nRun ANALYZE before benchmarking:"
            "\n  docker compose --env-file .env.production -f compose.production.yaml -f bench/compose.bench.yaml \\"
            "\n    exec db psql -U lockin_owner -d lockin -c 'ANALYZE;'"
        )
        return 1 if self.warnings else 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Load benchmark data for Lock-in.")
    parser.add_argument("--users", type=int, default=2000)
    parser.add_argument(
        "--active-learners",
        type=int,
        default=500,
        help="How many accounts receive progress, review and notification history.",
    )
    parser.add_argument("--subjects", type=int, default=12)
    parser.add_argument("--units-per-subject", type=int, default=4)
    parser.add_argument("--lessons-per-unit", type=int, default=4)
    parser.add_argument("--questions-per-lesson", type=int, default=8)
    parser.add_argument("--questions-per-quiz", type=int, default=10)
    parser.add_argument("--quizzes", type=int, default=60)
    parser.add_argument(
        "--pdf-kb", type=int, default=1024, help="Approximate size of each generated PDF, in KiB."
    )
    parser.add_argument("--bookmarks-per-learner", type=int, default=6)
    parser.add_argument("--review-items-per-learner", type=int, default=12)
    parser.add_argument("--notifications-per-learner", type=int, default=6)
    parser.add_argument("--xp-events-per-learner", type=int, default=14)
    parser.add_argument("--batch-size", type=int, default=500)
    parser.add_argument("--password-seed", default="lockin-capacity-2026")
    parser.add_argument("--allow-existing-users", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    enforce_guards(args)
    return Loader(args).run()


if __name__ == "__main__":
    raise SystemExit(main())
