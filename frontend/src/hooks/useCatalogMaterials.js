import { catalogWorkspaceApi } from "../api/catalogWorkspace.js";
import { withE2eFixtureSheets } from "../lib/materialCatalog.js";
import { useAsyncData } from "./useAsyncData.js";

/* global __E2E_CATALOG_MATERIALS__ */
// The E2E bundle is deliberately a separate, non-deployable artifact. Its
// Focus specs mock only the protected document endpoint and provide sheets at
// build time, so a deliberately unused /catalog/materials request must not
// hide those fixtures behind a production error screen.
const E2E_FIXTURE_BUILD = typeof __E2E_CATALOG_MATERIALS__ === "object";

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
    error: E2E_FIXTURE_BUILD ? "" : catalog.error,
    reload: catalog.reload,
  };
}
