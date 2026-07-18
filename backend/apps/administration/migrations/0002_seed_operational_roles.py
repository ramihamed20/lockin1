from django.db import migrations


def seed_roles(apps, schema_editor):  # type: ignore[no-untyped-def]
    capability_model = apps.get_model("administration", "OperationalCapability")
    role_model = apps.get_model("administration", "OperationalRole")
    capabilities = (
        ("overview.view", "View platform overview"),
        ("users.view", "View users"),
        ("users.manage", "Manage users"),
        ("content.view", "View content operations"),
        ("content.manage", "Manage content"),
        ("assessments.view", "View assessment operations"),
        ("assessments.manage", "Manage assessments"),
        ("community.view", "View community operations"),
        ("moderation.view", "View moderation"),
        ("moderation.manage", "Manage moderation"),
        ("subscriptions.view", "View subscriptions"),
        ("subscriptions.manage", "Manage subscriptions"),
        ("payments.view", "View payments"),
        ("payments.manage", "Manage payments"),
        ("achievements.view", "View achievements"),
        ("achievements.manage", "Manage achievements"),
        ("notifications.view", "View notifications"),
        ("notifications.manage", "Manage notifications"),
        ("system_health.view", "View system health"),
        ("analytics.view", "View analytics"),
        ("audit.view", "View audit history"),
        ("reports.export", "Export reports"),
        ("configuration.view", "View configuration"),
        ("configuration.manage", "Manage configuration"),
        ("operational_actions.execute", "Execute operational actions"),
        ("operational_roles.manage", "Manage operational roles"),
    )
    capability_objects = {}
    for code, name in capabilities:
        capability_objects[code], _ = capability_model.objects.update_or_create(
            code=code,
            defaults={"name": name, "description": f"Operational capability: {name.lower()}."},
        )
    role_capabilities = {
        "platform_administrator": tuple(capability_objects),
        "support": (
            "overview.view", "users.view", "users.manage", "moderation.view",
            "subscriptions.view", "payments.view", "notifications.view",
            "system_health.view", "audit.view", "operational_actions.execute",
        ),
        "content_manager": (
            "overview.view", "content.view", "content.manage", "assessments.view",
            "assessments.manage", "analytics.view", "reports.export",
        ),
        "moderator": (
            "overview.view", "community.view", "moderation.view", "moderation.manage",
            "users.view",
        ),
        "finance": (
            "overview.view", "subscriptions.view", "subscriptions.manage", "payments.view",
            "payments.manage", "analytics.view", "audit.view", "reports.export",
        ),
        "analytics_viewer": ("overview.view", "analytics.view", "reports.export"),
    }
    names = {
        "platform_administrator": "Platform Administrator",
        "support": "Support",
        "content_manager": "Content Manager",
        "moderator": "Moderator",
        "finance": "Finance",
        "analytics_viewer": "Analytics Viewer",
    }
    for code, assigned in role_capabilities.items():
        role, _ = role_model.objects.update_or_create(
            code=code,
            defaults={"name": names[code], "description": f"Least-privilege {names[code]} role."},
        )
        role.capabilities.set([capability_objects[item] for item in assigned])


class Migration(migrations.Migration):
    dependencies = [("administration", "0001_initial")]
    operations = [migrations.RunPython(seed_roles, migrations.RunPython.noop)]
