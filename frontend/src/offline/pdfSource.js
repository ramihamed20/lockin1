import { findDownloadedPdfItem, readOfflinePdfBytes } from "./downloads.js";
import { isOfflinePdfUrl, offlinePdfItemId } from "./pdfUrl.js";
import { currentOfflineUserId } from "./profile.js";

/**
 * Where the reader's PDF.js document comes from.
 *
 * A downloaded PDF is opened from its stored bytes, read again for every open
 * and passed to PDF.js as data. An object URL would make PDF.js fetch it, and
 * the edge's `connect-src 'self'` blocks a `blob:` fetch, which PDF.js reports
 * as "Unexpected server response (0)".
 */

/**
 * The PDF.js source for a reader URL: stored bytes for a downloaded PDF, the
 * resolved request URL otherwise.
 * @param {string} url
 * @param {(url: string) => string} [resolveUrl]
 * @returns {Promise<{ data: Uint8Array<ArrayBuffer> } | { url: string }>}
 */
export async function pdfDocumentSource(url, resolveUrl = (value) => value) {
  if (!isOfflinePdfUrl(url)) return { url: resolveUrl(url) };
  const userId = currentOfflineUserId();
  const data = userId ? await readOfflinePdfBytes(userId, offlinePdfItemId(url)) : null;
  if (!data) throw new Error("This PDF hasn’t been downloaded for offline use.");
  return { data };
}

/**
 * The downloaded copy of an online PDF, for a load the network failed. A
 * workspace opened online keeps its server URL; when the connection is lost
 * later, reopening it must use the device's copy, as a fresh open would.
 * @param {string} url
 * @returns {Promise<{ data: Uint8Array<ArrayBuffer> } | null>}
 */
export async function downloadedPdfSource(url) {
  const userId = currentOfflineUserId();
  if (!userId || isOfflinePdfUrl(url)) return null;
  const item = await findDownloadedPdfItem(userId, url).catch(() => null);
  const data = item ? await readOfflinePdfBytes(userId, item.id).catch(() => null) : null;
  return data ? { data } : null;
}

/**
 * Whether PDF.js failed to reach the server at all. A server answer (401, 403,
 * 404) or a damaged file is authoritative and must not open a stored copy.
 * PDF.js reports an unreachable server as status 0 or as the fetch error.
 * @param {any} error
 */
export function isPdfNetworkFailure(error) {
  if (["MissingPDFException", "InvalidPDFException", "PasswordException"].includes(error?.name)) return false;
  const status = Number(error?.status);
  if (Number.isFinite(status) && status > 0) return false;
  return status === 0
    || globalThis.navigator?.onLine === false
    || /failed to fetch|load failed|networkerror|network error/i.test(String(error?.message || ""));
}
