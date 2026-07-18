import { useEffect, useState } from "react";

import { operationsApi } from "./api";

export function useOperationalAccess(): boolean | null {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void operationsApi.session(controller.signal)
      .then(() => setAllowed(true))
      .catch(() => {
        if (!controller.signal.aborted) setAllowed(false);
      });
    return () => controller.abort();
  }, []);
  return allowed;
}
