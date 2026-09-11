import { catalogWorkspaceApi } from "../api/catalogWorkspace.js";
import { getCohortMaterials, withE2eFixtureSheets } from "../lib/materialCatalog.js";
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
    // The e2e build's fixture sheets join the server's list as well, since the
    // reader specs' mocked server publishes none. A no-op in every other build.
    materials: Array.isArray(catalog.data?.results) ? withE2eFixtureSheets(catalog.data.results) : fallback,
    loading: catalog.loading,
    error: catalog.error,
    reload: catalog.reload,
  };
}
