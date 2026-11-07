/** Reveal the whole tab, including Close, without scrolling any reader/page. */
export function revealWorkspaceTab(scroller, tab) {
  const bounds = scroller.getBoundingClientRect();
  if (!bounds.width) return;
  const selected = tab.getBoundingClientRect();
  const delta = selected.left < bounds.left ? selected.left - bounds.left
    : selected.right > bounds.right ? selected.right - bounds.right : 0;
  // Physical offsets work for both LTR and negative-scrollLeft RTL scrollers.
  if (delta) scroller.scrollBy({ left: delta, behavior: "instant" });
}
