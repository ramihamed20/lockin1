import { useCallback, useEffect, useState } from "react";
import { normalizeUserError } from "../lib/errors.js";

export function useAsyncData(loader, deps = []) {
  const [state, setState] = useState({ loading: true, error: "", data: null });
  const [reloadVersion, setReloadVersion] = useState(0);

  /* eslint-disable react-hooks/exhaustive-deps -- callers provide the loader's semantic dependency list */
  useEffect(() => {
    let active = true;
    setState((prev) => ({ ...prev, loading: true, error: "" }));
    Promise.resolve()
      .then(() => loader())
      .then((data) => {
        if (active) setState({ loading: false, error: "", data });
      })
      .catch((error) => {
        if (active) {
          setState({
            loading: false,
            error: normalizeUserError(error?.message, "This information could not be loaded."),
            data: null
          });
        }
      });
    return () => {
      active = false;
    };
  }, [...deps, reloadVersion]);
  /* eslint-enable react-hooks/exhaustive-deps */

  const reload = useCallback(() => setReloadVersion((current) => current + 1), []);

  return {
    ...state,
    reload
  };
}
