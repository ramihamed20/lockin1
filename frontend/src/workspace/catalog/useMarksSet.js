import { useCallback, useEffect, useState } from "react";
import { markCopySeeded } from "../../api/annotationShares.js";
import { personalSheetsApi } from "../../api/personalSheets.js";
import { marksStorageSlug, seedDeviceStore } from "./annotationShare.js";

const KEY_PREFIX = "lock-in.marks-set.v1";

function storageKey(owner, documentId) {
  return `${KEY_PREFIX}.${String(owner || "anonymous").replace(/[^a-zA-Z0-9_-]/g, "_")}.${documentId}`;
}

function readSelection(owner, documentId) {
  if (!documentId) return "";
  try {
    return window.localStorage.getItem(storageKey(owner, documentId)) || "";
  } catch {
    return "";
  }
}

function writeSelection(owner, documentId, marksId) {
  try {
    if (marksId) window.localStorage.setItem(storageKey(owner, documentId), marksId);
    else window.localStorage.removeItem(storageKey(owner, documentId));
  } catch {
    // The choice then lasts until the page is reloaded, which is acceptable.
  }
}

/**
 * Which marks a catalog sheet shows: the student's own, or a copy of another
 * student's. The choice is remembered per sheet and account, so switching tabs
 * or reloading keeps it. A copy starts from a seed the server holds until a
 * device has stored it; the reader opens only after that, otherwise it would
 * load an empty copy.
 *
 * @param {{ owner: string, documentId: string, materialSlug: string, sheetSlug: string, enabled?: boolean }} options
 * @returns {{ status: "loading" | "ready", marksSet: { id: string, author: string, shareId: string, title: string } | null, select: (marksId: string) => void }}
 */
export function useMarksSet({ owner, documentId, materialSlug, sheetSlug, enabled = true }) {
  const [selected, setSelected] = useState(() => (enabled ? readSelection(owner, documentId) : ""));
  const [state, setState] = useState({ key: "", marksSet: null });
  const wanted = enabled && documentId ? selected : "";
  const key = `${documentId}/${wanted}`;

  // A different sheet or account has its own remembered choice.
  useEffect(() => {
    setSelected(enabled ? readSelection(owner, documentId) : "");
  }, [documentId, enabled, owner]);

  useEffect(() => {
    if (!wanted) return undefined;
    let active = true;
    (async () => {
      let marksSet = null;
      let forget = false;
      try {
        const { sheet, seed } = await personalSheetsApi.get(wanted);
        if (sheet.copy?.documentId === documentId) {
          if (seed) {
            const stored = await seedDeviceStore({ owner, materialSlug, sheetSlug: marksStorageSlug(sheetSlug, wanted), seed });
            if (stored) void markCopySeeded(wanted).catch(() => undefined);
          }
          marksSet = { id: wanted, author: sheet.copy.author, shareId: sheet.copy.shareId, title: sheet.title };
        } else {
          forget = true;
        }
      } catch (failure) {
        // A copy that is gone (deleted on another device) is forgotten. Offline,
        // the choice is kept and the sheet opens on the student's own marks.
        const status = /** @type {any} */ (failure)?.status;
        forget = status === 404 || status === 403;
      }
      if (!active) return;
      if (forget) {
        writeSelection(owner, documentId, "");
        setSelected("");
      }
      setState({ key, marksSet });
    })();
    return () => { active = false; };
  }, [documentId, key, materialSlug, owner, sheetSlug, wanted]);

  const select = useCallback((marksId) => {
    writeSelection(owner, documentId, marksId);
    setSelected(marksId);
  }, [documentId, owner]);

  if (!wanted) return { status: "ready", marksSet: null, select };
  if (state.key !== key) return { status: "loading", marksSet: null, select };
  return { status: "ready", marksSet: state.marksSet, select };
}
