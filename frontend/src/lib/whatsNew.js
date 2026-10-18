/**
 * The release notes for this build. To announce an update, bump `version` here
 * and in package.json, set `id` and `date`, and rewrite `summary` and `items`.
 * The same data is shown twice: before the update (fetched from the server as
 * release-notes.json by the app that is still running the old build) and after
 * it (bundled, shown once per account). Accounts created on or after `date`
 * already start on this version, so they are not shown the after-update panel.
 */
export const WHATS_NEW = {
  id: "0.1.3",
  version: "0.1.3",
  date: "2026-10-18",
  summary: {
    en: "A more flexible study experience, with tools closer to the way you study.",
    ar: "تجربة دراسية أكثر مرونة، وأدوات أقرب لطريقتك."
  },
  items: [
    {
      icon: "brain",
      title: { en: "Active Study, your way", ar: "الدراسة النشطة بطريقتك" },
      body: {
        en: "Choose how many pages and questions fit your session.",
        ar: "خصص عدد الصفحات والأسئلة بما يناسب جلستك."
      }
    },
    {
      icon: "clock",
      title: { en: "Pomodoro style", ar: "أسلوب بومودورو" },
      body: {
        en: "Study in intervals, then test your understanding of the pages you read when the timer ends.",
        ar: "ادرس على فترات، واختبر فهمك للصفحات التي قرأتها عند انتهاء المؤقت."
      }
    },
    {
      icon: "file",
      title: { en: "My summaries", ar: "ملخصاتي" },
      body: {
        en: "Write your own summary in your own words, and come back to one you trust.",
        ar: "أنشئ ملخصك الخاص، بكلماتك وفهمك، وارجع إلى ملخص تثق فيه."
      }
    },
    {
      icon: "highlighter",
      title: { en: "Share your marks", ar: "مشاركة التأشير" },
      body: {
        en: "Share your notes and marks, and download other students' marks to learn from them.",
        ar: "شارك ملاحظاتك وتأشيرك، وحمّل تأشير غيرك للاستفادة منه."
      }
    },
    {
      icon: "play",
      title: { en: "YouTube inside the sheet", ar: "يوتيوب داخل الشيت" },
      body: {
        en: "Open YouTube videos inside the PDF reader and follow the explanation while you study.",
        ar: "افتح فيديوهات يوتيوب داخل قارئ PDF وتابع الشرح أثناء الدراسة."
      }
    },
    {
      icon: "pencil",
      title: { en: "Clearer, smoother writing", ar: "كتابة أوضح وأكثر سلاسة" },
      body: {
        en: "Improvements to the pens and to line quality while you write and after.",
        ar: "تحسينات في الأقلام وجودة الخط أثناء الكتابة وبعدها."
      }
    },
    {
      icon: "sparkles",
      title: { en: "An easier experience", ar: "تجربة استخدام أسهل" },
      body: {
        en: "Improvements to the look and navigation, with better support for split-screen mode.",
        ar: "تحسينات في الشكل العام والتنقل، ودعم أفضل لوضع انقسام الشاشة."
      }
    },
    {
      icon: "lock",
      title: { en: "Updated privacy policy", ar: "سياسة خصوصية محدّثة" },
      body: {
        en: "Clearer explanations of your data and how it is used and protected.",
        ar: "توضيحات حول بياناتك وكيفية استخدامها وحمايتها."
      }
    },
  ],
};

const STORAGE_PREFIX = "lock-in.whats-new.seen:";

export function readSeenRelease(userId, storage = safeStorage()) {
  try {
    return storage?.getItem(`${STORAGE_PREFIX}${userId}`) || "";
  } catch {
    return "";
  }
}

export function writeSeenRelease(userId, releaseId = WHATS_NEW.id, storage = safeStorage()) {
  try {
    storage?.setItem(`${STORAGE_PREFIX}${userId}`, releaseId);
  } catch { /* A blocked store only means the panel can show again. */ }
}

function safeStorage() {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * "show": open the panel. "skip": remember this version without showing it
 * (the account joined after it shipped). "none": already seen.
 */
export function whatsNewDecision({ seenId, dateJoined, release = WHATS_NEW }) {
  if (seenId === release.id) return "none";
  const joined = Date.parse(dateJoined || "");
  const shipped = Date.parse(`${release.date}T00:00:00Z`);
  if (Number.isFinite(joined) && joined >= shipped) return "skip";
  return "show";
}

/** Items marked with an audience are shown only to that audience. */
export function releaseItemsFor(release, user) {
  const dentistry = String(user?.cohort?.program?.code || "").startsWith("dentistry-");
  return release.items.filter((item) => !item.audience || (item.audience === "dentistry" && dentistry));
}

export function whatsNewText(value, locale) {
  return value?.[locale === "ar" ? "ar" : "en"] || value?.en || "";
}

const MAX_ITEMS = 8;
const MAX_TEXT = 400;

function cleanText(value) {
  return typeof value === "string" ? value.trim().slice(0, MAX_TEXT) : "";
}

function cleanLocalized(value) {
  const en = cleanText(value?.en);
  return en ? { en, ar: cleanText(value?.ar) || en } : null;
}

/** Validates notes that came over the network; returns null if unusable. */
export function normalizeRelease(raw) {
  const id = cleanText(raw?.id);
  const version = cleanText(raw?.version);
  const summary = cleanLocalized(raw?.summary);
  if (!id || !version || !summary || !Array.isArray(raw?.items)) return null;
  const items = raw.items.slice(0, MAX_ITEMS).flatMap((item) => {
    const title = cleanLocalized(item?.title);
    const body = cleanLocalized(item?.body);
    const audience = item?.audience === "dentistry" ? "dentistry" : "";
    return title && body ? [{ icon: cleanText(item?.icon) || "sparkles", ...(audience ? { audience } : {}), title, body }] : [];
  });
  return items.length ? { id, version, date: cleanText(raw.date), summary, items } : null;
}

/**
 * The notes of the build that is waiting to install. The running app cannot
 * know them, so it asks the server; the file is never cached or precached.
 */
export async function fetchPendingRelease(url, fetchImpl = globalThis.fetch) {
  try {
    const response = await fetchImpl(url, { cache: "no-store", credentials: "omit" });
    if (!response.ok) return null;
    const release = normalizeRelease(await response.json());
    return release && release.id !== WHATS_NEW.id ? release : null;
  } catch {
    return null;
  }
}
