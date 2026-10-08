import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, FileText, Folder, NotebookPen, Plus, X } from "lucide-react";
import { personalSheetsApi } from "../../api/personalSheets.js";
import { useI18n } from "../../components/I18nProvider.jsx";
import { personalTabId, sheetTabId } from "./workspaceTabs.js";

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
    const escape = (event) => { if (event.key === "Escape") { event.stopPropagation(); backRef.current(); } };
    document.addEventListener("keydown", escape, true);
    return () => document.removeEventListener("keydown", escape, true);
  }, []);
  // The first step starts on its first subject; the second on "back", which is
  // there at once while the student's own sheets are still loading.
  useEffect(() => {
    panelRef.current?.querySelector(subject ? ".workspace-tabs-picker-back" : ".workspace-tabs-picker-list button")?.focus();
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState(null);
  const addRef = useRef(null);
  const menuRef = useRef(null);
  const portalTarget = portalRef?.current || null;
  const openIds = useMemo(() => new Set(tabs.map((tab) => tab.id)), [tabs]);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const close = (event) => {
      if (menuRef.current?.contains(event.target) || addRef.current?.contains(event.target)) return;
      setMenuOpen(false);
    };
    const escape = (event) => { if (event.key === "Escape") { setMenuOpen(false); addRef.current?.focus(); } };
    document.addEventListener("pointerdown", close, true);
    document.addEventListener("keydown", escape);
    menuRef.current?.querySelector("button")?.focus();
    return () => {
      document.removeEventListener("pointerdown", close, true);
      document.removeEventListener("keydown", escape);
    };
  }, [menuOpen]);

  function toggleMenu() {
    if (menuOpen) { setMenuOpen(false); return; }
    const button = addRef.current?.getBoundingClientRect();
    const root = portalTarget?.getBoundingClientRect();
    if (button && root) setMenuPosition({ top: button.bottom - root.top + 6, left: button.left - root.left, right: root.right - button.right });
    setMenuOpen(true);
  }

  const menu = menuOpen && <div ref={menuRef} className="workspace-tabs-menu" role="menu" aria-label={t("workspaceTabs.newTab")} style={menuPosition ? { top: menuPosition.top, insetInlineStart: document.documentElement.dir === "rtl" ? menuPosition.right : menuPosition.left } : undefined}>
    <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onNewWhiteboard(); }}><NotebookPen size={18} /><span><strong>{t("workspaceTabs.whiteboard")}</strong><small>{t("workspaceTabs.whiteboardHint")}</small></span></button>
    <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); setPickerOpen(true); }}><FileText size={18} /><span><strong>{t("workspaceTabs.openSheet")}</strong><small>{t("workspaceTabs.openSheetHint")}</small></span></button>
  </div>;

  return <div className="workspace-tabs" role="tablist" aria-label={t("workspaceTabs.label")}>
    <div className="workspace-tabs-scroller">
      {tabs.map((tab) => {
        const active = tab.id === activeId;
        const label = tabLabel(tab, t);
        return <div key={tab.id} className={`workspace-tab${active ? " is-active" : ""}`} data-tab-kind={tab.kind}>
          <button type="button" role="tab" aria-selected={active} title={label} onClick={() => { if (!active) onSelect(tab); }}>
            {tab.kind === "whiteboard" ? <NotebookPen size={14} aria-hidden="true" /> : tab.kind === "personal" ? <Folder size={14} aria-hidden="true" /> : <FileText size={14} aria-hidden="true" />}
            <span dir="auto">{label}</span>
          </button>
          {tabs.length > 1 && <button type="button" className="workspace-tab-close" aria-label={t("workspaceTabs.closeTab", { name: label })} title={t("workspaceTabs.closeTab", { name: label })} onClick={() => onClose(tab)}><X size={13} /></button>}
        </div>;
      })}
    </div>
    <button ref={addRef} type="button" className={`workspace-tabs-add${menuOpen ? " is-active" : ""}`} aria-label={t("workspaceTabs.newTab")} title={t("workspaceTabs.newTab")} aria-haspopup="menu" aria-expanded={menuOpen} onClick={toggleMenu}><Plus size={16} /></button>
    {menu && portalTarget && createPortal(menu, portalTarget)}
    {pickerOpen && portalTarget && createPortal(<SheetPicker materials={materials} openIds={openIds} onClose={() => { setPickerOpen(false); addRef.current?.focus(); }} onPick={(choice) => { setPickerOpen(false); onOpenSheet(choice); }} />, portalTarget)}
  </div>;
}
