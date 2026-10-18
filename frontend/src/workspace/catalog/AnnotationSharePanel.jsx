import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Heart, MoreHorizontal, Search, Trash2, X } from "lucide-react";
import { annotationSharesApi } from "../../api/annotationShares.js";
import { personalSheetsApi } from "../../api/personalSheets.js";
import { useI18n } from "../../components/I18nProvider.jsx";
import { ConfirmDialog } from "../../components/shared/ConfirmDialog.jsx";
import { acquireBodyScrollLock } from "../../lib/bodyScrollLock.js";
import { formatDate, formatNumber } from "../../lib/i18n.js";
import { usePresence } from "../../lib/motion.js";
import { isEmptySnapshot, snapshotBytes, snapshotFile, summarizeSnapshot, withoutPages } from "./annotationShare.js";
import "./annotation-share.css";

const NAME_MAX_LENGTH = 80;
const NOTE_MAX_LENGTH = 500;

function megabytes(bytes) {
  return formatNumber(Math.max(0.1, bytes / (1024 * 1024)), { maximumFractionDigits: 1 });
}

function pageName(page, t) {
  return page.kind === "added"
    ? t("marks.pageAdded", { page: formatNumber(page.page) })
    : t("marks.pagePdf", { page: formatNumber(page.page) });
}

/**
 * Pages as small tappable numbers, all on by default. A page you add shows as
 * "+3" (added after page 3). Tapping leaves a page out.
 */
function PageChips({ t, pages, excluded, onToggle, onAll, hint }) {
  return (
    <div className="marks-chips-wrap">
      <p className="marks-note">{hint}</p>
      <ul className="marks-chips">
        {pages.map((page) => {
          const included = !excluded.has(page.key);
          return (
            <li key={page.key}>
              <button type="button" className={`marks-chip${included ? " is-on" : ""}`} aria-pressed={included} aria-label={pageName(page, t)} onClick={() => onToggle(page.key)}>
                {page.kind === "added" ? `+${formatNumber(page.page)}` : formatNumber(page.page)}
              </button>
            </li>
          );
        })}
      </ul>
      {excluded.size > 0 && <button type="button" className="marks-link" onClick={onAll}>{t("marks.selectAll")}</button>}
    </div>
  );
}

/**
 * Marks on a catalog sheet. Browse what classmates shared and use it, or share
 * your own. A copy opens inside this same sheet, so Active Study keeps working.
 *
 * @param {{
 *   open: boolean,
 *   onClose: () => void,
 *   documentId: string,
 *   getSnapshot: () => { annotations: any[], notes: any[], virtualPages: any[] },
 *   defaultName?: string,
 *   basedOnId?: string,
 *   marksSet?: { id: string, author: string } | null,
 *   onSelectMarks: (marksId: string) => void,
 *   onOpenCopy: (copy: { sheetId: string, subject: string }) => void
 * }} props
 */
