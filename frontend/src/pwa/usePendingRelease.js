import { useEffect, useState } from "react";
import { assetPath } from "../lib/utils.js";
import { fetchPendingRelease } from "../lib/whatsNew.js";

/** Undefined while checking, null if no announcement or policy is available. */
export function usePendingRelease(active) {
  const [release, setRelease] = useState(undefined);
  useEffect(() => {
    if (!active) {
      setRelease(undefined);
      return undefined;
    }
    let cancelled = false;
    fetchPendingRelease(assetPath("release-notes.json")).then((next) => {
      if (!cancelled) setRelease(next);
    });
    return () => { cancelled = true; };
  }, [active]);
  return active ? release : undefined;
}
