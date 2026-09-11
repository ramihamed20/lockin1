import { catalogWorkspaceApi } from "../api/catalogWorkspace.js";
import { withE2eFixtureSheets } from "../lib/materialCatalog.js";
import { useAsyncData } from "./useAsyncData.js";

/**
 * The server is the only catalog authority. A former local fallback could
 * briefly expose an old route while a freshly published sheet was resolving,
 * then turn that race into a misleading "not found" screen.
 */
export function useCatalogMaterials(user) {
  const catalog = useAsyncData(
    () => catalogWorkspaceApi.materials(),
    [user?.id || "", user?.cohort?.id || "", user?.cohort?.code || "", user?.cohort?.program?.code || ""]
  );
  return {
    // The e2e build's fixture sheets join the server's list as well, since the
    // reader specs' mocked server publishes none. A no-op in every other build.
    materials: withE2eFixtureSheets(Array.isArray(catalog.data?.results) ? catalog.data.results : []),
    loading: catalog.loading,
    error: catalog.error,
    reload: catalog.reload,
  };
}
