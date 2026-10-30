import { request } from "../api/client.js";
import { offlineDatabase } from "./database.js";
import { offlineAccessStatus } from "./lease.js";
import { captureOfflineSession } from "./sessionScope.js";
import { enqueueOperation, hasPendingFor, isConnectivityError, registerOperationHandler } from "./queue.js";

const cohortKey = user => user.cohort_id || user.cohort?.id || user.cohort?.code || (typeof user.cohort === "string" ? user.cohort : null);

/** Explicit account/cohort-scoped plan snapshots, outside the service-worker cache. */
export async function rememberPlan(user, key, payload) {
  if (!user?.id) return;
  try {
    const assertCurrent = captureOfflineSession(user.id);
    await offlineDatabase.putScoped(user.id, `study-plan:${key}`, {
      cohort: cohortKey(user), payload, savedAt: new Date().toISOString()
    }, assertCurrent);
  } catch { /* Storage failure must not turn a successful server read into a failure. */ }
}

export async function restorePlan(user, key) {
  if (!user?.id) return null;
  try {
    const assertCurrent = captureOfflineSession(user.id);
    if (!(await offlineAccessStatus(user.id)).available) return null;
    const stored = await offlineDatabase.get(user.id, `study-plan:${key}`);
    if (!assertCurrent.isCurrent() || stored?.cohort !== (cohortKey(user))) return null;
    if (!stored?.payload || typeof stored.payload !== "object") return null;
    return stored;
  } catch { return null; }
}

export async function submitPlanProgress(userId, path, body) {
  if (await hasPendingFor(userId, path)) throw Object.assign(new Error("A progress report is waiting to sync."), { status: 409, code: "plan_progress_pending" });
  try {
    return await request(path, { method: "POST", body, retryable: true, allowOfflineQueue: false });
  } catch (error) {
    if (!isConnectivityError(error)) throw error;
    captureOfflineSession(userId)();
    await enqueueOperation(userId, { type: "study_plan_progress", entityType: "study_plan",
      entityId: body.client_request_id, orderingKey: path, payload: { path, body }, local: true,
      operationId: body.client_request_id });
    return { pending: true };
  }
}

registerOperationHandler("study_plan_progress", {
  async execute(userId, operation, assertCurrent) {
    const { path, body } = operation.payload;
    if (!/^\/study-plan\/(?:items\/[a-f0-9-]{36}\/progress|v2\/exams\/[a-f0-9-]{36}\/reading-progress)$/.test(path)) {
      throw Object.assign(new Error("Invalid study progress destination."), { status: 400 });
    }
    assertCurrent();
    await request(path, { method: "POST", body, retryable: true, allowOfflineQueue: false });
    assertCurrent();
    return "done";
  }
});
