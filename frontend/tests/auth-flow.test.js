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
  // The account menu is now the only place the shell prints a name, and it
  // prints that one field on its own. The mobile drawer used to print it too;
  // that section was removed, so identity appears exactly once.
  assert.match(shell, /<strong id="account-menu-name" dir="auto">\{user\.name \|\| t\("shell\.yourProfile"\)\}<\/strong>/);
  assert.equal((shell.match(/user\??\.name \|\| t\("shell\.yourProfile"\)/g) || []).length, 1);
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

// A page restored from the back/forward cache comes back with the JavaScript
// heap as it was when the reader left, including a user whose session may have
// ended since. That copy is not evidence of a session.
test("a bfcache restore of an authenticated view revalidates silently without remounting it", () => {
  const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");

  const handler = app.split("function revalidateRestoredSession")[1].split("window.addEventListener")[0];
  // Only a genuine restore, and only when protected content is on screen: an
  // ordinary load or a public screen must not cost an extra session request.
  assert.match(handler, /if \(!event\.persisted \|\| !authenticatedRef\.current(?: \|\| sessionRevalidationRef\.current)?\) return;/);
  // Validation uses the normal account endpoint, but never switches the
  // rendered app back to its blocking bootstrap state.
  assert.match(handler, /refreshActiveAccount\(\)/);
  assert.doesNotMatch(handler, /retryBootstrap\(\)|setBooting\(true\)|location\.reload|window\.location/);

  assert.match(app, /window\.addEventListener\("pageshow", revalidateRestoredSession\)/);
  assert.match(app, /window\.removeEventListener\("pageshow", revalidateRestoredSession\)/);
  // The ref is what keeps the listener from being re-registered per user change.
  assert.match(app, /authenticatedRef\.current = Boolean\(user\)/);
});

test("a successful sign-out replaces the protected entry instead of stacking one", () => {
  const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");

  const confirmLogout = app.split("const confirmLogout")[1].split("const logoutConfirmDialog")[0];
  assert.match(confirmLogout, /const signedOut = await handleLogout\(\)/);
  assert.match(confirmLogout, /if \(signedOut\) navigate\("\/", \{ replace: true \}\)/);
  // A failed sign-out leaves the session alive, so it must not move the reader.
  assert.doesNotMatch(confirmLogout, /navigate\("\/"\)/);

  // handleLogout reports whether the session actually ended.
  const handleLogout = app.split("const handleLogout")[1].split("// A page restored")[0];
  assert.match(handleLogout, /return true;/);
  assert.match(handleLogout, /return false;/);
});

test("the no-store middleware is registered and scoped to the API only", async () => {
  const settings = await readFile(new URL("../../backend/config/settings/base.py", import.meta.url), "utf8");
  const middleware = await readFile(new URL("../../backend/platform_core/api/middleware.py", import.meta.url), "utf8");

  assert.match(settings, /"platform_core\.api\.middleware\.ApiNoStoreMiddleware"/);
  // Narrow by construction: static assets and CDN-cached documents are untouched.
  assert.match(middleware, /API_PATH_PREFIX = "\/api\/"/);
  assert.match(middleware, /if not request\.path\.startswith\(API_PATH_PREFIX\)/);
  // An endpoint that set its own policy keeps it.
  assert.match(middleware, /if response\.has_header\("Cache-Control"\)/);
  assert.match(middleware, /no-store/);
});

// Losing a session mid-visit is a different event from arriving without one.
test("a session that ends mid-visit explains itself instead of just vanishing", () => {
  const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  const client = readFileSync(new URL("../src/api/client.js", import.meta.url), "utf8");
  const authPage = readFileSync(new URL("../src/components/auth/AuthPage.jsx", import.meta.url), "utf8");

  // Only a signed-in reader is told; an anonymous first load answers 403 by
  // design and must stay silent, or every visitor would be told their session
  // expired.
  const handler = app.split("onUnauthorized(() =>")[1].split("}), [clearAuthenticatedUi")[0];
  assert.match(handler, /if \(authenticatedRef\.current\) setSessionNotice\(t\("auth\.sessionExpired"\)\)/);
  assert.match(handler, /clearAuthenticatedUi\(\)/);

  // A revoked session, or a sign-out on another device, reads as 403
  // not_authenticated -- and only that code, so permission_denied and CSRF
  // failures are not mistaken for an ended session.
  assert.match(client, /response\.status === 401 \|\| \(response\.status === 403 && error\.code === "not_authenticated"\)/);
  assert.doesNotMatch(client, /response\.status === 403\)\s*notifyUnauthorized/);

  // The reason is shown on the only screen left, through the existing alert.
  assert.match(app, /notice=\{sessionNotice\}/);
  assert.match(authPage, /notice = "", onDismissNotice = null/);
  assert.match(authPage, /className="form-alert error auth-v2-session-notice" role="status" dir="auto"/);
  // It clears once the reader acts, so it cannot follow them around.
  assert.match(authPage, /onDismissNotice\?\.\(\);\s*\n\s*setMode\(nextMode\)/);
  assert.match(authPage, /onDismissNotice\?\.\(\);\s*\n\s*setError\(null\)/);
});

