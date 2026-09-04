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

// The reported failure: "Continue with Google" from the login screen sent
// accept_policies=false, so a first-time Google user was rejected. The consent
// now lives on the button itself, which is what makes it truthful to send.
test("the Google button states the consent it sends, on login and on create-account alike", () => {
  const source = readFileSync(new URL("../src/components/auth/AuthPage.jsx", import.meta.url), "utf8");

  // One start call, used by both screens, and it always carries the acceptance.
  const startCalls = source.match(/authApi\.startOAuth\(/g) || [];
  assert.equal(startCalls.length, 1);
  assert.match(source, /startOAuth\(provider, \{[\s\S]*?acceptPolicies: true[\s\S]*?\}\)/);
  // The screen still identifies itself, so the flow records where it began.
  assert.match(source, /intent: mode === "signup" \? "register" : "login"/);
  // The checkbox gate that used to block the provider button is gone; the
  // button no longer depends on the create-account form's checkbox at all.
  assert.doesNotMatch(source, /mode === "signup" && !form\.acceptPolicies/);
  const beginSocial = source.split("async function beginSocial")[1].split("async function handleSubmit")[0];
  assert.doesNotMatch(beginSocial, /form\.acceptPolicies/);
  // The create-account form still submits the checkbox it collects.
  assert.match(source, /authApi\.register\(\{[^}]*acceptPolicies: form\.acceptPolicies/);

  // The notice is rendered with the button, is announced with it, and links to
  // both policies it claims the reader is accepting.
  assert.match(source, /aria-describedby="auth-social-consent"/);
  assert.match(source, /id="auth-social-consent"[\s\S]*?auth\.socialConsentPrefix/);
  assert.match(source, /auth\.socialConsentPrefix[\s\S]*?to="\/terms"[\s\S]*?to="\/privacy"/);

  // The email-and-password form keeps its own explicit acceptance checkbox.
  assert.match(source, /className="auth-v2-check auth-v2-policy"[\s\S]*?checked=\{form\.acceptPolicies\}/);
});

test("the provider consent notice is written in both locales", async () => {
  const catalogue = await readFile(new URL("../src/lib/i18n.js", import.meta.url), "utf8");

  for (const key of ["auth.socialConsentPrefix", "auth.socialConsentSuffix"]) {
    assert.equal(catalogue.split(`"${key}":`).length - 1, 2, `${key} must exist in both locales`);
  }
  // The English notice has to name what continuing agrees to.
  assert.match(catalogue, /"auth\.socialConsentPrefix": "By continuing with Google you agree to/);
});

test("a provider sign-in with no account here is offered registration, not a closed platform", () => {
  const source = readFileSync(new URL("../src/components/auth/AuthPage.jsx", import.meta.url), "utf8");

  assert.match(source, /signup_required: "auth\.oauthSignupRequired"/);
  assert.match(source, /code === "signup_required".*setMode\("signup"\)/s);
  // A hand-off that never left the document must not leave the button disabled.
  assert.match(source, /function changeMode[\s\S]*?setSocialLoading\(""\);/);
  assert.match(source, /event\.persisted\) setSocialLoading\(""\)/);
});

// The provider's name is not the reader's Lock-in identity, so the username
// step must not carry a name field along with the username for the two to be
// joined on the way in.
test("the username step submits the username alone, never a name beside it", () => {
  const source = readFileSync(new URL("../src/components/auth/AuthPage.jsx", import.meta.url), "utf8");

  // While a username is required, the name is withheld and only the username
  // is sent; the name is offered only once the username step is behind us.
  assert.match(source, /username: requiresUsername \? form\.username : undefined/);
  assert.match(source, /fullName: !requiresUsername && requiresName \? form\.name : undefined/);
  // Nothing builds a display string out of the two identities together.
  assert.doesNotMatch(source, /form\.name\s*\+/);
  assert.doesNotMatch(source, /\$\{form\.name\}[^`]*\$\{form\.username\}/);
  assert.doesNotMatch(source, /\$\{user\.name\}[^`]*\$\{user\.username\}/);
});

test("the shell shows one identity field, and it is the account's display name", () => {
  const shell = readFileSync(new URL("../src/components/layout/index.jsx", import.meta.url), "utf8");
  const contracts = readFileSync(new URL("../src/api/accounts.js", import.meta.url), "utf8");

  // `name` is mapped from exactly one server field, so there is a single
  // display identity rather than two competing ones.
  assert.match(contracts, /name: normalized\.full_name/);
  assert.doesNotMatch(contracts, /name: `\$\{/);
  // Both places the shell prints a name print that one field on its own.
  assert.match(shell, /<strong dir="auto">\{user\?\.name \|\| t\("shell\.yourProfile"\)\}<\/strong>/);
  assert.match(shell, /<strong id="account-menu-name" dir="auto">\{user\.name \|\| t\("shell\.yourProfile"\)\}<\/strong>/);
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

// Signing out ends work in progress, so it asks first. The dialog is the shared
// ConfirmDialog, not a second dialog system and not window.confirm.
test("logging out is confirmed through the shared dialog before the API is called", () => {
  const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");

  assert.match(app, /import \{ ConfirmDialog \} from "\.\/components\/shared\/ConfirmDialog\.jsx"/);
  assert.doesNotMatch(app, /window\.confirm|globalThis\.confirm/);

  // Every entry point receives the request, never the logout itself.
  assert.match(app, /onSignOut=\{requestLogout\}/);
  assert.match(app, /onLogout=\{requestLogout\}/);
  assert.doesNotMatch(app, /onLogout=\{handleLogout\}/);
  assert.doesNotMatch(app, /onSignOut=\{handleLogout\}/);

  // Only the confirmation reaches the unchanged logout call.
  const confirmLogout = app.split("const confirmLogout")[1].split("const logoutConfirmDialog")[0];
  assert.match(confirmLogout, /if \(loggingOutRef\.current\) return;/);
  assert.match(confirmLogout, /await handleLogout\(\)/);
  // The in-flight guard is released and the dialog closed however it ends, so
  // a failed sign-out cannot wedge the button or hide its own error notice.
  assert.match(confirmLogout, /finally \{[\s\S]*loggingOutRef\.current = false;[\s\S]*setLogoutConfirmOpen\(false\)/);

  // Cancelling only closes: nothing about the session is touched.
  const cancelLogout = app.split("const cancelLogout")[1].split("const confirmLogout")[0];
  assert.doesNotMatch(cancelLogout, /handleLogout|authApi/);
  assert.match(cancelLogout, /setLogoutConfirmOpen\(false\)/);

  // The dialog is rendered on both surfaces that can start a sign-out.
  assert.equal((app.match(/\{logoutConfirmDialog\}/g) || []).length, 2);
  assert.match(app, /busy=\{loggingOut\}/);
});

test("the confirmation dialog refuses every exit while its action is in flight", () => {
  const dialog = readFileSync(new URL("../src/components/shared/ConfirmDialog.jsx", import.meta.url), "utf8");

  // Both buttons, the backdrop and Escape are all closed off while busy, so a
  // second confirmation cannot be started and the action cannot be abandoned.
  assert.match(dialog, /confirm-backdrop-dismiss[^>]*disabled=\{busy\}/);
  assert.match(dialog, /btn btn-soft" type="button" disabled=\{busy\}/);
  assert.match(dialog, /btn btn-danger" type="button" disabled=\{busy\}/);
  assert.match(dialog, /e\.key === "Escape" && !busyRef\.current/);
  assert.match(dialog, /aria-busy=\{busy\}/);
  // Opt-in, so the callers that predate it keep their behaviour exactly.
  assert.match(dialog, /busy = false \}\)/);
});

test("the logout confirmation is written in both locales", async () => {
  const catalogue = await readFile(new URL("../src/lib/i18n.js", import.meta.url), "utf8");

  for (const key of ["auth.logoutConfirmTitle", "auth.logoutConfirmMessage", "auth.logoutWorking"]) {
    assert.equal(catalogue.split(`"${key}":`).length - 1, 2, `${key} must exist in both locales`);
  }
  assert.match(catalogue, /"auth\.logoutConfirmTitle": "Log out of Lock-in\?"/);
  assert.match(catalogue, /"auth\.logoutConfirmTitle": "تسجيل الخروج من Lock-in؟"/);
});

// Verification proves control of the mailbox, which is the evidence a sign-in
// asks for. The reader continues into the product instead of a login form.
test("a verification that signed the reader in refreshes state and leaves the token route", () => {
  const page = readFileSync(new URL("../src/components/auth/TokenActionPage.jsx", import.meta.url), "utf8");
  const api = readFileSync(new URL("../src/api/accounts.js", import.meta.url), "utf8");

  // The client treats the returned account as the signal, and mirrors the
  // CSRF rotation that any other sign-in causes.
  assert.match(api, /async verifyEmail\(token\)/);
  const verifyEmail = api.split("async verifyEmail(token)")[1].split("resendVerification")[0];
  assert.match(verifyEmail, /clearCsrfToken\(\);/);
  assert.match(verifyEmail, /setSessionMarker\(true\);/);
  // Nothing from the URL is trusted as authentication; the cookie does that.
  assert.doesNotMatch(verifyEmail, /location|searchParams/);

  assert.match(page, /authenticated = Boolean\(result\?\.user\)/);
  // State is refreshed first, then the authed destination replaces this route.
  assert.match(page, /refreshedUser = \(await onAccountChanged\?\.\(\)\) \|\| null/);
  assert.match(page, /if \(authenticated && refreshedUser\) \{[\s\S]*?navigate\("\/", \{ replace: true \}\)/);
  // The token is still stripped from the visible URL the moment it is captured.
  assert.match(page, /navigate\(routePath, \{ replace: true \}\)/);
  // A verification that did not authenticate keeps the previous behaviour.
  assert.match(page, /state: \{ accountActionMessage:/);
});

test("the manifest asks for the standards-compliant launch behaviour only", async () => {
  const config = await readFile(new URL("../vite.config.js", import.meta.url), "utf8");

  // navigate-existing is real and specified; it reuses an already-open window
  // when the platform hands the app a link at all.
  assert.match(config, /launch_handler: \{ client_mode: "navigate-existing" \}/);
  // The routing architecture the mailed link depends on is unchanged.
  assert.match(config, /start_url: basePath/);
  assert.match(config, /scope: basePath/);
  // No pretend deep-linking: nothing here claims to capture links itself.
  assert.doesNotMatch(config, /apple-app-site-association|universal_links|custom_scheme/);
});
