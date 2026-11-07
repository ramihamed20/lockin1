from datetime import date
from uuid import uuid4

import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.utils import timezone

from apps.accounts.tests.helpers import create_user


@pytest.mark.django_db(transaction=True)
def test_foundation_migration_preserves_legacy_sessions_and_revisions():
    user = create_user()
    old = ("study_plans", "0002_studyplanprofile_studyplanitem_client_request_id_and_more")
    new = ("study_plans", "0003_examperiod_examschedule_examsyllabusscope_and_more")
    executor = MigrationExecutor(connection)
    executor.migrate([old])
    try:
        old_apps = executor.loader.project_state([old]).apps
        old_item = old_apps.get_model("study_plans", "StudyPlanItem")
        old_profile = old_apps.get_model("study_plans", "StudyPlanProfile")
        completed_at, request_id = timezone.now(), uuid4()
        item = old_item.objects.create(
            user_id=user.pk,
            title="Legacy completed session",
            subject="Anatomy",
            scheduled_date=date(2026, 10, 25),
            duration_minutes=25,
            status="completed",
            completed_at=completed_at,
            revision=7,
            client_request_id=request_id,
            generated_slot=0,
            plan_mode="normal",
        )
        old_profile.objects.create(user_id=user.pk, revision=4, subjects=["Anatomy"])
        executor = MigrationExecutor(connection)
        executor.migrate([new])
        apps = executor.loader.project_state([new]).apps
        migrated = apps.get_model("study_plans", "StudyPlanItem").objects.get(pk=item.pk)
        assert migrated.title == item.title and migrated.subject == "Anatomy"
        assert migrated.status == "completed" and migrated.completed_at == completed_at
        assert migrated.revision == 7 and migrated.generated_slot == 0
        assert migrated.client_request_id == request_id
        assert migrated.activity == "manual" and migrated.content_version_id is None
        assert (
            apps.get_model("study_plans", "StudyPlanProfile").objects.get(user_id=user.pk).revision
            == 4
        )
    finally:
        executor = MigrationExecutor(connection)
        executor.migrate(executor.loader.graph.leaf_nodes())
