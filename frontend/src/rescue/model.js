export const RESCUE_ENABLED = import.meta.env?.VITE_START_RESCUE_ENABLED === "true";
export const TARGET_SECONDS = 180;
export const TERMINAL = new Set(["stopped", "continued", "finished"]);

export function proposeRescue(accountId, activity) {
  return {
    ...activity, id: globalThis.crypto.randomUUID(), account_id: String(accountId),
    status: "proposed", started_at: null, ended_at: null, active_duration_seconds: 0,
    exit_reason: "", continued_into_study_session_id: null, sync_revision: 0,
  };
}

/** Wall time is metadata. Only observed foreground intervals contribute elapsed time. */
export function createRescueClock(record, { tick = () => globalThis.performance.now(), wall = () => new Date().toISOString() } = {}) {
  let current = { ...record }, anchor = null;
  const sample = () => {
    if (anchor !== null) {
      const now = tick(), delta = now - anchor;
      // A suspended process may receive no visibility event. Do not credit the gap.
      if (delta >= 0 && delta <= 5000) current.active_duration_seconds += delta / 1000;
      else { current.status = "paused"; current.exit_reason = "interrupted"; }
      anchor = current.status === "active" ? now : null;
    }
    if (current.active_duration_seconds >= TARGET_SECONDS && current.status === "active") {
      current.active_duration_seconds = TARGET_SECONDS;
      current.status = "paused"; current.exit_reason = "target_reached"; anchor = null;
    }
    return { ...current };
  };
  return {
    sample,
    transition(action, reason = "") {
      sample();
      if (TERMINAL.has(current.status)) return { ...current };
      if (action === "start" || action === "resume") {
        if (current.active_duration_seconds >= TARGET_SECONDS) return { ...current };
        current.started_at ||= wall(); current.status = "active"; current.exit_reason = ""; anchor = tick();
      } else if (action === "pause") {
        if (current.status === "active") { current.status = "paused"; current.exit_reason = reason; anchor = null; }
      } else if (["stop", "continue", "finish"].includes(action)) {
        current.status = { stop: "stopped", continue: "continued", finish: "finished" }[action];
        current.ended_at = wall(); current.exit_reason = reason || action; anchor = null;
      }
      return { ...current };
    },
  };
}

export function recoverRescue(record) {
  return record?.status === "active" ? { ...record, status: "paused", exit_reason: "interrupted" } : record;
}

export function sameRescueSource(activity, source) {
  return activity?.catalog_document_id === source?.catalog_document_id
    && activity?.learning_object_version_id === source?.learning_object_version_id
    && activity?.managed_file_id === source?.managed_file_id
    && activity?.edition === source?.edition;
}
