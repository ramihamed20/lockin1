import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { isTrustedOAuthAuthorizationUrl } from "../src/api/accounts.js";
import { normalizeCohort, normalizeUser } from "../src/api/contracts.js";

test("auth contracts preserve cohort and onboarding requirements", () => {
  const cohort = normalizeCohort({
    id: "cohort-61",
    code: "61",
    name_en: "Human Medicine 61",
    name_ar: "الطب البشري 61",
    program: { id: "medicine", code: "human-medicine", name_en: "Human Medicine", name_ar: "الطب البشري" }
  });
  const user = normalizeUser({
    id: "user-1",
    email: "student@example.test",
    full_name: "",
    preferred_language: "ar",
    status: "active",
    is_email_verified: true,
    cohort,
    onboarding_required: true,
    required_profile_fields: ["full_name"],
    roles: ["student"]
  });

  assert.equal(user.cohort.code, "61");
  assert.equal(user.onboarding_required, true);
  assert.deepEqual(user.required_profile_fields, ["full_name"]);
});

test("OAuth redirects accept only each provider's exact official HTTPS origin", () => {
  assert.equal(isTrustedOAuthAuthorizationUrl("google", "https://accounts.google.com/o/oauth2/v2/auth?state=signed"), true);
  assert.equal(isTrustedOAuthAuthorizationUrl("apple", "https://appleid.apple.com/auth/authorize?state=signed"), true);
  assert.equal(isTrustedOAuthAuthorizationUrl("google", "https://accounts.google.com.evil.test/auth"), false);
  assert.equal(isTrustedOAuthAuthorizationUrl("apple", "http://appleid.apple.com/auth/authorize"), false);
  assert.equal(isTrustedOAuthAuthorizationUrl("google", "javascript:alert(1)"), false);
});

test("auth UI uses the shared i18n and data-backed cohort APIs", () => {
  const source = readFileSync(new URL("../src/components/auth/AuthPage.jsx", import.meta.url), "utf8");

  assert.match(source, /useI18n\(\)/);
  assert.match(source, /authApi\.listCohorts\(\)/);
  assert.match(source, /authApi\.startOAuth\(provider/);
  assert.doesNotMatch(source, /a19b3034-e038-46b8-8806-7b113329f0/);
  assert.doesNotMatch(source, /localStorage.*token/i);
});
