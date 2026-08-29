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

    function update() {
      // At wide viewports the same list is laid out with visible overflow and
      // nothing is clipped, so there is no hidden content to announce.
      const scrolls = ["auto", "scroll"].includes(window.getComputedStyle(element).overflowY);
      const hidden = element.scrollHeight - element.clientHeight;
      if (!scrolls || hidden <= 1) {
        element.dataset.overflow = "none";
        return;
      }
      const atStart = element.scrollTop <= 1;
      const atEnd = element.scrollTop >= hidden - 1;
      element.dataset.overflow = atStart ? "end" : atEnd ? "start" : "both";
    }

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
    const mutationObserver = new window.MutationObserver(update);
    mutationObserver.observe(element, { childList: true, subtree: true });

    return () => {
      element.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, []);

  return ref;
}
