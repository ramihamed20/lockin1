import { useRef, useState } from "react";
import { catalogWorkspaceApi } from "../api/catalogWorkspace.js";
import { useAsyncData } from "./useAsyncData.js";
import { isOfflinePdfUrl } from "../offline/pdfUrl.js";
import { resolveSheet, resolveSummary } from "../offline/resolver.js";
import { loadReaderDocument } from "../offline/readerDocument.js";

const documentCache = new Map();

function documentKey(materialSlug, sheetSlug, view = "", ownerKey = "") {
  return `${ownerKey}|${materialSlug}|${sheetSlug}|${view}`;
}

function loadCatalogDocument(materialSlug, sheetSlug, view = "", ownerKey = "", onRefresh) {
  const key = documentKey(materialSlug, sheetSlug, view, ownerKey);
  const online = () => {
    if (documentCache.has(key)) return documentCache.get(key);
    const promise = catalogWorkspaceApi.resolve(materialSlug, sheetSlug, { view })
      .finally(() => { if (documentCache.get(key) === promise) documentCache.delete(key); });
    documentCache.set(key, promise);
    return promise;
  };
  // Keep the old offline-only fallback for a cold start that is already down.
  const network = () => (view === "summary"
    ? resolveSummary(ownerKey, materialSlug, sheetSlug, online)
    : resolveSheet(ownerKey, materialSlug, sheetSlug, online));
  return loadReaderDocument(ownerKey, { materialSlug, sheetSlug, view: view === "summary" ? "summary" : "study" }, network, onRefresh);
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
 * @returns {{ id: string, versionId: string, fileId: string, offline: boolean, viewUrl: string, checksum: string } | null}
 */
export function parseCatalogDocument(payload) {
  const document = payload && typeof payload === "object" ? /** @type {any} */ (payload).document : null;
  if (
    !document
    || !UUID_PATTERN.test(String(document.id))
    || !UUID_PATTERN.test(String(document.document_version_id))
    || !(VIEW_URL_PATTERN.test(String(document.view_url)) || (document.offline === true && isOfflinePdfUrl(document.view_url)))
  ) {
    return null;
  }
  return { id: document.id, versionId: document.document_version_id, fileId: String(document.file_id || ""), offline: document.offline === true, viewUrl: document.view_url, checksum: String(document.checksum_sha256 || "") };
}

/**
 * Resolves a catalog sheet to the server document behind it: the protected PDF
 * and the identifiers its workspace state and annotations are stored under.
 * @param {string} materialSlug
 * @param {string} sheetSlug
 * @param {string} [view] "summary" opens that document's Sheet Summary instead.
 */
export function useCatalogDocument(materialSlug, sheetSlug, view = "", ownerKey = "") {
  const key = documentKey(materialSlug, sheetSlug, view, ownerKey);
  const generation = useRef(0);
  const [fresh, setFresh] = useState(null);
  const result = useAsyncData(
    async (signal) => {
      const run = ++generation.current;
      const onRefresh = (value) => {
        if (!signal?.aborted && generation.current === run) setFresh({ key, run, ...value });
      };
      const payload = materialSlug && sheetSlug ? await loadCatalogDocument(materialSlug, sheetSlug, view, ownerKey, onRefresh) : null;
      return { key, run, payload };
    },
    [materialSlug, sheetSlug, view, ownerKey]
  );
  const current = result.data?.key === key ? result.data : null;
  const refreshed = fresh?.key === key && fresh?.run === current?.run ? fresh : null;
  const payload = refreshed ? refreshed.payload : current?.payload;
  return {
    document: result.loading ? null : parseCatalogDocument(payload),
    loading: result.loading || (!result.error && !current),
    error: refreshed?.error?.message || result.error,
    reload: () => {
      documentCache.delete(key);
      result.reload();
    }
  };
}
