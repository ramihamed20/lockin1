/**
 * Copying text out of the app, without depending on one browser API.
 *
 * `navigator.clipboard.writeText` rejects in ordinary situations that are not
 * errors on the user's part: the document not being focused, a permission
 * policy, or a non-secure origin. The async call also ends the user gesture in
 * some browsers, so the synchronous `execCommand` path is kept as the fallback
 * rather than as dead legacy code. A caller that gets `false` back must show
 * the text for manual copying.
 *
 * @param {string} text
 * @returns {Promise<boolean>} whether the text reached the clipboard
 */
export async function copyTextToClipboard(text) {
  const value = String(text ?? "");
  if (!value) return false;

  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // Fall through: the selection-based path below often still works.
    }
  }

  if (typeof document === "undefined" || !document.body) return false;
  const area = document.createElement("textarea");
  area.value = value;
  area.setAttribute("readonly", "");
  area.setAttribute("aria-hidden", "true");
  // Kept in the layout but out of view, because a `display: none` element
  // cannot be selected, and scrolling the page would be visible to the user.
  area.style.position = "fixed";
  area.style.top = "0";
  area.style.left = "-9999px";
  area.style.opacity = "0";
  try {
    document.body.appendChild(area);
    area.focus({ preventScroll: true });
    area.select();
    area.setSelectionRange(0, value.length);
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    area.remove();
  }
}
