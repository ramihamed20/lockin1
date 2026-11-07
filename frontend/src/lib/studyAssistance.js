const KINDS = new Set(["understand", "memory", "organize", "fact", "simplify", "connection"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TEXT_FIELDS = ["teaser", "question", "explanation"];

export function normalizeAssistanceIdea(value) {
  if (!value || typeof value !== "object" || !UUID.test(value.id || "")) return null;
  if (!KINDS.has(value.kind) || !TEXT_FIELDS.every((key) => typeof value[key] === "string" && value[key].trim())) return null;
  if (value.page !== null && (!Number.isInteger(value.page) || value.page < 1)) return null;
  const followup_question = value.followup_question || "";
  const followup_answer = value.followup_answer || "";
  if (typeof followup_question !== "string" || typeof followup_answer !== "string" || Boolean(followup_question.trim()) !== Boolean(followup_answer.trim())) return null;
  return { ...value, followup_question, followup_answer, saved: value.saved === true };
}

export function assistanceForPage(rows, page, start = 1, end = Infinity) {
  if (!Number.isInteger(page) || page < 1 || page < start || page > end) return [];
  return (Array.isArray(rows) ? rows : [])
    .map(normalizeAssistanceIdea)
    .filter((row) => row && (row.page === null || row.page === page))
    // Show reviewed help for the current PDF page before sheet-wide guidance.
    // Stable sorting preserves the author's position within each group.
    .sort((a, b) => Number(b.page === page) - Number(a.page === page));
}

export function savedAssistanceForRange(rows, start = 1, end = Infinity) {
  return (Array.isArray(rows) ? rows : [])
    .map(normalizeAssistanceIdea)
    .filter((row) => row && row.saved && (row.page === null || (row.page >= start && row.page <= end)));
}

export function assistanceScopeKey(userId, documentId, edition, view, versionId, page) {
  return JSON.stringify([userId, documentId, edition, view, versionId, page]);
}

export function companionPreferenceKey(userId) {
  return userId ? "lock-in.study-companion.v1:" + encodeURIComponent(userId) : "";
}

export function companionPreferences(value) {
  return {
    character: value?.character === "girl" ? "girl" : "boy",
    motion: value?.motion !== false,
    hidden: value?.hidden === true,
    // New phone sessions add the companion from the workspace + menu.
    phoneAdded: value?.phoneAdded === true,
    position: Number.isFinite(value?.position?.x) && Number.isFinite(value?.position?.y)
      ? {
        x: Math.min(1, Math.max(0, value.position.x)),
        y: Math.min(1, Math.max(0, value.position.y))
      }
      : null
  };
}

export function readCompanionPreferences(userId) {
  try {
    const key = companionPreferenceKey(userId);
    return companionPreferences(key ? JSON.parse(localStorage.getItem(key) || "null") : null);
  } catch {
    return companionPreferences(null);
  }
}

export function saveCompanionPreferences(userId, value) {
  try {
    const key = companionPreferenceKey(userId);
    if (key) {
      const preferences = companionPreferences(value);
      const serialized = JSON.stringify(preferences);
      if (localStorage.getItem(key) === serialized) return;
      localStorage.setItem(key, serialized);
      window.dispatchEvent(new window.CustomEvent("lockin:companion-preferences", { detail: { userId, preferences } }));
    }
  } catch { /* Reader help still works when preference storage is unavailable. */ }
}

export function writingGraphemes(text) {
  const value = String(text || "");
  return typeof Intl.Segmenter === "function"
    ? [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value)].map((part) => part.segment)
    : Array.from(value);
}

export function writingDuration(length) {
  return Math.min(4800, Math.max(400, length * 13));
}
