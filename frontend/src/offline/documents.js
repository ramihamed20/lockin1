import { hasStoredOfflineFile, readOfflineManifest } from "./downloads.js";
import { offlinePdfUrl } from "./pdfUrl.js";

/**
 * A downloaded PDF in the catalog resolver's response shape. Its view URL
 * names the stored item, not an object URL: the reader reads and checks the
 * stored bytes, under the account's lease, each time it opens them.
 */
export async function resolveOfflineDocument(userId, { materialSlug, sheetSlug, view = "study" }) {
  const manifest = await readOfflineManifest(userId).catch(() => null);
  const type = view === "summary" ? "summary" : "sheet";
  const item = manifest?.items?.find((entry) => entry.available && entry.material_slug === materialSlug && entry.sheet_slug === sheetSlug && entry.type === type);
  if (!item || !(await hasStoredOfflineFile(userId, item.id).catch(() => false))) return null;
  return { document: {
    id: item.document_id, document_version_id: item.document_version_id, file_id: item.file_id || /^\/api\/v1\/files\/([0-9a-f-]+)\/view$/i.exec(String(item.download_url))?.[1],
    view_url: offlinePdfUrl(item.id), offline: true
  } };
}
