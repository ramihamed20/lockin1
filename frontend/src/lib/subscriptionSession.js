const CACHE_PREFIX = "lock-in.subscription-session.";
const CACHE_VERSION = 1;

const DIRECT_STUDY_ENTITLEMENTS = new Set([
  "focus.workspace",
  "content.premium",
  "files.download"
]);

function sessionStorageOrNull() {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function cacheKey(userId) {
  return `${CACHE_PREFIX}${String(userId)}`;
}

export function hasDirectStudyAccess(entitlements) {
  return Array.isArray(entitlements) && entitlements.some((grant) => (
    grant?.source_type === "manual" && DIRECT_STUDY_ENTITLEMENTS.has(grant.code)
  ));
}

export function subscriptionExpiresAt(subscription) {
  if (!subscription || typeof subscription !== "object") return null;
  const value = subscription.expires_at || (
    subscription.status === "trialing"
      ? subscription.trial_ends_at
      : subscription.status === "grace"
        ? subscription.grace_ends_at
        : subscription.current_period_ends_at
  );
  if (typeof value !== "string" || !value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function subscriptionRefreshAt(snapshot) {
  if (!snapshot || hasDirectStudyAccess(snapshot.entitlements)) return null;
  const subscription = snapshot.subscription;
  if (!subscription?.access_allowed) return null;
  if (!["trialing", "active", "grace"].includes(subscription.status)) return null;
  return subscriptionExpiresAt(subscription);
}

function hasTimedSubscriptionAccess(subscription) {
  return Boolean(
    subscription?.access_allowed &&
    ["trialing", "active", "grace"].includes(subscription.status)
  );
}

export function isSubscriptionSnapshotFresh(snapshot, userId, now = Date.now()) {
  if (
    !snapshot ||
    snapshot.version !== CACHE_VERSION ||
    String(snapshot.userId) !== String(userId) ||
    !Object.prototype.hasOwnProperty.call(snapshot, "subscription") ||
    !Array.isArray(snapshot.entitlements)
  ) {
    return false;
  }
  if (hasDirectStudyAccess(snapshot.entitlements)) return true;
  if (!hasTimedSubscriptionAccess(snapshot.subscription)) return true;
  const refreshAt = subscriptionRefreshAt(snapshot);
  return refreshAt !== null && now < refreshAt;
}

export function readSubscriptionSnapshot(userId, now = Date.now()) {
  const storage = sessionStorageOrNull();
  if (!storage || !userId) return null;
  try {
    const snapshot = JSON.parse(storage.getItem(cacheKey(userId)) || "null");
    if (isSubscriptionSnapshotFresh(snapshot, userId, now)) return snapshot;
    storage.removeItem(cacheKey(userId));
  } catch {
    try { storage.removeItem(cacheKey(userId)); } catch { /* Storage is optional. */ }
  }
  return null;
}

export function writeSubscriptionSnapshot(userId, subscription, entitlements = []) {
  const snapshot = {
    version: CACHE_VERSION,
    userId: String(userId),
    subscription: subscription ?? null,
    entitlements: Array.isArray(entitlements) ? entitlements : [],
    storedAt: new Date().toISOString()
  };
  const storage = sessionStorageOrNull();
  if (storage && userId) {
    try { storage.setItem(cacheKey(userId), JSON.stringify(snapshot)); } catch { /* Storage is optional. */ }
  }
  return snapshot;
}

export function clearSubscriptionSnapshots() {
  const storage = sessionStorageOrNull();
  if (!storage) return;
  try {
    Object.keys(storage)
      .filter((key) => key.startsWith(CACHE_PREFIX))
      .forEach((key) => storage.removeItem(key));
  } catch { /* Storage is optional. */ }
}
