/**
 * The offline lease key for browser tests only.
 *
 * Production builds pin the deployment's public key, so an e2e build needs a
 * key of its own to let a spec sign leases. The seed is derived from a public
 * string on purpose: this key protects nothing, and nothing secret is stored.
 * `scripts/build-e2e.mjs` compiles its public half into the test bundle.
 */
import { Buffer } from "node:buffer";
import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";

const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const seed = createHash("sha256").update("lock-in e2e offline lease (not a secret)").digest();
const privateKey = createPrivateKey({ key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]), format: "der", type: "pkcs8" });

export const E2E_OFFLINE_LEASE_PUBLIC_KEY = createPublicKey(privateKey).export({ format: "der", type: "spki" }).subarray(-32).toString("base64");

export function signE2eLease(userId, { iat = Math.floor(Date.now() / 1000), exp = iat + 24 * 3600 } = {}) {
  const header = Buffer.from(JSON.stringify({ alg: "EdDSA", typ: "offline-lease+jwt" })).toString("base64url");
  const body = Buffer.from(JSON.stringify({ v: 1, sub: userId, user_id: userId, iat, exp, offline_until: exp, subscription_until: null, jti: "e2e" })).toString("base64url");
  const signature = sign(null, Buffer.from(`${header}.${body}`), privateKey).toString("base64url");
  return {
    token: `${header}.${body}.${signature}`,
    public_key: E2E_OFFLINE_LEASE_PUBLIC_KEY,
    issued_at: new Date(iat * 1000).toISOString(),
    offline_until: new Date(exp * 1000).toISOString()
  };
}
