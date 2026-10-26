export const SETTINGS_SECTIONS = [
  { id: "account", group: "account", labelKey: "common.account", icon: "user" },
  { id: "security", group: "account", labelKey: "settings.security", icon: "lock" },
  { id: "devices", group: "account", labelKey: "settings.devices", icon: "devices" },
  { id: "billing", group: "account", labelKey: "settings.billing", icon: "coins" },
  { id: "privacy", group: "account", labelKey: "settings.privacy", icon: "shield-alert" },
  { id: "appearance", group: "preferences", labelKey: "common.appearance", icon: "palette" },
  { id: "notifications", group: "preferences", labelKey: "settings.notifications", icon: "bell" },
  { id: "offline", group: "preferences", labelKey: "offline.title", icon: "package" },
  { id: "subjects", group: "preferences", labelKey: "subjects.section", icon: "book-open" },
  { id: "suggest", group: "help", labelKey: "settings.suggest.section", icon: "messages" },
  { id: "updates", group: "help", labelKey: "settings.updates.section", icon: "sparkles" },
  { id: "about", group: "help", labelKey: "settings.public.about", icon: "globe" },
  { id: "support", group: "help", labelKey: "settings.public.support", icon: "help" }
];

const LEGACY = {
  character: ["appearance", "settings-character"],
  "app-icon": ["appearance", "settings-app-icon"],
  themes: ["appearance", "settings-themes"],
  reminder: ["notifications", "settings-reminder"]
};

export function resolveSettingsSection(requested, token, focus) {
  if (token) return { section: "privacy", anchor: "settings-deletion" };
  if (focus === "password" && requested === "account") return { section: "security", anchor: "settings-password" };
  if (LEGACY[requested]) return { section: LEGACY[requested][0], anchor: LEGACY[requested][1] };
  return { section: SETTINGS_SECTIONS.some(entry => entry.id === requested) ? requested : "", anchor: "" };
}

/** Search both interface languages, including the settings inside each section. */
export function searchSettingsSections(sections, query, translate) {
  const normalize = value => value.toLocaleLowerCase().normalize("NFKD").replace(/[\u064B-\u065F\u0670]/g, "").replace(/[أإآ]/g, "ا").replace(/\s+/g, " ").trim();
  const words = normalize(query).split(" ").filter(Boolean);
  return sections.filter(section => {
    const text = normalize(`${translate(section.labelKey)} ${translate(`settings.hint.${section.id}`)} ${translate(`settings.keywords.${section.id}`)}`);
    return words.every(word => text.includes(word));
  });
}
