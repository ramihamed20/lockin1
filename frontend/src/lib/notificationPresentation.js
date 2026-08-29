const PRESENTATIONS = Object.freeze({
  account: { icon: "lock", labelKey: "notifications.category.account", tone: "account" },
  learning: { icon: "book-open", labelKey: "notifications.category.learning", tone: "learning" },
  achievement: { icon: "trophy", labelKey: "notifications.category.achievement", tone: "achievement" },
  community: { icon: "messages", labelKey: "notifications.category.community", tone: "community" },
  moderation: { icon: "shield-alert", labelKey: "notifications.category.moderation", tone: "moderation" },
  platform: { icon: "megaphone", labelKey: "notifications.category.platform", tone: "platform" },
  billing: { icon: "coins", labelKey: "notifications.category.billing", tone: "billing" }
});

const FALLBACK_PRESENTATION = Object.freeze({ icon: "bell", labelKey: "notifications.category.update", tone: "platform" });

export function notificationPresentation(category) {
  return PRESENTATIONS[category] || FALLBACK_PRESENTATION;
}
