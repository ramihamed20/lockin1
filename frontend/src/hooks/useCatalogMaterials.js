import { useCallback, useEffect, useRef, useState } from "react";
import { catalogWorkspaceApi } from "../api/catalogWorkspace.js";
import { normalizeUserError } from "../lib/errors.js";
import { withE2eFixtureSheets } from "../lib/materialCatalog.js";

/* global __E2E_CATALOG_MATERIALS__ */
// The E2E bundle is deliberately a separate, non-deployable artifact. Its
// Focus specs mock only the protected document endpoint and provide sheets at
// build time, so a deliberately unused /catalog/materials request must not
// hide those fixtures behind a production error screen.
const E2E_FIXTURE_BUILD = typeof __E2E_CATALOG_MATERIALS__ === "object";

/**
 * One directory, shared by every screen that needs it.
 *
 * Four components read this list on the way from Materials to an open sheet,
 * and each used to issue its own request and start again from "nothing loaded".
 * That is what made a correct route show "not found" for a moment and a correct
 * catalogue show "no materials" for a second or two. The entry below is keyed by
 * the enrolment the list belongs to, so navigating between those screens is a
 * cache read and the subject list never blinks out.
 *
 * `loading` and `error` are part of the result on purpose. Every caller has to
 * distinguish "this student has no subjects" from "the list has not arrived",
 * because rendering the second as the first is exactly how a transient failure
 * turned into a page that told students their subjects were gone.
 *
 * @type {Map<string, {promise: Promise<any>, data: any[]|null, error: string}>}
 */
const cache = new Map();

function cacheKey(user) {
  return [
    user?.id || "",
    user?.cohort?.id || "",
    user?.cohort?.code || "",
    user?.cohort?.program?.code || ""
  ].join("|");
}

function normalize(payload) {
  // The e2e build's fixture sheets join the server's list, since the reader
  // specs' mocked server publishes none. A no-op in every other build.
  return withE2eFixtureSheets(Array.isArray(payload?.results) ? payload.results : []);
}

function load(key) {
  const cached = cache.get(key);
  if (cached) return cached;
  const entry = { promise: null, data: null, error: "" };
  entry.promise = catalogWorkspaceApi.materials()
    .then((payload) => {
      entry.data = normalize(payload);
      return entry.data;
    })
    .catch((error) => {
      // A failed list is not cached as a result: the next screen, or a retry,
      // must be free to ask again rather than inherit the failure.
      cache.delete(key);
      entry.error = normalizeUserError(error?.message, "Your subjects could not be loaded.");
      throw error;
    });
  cache.set(key, entry);
  return entry;
}

/** Drop every cached directory. Exported for tests and for a sign-out. */
export function clearCatalogMaterialsCache() {
  cache.clear();
}

export function useCatalogMaterials(user) {
  const key = cacheKey(user);
  const cached = cache.get(key);
  // A resolved entry is applied on the first render, so a navigation between
  // catalogue screens has no loading frame at all.
  const [state, setState] = useState(() => (
    cached?.data
      ? { loading: false, error: "", materials: cached.data }
      : { loading: true, error: "", materials: [] }
  ));
  const activeKey = useRef(key);

  const run = useCallback((requestedKey) => {
    activeKey.current = requestedKey;
    const entry = load(requestedKey);
    if (entry.data) {
      setState({ loading: false, error: "", materials: entry.data });
      return;
    }
    setState((current) => ({ ...current, loading: true, error: "" }));
    entry.promise
      .then((materials) => {
        if (activeKey.current !== requestedKey) return;
        setState({ loading: false, error: "", materials });
      })
      .catch(() => {
        if (activeKey.current !== requestedKey) return;
        // The e2e build's reader specs publish nothing from their mocked server,
        // so its fixture sheets have to survive the failed list they never used.
        setState({
          loading: false,
          error: entry.error,
          materials: E2E_FIXTURE_BUILD ? withE2eFixtureSheets([]) : []
        });
      });
  }, []);

  useEffect(() => {
    run(key);
    return () => {
      // Stops a result arriving for an enrolment this component no longer shows.
      activeKey.current = "";
    };
  }, [key, run]);

  const reload = useCallback(() => {
    cache.delete(key);
    run(key);
  }, [key, run]);

  return {
    materials: state.materials,
    loading: state.loading,
    error: E2E_FIXTURE_BUILD ? "" : state.error,
    reload
  };
}
