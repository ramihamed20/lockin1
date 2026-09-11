import { catalogWorkspaceApi } from "../api/catalogWorkspace.js";
import { useAsyncData } from "./useAsyncData.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Only a same-origin managed-file view, which Django authorizes per request.
const VIEW_URL_PATTERN = /^\/api\/v1\/files\/[0-9a-f-]+\/view$/i;

/**
 * @param {unknown} payload
 * @returns {{ id: string, versionId: string, viewUrl: string } | null}
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
  return { id: document.id, versionId: document.document_version_id, viewUrl: document.view_url };
}

/**
 * Resolves a catalog sheet to the server document behind it: the protected PDF
 * and the identifiers its workspace state and annotations are stored under.
 * @param {string} materialSlug
 * @param {string} sheetSlug
 */
export function useCatalogDocument(materialSlug, sheetSlug) {
  const result = useAsyncData(
    (signal) => (materialSlug && sheetSlug ? catalogWorkspaceApi.resolve(materialSlug, sheetSlug, { signal }) : Promise.resolve(null)),
    [materialSlug, sheetSlug]
  );
  // useAsyncData keeps the previous result while reloading; after a sheet change
  // that would be the previous sheet's document, and its sync would receive this
  // sheet's work. Nothing is reported until the current sheet has resolved.
  return {
    document: result.loading ? null : parseCatalogDocument(result.data),
    loading: result.loading,
    error: result.error,
    reload: result.reload
  };
}
