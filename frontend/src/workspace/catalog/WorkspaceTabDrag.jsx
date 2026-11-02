import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FileText } from "lucide-react";
import { currentAppLocale } from "../../lib/i18n.js";

const DRAG_START_PX = 12;
const MOBILE_BREAKPOINT = "(max-width: 640px)";

/** Derive a drop zone only when the pointer actually reaches the PDF area. */
function dropGeometry() {
  const pane = document.querySelector(".workspace-pane.is-active .workspace-v2");
  const stage = pane?.querySelector(".workspace-v2-document-stage");
  const paneRect = pane?.getBoundingClientRect();
  const stageRect = stage?.getBoundingClientRect();
  if (!paneRect?.width || !paneRect?.height || !stageRect?.width || !stageRect?.height) return null;
  return {
    left: stageRect.left, top: stageRect.top,
    width: stageRect.width, height: stageRect.height,
    stacked: window.matchMedia(MOBILE_BREAKPOINT).matches
  };
}

export function splitDropZone(x, y) {
  const bounds = dropGeometry();
  if (!bounds) return null;
  if (x < bounds.left || x > bounds.left + bounds.width || y < bounds.top + 8 || y > bounds.top + bounds.height) return null;
  return bounds.stacked
    ? (y < bounds.top + bounds.height / 2 ? "start" : "end")
    : (x < bounds.left + bounds.width / 2 ? "start" : "end");
}

/**
 * Works with mouse, touch and Apple Pencil. No HTML5 drag API: Safari on iPad
 * does not reliably fire dragstart/dragover for draggable tab buttons.
 */
export function useWorkspaceTabDrag(onDrop) {
  const [preview, setPreview] = useState(null);
  const suppressClickRef = useRef(false);
  const cleanupRef = useRef(null);

  useEffect(() => () => cleanupRef.current?.(), []);

  function startDrag(event, tab, label) {
    if (event.button !== 0 || event.isPrimary === false) return;
    if (event.target.closest(".workspace-tab-close")) return;
    cleanupRef.current?.();
    suppressClickRef.current = false;

    const id = event.pointerId;
    const startX = event.clientX, startY = event.clientY;
    const touch = event.pointerType === "touch";
    let active = false;
    const pointer = (nextEvent) => {
      if (nextEvent.pointerId !== id) return;
      const dx = nextEvent.clientX - startX;
      const dy = nextEvent.clientY - startY;
      // Horizontal gestures can still scroll the crowded tab strip.
      if (!active && Math.hypot(dx, dy) > DRAG_START_PX
        && (!touch || Math.abs(dy) > 10 || Math.abs(dx) > 52)) active = true;
      if (!active) return;
      if (nextEvent.cancelable) nextEvent.preventDefault();
      setPreview({
        id: tab.id, x: nextEvent.clientX, y: nextEvent.clientY, label,
        side: splitDropZone(nextEvent.clientX, nextEvent.clientY),
        geometry: dropGeometry()
      });
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", pointer);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      cleanupRef.current = null;
    };
    const up = (nextEvent) => {
      if (nextEvent.pointerId !== id) return;
      cleanup();
      if (active) {
        suppressClickRef.current = true;
        const side = splitDropZone(nextEvent.clientX, nextEvent.clientY);
        if (side) onDrop(tab.id, side);
        setPreview(null);
      }
    };
    const cancel = (nextEvent) => {
      if (nextEvent.pointerId !== id) return;
      cleanup();
      setPreview(null);
    };
    window.addEventListener("pointermove", pointer, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    cleanupRef.current = cleanup;
  }

  function shouldSuppressClick() {
    if (!suppressClickRef.current) return false;
    suppressClickRef.current = false;
    return true;
  }

  return { startDrag, shouldSuppressClick, preview };
}

export function WorkspaceTabDragPreview({ preview }) {
  if (!preview) return null;
  const ar = currentAppLocale() === "ar";
  const bounds = preview.geometry;
  const dropStyle = bounds ? {
    "--drop-left": `${bounds.left + 7}px`,
    "--drop-top": `${bounds.top + 7}px`,
    "--drop-width": `${Math.max(0, bounds.width - 14)}px`,
    "--drop-height": `${Math.max(0, bounds.height - 14)}px`
  } : undefined;
  return createPortal(
    <div className="workspace-tab-drag-overlay" aria-hidden="true">
      {preview.side && <div
        className={`workspace-tab-drop-highlight is-${preview.side}${bounds?.stacked ? " is-stacked" : ""}`}
        style={dropStyle}
      >
        <span>{ar ? "أفلت لفتح الشيت هنا" : "Release to open here"}</span>
      </div>}
      <div className="workspace-tab-drag-ghost" style={{ left: preview.x, top: preview.y }}>
        <FileText size={17} />
        <span dir="auto">{preview.label}</span>
      </div>
    </div>,
    document.body
  );
}
