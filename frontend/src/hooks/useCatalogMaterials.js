import { catalogWorkspaceApi } from "../api/catalogWorkspace.js";
import { getCohortMaterials } from "../lib/materialCatalog.js";
import { useAsyncData } from "./useAsyncData.js";

/**
 * Keeps the existing Catalog presentation immediate, then replaces its local
 * directory with the server-authorized Catalog branches and published sheets.
 * The server is authoritative, so a typed URL cannot turn another cohort's
 * material into an accessible document.
 */
export function useCatalogMaterials(user) {
  const fallback = getCohortMaterials(user);
  const catalog = useAsyncData(
    () => catalogWorkspaceApi.materials(),
    [user?.id || "", user?.cohort?.id || "", user?.cohort?.code || "", user?.cohort?.program?.code || ""]
  );
  return {
    materials: Array.isArray(catalog.data?.results) ? catalog.data.results : fallback,
    loading: catalog.loading,
    error: catalog.error,
    reload: catalog.reload,
  };
}
