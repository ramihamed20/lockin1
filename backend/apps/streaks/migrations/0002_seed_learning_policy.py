from django.db import migrations


def seed_policy(apps, schema_editor):
    StreakPolicy = apps.get_model("streaks", "StreakPolicy")
    StreakPolicy.objects.get_or_create(
        code="learning_days",
        version=1,
        defaults={
            "title": "Meaningful learning days",
            "qualifying_activity_types": [
                "lesson.completed",
                "assessment.passed",
                "focus.deep_session",
            ],
            "boundary_timezone": "UTC",
            "grace_days": 0,
            "freeze_tokens_enabled": False,
            "recovery_window_days": 0,
            "rules": {"minimum_focus_seconds": 1200},
            "is_active": True,
        },
    )


def remove_policy(apps, schema_editor):
    apps.get_model("streaks", "StreakPolicy").objects.filter(
        code="learning_days", version=1
    ).delete()


class Migration(migrations.Migration):
    dependencies = [("streaks", "0001_initial")]
    operations = [migrations.RunPython(seed_policy, remove_policy)]
