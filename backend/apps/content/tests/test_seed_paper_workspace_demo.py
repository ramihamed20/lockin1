from io import StringIO

from django.core.management import CommandError, call_command
from django.test import TestCase, override_settings

from apps.accounts.models import User
from apps.content.models import ActiveStudyQuestionContent, LearningObject
from apps.focus.managed_active_study import availability

TITLE = "Paper Workspace Demo · Epithelial Tissue"
STUDENTS = ("local_student@lockin.local", "student@lockin.local")


@override_settings(DEBUG=True, ENVIRONMENT="testing")
class SeedPaperWorkspaceDemoTests(TestCase):
    def test_every_demo_student_sees_a_ready_sheet_and_the_seed_is_idempotent(self):
        call_command("seed_paper_workspace_demo", stdout=StringIO())
        first = set(LearningObject.objects.filter(published_version__title=TITLE))
        call_command("seed_paper_workspace_demo", stdout=StringIO())
        self.assertEqual(first, set(LearningObject.objects.filter(published_version__title=TITLE)))

        for email in STUDENTS:
            student = User.objects.get(email=email)
            self.client.force_login(student)
            materials = self.client.get("/api/v1/catalog/materials").json()["results"]
            sheets = [
                sheet
                for material in materials
                for sheet in material["sheets"]
                if sheet["title"] == TITLE
            ]
            self.assertEqual(len(sheets), 1, email)
            sheet_id = sheets[0]["learningObjectId"]
            self.assertEqual(
                ActiveStudyQuestionContent.objects.filter(sheet_id=sheet_id).count(), 3
            )
            rows = availability(user=student, sheet_id=sheet_id)["difficulties"]
            self.assertEqual(
                {row["difficulty"]: row["status"] for row in rows},
                {"easy": "ready", "medium": "ready", "hard": "ready"},
                email,
            )

    def test_an_unknown_account_is_refused(self):
        with self.assertRaises(CommandError):
            call_command(
                "seed_paper_workspace_demo", "--email", "nobody@example.test", stdout=StringIO()
            )

    @override_settings(ENVIRONMENT="production", DEBUG=False)
    def test_the_seed_refuses_production(self):
        with self.assertRaises(CommandError):
            call_command("seed_paper_workspace_demo", stdout=StringIO())
