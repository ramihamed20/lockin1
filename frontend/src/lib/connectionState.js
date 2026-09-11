/**
 * Connection state is deliberately based on transport evidence as well as the
 * browser hint. `navigator.onLine` only says that a network interface exists;
 * it does not say that Lock-in is reachable.
 */
const listeners = new Set();
let snapshot = { status: "connected", generation: 0 };
let probe = null;
let retryTimer = null;
let failures = 0;

export const CONNECTION_RETRY_DELAYS = [1200, 3000, 7000, 15000];

function publish(status) {
  const changed = snapshot.status !== status;
  snapshot = { status, generation: snapshot.generation + (changed ? 1 : 0) };
  if (changed) listeners.forEach((listener) => listener(snapshot));
}

function clearRetry() {
  if (retryTimer !== null) clearTimeout(retryTimer);
  retryTimer = null;
}

function scheduleProbe() {
  if (retryTimer !== null || !probe) return;
  const delay = CONNECTION_RETRY_DELAYS[Math.min(failures, CONNECTION_RETRY_DELAYS.length - 1)];
  retryTimer = setTimeout(async () => {
    retryTimer = null;
    try {
      await probe();
      reportConnectionSuccess();
    } catch {
      failures += 1;
      // One failed request is often a captive portal, sleep, or a radio handoff.
      publish(failures >= 2 ? "offline" : "reconnecting");
      scheduleProbe();
    }
  }, delay);
}

export function configureConnectionProbe(nextProbe) { probe = nextProbe; }
export function getConnectionSnapshot() { return snapshot; }
export function isOffline() { return snapshot.status === "offline"; }
export function subscribeConnection(listener) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function reportConnectionFailure() {
  failures += 1;
  publish("reconnecting");
  scheduleProbe();
}
export function reportConnectionSuccess() {
  const wasDisconnected = snapshot.status !== "connected";
  failures = 0;
  clearRetry();
  publish("connected");
  return wasDisconnected;
}
export function reportBrowserOnline() {
  if (snapshot.status !== "connected") { publish("reconnecting"); scheduleProbe(); }
}
export function reportBrowserOffline() {
  failures = Math.max(failures, 2);
  publish("offline");
  clearRetry();
}

export const __testing = {
  reset() { clearRetry(); listeners.clear(); snapshot = { status: "connected", generation: 0 }; probe = null; failures = 0; }
};
