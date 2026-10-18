import { ApiError, request } from "./client.js";
import { uploadWithProgress } from "./personalSheets.js";

export const ANNOTATION_SHARE_MAX_BYTES = 25 * 1024 * 1024;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function base(documentId) {
  return `/catalog/documents/${encodeURIComponent(documentId)}/annotation-shares`;
}

/**
 * @typedef {{
 *   id: string, author: string, anonymous: boolean, mine: boolean, note: string,
 *   likes: number, liked: boolean, marks: number, pages: number, version: number,
 *   sizeBytes: number, updatedAt: string, basedOn: string, copiedVersion: number | null,
 *   ownerEmail?: string, reports?: number
 * }} SharedMarks
 */

/** @returns {SharedMarks | null} */
export function parseShare(value) {
  if (!value || typeof value !== "object" || !UUID_PATTERN.test(String(value.id))) return null;
  return {
    id: String(value.id),
    author: String(value.author || ""),
    anonymous: value.anonymous === true,
    mine: value.mine === true,
    note: String(value.note || ""),
    likes: Math.max(0, Number(value.likes) || 0),
    liked: value.liked === true,
    marks: Math.max(0, Number(value.marks) || 0),
    pages: Math.max(0, Number(value.pages) || 0),
    version: Math.max(1, Number(value.version) || 1),
    sizeBytes: Math.max(0, Number(value.size_bytes) || 0),
    updatedAt: String(value.updated_at || ""),
    basedOn: String(value.based_on || ""),
    copiedVersion: Number.isFinite(Number(value.copied_version)) && value.copied_version !== null ? Number(value.copied_version) : null,
    ...(typeof value.owner_email === "string" ? { ownerEmail: value.owner_email, reports: Math.max(0, Number(value.reports) || 0) } : {})
  };
}

export const annotationSharesApi = {
  /** @param {string} documentId @param {{ q?: string, signal?: AbortSignal }} [options] */
  async list(documentId, { q = "", signal } = {}) {
    const query = q.trim() ? `?q=${encodeURIComponent(q.trim())}` : "";
    const payload = await request(`${base(documentId)}${query}`, { signal });
    return {
      shares: (Array.isArray(payload?.results) ? payload.results : []).map(parseShare).filter(Boolean),
      mineId: UUID_PATTERN.test(String(payload?.mine_id)) ? String(payload.mine_id) : "",
      moderator: payload?.moderator === true,
      limits: {
        maxBytes: Number(payload?.limits?.max_bytes) || ANNOTATION_SHARE_MAX_BYTES,
        copiesUsed: Math.max(0, Number(payload?.limits?.copies_used) || 0),
        copiesMax: Math.max(1, Number(payload?.limits?.copies_max) || 20)
      }
    };
  },
  /**
   * @param {string} documentId
   * @param {{ displayName: string, anonymous: boolean, note: string, snapshot: File, basedOn?: string }} input
   * @param {{ onProgress?: (fraction: number) => void, signal?: AbortSignal }} [options]
   */
  async publish(documentId, { displayName, anonymous, note, snapshot, basedOn = "" }, options = {}) {
    const body = new FormData();
    body.append("display_name", displayName);
    body.append("anonymous", anonymous ? "true" : "false");
    body.append("note", note);
    if (basedOn) body.append("based_on", basedOn);
    body.append("snapshot", snapshot);
    const payload = await uploadWithProgress(base(documentId), body, options);
    if (!UUID_PATTERN.test(String(payload?.id))) throw new ApiError(0, payload, "The upload response was incomplete.");
    return { id: String(payload.id), version: Number(payload.version) || 1, created: payload.created === true, marks: Number(payload.marks) || 0, pages: Number(payload.pages) || 0 };
  },
  /** @param {string} documentId @param {string} shareId @param {{ signal?: AbortSignal }} [options] */
  async detail(documentId, shareId, { signal } = {}) {
    const payload = await request(`${base(documentId)}/${encodeURIComponent(shareId)}`, { signal });
    return {
      id: String(payload?.id || shareId),
      author: String(payload?.author || ""),
      note: String(payload?.note || ""),
      version: Number(payload?.version) || 1,
      marks: Number(payload?.marks) || 0,
      pages: (Array.isArray(payload?.pages) ? payload.pages : []).map((page) => ({
        key: Number(page.key), kind: page.kind === "added" ? "added" : "pdf", page: Number(page.page) || 1,
        marks: Number(page.marks) || 0, background: String(page.background || "")
      })).filter((page) => Number.isSafeInteger(page.key))
    };
  },
  async remove(documentId, shareId) {
    await request(`${base(documentId)}/${encodeURIComponent(shareId)}`, { method: "DELETE" });
  },
  async like(documentId, shareId, liked) {
    const payload = await request(`${base(documentId)}/${encodeURIComponent(shareId)}/like`, { method: liked ? "PUT" : "DELETE" });
    return { liked: payload?.liked === true, likes: Math.max(0, Number(payload?.likes) || 0) };
  },
  async report(documentId, shareId, reason = "") {
    await request(`${base(documentId)}/${encodeURIComponent(shareId)}/report`, { method: "POST", body: { reason } });
  },
  /** @param {string[] | number[] | null} pages null copies every page */
  async copy(documentId, shareId, pages = null) {
    const payload = await request(`${base(documentId)}/${encodeURIComponent(shareId)}/import`, { method: "POST", body: { pages } });
    if (!UUID_PATTERN.test(String(payload?.sheet_id))) throw new ApiError(0, payload, "The copy response was incomplete.");
    return { sheetId: String(payload.sheet_id), subject: String(payload.subject || ""), title: String(payload.title || "") };
  },
  /** @param {string} documentId @param {{ signal?: AbortSignal }} [options] */
  /** The student's own copies of other students' marks on this sheet.
   * @param {string} documentId @param {{ signal?: AbortSignal }} [options] */
  async copies(documentId, { signal } = {}) {
    const payload = await request(`/catalog/documents/${encodeURIComponent(documentId)}/annotation-copies`, { signal });
    return (Array.isArray(payload?.results) ? payload.results : [])
      .filter((item) => UUID_PATTERN.test(String(item?.id)))
      .map((item) => ({
        id: String(item.id), title: String(item.title || ""), author: String(item.author || ""),
        shareId: UUID_PATTERN.test(String(item.share_id)) ? String(item.share_id) : "", createdAt: String(item.created_at || "")
      }));
  },
  /** @param {string} documentId @param {{ signal?: AbortSignal }} [options] */
  async notices(documentId, { signal } = {}) {
    const payload = await request(`${base(documentId)}/notices`, { signal });
    return (Array.isArray(payload?.results) ? payload.results : [])
      .filter((item) => UUID_PATTERN.test(String(item?.id)) && ["updated", "removed"].includes(item.kind))
      .map((item) => ({ id: String(item.id), kind: item.kind, author: String(item.author || ""), version: Number(item.version) || 1 }));
  },
  async dismiss(documentId, shareId) {
    await request(`${base(documentId)}/${encodeURIComponent(shareId)}/dismiss`, { method: "POST", body: {} });
  }
};

/** A copy tells the server its starting marks are now stored on the device. */
export function markCopySeeded(sheetId) {
  return request(`/personal-sheets/${encodeURIComponent(sheetId)}/seeded`, { method: "POST", body: {} });
}
