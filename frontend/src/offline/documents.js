import { getOfflineBlob, readOfflineManifest } from "./downloads.js";

/**
 * A downloaded PDF in the catalog resolver's response shape. The blob URL is
 * created only after the account's lease and the stored checksum are checked.
 */
export async function resolveOfflineDocument(userId, { materialSlug, sheetSlug, view = "study" }) {
  const manifest = await readOfflineManifest(userId).catch(() => null);
  const type = view === "summary" ? "summary" : "sheet";
  const item = manifest?.items?.find((entry) => entry.material_slug === materialSlug && entry.sheet_slug === sheetSlug && entry.type === type);
  const blob = item ? await getOfflineBlob(userId, item.id).catch(() => null) : null;
  if (!blob) return null;
  return { document: {
    id: item.document_id, document_version_id: item.document_version_id,
    view_url: URL.createObjectURL(blob), offline: true
  } };
}
