import { useEffect, useRef } from "react";

const GUARD_KEY = "lockinExitGuard";
let nextToken = 1;

// One popstate dispatcher for every guard. A guard that ends removes its
// history entry with `history.back()`, and that navigation must never be read
// as the reader pressing Back -- not even by a guard that opened a moment later.
let releasesInFlight = 0;
let activeHandler = /** @type {null | ((event: PopStateEvent) => void)} */ (null);
let dispatcherInstalled = false;

function installDispatcher() {
  if (dispatcherInstalled || typeof window === "undefined") return;
  dispatcherInstalled = true;
  window.addEventListener("popstate", (event) => {
    if (releasesInFlight > 0) {
      releasesInFlight -= 1;
      return;
    }
    activeHandler?.(event);
  });
}

/**
 * Keeps an in-progress flow (a checkpoint, an exam) from being left by
 * accident. While `active`:
 *
 * - the browser's Back is caught: one extra history entry sits on top of the
 *   page, so Back lands on the page itself and `onRequestExit` is asked instead
 *   of the route changing;
 * - reloading or closing the tab shows the browser's own "leave site?" prompt.
 *
 * The extra entry is removed when the guard ends, unless the reader has already
 * navigated somewhere else, so it never costs the reader an extra Back press.
 *
 * @param {{ active: boolean, onRequestExit: () => void }} options
 */
export function useExitGuard({ active, onRequestExit }) {
  const requestRef = useRef(onRequestExit);
  requestRef.current = onRequestExit;
  const tokenRef = useRef(0);
  const releaseTimerRef = useRef(0);

  useEffect(() => {
    if (!active || typeof window === "undefined") return undefined;
    installDispatcher();
    window.clearTimeout(releaseTimerRef.current);
    // A remount inside one render pass (React StrictMode) keeps the entry it
    // already pushed instead of stacking a second one.
    if (!tokenRef.current || window.history.state?.[GUARD_KEY] !== tokenRef.current) {
      tokenRef.current = nextToken++;
      window.history.pushState({ ...(window.history.state || {}), [GUARD_KEY]: tokenRef.current }, "", window.location.href);
    }
    const token = tokenRef.current;

    function onPopState(event) {
      // Back left the guard entry: put it back and ask instead.
      window.history.pushState({ ...(event.state || {}), [GUARD_KEY]: token }, "", window.location.href);
      requestRef.current?.();
    }
    function onBeforeUnload(event) {
      event.preventDefault();
      event.returnValue = "";
    }
    activeHandler = onPopState;
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      if (activeHandler === onPopState) activeHandler = null;
      window.removeEventListener("beforeunload", onBeforeUnload);
      // Deferred so an immediate remount can reclaim the entry (see above).
      releaseTimerRef.current = window.setTimeout(() => {
        if (window.history.state?.[GUARD_KEY] !== token) return;
        releasesInFlight += 1;
        window.history.back();
      }, 0);
    };
  }, [active]);
}
