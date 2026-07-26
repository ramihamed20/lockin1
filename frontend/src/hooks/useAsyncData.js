import { useEffect, useState } from "react";

export function useAsyncData(loader, deps = []) {
  const [state, setState] = useState({ loading: true, error: "", data: null });
  const [reloadVersion, setReloadVersion] = useState(0);

  useEffect(() => {
    let active = true;
    setState((prev) => ({ ...prev, loading: true, error: "" }));
    loader()
      .then((data) => {
        if (active) setState({ loading: false, error: "", data });
      })
      .catch((error) => {
        if (active) setState({ loading: false, error: error.message, data: null });
      });
    return () => {
      active = false;
    };
  }, [...deps, reloadVersion]);

  return {
    ...state,
    reload: () => setReloadVersion((current) => current + 1)
  };
}
