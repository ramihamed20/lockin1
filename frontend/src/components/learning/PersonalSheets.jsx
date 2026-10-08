import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { PERSONAL_MATERIAL, personalSheetsApi, PERSONAL_SHEET_MAX_BYTES } from "../../api/personalSheets.js";
import { acquireBodyScrollLock } from "../../lib/bodyScrollLock.js";
import { formatDate, formatNumber } from "../../lib/i18n.js";
import { Icon } from "../../lib/icons.jsx";
import { prefersReducedMotion, usePresence } from "../../lib/motion.js";
import { useI18n } from "../I18nProvider.jsx";
import { forgetPersonalTabs } from "../../workspace/catalog/workspaceTabs.js";
import { ownerStorageKey } from "../../workspace/storage/workspaceSnapshot.js";
import { ConfirmDialog } from "../shared/ConfirmDialog.jsx";
import { ErrorPanel, LoadingPanel, Page } from "../ui/index.jsx";
import "./personal-sheets.css";

const TITLE_MAX_LENGTH = 120;
const LEAVE_MS = 280;
// Focus and visibility both fire when a window comes back; one refresh is enough.
const RETURN_REFRESH_GAP_MS = 3_000;

/* ------------------------------------------------------------------ *
 * Data: one list per subject, shared by the subject tile and the page
 * ------------------------------------------------------------------ */

const listCache = new Map();

function emptyState(key) {
  const cached = listCache.get(key);
  return cached
    ? { key, ...cached, loading: false, error: "" }
    : { key, sheets: [], limits: null, subject: null, loading: true, error: "" };
}

/**
 * The student's own sheets in one subject. A cached list is shown at once and
 * refreshed behind it, so returning from the reader never flashes a skeleton.
 * @param {string} materialSlug
 * @param {string} ownerKey
 */
export function usePersonalSheets(materialSlug, ownerKey) {
  const key = `${ownerKey}|${materialSlug}`;
  const [state, setState] = useState(() => emptyState(key));
  const [version, setVersion] = useState(0);
  const current = state.key === key ? state : emptyState(key);
  // Counts local adds and deletes, so a list requested before one of them
  // cannot arrive afterwards and put a deleted sheet back or drop a new one.
  const mutations = useRef(0);
  const lastRefresh = useRef(0);

  useEffect(() => {
    if (!materialSlug) return undefined;
    const controller = new AbortController();
    const mutationsAtStart = mutations.current;
    lastRefresh.current = Date.now();
    personalSheetsApi.list(materialSlug, { signal: controller.signal })
      .then((result) => {
        if (mutations.current !== mutationsAtStart) return;
        listCache.set(key, result);
        setState({ key, ...result, loading: false, error: "" });
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setState((previous) => {
          const base = previous.key === key ? previous : emptyState(key);
          // A list already on screen stays; only a first load reports failure.
          return { ...base, loading: false, error: base.limits ? "" : (error?.message || "error") };
        });
      });
    return () => controller.abort();
  }, [key, materialSlug, version]);

  // The same account may add or delete sheets on another device, so the list
  // is asked for again whenever the student comes back to this window.
  useEffect(() => {
    if (!materialSlug) return undefined;
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastRefresh.current < RETURN_REFRESH_GAP_MS) return;
      setVersion((value) => value + 1);
    };
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
    };
  }, [materialSlug]);

  const update = useCallback((recipe) => {
    mutations.current += 1;
    setState((previous) => {
      const base = previous.key === key ? previous : emptyState(key);
      const next = { ...base, ...recipe(base) };
      listCache.set(key, { sheets: next.sheets, limits: next.limits, subject: next.subject });
      return next;
    });
  }, [key]);

  const reload = useCallback(() => setVersion((value) => value + 1), []);
  return { ...current, update, reload };
}

/* ------------------------------------------------------------------ *
 * Formatting
 * ------------------------------------------------------------------ */

function megabytes(bytes) {
  return formatNumber(Math.max(0.1, bytes / (1024 * 1024)), { maximumFractionDigits: 1 });
}

function addedDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return formatDate(date, sameYear ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" });
}

function normalizeTitle(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function titleFromFileName(name) {
  return normalizeTitle(String(name || "").replace(/\.pdf$/i, "").replace(/[_]+/g, " ")).slice(0, TITLE_MAX_LENGTH);
}

function isPdf(file) {
  return file && (file.type === "application/pdf" || /\.pdf$/i.test(file.name || ""));
}

/* ------------------------------------------------------------------ *
 * Subject page: the "My sheets" branch
 * ------------------------------------------------------------------ */

export function PersonalSheetsBranch({ material, user = null }) {
  const { t } = useI18n();
  const { sheets, limits, loading } = usePersonalSheets(material.slug, user?.id || "");
  const count = sheets.length;
  const meta = loading && !limits
    ? t("personalSheets.private")
    : count
      ? `${t("personalSheets.count", { count })} · ${t("personalSheets.private")}`
      : t("personalSheets.branchEmpty");
  return (
    <section className="personal-branch" aria-label={t("personalSheets.title")}>
      <Link className="personal-branch__surface" data-ix="row" to={`/materials/catalog/${material.slug}/mine`} aria-label={t("materials.openNamed", { name: t("personalSheets.title") })}>
        <span className="personal-branch__icon"><Icon name="folder" size={20} /></span>
        <span className="personal-branch__copy">
          <strong>{t("personalSheets.title")}</strong>
          <small>{meta}</small>
        </span>
        <span className="personal-branch__end" aria-hidden="true">
          {count > 0 ? <span className="personal-branch__count">{formatNumber(count)}</span> : <span className="personal-branch__add"><Icon name="plus" size={16} /></span>}
          <Icon name="chevron-right" size={18} />
        </span>
      </Link>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * The list page
 * ------------------------------------------------------------------ */

export function PersonalSheetsPage({ user = null }) {
  const { materialSlug = "" } = useParams();
  const { t } = useI18n();
  const data = usePersonalSheets(materialSlug, user?.id || "");
  const { sheets, limits, subject, update } = data;
  const [selectionRequested, setSelecting] = useState(false);
  // Selection ends by itself if a refresh empties the list.
  const selecting = selectionRequested && sheets.length > 0;
  const [selected, setSelected] = useState(() => new Set());
  const [leaving, setLeaving] = useState(() => new Set());
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [dialog, setDialog] = useState({ open: false, key: 0, file: /** @type {File | null} */ (null) });
  const [freshId, setFreshId] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [actionError, setActionError] = useState("");
  const leaveTimer = useRef(0);

  useEffect(() => () => window.clearTimeout(leaveTimer.current), []);

  const exitSelection = useCallback(() => {
    setSelecting(false);
    setSelected(new Set());
  }, []);

  useEffect(() => {
    if (!selecting || confirming) return undefined;
    const onKey = (event) => { if (event.key === "Escape") exitSelection(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [confirming, exitSelection, selecting]);

  const existingTitles = useMemo(() => new Set(sheets.map((sheet) => sheet.title.toLocaleLowerCase())), [sheets]);
  const subjectTitle = subject?.title || "";
  const backTo = `/materials/catalog/${materialSlug}`;
  const pageTitle = t("personalSheets.title");

  if (data.loading) return <Page width="reading" title={pageTitle}><LoadingPanel variant="card-list" /></Page>;
  if (data.error) return <Page width="reading" title={pageTitle}><ErrorPanel message={data.error} onRetry={data.reload} /></Page>;

  const maxSheets = limits?.maxSheets || 20;
  const used = limits?.used || 0;
  const full = used >= maxSheets;
  const maxMb = Math.round((limits?.maxFileBytes || PERSONAL_SHEET_MAX_BYTES) / (1024 * 1024));
  // A refresh can remove a sheet deleted on another device while it is ticked
  // here; only sheets still in the list count as selected.
  const selectedIds = sheets.filter((sheet) => selected.has(sheet.id)).map((sheet) => sheet.id);
  const allSelected = sheets.length > 0 && selectedIds.length === sheets.length;
  const selectedCount = selectedIds.length;

  function openAdd(file = null) {
    if (full) return;
    setActionError("");
    setSelecting(false);
    setSelected(new Set());
    setDialog((value) => ({ open: true, key: value.key + 1, file }));
  }

  function closeAdd() {
    setDialog((value) => ({ ...value, open: false }));
  }

  function handleAdded({ sheet, limits: nextLimits }) {
    update((previous) => ({ sheets: [sheet, ...previous.sheets.filter((item) => item.id !== sheet.id)], limits: nextLimits }));
    setFreshId(sheet.id);
    setAnnouncement(t("personalSheets.addedNamed", { name: sheet.title }));
    closeAdd();
  }

  function toggle(id) {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(sheets.map((sheet) => sheet.id)));
  }

  async function confirmDelete() {
    const ids = selectedIds;
    if (!ids.length) return;
    setDeleting(true);
    setActionError("");
    try {
      const result = await personalSheetsApi.remove(ids);
      // The server has dropped their marks; this device's copy goes too.
      forgetPersonalTabs(ownerStorageKey(user), ids);
      void import("../../offline/focusSync.js")
        .then(({ forgetFocusDocuments }) => forgetFocusDocuments(user, ids.map((id) => ({ documentId: id, materialSlug: PERSONAL_MATERIAL, sheetSlug: id }))))
        .catch(() => undefined);
      setConfirming(false);
      // The server's count is the truth: a sheet already deleted on another
      // device is gone either way, but it was not deleted here.
      if (result.deleted > 0) setAnnouncement(t("personalSheets.deleted", { count: result.deleted }));
      const finish = () => {
        update((previous) => ({ sheets: previous.sheets.filter((sheet) => !ids.includes(sheet.id)), limits: result.limits }));
        setLeaving(new Set());
        exitSelection();
        if (result.deleted < ids.length) data.reload();
      };
      if (prefersReducedMotion()) finish();
      else {
        setLeaving(new Set(ids));
        leaveTimer.current = window.setTimeout(finish, LEAVE_MS);
      }
    } catch {
      setConfirming(false);
      setActionError(t("personalSheets.error.delete"));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Page width="reading" title={pageTitle} headingHandled>
      <section className={`personal-sheets${selecting ? " is-selecting" : ""}`} aria-labelledby="personal-sheets-heading">
        <header className="catalog-directory-header personal-sheets__header">
          <Link className="catalog-back-link" to={backTo}><Icon name="arrow-left" size={18} aria-hidden="true" /><span dir="auto">{subjectTitle || t("route.materials")}</span></Link>
          <div className="catalog-directory-title">
            <h1 id="personal-sheets-heading">{pageTitle}</h1>
            <p className="personal-sheets__private"><Icon name="lock" size={14} aria-hidden="true" /><span>{t("personalSheets.private")}</span></p>
          </div>
        </header>

        <div className="personal-sheets__bar">
          {selecting ? (
            <div className="personal-sheets__bar-row is-select" key="select">
              <button type="button" className="personal-sheets__text-button" onClick={exitSelection}>{t("common.cancel")}</button>
              <p className="personal-sheets__bar-status" aria-live="polite">{selectedCount ? t("personalSheets.selected", { count: formatNumber(selectedCount) }) : t("personalSheets.selectHint")}</p>
              <button type="button" className="personal-sheets__text-button" onClick={toggleAll}>{allSelected ? t("personalSheets.deselectAll") : t("personalSheets.selectAll")}</button>
            </div>
          ) : (
            <div className="personal-sheets__bar-row" key="browse">
              <div className="personal-sheets__usage" role="group" aria-label={t("personalSheets.usageLabel")}>
                <span className="personal-sheets__usage-text">{t("personalSheets.usage", { used: formatNumber(used), max: formatNumber(maxSheets) })}</span>
                <span className={`personal-sheets__meter${full ? " is-full" : used / maxSheets >= 0.8 ? " is-near" : ""}`} aria-hidden="true"><span style={{ inlineSize: `${Math.min(100, (used / maxSheets) * 100)}%` }} /></span>
              </div>
              <div className="personal-sheets__actions">
                {sheets.length > 0 && <button type="button" className="btn btn-soft personal-sheets__delete" onClick={() => { setActionError(""); setSelecting(true); }}><Icon name="trash" size={16} aria-hidden="true" /><span>{t("personalSheets.delete")}</span></button>}
                {sheets.length > 0 && <button type="button" className="btn btn-primary personal-sheets__add" onClick={() => openAdd()} disabled={full}><Icon name="plus" size={17} aria-hidden="true" /><span>{t("personalSheets.add")}</span></button>}
              </div>
            </div>
          )}
        </div>

        {full && !selecting && <p className="personal-sheets__note">{t("personalSheets.limitReached", { max: formatNumber(maxSheets) })}</p>}
        {actionError && <p className="personal-sheets__error" role="alert">{actionError}</p>}

        {sheets.length === 0 ? (
          <EmptyShelf maxMb={maxMb} onAdd={openAdd} />
        ) : (
          <ul className="personal-sheets__list" aria-label={t("materials.sheetsOf", { name: subjectTitle || pageTitle })}>
            {sheets.map((sheet, index) => (
              <PersonalSheetRow
                key={sheet.id}
                sheet={sheet}
                index={index}
                to={`/materials/catalog/${materialSlug}/mine/${sheet.id}/workspace`}
                selecting={selecting}
                selected={selected.has(sheet.id)}
                leaving={leaving.has(sheet.id)}
                fresh={sheet.id === freshId}
                onToggle={() => toggle(sheet.id)}
              />
            ))}
          </ul>
        )}

        <div className={`personal-sheets__dock${selecting ? " is-open" : ""}`} aria-hidden={!selecting || undefined} inert={selecting ? undefined : ""}>
          <button type="button" className="btn btn-danger personal-sheets__dock-button" disabled={!selectedCount || deleting} onClick={() => setConfirming(true)}>
            <Icon name="trash" size={17} aria-hidden="true" />
            <span>{selectedCount ? t("personalSheets.deleteSelected", { count: selectedCount }) : t("personalSheets.delete")}</span>
          </button>
        </div>

        <p className="visually-hidden" role="status" aria-live="polite">{announcement}</p>
      </section>

      <ConfirmDialog
        open={confirming}
        title={t("personalSheets.confirmTitle", { count: selectedCount })}
        message={t("personalSheets.confirmMessage")}
        confirmLabel={t("personalSheets.deleteSelected", { count: selectedCount })}
        busy={deleting}
        onConfirm={confirmDelete}
        onCancel={() => { if (!deleting) setConfirming(false); }}
      />

      <AddPersonalSheetDialog
        key={dialog.key}
        open={dialog.open}
        materialSlug={materialSlug}
        existingTitles={existingTitles}
        initialFile={dialog.file}
        maxBytes={limits?.maxFileBytes || PERSONAL_SHEET_MAX_BYTES}
        maxSheets={maxSheets}
        onClose={closeAdd}
        onAdded={handleAdded}
      />
    </Page>
  );
}

/** The empty list is itself the place to drop the first PDF. */
function EmptyShelf({ maxMb, onAdd }) {
  const { t } = useI18n();
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  return (
    <div
      className={`personal-empty${dragging ? " is-dragging" : ""}`}
      onDragEnter={(event) => { if (!event.dataTransfer?.types?.includes("Files")) return; event.preventDefault(); depth.current += 1; setDragging(true); }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={() => { depth.current = Math.max(0, depth.current - 1); if (!depth.current) setDragging(false); }}
      onDrop={(event) => { event.preventDefault(); depth.current = 0; setDragging(false); onAdd(event.dataTransfer?.files?.[0] || null); }}
    >
      <span className="personal-empty__art" aria-hidden="true">
        <span className="personal-empty__page is-back" />
        <span className="personal-empty__page is-mid" />
        <span className="personal-empty__page is-front"><Icon name="file" size={22} /><span>PDF</span></span>
      </span>
      <h2>{dragging ? t("personalSheets.dropNow") : t("personalSheets.emptyTitle")}</h2>
      <p>{t("personalSheets.emptyText", { size: formatNumber(maxMb) })}</p>
      <button type="button" className="btn btn-primary" onClick={() => onAdd()}><Icon name="plus" size={17} aria-hidden="true" /><span>{t("personalSheets.addFirst")}</span></button>
    </div>
  );
}

function PersonalSheetRow({ sheet, index, to, selecting, selected, leaving, fresh, onToggle }) {
  const { t } = useI18n();
  const ready = sheet.status === "ready";
  const meta = sheet.status === "processing"
    ? t("personalSheets.processing")
    : !ready
      ? t("personalSheets.unavailable")
      : [
        sheet.pageCount ? t("materials.pageCount", { count: sheet.pageCount }) : "",
        t("personalSheets.sizeMb", { size: megabytes(sheet.sizeBytes) }),
        addedDate(sheet.createdAt) ? t("personalSheets.addedOn", { date: addedDate(sheet.createdAt) }) : ""
      ].filter(Boolean).join(" · ");
  const body = (
    <>
      <span className="personal-sheet__check" aria-hidden="true"><Icon name="tick" size={13} strokeWidth={3} /></span>
      <span className="personal-sheet__icon" aria-hidden="true"><Icon name="file" size={19} /><span className="personal-sheet__badge">PDF</span></span>
      <span className="personal-sheet__copy">
        <strong dir="auto">{sheet.title}</strong>
        <small>{meta}</small>
      </span>
      <span className="personal-sheet__end" aria-hidden="true"><Icon name="chevron-right" size={18} /></span>
    </>
  );
  const className = [
    "personal-sheet",
    selected ? "is-selected" : "",
    leaving ? "is-leaving" : "",
    fresh ? "is-fresh" : "",
    ready ? "" : "is-unavailable"
  ].filter(Boolean).join(" ");
  let surface;
  if (selecting) {
    surface = <button type="button" role="checkbox" aria-checked={selected} className="personal-sheet__surface" onClick={onToggle}>{body}</button>;
  } else if (ready) {
    surface = <Link className="personal-sheet__surface" data-ix="row" to={to} state={{ studyMode: "normal" }} aria-label={t("materials.openNamed", { name: sheet.title })}>{body}</Link>;
  } else {
    surface = <div className="personal-sheet__surface" aria-disabled="true">{body}</div>;
  }
  return <li className={className} style={/** @type {import("react").CSSProperties} */ ({ "--row-index": Math.min(index, 12) })}>{surface}</li>;
}

/* ------------------------------------------------------------------ *
 * Add dialog
 * ------------------------------------------------------------------ */

/** A dropped or chosen file, checked before anything is uploaded. */
function inspectFile(file, maxBytes, t) {
  if (!file) return { file: null, error: "" };
  if (!isPdf(file)) return { file: null, error: t("personalSheets.error.notPdf") };
  if (file.size > maxBytes) {
    return { file: null, error: t("personalSheets.error.tooLarge", { size: megabytes(file.size), max: formatNumber(Math.round(maxBytes / (1024 * 1024))) }) };
  }
  return { file, error: "" };
}

function AddPersonalSheetDialog({ open, materialSlug, existingTitles, initialFile = null, maxBytes, maxSheets, onClose, onAdded }) {
  const { t } = useI18n();
  const presence = usePresence(open, 200);
  const dialogRef = useRef(null);
  const nameRef = useRef(null);
  const abortRef = useRef(null);
  const dragDepth = useRef(0);
  const titleId = `personal-add-title-${useId()}`;
  const nameId = `personal-add-name-${useId()}`;
  const nameErrorId = `personal-add-name-error-${useId()}`;
  const fileErrorId = `personal-add-file-error-${useId()}`;
  const [initial] = useState(() => inspectFile(initialFile, maxBytes, t));
  const [file, setFile] = useState(/** @type {File | null} */ (initial.file));
  const [title, setTitle] = useState(() => (initial.file ? titleFromFileName(initial.file.name) : ""));
  const [autoTitle, setAutoTitle] = useState(() => (initial.file ? titleFromFileName(initial.file.name) : ""));
  const [fileError, setFileError] = useState(initial.error);
  const [nameError, setNameError] = useState("");
  const [formError, setFormError] = useState("");
  const [progress, setProgress] = useState(/** @type {number | null} */ (null));
  const [dragging, setDragging] = useState(false);
  const busy = progress !== null;
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const maxMb = Math.round(maxBytes / (1024 * 1024));

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    onCloseRef.current();
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const release = acquireBodyScrollLock();
    if (nameRef.current?.value) {
      nameRef.current.focus();
      nameRef.current.select();
    } else {
      dialogRef.current?.focus();
    }
    function onKey(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        if (!busyRef.current) cancel();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(dialogRef.current?.querySelectorAll("button:not(:disabled), input:not(:disabled)") || []);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      release();
      document.removeEventListener("keydown", onKey);
      trigger?.focus?.();
    };
  }, [cancel, open]);

  useEffect(() => () => abortRef.current?.abort(), []);

  if (!presence.mounted) return null;

  function chooseFile(candidate) {
    setFormError("");
    if (!candidate) return;
    const { file: next, error } = inspectFile(candidate, maxBytes, t);
    if (!next) {
      setFileError(error);
      return;
    }
    setFileError("");
    setFile(next);
    const suggested = titleFromFileName(next.name);
    if (!normalizeTitle(title) || normalizeTitle(title) === autoTitle) {
      setTitle(suggested);
      setAutoTitle(suggested);
      setNameError("");
    }
    window.requestAnimationFrame(() => {
      nameRef.current?.focus();
      nameRef.current?.select();
    });
  }

  function validateName(value) {
    const normalized = normalizeTitle(value);
    if (!normalized) return t("personalSheets.error.nameRequired");
    if (normalized.length > TITLE_MAX_LENGTH) return t("personalSheets.error.nameTooLong", { max: formatNumber(TITLE_MAX_LENGTH) });
    if (existingTitles.has(normalized.toLocaleLowerCase())) return t("personalSheets.error.nameTaken");
    return "";
  }

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    if (!file) {
      setFileError(t("personalSheets.error.notPdf"));
      return;
    }
    const problem = validateName(title);
    setNameError(problem);
    if (problem) {
      nameRef.current?.focus();
      return;
    }
    setFormError("");
    const controller = new AbortController();
    abortRef.current = controller;
    setProgress(0);
    try {
      const result = await personalSheetsApi.add(materialSlug, { title: normalizeTitle(title), file }, {
        signal: controller.signal,
        onProgress: (fraction) => setProgress(fraction)
      });
      abortRef.current = null;
      setProgress(null);
      onAdded(result);
    } catch (error) {
      abortRef.current = null;
      setProgress(null);
      const code = /** @type {any} */ (error)?.code;
      if (code === "aborted") return;
      if (code === "personal_sheet_title_taken") {
        setNameError(t("personalSheets.error.nameTaken"));
        nameRef.current?.focus();
      } else if (code === "personal_sheet_limit_reached") {
        setFormError(t("personalSheets.limitReached", { max: formatNumber(maxSheets) }));
      } else if (code === "personal_sheet_invalid") {
        setFileError(t("personalSheets.error.unreadable"));
      } else {
        setFormError(t("personalSheets.error.generic"));
      }
    }
  }

  function onDragEnter(event) {
    if (busy || !event.dataTransfer?.types?.includes("Files")) return;
    event.preventDefault();
    dragDepth.current += 1;
    setDragging(true);
  }

  function onDragLeave() {
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (!dragDepth.current) setDragging(false);
  }

  function onDrop(event) {
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    if (!busy) chooseFile(event.dataTransfer?.files?.[0] || null);
  }

  const fraction = progress ?? 0;
  const percent = Math.round(fraction * 100);
  const submitLabel = !busy
    ? t("personalSheets.upload")
    : fraction >= 1 ? t("personalSheets.saving") : t("personalSheets.uploading", { percent: formatNumber(percent) });

  return (
    <div className={`confirm-backdrop personal-add-backdrop${presence.closing ? " is-closing" : ""}`} inert={presence.closing ? "" : undefined} aria-hidden={presence.closing || undefined}>
      <button className="confirm-backdrop-dismiss" type="button" tabIndex={-1} aria-label={t("common.close")} disabled={busy} onClick={cancel} />
      <form className="confirm-dialog personal-add" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={dialogRef} tabIndex={-1} onSubmit={submit} noValidate>
        <header className="personal-add__head">
          <h2 id={titleId}>{t("personalSheets.dialogTitle")}</h2>
          <button type="button" className="personal-add__close" aria-label={t("common.close")} onClick={cancel}><Icon name="x" size={18} /></button>
        </header>

        <label
          className={`personal-drop${dragging ? " is-dragging" : ""}${file ? " has-file" : ""}${fileError ? " is-invalid" : ""}${busy ? " is-busy" : ""}`}
          onDragEnter={onDragEnter}
          onDragOver={(event) => { if (!busy) event.preventDefault(); }}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          <input
            type="file"
            accept="application/pdf,.pdf"
            className="visually-hidden"
            disabled={busy}
            aria-invalid={Boolean(fileError) || undefined}
            aria-describedby={fileError ? fileErrorId : undefined}
            onChange={(event) => { chooseFile(event.target.files?.[0] || null); event.target.value = ""; }}
          />
          {file ? (
            <span className="personal-drop__file">
              <span className="personal-drop__file-icon" aria-hidden="true"><Icon name="file" size={20} /><span>PDF</span></span>
              <span className="personal-drop__file-copy">
                <strong dir="auto">{file.name}</strong>
                <small>{t("personalSheets.sizeMb", { size: megabytes(file.size) })}</small>
              </span>
              {!busy && <span className="personal-drop__change">{t("personalSheets.changeFile")}</span>}
            </span>
          ) : (
            <span className="personal-drop__empty">
              <span className="personal-drop__icon" aria-hidden="true"><Icon name="upload" size={22} /></span>
              <strong>{dragging ? t("personalSheets.dropNow") : t("personalSheets.chooseFile")}</strong>
              <small>{t("personalSheets.dropHint", { size: formatNumber(maxMb) })}</small>
            </span>
          )}
          {busy && (
            <span className="personal-drop__progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={submitLabel}>
              <span className={fraction >= 1 ? "is-indeterminate" : ""} style={{ transform: `scaleX(${Math.max(0.02, fraction)})` }} />
            </span>
          )}
        </label>
        {fileError && <p className="personal-add__error" id={fileErrorId}>{fileError}</p>}

        <label className="field personal-add__field" htmlFor={nameId}>
          <span>{t("personalSheets.nameLabel")}</span>
          <input
            id={nameId}
            ref={nameRef}
            value={title}
            maxLength={TITLE_MAX_LENGTH}
            placeholder={t("personalSheets.namePlaceholder")}
            autoComplete="off"
            dir="auto"
            disabled={busy}
            aria-invalid={Boolean(nameError) || undefined}
            aria-describedby={nameError ? nameErrorId : undefined}
            onChange={(event) => { setTitle(event.target.value); if (nameError) setNameError(""); }}
            onBlur={() => { if (normalizeTitle(title)) setNameError(validateName(title)); }}
          />
          {nameError && <small className="personal-add__error" id={nameErrorId}>{nameError}</small>}
        </label>

        {formError && <p className="personal-add__error" role="alert">{formError}</p>}

        <div className="confirm-actions personal-add__actions">
          <button type="button" className="btn btn-soft" onClick={cancel}>{t("common.cancel")}</button>
          <button type="submit" className="btn btn-primary" disabled={busy || !file} aria-busy={busy || undefined}>{submitLabel}</button>
        </div>
      </form>
    </div>
  );
}
