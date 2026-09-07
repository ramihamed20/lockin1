from io import StringIO

from django.core.management import CommandError, call_command
from django.test import TestCase, override_settings

from apps.accounts.models import User
from apps.content.models import LearningObjectVersion
from apps.entitlements.services import entitlement_decision
from apps.focus.models import FocusSession
from apps.notifications.models import Notification
from apps.payments.models import ManualRechargeSubmission
from apps.questions.models import QuestionVersion
from apps.subscriptions.models import Subscription


@override_settings(DEBUG=True, ENVIRONMENT="testing")
class SeedDemoCommandTests(TestCase):
    def test_seed_is_idempotent_and_populates_core_student_experience(self):
        first = StringIO()
        call_command("seed_demo", stdout=first, verbosity=0)
        first_counts = (
            User.objects.count(),
            LearningObjectVersion.objects.count(),
            QuestionVersion.objects.count(),
        )

        second = StringIO()
        call_command("seed_demo", stdout=second, verbosity=0)
        self.assertEqual(
            first_counts,
            (
                User.objects.count(),
                LearningObjectVersion.objects.count(),
                QuestionVersion.objects.count(),
            ),
        )
        self.assertIn("admin@lockin.local / Admin123!", second.getvalue())
        self.assertTrue(User.objects.get(email="admin@lockin.local").is_superuser)
        self.assertTrue(User.objects.get(email="developer@lockin.local").is_staff)
        self.assertFalse(User.objects.get(email="creator@lockin.local").is_staff)
        student = User.objects.get(email="student@lockin.local")
        for entitlement_code in ("focus.workspace", "content.premium", "files.download"):
            self.assertTrue(
                entitlement_decision(user=student, entitlement_code=entitlement_code).allowed
            )
        self.assertTrue(student.lesson_progress.exists())
        self.assertTrue(student.xp_transactions.exists())
        self.assertTrue(FocusSession.objects.filter(user=student).exists())
        self.assertTrue(Notification.objects.filter(recipient=student).exists())

    @override_settings(ENVIRONMENT="production", DEBUG=False)
    def test_seed_refuses_production(self):
        with self.assertRaises(CommandError):
            call_command("seed_demo", verbosity=0)

    def test_subscription_e2e_seed_is_idempotent_and_prepares_browser_accounts(self):
        call_command("seed_demo", "--subscription-e2e", verbosity=0)
        expected_emails = (
            "qa.google@lockin.local",
            "qa.trial@lockin.local",
            "qa.expired@lockin.local",
            "qa.renewal@lockin.local",
            "qa.renewal-early@lockin.local",
            "qa.review@lockin.local",
        )
        first_count = User.objects.filter(email__in=expected_emails).count()
        call_command("seed_demo", "--subscription-e2e", verbosity=0)

        self.assertEqual(first_count, len(expected_emails))
        self.assertEqual(User.objects.filter(email__in=expected_emails).count(), first_count)
        self.assertIsNone(User.objects.get(email="qa.google@lockin.local").username)
        self.assertEqual(
            Subscription.objects.get(account__primary_user__email="qa.renewal@lockin.local").status,
            Subscription.Status.ACTIVE,
        )
        self.assertTrue(
            ManualRechargeSubmission.objects.filter(
                user__email="qa.review@lockin.local",
                status=ManualRechargeSubmission.Status.PENDING,
            ).exists()
        )

    @override_settings(ENVIRONMENT="development", DEBUG=True)
    def test_subscription_e2e_seed_refuses_non_testing_settings(self):
        with self.assertRaises(CommandError):
            call_command("seed_demo", "--subscription-e2e", verbosity=0)
