import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  AUTH_FIELD_INPUT_IDS,
  firstInvalidField,
  normalizeAuthError,
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
  assert.match(page, /const invalid = validateAuthForm\(/);
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
