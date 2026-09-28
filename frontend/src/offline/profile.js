import { offlineDatabase } from "./database.js";
import { offlineAccessStatus } from "./lease.js";
import { clearOfflineDownloads } from "./downloads.js";

const CURRENT_USER_KEY = "lock-in.offline-current-user-id";

/** The signed-in account whose offline database API modules may read. */
export function currentOfflineUserId() {
  try {
    return globalThis.localStorage?.getItem(CURRENT_USER_KEY) || "";
  } catch {
    return "";
  }
}

export async function rememberOfflineUser(user) {
  if (!user?.id) return;
  const previous = localStorage.getItem(CURRENT_USER_KEY);
  if (previous && previous !== String(user.id)) await forgetOfflineUser(previous);
  await offlineDatabase.put(user.id, "profile", user);
  localStorage.setItem(CURRENT_USER_KEY, String(user.id));
}

export async function restoreOfflineUser() {
  const userId = localStorage.getItem(CURRENT_USER_KEY);
  if (!userId) return null;
  const status = await offlineAccessStatus(userId);
  if (!status.available) return null;
  const user = await offlineDatabase.get(userId, "profile");
  return user?.id === userId ? user : null;
}

// The student's own unsynced work and the progress it belongs to. Nothing here
// is downloaded content, and it lives in this account's own database, which no
// other account ever opens. It syncs the next time this account signs in.
const RETAINED_PREFIXES = ["operation:", "queue:", "as-run:", "as-runid:", "as-completed:", "answer:", "review-answer:"];

/**
 * Locks an account's offline data: its lease, profile, manifest, directories
 * and every protected download are removed at once. Pending work is kept.
 */
export async function forgetOfflineUser(userId) {
  if (!userId) return;
  if (localStorage.getItem(CURRENT_USER_KEY) === String(userId)) localStorage.removeItem(CURRENT_USER_KEY);
  await offlineDatabase.delete(userId, "lease");
  await clearOfflineDownloads(userId);
  for (const key of await offlineDatabase.keys(userId)) {
    if (!RETAINED_PREFIXES.some((prefix) => String(key).startsWith(prefix))) await offlineDatabase.delete(userId, key);
  }
}
