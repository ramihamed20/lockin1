import { request } from "../api/client.js";
import { offlineDatabase } from "./database.js";
import { downloadOfflineItem, fetchOfflineManifest, isOfflineItemStored, mayAutoDownload } from "./downloads.js";
import { saveVerifiedLease } from "./lease.js";
import { flushPendingOperations, pendingOfflineOperations } from "./queue.js";
// Registers the Focus and Review operation handlers with the shared queue.
import "./focusSync.js";
import { refreshReviewSnapshot } from "./review.js";
import { captureOfflineSession, currentOfflineUserId } from "./sessionScope.js";

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
const retryTimers = new Map();
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

/**
 * Why a run could not finish, as a state the indicator and Settings can name.
 * Only a lost connection or an unavailable server is "connection"; an ended
 * session or access that no longer proves the saved work is not something a
 * retry alone can fix, so it is said plainly instead of "Sync failed".
 */
export function syncFailureState(error) {
  const status = Number(error?.status);
  if (status === 401 || (status === 403 && error?.code === "not_authenticated")) return "signin";
  if (status === 403) return "access";
  return "connection";
}

/**
 * Queued work must not wait for the student to switch tabs. After a failed or
 * partial run the next attempt is scheduled here: the failure backoff after a
 * failure, and no earlier than the automatic interval (or the queue's own
 * per-operation backoff) after a partial one. Offline or in the background it
 * waits for the connection and visibility events the shell already listens to.
 */
async function scheduleAutomaticRetry(userId, { failed }) {
  globalThis.clearTimeout(retryTimers.get(userId)?.timer);
  retryTimers.delete(userId);
  if (currentOfflineUserId() !== String(userId)) return;
  const pending = await pendingOfflineOperations(userId).catch(() => []);
  if (!pending.length) return;
  const failures = lastRuns.get(userId)?.failures || 0;
  const now = Date.now();
  const earliestDue = Math.min(...pending.map((operation) => operation.next_attempt_at ? Date.parse(operation.next_attempt_at) : now));
  const delay = failed
    ? FAILURE_BACKOFF_MS[Math.min(failures, FAILURE_BACKOFF_MS.length) - 1]
    : Math.max(AUTOMATIC_SYNC_INTERVAL_MS, earliestDue - now);
  const run = () => {
    retryTimers.delete(userId);
    if (navigator.onLine === false || document.visibilityState === "hidden") return Promise.resolve(null);
    // The timer already waited out the backoff, so the run is not throttled
    // again; each operation's own backoff still applies inside the queue.
    return synchronizeOffline(userId, () => {}, { force: false, scheduled: true }).catch(() => null);
  };
  const timer = globalThis.setTimeout(run, delay + 250);
  // A Node test process must not stay alive for a retry nobody awaits.
  /** @type {any} */ (timer)?.unref?.();
  retryTimers.set(userId, { timer, delay, run });
}

export const __testing = Object.freeze({
  /** The automatic retry scheduled for this account, if any. */
  scheduledRetry: (userId) => retryTimers.get(userId) || null
});

