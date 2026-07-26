export const assets = {
  login: "/assets/login-scene-new.jpg",
  mascot: "/assets/mascot-study.png"
};

export const navItems = [
  { path: "/", label: "Dashboard", icon: "home", group: "Study" },
  { path: "/materials", label: "Materials", icon: "book-open", group: "Study" },
  { path: "/questions", label: "Questions", icon: "help", group: "Study" },
  { path: "/review", label: "Review", icon: "target", group: "Review" },
  { path: "/bookmarks", label: "Bookmarks", icon: "bookmark", group: "Review" },
  { path: "/community", label: "Community", icon: "messages", group: "Social" },
  { path: "/ranked", label: "Ranked", icon: "trophy", group: "Social" },
  { path: "/analytics", label: "Analytics", icon: "analytics", group: "Personal" },
  { path: "/progress", label: "Progress", icon: "activity", group: "Personal" },
  { path: "/achievements", label: "Achievements", icon: "award", group: "Personal" }
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
  autoTheme: false
};

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
