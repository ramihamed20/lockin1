import { useCallback, useEffect, useState } from "react";
import { normalizeUserError } from "../lib/errors.js";

/**
 * Load data for the lifetime of a component.
 *
 * The loader is given an `AbortSignal`. Pass it to `request` and the transport
 * is cancelled when the component unmounts or the dependencies change, instead
 * of running to completion against a result nobody will read. A loader that
 * ignores the signal still behaves exactly as before -- the stale result is
 * discarded, it is just not cancelled.
 *
 * Only reads belong here. A loader that performs a write should not be
 * cancelled by a navigation, because the write may already have happened on the
 * server; those calls own their own lifetime and do not pass this signal.
 *
 * @param {(signal: AbortSignal) => Promise<any>} loader
 * @param {unknown[]} deps
 */
export function useAsyncData(loader, deps = []) {
  const [state, setState] = useState({ loading: true, error: "", data: null });
  const [reloadVersion, setReloadVersion] = useState(0);

  /* eslint-disable react-hooks/exhaustive-deps -- callers provide the loader's semantic dependency list */
  useEffect(() => {
    let active = true;
    const controller = typeof AbortController === "undefined" ? null : new AbortController();
    setState((prev) => ({ ...prev, loading: true, error: "" }));
    Promise.resolve()
      .then(() => loader(controller?.signal))
      .then((data) => {
        if (active) setState({ loading: false, error: "", data });
      })
      .catch((error) => {
        // A cancelled request is not a failure the reader should see: it was
        // this hook that cancelled it, and whatever replaced it owns the screen.
        if (!active || error?.code === "aborted" || error?.name === "AbortError") return;
        setState({
          loading: false,
          error: normalizeUserError(error?.message, "This information could not be loaded."),
          data: null
        });
      });
    return () => {
      active = false;
      controller?.abort();
    };
  }, [...deps, reloadVersion]);
  /* eslint-enable react-hooks/exhaustive-deps */

  const reload = useCallback(() => setReloadVersion((current) => current + 1), []);

  return {
    ...state,
    reload
  };
}
