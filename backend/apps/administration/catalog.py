from dataclasses import dataclass


class Capability:
    OVERVIEW_VIEW = "overview.view"
    USERS_VIEW = "users.view"
    USERS_MANAGE = "users.manage"
    CONTENT_VIEW = "content.view"
    CONTENT_MANAGE = "content.manage"
    ASSESSMENTS_VIEW = "assessments.view"
    ASSESSMENTS_MANAGE = "assessments.manage"
    COMMUNITY_VIEW = "community.view"
    MODERATION_VIEW = "moderation.view"
    MODERATION_MANAGE = "moderation.manage"
    SUBSCRIPTIONS_VIEW = "subscriptions.view"
    SUBSCRIPTIONS_MANAGE = "subscriptions.manage"
    PAYMENTS_VIEW = "payments.view"
    PAYMENTS_MANAGE = "payments.manage"
    ACHIEVEMENTS_VIEW = "achievements.view"
    ACHIEVEMENTS_MANAGE = "achievements.manage"
    NOTIFICATIONS_VIEW = "notifications.view"
    NOTIFICATIONS_MANAGE = "notifications.manage"
    SYSTEM_HEALTH_VIEW = "system_health.view"
    ANALYTICS_VIEW = "analytics.view"
    AUDIT_VIEW = "audit.view"
    REPORTS_EXPORT = "reports.export"
    CONFIGURATION_VIEW = "configuration.view"
    CONFIGURATION_MANAGE = "configuration.manage"
    ACTIONS_EXECUTE = "operational_actions.execute"
    ROLES_MANAGE = "operational_roles.manage"


@dataclass(frozen=True, slots=True)
class CapabilityDefinition:
    code: str
    name: str
    description: str


CAPABILITIES = tuple(
    CapabilityDefinition(code, name, description)
    for code, name, description in (
        (Capability.OVERVIEW_VIEW, "View platform overview", "Read the operational overview."),
        (Capability.USERS_VIEW, "View users", "Read the operational user directory."),
        (Capability.USERS_MANAGE, "Manage users", "Run bounded account actions."),
        (Capability.CONTENT_VIEW, "View content operations", "Read content operations data."),
        (Capability.CONTENT_MANAGE, "Manage content", "Manage educational content."),
        (
            Capability.ASSESSMENTS_VIEW,
            "View assessment operations",
            "Read assessment operations data.",
        ),
        (Capability.ASSESSMENTS_MANAGE, "Manage assessments", "Manage questions and assessments."),
        (Capability.COMMUNITY_VIEW, "View community operations", "Read community operations data."),
        (Capability.MODERATION_VIEW, "View moderation", "Read moderation queues."),
        (Capability.MODERATION_MANAGE, "Manage moderation", "Perform moderator actions."),
        (Capability.SUBSCRIPTIONS_VIEW, "View subscriptions", "Read subscription operations data."),
        (Capability.SUBSCRIPTIONS_MANAGE, "Manage subscriptions", "Manage subscription state."),
        (Capability.PAYMENTS_VIEW, "View payments", "Read payment operations data."),
        (Capability.PAYMENTS_MANAGE, "Manage payments", "Perform approved payment operations."),
        (Capability.ACHIEVEMENTS_VIEW, "View achievements", "Read achievement operations data."),
        (Capability.ACHIEVEMENTS_MANAGE, "Manage achievements", "Manage achievement definitions."),
        (Capability.NOTIFICATIONS_VIEW, "View notifications", "Read notification operations data."),
        (
            Capability.NOTIFICATIONS_MANAGE,
            "Manage notifications",
            "Manage notification operations.",
        ),
        (Capability.SYSTEM_HEALTH_VIEW, "View system health", "Read redacted health diagnostics."),
        (Capability.ANALYTICS_VIEW, "View analytics", "Read aggregate operational analytics."),
        (Capability.AUDIT_VIEW, "View audit history", "Read immutable operational audit history."),
        (Capability.REPORTS_EXPORT, "Export reports", "Preview and export bounded reports."),
        (Capability.CONFIGURATION_VIEW, "View configuration", "Read non-secret configuration."),
        (Capability.CONFIGURATION_MANAGE, "Manage configuration", "Update typed configuration."),
        (
            Capability.ACTIONS_EXECUTE,
            "Execute operational actions",
            "Preview and confirm bounded actions.",
        ),
        (
            Capability.ROLES_MANAGE,
            "Manage operational roles",
            "Assign least-privilege operational roles.",
        ),
    )
)


ROLE_CAPABILITIES: dict[str, frozenset[str]] = {
    "platform_administrator": frozenset(item.code for item in CAPABILITIES),
    "support": frozenset(
        {
            Capability.OVERVIEW_VIEW,
            Capability.USERS_VIEW,
            Capability.USERS_MANAGE,
            Capability.MODERATION_VIEW,
            Capability.SUBSCRIPTIONS_VIEW,
            Capability.PAYMENTS_VIEW,
            Capability.NOTIFICATIONS_VIEW,
            Capability.SYSTEM_HEALTH_VIEW,
            Capability.AUDIT_VIEW,
            Capability.ACTIONS_EXECUTE,
        }
    ),
    "content_manager": frozenset(
        {
            Capability.OVERVIEW_VIEW,
            Capability.CONTENT_VIEW,
            Capability.CONTENT_MANAGE,
            Capability.ASSESSMENTS_VIEW,
            Capability.ASSESSMENTS_MANAGE,
            Capability.ANALYTICS_VIEW,
            Capability.REPORTS_EXPORT,
        }
    ),
    "moderator": frozenset(
        {
            Capability.OVERVIEW_VIEW,
            Capability.COMMUNITY_VIEW,
            Capability.MODERATION_VIEW,
            Capability.MODERATION_MANAGE,
            Capability.USERS_VIEW,
        }
    ),
    "finance": frozenset(
        {
            Capability.OVERVIEW_VIEW,
            Capability.SUBSCRIPTIONS_VIEW,
            Capability.SUBSCRIPTIONS_MANAGE,
            Capability.PAYMENTS_VIEW,
            Capability.PAYMENTS_MANAGE,
            Capability.ANALYTICS_VIEW,
            Capability.AUDIT_VIEW,
            Capability.REPORTS_EXPORT,
        }
    ),
    "analytics_viewer": frozenset(
        {Capability.OVERVIEW_VIEW, Capability.ANALYTICS_VIEW, Capability.REPORTS_EXPORT}
    ),
}


ROLE_NAMES = {
    "platform_administrator": "Platform Administrator",
    "support": "Support",
    "content_manager": "Content Manager",
    "moderator": "Moderator",
    "finance": "Finance",
    "analytics_viewer": "Analytics Viewer",
}
