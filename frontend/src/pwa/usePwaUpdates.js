import { useSyncExternalStore } from "react";
import { pwaUpdates } from "./updateManager.js";

/**
 * The shared update state. The global prompt and Settings both read this; no
 * component registers or checks the service worker itself.
 */
export function usePwaUpdates() {
  const snapshot = useSyncExternalStore(pwaUpdates.subscribe, pwaUpdates.getSnapshot, pwaUpdates.getSnapshot);
  return {
    ...snapshot,
    checkForUpdates: () => pwaUpdates.check({ manual: true }),
    applyUpdate: () => pwaUpdates.applyUpdate(),
    dismiss: () => pwaUpdates.dismiss()
  };
}
