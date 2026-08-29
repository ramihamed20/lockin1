/**
 * The viewport range that gets the compact shell: bottom bar and drawer rather
 * than a sidebar. It matches the media query the stylesheet uses, so anything
 * the shell decides in JavaScript stays in step with what CSS paints. A phone
 * in landscape is wider than 640px but far too short for a sidebar, which is
 * why height is part of the condition.
 */
export const COMPACT_SHELL_QUERY = "(max-width: 639px), (max-height: 559px)";

export const assets = {
  login: "/assets/login-scene-new.jpg",
  mascot: "/assets/mascot-study-320.webp"
};

export const navItems = [
  { path: "/", label: "Dashboard", labelKey: "nav.dashboard", icon: "home", group: "Study", groupKey: "group.study" },
  { path: "/study-plan", label: "Study Plan", labelKey: "nav.studyPlan", icon: "calendar", group: "Study", groupKey: "group.study" },
  { path: "/materials", label: "Materials", labelKey: "nav.materials", icon: "book-open", group: "Study", groupKey: "group.study" },
  { path: "/questions", label: "Questions", labelKey: "nav.questions", icon: "help", group: "Study", groupKey: "group.study" },
  { path: "/review", label: "Review", labelKey: "nav.review", icon: "target", group: "Review", groupKey: "group.review" },
  { path: "/bookmarks", label: "Bookmarks", labelKey: "nav.bookmarks", icon: "bookmark", group: "Review", groupKey: "group.review" },
  { path: "/store", label: "Store", labelKey: "nav.store", icon: "shopping-bag", group: "Personal", groupKey: "group.personal" },
  { path: "/progress", label: "Progress", labelKey: "nav.progress", icon: "activity", group: "Personal", groupKey: "group.personal" },
  { path: "/community", label: "Community", labelKey: "nav.community", icon: "messages", group: "Social", groupKey: "group.social" },
  { path: "/ranked", label: "Ranked", labelKey: "nav.ranked", icon: "trophy", group: "Social", groupKey: "group.social" }
];

export const quotes = [
  "Discipline today, a confident dentist tomorrow.",
  "Weakness is just a topic asking for time.",
  "One focused block can rescue a whole week.",
  "Small reviews build calm exam days.",
  "Accuracy is built before pressure arrives."
];

export const defaultThemeSettings = {
  character: "white",
  theme: "night",
  autoTheme: false,
  appIcon: "light"
};

// Source artwork supplied for the application icon. The files are cropped and
// scaled from that artwork only; no logo variants are generated in code.
export const appIconOptions = [
  {
    id: "light",
    label: "Light",
    preview: "/icons/lockin-light-192-v2.png",
    favicon16: "/icons/lockin-light-16-v2.png",
    favicon: "/icons/lockin-light-32-v2.png",
    appleTouchIcon: "/icons/lockin-light-180-v2.png"
  },
  {
    id: "midnight",
    label: "Midnight",
    preview: "/icons/lockin-midnight-192-v2.png",
    favicon16: "/icons/lockin-midnight-16-v2.png",
    favicon: "/icons/lockin-midnight-32-v2.png",
    appleTouchIcon: "/icons/lockin-midnight-180-v2.png"
  },
  {
    id: "gold",
    label: "Gold",
    preview: "/icons/lockin-gold-192-v2.png",
    favicon16: "/icons/lockin-gold-16-v2.png",
    favicon: "/icons/lockin-gold-32-v2.png",
    appleTouchIcon: "/icons/lockin-gold-180-v2.png"
  }
];

export const characterOptions = [
  { id: "black", label: "Black Cat" },
  { id: "white", label: "White Cat" }
];

export const themeOptions = [
  { id: "dawn", label: "Dawn", time: "05:00 - 08:00" },
  { id: "day", label: "Day", time: "08:00 - 17:00" },
  { id: "sunset", label: "Sunset", time: "17:00 - 20:00" },
  { id: "night", label: "Night", time: "20:00 - 05:00" }
];

export const sessionLengthOptions = [5, 10, 20, "all"];

export const focusDurations = [
  { minutes: 25, label: "Focus" },
  { minutes: 15, label: "Review" },
  { minutes: 5, label: "Break" }
];

export const onboardingDefaults = {
  completed: false,
  dailyTarget: 15,
  focusMaterialId: "",
  focusMinutes: 25
};

export const reminderDefaults = {
  enabled: false,
  time: "20:00",
  lastSentDate: ""
};

export const streakProtectionDefaults = {
  usedWeek: ""
};
