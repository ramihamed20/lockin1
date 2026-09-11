const PREFIX = "lock-in.attempt-pending.v1";

function owner() {
  try {
    const user = JSON.parse(window.sessionStorage.getItem("lock-in.session-user") || "null");
    return user?.id ? `user:${user.id}` : "device";
  } catch { return "device"; }
}
function key(attemptId) { return `${PREFIX}:${owner()}:${attemptId}`; }
function read(attemptId) {
  try { const value = JSON.parse(window.localStorage.getItem(key(attemptId)) || "[]"); return Array.isArray(value) ? value : []; }
  catch { return []; }
}
function write(attemptId, items) {
  try { window.localStorage.setItem(key(attemptId), JSON.stringify(items.slice(-120))); } catch { /* The in-memory UI remains usable. */ }
}

export function queueAttemptChange(attemptId, change) {
  const current = read(attemptId);
  // Answer revisions are sequential on the server. Keep a changed answer's
  // earlier revision too: collapsing r1 into r2 would make an offline student
  // hit a conflict when the server has never seen r1.
  const next = change.kind === "answer"
    ? [...current.filter((item) => !(item.kind === "answer" && item.questionId === change.questionId && item.clientRevision === change.clientRevision)), change]
    : [...current.filter((item) => item.kind !== "resume"), change];
  write(attemptId, next);
}

/** Replays revisions in order; a successful acknowledgement alone removes it. */
export async function flushAttemptChanges(attemptId, api) {
  const pending = read(attemptId).sort((a, b) => Number(a.clientRevision) - Number(b.clientRevision));
  const retained = [];
  for (const change of pending) {
    try {
      if (change.kind === "answer") await api.saveAnswer(attemptId, change.questionId, change);
      else await api.saveResume(attemptId, change);
    } catch {
      retained.push(change);
      // A connection that is still unavailable cannot make a later revision safe.
      retained.push(...pending.slice(pending.indexOf(change) + 1));
      break;
    }
  }
  write(attemptId, retained);
  return { pending: retained.length };
}

export function pendingAttemptChanges(attemptId) { return read(attemptId); }
