import { catalogWorkspaceApi } from "../api/catalogWorkspace.js";
import { useAsyncData } from "./useAsyncData.js";

const documentCache = new Map();

function documentKey(materialSlug, sheetSlug, view = "", ownerKey = "") {
  return `${ownerKey}|${materialSlug}|${sheetSlug}|${view}`;
}

function loadCatalogDocument(materialSlug, sheetSlug, view = "", ownerKey = "") {
  const key = documentKey(materialSlug, sheetSlug, view, ownerKey);
  if (documentCache.has(key)) return documentCache.get(key);
  const promise = catalogWorkspaceApi.resolve(materialSlug, sheetSlug, { view })
    .catch((error) => {
      documentCache.delete(key);
      throw error;
    });
  documentCache.set(key, promise);
  return promise;
}

export function preloadCatalogDocument(materialSlug, sheetSlug, view = "", ownerKey = "") {
  if (!materialSlug || !sheetSlug) return Promise.resolve(undefined);
  return loadCatalogDocument(materialSlug, sheetSlug, view, ownerKey).catch(() => undefined);
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Only a same-origin managed-file view, which Django authorizes per request.
const VIEW_URL_PATTERN = /^\/api\/v1\/files\/[0-9a-f-]+\/view$/i;

/**
 * @param {unknown} payload
 * @returns {{ id: string, versionId: string, viewUrl: string, checksum: string } | null}
 */
export function parseCatalogDocument(payload) {
  const document = payload && typeof payload === "object" ? /** @type {any} */ (payload).document : null;
  if (
    !document
    || !UUID_PATTERN.test(String(document.id))
    || !UUID_PATTERN.test(String(document.document_version_id))
    || !VIEW_URL_PATTERN.test(String(document.view_url))
  ) {
    return null;
  }
  return { id: document.id, versionId: document.document_version_id, viewUrl: document.view_url, checksum: String(document.checksum_sha256 || "") };
}

/**
 * Resolves a catalog sheet to the server document behind it: the protected PDF
 * and the identifiers its workspace state and annotations are stored under.
 * @param {string} materialSlug
 * @param {string} sheetSlug
 * @param {string} [view] "summary" opens that document's Sheet Summary instead.
 */
export function useCatalogDocument(materialSlug, sheetSlug, view = "", ownerKey = "") {
  const result = useAsyncData(
    () => (materialSlug && sheetSlug ? loadCatalogDocument(materialSlug, sheetSlug, view, ownerKey) : Promise.resolve(null)),
    [materialSlug, sheetSlug, view, ownerKey]
  );
  // useAsyncData keeps the previous result while reloading; after a sheet change
  // that would be the previous sheet's document, and its sync would receive this
  // sheet's work. Nothing is reported until the current sheet has resolved.
  return {
    document: result.loading ? null : parseCatalogDocument(result.data),
    loading: result.loading,
    error: result.error,
    reload: () => {
      documentCache.delete(documentKey(materialSlug, sheetSlug, view, ownerKey));
      result.reload();
    }
  };
}
