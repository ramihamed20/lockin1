import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  AUTH_FIELD_INPUT_IDS,
  AUTH_FIELD_ORDER,
  SIGNUP_STEP_FIELDS,
  fieldsForSignupStep,
  firstInvalidField,
  normalizeAuthError,
  signupStepForField,
  validateAuthForm
} from "../src/lib/authValidation.js";

// The catalogue is the source of the reader-facing wording; the tests assert on
// keys so a copy change never breaks them.
const t = (key) => key;

const EMPTY = {
  username: "", name: "", email: "", password: "", confirm: "",
  collegeId: "", specialtyId: "", cohortId: "", acceptPolicies: false
};

const VALID_SIGNUP = {
  ...EMPTY,
  name: "Sara Ahmed",
  email: "sara@example.com",
  password: "Molar!Focus8412",
  confirm: "Molar!Focus8412",
  collegeId: "tripoli",
  specialtyId: "dentistry",
  cohortId: "cohort-1",
  acceptPolicies: true
};

test("every field the form can complain about has a control to focus", () => {
  const known = new Set(Object.keys(AUTH_FIELD_INPUT_IDS));
  const cases = [
    ["signup", EMPTY],
    ["login", EMPTY],
    ["forgot", EMPTY],
    ["signup", { ...VALID_SIGNUP, confirm: "different" }]
  ];
  for (const [mode, form] of cases) {
    for (const field of Object.keys(validateAuthForm({ mode, form, t }))) {
      assert.ok(known.has(field), `${field} has no input id`);
    }
  }
});

test("an empty create-account form names every missing field, in screen order", () => {
  const fields = validateAuthForm({ mode: "signup", form: EMPTY, t });
  assert.deepEqual(Object.keys(fields).sort(), [
    "accept_policies", "college", "email", "full_name", "password", "password_confirm"
  ]);
  assert.equal(firstInvalidField(fields, "signup"), "full_name");
});

test("create-account messages are split between the account and study-path screens", () => {
  // Every field the form can complain about belongs to exactly one screen, and
  // the screen order matches the order the reader meets them.
  const stepOne = [...SIGNUP_STEP_FIELDS[1]];
  const stepTwo = [...SIGNUP_STEP_FIELDS[2]];
  assert.deepEqual([...stepOne, ...stepTwo], [...AUTH_FIELD_ORDER.signup]);
  assert.equal(stepOne.filter((field) => stepTwo.includes(field)).length, 0);

  const fields = validateAuthForm({ mode: "signup", form: EMPTY, t });
  assert.deepEqual(Object.keys(fieldsForSignupStep(fields, 1)).sort(), ["email", "full_name", "password", "password_confirm"]);
  assert.deepEqual(Object.keys(fieldsForSignupStep(fields, 2)).sort(), ["accept_policies", "college"]);
  // A complete account screen has nothing to say on its own, whatever the
  // unanswered study path would add later.
  const accountOnly = { ...VALID_SIGNUP, collegeId: "", specialtyId: "", cohortId: "", acceptPolicies: false };
  assert.deepEqual(fieldsForSignupStep(validateAuthForm({ mode: "signup", form: accountOnly, t }), 1), {});

  // A server message about the account goes back to the account screen; one
  // about a field the form never shows stays where the request was sent.
  assert.equal(signupStepForField("password"), 1);
  assert.equal(signupStepForField("email"), 1);
  assert.equal(signupStepForField("cohort_id"), 2);
  assert.equal(signupStepForField("preferred_language"), 2);
});

test("the study path is asked for one step at a time", () => {
  const college = validateAuthForm({ mode: "signup", form: { ...VALID_SIGNUP, collegeId: "", specialtyId: "", cohortId: "" }, t });
  assert.deepEqual(Object.keys(college), ["college"]);
  const specialty = validateAuthForm({ mode: "signup", form: { ...VALID_SIGNUP, specialtyId: "", cohortId: "" }, t });
  assert.deepEqual(Object.keys(specialty), ["specialty"]);
  const year = validateAuthForm({ mode: "signup", form: { ...VALID_SIGNUP, cohortId: "" }, t });
  assert.deepEqual(Object.keys(year), ["cohort_id"]);
});