export function AnnotationSharePanel({ open, onClose, documentId, getSnapshot, defaultName = "", basedOnId = "", marksSet = null, onSelectMarks, onOpenCopy }) {
  const { t } = useI18n();
  const titleId = useId();
  const dialogRef = useRef(null);
  const presence = usePresence(open, 220);
  const [tab, setTab] = useState("search");
  const [list, setList] = useState({ shares: [], mineId: "", moderator: false, limits: { maxBytes: 25 * 1024 * 1024, copiesUsed: 0, copiesMax: 20 } });
  const [status, setStatus] = useState("idle");
  const [query, setQuery] = useState("");
  const [notices, setNotices] = useState([]);
  const [busyId, setBusyId] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState(null);
  const [copies, setCopies] = useState([]);
  const [deletingCopy, setDeletingCopy] = useState(null);

  const loadCopies = useCallback(async () => {
    try {
      setCopies(await annotationSharesApi.copies(documentId));
    } catch {
      setCopies([]);
    }
  }, [documentId]);

  const load = useCallback(async (nextQuery = "") => {
    setStatus("loading");
    setError("");
    try {
      const [result, pending] = await Promise.all([
        annotationSharesApi.list(documentId, { q: nextQuery }),
        annotationSharesApi.notices(documentId).catch(() => [])
      ]);
      setList(result);
      setNotices(pending);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, [documentId]);

  useEffect(() => {
    if (!open) return undefined;
    setTab("search");
    setMessage("");
    setQuery("");
    void load("");
    void loadCopies();
    return undefined;
  }, [load, loadCopies, open]);

  useEffect(() => {
    if (!open) return undefined;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const release = acquireBodyScrollLock();
    dialogRef.current?.focus();
    function onKey(event) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => {
      release();
      document.removeEventListener("keydown", onKey);
      trigger?.focus?.();
    };
  }, [onClose, open]);

  useEffect(() => {
    if (!open) return undefined;
    const handle = window.setTimeout(() => { void load(query); }, 280);
    return () => window.clearTimeout(handle);
    // Typing re-queries; opening already loaded the unfiltered list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  async function copyShare(share, pages = null) {
    setBusyId(share.id);
    setError("");
    try {
      const copy = await annotationSharesApi.copy(documentId, share.id, pages);
      onOpenCopy(copy);
    } catch (failure) {
      const code = /** @type {any} */ (failure)?.code;
      if (code === "annotation_copy_limit_reached") setError(t("marks.error.copyLimit", { max: formatNumber(list.limits.copiesMax) }));
      else if (/** @type {any} */ (failure)?.status === 404) { setError(t("marks.error.gone")); void load(query); }
      else setError(t("marks.error.generic"));
    } finally {
      setBusyId("");
    }
  }

  async function toggleLike(share) {
    setBusyId(share.id);
    try {
      const result = await annotationSharesApi.like(documentId, share.id, !share.liked);
      setList((current) => ({ ...current, shares: current.shares.map((item) => (item.id === share.id ? { ...item, liked: result.liked, likes: result.likes } : item)) }));
    } catch {
      setError(t("marks.error.generic"));
    } finally {
      setBusyId("");
    }
  }

  async function reportShare(share) {
    setBusyId(share.id);
    try {
      await annotationSharesApi.report(documentId, share.id);
      setMessage(t("marks.reported"));
    } catch {
      setError(t("marks.error.generic"));
    } finally {
      setBusyId("");
    }
  }

  async function removeShare(share) {
    setRemoving(null);
    setBusyId(share.id);
    try {
      await annotationSharesApi.remove(documentId, share.id);
      setMessage(share.mine ? t("marks.removed") : t("marks.removedModerator"));
      await load(query);
    } catch {
      setError(t("marks.error.generic"));
    } finally {
      setBusyId("");
    }
  }

  async function deleteCopy(copy) {
    setDeletingCopy(null);
    try {
      await personalSheetsApi.remove([copy.id]);
      if (marksSet?.id === copy.id) onSelectMarks("");
      setMessage(t("marks.copyDeleted"));
      await loadCopies();
    } catch {
      setError(t("marks.error.generic"));
    }
  }

  async function dismissNotice(notice) {
    setNotices((current) => current.filter((item) => item.id !== notice.id));
    await annotationSharesApi.dismiss(documentId, notice.id).catch(() => undefined);
  }

  if (!presence.mounted) return null;

  const mine = list.shares.find((share) => share.id === list.mineId) || null;

  return (
    <div className={`confirm-backdrop marks-backdrop${presence.closing ? " is-closing" : ""}`} inert={presence.closing ? "" : undefined} aria-hidden={presence.closing || undefined}>
      <button className="confirm-backdrop-dismiss" type="button" tabIndex={-1} aria-label={t("common.close")} onClick={onClose} />
      <div className="confirm-dialog marks-panel" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={dialogRef} tabIndex={-1}>
        <header className="marks-panel__head">
          <h2 id={titleId}>{t("marks.title")}</h2>
          <button type="button" className="marks-icon-button" aria-label={t("common.close")} onClick={onClose}><X size={18} /></button>
        </header>

        {marksSet && (
          <p className="marks-viewing" role="status" dir="auto">
            <span>{marksSet.author ? t("marks.viewing", { author: marksSet.author }) : t("marks.viewingAnonymous")}</span>
            <button type="button" className="marks-link" onClick={() => { onSelectMarks(""); onClose(); }}>{t("marks.useMine")}</button>
          </p>
        )}

        <div className="marks-tabs" role="tablist" aria-label={t("marks.title")}>
          <button type="button" role="tab" id="marks-tab-search" aria-selected={tab === "search"} aria-controls="marks-body" className={tab === "search" ? "is-active" : ""} onClick={() => setTab("search")}>
            {t("marks.tabSearch")}
          </button>
          <button type="button" role="tab" id="marks-tab-add" aria-selected={tab === "add"} aria-controls="marks-body" className={tab === "add" ? "is-active" : ""} onClick={() => setTab("add")}>
            {mine ? t("marks.tabUpdate") : t("marks.tabAdd")}
          </button>
        </div>

        {message && <p className="marks-note" role="status">{message}</p>}
        {error && <p className="marks-error" role="alert">{error}</p>}

        <div className="marks-body" id="marks-body" role="tabpanel" aria-labelledby={`marks-tab-${tab}`}>
          {tab === "search" && (
            <SearchView
              t={t}
              status={status}
              list={list}
              query={query}
              onQuery={setQuery}
              notices={notices}
              copies={copies}
              marksSet={marksSet}
              busyId={busyId}
              onRetry={() => load(query)}
              onCopy={copyShare}
              onLike={toggleLike}
              onReport={reportShare}
              onRemove={setRemoving}
              onDismiss={dismissNotice}
              onUseCopy={(id) => { onSelectMarks(id); onClose(); }}
              onDeleteCopy={setDeletingCopy}
              documentId={documentId}
              onGone={() => load(query)}
            />
          )}
          {tab === "add" && (
            <AddView
              key={mine?.id || "new"}
              t={t}
              documentId={documentId}
              getSnapshot={getSnapshot}
              defaultName={defaultName}
              basedOnId={basedOnId}
              mine={mine}
              maxBytes={list.limits.maxBytes}
              onDone={async (text) => { setMessage(text); setTab("search"); await load(""); }}
              onAskRemove={setRemoving}
            />
          )}
        </div>
      </div>
      <ConfirmDialog
        open={Boolean(deletingCopy)}
        title={t("marks.deleteCopy")}
        message={t("marks.deleteCopyConfirm")}
        confirmLabel={t("marks.deleteCopy")}
        onCancel={() => setDeletingCopy(null)}
        onConfirm={() => { if (deletingCopy) void deleteCopy(deletingCopy); }}
      />
      <ConfirmDialog
        open={Boolean(removing)}
        title={t("marks.remove")}
        message={removing?.mine ? t("marks.removeConfirm") : t("marks.moderatorRemoveConfirm")}
        confirmLabel={t("marks.remove")}
        onCancel={() => setRemoving(null)}
        onConfirm={() => { if (removing) void removeShare(removing); }}
      />
    </div>
  );
}

function ShareCard({ t, share, moderator, busy, documentId, onCopy, onLike, onReport, onRemove, onGone }) {
  const [choosing, setChoosing] = useState(false);
  const [pages, setPages] = useState(null);
  const [excluded, setExcluded] = useState(() => new Set());
  const [menu, setMenu] = useState(false);
  const author = share.anonymous ? t("marks.anonymous") : share.author;

  async function toggleChoosing() {
    if (choosing) { setChoosing(false); return; }
    setChoosing(true);
    if (pages) return;
    try {
      const detail = await annotationSharesApi.detail(documentId, share.id);
      setPages(detail.pages);
    } catch {
      setChoosing(false);
      onGone();
    }
  }

  const chosen = pages ? pages.filter((page) => !excluded.has(page.key)) : [];
  const partial = choosing && pages && excluded.size > 0;

  return (
    <li className={`marks-card${share.mine ? " is-mine" : ""}`}>
      <div className="marks-card__top">
        <strong dir="auto">{share.mine ? t("marks.yours", { name: author }) : author}</strong>
        <button type="button" className={`marks-like${share.liked ? " is-liked" : ""}`} aria-pressed={share.liked} aria-label={share.liked ? t("marks.unlike") : t("marks.like")} disabled={busy} onClick={() => onLike(share)}>
          <Heart size={16} fill={share.liked ? "currentColor" : "none"} aria-hidden="true" />
          <span>{formatNumber(share.likes)}</span>
        </button>
      </div>
      {share.note && <p className="marks-card__note" dir="auto">{share.note}</p>}
      <p className="marks-card__meta">
        {t("marks.summaryShort", { pages: formatNumber(share.pages) })}
        {" · "}{formatDate(share.updatedAt, { dateStyle: "medium" })}
        {share.version > 1 && ` · ${t("marks.version", { version: formatNumber(share.version) })}`}
        {share.basedOn && ` · ${t("marks.basedOn", { name: share.basedOn })}`}
      </p>
      {share.ownerEmail && <p className="marks-card__meta" dir="ltr">{share.ownerEmail} · {t("marks.reportCount", { count: formatNumber(share.reports || 0) })}</p>}

      {choosing && pages && (
        <PageChips
          t={t}
          pages={pages}
          excluded={excluded}
          hint={t("marks.chipsHintCopy")}
          onToggle={(key) => setExcluded((current) => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; })}
          onAll={() => setExcluded(new Set())}
        />
      )}

      <div className="marks-card__actions">
        {!share.mine && (
          <button type="button" className="btn btn-primary" disabled={busy || (partial && !chosen.length)} aria-busy={busy || undefined} onClick={() => onCopy(share, partial ? chosen.map((page) => page.key) : null)}>
            {partial ? t("marks.useSelected", { count: formatNumber(chosen.length) }) : share.copiedVersion ? t("marks.copyAgain") : t("marks.useThese")}
          </button>
        )}
        {!share.mine && <button type="button" className="marks-link" aria-expanded={choosing} onClick={toggleChoosing}>{choosing ? t("marks.hidePages") : t("marks.customize")}</button>}
        <button type="button" className="marks-icon-button marks-card__more" aria-label={t("marks.moreActions")} aria-expanded={menu} onClick={() => setMenu((value) => !value)}><MoreHorizontal size={18} /></button>
      </div>
      {menu && (
        <div className="marks-card__menu">
          {!share.mine && <button type="button" className="marks-link" onClick={() => { setMenu(false); onReport(share); }}>{t("marks.report")}</button>}
          {(share.mine || moderator) && <button type="button" className="marks-link is-danger" onClick={() => { setMenu(false); onRemove(share); }}>{t("marks.remove")}</button>}
        </div>
      )}
    </li>
  );
}

function SearchView({ t, status, list, query, onQuery, notices, copies, marksSet, busyId, onRetry, onCopy, onLike, onReport, onRemove, onDismiss, onUseCopy, onDeleteCopy, documentId, onGone }) {
  return (
    <>
      {notices.length > 0 && (
        <ul className="marks-notices" aria-label={t("marks.noticesLabel")}>
          {notices.map((notice) => (
            <li key={`${notice.id}-${notice.kind}`}>
              <span dir="auto">
                {notice.kind === "removed"
                  ? t("marks.noticeRemoved", { author: notice.author || t("marks.anonymous") })
                  : t("marks.noticeUpdated", { author: notice.author || t("marks.anonymous") })}
              </span>
              {notice.kind === "updated" && (
                <button type="button" className="marks-link" disabled={busyId === notice.id} onClick={() => { const share = list.shares.find((item) => item.id === notice.id); if (share) void onCopy(share); }}>
                  {t("marks.getUpdate")}
                </button>
              )}
              <button type="button" className="marks-icon-button" aria-label={t("marks.dismiss")} onClick={() => onDismiss(notice)}><X size={16} /></button>
            </li>
          ))}
        </ul>
      )}

      {copies.length > 0 && (
        <section className="marks-copies" aria-label={t("marks.yourCopies")}>
          <h3 className="marks-subtitle">{t("marks.yourCopies")}</h3>
          <ul>
            {copies.map((copy) => {
              const current = marksSet?.id === copy.id;
              return (
                <li key={copy.id}>
                  <span dir="auto">{copy.author ? t("marks.copyBy", { author: copy.author }) : t("marks.copyAnonymous")}</span>
                  {current
                    ? <span className="marks-current">{t("marks.showing")}</span>
                    : <button type="button" className="btn btn-soft" onClick={() => onUseCopy(copy.id)}>{t("marks.openCopy")}</button>}
                  <button type="button" className="marks-icon-button is-danger" aria-label={t("marks.deleteCopy")} onClick={() => onDeleteCopy(copy)}><Trash2 size={16} /></button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <label className="marks-search">
        <Search size={16} aria-hidden="true" />
        <input type="search" value={query} placeholder={t("marks.searchPlaceholder")} aria-label={t("marks.searchPlaceholder")} maxLength={NAME_MAX_LENGTH} dir="auto" onChange={(event) => onQuery(event.target.value)} />
      </label>

      {status === "loading" && !list.shares.length && <p className="marks-empty" role="status">{t("marks.loading")}</p>}
      {status === "error" && (
        <p className="marks-empty" role="alert">
          {t("marks.error.load")} <button type="button" className="marks-link" onClick={onRetry}>{t("marks.retry")}</button>
        </p>
      )}
      {status === "ready" && !list.shares.length && <p className="marks-empty">{query.trim() ? t("marks.noMatches") : t("marks.empty")}</p>}

      <ul className="marks-list">
        {list.shares.map((share) => (
          <ShareCard
            key={share.id}
            t={t}
            share={share}
            moderator={list.moderator}
            busy={busyId === share.id}
            documentId={documentId}
            onCopy={onCopy}
            onLike={onLike}
            onReport={onReport}
            onRemove={onRemove}
            onGone={onGone}
          />
        ))}
      </ul>
      <p className="marks-footnote">{t("marks.copiesUsed", { used: formatNumber(list.limits.copiesUsed), max: formatNumber(list.limits.copiesMax) })}</p>
    </>
  );
}

function AddView({ t, documentId, getSnapshot, defaultName, basedOnId, mine, maxBytes, onDone, onAskRemove }) {
  const nameId = useId();
  const noteId = useId();
  const abortRef = useRef(null);
  const [name, setName] = useState(mine && !mine.anonymous ? mine.author : defaultName);
  const [anonymous, setAnonymous] = useState(mine ? mine.anonymous : false);
  const [note, setNote] = useState(mine?.note || "");
  // Read once when the tab opens: the panel is modal, so the reader cannot change underneath it.
  const [snapshot] = useState(() => getSnapshot());
  const [excluded, setExcluded] = useState(() => new Set());
  const [choosing, setChoosing] = useState(false);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState("");

  const summary = useMemo(() => summarizeSnapshot(snapshot), [snapshot]);
  const shared = useMemo(() => withoutPages(snapshot, excluded), [excluded, snapshot]);
  const bytes = useMemo(() => snapshotBytes(shared), [shared]);
  const sharedPages = summary.pages.length - excluded.size;
  const nothing = isEmptySnapshot(shared);

  useEffect(() => () => abortRef.current?.abort(), []);

  async function publish(event) {
    event.preventDefault();
    if (!anonymous && !name.trim()) { setError(t("marks.error.name")); return; }
    if (nothing) { setError(t("marks.error.empty")); return; }
    if (bytes > maxBytes) { setError(t("marks.error.tooLarge", { max: megabytes(maxBytes) })); return; }
    const controller = new AbortController();
    abortRef.current = controller;
    setProgress(0);
    setError("");
    try {
      const result = await annotationSharesApi.publish(documentId, {
        displayName: name.trim(), anonymous, note: note.trim(), snapshot: snapshotFile(shared), basedOn: basedOnId
      }, { onProgress: setProgress, signal: controller.signal });
      abortRef.current = null;
      setProgress(null);
      await onDone(result.created ? t("marks.thanks") : t("marks.thanksUpdated", { version: formatNumber(result.version) }));
    } catch (failure) {
      abortRef.current = null;
      setProgress(null);
      const code = /** @type {any} */ (failure)?.code;
      if (code === "aborted") return;
      if (code === "annotation_share_empty") setError(t("marks.error.empty"));
      else if (code === "annotation_share_too_large") setError(t("marks.error.tooLarge", { max: megabytes(maxBytes) }));
      else setError(t("marks.error.publish"));
    }
  }

  const busy = progress !== null;
  const percent = Math.round((progress ?? 0) * 100);

  return (
    <form className="marks-form" onSubmit={publish} noValidate aria-label={mine ? t("marks.tabUpdate") : t("marks.tabAdd")}>
      <label className="field personal-add__field" htmlFor={nameId}>
        <span>{t("marks.nameLabel")}</span>
        <input id={nameId} value={name} maxLength={NAME_MAX_LENGTH} autoComplete="off" dir="auto" disabled={anonymous || busy} placeholder={t("marks.namePlaceholder")} onChange={(event) => setName(event.target.value)} />
      </label>
      <label className="marks-check">
        <input type="checkbox" checked={anonymous} disabled={busy} onChange={(event) => setAnonymous(event.target.checked)} />
        <span>{t("marks.anonymousLabel")}</span>
      </label>
      <label className="field personal-add__field" htmlFor={noteId}>
        <span>{t("marks.noteLabel")}</span>
        <textarea id={noteId} value={note} maxLength={NOTE_MAX_LENGTH} rows={2} dir="auto" disabled={busy} placeholder={t("marks.notePlaceholder")} onChange={(event) => setNote(event.target.value)} />
      </label>

      <div className="marks-summary">
        <p className={bytes > maxBytes ? "is-over" : ""} role="status">
          {nothing ? t("marks.error.empty") : t("marks.sharingSummary", { pages: formatNumber(sharedPages), size: megabytes(bytes) })}
        </p>
        {summary.pages.length > 0 && (
          <button type="button" className="marks-link" aria-expanded={choosing} onClick={() => setChoosing((value) => !value)}>
            {choosing ? t("marks.hidePages") : t("marks.previewChoose")}
          </button>
        )}
      </div>
      {choosing && (
        <PageChips
          t={t}
          pages={summary.pages}
          excluded={excluded}
          hint={t("marks.chipsHintShare")}
          onToggle={(key) => setExcluded((current) => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; })}
          onAll={() => setExcluded(new Set())}
        />
      )}

      {error && <p className="marks-error" role="alert">{error}</p>}
      {busy && (
        <span className="personal-drop__progress marks-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={t("marks.uploading", { percent: formatNumber(percent) })}>
          <span style={{ transform: `scaleX(${Math.max(0.02, progress ?? 0)})` }} />
        </span>
      )}
      <div className="confirm-actions">
        {mine && <button type="button" className="marks-link is-danger" disabled={busy} onClick={() => onAskRemove(mine)}>{t("marks.remove")}</button>}
        <button type="submit" className="btn btn-primary" disabled={busy || nothing} aria-busy={busy || undefined}>
          {busy ? t("marks.uploading", { percent: formatNumber(percent) }) : mine ? t("marks.update") : t("marks.publish")}
        </button>
      </div>
    </form>
  );
}
