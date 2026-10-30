import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, FileText, Folder, NotebookPen, Plus, X, Youtube } from "lucide-react";
import { personalSheetsApi } from "../../api/personalSheets.js";
import { useI18n } from "../../components/I18nProvider.jsx";
import { requestFocusVideo } from "./focusVideo.js";
import { personalTabId, sheetTabId } from "./workspaceTabs.js";
import { revealWorkspaceTab } from "./workspaceTabScroll.js";
import { useWorkspacePaneActive } from "./workspacePane.js";

const SHEET_PICKER_EVENT = "lockin:workspace-sheet-picker";

/**
 * Opens the "Open sheet" picker from outside the strip: when a single document
 * is open, compact layouts hide the strip and offer it from the More menu.
 */
export function requestSheetPicker() {
  if (globalThis.CustomEvent) globalThis.dispatchEvent?.(new globalThis.CustomEvent(SHEET_PICKER_EVENT));
}

function tabLabel(tab, t) {
  return tab.kind === "whiteboard" ? t("workspaceTabs.whiteboardNumber", { number: tab.number }) : tab.title;
}

/** The readable editions of one subject's published sheets. */
function subjectSheets(material) {
  return (material.sheets || []).flatMap((sheet) => {
    const editions = sheet.editions?.length ? sheet.editions : [{ edition: "university", slug: sheet.slug, deliverable: sheet.deliverable }];
    return editions
      .filter((edition) => edition.deliverable !== false)
      .map((edition) => ({
        key: `${material.slug}/${edition.slug}`,
        id: sheetTabId(material.slug, edition.slug),
        kind: "sheet",
        materialSlug: material.slug,
        sheetSlug: edition.slug,
        title: sheet.title,
        edition: edition.edition
      }));
  });
}

/** The student's own sheets in one subject, read when the subject is opened. */
function usePersonalChoices(subject) {
  const [state, setState] = useState({ slug: "", sheets: [], loading: false, failed: false });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!subject) return undefined;
    const controller = new AbortController();
    setState({ slug: subject.slug, sheets: [], loading: true, failed: false });
    personalSheetsApi.list(subject.slug, { signal: controller.signal })
      .then(({ sheets }) => setState({
        slug: subject.slug,
        loading: false,
        failed: false,
        sheets: sheets.filter((sheet) => sheet.viewUrl).map((sheet) => ({
          key: sheet.id, id: personalTabId(sheet.id), kind: "personal", materialSlug: subject.slug, personalId: sheet.id, title: sheet.title
        }))
      }))
      .catch(() => { if (!controller.signal.aborted) setState({ slug: subject.slug, sheets: [], loading: false, failed: true }); });
    return () => controller.abort();
  }, [subject, attempt]);
  const current = state.slug === subject?.slug;
  return { sheets: current ? state.sheets : [], loading: !current || state.loading, failed: current && state.failed, retry: () => setAttempt((value) => value + 1) };
}

/**
 * Two plain steps instead of a search box, so a sheet is never lost to a
 * misspelt name: pick the subject, then pick the sheet in it.
 */
