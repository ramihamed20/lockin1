import { useEffect, useRef } from "react";

/**
 * Marks a scroll container with how much content sits outside its visible box.
 *
 * A navigation list that scrolls without saying so reads as a list that ends
 * where the viewport ends. iPadOS and iOS use overlay scrollbars that stay
 * hidden until a finger is already moving, so the scrollbar cannot carry that
 * information on the devices where the list is most likely to overflow. The
 * attribute lets the stylesheet fade the edge that still has content behind it.
 *
 * `data-overflow` is one of: "none", "start", "end", "both".
 */
export function useScrollOverflow() {
  const ref = useRef(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;

    /** What the box says right now. Reads layout; writes nothing. */
    function measure() {
      // At wide viewports the same list is laid out with visible overflow and
      // nothing is clipped, so there is no hidden content to announce.
      const scrolls = ["auto", "scroll"].includes(window.getComputedStyle(element).overflowY);
      const hidden = element.scrollHeight - element.clientHeight;
      if (!scrolls || hidden <= 1) return "none";
      const atStart = element.scrollTop <= 1;
      const atEnd = element.scrollTop >= hidden - 1;
      return atStart ? "end" : atEnd ? "start" : "both";
    }

    let pendingConfirmation = 0;

    function cancelConfirmation() {
      if (!pendingConfirmation) return;
      window.cancelAnimationFrame(pendingConfirmation);
      pendingConfirmation = 0;
    }

    function update() {
      const next = measure();
      cancelConfirmation();
      // Clearing a cue is immediate, and announcing one is not. The visible
      // error is a fade over an edge that hides nothing, so that direction never
      // waits; and once the list is already announcing, scrolling has to move
      // the fade from one edge to the other without a frame of lag.
      if (next === "none" || element.dataset.overflow !== "none") {
        element.dataset.overflow = next;
        return;
      }
      // A list settling into place passes through states where it briefly
      // overflows -- a web font resolving, the box growing to fill its column --
      // and painting a fade for one of those flashes a mask across a list that
      // turns out to hide nothing. One frame of agreement is the difference
      // between a real overflow and a layout still in motion.
      if (typeof window.requestAnimationFrame !== "function") {
        element.dataset.overflow = next;
        return;
      }
      pendingConfirmation = window.requestAnimationFrame(() => {
        // A nested frame deliberately measures after the browser has had a
        // chance to apply late style and font metrics.  In particular, an
        // iPad-sized sidebar can briefly overflow while its grid track is
        // resolving, then fit exactly one frame later.  Publishing the first
        // measurement left a stale end cue over a list that no longer hid a
        // destination.
        pendingConfirmation = window.requestAnimationFrame(() => {
          pendingConfirmation = 0;
          const confirmed = measure();
          if (confirmed !== "none") element.dataset.overflow = confirmed;
        });
      });
    }

    // Start from the value that paints nothing rather than from a measurement.
    // An effect runs before the browser has finished laying this list out, so
    // measuring here describes a box that is about to change.
    element.dataset.overflow = "none";
    update();

    element.addEventListener("scroll", update, { passive: true });
    // A resize can change the breakpoint, and with it whether the list scrolls
    // at all, without changing the element's own box.
    window.addEventListener("resize", update, { passive: true });
    window.addEventListener("orientationchange", update);

    // The box changes with the viewport; the content changes when role-specific
    // destinations resolve. Both alter whether anything is hidden.
    const resizeObserver = new window.ResizeObserver(update);
    resizeObserver.observe(element);

    // The list's own box can stay byte-identical while its content changes
    // height -- a web font resolving is the ordinary case -- and a
    // ResizeObserver on the container alone is never told. Without the rows, a
    // cue that was true during the first layout stays published for the life of
    // the page, describing an overflow that has already been absorbed.
    const rowObserver = new window.ResizeObserver(update);
    function observeRows() {
      rowObserver.disconnect();
      for (const row of element.children) rowObserver.observe(row);
    }
    observeRows();

    const mutationObserver = new window.MutationObserver(() => {
      observeRows();
      update();
    });
    mutationObserver.observe(element, { childList: true, subtree: true });

    // Font metrics can alter the height of a row while the scroll container
    // itself keeps the same dimensions.  ResizeObserver normally catches the
    // row resize, but the Font Loading API is the final authoritative signal
    // for the initial page paint and avoids retaining a cue from fallback text.
    const fontsReady = document.fonts?.ready;
    fontsReady?.then(update);

    return () => {
      cancelConfirmation();
      element.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
      resizeObserver.disconnect();
      rowObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, []);

  return ref;
}