test("email, password length and confirmation are checked before any request", () => {
  assert.deepEqual(
    validateAuthForm({ mode: "signup", form: { ...VALID_SIGNUP, email: "sara@@example" }, t }).email,
    ["auth.errorEmailInvalid"]
  );
  assert.deepEqual(
    validateAuthForm({ mode: "signup", form: { ...VALID_SIGNUP, password: "short1", confirm: "short1" }, t }).password,
    ["auth.errorPasswordShort"]
  );
  assert.deepEqual(
    validateAuthForm({ mode: "signup", form: { ...VALID_SIGNUP, confirm: "Molar!Focus8413" }, t }).password_confirm,
    ["auth.passwordMismatch"]
  );
  assert.deepEqual(
    validateAuthForm({ mode: "signup", form: { ...VALID_SIGNUP, acceptPolicies: false }, t }).accept_policies,
    ["auth.acceptRequired"]
  );
  assert.deepEqual(validateAuthForm({ mode: "signup", form: VALID_SIGNUP, t }), {});
});

test("surrounding spaces do not make a field look empty", () => {
  const padded = { ...VALID_SIGNUP, name: "   ", email: "   " };
  const fields = validateAuthForm({ mode: "signup", form: padded, t });
  assert.deepEqual(fields.full_name, ["auth.errorRequired"]);
  assert.deepEqual(fields.email, ["auth.errorRequired"]);
});

test("sign-in never pre-judges the length of an existing password", () => {
  const fields = validateAuthForm({ mode: "login", form: { ...EMPTY, email: "sara@example.com", password: "old" }, t });
  assert.deepEqual(fields, {});
});

test("a rejected sign-in is reported on the password, not as a bare banner", () => {
  const error = { code: "invalid_credentials", message: "The email or password is incorrect.", fields: null };
  const normalized = normalizeAuthError(error, { t, mode: "login" });
  assert.deepEqual(normalized.fields.password, ["auth.errorInvalidCredentials"]);
  assert.equal(firstInvalidField(normalized.fields, "login"), "password");
});

test("Django's placeholder banner gives way to the field message it stands for", () => {
  const error = {
    code: "invalid",
    message: "The request could not be completed.",
    fields: { password: ["This password is too common.", "This password is entirely numeric."] }
  };
  const normalized = normalizeAuthError(error, { t, mode: "signup" });
  assert.deepEqual(normalized.fields.password, ["auth.errorPasswordCommon", "auth.errorPasswordNumeric"]);
  assert.equal(normalized.message, "auth.errorPasswordCommon");
});

test("backend prose becomes the reader's own wording, and unknown prose survives", () => {
  const error = {
    code: "invalid",
    message: "The request could not be completed.",
    fields: { email: ["Enter a valid email address."], full_name: ["This field may not be blank."], cohort_id: ["Something new the client has never seen."] }
  };
  const { fields } = normalizeAuthError(error, { t, mode: "signup" });
  assert.deepEqual(fields.email, ["auth.errorEmailInvalid"]);
  assert.deepEqual(fields.full_name, ["auth.errorRequired"]);
  assert.deepEqual(fields.cohort_id, ["Something new the client has never seen."]);
});

test("a transport failure is reported in words, not as a missing field", () => {
  for (const [code, key] of [["network_error", "auth.errorNetwork"], ["timeout", "auth.errorTimeout"], ["offline", "auth.errorOffline"], ["too_many_attempts", "auth.errorTooManyAttempts"]]) {
    const normalized = normalizeAuthError({ code, message: "x", fields: null }, { t, mode: "login" });
    assert.equal(normalized.message, key);
    assert.deepEqual(normalized.fields, {});
  }
});

test("every message key the auth form can show exists in both languages", async () => {
  const catalogue = await readFile(new URL("../src/lib/i18n.js", import.meta.url), "utf8");
  const validation = await readFile(new URL("../src/lib/authValidation.js", import.meta.url), "utf8");
  const page = await readFile(new URL("../src/components/auth/AuthPage.jsx", import.meta.url), "utf8");
  const keys = new Set([...validation.matchAll(/"(auth\.[a-zA-Z]+)"/g), ...page.matchAll(/t\("(auth\.[a-zA-Z]+)"\)/g)].map((match) => match[1]));
  assert.ok(keys.size > 20);
  for (const key of keys) {
    const occurrences = catalogue.split(`"${key}":`).length - 1;
    assert.equal(occurrences, 2, `${key} must be defined in both en and ar`);
  }
});

