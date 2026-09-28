import { request } from "../api/client.js";
import { offlineDatabase } from "./database.js";
import { downloadOfflineItem, fetchOfflineManifest, isOfflineItemStored, mayAutoDownload } from "./downloads.js";
import { saveVerifiedLease } from "./lease.js";
import { flushPendingOperations, pendingOfflineOperations } from "./queue.js";
// Registers the Focus and Review operation handlers with the shared queue.
import "./focusSync.js";
import { refreshReviewSnapshot } from "./review.js";

export const DEFAULT_OFFLINE_PREFERENCES = Object.freeze({
  automatic: false,
  network: "wifi",
  types: { sheet: true, summary: true, active_study: true, questions: true }
});

export async function readOfflinePreferences(userId) {
  const stored = await offlineDatabase.get(userId, "preferences") || {};
  return { ...DEFAULT_OFFLINE_PREFERENCES, ...stored, types: { ...DEFAULT_OFFLINE_PREFERENCES.types, ...(stored.types || {}) } };
}

export async function saveOfflinePreferences(userId, preferences) {
  await offlineDatabase.put(userId, "preferences", preferences);
}

const activeRuns = new Map();
const lastRuns = new Map();
// Foreground triggers (focus, resume, visibility) can fire in bursts. A quiet
// period between automatic runs keeps them from turning into a request loop;
// a regained connection, new offline work or a manual check always runs.
export const AUTOMATIC_SYNC_INTERVAL_MS = 60_000;
const FAILURE_BACKOFF_MS = [15_000, 60_000, 5 * 60_000];

function publisher(userId, onState) {
  return (state, detail = {}) => {
    onState(state);
    window.dispatchEvent(new window.CustomEvent("lock-in:offline-sync", { detail: { userId, state, ...detail } }));
  };
}

function throttled(userId, force) {
  if (force) return false;
  const last = lastRuns.get(userId);
  if (!last) return false;
  const wait = last.failures ? FAILURE_BACKOFF_MS[Math.min(last.failures, FAILURE_BACKOFF_MS.length) - 1] : AUTOMATIC_SYNC_INTERVAL_MS;
  return Date.now() - last.at < wait;
}

async function reconcileAfterFlush(userId, acknowledged) {
  const keys = new Set(acknowledged
    .filter(({ operation }) => operation.operation_type.startsWith("active_study_"))
    .map(({ operation }) => operation.entity_id));
  if (keys.size) {
    const { reconcileActiveStudyRuns } = await import("./activeStudy.js");
    await reconcileActiveStudyRuns(userId, keys, (sheetId, edition) => request(
      `/focus/managed-active-study/sheets/${sheetId}` + (edition && edition !== "university" ? `?edition=${encodeURIComponent(edition)}` : "")
    )).catch(() => undefined);
  }
}

/**
 * One foreground synchronisation, in dependency order:
 * 1. verify the session and entitlement and renew the signed lease;
 * 2. send queued work (Focus documents, answers, Active Study attempts,
 *    Review answers) and apply the server's authoritative results;
 * 3. refresh the directories, Review snapshot and manifest;
 * 4. download new or changed content the student opted into;
 * 5. record the sync cursor.
 * A lapsed subscription never discards pending work: the queue still uploads
 * with the last signed lease, and no protected content is renewed.
 * Only the foreground page runs this; iOS does not run closed-app jobs.
 * @param {string} userId
 * @param {(state: string) => void} [onState]
 * @param {{ force?: boolean }} [options]
 */
export async function synchronizeOffline(userId, onState = () => {}, { force = true } = {}) {
  if (activeRuns.has(userId)) return activeRuns.get(userId);
  if (throttled(userId, force)) return null;
  const publish = publisher(userId, onState);
  const run = (async () => {
    publish("verifying");
    let leaseError = null;
    try {
      const leaseResponse = await request("/offline/lease/");
      if (!(await saveVerifiedLease(userId, leaseResponse.lease))) {
        throw new Error("The offline access lease could not be verified on this device.");
      }
    } catch (error) {
      // No session at all: nothing can upload now. Keep every operation.
      if (error?.status === 0 || error?.status === 401) throw error;
      leaseError = error;
    }
    const hadPendingWork = (await pendingOfflineOperations(userId)).length > 0;
    if (hadPendingWork) publish("syncing");
    const flushed = await flushPendingOperations(userId, { force });
    await reconcileAfterFlush(userId, flushed.acknowledged);
    if (leaseError) {
      // Access may have ended after work was recorded. The previous signed
      // lease still proves that work for the sync grace window. A successful
      // upload must be shown as such even though no new content can be issued.
      if (!hadPendingWork) throw leaseError;
      const now = new Date().toISOString();
      await offlineDatabase.put(userId, "lastSync", now);
      await offlineDatabase.put(userId, "syncCursor", { at: now, pending: flushed.remaining.length, failedDownloads: 0 });
      publish(flushed.remaining.length ? "partial" : "synced", { xpTotal: flushed.xpTotal });
      return null;
    }
    const remaining = flushed.remaining;
    // Directories keep the reader's normal route model offline, so offline
    // navigation never needs a second Materials implementation.
    const [materials, ...directories] = await Promise.all([
      request("/catalog/materials"),
      request("/catalog/questions?source=exam"),
      request("/catalog/questions?source=ai-sheet")
    ]);
    if (Array.isArray(materials?.results)) await offlineDatabase.put(userId, "materials", materials);
    for (const [index, source] of ["exam", "ai-sheet"].entries()) {
      if (Array.isArray(directories[index]?.results)) await offlineDatabase.put(userId, `question-directory:${source}`, directories[index]);
    }
    // Local Review answers are reflected in the stored snapshot; replacing it
    // before they are acknowledged would briefly undo them on screen.
    if (!remaining.some((operation) => operation.operation_type === "review_answer")) {
      await refreshReviewSnapshot(userId).catch(() => undefined);
    }
    const manifest = await fetchOfflineManifest(userId);
    const preferences = await readOfflinePreferences(userId);
    let failedDownloads = 0;
    // Without Automatic Downloads nothing is fetched here: a changed item keeps
    // its stored version usable and Settings offers "Update available".
    if (preferences.automatic && mayAutoDownload(preferences.network)) {
      for (const item of manifest.items) {
        if (!preferences.types[item.type]) continue;
        // Unchanged content is skipped by version and checksum; for a changed
        // bundle only the parts whose versions moved are fetched again.
        if (await isOfflineItemStored(userId, item, manifest)) continue;
        publish("downloading");
        try {
          await downloadOfflineItem(userId, item, () => {}, { manifest });
        } catch {
          // A failed download stays retryable; independent items continue.
          failedDownloads += 1;
        }
      }
    }
    const now = new Date().toISOString();
    await offlineDatabase.put(userId, "lastSync", now);
    await offlineDatabase.put(userId, "syncCursor", { at: now, pending: remaining.length, failedDownloads });
    publish(failedDownloads || remaining.length ? "partial" : "synced", { xpTotal: flushed.xpTotal });
    return manifest;
  })();
  activeRuns.set(userId, run);
  try {
    const manifest = await run;
    lastRuns.set(userId, { at: Date.now(), failures: 0 });
    return manifest;
  } catch (error) {
    const failures = (lastRuns.get(userId)?.failures || 0) + 1;
    lastRuns.set(userId, { at: Date.now(), failures });
    publish("connection");
    throw error;
  } finally {
    activeRuns.delete(userId);
  }
}
