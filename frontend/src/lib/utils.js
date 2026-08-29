import {
  appIconOptions,
  defaultThemeSettings,
  focusDurations,
  onboardingDefaults,
  reminderDefaults,
  sessionLengthOptions,
  streakProtectionDefaults
} from "./constants.js";

export function assetPath(path) {
  if (!path) return "";
  const base = import.meta.env.BASE_URL || "/";
  const prefix = base.endsWith("/") ? base : `${base}/`;
  const cleanPath = path.startsWith("/") ? path.slice(1) : path;
  return `${prefix}${cleanPath}`;
}

/**
 * Keeps custom CSS variables type-safe at React style boundaries.
 * @param {Record<`--${string}`, string | number>} values
 * @returns {import("react").CSSProperties}
 */
export function cssVars(values) {
  return /** @type {import("react").CSSProperties} */ (values);
}

export function themePreview(character, theme) {
  return assetPath(`/assets/themes/${character}-${theme}-640.webp`);
}

export function autoThemeForDate(date = new Date()) {
  const hour = date.getHours();
  if (hour >= 5 && hour < 8) return "dawn";
  if (hour >= 8 && hour < 17) return "day";
  if (hour >= 17 && hour < 20) return "sunset";
  return "night";
}

export function normalizeThemeSettings(settings = {}) {
  const character = ["black", "white"].includes(settings.character) ? settings.character : defaultThemeSettings.character;
  const theme = ["dawn", "day", "sunset", "night"].includes(settings.theme) ? settings.theme : defaultThemeSettings.theme;
  const appIcon = appIconOptions.some((option) => option.id === settings.appIcon) ? settings.appIcon : defaultThemeSettings.appIcon;
  return { character, theme, autoTheme: Boolean(settings.autoTheme), appIcon };
}

export function readLocalThemeSettings() {
  try {
    return normalizeThemeSettings(JSON.parse(localStorage.getItem("lock-in.theme.settings") || "{}"));
  } catch {
    return defaultThemeSettings;
  }
}

// --- Session preferences ---

export function readSessionCountPreference() {
  try {
    const stored = JSON.parse(localStorage.getItem("lock-in.session.count") || "10");
    return sessionLengthOptions.includes(stored) ? stored : 10;
  } catch {
    return 10;
  }
}

export function readFocusDurationPreference() {
  try {
    const stored = Number(localStorage.getItem("lock-in.focus.minutes") || "25");
    return focusDurations.some((item) => item.minutes === stored) ? stored : 25;
  } catch {
    return 25;
  }
}

// --- Onboarding ---

export function onboardingKey(email = "") {
  return `lock-in.onboarding.${email || "guest"}`;
}

export function readOnboardingState(email = "") {
  try {
    const stored = JSON.parse(localStorage.getItem(onboardingKey(email)) || "{}");
    return {
      ...onboardingDefaults,
      ...stored,
      completed: Boolean(stored.completed),
      dailyTarget: [10, 15, 20].includes(Number(stored.dailyTarget)) ? Number(stored.dailyTarget) : onboardingDefaults.dailyTarget,
      focusMinutes: focusDurations.some((item) => item.minutes === Number(stored.focusMinutes))
        ? Number(stored.focusMinutes)
        : onboardingDefaults.focusMinutes,
      focusMaterialId: stored.focusMaterialId ? String(stored.focusMaterialId) : ""
    };
  } catch {
    return onboardingDefaults;
  }
}

// --- Reminders ---

export function reminderKey(email = "") {
  return `lock-in.reminder.${email || "guest"}`;
}

export function normalizeReminderSettings(settings = {}) {
  const time = typeof settings.time === "string" && /^\d{2}:\d{2}$/.test(settings.time) ? settings.time : reminderDefaults.time;
  return {
    enabled: Boolean(settings.enabled),
    time,
    lastSentDate: typeof settings.lastSentDate === "string" ? settings.lastSentDate : ""
  };
}

export function readReminderSettings(email = "") {
  try {
    return normalizeReminderSettings(JSON.parse(localStorage.getItem(reminderKey(email)) || "{}"));
  } catch {
    return reminderDefaults;
  }
}

// --- Date helpers ---

export function todayStamp(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export function parseReminderTime(time) {
  const [hours, minutes] = String(time || "20:00").split(":").map((part) => Number(part) || 0);
  return { hours, minutes };
}

// --- Streak ---

export function streakProtectionKey(email = "") {
  return `lock-in.streakProtection.${email || "guest"}`;
}

export function weekStamp(date = new Date()) {
  return String(Math.floor(date.getTime() / 604800000));
}

export function readStreakProtection(email = "") {
  try {
    return { ...streakProtectionDefaults, ...JSON.parse(localStorage.getItem(streakProtectionKey(email)) || "{}") };
  } catch {
    return streakProtectionDefaults;
  }
}

// --- Level ---

export function levelMemoryKey(email = "") {
  return `lock-in.lastLevel.${email || "guest"}`;
}

// --- Greeting ---

export function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

// --- Formatting ---

export function formatDuration(seconds) {
  const safeSeconds = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

export function relativeTime(value) {
  const timestamp = new Date(value).getTime();
  if (!timestamp) return "Recently";
  const diff = Date.now() - timestamp;
  const tense = diff >= 0 ? "ago" : "from now";
  const minutes = Math.max(1, Math.round(Math.abs(diff) / 60000));
  if (minutes < 60) return tense === "ago" ? `${minutes}m ago` : `in ${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return tense === "ago" ? `${hours}h ago` : `in ${hours}h`;
  const days = Math.round(hours / 24);
  if (tense !== "ago") return days === 1 ? "Tomorrow" : `in ${days}d`;
  return days === 1 ? "Yesterday" : `${days}d ago`;
}

// --- Question helpers ---

export function explanationReviewTip(question, feedback) {
  if (feedback.reviewScheduled) return "This is now in spaced review. Revisit it when it becomes due, then answer without looking.";
  if (question.difficulty === "Hard") return "Write a one-line contrast with the nearest wrong option, then retry it in a focused session.";
  if (question.difficulty === "Medium") return `Repeat the ${question.materialTitle || "material"} cue once, then connect it to the correct choice.`;
  return "Keep it warm with a quick flashcard pass later today.";
}

export function correctEncouragement(seed = 0) {
  const messages = ["Great recall!", "You nailed it.", "Clean answer.", "Strong memory.", "Keep that rhythm."];
  return messages[Math.abs(Number(seed)) % messages.length];
}