function SheetPicker({ materials, openIds, onPick, onClose }) {
  const { t } = useI18n();
  const [subject, setSubject] = useState(null);
  const panelRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const backRef = useRef(() => {});
  backRef.current = () => { if (subject) setSubject(null); else closeRef.current(); };
  useEffect(() => {
    const escape = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        backRef.current();
      }
      if (event.key === "Tab") {
        const buttons = [...(panelRef.current?.querySelectorAll("button:not(:disabled)") || [])];
        const first = buttons[0];
        const last = buttons.at(-1);
        const outside = !panelRef.current?.contains(document.activeElement);
        if (event.shiftKey && (document.activeElement === first || outside)) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && (document.activeElement === last || outside)) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", escape, true);
    return () => document.removeEventListener("keydown", escape, true);
  }, []);
  // The first step starts on its first subject; the second on "back", which is
  // there at once while the student's own sheets are still loading.
  useEffect(() => {
    const panel = panelRef.current;
    (panel?.querySelector(subject ? ".workspace-tabs-picker-back" : ".workspace-tabs-picker-list button") || panel?.querySelector("button"))?.focus({ preventScroll: true });
  }, [subject]);
  const published = useMemo(() => (subject ? subjectSheets(subject) : []), [subject]);
  const own = usePersonalChoices(subject);
  const title = subject ? subject.title : t("workspaceTabs.chooseSubject");
  return <div className="workspace-tabs-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={panelRef} className="workspace-tabs-picker" role="dialog" aria-modal="true" aria-label={t("workspaceTabs.openSheet")} data-step={subject ? "sheets" : "subjects"}>
      <header>
        {subject && <button type="button" className="workspace-tabs-picker-back" aria-label={t("workspaceTabs.backToSubjects")} title={t("workspaceTabs.backToSubjects")} onClick={() => setSubject(null)}><ChevronLeft size={18} /></button>}
        <div>
          <small>{t(subject ? "workspaceTabs.stepSheet" : "workspaceTabs.stepSubject")}</small>
          <strong dir="auto">{title}</strong>
        </div>
        <button type="button" aria-label={t("common.close")} onClick={onClose}><X size={17} /></button>
      </header>
      <div className="workspace-tabs-picker-list">
        {!subject && <>
          {(materials || []).length === 0 && <p className="workspace-tabs-empty">{t("workspaceTabs.noSubjects")}</p>}
          {(materials || []).map((material) => <button key={material.slug} type="button" onClick={() => setSubject(material)}>
            <Folder size={17} aria-hidden="true" />
            <span dir="auto"><strong>{material.title}</strong></span>
            <ChevronRight size={16} aria-hidden="true" />
          </button>)}
        </>}
        {subject && <>
          {published.length > 0 && <section aria-label={t("workspaceTabs.publishedSheets")}>
            <h3>{t("workspaceTabs.publishedSheets")}</h3>
            {published.map((choice) => <SheetChoice key={choice.key} choice={choice} open={openIds.has(choice.id)} onPick={onPick} />)}
          </section>}
          <section aria-label={t("workspaceTabs.mySheets")} aria-busy={own.loading}>
            <h3>{t("workspaceTabs.mySheets")}</h3>
            {own.loading && <p className="workspace-tabs-empty" role="status">{t("common.loading")}</p>}
            {own.failed && <p className="workspace-tabs-empty" role="alert">{t("workspaceTabs.mySheetsFailed")} <button type="button" className="workspace-tabs-retry" onClick={own.retry}>{t("common.tryAgain")}</button></p>}
            {!own.loading && !own.failed && own.sheets.length === 0 && <p className="workspace-tabs-empty">{t("workspaceTabs.noMySheets")}</p>}
            {own.sheets.map((choice) => <SheetChoice key={choice.key} choice={choice} open={openIds.has(choice.id)} onPick={onPick} />)}
          </section>
          {published.length === 0 && !own.loading && !own.failed && own.sheets.length === 0 && <p className="workspace-tabs-empty">{t("workspaceTabs.noSheets")}</p>}
        </>}
      </div>
    </section>
  </div>;
}

function SheetChoice({ choice, open, onPick }) {
  const { t } = useI18n();
  return <button type="button" onClick={() => onPick(choice)}>
    <FileText size={17} aria-hidden="true" />
    <span dir="auto"><strong>{choice.title}</strong>{choice.edition === "lockin" && <small>{t("focus.lockinEdition")}</small>}</span>
    {open && <em>{t("workspaceTabs.alreadyOpen")}</em>}
  </button>;
}

/**
 * The strip of open documents above the tools. `portalRef` is the workspace
 * root, so the menu and picker stay visible in full screen.
 */
