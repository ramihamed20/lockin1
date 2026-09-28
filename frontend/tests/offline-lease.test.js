import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { generateKeyPairSync, sign, webcrypto } from "node:crypto";
import test from "node:test";

import { verifyLease } from "../src/offline/lease.js";

function tokenFor(claims) {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const header = Buffer.from(JSON.stringify({ alg: "EdDSA", typ: "offline-lease+jwt" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = sign(null, Buffer.from(`${header}.${body}`), privateKey).toString("base64url");
  const rawPublic = publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("base64");
  return { token: `${header}.${body}.${signature}`, publicKey: rawPublic };
}

test("offline lease verifies signature, user, and subscription ceiling", async () => {
  globalThis.crypto ||= webcrypto;
  const now = Math.floor(Date.now() / 1000);
  const claims = { v: 1, sub: "user-a", iat: now, exp: now + 3600, offline_until: now + 3600, subscription_until: now + 3600 };
  const { token, publicKey } = tokenFor(claims);
  assert.equal((await verifyLease(token, "user-a", publicKey))?.exp, claims.exp);
  assert.equal(await verifyLease(token, "user-b", publicKey), null);
  const parts = token.split(".");
  parts[1] = Buffer.from(JSON.stringify({ ...claims, exp: now + 7200 })).toString("base64url");
  assert.equal(await verifyLease(parts.join("."), "user-a", publicKey), null);
  const invalidCeiling = tokenFor({ ...claims, subscription_until: now + 300 });
  assert.equal(await verifyLease(invalidCeiling.token, "user-a", invalidCeiling.publicKey), null);
});
