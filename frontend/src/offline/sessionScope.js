/** Fence asynchronous offline work to the login that started it, across tabs. */
export const CURRENT_USER_KEY = "lock-in.offline-current-user-id";
const REVISION_KEY = "lock-in.offline-session-revision";

export function currentOfflineUserId() {
  try { return globalThis.localStorage?.getItem(CURRENT_USER_KEY) || ""; }
  catch { return ""; }
}

export function invalidateOfflineSession() {
  // This is a non-secret local revision, never a server authentication token.
  globalThis.localStorage?.setItem(REVISION_KEY, globalThis.crypto.randomUUID());
}

export function captureOfflineSession(userId) {
  const revision = globalThis.localStorage?.getItem(REVISION_KEY);
  const isCurrent = () => currentOfflineUserId() === String(userId)
    && globalThis.localStorage?.getItem(REVISION_KEY) === revision;
  const assertCurrent = () => {
    if (!isCurrent()) throw Object.assign(new Error("Sign in again to continue offline work."), {
      status: 401, code: "not_authenticated",
    });
  };
  assertCurrent.isCurrent = isCurrent;
  assertCurrent();
  return assertCurrent;
}

const cacheMutations = new Map();
export async function mutateOfflineCache(userId, action) {
  const name = `lock-in.offline-cache:${userId}`;
  if (globalThis.navigator?.locks) return globalThis.navigator.locks.request(name, action);
  const previous = cacheMutations.get(name) || Promise.resolve();
  const next = previous.catch(() => {}).then(action);
  cacheMutations.set(name, next);
  try { return await next; }
  finally { if (cacheMutations.get(name) === next) cacheMutations.delete(name); }
}
