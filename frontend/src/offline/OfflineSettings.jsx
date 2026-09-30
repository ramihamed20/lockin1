import { useCallback, useEffect, useState } from "react";
import { useI18n } from "../components/I18nProvider.jsx";
import { Switch } from "../components/ui/index.jsx";
import { ConfirmDialog } from "../components/shared/ConfirmDialog.jsx";
import { Icon } from "../lib/icons.jsx";
import { formatDateTime } from "../lib/i18n.js";
import { offlineDatabase } from "./database.js";
import { clearOfflineDownloads, downloadOfflineItem, fetchOfflineManifest, offlineDownloadStats, offlineItemState, readOfflineManifest, removeOfflineItem } from "./downloads.js";
import { DEFAULT_OFFLINE_PREFERENCES, readOfflinePreferences, saveOfflinePreferences, synchronizeOffline } from "./coordinator.js";
import { offlineAccessStatus } from "./lease.js";
import { dismissFailedOperation, offlineOperationConflicts, pendingOfflineOperations } from "./queue.js";
import { getConnectionSnapshot, subscribeConnection } from "../lib/connectionState.js";

const CONTENT_TYPES = [["sheet", "offline.sheets"], ["summary", "offline.summaries"], ["active_study", "offline.activeStudy"], ["questions", "offline.questions"]];
const EDITIONS = [["university", "offline.universityEdition"], ["lockin", "offline.lockinEdition"]];
const STATE_LABELS = { downloaded: "offline.downloaded", update: "offline.updateAvailable", incomplete: "offline.incomplete", download: "offline.download", unavailable: "offline.download" };

function bytesLabel(value) {
  return value >= 1024 * 1024 ? `${(value / (1024 * 1024)).toFixed(1)} MB` : `${Math.round(value / 1024)} KB`;
}

/** Subject → sheet → edition, built from the manifest's metadata only. */
function sheetsFor(manifest, subjectId) {
  const sheets = new Map();
  for (const item of manifest?.items || []) {
    if (item.subject_id !== subjectId) continue;
    const entry = sheets.get(item.sheet_id) || { id: item.sheet_id, title: "", editions: new Map(), questions: [] };
    if (item.type === "questions") entry.questions.push(item);
    else {
      if (item.type === "sheet" && !entry.title) entry.title = item.title;
      const edition = entry.editions.get(item.edition) || {};
      edition[item.type] = item;
      entry.editions.set(item.edition, edition);
    }
    sheets.set(item.sheet_id, entry);
  }
  return [...sheets.values()].map((sheet) => ({ ...sheet, title: sheet.title || [...sheet.editions.values()][0]?.active_study?.title || "" }));
}

/** Everything one edition needs, in the order its dependencies download. */
function editionItems(sheet, edition) {
  const parts = sheet.editions.get(edition) || {};
  return [parts.sheet, parts.active_study, parts.summary, ...sheet.questions].filter(Boolean);
}

