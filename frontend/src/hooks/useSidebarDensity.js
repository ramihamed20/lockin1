import { useEffect, useRef } from "react";

/**
 * Chooses the sidebar's density by measuring it rather than by guessing from a
 * breakpoint.
 *
 * How much room the destinations need depends on the account, not only on the
 * viewport: a student has ten of them and an operations account has thirteen,
 * and the streak card is only on screen at some widths. A media query knows the
 * viewport and nothing else, which is why the first pass at this - a rule
 * keyed on viewport height and capped at 1199px wide - fixed the iPad and left
 * a laptop hiding 193px of navigation behind an invisible scroll.
 *
 * `data-density` is "comfortable" or "compact". Compact collapses the streak
 * card to one row and tightens the destination rows; anything still below the
 * fold is faded by the cue `useScrollOverflow` publishes.
 */
export function useSidebarDensity() {
  const ref = useRef(null);

  useEffect(() => {
    const sidebar = ref.current;
    if (!sidebar) return undefined;

    function update() {
      const list = sidebar.querySelector(".nav-list");
      if (!list) return;

      // The question is always "does this fit at full size", so the comfortable
      // layout is restored before every measurement. Reading a layout property
      // straight after the write resolves it synchronously, within the same
      // frame, so no intermediate state is painted and the answer cannot depend
      // on the density that happens to be applied - which is what would make a
      // threshold on the current state oscillate.
      sidebar.dataset.density = "comfortable";
      const listOverflow = list.scrollHeight - list.clientHeight;
      // Below 1320px the sidebar itself is the scroller, so the list can report
      // no overflow while destinations sit under the fold all the same.
      const sidebarOverflow = sidebar.scrollHeight - sidebar.clientHeight;
      const next = Math.max(listOverflow, sidebarOverflow) > 1 ? "compact" : "comfortable";
      if (sidebar.dataset.density !== next) sidebar.dataset.density = next;
    }

    update();
    // The box changes with the viewport, and the streak card changes height
    // when its reading arrives; both move the line between the two densities.
    window.addEventListener("resize", update, { passive: true });
    window.addEventListener("orientationchange", update);
    const resizeObserver = new window.ResizeObserver(update);
    resizeObserver.observe(sidebar);
    // Role-specific destinations resolve after the first paint and change the
    // content height without changing any observed box.
    const mutationObserver = new window.MutationObserver(update);
    mutationObserver.observe(sidebar, { childList: true, subtree: true });

    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, []);

  return ref;
}
