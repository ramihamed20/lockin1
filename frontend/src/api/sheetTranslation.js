import { request } from "./client.js";

export function parseTranslation(payload, page) {
  if (!payload || payload.page !== page || payload.target_language !== "ar"
      || !["ready", "unavailable"].includes(payload.status) || typeof payload.source_text !== "string"
      || typeof payload.translated_text !== "string") throw new Error("Invalid translation response.");
  return payload;
}
export async function getSheetTranslation(documentId, page, signal) {
  return parseTranslation(await request(`/catalog/documents/${encodeURIComponent(documentId)}/translation?page=${page}`, { signal }), page);
}
function adminPayload(payload) {
  if (!payload || !Array.isArray(payload.pages) || !Number.isInteger(payload.page_count)
      || payload.page_count < 1 || typeof payload.file_id !== "string"
      || typeof payload.checksum !== "string") throw new Error("Invalid translations response.");
  return payload;
}
export const sheetTranslationAdminApi = {
  async load(sheetId, edition, signal) {
    return adminPayload(await request(`/operations/admin/content/sheets/${encodeURIComponent(sheetId)}/translations?edition=${encodeURIComponent(edition)}`, { signal }));
  },
  async save(sheetId, edition, body) {
    return adminPayload(await request(`/operations/admin/content/sheets/${encodeURIComponent(sheetId)}/translations?edition=${encodeURIComponent(edition)}`, { method: "PUT", body }));
  }
};
