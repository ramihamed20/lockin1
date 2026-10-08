import { appIconOptions, defaultThemeSettings, reminderDefaults } from "./constants.js";

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

export function autoThemeForDate(date = new Date()) {
  const hour = date.getHours();
  if (hour >= 5 && hour < 8) return "dawn";
  if (hour >= 8 && hour < 17) return "day";
  if (hour >= 17 && hour < 20) return "sunset";
  return "night";
}

export function normalizeThemeSettings(settings = {}) {
  const character = ["black", "white", "none"].includes(settings.character) ? settings.character : defaultThemeSettings.character;
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
