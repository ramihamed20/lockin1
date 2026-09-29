/**
 * A downloaded PDF is named by its offline item, not by a URL the browser can
 * fetch. The reader turns this name into the stored bytes when it opens it
 * (see pdfSource.js), so no object URL is created, kept or revoked.
 */
export const OFFLINE_PDF_PREFIX = "lockin-offline-pdf:";

export function offlinePdfUrl(itemId) {
  return `${OFFLINE_PDF_PREFIX}${encodeURIComponent(itemId)}`;
}

export function isOfflinePdfUrl(value) {
  return typeof value === "string" && value.startsWith(OFFLINE_PDF_PREFIX);
}

export function offlinePdfItemId(value) {
  return isOfflinePdfUrl(value) ? decodeURIComponent(value.slice(OFFLINE_PDF_PREFIX.length)) : "";
}
