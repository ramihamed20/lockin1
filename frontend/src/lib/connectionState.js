/**
 * Connection state is deliberately based on transport evidence as well as the
 * browser hint. `navigator.onLine` only says that a network interface exists;
 * it does not say that Lock-in is reachable.
 */
const listeners = new Set();
let snapshot = { status: "connected", generation: 0, serverConfirmed: false };
let probe = null;
let retryTimer = null;
let activeProbe = null;
let failures = 0;

export const CONNECTION_RETRY_DELAYS = [1200, 3000, 7000, 15000];

function publish(status, serverConfirmed = snapshot.serverConfirmed) {
  const changed = snapshot.status !== status || snapshot.serverConfirmed !== serverConfirmed;
  snapshot = { status, generation: snapshot.generation + (changed ? 1 : 0), serverConfirmed };
  if (changed) listeners.forEach((listener) => listener(snapshot));
}

function clearRetry() {
  if (retryTimer !== null) clearTimeout(retryTimer);
  retryTimer = null;
}

function stopProbing() {
  clearRetry();
  const attempt = activeProbe;
  activeProbe = null;
  attempt?.abort();
}

function scheduleProbe() {
  if (retryTimer !== null || activeProbe || !probe) return;
  if (browserReportsOffline()) return;
  const delay = CONNECTION_RETRY_DELAYS[Math.min(failures, CONNECTION_RETRY_DELAYS.length - 1)];
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void retryConnectionNow();
  }, delay);
}

export async function retryConnectionNow() {
  if (!probe || activeProbe || (snapshot.status === "connected" && !isDefinitelyOffline())) return;
  clearRetry();
  const attempt = new AbortController();
  activeProbe = attempt;
  try {
    await probe(attempt.signal);
  } catch {
    // A response on the new network may have invalidated this probe.
    if (activeProbe !== attempt) return;
    activeProbe = null;
    failures += 1;
    if (failures >= 2) publish("offline", false);
    else publish("reconnecting");
    scheduleProbe();
    return;
  }
  if (activeProbe !== attempt) return;
  activeProbe = null;
  reportConnectionSuccess();
}

export function configureConnectionProbe(nextProbe) { probe = nextProbe; }
export function getConnectionSnapshot() { return snapshot; }
export function isOffline() { return snapshot.status === "offline"; }
// A live server response takes precedence over a stale browser hint. Keep
// this separate from API reachability for jobs that must retry server outages.
export function browserReportsOffline() {
  return !snapshot.serverConfirmed && typeof navigator !== "undefined" && navigator.onLine === false;
}
export function isDefinitelyOffline() { return isOffline() || browserReportsOffline(); }
export function subscribeConnection(listener) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function reportConnectionFailure() {
  failures += 1;
  if (snapshot.status === "connected") publish("reconnecting");
  scheduleProbe();
}
export function reportConnectionSuccess() {
  const wasDisconnected = snapshot.status !== "connected";
  failures = 0;
  stopProbing();
  publish("connected", true);
  return wasDisconnected;
}
export function reportBrowserOffline() {
  failures = Math.max(failures, 2);
  stopProbing();
  publish("offline", false);
}

export const __testing = {
  reset() { stopProbing(); listeners.clear(); snapshot = { status: "connected", generation: 0, serverConfirmed: false }; probe = null; failures = 0; }
};
