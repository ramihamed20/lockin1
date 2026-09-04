import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
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

// The email links are single-use routes. TokenActionPage strips the token from
// the URL as soon as the router has it, and the replacement URL has to be the
// route the page is mounted on: the flow type is not a route name ("verify" is
// served at /verify-email), so replacing with the type navigates the visitor
// off the confirmation page and throws the token away.
test("the token page returns to its own route when it strips the token", () => {
  const source = readFileSync(new URL("../src/components/auth/TokenActionPage.jsx", import.meta.url), "utf8");

  assert.doesNotMatch(source, /navigate\(`\/\$\{type\}`/);
  assert.match(source, /const routePath = location\.pathname;/);
  assert.match(source, /navigate\(routePath, \{ replace: true \}\)/);
  assert.match(source, /navigate\(routePath, \{\s*replace: true,\s*state:/);
});

test("every token route the app mounts is reachable by the type it passes", () => {
  const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  const tokenPage = readFileSync(new URL("../src/components/auth/TokenActionPage.jsx", import.meta.url), "utf8");

  const routes = app.match(/\["\/verify-email", "\/confirm-email", "\/reset-password"\]/);
  assert.ok(routes, "App must still branch on the three token routes");
  // The two non-reset flows are keyed by type in the page's FLOW table.
  for (const type of ["verify", "confirm-email"]) {
    assert.ok(tokenPage.includes(`"${type}"`) || tokenPage.includes(`${type}:`), `FLOW must define ${type}`);
  }
});

test("a provider sign-in with no account here is offered registration, not a closed platform", () => {
  const source = readFileSync(new URL("../src/components/auth/AuthPage.jsx", import.meta.url), "utf8");

  assert.match(source, /signup_required: "auth\.oauthSignupRequired"/);
  assert.match(source, /code === "signup_required".*setMode\("signup"\)/s);
  // A hand-off that never left the document must not leave the button disabled.
  assert.match(source, /function changeMode[\s\S]*?setSocialLoading\(""\);/);
  assert.match(source, /event\.persisted\) setSocialLoading\(""\)/);
});

test("the OAuth outcome catalogue carries a message for every backend error code", async () => {
  const catalogue = await readFile(new URL("../src/lib/i18n.js", import.meta.url), "utf8");
  const backendCodes = [
    "auth.oauthAccountLink",
    "auth.oauthConfiguration",
    "auth.oauthFlow",
    "auth.oauthRateLimited",
    "auth.oauthRegistration",
    "auth.oauthSignupRequired",
    "auth.oauthProviderError",
    "auth.oauthCancelled"
  ];
  for (const key of backendCodes) {
    const occurrences = catalogue.split(`"${key}":`).length - 1;
    assert.equal(occurrences, 2, `${key} must exist in both locales`);
  }
});
