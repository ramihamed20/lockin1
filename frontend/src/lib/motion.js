/**
 * Motion primitives shared by the whole interface.
 *
 *   useGlide     a shared-element move for "which one is current": when the
 *                selection changes inside a strip or a navigation list, a copy
 *                of the selection surface travels from the old item to the new
 *                one and then hands back to the item's own background.
 *   usePresence  keeps a surface mounted for its exit animation, so menus,
 *                panels and dialogs leave the way they arrived instead of
 *                vanishing.
 *
 * Both are progressive: with `prefers-reduced-motion` they do nothing and the
 * interface behaves exactly as it did without them. Neither changes a single
 * attribute that tests, assistive technology or state logic read — the resting
 * DOM is identical, and the glider only exists for the length of a move.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";

export function prefersReducedMotion() {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** Box of `element` in `container`'s scrolled coordinate space. */
function boxWithin(container, element) {
  const outer = container.getBoundingClientRect();
  const inner = element.getBoundingClientRect();
  return {
    x: inner.left - outer.left - container.clientLeft + container.scrollLeft,
    y: inner.top - outer.top - container.clientTop + container.scrollTop,
    width: inner.width,
    height: inner.height
  };
}

function place(glider, box) {
  glider.style.width = `${box.width}px`;
  glider.style.height = `${box.height}px`;
  glider.style.transform = `translate3d(${box.x}px, ${box.y}px, 0)`;
}

const GLIDE_MS = 360;

/**
 * Animate the selection surface between items of `containerRef` whenever
 * `key` changes. `selector` finds the selected item (for example
 * `[aria-current="page"]` or `[aria-selected="true"]`).
 *
 * @param {import("react").RefObject<HTMLElement | null>} containerRef
 * @param {string} selector
 * @param {unknown} key
 */
export function useGlide(containerRef, selector, key) {
  const previous = useRef(/** @type {{ x: number, y: number, width: number, height: number } | null} */ (null));
  const cleanup = useRef(/** @type {(() => void) | null} */ (null));

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const active = /** @type {HTMLElement | null} */ (container.querySelector(selector));
    const from = previous.current;
    const to = active && active.offsetParent !== null ? boxWithin(container, active) : null;
    previous.current = to;
    if (!from || !to || !active || prefersReducedMotion()) return;
    if (Math.abs(from.x - to.x) < 1 && Math.abs(from.y - to.y) < 1) return;

    cleanup.current?.();
    // The item has only just become selected, so its own background is at the
    // start of a colour transition. Suspending the transition for one read
    // yields the resting colour the glider has to carry.
    const previousTransition = active.style.transition;
    active.style.transition = "none";
    const style = window.getComputedStyle(active);
    const surface = style.backgroundColor;
    const radius = style.borderRadius;
    active.style.transition = previousTransition;
    // Nothing to carry: the item draws no surface of its own.
    if (!surface || surface === "transparent" || /rgba\(0, 0, 0, 0\)|\/ 0\)$/.test(surface)) return;

    const glider = document.createElement("span");
    glider.className = "ix-glider";
    glider.setAttribute("aria-hidden", "true");
    glider.style.background = surface;
    glider.style.borderRadius = radius;
    place(glider, from);
    container.appendChild(glider);
    container.setAttribute("data-gliding", "");
    // Commit the starting box before the transition to the new one.
    glider.getBoundingClientRect();
    glider.classList.add("is-moving");
    place(glider, to);

    let timer = 0;
    const finish = () => {
      window.clearTimeout(timer);
      glider.remove();
      container.removeAttribute("data-gliding");
      cleanup.current = null;
    };
    timer = window.setTimeout(finish, GLIDE_MS + 40);
    cleanup.current = finish;
  }, [containerRef, key, selector]);

  useEffect(() => () => cleanup.current?.(), []);
}

/**
 * Keep a surface mounted while it plays its exit animation.
 * Returns `mounted` (render it) and `closing` (apply the exit state).
 *
 * @param {boolean} open
 * @param {number} [exitMs]
 */
export function usePresence(open, exitMs = 170) {
  const [mounted, setMounted] = useState(open);

  useEffect(() => {
    if (open) {
      setMounted(true);
      return undefined;
    }
    if (prefersReducedMotion()) {
      setMounted(false);
      return undefined;
    }
    const timer = window.setTimeout(() => setMounted(false), exitMs);
    return () => window.clearTimeout(timer);
  }, [exitMs, open]);

  return { mounted: open || mounted, closing: !open && mounted };
}
