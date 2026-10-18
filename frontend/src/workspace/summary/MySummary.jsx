import "./summary.css";
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Download, Eye, EyeOff, Keyboard, PenLine, Pencil, Trash2, X } from "lucide-react";
import { useI18n } from "../../components/I18nProvider.jsx";
import { SUMMARY_COLORS } from "./summaryPdf.js";

const COLORS = Object.keys(SUMMARY_COLORS);

function useModal(onClose) {
  const ref = useRef(/** @type {HTMLDialogElement | null} */ (null));
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement;
    dialog?.showModal();
    return () => { dialog?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  return { ref, onCancel: (event) => { event.preventDefault(); onClose(); } };
}

function ColorChoice({ value, onChange, disabled, name }) {
  const { t } = useI18n();
  return <div className="summary-colors" role="radiogroup" aria-label={t("summary.color")}>
    {COLORS.map((color) => <label key={color} className={value === color ? "is-selected" : ""} style={/** @type {any} */ ({ "--summary-accent": SUMMARY_COLORS[color].accent })}>
      <input type="radio" name={name} value={color} checked={value === color} disabled={disabled} onChange={() => onChange(color)} />
      <span aria-hidden="true" /><span className="visually-hidden">{t(`summary.color.${color}`)}</span>
    </label>)}
  </div>;
}

function NewSummaryForm({ busy, onCreate }) {
  const { t } = useI18n();
  const [title, setTitle] = useState("");
  const [mode, setMode] = useState("pen");
  const [color, setColor] = useState("blue");
  return <form className="summary-new" onSubmit={(event) => { event.preventDefault(); if (title.trim()) onCreate({ title: title.trim(), mode, color }); }}>
    <h3>{t("summary.newTitle")}</h3>
    <label className="field"><span>{t("summary.name")}</span>
      <input value={title} maxLength={120} dir="auto" required autoComplete="off" disabled={busy} placeholder={t("summary.namePlaceholder")} onChange={(event) => setTitle(event.target.value)} />
    </label>
    <fieldset className="summary-modes" disabled={busy}>
      <legend>{t("summary.mode")}</legend>
      {[["pen", PenLine, "summary.pen", "summary.penHint"], ["keyboard", Keyboard, "summary.keyboard", "summary.keyboardHint"]].map(([id, Icon, label, hint]) => <label key={/** @type {string} */ (id)} className={mode === id ? "is-selected" : ""}>
        <input type="radio" name="summary-mode" value={/** @type {string} */ (id)} checked={mode === id} onChange={() => setMode(/** @type {string} */ (id))} />
        <Icon size={20} aria-hidden="true" />
        <span><strong>{t(/** @type {string} */ (label))}</strong><small>{t(/** @type {string} */ (hint))}</small></span>
      </label>)}
    </fieldset>
    <div className="summary-color-row"><span>{t("summary.color")}</span><ColorChoice value={color} onChange={setColor} disabled={busy} name="summary-new-color" /></div>
    <button type="submit" className="btn btn-primary" disabled={busy || !title.trim()}>{t(busy ? "summary.starting" : "summary.start")}</button>
  </form>;
}

function SummaryCard({ summary, progress, busy, onContinue, onUpdate, onDelete, onReceive }) {
  const { t } = useI18n();
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(summary.title);
  const [confirming, setConfirming] = useState(false);
  const ModeIcon = summary.mode === "pen" ? PenLine : Keyboard;
  return <li className="summary-card" style={/** @type {any} */ ({ "--summary-accent": SUMMARY_COLORS[summary.color]?.accent })}>
    <div className="summary-card__head">
      <span className="summary-card__icon"><ModeIcon size={18} aria-hidden="true" /></span>
      {renaming
        ? <form className="summary-card__rename" onSubmit={(event) => { event.preventDefault(); if (title.trim()) { onUpdate({ title: title.trim() }); setRenaming(false); } }}>
          <input ref={(node) => { if (node && document.activeElement !== node && !node.dataset.focused) { node.dataset.focused = "1"; node.focus(); } }} value={title} maxLength={120} dir="auto" aria-label={t("summary.name")} onChange={(event) => setTitle(event.target.value)} />
          <button type="submit" className="btn btn-soft compact" disabled={busy || !title.trim()}>{t("summary.save")}</button>
          <button type="button" className="btn btn-soft compact" onClick={() => { setTitle(summary.title); setRenaming(false); }}>{t("summary.cancel")}</button>
        </form>
        : <div className="summary-card__title">
          <strong dir="auto">{summary.title}</strong>
          <small>{t(summary.mode === "pen" ? "summary.pen" : "summary.keyboard")} · {t("summary.progress", progress)} · {t(summary.status === "finished" ? "summary.finished" : "summary.writing")}{summary.visible ? "" : ` · ${t("summary.hidden")}`}</small>
        </div>}
    </div>
    <div className="summary-card__actions">
      <button type="button" className="btn btn-primary compact" disabled={busy || !summary.visible} onClick={onContinue}>{t("summary.continue")}</button>
      <button type="button" className="btn btn-soft compact" disabled={busy} onClick={onReceive}><Download size={15} aria-hidden="true" />{t("summary.receive")}</button>
      <button type="button" className="btn btn-soft compact" disabled={busy} aria-pressed={!summary.visible} onClick={() => onUpdate({ visible: !summary.visible })}>{summary.visible ? <EyeOff size={15} aria-hidden="true" /> : <Eye size={15} aria-hidden="true" />}{t(summary.visible ? "summary.hide" : "summary.show")}</button>
      <button type="button" className="btn btn-soft compact" disabled={busy || renaming} onClick={() => setRenaming(true)}><Pencil size={15} aria-hidden="true" />{t("summary.rename")}</button>
      <ColorChoice value={summary.color} onChange={(color) => onUpdate({ color })} disabled={busy} name={`summary-color-${summary.id}`} />
      <button type="button" className="btn btn-soft compact summary-card__delete" disabled={busy} onClick={() => setConfirming(true)}><Trash2 size={15} aria-hidden="true" />{t("summary.delete")}</button>
    </div>
    {confirming && <div className="summary-card__confirm" role="alertdialog" aria-label={t("summary.deleteNow")}>
      <p>{t("summary.deleteConfirm", { title: summary.title })}</p>
      <div><button type="button" className="btn btn-soft compact" onClick={() => setConfirming(false)}>{t("summary.cancel")}</button><button type="button" className="btn btn-danger compact" disabled={busy} onClick={() => { setConfirming(false); onDelete(); }}>{t("summary.deleteNow")}</button></div>
    </div>}
  </li>;
}

/** Settings for the sheet's summaries: start one, and continue, show, rename, recolour, receive or delete each. */
export function MySummaryDialog({ summaries, maxPerSheet, progressOf, busy, error, onCreate, onContinue, onUpdate, onDelete, onReceive, onClose }) {
  const { t } = useI18n();
  const modal = useModal(onClose);
  return <dialog className="summary-dialog" ref={modal.ref} onCancel={modal.onCancel} aria-labelledby="summary-dialog-title">
    <header>
      <div><h2 id="summary-dialog-title">{t("summary.title")}</h2><p>{t("summary.intro", { max: maxPerSheet })}</p></div>
      <button type="button" className="summary-dialog__close" aria-label={t("summary.cancel")} onClick={onClose}><X size={18} /></button>
    </header>
    {summaries.length > 0 && <ul className="summary-list">
      {summaries.map((summary) => <SummaryCard key={summary.id} summary={summary} progress={progressOf(summary)} busy={busy}
        onContinue={() => onContinue(summary)} onUpdate={(changes) => onUpdate(summary, changes)} onDelete={() => onDelete(summary)} onReceive={() => onReceive(summary)} />)}
    </ul>}
    {summaries.length < maxPerSheet ? <NewSummaryForm busy={busy} onCreate={onCreate} /> : <p className="summary-note">{t("summary.limit", { max: maxPerSheet })}</p>}
    {error && <p className="form-alert error" role="alert">{error}</p>}
  </dialog>;
}

/** Keyboard summaries: a side panel that writes to the sheet page being read. */
export function SummaryTextPanel({ summaries, activeId, onActive, page, open, onToggle, pageText, onWrite, saveState }) {
  const { t } = useI18n();
  const summary = summaries.find((item) => item.id === activeId) || summaries[0];
  if (!summary) return null;
  const state = saveState[summary.id] || "saved";
  const text = pageText(summary, page);
  return <aside className={`summary-panel${open ? " is-open" : ""}`} style={/** @type {any} */ ({ "--summary-accent": SUMMARY_COLORS[summary.color]?.accent })} aria-label={t("summary.title")}>
    <button type="button" className="summary-panel__tab" aria-expanded={open} aria-label={t(open ? "summary.panelClose" : "summary.panelOpen")} onClick={onToggle}>
      {open ? <ChevronRight size={18} aria-hidden="true" /> : <ChevronLeft size={18} aria-hidden="true" />}
    </button>
    {open && <div className="summary-panel__body">
      <header>
        {summaries.length > 1
          ? <label className="summary-panel__which"><span className="visually-hidden">{t("summary.which")}</span><select value={summary.id} onChange={(event) => onActive(event.target.value)}>{summaries.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
          : <strong dir="auto">{summary.title}</strong>}
        <span className={`summary-panel__state is-${state}`} role="status">{t(`summary.${state}`)}</span>
      </header>
      <label className="summary-panel__page">
        <span>{t("summary.pageLabel", { page })}</span>
        <textarea key={`${summary.id}:${page}`} dir="auto" maxLength={5000} value={text} placeholder={t("summary.pagePlaceholder", { page })} onChange={(event) => onWrite(summary.id, page, event.target.value)} />
      </label>
      <small className="summary-panel__count" dir="ltr">{text.length} / 5000</small>
    </div>}
  </aside>;
}

/** Shown once the student reaches the last page with a summary still being written. */
export function SummaryReceiveCard({ busy, onReceive, onDismiss }) {
  const { t } = useI18n();
  return <div className="summary-receive" role="status">
    <span>{t("summary.endReached")}</span>
    <button type="button" className="btn btn-primary compact" disabled={busy} onClick={onReceive}><Download size={15} aria-hidden="true" />{t(busy ? "summary.receiving" : "summary.receive")}</button>
    <button type="button" className="summary-receive__close" aria-label={t("summary.cancel")} onClick={onDismiss}><X size={16} /></button>
  </div>;
}
