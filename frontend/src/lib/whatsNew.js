/**
 * Release notes shared by the in-app What's New dialog and the PWA update prompt.
 * Keep `version` aligned with package.json. A distinct `id` lets an updated
 * announcement appear once even if an earlier build already used this version.
 * Accounts created on or after `date` start with the updated experience.
 */
export const WHATS_NEW = {
  id: "0.1.5-2026-11-08",
  version: "0.1.5",
  date: "2026-11-08",
  // This build installs when its existing tabs close. Future announced
  // releases can omit this flag and give their notes a new id.
  silentUpdate: true,
  summary: {
    en: "A more connected study experience, with cohort rankings and improvements to reading, planning and review.",
    ar: "تجربة دراسية أكثر ترابطًا، مع ترتيب الطلاب وتحسينات للقراءة والتخطيط والمراجعة."
  },
  items: [
    {
      icon: "trophy",
      title: { en: "Rank Mode — Your cohort ranking", ar: "Rank Mode — ترتيب دفعتك" },
      body: {
        en: "See your position based on XP earned, switch between weekly, monthly and all-time rankings, and control how your name appears.",
        ar: "تابع مركزك بين طلاب دفعتك حسب نقاط XP، واستعرض ترتيبك الأسبوعي والشهري والإجمالي، مع التحكم في ظهور اسمك."
      }
    },
    {
      icon: "layers",
      title: { en: "Split Screen — Study side by side", ar: "Split Screen — شيتاتك جنبًا إلى جنب" },
      body: {
        en: "Open multiple sheets in the same workspace, compare content side by side and adjust the layout to suit your reading.",
        ar: "افتح عدة شيتات في مساحة واحدة، وقارن محتواها بسهولة، وعدّل تقسيم الشاشة بما يناسب دراستك."
      }
    },
    {
      icon: "pencil",
      title: { en: "A more flexible PDF reader", ar: "قارئ PDF أكثر مرونة" },
      body: {
        en: "Smoother writing and highlighting, more accessible tools, and improved zoom and navigation on phones and tablets.",
        ar: "كتابة وتحديد أكثر سلاسة، وأدوات أسهل استخدامًا، وتحسينات للتكبير والتنقل على الهاتف والآيباد."
      }
    },
    {
      icon: "calendar",
      title: { en: "Study Plan — Better organized study", ar: "Study Plan — تنظيم أفضل لدراستك" },
      body: {
        en: "Organize study tasks and prepare around your subjects and exam dates, with additional planning options where available.",
        ar: "نظّم مهامك واستعد للامتحانات وفق المواد والمواعيد، مع خيارات إضافية لتخطيط الدراسة حيثما تتوفر."
      }
    },
    {
      icon: "brain",
      title: { en: "Active Study & Pomodoro", ar: "Active Study وPomodoro" },
      body: {
        en: "Choose your pages and question count in supported sheets, or study with a focus timer before testing what you've read.",
        ar: "حدد الصفحات وعدد الأسئلة في الشيتات المدعومة، أو استخدم مؤقت التركيز ثم اختبر نفسك فيما قرأته."
      }
    },
    {
      icon: "list-checks",
      title: { en: "Review, summaries & reminders", ar: "المراجعة وملخصي والتذكيرات" },
      body: {
        en: "Find summaries more easily, return to your review questions and set optional reminders for study and revision.",
        ar: "اعثر على ملخصاتك بسهولة أكبر، وتابع أسئلة المراجعة، واضبط تذكيرات اختيارية للدراسة والمراجعة."
      }
    },
    {
      icon: "globe",
      title: { en: "Sheet translations", ar: "ترجمة الشيتات" },
      body: {
        en: "Read page-by-page Arabic translations where prepared translations are available, while keeping the original PDF unchanged.",
        ar: "اطّلع على الترجمة العربية صفحة بصفحة للشيتات التي تتوفر لها ترجمة، مع الحفاظ على ملف PDF الأصلي."
      }
    },
    {
      icon: "sparkles",
      title: { en: "Starmo & Starsea — Study companions", ar: "Starmo وStarsea — رفيقا الدراسة" },
      body: {
        en: "Explore concise explanations, helpful facts and memory aids linked to pages of sheets with prepared companion content.",
        ar: "اكتشف شروحات مختصرة ومعلومات وطرق حفظ مرتبطة بصفحات الشيتات التي يتوفر لها محتوى مساعد."
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
  if (release.silentUpdate || seenId === release.id) return "none";
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
  return items.length ? {
    id, version, date: cleanText(raw.date), summary, items,
    silentUpdate: raw.silentUpdate === true
  } : null;
}

/**
 * The notes of the build that is waiting to install. The running app cannot
 * know them, so it asks the server; the file is never cached or precached.
 */
export async function fetchPendingRelease(url, fetchImpl = globalThis.fetch) {
  try {
    const response = await fetchImpl(url, {
      cache: "no-store",
      credentials: "omit",
      signal: globalThis.AbortSignal?.timeout?.(5000)
    });
    if (!response.ok) return null;
    const release = normalizeRelease(await response.json());
    // Silent maintenance builds may intentionally keep the announcement id.
    return release && (release.silentUpdate || release.id !== WHATS_NEW.id) ? release : null;
  } catch {
    return null;
  }
}
