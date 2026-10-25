import { findDownloadedPdfItem, readOfflinePdfBytes, storeOpenedPdf } from "./downloads.js";
import { isOfflinePdfUrl, offlinePdfItemId } from "./pdfUrl.js";
import { currentOfflineUserId, captureOfflineSession } from "./sessionScope.js";

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
const authorizations = new Map();

/** A fresh server descriptor may authorize a local read even without an offline lease. */
export function authorizeCachedPdf(userId, url) {
  const assertCurrent = captureOfflineSession(userId);
  authorizations.set(`${userId}|${url}`, { assertCurrent, until: Date.now() + 30_000 });
  if (authorizations.size > 100) authorizations.delete(authorizations.keys().next().value);
}

export async function pdfDocumentSource(url, resolveUrl = (value) => value) {
  if (!isOfflinePdfUrl(url)) {
    const owner = currentOfflineUserId();
    const grant = authorizations.get(`${owner}|${url}`);
    const onlineAuthorized = Boolean(grant && grant.until > Date.now() && grant.assertCurrent.isCurrent());
    if (owner) {
      const item = await findDownloadedPdfItem(owner, url).catch(() => null);
      const bytes = item ? await readOfflinePdfBytes(owner, item.id, { onlineAuthorized }).catch(() => null) : null;
      if (bytes) return { data: bytes };
    }
    return { url: resolveUrl(url) };
  }
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

/** The transport is reused for a full durable copy; storage failure never blocks reading. */
export async function rememberOpenedPdf(url, pdfDocument) {
  const userId = currentOfflineUserId();
  if (!userId || isOfflinePdfUrl(url) || !/^\/api\/v1\/files\/[0-9a-f-]+\/view$/i.test(url)) return;
  const assertCurrent = captureOfflineSession(userId);
  const item = await findDownloadedPdfItem(userId, url).catch(() => null);
  if (item && await readOfflinePdfBytes(userId, item.id, { onlineAuthorized: true }).catch(() => null)) return;
  const bytes = await pdfDocument.getData();
  assertCurrent();
  await storeOpenedPdf(userId, url, bytes);
}
