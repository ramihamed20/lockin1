from django.db import migrations


CATALOG = (
    {
        "code": "first_step",
        "category": "learning",
        "icon_key": "path",
        "title_en": "First step",
        "title_ar": "الخطوة الأولى",
        "description_en": "Complete your first lesson.",
        "description_ar": "أكمل درسك الأول.",
        "criteria": {"evidence_type": "lesson.completed", "aggregation": "count", "target": 1},
    },
    {
        "code": "mastery_proven",
        "category": "assessment",
        "icon_key": "mastery",
        "title_en": "Mastery proven",
        "title_ar": "إتقان مثبت",
        "description_en": "Pass an achievement-eligible mastery check.",
        "description_ar": "اجتز اختبار إتقان مؤهّلًا للإنجازات.",
        "criteria": {
            "evidence_type": "assessment.mastery.passed",
            "aggregation": "count",
            "target": 1,
        },
    },
    {
        "code": "deep_focus",
        "category": "focus",
        "icon_key": "focus",
        "title_en": "Deep focus",
        "title_ar": "تركيز عميق",
        "description_en": "Accumulate 60 verified focus minutes.",
        "description_ar": "اجمع 60 دقيقة تركيز موثّقة.",
        "criteria": {"evidence_type": "focus.minutes", "aggregation": "sum", "target": 60},
    },
    {
        "code": "steady_week",
        "category": "consistency",
        "icon_key": "streak",
        "title_en": "Steady week",
        "title_ar": "أسبوع ثابت",
        "description_en": "Reach a seven-day meaningful learning streak.",
        "description_ar": "حقق سلسلة تعلّم هادف لمدة سبعة أيام.",
        "criteria": {
            "evidence_type": "streak.current_days",
            "aggregation": "max",
            "target": 7,
        },
    },
    {
        "code": "helpful_voice",
        "category": "community",
        "icon_key": "discussion",
        "title_en": "Helpful voice",
        "title_ar": "صوت مساعد",
        "description_en": "Start your first contextual learning discussion.",
        "description_ar": "ابدأ أول نقاش تعليمي مرتبط بالمحتوى.",
        "criteria": {
            "evidence_type": "community.contextual_discussion",
            "aggregation": "count",
            "target": 1,
        },
    },
)


def seed_catalog(apps, schema_editor):
    Definition = apps.get_model("achievements", "AchievementDefinition")
    Version = apps.get_model("achievements", "AchievementVersion")
    for item in CATALOG:
        definition, _ = Definition.objects.get_or_create(
            code=item["code"],
            defaults={
                "category": item["category"],
                "icon_key": item["icon_key"],
                "is_active": True,
            },
        )
        version, _ = Version.objects.get_or_create(
            definition=definition,
            version=1,
            defaults={
                "title_en": item["title_en"],
                "title_ar": item["title_ar"],
                "description_en": item["description_en"],
                "description_ar": item["description_ar"],
                "criteria": item["criteria"],
            },
        )
        if definition.current_version_id != version.id:
            definition.current_version = version
            definition.save(update_fields=("current_version",))


def remove_catalog(apps, schema_editor):
    Definition = apps.get_model("achievements", "AchievementDefinition")
    Version = apps.get_model("achievements", "AchievementVersion")
    codes = [item["code"] for item in CATALOG]
    definitions = Definition.objects.filter(code__in=codes)
    definitions.update(current_version=None)
    Version.objects.filter(definition__code__in=codes).delete()
    definitions.delete()


class Migration(migrations.Migration):
    dependencies = [("achievements", "0001_initial")]
    operations = [migrations.RunPython(seed_catalog, remove_catalog)]
