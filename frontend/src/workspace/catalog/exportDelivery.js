/**
 * How a finished export reaches the device.
 *
 * Generating a PDF takes seconds, and browsers only let a page open the share
 * sheet or a new window during the user's own tap (transient activation).
 * Calling navigator.share after the render therefore failed with
 * NotAllowedError on iPhone and iPad, and the fallback - an <a download> on a
 * blob: URL with target=_blank - is ignored or opens a dead tab in Safari and
 * in the installed app. So delivery is split from generation:
 *
 *   - desktop and Android browsers download at once with <a download>, which
 *     needs no activation, and keep a "Download again" action;
 *   - iPhone and iPad show a ready sheet whose buttons run inside a fresh tap:
 *     Share / Save to Files (navigator.share with a File), Open PDF (a real
 *     link to the blob, which Safari previews with its own share button) and
 *     Download.
 *
 * The object URL lives exactly as long as that sheet and is always revoked.
 */

/** A filename-safe slug of the sheet title, kept readable in Arabic. */
export function exportBaseName(title, fallback = "sheet") {
  const slug = String(title || "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/\p{Cc}/gu, "")
    .replace(/[\\/:*?"<>|#%&{}$!'`@+=^~[\]]+/g, "")
    .replace(/[\s._·•–—-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || fallback;
}

/** `sheet-name-lockin.pdf`, with the page or range when only part is exported. */
export function exportFileNameFor({ title, kind = "annotated", page = 1, from = 1, to = 1, extension = "pdf" }) {
  const base = exportBaseName(title);
  const part = kind === "original" ? "-original"
    : kind === "current" || kind === "png" ? `-page-${page}`
      : kind === "range" ? `-pages-${from}-${to}`
        : "";
  return `${base}${part}-lockin.${extension}`;
}

/** iPhone, iPod and iPad - including iPadOS, which reports itself as a Mac. */
export function isAppleTouchDevice(nav = typeof navigator === "undefined" ? null : navigator) {
  if (!nav) return false;
  return /iPad|iPhone|iPod/.test(nav.userAgent || "") || (nav.platform === "MacIntel" && Number(nav.maxTouchPoints) > 1);
}

export function canShareFile(file, nav = typeof navigator === "undefined" ? null : navigator) {
  try { return Boolean(file && nav?.share && nav?.canShare?.({ files: [file] })); } catch { return false; }
}

/** Opens the system share sheet. Must be called from a tap. */
export async function shareExportFile(file, { title = "" } = {}, nav = navigator) {
  try {
    await nav.share({ files: [file], title: title || file.name });
    return "shared";
  } catch (error) {
    if (error?.name === "AbortError") return "cancelled";
    throw error;
  }
}

/** Starts a normal file download of an object URL. */
export function triggerDownload(url, name, doc = document) {
  const link = doc.createElement("a");
  link.href = url;
  link.download = name;
  link.rel = "noopener";
  link.style.display = "none";
  doc.body.appendChild(link);
  link.click();
  link.remove();
}

/**
 * A finished export: the File for sharing, an object URL for download and
 * preview, and a revoke that is safe to call more than once.
 */
export function createExportHandle(blob, name, url = globalThis.URL) {
  const file = new File([blob], name, { type: blob.type || "application/octet-stream", lastModified: Date.now() });
  let objectUrl = url.createObjectURL(file);
  return {
    file,
    name,
    size: file.size,
    type: file.type,
    get url() { return objectUrl; },
    revoke() {
      if (!objectUrl) return;
      url.revokeObjectURL(objectUrl);
      objectUrl = "";
    }
  };
}

export function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
