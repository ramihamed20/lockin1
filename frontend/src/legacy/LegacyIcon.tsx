type IconName =
  | "activity"
  | "award"
  | "bell"
  | "bookmark"
  | "book-open"
  | "chevron-left"
  | "chevron-right"
  | "clock"
  | "eye"
  | "eye-off"
  | "file"
  | "globe"
  | "help"
  | "home"
  | "lock"
  | "log-out"
  | "mail"
  | "menu"
  | "messages"
  | "moon"
  | "search"
  | "settings"
  | "shield"
  | "sun"
  | "target"
  | "trophy"
  | "user"
  | "x";

const paths: Record<IconName, string[]> = {
  activity: ["M4 14h3l2-6 4 10 2-6h5"],
  award: ["m12 3 2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4L4.2 8.7l5.4-.8L12 3Z", "M8 14v6l4-2 4 2v-6"],
  bell: ["M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9", "M10 21h4"],
  bookmark: ["M6 4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18l-6-4-6 4V4Z"],
  "book-open": ["M4 5.5A3.5 3.5 0 0 1 7.5 2H11v17H7.5A3.5 3.5 0 0 0 4 22ZM20 5.5A3.5 3.5 0 0 0 16.5 2H13v17h3.5A3.5 3.5 0 0 1 20 22Z"],
  "chevron-left": ["m15 18-6-6 6-6"],
  "chevron-right": ["m9 18 6-6-6-6"],
  clock: ["M12 7v5l3 2", "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"],
  eye: ["M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z", "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"],
  "eye-off": ["m3 3 18 18", "M10.6 6.2A10.8 10.8 0 0 1 12 6c6.5 0 10 6 10 6a18.2 18.2 0 0 1-3 3.8", "M6.2 6.2C3.6 8 2 12 2 12s3.5 6 10 6c1.2 0 2.2-.2 3.2-.6", "M9.9 9.9a3 3 0 0 0 4.2 4.2"],
  file: ["M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Z", "M14 2v6h6", "M8 13h8", "M8 17h6"],
  globe: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "M3 12h18", "M12 3a14 14 0 0 1 0 18", "M12 3a14 14 0 0 0 0 18"],
  help: ["M9.1 9a3 3 0 1 1 5.8 1c0 2-3 2-3 4", "M12 18h.01", "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"],
  home: ["m3 11 9-8 9 8", "M5 10v10h14V10", "M9 20v-6h6v6"],
  lock: ["M7 11V7a5 5 0 0 1 10 0v4", "M5 11h14v10H5z", "M12 15v2"],
  "log-out": ["M10 17l5-5-5-5", "M15 12H3", "M21 19V5a2 2 0 0 0-2-2h-5"],
  mail: ["M3 5h18v14H3z", "m3 7 9 6 9-6"],
  menu: ["M4 7h16", "M4 12h16", "M4 17h16"],
  messages: ["M4 5h16v11H9l-5 4V5Z", "M8 9h8", "M8 13h5"],
  moon: ["M20.5 14.2A8 8 0 0 1 9.8 3.5 8.5 8.5 0 1 0 20.5 14.2Z"],
  search: ["m20 20-4.5-4.5", "M18 11a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z"],
  settings: ["M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z", "M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.1 2.1-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5v.2h-3v-.2a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1L6.6 17l.1-.1A1.7 1.7 0 0 0 7 15a1.7 1.7 0 0 0-1.5-1H5.3v-3h.2A1.7 1.7 0 0 0 7 10a1.7 1.7 0 0 0-.3-1.9l-.1-.1 2.1-2.1.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.5v-.2h3v.2a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 8l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.5 1h.2v3h-.2a1.7 1.7 0 0 0-1.5 1Z"],
  shield: ["M12 3 5 6v5c0 5 3 8 7 10 4-2 7-5 7-10V6l-7-3Z", "m9 12 2 2 4-5"],
  sun: ["M12 3v2", "M12 19v2", "m5.6 5.6 1.4 1.4", "m17 17 1.4 1.4", "M3 12h2", "M19 12h2", "m5.6 18.4 1.4-1.4", "m17 7 1.4-1.4", "M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z"],
  target: ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z", "M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12Z", "M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"],
  trophy: ["M8 4h8v5a4 4 0 0 1-8 0V4Z", "M8 6H4v1a4 4 0 0 0 4 4", "M16 6h4v1a4 4 0 0 1-4 4", "M12 13v5", "M8 21h8", "M9 18h6"],
  user: ["M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21c0-4 3-6 8-6s8 2 8 6"],
  x: ["M6 6l12 12", "m18 6-12 12"]
};

export function LegacyIcon({ name, size = 19 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name].map((path, index) => <path d={path} key={`${name}-${index}`} />)}
    </svg>
  );
}