async function reconcileAfterFlush(userId, acknowledged, assertCurrent) {
  const keys = new Set(acknowledged
    .filter(({ operation }) => operation.operation_type.startsWith("active_study_"))
    .map(({ operation }) => operation.entity_id));
  if (keys.size) {
    const { reconcileActiveStudyRuns } = await import("./activeStudy.js");
    await reconcileActiveStudyRuns(userId, keys, async (sheetId, edition) => {
      assertCurrent();
      const availability = await request(
        `/focus/managed-active-study/sheets/${sheetId}` + (edition && edition !== "university" ? `?edition=${encodeURIComponent(edition)}` : "")
      );
      assertCurrent();
      return availability;
    }, assertCurrent).catch(() => undefined);
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
 * @param {{ force?: boolean, scheduled?: boolean }} [options]
 */
export async function synchronizeOffline(userId, onState = () => {}, { force = true, scheduled = false } = {}) {
  const assertCurrent = captureOfflineSession(userId);
  if (activeRuns.has(userId)) return activeRuns.get(userId);
  if (throttled(userId, force || scheduled)) return null;
  const publish = publisher(userId, onState);
  const run = (async () => {
    publish("verifying");
    let leaseError = null;
    try {
      const leaseResponse = await request("/offline/lease/");
      if (!(await saveVerifiedLease(userId, leaseResponse.lease, assertCurrent))) {
        throw new Error("The offline access lease could not be verified on this device.");
      }
    } catch (error) {
      // No session at all: nothing can upload now. Keep every operation.
      if (error?.status === 0 || error?.status === 401) throw error;
      leaseError = error;
    }
    assertCurrent();
    const hadPendingWork = (await pendingOfflineOperations(userId)).length > 0;
    if (hadPendingWork) publish("syncing");
    const flushed = await flushPendingOperations(userId, { force });
    assertCurrent();
    await reconcileAfterFlush(userId, flushed.acknowledged, assertCurrent);
    assertCurrent();
    if (leaseError) {
      // Access may have ended after work was recorded. The previous signed
      // lease still proves that work for the sync grace window. A successful
      // upload must be shown as such even though no new content can be issued.
      if (!hadPendingWork) throw leaseError;
      const now = new Date().toISOString();
      await offlineDatabase.putScoped(userId, "lastSync", now, assertCurrent);
      await offlineDatabase.putScoped(userId, "syncCursor", { at: now, pending: flushed.remaining.length, failedDownloads: 0 }, assertCurrent);
      publish(flushed.remaining.length ? "partial" : "synced", { xpTotal: flushed.xpTotal });
      return null;
    }
    const remaining = flushed.remaining;
    try {
      // Directories keep the reader's normal route model offline, so offline
      // navigation never needs a second Materials implementation.
      const [materials, ...directories] = await Promise.all([
        request("/catalog/materials"),
        request("/catalog/questions?source=exam"),
        request("/catalog/questions?source=ai-sheet")
      ]);
      assertCurrent();
      if (Array.isArray(materials?.results)) await offlineDatabase.putScoped(userId, "materials", materials, assertCurrent);
      for (const [index, source] of ["exam", "ai-sheet"].entries()) {
        if (Array.isArray(directories[index]?.results)) await offlineDatabase.putScoped(userId, `question-directory:${source}`, directories[index], assertCurrent);
      }
      // Local Review answers are reflected in the stored snapshot; replacing it
      // before they are acknowledged would briefly undo them on screen.
      if (!remaining.some((operation) => operation.operation_type === "review_answer")) {
        await refreshReviewSnapshot(userId, assertCurrent).catch(() => undefined);
      }
      assertCurrent();
      const manifest = await fetchOfflineManifest(userId, assertCurrent);
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
            await downloadOfflineItem(userId, item, () => {}, { manifest, assertCurrent });
          } catch {
            // A failed download stays retryable; independent items continue.
            failedDownloads += 1;
          }
        }
      }
      const now = new Date().toISOString();
      await offlineDatabase.putScoped(userId, "lastSync", now, assertCurrent);
      await offlineDatabase.putScoped(userId, "syncCursor", { at: now, pending: remaining.length, failedDownloads }, assertCurrent);
      publish(failedDownloads || remaining.length ? "partial" : "synced", { xpTotal: flushed.xpTotal });
      return manifest;
    } catch (error) {
      // The queued work above is already on the server. A directory or
      // manifest refresh that fails afterwards is retried, not reported as a
      // failed sync of the student's work.
      throw Object.assign(error instanceof Error ? error : new Error(String(error)), { afterFlush: true });
    }
  })();
  activeRuns.set(userId, run);
  globalThis.clearTimeout(retryTimers.get(userId)?.timer);
  retryTimers.delete(userId);
  try {
    const manifest = await run;
    lastRuns.set(userId, { at: Date.now(), failures: 0 });
    void scheduleAutomaticRetry(userId, { failed: false });
    return manifest;
  } catch (error) {
    if (!assertCurrent.isCurrent()) throw error;
    const failures = (lastRuns.get(userId)?.failures || 0) + 1;
    lastRuns.set(userId, { at: Date.now(), failures });
    publish(error?.afterFlush ? "partial" : syncFailureState(error));
    void scheduleAutomaticRetry(userId, { failed: true });
    throw error;
  } finally {
    activeRuns.delete(userId);
  }
}