test("the session-expired notice is written in both locales", async () => {
  const catalogue = await readFile(new URL("../src/lib/i18n.js", import.meta.url), "utf8");

  assert.equal(catalogue.split('"auth.sessionExpired":').length - 1, 2);
  assert.match(catalogue, /"auth\.sessionExpired": "Your session has ended\./);
  assert.match(catalogue, /"auth\.sessionExpired": "انتهت جلستك\./);
});

test("a short browser restart restores the non-secret session UI before silent validation", () => {
  const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");

  assert.match(app, /const SESSION_USER_SNAPSHOT_KEY = "lock-in\.session-user"/);
  assert.match(app, /const \[user, setUser\] = useState\(readSessionUserSnapshot\)/);
  assert.match(app, /const \[booting, setBooting\] = useState\(\(\) => !user\)/);
  assert.match(app, /const silentlyRevalidateRestoredApp = resumedSessionRef\.current && sessionAttempt === 0/);
  assert.match(app, /if \(!silentlyRevalidateRestoredApp\) setBooting\(true\)/);
  assert.match(app, /if \(active && !silentlyRevalidateRestoredApp\) setBooting\(false\)/);
  // Only ordinary profile metadata is stored; the session cookie/token remains
  // server-owned and out of Web Storage.
  assert.doesNotMatch(app, /session-user[\s\S]{0,300}(?:access_token|refresh_token|session_token)/);
});

test("account validation connects each invalid control to one field message", async () => {
  const [errors, authPage, tokenPage, settings, profile] = await Promise.all([
    readFile(new URL("../src/components/account/AccountFormErrors.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/auth/AuthPage.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/auth/TokenActionPage.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/Settings.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/Profile.jsx", import.meta.url), "utf8")
  ]);

  assert.match(errors, /"aria-invalid": invalid \|\| undefined/);
  assert.match(errors, /"aria-describedby": ids \|\| undefined/);
  assert.match(errors, /fieldValues\.includes\(error\.message\)/);
  for (const source of [authPage, tokenPage, settings, profile]) {
    assert.match(source, /fieldErrorAttributes\(/);
    assert.match(source, /AccountFieldErrors[^>]+id=/);
  }
});

test("token actions and account management copy are localized in both languages", async () => {
  const catalogue = await readFile(new URL("../src/lib/i18n.js", import.meta.url), "utf8");
  for (const key of ["token.verifyTitle", "token.resetSuccess", "settings.changePassword", "settings.deleteAccount", "settings.connectedAccounts"]) {
    assert.equal(catalogue.split(`"${key}":`).length - 1, 2, `${key} must exist in English and Arabic`);
  }
});

// These already existed and are asserted here so a later change cannot quietly
// remove them: the project's transient-failure policy is bounded and does not
// treat ordinary HTTP answers as network trouble.
test("network-failure recovery stays bounded and does not swallow real answers", async () => {
  const bootstrap = await readFile(new URL("../src/lib/sessionBootstrap.js", import.meta.url), "utf8");

  assert.match(bootstrap, /MAX_AUTOMATIC_BOOT_RETRIES = 3/);
  assert.match(bootstrap, /attempts < MAX_AUTOMATIC_BOOT_RETRIES/);
  // Only transport-shaped failures retry; 4xx answers are real and are kept.
  assert.match(bootstrap, /if \(status === 0\) return true;/);
  assert.match(bootstrap, /status === 408 \|\| status === 429/);
  assert.match(bootstrap, /status >= 500 && status <= 599/);
  assert.match(bootstrap, /if \(!online\) return false;/);
});
