/**
 * The release notes for this build. To announce an update, bump `version` here
 * and in package.json, set `id` and `date`, and rewrite `summary` and `items`.
 * The same data is shown twice: before the update (fetched from the server as
 * release-notes.json by the app that is still running the old build) and after
 * it (bundled, shown once per account). Accounts created on or after `date`
 * already start on this version, so they are not shown the after-update panel.
 */
export const WHATS_NEW = {
  id: "0.1.1",
  version: "0.1.1",
  date: "2026-10-08",
  summary: {
    en: "My sheets, Practice, search and hide-to-recall in Focus, tabs and whiteboards, installment plans and suggestions.",
    ar: "شيتاتي، وتدرّب، والبحث والإخفاء للتذكّر في التركيز، والتبويبات والسبورات، وخطط الأقساط، والاقتراحات."
  },
  items: [
    {
      icon: "folder",
      title: { en: "My sheets", ar: "شيتاتي" },
      body: {
        en: "Add your own PDFs inside any subject. Only you can see them, and what you write on them follows you to every device.",
        ar: "أضف ملفات PDF خاصة بك داخل أي مادة. لا يراها غيرك، وتظهر كتابتك عليها على كل أجهزتك."
      }
    },
    {
      icon: "image",
      title: { en: "Practice: name the picture", ar: "تدرّب: سمِّ الصورة" },
      body: {
        en: "See a slide and type its name. Missed slides come back for review, a hint gives the first letter, and every correct name earns XP.",
        ar: "شاهد الشريحة واكتب اسمها. ترجع إليك الشرائح التي أخطأت فيها للمراجعة، وتعطيك الإشارة أول حرف، وكل اسم صحيح يكسبك نقاط خبرة."
      }
    },
    {
      icon: "search",
      title: { en: "Search and hide to recall", ar: "بحث وإخفاء للتذكّر" },
      body: {
        en: "Search inside any document in Focus, jump to the page, or cover a term to test yourself. Tap a cover to reveal it.",
        ar: "ابحث داخل أي مستند في وضع التركيز وانتقل إلى صفحته، أو غطِّ مصطلحًا لتختبر نفسك. اضغط على الغطاء لتكشفه."
      }
    },
    {
      icon: "layers",
      title: { en: "Tabs and whiteboards", ar: "تبويبات وسبورات" },
      body: {
        en: "Keep several documents open in tabs, and add a lined whiteboard for your own notes. Whiteboards are saved on this device.",
        ar: "افتح عدة مستندات في تبويبات، وأضف سبورة مسطّرة لملاحظاتك. تُحفظ السبورات على هذا الجهاز."
      }
    },
    {
      icon: "coins",
      title: { en: "Pay in installments", ar: "الدفع على أقساط" },
      body: {
        en: "Where a plan offers it, you can pay for a term in installments from the Subscription page. The terms and refund policy are now one tap away.",
        ar: "حيث تتوفر الخطة، يمكنك دفع قيمة الفصل على أقساط من صفحة الاشتراك. وأصبحت الشروط وسياسة الاسترداد على بعد ضغطة واحدة."
      }
    },
    {
      icon: "megaphone",
      title: { en: "Tell us what to build", ar: "اقترح علينا" },
      body: {
        en: "Send suggestions from Settings and follow what happens to each one.",
        ar: "أرسل اقتراحاتك من الإعدادات وتابع ما يحدث لكل اقتراح."
      }
    }
  ]
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
    return title && body ? [{ icon: cleanText(item?.icon) || "sparkles", title, body }] : [];
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