export default function OfflineSettings({ userId }) {
  const { t, locale } = useI18n();
  const [preferences, setPreferences] = useState(/** @type {any} */ (DEFAULT_OFFLINE_PREFERENCES));
  const [manifest, setManifest] = useState(null);
  const [downloads, setDownloads] = useState({ items: [], count: 0, bytes: 0 });
  const [itemStates, setItemStates] = useState(/** @type {Map<string, string>} */ (new Map()));
  const [lease, setLease] = useState(/** @type {{available: boolean, reason?: string, claims?: {iat: number, exp: number}}} */ ({ available: false }));
  const [lastSync, setLastSync] = useState(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [conflicts, setConflicts] = useState([]);
  const [syncState, setSyncState] = useState("");
  const [busyId, setBusyId] = useState("");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [failedId, setFailedId] = useState("");
  const [manage, setManage] = useState(false);
  // One confirmation at a time, in the app's own dialog rather than the
  // browser's: { message, run }.
  const [confirming, setConfirming] = useState(/** @type {{ message: string, run: () => Promise<void> } | null} */ (null));
  const [online, setOnline] = useState(() => navigator.onLine && getConnectionSnapshot().status === "connected");

  const refresh = useCallback(async () => {
    const [nextPreferences, nextManifest, nextDownloads, nextLease, nextSync, nextPending, nextConflicts] = await Promise.all([
      readOfflinePreferences(userId), readOfflineManifest(userId), offlineDownloadStats(userId),
      offlineAccessStatus(userId), offlineDatabase.get(userId, "lastSync"), pendingOfflineOperations(userId), offlineOperationConflicts(userId)
    ]);
    setPreferences(nextPreferences);
    setManifest(nextManifest);
    setDownloads(nextDownloads);
    const states = await Promise.all((nextManifest?.items || []).map(async (item) => [item.id, await offlineItemState(userId, item, nextManifest)]));
    setItemStates(new Map(states));
    setLease(nextLease);
    setLastSync(nextSync);
    setPendingCount(nextPending.length);
    setConflicts(nextConflicts);
  }, [userId]);

  useEffect(() => {
    let active = true;
    refresh().catch((cause) => { if (active) setError(cause.message); });
    const handleOnline = () => setOnline(navigator.onLine && getConnectionSnapshot().status === "connected");
    const handleSync = (event) => {
      if (event.detail?.userId !== userId) return;
      setSyncState(event.detail.state);
      if (["synced", "partial", "connection"].includes(event.detail.state)) void refresh();
    };
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOnline);
    window.addEventListener("lock-in:offline-sync", handleSync);
    const unsubscribe = subscribeConnection(handleOnline);
    return () => { active = false; window.removeEventListener("online", handleOnline); window.removeEventListener("offline", handleOnline); window.removeEventListener("lock-in:offline-sync", handleSync); unsubscribe(); };
  }, [refresh, userId]);

  async function checkConnection() {
    setError("");
    try {
      await synchronizeOffline(userId, setSyncState, { force: true });
      await refresh();
    } catch (cause) {
      setSyncState("connection");
      setError(cause.message);
    }
  }

  async function updatePreferences(next) {
    setPreferences(next);
    try {
      await saveOfflinePreferences(userId, next);
      if (next.automatic && online) void checkConnection();
    } catch (cause) { setError(cause.message); }
  }

  /** Downloads each item with its dependencies; one failure leaves the rest usable and retryable. */
  async function downloadAll(busyKey, items) {
    setBusyId(busyKey);
    setError("");
    setFailedId("");
    setProgress(0);
    let failure = null;
    if (!(await offlineAccessStatus(userId)).available) {
      try { await synchronizeOffline(userId, setSyncState, { force: true }); }
      catch (cause) { failure = cause; }
    }
    if (!(await offlineAccessStatus(userId)).available) {
      setError(failure?.message || t("offline.verificationRequired"));
      setFailedId(busyKey);
      setBusyId("");
      return;
    }
    // The list on screen was read when Settings opened. Content edited since
    // then is served at a new version, which the stale manifest's checksum
    // would reject as an incomplete download; ask for the current one first.
    const current = await fetchOfflineManifest(userId).catch(() => null);
    const pending = current ? items.map((item) => current.items.find((entry) => entry.id === item.id)).filter(Boolean) : items;
    for (const [index, item] of pending.entries()) {
      try {
        await downloadOfflineItem(userId, item, (value) => setProgress((index + value) / pending.length), { manual: true, manifest: current || manifest });
      } catch (cause) { failure ||= cause; }
    }
    if (failure) { setError(failure.message); setFailedId(busyKey); }
    await refresh().catch(() => undefined);
    setBusyId("");
    setProgress(0);
  }

  async function removeNow(busyKey, items) {
    setBusyId(busyKey);
    try {
      for (const item of items) await removeOfflineItem(userId, item.id);
      await refresh();
    } catch (cause) { setError(cause.message); }
    finally { setBusyId(""); }
  }

  function removeAll(busyKey, items, confirmMessage = "") {
    if (!confirmMessage) { void removeNow(busyKey, items); return; }
    setConfirming({ message: confirmMessage, run: () => removeNow(busyKey, items) });
  }

  async function clearNow() {
    setBusyId("all");
    try { await clearOfflineDownloads(userId); await refresh(); }
    catch (cause) { setError(cause.message); }
    finally { setBusyId(""); }
  }

  function clearAll() {
    setConfirming({ message: t("offline.confirmClear"), run: clearNow });
  }

  async function dismiss(operationId) {
    await dismissFailedOperation(userId, operationId).catch(() => undefined);
    await refresh().catch(() => undefined);
  }

  const stored = new Map(downloads.items.map((item) => [item.id, item]));
  const until = lease.claims?.exp ? lease.claims.exp * 1000 : 0;
  const remaining = Math.max(0, until - Date.now());
  const duration = t("offline.durationHM", { hours: Math.floor(remaining / 3_600_000), minutes: Math.floor((remaining % 3_600_000) / 60_000) });
  // In the interface language, not the browser's: an English screen showed an
  // Arabic-formatted date on an Arabic-locale device.
  const dateLabel = (value) => value ? formatDateTime(value, {}, locale) : t("offline.never");
  const busy = Boolean(busyId);
  const itemLabel = (item) => busyId === item.id ? `${t("offline.downloading")} ${Math.round(progress * 100)}%` : t(STATE_LABELS[itemStates.get(item.id) || "download"]);
  const subjectItems = (subject) => (manifest?.items || []).filter((item) => item.subject_id === subject.id && item.available);
  const subjectState = (subject) => {
    const items = subjectItems(subject);
    if (!items.length) return "download";
    const states = items.map((item) => itemStates.get(item.id) || "download");
    if (states.every((state) => state === "downloaded")) return "downloaded";
    if (states.some((state) => state === "update")) return "update";
    return states.some((state) => state === "downloaded" || state === "incomplete") ? "incomplete" : "download";
  };
  const groupedSubjects = [];
  for (const subject of manifest?.subjects || []) {
    const key = `${subject.program}:${subject.cohort}`;
    let group = groupedSubjects.find((entry) => entry.key === key);
    if (!group) { group = { key, label: `${subject.program} · ${subject.cohort}`, subjects: [] }; groupedSubjects.push(group); }
    group.subjects.push(subject);
  }

  const itemButton = (item, label = "") => <span key={item.id} className="offline-item">
    <button type="button" className="btn btn-soft compact" disabled={busy || !online || itemStates.get(item.id) === "downloaded"} onClick={() => downloadAll(item.id, [item])}>
      {label ? `${label} · ${itemLabel(item)}` : itemLabel(item)}
    </button>
    {stored.has(item.id) && <button type="button" className="btn btn-soft compact" disabled={busy} onClick={() => removeAll(item.id, [item])}>{t("offline.remove")}</button>}
  </span>;

  // What the student needs to know, in their words: can I study offline, for
  // how long, and is anything waiting. The signed lease, the queue and the
  // manifest stay underneath; these rows only report them.
  const status = lease.available ? "ready" : lease.reason === "clock_rollback" ? "rollback" : lease.claims ? "expired" : "verify";
  const statusTitle = status === "ready" ? t("offline.available") : status === "verify" ? t("offline.verificationRequired") : t("offline.expired");
  const statusDetail = status === "ready"
    ? t("offline.statusReady", { duration })
    : status === "rollback" ? t("offline.clockRollback") : status === "expired" ? t("offline.expiredMessage") : t("offline.statusVerify");
  const syncing = syncState === "verifying" || syncState === "syncing" || syncState === "downloading";
  const syncLabel = syncState ? t(`offline.sync.${syncState}`) : lease.claims ? t("offline.checkedAt", { time: dateLabel(lease.claims.iat * 1000) }) : "";

  return <section className="settings-v2-section offline-v2" id="settings-offline" aria-labelledby="settings-offline-heading">
    <div className="ui-group-block settings-v2-block">
      <div className={`ui-group offline-v2-status is-${status}`}>
        <div className="ui-row offline-v2-status-row">
          <span className={`ui-row-icon offline-v2-status-icon is-${status}`} aria-hidden="true"><Icon name={status === "ready" ? "check" : "alert-triangle"} size={17} /></span>
          <span className="ui-row-body"><strong>{statusTitle}</strong><small>{statusDetail}</small></span>
          <span className={`offline-v2-connection${online ? " is-online" : ""}`}>{online ? t("offline.online") : t("offline.offline")}</span>
        </div>
        {pendingCount > 0 && <div className="ui-row"><span className="ui-row-body"><span>{t("offline.pendingChanges")}</span></span><span className="ui-row-value">{pendingCount}</span></div>}
        <button type="button" className="ui-row offline-v2-sync" onClick={checkConnection} disabled={syncing || !online}>
          <span className="ui-row-body"><span>{t("offline.syncNow")}</span>{syncLabel && <small role="status">{syncLabel}</small>}</span>
          {syncing && <span className="offline-v2-spinner" aria-hidden="true" />}
        </button>
      </div>
      {error && <p className="ui-group-footer form-error" role="alert">{error}</p>}
    </div>

    {conflicts.length > 0 && <div className="ui-group-block settings-v2-block offline-conflicts" role="group" aria-label={t("offline.failedChanges")}>
      <h3 className="ui-group-title">{t("offline.failedChanges")}</h3>
      <div className="ui-group">
        {conflicts.slice(0, 5).map((operation) => <div key={operation.operation_id} className="ui-row">
          <span className="ui-row-body"><span dir="auto">{operation.reason || operation.operation_type}</span></span>
          <button type="button" className="btn btn-soft compact" onClick={() => dismiss(operation.operation_id)}>{t("offline.dismiss")}</button>
        </div>)}
      </div>
      <p className="ui-group-footer" role="status">{t("offline.conflicts", { count: conflicts.length })}</p>
    </div>}

    <div className="ui-group-block settings-v2-block">
      <h3 className="ui-group-title">{t("offline.downloadsTitle")}</h3>
      <div className="ui-group">
        <div className="ui-row">
          <span className="ui-row-body"><label htmlFor="offline-auto">{t("offline.automatic")}</label><small>{t("offline.automaticHint")}</small></span>
          <Switch id="offline-auto" checked={Boolean(preferences.automatic)} onCheckedChange={(next) => updatePreferences({ ...preferences, automatic: next })} />
        </div>
      </div>
      {preferences.automatic && <>
        <h4 className="ui-group-title offline-v2-subtitle" id="offline-network-title">{t("offline.downloadOver")}</h4>
        <div className="ui-group offline-v2-choices" role="radiogroup" aria-labelledby="offline-network-title">
          {[["wifi", "offline.wifi"], ["any", "offline.anyNetwork"]].map(([value, label]) => <label key={value} className="ui-row offline-v2-choice">
            <input className="visually-hidden" type="radio" name="offline-network" checked={preferences.network === value} onChange={() => updatePreferences({ ...preferences, network: value })} />
            <span className="ui-row-body"><span>{t(label)}</span></span>
            <Icon className="offline-v2-check" name="check" size={17} aria-hidden="true" />
          </label>)}
        </div>
        <h4 className="ui-group-title offline-v2-subtitle" id="offline-types-title">{t("offline.contentTypes")}</h4>
        <div className="ui-group offline-v2-choices" role="group" aria-labelledby="offline-types-title">
          {CONTENT_TYPES.map(([type, label]) => <label key={type} className="ui-row offline-v2-choice">
            <input className="visually-hidden" type="checkbox" checked={Boolean(preferences.types[type])} onChange={(event) => updatePreferences({ ...preferences, types: { ...preferences.types, [type]: event.target.checked } })} />
            <span className="ui-row-body"><span>{t(label)}</span></span>
            <Icon className="offline-v2-check" name="check" size={17} aria-hidden="true" />
          </label>)}
        </div>
      </>}
    </div>

    {groupedSubjects.map((group) => <div key={group.key} className="ui-group-block settings-v2-block offline-subject-group" role="group" aria-label={group.label}>
      {/* One program is the usual case, and its internal codes mean nothing
          to a student; several are told apart by their labels. */}
      <h3 className="ui-group-title" dir="auto">{groupedSubjects.length > 1 ? group.label : t("offline.subjectsTitle")}</h3>
      <div className="ui-group">
        {group.subjects.map((subject) => {
          const items = subjectItems(subject);
          const state = subjectState(subject);
          const working = busyId === subject.id;
          const stateText = !items.length ? t("offline.nothingToDownload") : state === "download" ? t("offline.notDownloaded") : t(STATE_LABELS[state]);
          return <div key={subject.id} className="ui-row offline-v2-subject">
            <span className="ui-row-body"><strong dir="auto">{subject.title}</strong><small role="status">{working ? `${t("offline.downloading")} ${Math.round(progress * 100)}%` : stateText}</small>
              {working && <span className="offline-v2-progress" aria-hidden="true"><span style={{ transform: `scaleX(${progress})` }} /></span>}
            </span>
            {!items.length ? null : state === "downloaded" && !working
              ? <Icon className="offline-v2-done" name="check" size={18} aria-hidden="true" />
              : <button type="button" className="btn btn-soft compact" disabled={busy || !online || !items.length || state === "downloaded"} onClick={() => downloadAll(subject.id, items)}>
                {working ? `${Math.round(progress * 100)}%` : failedId === subject.id ? t("offline.incomplete") : state === "update" ? t("offline.updateAvailable") : t("offline.downloadSubject")}
              </button>}
          </div>;
        })}
      </div>
    </div>)}

    <div className="ui-group-block settings-v2-block">
      <h3 className="ui-group-title">{t("offline.storageTitle")}</h3>
      <div className="ui-group">
        <div className="ui-row">
          <span className="ui-row-body"><span>{t("offline.storageUsed")}</span></span>
          <span className="ui-row-value">{t("offline.storageSummary", { size: bytesLabel(downloads.bytes), count: downloads.count })}</span>
        </div>
        <div className="ui-row">
          <span className="ui-row-body"><span>{t("offline.lastSync")}</span></span>
          <span className="ui-row-value">{dateLabel(lastSync)}</span>
        </div>
        <button type="button" className="ui-row offline-v2-disclosure" onClick={() => setManage(!manage)} aria-expanded={manage}>
          <span className="ui-row-body"><span>{t("offline.manage")}</span></span>
          <Icon className="ui-row-chevron" name="chevron-right" size={17} />
        </button>
      </div>
      {manage && <div className="offline-manage">
        {groupedSubjects.map((group) => <section key={group.key} className="offline-subject-group" aria-label={group.label}>{group.subjects.map((subject) => {
          const items = manifest.items.filter((item) => item.subject_id === subject.id && item.available);
          const size = items.reduce((sum, item) => sum + (stored.get(item.id)?.storedSize || 0), 0);
          if (!items.length) return null;
          return <section key={subject.id} className="ui-group offline-v2-manage-subject">
            <div className="ui-row">
              <span className="ui-row-body"><strong dir="auto">{subject.title}</strong><small>{bytesLabel(size)}</small></span>
              {size > 0 && <button type="button" className="btn btn-soft compact" disabled={busy} onClick={() => removeAll(subject.id, items.filter((item) => stored.has(item.id)), t("offline.confirmRemoveSubject", { subject: subject.title }))}>{t("offline.removeSubject")}</button>}
            </div>
            {sheetsFor(manifest, subject.id).map((sheet) => {
              const sheetItems = [...[...sheet.editions.values()].flatMap((edition) => Object.values(edition)), ...sheet.questions];
              return <div key={sheet.id} className="offline-sheet" role="group" aria-label={sheet.title}>
                <div className="ui-row offline-v2-sheet-head"><span className="ui-row-body"><span dir="auto">{sheet.title}</span></span>{sheetItems.some((item) => stored.has(item.id)) && <button type="button" className="btn btn-soft compact" disabled={busy} onClick={() => removeAll(sheet.id, sheetItems.filter((item) => stored.has(item.id)))}>{t("offline.removeSheet")}</button>}</div>
                {EDITIONS.filter(([edition]) => sheet.editions.has(edition)).map(([edition, editionLabel]) => {
                  const parts = sheet.editions.get(edition);
                  const bundle = editionItems(sheet, edition);
                  const ready = bundle.every((item) => itemStates.get(item.id) === "downloaded");
                  const key = `${sheet.id}:${edition}`;
                  return <div key={edition} className="offline-edition">
                    <button type="button" className={`btn btn-soft compact${ready ? " is-ready" : ""}`} disabled={busy || !online || ready} onClick={() => downloadAll(key, bundle)}>{busyId === key ? `${t("offline.downloading")} ${Math.round(progress * 100)}%` : ready ? `${t(editionLabel)} · ${t("offline.availableOffline")}` : t("offline.downloadEdition", { edition: t(editionLabel) })}</button>
                    {parts.sheet && itemButton(parts.sheet, t("offline.sheet"))}
                    {parts.summary && itemButton(parts.summary, t("offline.summary"))}
                    {parts.active_study && itemButton(parts.active_study, t("offline.activeStudy"))}
                  </div>;
                })}
                {sheet.questions.length > 0 && <div className="offline-edition">{sheet.questions.map((item) => itemButton(item, t("offline.questions")))}</div>}
              </div>;
            })}
          </section>;
        })}</section>)}
      </div>}
      <div className="ui-group">
        <button type="button" className="ui-row is-danger" disabled={!downloads.count || busy} onClick={clearAll}>
          <span className="ui-row-body"><span>{t("offline.clearAll")}</span></span>
        </button>
      </div>
      <p className="ui-group-footer">{t("offline.description")}</p>
    </div>

    <ConfirmDialog
      open={Boolean(confirming)}
      title={t("offline.removeTitle")}
      message={confirming?.message || ""}
      confirmLabel={t("offline.removeConfirm")}
      busy={busyId === "all"}
      onCancel={() => setConfirming(null)}
      onConfirm={async () => { const next = confirming; setConfirming(null); await next?.run(); }}
    />
  </section>;
}
