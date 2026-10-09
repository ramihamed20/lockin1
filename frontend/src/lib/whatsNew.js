/**
 * The release notes for this build. To announce an update, bump `version` here
 * and in package.json, set `id` and `date`, and rewrite `summary` and `items`.
 * The same data is shown twice: before the update (fetched from the server as
 * release-notes.json by the app that is still running the old build) and after
 * it (bundled, shown once per account). Accounts created on or after `date`
 * already start on this version, so they are not shown the after-update panel.
 */
export const WHATS_NEW = {
  id: "0.1.2",
  version: "0.1.2",
  date: "2026-10-09",
  summary: {
    en: "Subscription improvements, a weekly summary, and smoother tabs and whiteboards in Focus.",
    ar: "تحسينات في الاشتراكات، وملخص أسبوعي، وتبويبات وسبورات أسلس في التركيز."
  },
  items: [
    {
      icon: "coins",
      audience: "dentistry",
      title: { en: "Subscription improvements", ar: "تحسينات في الاشتراكات" },
      body: {
        en: "Pre-midterm is now 30 LYD and the full year 80 LYD. If you joined with the 5 LYD offer, it is 25 and 70. Four-month subscribers can continue after the midterm for 20 LYD, or take the full year for 20 LYD. Post-midterm stays 50 LYD.",
        ar: "قبل النصفي صار 30 د.ل والعام الكامل 80 د.ل. وإن اشتركت بعرض 5 دنانير فهما 25 و70. ومشتركو الأربعة أشهر يكملون بعد النصفي بـ20 د.ل، أو يأخذون العام الكامل بـ20 د.ل. وبعد النصفي يبقى 50 د.ل."
      }
    },
    {
      icon: "calendar",
      title: { en: "Your weekly summary", ar: "ملخصك الأسبوعي" },
      body: {
        en: "Each week closes with a summary of your study and a quiz on your mistakes. When it is ready you get a card to open it, and each part has its own PDF.",
        ar: "ينتهي كل أسبوع بملخص لدراستك واختبار على أخطائك. عندما يجهز تصلك بطاقة لفتحه، ولكل جزء ملف PDF خاص به."
      }
    },
    {
      icon: "layers",
      title: { en: "Smoother tabs and whiteboards", ar: "تبويبات وسبورات أسلس" },
      body: {
        en: "Switching between open tabs no longer leaves a blank page, the Add page button on whiteboards is easier to tap, and Neon and Pointer ink fades faster.",
        ar: "التنقل بين التبويبات لم يعد يترك صفحة بيضاء، وزر إضافة صفحة في السبورة أسهل في الضغط، وحبر النيون والمؤشر يختفي أسرع."
      }
    },
    {
      icon: "folder",
      title: { en: "My sheets", ar: "شيتاتي" },
      body: {
        en: "Add your own PDFs inside any subject. Only you can see them, and what you write on them follows you to every device.",
        ar: "أضف ملفات PDF خاصة بك داخل أي مادة. لا يراها غيرك، وتظهر كتابتك عليها على كل أجهزتك."
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
