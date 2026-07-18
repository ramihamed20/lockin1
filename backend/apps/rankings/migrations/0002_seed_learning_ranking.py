from django.db import migrations


def seed_ranking(apps, schema_editor):
    RankingDefinition = apps.get_model("rankings", "RankingDefinition")
    RankingDefinition.objects.get_or_create(
        code="learning_all_time",
        defaults={
            "title_en": "Learning progress",
            "title_ar": "تقدم التعلّم",
            "metric": "learning_xp",
            "period": "all_time",
            "tie_strategy": "competition",
            "scope": "global",
            "rules": {
                "summary": "Learning XP from completed lessons, eligible assessments, and meaningful focus sessions.",
                "practice_ranking_eligible": False,
                "privacy_default": "initials",
            },
            "is_active": True,
            "revision": 1,
        },
    )


def remove_ranking(apps, schema_editor):
    apps.get_model("rankings", "RankingDefinition").objects.filter(
        code="learning_all_time"
    ).delete()


class Migration(migrations.Migration):
    dependencies = [("rankings", "0001_initial")]
    operations = [migrations.RunPython(seed_ranking, remove_ranking)]
