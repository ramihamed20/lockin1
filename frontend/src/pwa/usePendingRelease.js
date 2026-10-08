import { useEffect, useState } from "react";
import { assetPath } from "../lib/utils.js";
import { fetchPendingRelease } from "../lib/whatsNew.js";

/** The notes of the update that is waiting, or null while none is known. */
export function usePendingRelease(active) {
  const [release, setRelease] = useState(null);
  useEffect(() => {
    if (!active) return undefined;
    let cancelled = false;
    fetchPendingRelease(assetPath("release-notes.json")).then((next) => {
      if (!cancelled) setRelease(next);
    });
    return () => { cancelled = true; };
  }, [active]);
  return active ? release : null;
}
