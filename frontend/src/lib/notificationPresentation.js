const PRESENTATIONS = Object.freeze({
  account: { icon: "lock", label: "Account", tone: "account" },
  learning: { icon: "book-open", label: "Learning", tone: "learning" },
  achievement: { icon: "trophy", label: "Achievement", tone: "achievement" },
  community: { icon: "messages", label: "Community", tone: "community" },
  moderation: { icon: "shield-alert", label: "Moderation", tone: "moderation" },
  platform: { icon: "megaphone", label: "Platform", tone: "platform" },
  billing: { icon: "coins", label: "Billing", tone: "billing" }
});

const FALLBACK_PRESENTATION = Object.freeze({ icon: "bell", label: "Update", tone: "platform" });

export function notificationPresentation(category) {
  return PRESENTATIONS[category] || FALLBACK_PRESENTATION;
}
