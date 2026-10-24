import { useEffect, useLayoutEffect } from "react";

/**
 * The toolbar's tool rail: an edge fade that says more tools are hidden that
 * way, a newly chosen tool scrolled into view, and the one capsule that slides
 * to the selected tool. Toolbar chrome only; nothing here touches the stage.
 * @param {{ railRef: { current: HTMLElement | null }, listRef: { current: HTMLElement | null }, indicatorRef: { current: HTMLElement | null }, activeTool: string }} rail
 */
export function useToolRail({ railRef, listRef, indicatorRef, activeTool }) {
  // Publish how much track is hidden on each physical side and the stylesheet
  // fades that edge - the only honest way to say "there is more this way"
  // without a scrollbar. Measuring in physical pixels keeps it correct in
  // Arabic, where a scroller counts its offset backwards.
  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return undefined;
    const publish = () => {
      const hidden = Math.max(0, rail.scrollWidth - rail.clientWidth);
      const rtl = window.getComputedStyle(rail).direction === "rtl";
      const left = Math.min(hidden, Math.max(0, rtl ? hidden + rail.scrollLeft : rail.scrollLeft));
      // A narrow fade: a phone rail overflows by only a few pixels, and a wide
      // one would wash out the edge tool's icon.
      rail.style.setProperty("--workspace-fade-left", `${Math.min(10, left)}px`);
      rail.style.setProperty("--workspace-fade-right", `${Math.min(10, hidden - left)}px`);
    };
    publish();
    rail.addEventListener("scroll", publish, { passive: true });
    const observer = new window.ResizeObserver(publish);
    observer.observe(rail);
    for (const child of rail.children) observer.observe(child);
    return () => {
      rail.removeEventListener("scroll", publish);
      observer.disconnect();
    };
  }, [railRef]);
  // Choosing a tool with the keyboard, or restoring the last one on open, can
  // land on a button parked outside the visible track. Bring it back rather
  // than leaving the workspace claiming a tool the student cannot see.
  useEffect(() => {
    const rail = railRef.current;
    const button = rail?.querySelector(`[data-workspace-tool="${activeTool}"]`);
    if (!rail || !button) return;
    const track = rail.getBoundingClientRect();
    const target = button.getBoundingClientRect();
    // Scroll no further than needed: on a 390px phone a fifth tool overflows
    // by ten pixels, and any margin on top would slide Pen under Back.
    const margin = 0;
    const delta = target.left < track.left + margin
      ? target.left - track.left - margin
      : target.right > track.right - margin ? target.right - track.right + margin : 0;
    if (!delta) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    rail.scrollBy({ left: delta, behavior: still ? "auto" : "smooth" });
  }, [activeTool, railRef]);
  // One persistent capsule follows the selected tool. Measuring toolbar chrome
  // here never changes the PDF stage or its viewport/annotation coordinates.
  useLayoutEffect(() => {
    const list = listRef.current;
    const indicator = indicatorRef.current;
    if (!list || !indicator) return undefined;
    let readyFrame = 0;
    const position = () => {
      const target = /** @type {HTMLElement | null} */ (list.querySelector(`[data-workspace-tool="${activeTool}"]`));
      if (!target || target.getClientRects().length === 0) {
        indicator.style.opacity = "0";
        return;
      }
      indicator.style.width = `${target.offsetWidth}px`;
      indicator.style.height = `${target.offsetHeight}px`;
      indicator.style.transform = `translate3d(${target.offsetLeft}px, ${target.offsetTop}px, 0)`;
      indicator.style.opacity = "1";
      if (!indicator.dataset.ready) readyFrame = requestAnimationFrame(() => { indicator.dataset.ready = "true"; });
    };
    position();
    const observer = typeof window.ResizeObserver === "undefined" ? null : new window.ResizeObserver(position);
    if (observer) observer.observe(list);
    window.addEventListener("resize", position, { passive: true });
    return () => { cancelAnimationFrame(readyFrame); observer?.disconnect(); window.removeEventListener("resize", position); };
  }, [activeTool, indicatorRef, listRef]);
}
