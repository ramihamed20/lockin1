import { useEffect, useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";

/** A small anchored menu. Opens with focus on its first item, closes on
 *  Escape (returning focus to the button), on a click elsewhere and after a choice. */
export function LockInMenu({ label, items }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    rootRef.current?.querySelector("[role='menuitem']")?.focus();
    const onPointer = (event) => { if (!rootRef.current?.contains(event.target)) setOpen(false); };
    const onKey = (event) => {
      if (event.key === "Escape") { setOpen(false); buttonRef.current?.focus(); return; }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const entries = Array.from(rootRef.current?.querySelectorAll("[role='menuitem']") || []);
      const index = entries.indexOf(document.activeElement);
      if (index === -1) return;
      event.preventDefault();
      entries[(index + (event.key === "ArrowDown" ? 1 : -1) + entries.length) % entries.length]?.focus();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onPointer); document.removeEventListener("keydown", onKey); };
  }, [open]);
  return <div className="lm-menu-anchor" ref={rootRef}>
    <button ref={buttonRef} className="lm-icon-button" type="button" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}><MoreHorizontal size={19} aria-hidden="true" /></button>
    {open && <div className="lm-menu" role="menu" aria-label={label}>
      {items.map((item) => <button key={item.label} type="button" role="menuitem" className={item.danger ? "is-danger" : undefined} onClick={() => { setOpen(false); item.onSelect(); }}>{item.label}</button>)}
    </div>}
  </div>;
}
