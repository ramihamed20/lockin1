import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Plus, X } from "lucide-react";
import { cssVars } from "../../lib/utils.js";

/**
 * Scrollable device palette with a fixed + action. The picker portals into the
 * workspace root so it never gets clipped by the horizontally scrolling rail.
 * Saved colours are shared by all mounted sheets (via workspace preferences).
 */
export function QuickColorPicker({ colors, activeColor, enabled, allowAdd, onSelect, onSave, portalRef, t }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(activeColor);
  const [position, setPosition] = useState(null);
  const plusRef = useRef(null);
  const popoverRef = useRef(null);
  const portalRoot = portalRef?.current || null;

  useLayoutEffect(() => {
    if (!open || !portalRoot) return undefined;
    const place = () => {
      const anchor = plusRef.current?.getBoundingClientRect();
      const root = portalRoot.getBoundingClientRect();
      if (!anchor || root.width <= 0) return;
      const width = Math.min(248, Math.max(184, root.width - 16));
      const height = 156;
      const left = Math.max(8, Math.min(anchor.right - root.left - width, root.width - width - 8));
      const below = anchor.bottom - root.top + 8;
      const top = below + height < root.height - 8 ? below : Math.max(8, anchor.top - root.top - height - 8);
      setPosition((current) => current?.left === left && current?.top === top && current?.width === width
        ? current : { left, top, width });
    };
    place();
    const observer = typeof window.ResizeObserver !== "undefined" ? new window.ResizeObserver(place) : null;
    if (observer) { observer.observe(portalRoot); if (plusRef.current) observer.observe(plusRef.current); }
    window.addEventListener("resize", place);
    window.visualViewport?.addEventListener("resize", place);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("resize", place);
    };
  }, [open, portalRoot]);

  useEffect(() => {
    if (!open) return undefined;
    const outside = (event) => {
      if (!plusRef.current?.contains(event.target) && !popoverRef.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event) => {
      if (event.key === "Escape") { event.preventDefault(); setOpen(false); plusRef.current?.focus(); }
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", escape, true);
    return () => { document.removeEventListener("pointerdown", outside, true); document.removeEventListener("keydown", escape, true); };
  }, [open]);

  const save = () => { onSave(draft); setOpen(false); };
  const picker = open && portalRoot && position && <div ref={popoverRef} className="workspace-quick-color-popover"
    role="dialog" aria-label={t("focus.addColor")} style={position}>
    <header><strong>{t("focus.addColor")}</strong><button type="button" aria-label={t("common.close")} onClick={() => setOpen(false)}><X size={16} /></button></header>
    <div className="workspace-quick-color-picker-row">
      <input type="color" aria-label={t("focus.chooseCustomColor")} value={draft} onChange={(event) => setDraft(event.target.value)} />
      <span className="workspace-quick-color-value" dir="ltr">{draft.toUpperCase()}</span>
    </div>
    <button type="button" className="workspace-quick-color-save" onClick={save}><Check size={16} />{t("focus.saveCustomColor")}</button>
  </div>;

  return <div className="workspace-v3-quick-colors" role="group" aria-label={t("focus.quickAnnotationColors")}>
    <div className="workspace-v3-color-scroll">
      {colors.map((color) => <button key={color} type="button"
        className={`workspace-v3-quick-color${activeColor === color ? " is-active" : ""}`}
        aria-label={t("focus.useColor", { color })} aria-pressed={activeColor === color}
        title={color} disabled={!enabled}
        style={cssVars({ "--workspace-tool-color": color })}
        onClick={() => onSelect(color)}><span /></button>)}
    </div>
    <button ref={plusRef} type="button" className={`workspace-v3-color-add${open ? " is-active" : ""}`}
      aria-label={t("focus.addColor")} title={t("focus.addColor")}
      aria-expanded={open} aria-haspopup="dialog" disabled={!allowAdd}
      onClick={() => { setDraft(activeColor); setOpen((value) => !value); }}>
      <Plus size={17} />
    </button>
    {picker && createPortal(picker, portalRoot)}
  </div>;
}
