import { resolveOfflineDocument } from "./documents.js";
import { offlineAccessStatus } from "./lease.js";
import { readDownloadMetadata, setStoredPdfAccess } from "./downloads.js";
import { offlinePdfItemId } from "./pdfUrl.js";
import { authorizeCachedPdf } from "./pdfSource.js";
import { captureOfflineSession } from "./sessionScope.js";

/**
 * Local-first applies only to reader descriptors, never graded question APIs.
 * @param {string} userId
 * @param {{materialSlug: string, sheetSlug: string, view?: string}} coordinates
 * @param {() => Promise<any>} online
 * @param {(result: {payload?: any, error?: any}) => void} [onRefresh]
 */
export async function loadReaderDocument(userId, coordinates, online, onRefresh = () => {}) {
  const assertCurrent = userId ? captureOfflineSession(userId) : () => {};
  let local = null;
  if (userId && (await offlineAccessStatus(userId).catch(() => ({ available: false }))).available) {
    local = await resolveOfflineDocument(userId, coordinates).catch(() => null);
    if (local) {
      const stored = await readDownloadMetadata(userId, offlinePdfItemId(local.document.view_url));
      if (stored?.download_url) local = { document: { ...local.document, view_url: stored.download_url } };
      else local = null;
    }
  }
  assertCurrent();
  const verify = async () => {
    const payload = await online();
    assertCurrent();
    if (payload?.document?.offline && local) return local;
    const url = payload?.document?.view_url;
    if (userId && !payload?.document?.offline && /^\/api\/v1\/files\/[0-9a-f-]+\/view$/i.test(url || "")) {
      await setStoredPdfAccess(userId, url, true).catch(() => undefined);
      assertCurrent();
      authorizeCachedPdf(userId, url);
    }
    return payload;
  };
  if (!local) return verify();
  // Do not wait for this request before showing the lease-authorized copy.
  void verify().then((payload) => onRefresh({ payload })).catch(async (error) => {
    if (![401, 403, 404].includes(error?.status)) return;
    try {
      assertCurrent();
      await setStoredPdfAccess(userId, local.document.view_url, false).catch(() => undefined);
      assertCurrent();
      onRefresh({ error });
    } catch { /* An obsolete login cannot update the current reader. */ }
  });
  return local;
}