test("the form owns its validation, focus, and one-submit-at-a-time guard", async () => {
  const page = await readFile(new URL("../src/components/auth/AuthPage.jsx", import.meta.url), "utf8");
  // The browser's own bubbles are off, so every message is ours and placed.
  assert.match(page, /<form className="auth-v2-form" onSubmit=\{handleSubmit\} noValidate>/);
  assert.match(page, /const allInvalid = validateAuthForm\(/);
  assert.match(page, /if \(target\) focusAuthField\(target\);/);
  // A ref, not state: two clicks in one frame both read state as "idle".
  assert.match(page, /if \(submitting\.current \|\| loading \|\| socialLoading\) return;/);
  assert.match(page, /submitting\.current = true;/);
  // Editing a field drops that field's message and keeps the others.
  assert.match(page, /clearFieldError\(\.\.\.\(FORM_FIELD_ERRORS\[field\] \|\| \[\]\)\)/);
  // Google sign-in keeps its own path through the page.
  assert.match(page, /authApi\.startOAuth\(provider/);
  assert.match(page, /onClick=\{\(\) => beginSocial\("google"\)\}/);
});

test("the account screen moves on without ever creating the account", async () => {
  const page = await readFile(new URL("../src/components/auth/AuthPage.jsx", import.meta.url), "utf8");
  const submit = page.split("async function handleSubmit")[1].split("const busy =")[0];
  // Step one is judged on its own fields and returns before any request.
  assert.match(submit, /const accountStep = mode === "signup" && signupStep === 1;/);
  assert.match(submit, /fieldsForSignupStep\(allInvalid, 1\)/);
  const advance = submit.split("if (accountStep) {")[1].split("}")[0];
  assert.match(advance, /goToSignupStep\(2\);\s*return;/);
  assert.ok(submit.indexOf("if (accountStep) {") < submit.indexOf("authApi.register("), "the advance must return before registration");
  // Both screens stay mounted, so going back loses nothing.
  assert.match(page, /className="auth-v2-step" hidden=\{signupStep !== 1\}/);
  assert.match(page, /className="auth-v2-step" hidden=\{signupStep !== 2\}/);
  // Back cannot race a request that is already on its way.
  assert.match(page, /className="auth-v2-secondary" type="button" disabled=\{busy\} onClick=\{\(\) => goToSignupStep\(1\)\}/);
  // Nothing typed is written anywhere but component state.
  assert.doesNotMatch(page, /(localStorage|sessionStorage)\.setItem/);
});

test("the study-path screen is a history entry, never shown over an incomplete account", async () => {
  const page = await readFile(new URL("../src/components/auth/AuthPage.jsx", import.meta.url), "utf8");
  // Derived from the entry and the form together, not held as free state.
  assert.match(page, /const signupStep = mode === "signup" && historyStep === 2 && accountStepComplete \? 2 : 1;/);
  assert.doesNotMatch(page, /useState\(1\)/);
  // Moving on pushes one entry on the same path; going back is a real Back.
  assert.match(page, /navigate\(historyTarget, \{ state: \{ \.\.\.\(location\.state \|\| \{\}\), \[SIGNUP_STEP_STATE\]: 2 \}, replace: historyStep === 2 \}\)/);
  assert.match(page, /if \(historyStep === 2\) navigate\(-1\);/);
  // Only the hash path is routed on, so a state-only entry changes no route.
  assert.match(page, /const historyTarget = \{ pathname: location\.pathname, search: location\.search \};/);
  // Following a policy never unmounts the form it was read from.
  assert.match(page, /POLICY_LINK_PROPS = Object\.freeze\(\{ target: "_blank", rel: "noopener noreferrer" \}\)/);
  assert.equal((page.match(/to="\/(terms|privacy)" \{\.\.\.POLICY_LINK_PROPS\}/g) || []).length, 4);
});

test("every account failure the server names gets its own words, beside the right box", () => {
  const cases = [
    ["invalid_verification_code", "auth.codeIncorrect", "code"],
    ["verification_code_expired", "auth.codeExpired", "code"],
    ["verification_code_replaced", "auth.codeReplaced", "code"],
    ["verification_attempts_exceeded", "auth.codeAttemptsExceeded", "code"],
    ["email_already_verified", "auth.emailAlreadyVerified", ""],
    ["email_delivery_unavailable", "auth.errorEmailDelivery", ""],
    ["too_many_attempts", "auth.errorTooManyAttempts", ""]
  ];
  for (const [code, key, field] of cases) {
    const normalized = normalizeAuthError({ code, message: "server prose", fields: null, status: 400 }, { t, mode: "verify" });
    assert.equal(normalized.message, key, code);
    if (field) assert.deepEqual(normalized.fields[field], [key], code);
    else assert.deepEqual(normalized.fields, {}, code);
  }
});

test("a link page reads link wording, never the code box's", () => {
  for (const [code, key] of [
    ["invalid_reset_token", "auth.resetLinkInvalid"],
    ["reset_link_expired", "auth.resetLinkExpired"],
    ["reset_link_used", "auth.resetLinkUsed"],
    ["email_link_expired", "auth.emailLinkExpired"],
    ["email_link_used", "auth.emailLinkUsed"]
  ]) {
    assert.equal(normalizeAuthError({ code, message: "x", fields: null, status: 400 }, { t, mode: "reset" }).message, key);
  }
  // The legacy code keeps the code-box wording on the code screen only.
  assert.equal(normalizeAuthError({ code: "invalid_or_expired_token", message: "x", status: 400 }, { t, mode: "reset" }).message, "auth.linkInvalid");
  assert.equal(normalizeAuthError({ code: "invalid_or_expired_token", message: "x", status: 400 }, { t, mode: "verify" }).message, "auth.codeInvalid");
});

test("a failure with no code is read from its status, never shown as raw English", () => {
  // A proxy's HTML error page: the client only has "Request failed (502)."
  for (const status of [502, 503, 504]) {
    const normalized = normalizeAuthError({ code: "", message: `Request failed (${status}).`, fields: null, status }, { t });
    assert.equal(normalized.message, "auth.errorServiceUnavailable");
  }
  assert.equal(normalizeAuthError({ code: "", message: "Request failed (500).", status: 500 }, { t }).message, "auth.errorGeneric");
  assert.equal(normalizeAuthError({ code: "", message: "Request failed (429).", status: 429 }, { t }).message, "auth.errorTooManyAttempts");
});

test("password-change messages from the server are put in the reader's words", () => {
  const normalized = normalizeAuthError({
    code: "invalid",
    message: "The request could not be completed.",
    status: 400,
    fields: {
      current_password: ["The current password is incorrect."],
      new_password: ["Choose a new password that is different from your current one."]
    }
  }, { t, mode: "password_change" });
  assert.deepEqual(normalized.fields.current_password, ["auth.errorCurrentPassword"]);
  assert.deepEqual(normalized.fields.new_password, ["auth.errorPasswordSame"]);
  assert.equal(firstInvalidField(normalized.fields, "password_change"), "current_password");
  const email = normalizeAuthError({ code: "invalid", status: 400, fields: { new_email: ["Enter an email address different from the current one."] } }, { t });
  assert.deepEqual(email.fields.new_email, ["auth.errorEmailSame"]);
});

test("success wording promises only what the server knows: queued, not delivered", async () => {
  const catalogue = await readFile(new URL("../src/lib/i18n.js", import.meta.url), "utf8");
  const english = catalogue.slice(0, catalogue.indexOf('"auth.platform": "منصة تعليمية"'));
  for (const key of ["auth.codeSubtitle", "auth.verificationSent", "auth.resetSent"]) {
    const line = english.split(`"${key}":`)[1].split("\n")[0];
    assert.doesNotMatch(line, /\b(has been sent|we sent|delivered)\b/i, key);
  }
  // The neutral reset answer never says whether the address has an account.
  assert.match(catalogue, /"auth\.resetSent": "If this email is eligible, you’ll receive a message with the next steps\./);
  assert.match(catalogue, /"auth\.resetSent": "إذا كان البريد مؤهلًا، ستصلك رسالة تتضمن الخطوات التالية\./);
});
