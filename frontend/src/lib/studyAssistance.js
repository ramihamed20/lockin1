const KINDS = new Set(["understand", "memory", "organize"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TEXT_FIELDS = ["teaser", "question", "explanation", "followup_question", "followup_answer"];

export function normalizeAssistanceIdea(value) {
  if (!value || typeof value !== "object" || !UUID.test(value.id || "")) return null;
  if (!KINDS.has(value.kind) || !TEXT_FIELDS.every((key) => typeof value[key] === "string" && value[key].trim())) return null;
  if (value.page !== null && (!Number.isInteger(value.page) || value.page < 1)) return null;
  return { ...value, saved: value.saved === true };
}

export function assistanceForPage(rows, page, start = 1, end = Infinity) {
  if (!Number.isInteger(page) || page < 1 || page < start || page > end) return [];
  return (Array.isArray(rows) ? rows : [])
    .map(normalizeAssistanceIdea)
    .filter((row) => row && (row.page === null || row.page === page));
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
    hidden: value?.hidden === true
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
    if (key) localStorage.setItem(key, JSON.stringify(companionPreferences(value)));
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
