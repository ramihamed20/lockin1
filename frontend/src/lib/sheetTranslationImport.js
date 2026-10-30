export const TRANSLATION_FORMAT = "lockin_translation_v1";
export const MAX_TRANSLATION_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_TRANSLATION_TEXT = 60000;
function reject(key) { throw new Error(`sheetTranslationAdmin.${key}`); }
export function parseTranslationImport(raw, source) {
  let data;
  try { data = JSON.parse(raw.replace(/^\uFEFF/, "")); } catch { reject("invalidJson"); }
  if (!data || data.format !== TRANSLATION_FORMAT || !Array.isArray(data.pages)
      || data.pages.length < 1 || data.pages.length > 1000) reject("invalidFormat");
  if (data.edition !== source.edition || (data.sheet_id && data.sheet_id !== source.sheet_id)
      || (data.file_id && data.file_id !== source.file_id) || (data.checksum && data.checksum !== source.checksum)) reject("wrongSource");
  const seen = new Set(); let characters = 0;
  const pages = data.pages.map((item) => {
    if (!item || !Number.isInteger(item.page) || item.page < 1 || item.page > source.page_count || seen.has(item.page)) reject("invalidPages");
    seen.add(item.page);
    const original = item.source_text ?? "";
    if (typeof item.text !== "string" || !item.text.trim() || item.text.length > MAX_TRANSLATION_TEXT
        || typeof original !== "string" || original.length > MAX_TRANSLATION_TEXT
        || item.text.includes("\0") || original.includes("\0")) reject("invalidText");
    characters += item.text.length + original.length;
    return { page: item.page, text: item.text.trim(), source_text: original.trim() };
  });
  if (characters > 1_000_000) reject("tooLarge");
  return pages.sort((a, b) => a.page - b.page);
}
export function translationWriteBody(source, pages) {
  const revisions = new Map(source.pages.map((row) => [row.page, row.revision]));
  return { file_id: source.file_id, checksum: source.checksum,
    pages: pages.map((row) => ({ ...row, expected_revision: revisions.get(row.page) || 0 })) };
}
export function translationTemplate(source) {
  return { format: TRANSLATION_FORMAT, sheet_id: source.sheet_id, edition: source.edition,
    file_id: source.file_id, checksum: source.checksum,
    pages: Array.from({ length: source.page_count }, (_, index) => ({ page: index + 1, text: "" })) };
}