export default function WorkspaceTabBar({ tabs, activeId, materials, portalRef, onSelect, onClose, onNewWhiteboard, onOpenSheet }) {
  const { t } = useI18n();
  const paneActive = useWorkspacePaneActive();
  const [menuOpen, setMenuOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState(null);
  const addRef = useRef(null);
  const menuRef = useRef(null);
  const scrollerRef = useRef(null);
  const activeTabRef = useRef(null);
  const portalTarget = portalRef?.current || null;
  const openIds = useMemo(() => new Set(tabs.map((tab) => tab.id)), [tabs]);

  // Each kept reader has its own strip. Reveal its selected document when
  // opened/selected and when rotation or split view changes the available room.
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    const tab = activeTabRef.current;
    if (!paneActive || !scroller || !tab) return undefined;
    const reveal = () => revealWorkspaceTab(scroller, tab);
    reveal();
    const observer = new globalThis.ResizeObserver(reveal);
    observer.observe(scroller);
    observer.observe(tab);
    return () => observer.disconnect();
  }, [activeId, tabs, paneActive]);

  useEffect(() => {
    if (paneActive) return;
    setMenuOpen(false);
    setPickerOpen(false);
  }, [paneActive]);

  useEffect(() => {
    if (!paneActive) return undefined;
    const open = () => { setMenuOpen(false); setPickerOpen(true); };
    globalThis.addEventListener?.(SHEET_PICKER_EVENT, open);
    return () => globalThis.removeEventListener?.(SHEET_PICKER_EVENT, open);
  }, [paneActive]);

  useEffect(() => {
    if (!paneActive || !menuOpen) return undefined;
    const close = (event) => {
      if (menuRef.current?.contains(event.target) || addRef.current?.contains(event.target)) return;
      setMenuOpen(false);
    };
    const escape = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        setMenuOpen(false);
        addRef.current?.focus({ preventScroll: true });
      }
    };
    document.addEventListener("pointerdown", close, true);
    document.addEventListener("keydown", escape, true);
    menuRef.current?.querySelector("button")?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener("pointerdown", close, true);
      document.removeEventListener("keydown", escape, true);
    };
  }, [menuOpen, paneActive]);

  // Fit the measured menu to this workspace pane, including split view.
  useLayoutEffect(() => {
    if (!menuOpen || !portalTarget) return undefined;
    const menu = menuRef.current;
    const anchor = addRef.current;
    if (!menu || !anchor) return undefined;
    const position = () => {
      const root = portalTarget.getBoundingClientRect();
      const button = anchor.getBoundingClientRect();
      const viewport = window.visualViewport;
      const viewportLeft = viewport?.offsetLeft || 0;
      const viewportTop = viewport?.offsetTop || 0;
      const start = Math.max(root.left, viewportLeft) - root.left + 8;
      const end = Math.min(root.right, viewportLeft + (viewport?.width || window.innerWidth)) - root.left - 8;
      const bottom = Math.min(root.bottom, viewportTop + (viewport?.height || window.innerHeight)) - root.top - 8;
      const topEdge = Math.max(root.top, viewportTop) - root.top + 8;
      const width = Math.max(0, end - start);
      const menuWidth = Math.min(menu.getBoundingClientRect().width, width);
      const desiredLeft = document.documentElement.dir === "rtl" ? button.right - root.left - menuWidth : button.left - root.left;
      const below = button.bottom - root.top + 6;
      const above = button.top - root.top - 6;
      const belowSpace = Math.max(0, bottom - below);
      const aboveSpace = Math.max(0, above - topEdge);
      const useBelow = menu.scrollHeight <= belowSpace || belowSpace >= aboveSpace;
      const maxHeight = useBelow ? belowSpace : aboveSpace;
      const next = {
        left: Math.max(start, Math.min(desiredLeft, end - menuWidth)),
        top: useBelow ? below : Math.max(topEdge, above - Math.min(menu.scrollHeight + 2, maxHeight)),
        maxWidth: width,
        maxHeight
      };
      setMenuPosition((current) => current && Object.keys(next).every((key) => current[key] === next[key]) ? current : next);
    };
    position();
    const observer = new window.ResizeObserver(position);
    observer.observe(portalTarget);
    observer.observe(menu);
    window.addEventListener("resize", position);
    window.visualViewport?.addEventListener("resize", position);
    window.visualViewport?.addEventListener("scroll", position);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", position);
      window.visualViewport?.removeEventListener("resize", position);
      window.visualViewport?.removeEventListener("scroll", position);
    };
  }, [menuOpen, portalTarget]);

  // The strip is hidden while it holds a single tab, so the picker may have
  // been opened from the More menu; return focus to whichever is on screen.
  function restoreFocus() {
    const add = addRef.current;
    if (add?.getClientRects().length) add.focus();
    else portalTarget?.querySelector('[data-workspace-surface="more"]')?.focus();
  }

  function toggleMenu() {
    if (menuOpen) { setMenuOpen(false); return; }
    setMenuPosition(null);
    setMenuOpen(true);
  }

  const menu = menuOpen && <div ref={menuRef} className="workspace-tabs-menu" role="menu" aria-label={t("workspaceTabs.newTab")} style={menuPosition || { visibility: "hidden" }}>
    <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onNewWhiteboard(); }}><NotebookPen size={18} /><span><strong>{t("workspaceTabs.whiteboard")}</strong><small>{t("workspaceTabs.whiteboardHint")}</small></span></button>
    <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); setPickerOpen(true); }}><FileText size={18} /><span><strong>{t("workspaceTabs.openSheet")}</strong><small>{t("workspaceTabs.openSheetHint")}</small></span></button>
    <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); requestFocusVideo(); }}><Youtube size={18} /><span><strong>{t("focusVideo.menu")}</strong><small>{t("focusVideo.menuHint")}</small></span></button>
  </div>;

  return <div className="workspace-tabs" role="tablist" aria-label={t("workspaceTabs.label")} data-single={tabs.length === 1 ? "" : undefined}>
    <div ref={scrollerRef} className="workspace-tabs-scroller">
      {tabs.map((tab) => {
        const active = tab.id === activeId;
        const label = tabLabel(tab, t);
        return <div key={tab.id} ref={active ? activeTabRef : undefined} className={`workspace-tab${active ? " is-active" : ""}`} data-tab-kind={tab.kind}>
          <button type="button" role="tab" aria-selected={active} title={label} onClick={() => { if (!active) onSelect(tab); }}>
            {tab.kind === "whiteboard" ? <NotebookPen size={14} aria-hidden="true" /> : tab.kind === "personal" ? <Folder size={14} aria-hidden="true" /> : <FileText size={14} aria-hidden="true" />}
            <span dir="auto">{label}</span>
          </button>
          {tabs.length > 1 && <button type="button" className="workspace-tab-close" aria-label={t("workspaceTabs.closeTab", { name: label })} title={t("workspaceTabs.closeTab", { name: label })} onClick={() => onClose(tab)}><X size={13} /></button>}
        </div>;
      })}
    </div>
    <button ref={addRef} type="button" className={`workspace-tabs-add${menuOpen ? " is-active" : ""}`} aria-label={t("workspaceTabs.newTab")} title={t("workspaceTabs.newTab")} aria-haspopup="menu" aria-expanded={menuOpen} onClick={toggleMenu}><Plus size={16} /></button>
    {paneActive && menu && portalTarget && createPortal(menu, portalTarget)}
    {paneActive && pickerOpen && portalTarget && createPortal(<SheetPicker materials={materials} openIds={openIds} onClose={() => { setPickerOpen(false); restoreFocus(); }} onPick={(choice) => { setPickerOpen(false); onOpenSheet(choice); }} />, portalTarget)}
  </div>;
}
