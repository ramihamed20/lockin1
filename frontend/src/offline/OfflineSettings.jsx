import { useCallback, useEffect, useState } from "react";
import { useI18n } from "../components/I18nProvider.jsx";
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

  async function removeAll(busyKey, items, confirmMessage = "") {
    if (confirmMessage && !window.confirm(confirmMessage)) return;
    setBusyId(busyKey);
    try {
      for (const item of items) await removeOfflineItem(userId, item.id);
      await refresh();
    } catch (cause) { setError(cause.message); }
    finally { setBusyId(""); }
  }

  async function clearAll() {
    if (!window.confirm(t("offline.confirmClear"))) return;
    setBusyId("all");
    try { await clearOfflineDownloads(userId); await refresh(); }
    catch (cause) { setError(cause.message); }
    finally { setBusyId(""); }
  }

  async function dismiss(operationId) {
    await dismissFailedOperation(userId, operationId).catch(() => undefined);
    await refresh().catch(() => undefined);
  }

  const stored = new Map(downloads.items.map((item) => [item.id, item]));
  const until = lease.claims?.exp ? lease.claims.exp * 1000 : 0;
  const remaining = Math.max(0, until - Date.now());
  const duration = `${Math.floor(remaining / 3_600_000)}h ${Math.floor((remaining % 3_600_000) / 60_000)}m`;
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

  return <article className="theme-section" id="settings-offline" aria-labelledby="settings-offline-heading">
    <div className="theme-section-head"><div><h2 id="settings-offline-heading" tabIndex={-1}>{t("offline.title")}</h2><p>{t("offline.description")}</p></div><span className={`pill ${lease.available ? "success" : ""}`}>{lease.available ? t("offline.available") : t("offline.verificationRequired")}</span></div>
    <div className="settings-row"><span>{online ? t("offline.online") : t("offline.offline")}</span><span>{lease.available ? t("offline.remaining", { duration }) : t(lease.reason === "clock_rollback" ? "offline.clockRollback" : "offline.expired")}</span></div>
    <div className="settings-row"><span>{t("offline.lastVerified")}</span><span>{lease.claims ? dateLabel(lease.claims.iat * 1000) : t("offline.never")}</span></div>
    <div className="settings-row"><span>{t("offline.lastSync")}</span><span>{dateLabel(lastSync)}</span></div>
    <div className="settings-row"><span>{t("offline.pendingChanges")}</span><strong>{pendingCount}</strong></div>
    <div className="settings-row"><span>{t("offline.storageUsed")}</span><strong>{bytesLabel(downloads.bytes)}</strong></div>
    <div className="settings-row"><span>{t("offline.downloadedItems")}</span><strong>{downloads.count}</strong></div>
    {syncState && <p className="save-hint" role="status">{t(`offline.sync.${syncState}`)}</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <button type="button" className="btn btn-soft compact" onClick={checkConnection} disabled={syncState === "verifying" || syncState === "syncing"}>{t("offline.syncNow")}</button>
    {conflicts.length > 0 && <section className="offline-conflicts" aria-label={t("offline.failedChanges")}>
      <p className="form-error" role="status">{t("offline.conflicts", { count: conflicts.length })}</p>
      <ul>{conflicts.slice(0, 5).map((operation) => <li key={operation.operation_id}><span dir="auto">{operation.reason || operation.operation_type}</span> <button type="button" className="btn btn-soft compact" onClick={() => dismiss(operation.operation_id)}>{t("offline.dismiss")}</button></li>)}</ul>
    </section>}
    <div className="settings-row"><label htmlFor="offline-auto">{t("offline.automatic")}</label><input id="offline-auto" type="checkbox" checked={preferences.automatic} onChange={(event) => updatePreferences({ ...preferences, automatic: event.target.checked })} /></div>
    <fieldset className="offline-options"><legend>{t("offline.downloadOver")}</legend>
      <label><input type="radio" name="offline-network" checked={preferences.network === "wifi"} onChange={() => updatePreferences({ ...preferences, network: "wifi" })} /> {t("offline.wifi")}</label>
      <label><input type="radio" name="offline-network" checked={preferences.network === "any"} onChange={() => updatePreferences({ ...preferences, network: "any" })} /> {t("offline.anyNetwork")}</label>
    </fieldset>
    <fieldset className="offline-options"><legend>{t("offline.contentTypes")}</legend>
      {CONTENT_TYPES.map(([type, label]) => <label key={type}><input type="checkbox" checked={Boolean(preferences.types[type])} onChange={(event) => updatePreferences({ ...preferences, types: { ...preferences.types, [type]: event.target.checked } })} /> {t(label)}</label>)}
    </fieldset>
    {groupedSubjects.map((group) => <section key={group.key} className="offline-subject-group" aria-label={group.label}>
      <h3>{group.label}</h3>
      {group.subjects.map((subject) => {
        const items = subjectItems(subject);
        const state = subjectState(subject);
        return <div key={subject.id} className="settings-row">
          <strong dir="auto">{subject.title}</strong>
          <div>
            <span role="status">{t(STATE_LABELS[state])}</span>{" "}
            <button type="button" className="btn btn-soft compact" disabled={busy || !online || !items.length || state === "downloaded"} onClick={() => downloadAll(subject.id, items)}>
              {busyId === subject.id ? `${t("offline.downloading")} ${Math.round(progress * 100)}%` : failedId === subject.id ? t("offline.incomplete") : state === "update" ? t("offline.updateAvailable") : t("offline.downloadSubject")}
            </button>
          </div>
        </div>;
      })}
    </section>)}
    <button type="button" className="btn btn-soft compact" onClick={() => setManage(!manage)} aria-expanded={manage}>{t("offline.manage")}</button>
    {manage && <div className="offline-manage">
      {groupedSubjects.map((group) => <section key={group.key} className="offline-subject-group" aria-label={group.label}><h3>{group.label}</h3>{group.subjects.map((subject) => {
        const items = manifest.items.filter((item) => item.subject_id === subject.id && item.available);
        const size = items.reduce((sum, item) => sum + (stored.get(item.id)?.storedSize || 0), 0);
        return <section key={subject.id} className="settings-panel compact">
          <div className="settings-row"><div><strong>{subject.title}</strong><small> · {subject.program} · {subject.cohort} · {bytesLabel(size)}</small></div><div>
            {size > 0 && <button type="button" className="btn btn-soft compact" disabled={busy} onClick={() => removeAll(subject.id, items.filter((item) => stored.has(item.id)), t("offline.confirmRemoveSubject", { subject: subject.title }))}>{t("offline.removeSubject")}</button>}
          </div></div>
          {sheetsFor(manifest, subject.id).map((sheet) => {
            const sheetItems = [...[...sheet.editions.values()].flatMap((edition) => Object.values(edition)), ...sheet.questions];
            return <div key={sheet.id} className="offline-sheet" role="group" aria-label={sheet.title}>
              <div className="settings-row"><strong dir="auto">{sheet.title}</strong>{sheetItems.some((item) => stored.has(item.id)) && <button type="button" className="btn btn-soft compact" disabled={busy} onClick={() => removeAll(sheet.id, sheetItems.filter((item) => stored.has(item.id)))}>{t("offline.removeSheet")}</button>}</div>
              {EDITIONS.filter(([edition]) => sheet.editions.has(edition)).map(([edition, editionLabel]) => {
                const parts = sheet.editions.get(edition);
                const bundle = editionItems(sheet, edition);
                const ready = bundle.every((item) => itemStates.get(item.id) === "downloaded");
                const key = `${sheet.id}:${edition}`;
                return <div key={edition} className="settings-row offline-edition">
                  <button type="button" className="btn btn-soft compact" disabled={busy || !online || ready} onClick={() => downloadAll(key, bundle)}>{busyId === key ? `${t("offline.downloading")} ${Math.round(progress * 100)}%` : ready ? `${t(editionLabel)} · ${t("offline.availableOffline")}` : t("offline.downloadEdition", { edition: t(editionLabel) })}</button>
                  {parts.sheet && itemButton(parts.sheet, t("offline.sheet"))}
                  {parts.summary && itemButton(parts.summary, t("offline.summary"))}
                  {parts.active_study && itemButton(parts.active_study, t("offline.activeStudy"))}
                </div>;
              })}
              {sheet.questions.length > 0 && <div className="settings-row">{sheet.questions.map((item) => itemButton(item, t("offline.questions")))}</div>}
            </div>;
          })}
        </section>;
      })}</section>)}
      <button type="button" className="btn btn-soft compact" disabled={!downloads.count || busy} onClick={clearAll}>{t("offline.clearAll")}</button>
    </div>}
  </article>;
}
