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

// Every student destination, in drawer order. Only `primary` entries sit in
// the rail and the phone's bottom bar; an entry with a `hub` is reached as a
// tab inside that primary destination (see navHubs), and the rest live in the
// drawer, which still lists everything so nothing becomes undiscoverable.
export const navItems = [
  { path: "/", label: "Dashboard", labelKey: "nav.dashboard", icon: "home", group: "Study", groupKey: "group.study", primary: true },
  { path: "/study-plan", label: "Study Plan", labelKey: "nav.studyPlan", icon: "calendar", group: "Study", groupKey: "group.study" },
  { path: "/materials", label: "Materials", labelKey: "nav.materials", icon: "book-open", group: "Study", groupKey: "group.study", primary: true },
  { path: "/paper-workspace", label: "Paper Workspace", labelKey: "nav.paperWorkspace", icon: "file", group: "Study", groupKey: "group.study", hub: "/materials" },
  { path: "/lock-in", label: "Lock-in Mode", labelKey: "nav.lockInMode", icon: "clock", group: "Study", groupKey: "group.study" },
  { path: "/questions", label: "Questions", labelKey: "nav.questions", icon: "help", group: "Study", groupKey: "group.study", primary: true },
  { path: "/review", label: "Review", labelKey: "nav.review", icon: "target", group: "Review", groupKey: "group.review", primary: true },
  { path: "/bookmarks", label: "Bookmarks", labelKey: "nav.bookmarks", icon: "bookmark", group: "Review", groupKey: "group.review", hub: "/review" },
  { path: "/store", label: "Store", labelKey: "nav.store", icon: "shopping-bag", group: "Personal", groupKey: "group.personal" },
  // Directly under Store: students looked for plans there and could not find
  // them, because the page was only reachable from the account menu and banners.
  { path: "/subscription", label: "Plans", labelKey: "nav.subscription", icon: "sparkles", group: "Personal", groupKey: "group.personal" },
  { path: "/progress", label: "Progress", labelKey: "nav.progress", icon: "activity", group: "Personal", groupKey: "group.personal", primary: true },
  { path: "/analysis", label: "Analysis", labelKey: "nav.analysis", icon: "analytics", group: "Personal", groupKey: "group.personal", hub: "/progress" },
  { path: "/community", label: "Community", labelKey: "nav.community", icon: "messages", group: "Social", groupKey: "group.social" },
  { path: "/ranked", label: "Ranked", labelKey: "nav.ranked", icon: "trophy", group: "Social", groupKey: "group.social" }
];

// The rail has room for more than the five primary destinations. These follow
// them under a divider; each is its own page rather than a hub section, so no
// two rail entries are ever current together. Everything else stays in "More".
export const railExtraItems = [
  { path: "/store", label: "Store", labelKey: "nav.store", icon: "shopping-bag", group: "More", groupKey: "common.more" },
  { path: "/subscription", label: "Plans", labelKey: "nav.subscription", icon: "sparkles", group: "More", groupKey: "common.more" },
  { path: "/notifications", label: "Notifications", labelKey: "nav.notifications", icon: "bell", group: "More", groupKey: "common.more" },
  { path: "/settings", label: "Settings", labelKey: "nav.settings", icon: "settings", group: "More", groupKey: "common.more" }
];

// The phone's bottom bar keeps four destinations and "More"; Progress opens
// the drawer's first group there instead.
export const bottomNavPaths = ["/", "/materials", "/questions", "/review"];

/**
 * Sections that share one primary destination. Each hub shows its sections as
 * a tab strip at the top of the page, on exactly these paths (deeper pages such
 * as a subject's sheets have their own back link instead), and keeps its rail
 * entry current on every one of them.
 */
export const navHubs = [
  { path: "/materials", sections: [
    { path: "/materials", labelKey: "hub.subjects" },
    { path: "/paper-workspace", labelKey: "nav.paperWorkspace" },
    { path: "/materials/summaries", labelKey: "summary.mine" }
  ] },
  { path: "/review", sections: [
    { path: "/review", labelKey: "review.center" },
    { path: "/bookmarks", labelKey: "nav.bookmarks" }
  ] },
  { path: "/progress", sections: [
    { path: "/progress", labelKey: "hub.overview" },
    { path: "/analysis", labelKey: "nav.analysis" },
    { path: "/achievements", labelKey: "nav.achievements" }
  ] }
];

export function hubForPath(pathname) {
  return navHubs.find((hub) => hub.sections.some((section) => section.path === pathname)) || null;
}

/** Every path that keeps a primary destination current, beyond its own prefix. */
export function hubMemberPaths(primaryPath) {
  const hub = navHubs.find((item) => item.path === primaryPath);
  return hub ? hub.sections.map((section) => section.path) : [];
}

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
  { id: "white", label: "White Cat" },
  { id: "none", label: "None" }
];

export const themeOptions = [
  { id: "dawn", label: "Dawn", time: "05:00 - 08:00" },
  { id: "day", label: "Day", time: "08:00 - 17:00" },
  { id: "sunset", label: "Sunset", time: "17:00 - 20:00" },
  { id: "night", label: "Night", time: "20:00 - 05:00" }
];

export const reminderDefaults = {
  enabled: false,
  time: "20:00",
  lastSentDate: ""
};
