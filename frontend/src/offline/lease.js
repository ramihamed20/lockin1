import { offlineDatabase } from "./database.js";
import { captureOfflineSession, currentOfflineUserId } from "./sessionScope.js";

const runtimeAnchors = new Map();
const reportedRollbacks = new Set();

function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = globalThis.atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function decodeBase64(value) {
  return Uint8Array.from(globalThis.atob(value), (character) => character.charCodeAt(0));
}

/** Verify before reading claims. Production must pin the deployment key at build time. */
export async function verifyLease(token, userId, publicKeyBase64) {
  const segments = String(token || "").split(".");
  if (segments.length !== 3 || !publicKeyBase64 || !globalThis.crypto?.subtle) return null;
  try {
    const header = JSON.parse(new globalThis.TextDecoder().decode(decodeBase64Url(segments[0])));
    if (header.alg !== "EdDSA" || header.typ !== "offline-lease+jwt") return null;
    const key = await globalThis.crypto.subtle.importKey("raw", decodeBase64(publicKeyBase64), "Ed25519", false, ["verify"]);
    const valid = await globalThis.crypto.subtle.verify(
      "Ed25519", key, decodeBase64Url(segments[2]),
      new globalThis.TextEncoder().encode(`${segments[0]}.${segments[1]}`)
    );
    if (!valid) return null;
    const claims = JSON.parse(new globalThis.TextDecoder().decode(decodeBase64Url(segments[1])));
    if (claims.v !== 1 || claims.sub !== String(userId) ||
        !Number.isSafeInteger(claims.iat) || !Number.isSafeInteger(claims.exp) ||
        claims.exp !== claims.offline_until || claims.exp - claims.iat > 86_400 ||
        (claims.subscription_until !== null && claims.exp > claims.subscription_until)) return null;
    return claims;
  } catch {
    // WebKit versions without Ed25519 fail closed: online study remains available.
    return null;
  }
}

export async function saveVerifiedLease(userId, lease, assertCurrent = captureOfflineSession(userId)) {
  const pinnedKey = import.meta.env?.VITE_OFFLINE_LEASE_PUBLIC_KEY || (!import.meta.env?.PROD ? lease.public_key : "");
  if (!pinnedKey || (import.meta.env?.PROD && pinnedKey !== lease.public_key)) return false;
  const claims = await verifyLease(lease.token, userId, pinnedKey);
  if (!claims) return false;
  const now = Date.now();
  // A device clock behind the signed issuance time must not gain extra offline
  // hours, so that difference is added to every expiry check. The rollback
  // check compares the device only with its own earlier readings, so a device
  // whose clock is simply set differently from the server still works.
  const serverOffset = Math.max(0, claims.iat * 1000 - now);
  await offlineDatabase.putScoped(userId, "lease", { token: lease.token, publicKey: pinnedKey, trustedWall: now, serverOffset }, assertCurrent);
  runtimeAnchors.set(userId, { token: lease.token, wall: now, tick: globalThis.performance.now() });
  reportedRollbacks.delete(userId);
  return true;
}

export const CLOCK_ROLLBACK_TOLERANCE_MS = 5 * 60_000;

export async function offlineAccessStatus(userId) {
  if (currentOfflineUserId() !== String(userId)) return { available: false, reason: "account" };
  const assertCurrent = captureOfflineSession(userId);
  const stored = await offlineDatabase.get(userId, "lease");
  if (!stored) return { available: false, reason: "missing" };
  const pinnedKey = import.meta.env?.VITE_OFFLINE_LEASE_PUBLIC_KEY || (!import.meta.env?.PROD ? stored.publicKey : "");
  const claims = await verifyLease(stored.token, userId, pinnedKey);
  if (!claims) return { available: false, reason: "invalid" };
  const now = Date.now();
  // Leases stored before the offset was recorded keep the stricter floor.
  const legacy = typeof stored.serverOffset !== "number";
  const offset = legacy ? 0 : stored.serverOffset;
  const floor = legacy ? Math.max(stored.trustedWall, claims.iat * 1000) : stored.trustedWall;
  // Small corrections (time sync, time zone travel) stay within the tolerance;
  // a larger backwards jump locks protected content until online verification.
  if (now + CLOCK_ROLLBACK_TOLERANCE_MS < floor) {
    if (!reportedRollbacks.has(userId)) {
      reportedRollbacks.add(userId);
      console.warn("Offline access paused after a significant device clock rollback.");
    }
    return { available: false, reason: "clock_rollback" };
  }
  let anchor = runtimeAnchors.get(userId);
  if (!anchor || anchor.token !== stored.token) {
    anchor = { token: stored.token, wall: now, tick: globalThis.performance.now() };
    runtimeAnchors.set(userId, anchor);
  }
  // Monotonic elapsed time within this page lifetime cannot be wound back.
  const effectiveNow = Math.max(now, anchor.wall + Math.max(0, globalThis.performance.now() - anchor.tick)) + offset;
  if (effectiveNow >= claims.exp * 1000) return { available: false, reason: "expired", claims };
  // Advancing the floor once a minute is enough for a five-minute tolerance and
  // keeps every offline read from writing the lease record.
  assertCurrent();
  if (now - stored.trustedWall > 60_000) await offlineDatabase.putScoped(userId, "lease", { ...stored, trustedWall: now }, assertCurrent);
  return { available: true, claims };
}
