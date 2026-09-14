/**
 * Field-level validation and error translation for the sign-in / create-account form.
 *
 * Two jobs, both about the same thing: the reader must always be told which box
 * to change and what to put in it.
 *
 * 1. `validateAuthForm` answers the questions we can answer without the server,
 *    so a mistyped email costs no round trip and no wait.
 * 2. `normalizeAuthError` turns what Django sends -- DRF's field dictionary and
 *    its English validator strings -- into the same shape, in the reader's
 *    language, attributed to the field the reader can act on.
 *
 * Both return `{ field: [message] }`, so the form renders one kind of thing and
 * `firstInvalidField` can decide where to put the caret.
 */

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;
export const MIN_NAME_LENGTH = 2;
export const MAX_NAME_LENGTH = 150;

/**
 * The order the reader meets the fields on screen. Focus goes to the first
 * field in this order that has a message, so the caret never jumps backwards
 * past something the reader has not reached yet.
 */
export const AUTH_FIELD_ORDER = Object.freeze({
  login: ["email", "password"],
  signup: [
    "full_name",
    "college",
    "specialty",
    "cohort_id",
    "email",
    "password",
    "password_confirm",
    "accept_policies"
  ],
  forgot: ["email"],
  complete: ["username", "full_name", "college", "specialty", "cohort_id"]
});

/** The DOM id that holds each field's focus target. */
export const AUTH_FIELD_INPUT_IDS = Object.freeze({
  username: "auth-username",
  full_name: "auth-name",
  college: "auth-college",
  specialty: "auth-specialty",
  cohort_id: "auth-cohort",
  email: "auth-email",
  password: "auth-password",
  password_confirm: "auth-confirm",
  accept_policies: "auth-policies"
});

// Deliberately permissive: the server owns the authoritative answer, and a
// pattern strict enough to argue with real addresses would reject valid ones.
// This only catches what is plainly not an address at all.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
const USERNAME_PATTERN = /^[a-z0-9][a-z0-9_]{2,29}$/;

/**
 * Django's password validators answer in English prose. Match on the part of
 * each message that identifies the rule, so the reader gets the translated
 * sentence and any message we do not recognise still reaches them verbatim.
 */
/** @type {[RegExp, string][]} */
const BACKEND_MESSAGE_KEYS = [
  [/this field may not be blank|this field is required|may not be null/i, "auth.errorRequired"],
  [/enter a valid email address/i, "auth.errorEmailInvalid"],
  [/passwords do not match/i, "auth.passwordMismatch"],
  [/too short|at least \d+ characters/i, "auth.errorPasswordShort"],
  [/too common/i, "auth.errorPasswordCommon"],
  [/entirely numeric/i, "auth.errorPasswordNumeric"],
  [/too similar to/i, "auth.errorPasswordSimilar"],
  [/username is unavailable/i, "auth.errorUsernameTaken"],
  [/email or password is incorrect/i, "auth.errorInvalidCredentials"],
  [/policy acceptance is required/i, "auth.acceptRequired"],
  [/invalid pk|object does not exist|not a valid/i, "auth.errorSelectionInvalid"]
];

const ERROR_CODE_KEYS = {
  invalid_credentials: "auth.errorInvalidCredentials",
  too_many_attempts: "auth.errorTooManyAttempts",
  throttled: "auth.errorTooManyAttempts",
  registration_unavailable: "auth.errorRegistrationClosed",
  offline: "auth.errorOffline",
  network_error: "auth.errorNetwork",
  timeout: "auth.errorTimeout"
};

/** Which field a whole-request failure belongs beside. */
const ERROR_CODE_FIELDS = {
  invalid_credentials: "password"
};

function translateBackendMessage(message, t) {
  const text = typeof message === "string" ? message.trim() : "";
  if (!text) return "";
  const match = BACKEND_MESSAGE_KEYS.find(([pattern]) => pattern.test(text));
  return match ? t(match[1]) : text;
}

function messageList(value, t) {
  if (typeof value === "string") return [translateBackendMessage(value, t)].filter(Boolean);
  if (Array.isArray(value)) return value.flatMap((entry) => messageList(entry, t));
  if (value && typeof value === "object") return Object.values(value).flatMap((entry) => messageList(entry, t));
  return [];
}

/**
 * @param {{mode: string, form: Record<string, any>, t: (key: string) => string,
 *   requiresName?: boolean, requiresCohort?: boolean, requiresUsername?: boolean}} options
 * @returns {Record<string, string[]>} one message per field that needs changing
 */
export function validateAuthForm({
  mode,
  form,
  t,
  requiresName = true,
  requiresCohort = true,
  requiresUsername = false
}) {
  /** @type {Record<string, string[]>} */
  const fields = {};
  const add = (/** @type {string} */ field, /** @type {string} */ message) => { fields[field] = [message]; };
  const value = (key) => (typeof form[key] === "string" ? form[key].trim() : form[key]);

  if (mode === "complete" && requiresUsername) {
    const username = String(form.username || "").trim();
    if (!username) add("username", t("auth.errorRequired"));
    else if (!USERNAME_PATTERN.test(username)) add("username", t("auth.usernameHint"));
    return fields;
  }

  const wantsName = mode === "signup" || (mode === "complete" && requiresName);
  if (wantsName) {
    const name = String(value("name") || "");
    if (!name) add("full_name", t("auth.errorRequired"));
    else if (name.length < MIN_NAME_LENGTH) add("full_name", t("auth.errorNameShort"));
    else if (name.length > MAX_NAME_LENGTH) add("full_name", t("auth.errorNameLong"));
  }

  const wantsCohort = mode === "signup" || (mode === "complete" && requiresCohort);
  if (wantsCohort) {
    if (!form.collegeId) add("college", t("auth.errorRequired"));
    else if (!form.specialtyId) add("specialty", t("auth.errorRequired"));
    else if (!form.cohortId) add("cohort_id", t("auth.errorRequired"));
  }

  if (mode !== "complete") {
    const email = String(value("email") || "");
    if (!email) add("email", t("auth.errorRequired"));
    else if (!EMAIL_PATTERN.test(email)) add("email", t("auth.errorEmailInvalid"));
  }

  if (mode === "login" || mode === "signup") {
    const password = String(form.password || "");
    if (!password) add("password", t("auth.errorRequired"));
    // Only the create-account form states password rules. On sign-in the
    // stored password is whatever it is, and pre-judging its length would
    // refuse to even try an account that predates the rule.
    else if (mode === "signup" && password.length < MIN_PASSWORD_LENGTH) add("password", t("auth.errorPasswordShort"));
    else if (mode === "signup" && password.length > MAX_PASSWORD_LENGTH) add("password", t("auth.errorPasswordLong"));
  }

  if (mode === "signup") {
    if (!form.confirm) add("password_confirm", t("auth.errorRequired"));
    else if (form.confirm !== form.password) add("password_confirm", t("auth.passwordMismatch"));
    if (!form.acceptPolicies) add("accept_policies", t("auth.acceptRequired"));
  }

  return fields;
}

/**
 * The first field the reader should be taken to, in screen order.
 * @returns {string} the field key, or "" when nothing is wrong
 */
export function firstInvalidField(fields, mode) {
  if (!fields) return "";
  const order = AUTH_FIELD_ORDER[mode] || [];
  const ordered = order.find((field) => Array.isArray(fields[field]) && fields[field].length);
  if (ordered) return ordered;
  return Object.keys(fields).find((field) => Array.isArray(fields[field]) && fields[field].length) || "";
}

/**
 * Put the caret in the field that needs changing, and bring it into view.
 * A `<select>` and a checkbox take focus the same way an input does, so this
 * works for every control on the form.
 */
export function focusAuthField(field) {
  if (typeof document === "undefined") return false;
  const element = document.getElementById(AUTH_FIELD_INPUT_IDS[field] || "");
  if (!element) return false;
  try {
    element.focus({ preventScroll: true });
    element.scrollIntoView({ block: "center", behavior: "smooth" });
  } catch {
    element.focus();
  }
  return true;
}

/**
 * Turn any thrown request failure into the shape the form renders.
 *
 * DRF answers a field failure with a generic top-level message and the real
 * detail inside `fields`. Showing that generic line told the reader only that
 * something failed, so it is replaced by the first field message; when every
 * message already sits beside a field, the form shows no banner at all.
 *
 * @param {{code?: unknown, message?: unknown, fields?: unknown} | null | undefined} error
 * @param {{t: (key: string) => string, mode?: string}} options
 * @returns {{message: string, fields: Record<string, string[]>, code: string}}
 */
export function normalizeAuthError(error, { t, mode = "login" }) {
  if (!error) return { message: "", fields: {}, code: "" };
  const code = typeof error.code === "string" ? error.code : "";
  const rawFields = /** @type {Record<string, unknown>} */ (
    error.fields && typeof error.fields === "object" ? error.fields : {}
  );
  /** @type {Record<string, string[]>} */
  const fields = {};
  for (const [key, value] of Object.entries(rawFields)) {
    if (key === "non_field_errors" || key === "detail") continue;
    const messages = messageList(value, t);
    if (messages.length) fields[key] = messages;
  }

  const codeKey = ERROR_CODE_KEYS[code];
  const fallback = messageList(rawFields.non_field_errors, t);
  let message = codeKey ? t(codeKey) : "";
  if (!message && fallback.length) message = fallback.join(" ");
  if (!message) message = translateBackendMessage(error.message, t);

  // A whole-request rejection with no field of its own still belongs beside the
  // box the reader would change -- a rejected sign-in beside the password.
  const codeField = ERROR_CODE_FIELDS[code];
  if (codeField && !Object.keys(fields).length && AUTH_FIELD_ORDER[mode]?.includes(codeField)) {
    fields[codeField] = [message];
  }

  const fieldMessages = Object.values(fields).flat();
  if (fieldMessages.length && (!message || message === t("auth.errorGeneric"))) {
    message = fieldMessages[0];
  }
  // Django's placeholder for "some field failed" carries nothing the field
  // messages do not already say.
  if (/^the request could not be completed\.?$/i.test(message) && fieldMessages.length) {
    message = fieldMessages[0];
  }

  return { message: message || t("auth.errorGeneric"), fields, code };
}
