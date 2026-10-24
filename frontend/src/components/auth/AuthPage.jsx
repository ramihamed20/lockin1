import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Icon } from "../../lib/icons.jsx";
import { authApi } from "../../lib/api.js";
import { assetPath } from "../../lib/utils.js";
import { educationPathFor, isSelectableStudyPath, uniqueEducationOptions } from "../../lib/educationPath.js";
import { loadLocaleMessages, normalizeLocale, translate } from "../../lib/i18n.js";
import { useI18n } from "../I18nProvider.jsx";
import { AccountFieldErrors, AccountFormAlert, fieldErrorAttributes } from "../account/AccountFormErrors.jsx";
import { fieldsForSignupStep, firstInvalidField, focusAuthField, normalizeAuthError, signupStepForField, validateAuthForm } from "../../lib/authValidation.js";
import "./auth.css";

const SIGNUP_STEP_COUNT = 2;
// The study-path screen is its own history entry, so the browser's Back (and
// Android's back gesture) returns to the account screen instead of leaving the
// page with everything typed. Same path, different state: nothing that routes
// on the path -- titles, the shell, the error boundary -- sees a navigation.
const SIGNUP_STEP_STATE = "lockinSignupStep";
// Long enough that a normal request never shows it, short enough that a reader
// watching a slow one is told it is still working before they wonder.
const SLOW_REQUEST_MS = 3000;
// The policies open beside the form: following them in place unmounted the
// form and threw away everything typed, the password included.
const POLICY_LINK_PROPS = Object.freeze({ target: "_blank", rel: "noopener noreferrer" });

const EMPTY_FORM = Object.freeze({
  username: "",
  name: "",
  email: "",
  password: "",
  confirm: "",
  collegeId: "",
  specialtyId: "",
  cohortId: "",
  remember: true,
  acceptPolicies: false
});

/** Which error messages a change to each form field answers. */
const FORM_FIELD_ERRORS = Object.freeze({
  username: ["username"],
  name: ["full_name"],
  email: ["email"],
  password: ["password", "password_confirm"],
  confirm: ["password_confirm"],
  collegeId: ["college", "specialty", "cohort_id"],
  specialtyId: ["specialty", "cohort_id"],
  cohortId: ["cohort_id"],
  acceptPolicies: ["accept_policies"]
});

function GoogleIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20">
      <path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.4-.18-2.07H12v3.92h5.38a4.6 4.6 0 0 1-2 3.02v2.54h3.24c1.9-1.75 2.98-4.33 2.98-7.41Z" />
      <path fill="#34A853" d="M12 22c2.7 0 4.97-.9 6.62-2.36l-3.24-2.54c-.9.6-2.05.96-3.38.96-2.6 0-4.81-1.76-5.6-4.12H3.05v2.62A10 10 0 0 0 12 22Z" />
      <path fill="#FBBC05" d="M6.4 13.94A6 6 0 0 1 6.08 12c0-.67.12-1.33.32-1.94V7.44H3.05A10 10 0 0 0 2 12c0 1.64.39 3.2 1.05 4.56l3.35-2.62Z" />
      <path fill="#EA4335" d="M12 5.94c1.47 0 2.79.5 3.82 1.5l2.87-2.87A9.62 9.62 0 0 0 12 2a10 10 0 0 0-8.95 5.44l3.35 2.62c.79-2.36 3-4.12 5.6-4.12Z" />
    </svg>
  );
}

function PasswordField({ id, label, value, onChange, autoComplete, placeholder, error, show, onToggle, t, hint = "", enterKeyHint = undefined }) {
  const field = id === "auth-confirm" ? "password_confirm" : "password";
  const errorId = `${id}-error`;
  const hintId = hint ? `${id}-hint` : "";
  return (
    <div className="auth-v2-field">
      <label htmlFor={id}>{label}</label>
      <div className="auth-v2-input-shell auth-v2-password-shell">
        <input id={id} type={show ? "text" : "password"} value={value} onChange={onChange} autoComplete={autoComplete} autoCapitalize="none" autoCorrect="off" spellCheck="false" enterKeyHint={enterKeyHint} placeholder={placeholder} {...fieldErrorAttributes(error, field, errorId, hintId)} />
        <button className="auth-v2-password-toggle" type="button" onClick={onToggle} aria-label={show ? t("auth.hidePassword") : t("auth.showPassword")} aria-pressed={show}>
          <Icon name={show ? "eye-off" : "eye"} size={18} />
        </button>
      </div>
      {hint && <p className="auth-v2-field-hint" id={hintId}>{hint}</p>}
      <AccountFieldErrors error={error} field={field} id={errorId} />
    </div>
  );
}

const VERIFICATION_CODE_LENGTH = 6;
// The server holds the same minute; see ACCOUNT_VERIFICATION_RESEND_COOLDOWN_SECONDS.
const RESEND_COOLDOWN_SECONDS = 60;

/**
 * The six digits mailed to a new account, and nothing else on screen.
 *
 * One input, not six boxes: a single `autocomplete="one-time-code"` field is
 * what iOS and Android offer to fill from the message, what a paste lands in
 * whole, and what a screen reader announces once instead of six times.
 *
 * It verifies itself the moment the sixth digit arrives -- a reader who has
 * typed the code has already told us everything the button would.
 */
function VerificationCodeStep({ email, error, message, busy, loading, deliveryDelayed, t, onVerified, onFailed, onResend, onUseAnotherEmail }) {
  const [code, setCode] = useState("");
  const [checking, setChecking] = useState(false);
  const [wait, setWait] = useState(RESEND_COOLDOWN_SECONDS);
  const attempted = useRef("");
  const field = useRef(null);

  useEffect(() => {
    if (wait <= 0) return undefined;
    const timer = setTimeout(() => setWait((current) => current - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  useEffect(() => { field.current?.focus(); }, []);

  const verify = useCallback(async (value) => {
    // Each code is tried once: without this the auto-submit fires again on
    // every keystroke-shaped re-render, spending the account's attempts.
    if (checking || attempted.current === value) return;
    attempted.current = value;
    setChecking(true);
    try {
      const result = await authApi.verifyEmailCode({ email, code: value });
      if (result.user) onVerified(result.user);
      // Verified, but the server will not open a session for this account (a
      // suspended one). Saying so is kinder than a generic failure on a code
      // that was, in fact, correct.
      else onFailed({ message: t("auth.codeVerifiedNoSession"), fields: {}, code: "inactive_account" });
    } catch (nextError) {
      onFailed(normalizeAuthError(nextError, { t, mode: "verify" }));
      setCode("");
      attempted.current = "";
      field.current?.focus();
    } finally {
      setChecking(false);
    }
  }, [checking, email, onFailed, onVerified, t]);

  function change(value) {
    // Digits only, however they arrive: a pasted "123 456" or a code copied
    // with its surrounding words still reaches the field as six digits.
    const digits = value.replace(/\D/g, "").slice(0, VERIFICATION_CODE_LENGTH);
    setCode(digits);
    if (digits.length < VERIFICATION_CODE_LENGTH) attempted.current = "";
    if (digits.length === VERIFICATION_CODE_LENGTH) verify(digits);
  }

  async function resend() {
    setCode("");
    attempted.current = "";
    setWait(RESEND_COOLDOWN_SECONDS);
    await onResend();
    field.current?.focus();
  }

  const working = checking || loading;
  return (
    <div className="auth-v2-code">
      <span className="auth-v2-sent-icon" aria-hidden="true"><Icon name="check" size={22} /></span>
      <h2>{t("auth.codeTitle")}</h2>
      <p>{t("auth.codeSubtitle")}</p>
      <p className="auth-v2-sent-address" dir="ltr">{email}</p>
      {/* The screen is the same whether or not the address already has an
          account; this line is how a returning reader learns where to look. */}
      <p className="auth-v2-sent-note">{t("auth.codeExistingHint")}</p>
      {deliveryDelayed && <p className="form-alert warning auth-v2-delivery-note" role="status">{t("auth.emailDelayed")}</p>}

      <form
        className="auth-v2-code-form"
        onSubmit={(event) => { event.preventDefault(); if (code.length === VERIFICATION_CODE_LENGTH) verify(code); }}
        noValidate
      >
        <label className="auth-v2-field">
          <span className="auth-v2-code-label">{t("auth.codeLabel")}</span>
          <input
            ref={field}
            id="auth-code"
            className="auth-v2-code-input"
            type="text"
            dir="ltr"
            value={code}
            onChange={(event) => change(event.target.value)}
            inputMode="numeric"
            autoComplete="one-time-code"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck="false"
            enterKeyHint="go"
            // No maxLength: the browser would clip a paste to six characters
            // *before* this field saw it, so "123 456" arrived as "123 45" and
            // five digits never submit. The change handler keeps the six digits
            // it wants out of whatever arrives.
            placeholder="------"
            aria-label={t("auth.codeLabel")}
            aria-describedby="auth-code-hint"
            {...fieldErrorAttributes(error, "code", "auth-code-error", "auth-code-hint")}
          />
        </label>
        <p id="auth-code-hint" className="auth-v2-field-hint">{t("auth.codeHint")}</p>
        {/* A filtered message is the commonest reason a code "never came". */}
        <p className="auth-v2-field-hint auth-v2-code-spam">{t("auth.codeSpamHint")}</p>
        <AccountFieldErrors error={error} field="code" id="auth-code-error" />
        <AccountFormAlert error={error?.fields?.code ? null : error} message={message} />
        {working && <p className="auth-v2-code-status" role="status">{t("auth.codeChecking")}</p>}
      </form>

      <div className="auth-v2-sent-actions">
        <button className="auth-v2-text-action" type="button" disabled={busy || checking || wait > 0} onClick={resend}>
          {wait > 0 ? t("auth.codeResendIn", { seconds: wait }) : t("auth.resendVerification")}
        </button>
        <button className="auth-v2-text-action" type="button" disabled={busy || checking} onClick={onUseAnotherEmail}>
          {t("auth.codeChangeEmail")}
        </button>
      </div>
    </div>
  );
}

function oauthMessage(t, outcome, code) {
  if (outcome === "cancelled") return t("auth.oauthCancelled");
  const keys = {
    account_link_required: "auth.oauthAccountLink",
    configuration: "auth.oauthConfiguration",
    flow_invalid: "auth.oauthFlow",
    rate_limited: "auth.oauthRateLimited",
    registration_unavailable: "auth.oauthRegistration",
    signup_required: "auth.oauthSignupRequired",
    provider_error: "auth.oauthProviderError"
  };
  return t(keys[code] || "auth.oauthProviderError");
}

export function AuthPage({ onAuthed, completionUser = null, onSignOut = null, notice = "", onDismissNotice = null }) {
  const { locale, direction, setLocale, t } = useI18n();
  const location = useLocation();
  const navigate = useNavigate();
  const [mode, setMode] = useState(completionUser ? "complete" : "login");
  const [form, setForm] = useState(() => {
    // Only a real cohort has a study path. Asked about nothing, `educationPathFor`
    // answers with its "other" placeholders, and seeding those made the form
    // believe a college and a specialty had already been chosen -- while both
    // selects showed empty, because no option carries that id.
    const path = completionUser?.cohort ? educationPathFor(completionUser.cohort) : null;
    return {
      ...EMPTY_FORM,
      username: completionUser?.username || "",
      name: completionUser?.name || "",
      collegeId: path?.collegeId || "",
      specialtyId: path?.specialtyId || "",
      cohortId: completionUser?.cohort?.id || ""
    };
  });
  const [cohorts, setCohorts] = useState([]);
  const [cohortLoading, setCohortLoading] = useState(true);
  const [cohortError, setCohortError] = useState(false);
  const [cohortRetry, setCohortRetry] = useState(0);
  const [providers, setProviders] = useState({ google: null });
  const [error, setError] = useState(null);
  const [message, setMessage] = useState("");
  const [verificationPending, setVerificationPending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [socialLoading, setSocialLoading] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [slowRequest, setSlowRequest] = useState(false);
  // What the server could say about the mail queue when it accepted the
  // request: "queued" or "delayed". Never "delivered" -- it cannot know that.
  const [deliveryState, setDeliveryState] = useState("");
  // Which way the last step change went, so the incoming screen slides in
  // from the side the reader is moving towards. Empty on first paint: the
  // screen a reader arrives on does not animate.
  const [stepMotion, setStepMotion] = useState("");
  // What takes focus once a step change has rendered: the new screen's
  // heading, the field a message sent the reader back to, or "none".
  const pendingFocus = useRef("");
  const headingRef = useRef(null);
  // State lags a click by a render, so two clicks inside one frame both saw
  // `loading === false` and both submitted. A ref is written before the first
  // one returns, which is what a second click actually needs to read.
  const submitting = useRef(false);
  const requiresName = !completionUser || completionUser.requiredProfileFields.includes("full_name");
  const requiresCohort = !completionUser || completionUser.requiredProfileFields.includes("cohort");
  const requiresUsername = Boolean(completionUser?.usernameRequired);

  // Creating an account is two screens over one form: the account, then the
  // study path. Both stay mounted so nothing typed is lost moving between them;
  // only the second one sends anything. The screen shown follows the history
  // entry, but the second one is only ever shown over a complete first one --
  // a reload or a Forward press cannot land on it with the account half-typed.
  const historyStep = location.state?.[SIGNUP_STEP_STATE] === 2 ? 2 : 1;
  const accountStepComplete = mode === "signup"
    && Object.keys(fieldsForSignupStep(validateAuthForm({ mode: "signup", form, t }), 1)).length === 0;
  const signupStep = mode === "signup" && historyStep === 2 && accountStepComplete ? 2 : 1;
  // The direction of a change is known only by comparing with the last screen
  // shown, whichever way the change came (a button or the browser's Back).
  const [shownStep, setShownStep] = useState(signupStep);
  if (shownStep !== signupStep) {
    setShownStep(signupStep);
    setStepMotion(signupStep > shownStep ? "forward" : "back");
  }

  const heading = useMemo(() => ({
    login: [t("auth.welcomeTitle"), t("auth.welcomeSubtitle")],
    // The code screen follows the second step but is about the account.
    signup: signupStep === 1 || verificationPending
      ? [t("auth.createTitle"), t("auth.createSubtitle")]
      : [t("auth.profileTitle"), t("auth.profileSubtitle")],
    forgot: [t("auth.forgotTitle"), t("auth.forgotSubtitle")],
    complete: requiresUsername
      ? [t("auth.usernameTitle"), t("auth.usernameSubtitle")]
      : [t("auth.completeTitle"), t("auth.completeSubtitle")]
  })[mode], [mode, requiresUsername, signupStep, verificationPending, t]);

  const selectableCohorts = useMemo(() => cohorts.filter(isSelectableStudyPath), [cohorts]);
  const colleges = useMemo(() => uniqueEducationOptions(selectableCohorts, "college", locale), [selectableCohorts, locale]);
  const specialties = useMemo(() => {
    const values = new Map();
    selectableCohorts.filter((cohort) => educationPathFor(cohort).collegeId === form.collegeId).forEach((cohort) => {
      const path = educationPathFor(cohort, locale);
      if (!values.has(path.specialtyId)) values.set(path.specialtyId, { id: path.specialtyId, label: path.specialtyLabel });
    });
    return [...values.values()];
  }, [selectableCohorts, form.collegeId, locale]);

  const availableCohorts = useMemo(
    () => selectableCohorts.filter((cohort) => {
      const path = educationPathFor(cohort);
      return path.collegeId === form.collegeId && path.specialtyId === form.specialtyId;
    }),
    [selectableCohorts, form.collegeId, form.specialtyId]
  );

  useEffect(() => {
    let active = true;
    setCohortLoading(true);
    setCohortError(false);
    authApi.listCohorts().then((items) => {
      if (!active) return;
      setCohorts(items);
    }).catch(() => {
      if (!active) return;
      setCohorts([]);
      setCohortError(true);
    }).finally(() => {
      if (active) setCohortLoading(false);
    });
    return () => { active = false; };
  }, [cohortRetry]);

  useEffect(() => {
    let active = true;
    authApi.oauthProviders().then((status) => { if (active) setProviders(status); }).catch(() => { if (active) setProviders({ google: false }); });
    return () => { active = false; };
  }, []);

  // Returning from a provider through the back/forward cache restores this
  // component with its pre-redirect state, which would leave the provider
  // button disabled and reading as unavailable.
  useEffect(() => {
    function restoreFromCache(event) {
      if (event.persisted) setSocialLoading("");
    }
    window.addEventListener("pageshow", restoreFromCache);
    return () => window.removeEventListener("pageshow", restoreFromCache);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get("oauth");
    if (!outcome) return;
    const code = params.get("oauth_error") || "";
    if (outcome === "cancelled") setMessage(oauthMessage(t, outcome, ""));
    if (outcome === "error") setError(new Error(oauthMessage(t, outcome, code)));
    // The provider button carries the policy acceptance, so this outcome now
    // means the acceptance never reached the backend at all (a stale client, a
    // hand-written request). The create-account screen is where the reader can
    // see the policies and state the acceptance in full, so send them there.
    if (outcome === "error" && code === "signup_required" && !completionUser) setMode("signup");
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.hash}`);
  }, [completionUser, t]);

  useEffect(() => { document.title = `${heading[0]} — Lock-in`; }, [heading]);

  // Runs after a step change has rendered, when the screen being moved to is
  // visible and can actually take focus. The heading is focused on a plain
  // move so a screen reader announces the new screen; a field is focused when
  // a message sent the reader back to change it.
  const focusedStep = useRef(signupStep);
  useEffect(() => {
    if (focusedStep.current === signupStep) return;
    focusedStep.current = signupStep;
    const target = pendingFocus.current || "heading";
    pendingFocus.current = "";
    if (target === "none") return;
    if (target === "heading") {
      headingRef.current?.focus({ preventScroll: true });
      window.scrollTo({ top: 0 });
    } else {
      focusAuthField(target);
    }
  }, [signupStep]);

  // A request that is taking its time says so, once, without moving anything.
  useEffect(() => {
    if (!loading) return undefined;
    const timer = setTimeout(() => setSlowRequest(true), SLOW_REQUEST_MS);
    return () => {
      clearTimeout(timer);
      setSlowRequest(false);
    };
  }, [loading]);

  const historyTarget = { pathname: location.pathname, search: location.search };
  function historyStateWithout() {
    const { [SIGNUP_STEP_STATE]: _removed, ...rest } = location.state || {};
    return Object.keys(rest).length ? rest : null;
  }

  /** Back to the account screen, by the same history step the browser would take. */
  function leaveStudyPathStep() {
    if (historyStep === 2) navigate(-1);
  }

  function goToSignupStep(nextStep, focusTarget = "heading") {
    setError(null);
    setMessage("");
    pendingFocus.current = focusTarget;
    if (nextStep === 2) {
      // An entry left over from a reload is reused rather than stacked, so one
      // Back press always leads back to the account screen.
      navigate(historyTarget, { state: { ...(location.state || {}), [SIGNUP_STEP_STATE]: 2 }, replace: historyStep === 2 });
    } else {
      leaveStudyPathStep();
    }
  }

  /**
   * The messages on screen were written in the language that was chosen when
   * they appeared. The form's own messages are re-asked in the new one, so a
   * reader who switches language mid-form is not left reading the old one;
   * the server's messages stay as they came.
   */
  function changeLanguage(value) {
    const nextLocale = normalizeLocale(value);
    setLocale(nextLocale);
    // The new language may still be arriving; re-ask once it can be read.
    loadLocaleMessages(nextLocale).then(() => setError((current) => {
      if (current?.code !== "client_validation" || !current.fields) return current;
      const nextT = (key, variables) => translate(nextLocale, key, variables);
      const fresh = validateAuthForm({ mode, form, t: nextT, requiresName, requiresCohort, requiresUsername });
      const fields = Object.fromEntries(Object.keys(current.fields).filter((key) => fresh[key]).map((key) => [key, fresh[key]]));
      const messages = Object.values(fields).flat();
      if (!messages.length) return null;
      return { ...current, fields, message: messages[0] };
    }), () => undefined);
  }

  // Editing a box answers its own complaint. Clearing only that field's message
  // leaves every other one standing, so fixing one mistake never hides the next.
  function clearFieldError(...fieldKeys) {
    setError((current) => {
      if (!current?.fields) return current;
      const remaining = { ...current.fields };
      let changed = false;
      for (const key of fieldKeys) if (key in remaining) { delete remaining[key]; changed = true; }
      if (!changed) return current;
      const messages = Object.values(remaining).flat();
      if (!messages.length && !current.code) return null;
      return { ...current, fields: remaining, message: messages.length ? current.message : "" };
    });
  }

  function updateForm(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
    clearFieldError(...(FORM_FIELD_ERRORS[field] || []));
  }

  function changeMode(nextMode) {
    onDismissNotice?.();
    setMode(nextMode);
    setError(null);
    setMessage("");
    setVerificationPending(false);
    setShowPassword(false);
    setShowConfirm(false);
    // Leaving the create-account screen drops its step from this entry, so a
    // later return starts from the account screen.
    if (historyStep === 2) navigate(historyTarget, { replace: true, state: historyStateWithout() });
    setStepMotion("");
    pendingFocus.current = "none";
    // A provider hand-off that never left this document (a cancelled or
    // restored navigation) must not leave every control disabled.
    setSocialLoading("");
    window.scrollTo({ top: 0 });
  }

  async function beginSocial(provider) {
    setError(null);
    setMessage("");
    // The notice under the provider button states that continuing accepts the
    // policies, so pressing it is the acceptance — on the login screen just as
    // on the create-account screen. The separate checkbox belongs to the
    // email-and-password form, which has no such notice on its own button.
    setSocialLoading(provider);
    try {
      const authorizationUrl = await authApi.startOAuth(provider, {
        intent: mode === "signup" ? "register" : "login",
        preferredLanguage: locale,
        remember: form.remember,
        acceptPolicies: true
      });
      window.location.assign(authorizationUrl);
    } catch (nextError) {
      setError(nextError);
      setSocialLoading("");
    }
  }

  async function resendVerification() {
    if (submitting.current || loading) return;
    submitting.current = true;
    setLoading(true);
    setError(null);
    try {
      const result = await authApi.resendVerification(form.email.trim());
      setDeliveryState(result?.email_delivery || "");
      setMessage(t("auth.verificationSent"));
    } catch (nextError) {
      setError(normalizeAuthError(nextError, { t, mode }));
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  }

  /** Send a fresh code and open the screen that asks for it. */
  async function startVerification() {
    const email = form.email.trim();
    if (!email) {
      reportFieldErrors({ message: t("auth.errorRequired"), fields: { email: [t("auth.errorRequired")] }, code: "client_validation" });
      return;
    }
    await resendVerification();
    setVerificationPending(true);
  }

  /**
   * Show the messages, then put the caret in the first box that needs changing.
   * Focus is what turns "something is wrong" into "change this", and on a phone
   * it also opens the keyboard on the right field instead of the top of a form
   * the reader then has to hunt through.
   */
  function reportFieldErrors(nextError) {
    setError(nextError);
    // Focused straight away rather than from an animation frame: every field
    // this can name is already mounted, and a frame callback never runs while
    // the tab is in the background -- which is exactly where a slow request
    // finishes.
    const target = firstInvalidField(nextError?.fields, mode);
    // A message about the account (a taken or refused password, say) can come
    // back while the study-path screen is showing. The reader is taken back to
    // the screen that has the field; focus follows once it has rendered.
    if (target && mode === "signup" && signupStepForField(target) !== signupStep) {
      pendingFocus.current = target;
      leaveStudyPathStep();
      return;
    }
    if (target) focusAuthField(target);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    // A second submit while the first is still in flight would create a second
    // account or a second session. The button is disabled for the same reason;
    // this covers the Enter key and an assistive click that races it.
    if (submitting.current || loading || socialLoading) return;
    submitting.current = true;
    onDismissNotice?.();
    setError(null);
    setMessage("");

    const allInvalid = validateAuthForm({ mode, form, t, requiresName, requiresCohort, requiresUsername });
    // The account screen is judged on its own fields only: the study path has
    // not been shown yet, so it cannot be wrong yet.
    const accountStep = mode === "signup" && signupStep === 1;
    const invalid = accountStep ? fieldsForSignupStep(allInvalid, 1) : allInvalid;
    if (Object.keys(invalid).length) {
      submitting.current = false;
      reportFieldErrors({ message: Object.values(invalid).flat()[0], fields: invalid, code: "client_validation" });
      return;
    }
    // A valid account screen moves on; it never creates the account.
    if (accountStep) {
      submitting.current = false;
      goToSignupStep(2);
      return;
    }

    setLoading(true);
    try {
      if (mode === "forgot") {
        const result = await authApi.requestPasswordReset(form.email.trim());
        setDeliveryState(result?.email_delivery || "");
        setMessage(t("auth.resetSent"));
      } else if (mode === "signup") {
        const created = await authApi.register({ fullName: form.name.trim(), email: form.email.trim(), password: form.password, passwordConfirm: form.confirm, preferredLanguage: locale, cohortId: form.cohortId, acceptPolicies: form.acceptPolicies });
        // The code screen that follows states where the code went and what to
        // do with it; a banner repeating it would only push the field down.
        setDeliveryState(created?.email_delivery || "");
        setMessage("");
        setVerificationPending(true);
      } else if (mode === "complete") {
        const nextUser = await authApi.updateProfile({
          username: requiresUsername ? form.username.trim() : undefined,
          fullName: !requiresUsername && requiresName ? form.name.trim() : undefined,
          cohortId: !requiresUsername && requiresCohort ? form.cohortId : undefined,
          preferredLanguage: locale
        });
        onAuthed(nextUser, { newSession: false });
      } else {
        const result = await authApi.login({ email: form.email.trim(), password: form.password, remember: form.remember });
        onAuthed(result.user, { newSession: true });
      }
    } catch (nextError) {
      reportFieldErrors(normalizeAuthError(nextError, { t, mode }));
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  }

  const busy = loading || Boolean(socialLoading);
  // Once the account exists the form has nothing left to ask, and leaving it on
  // screen invited a second submit for an account that was already created.
  // Reached two ways: straight after creating an account, and from a sign-in
  // that was refused because the address has never been verified.
  const signedUp = verificationPending && (mode === "signup" || mode === "login");
  // The provider button belongs to the account screen: on the study-path
  // screen the reader has already chosen email and password.
  const socialVisible = (mode === "login" || (mode === "signup" && signupStep === 1)) && !signedUp;
  // Google is switched off on this deployment rather than broken, so the page
  // says so in words instead of leaving a dim button to be guessed at.
  const googleUnavailable = providers.google === false;
  const signupForm = mode === "signup" && !signedUp;
  const studyPathVisible = mode === "complete" && !requiresUsername && requiresCohort;
  const backIcon = direction === "rtl" ? "chevron-right" : "chevron-left";

  const nameField = (
    <div className="auth-v2-field">
      <label htmlFor="auth-name">{t("auth.fullName")}</label>
      <input id="auth-name" type="text" value={form.name} onChange={(event) => updateForm("name", event.target.value)} autoComplete="name" autoCapitalize="words" enterKeyHint="next" placeholder={t("auth.fullNamePlaceholder")} {...fieldErrorAttributes(error, "full_name", "auth-name-error")} />
      <AccountFieldErrors error={error} field="full_name" id="auth-name-error" />
    </div>
  );

  const emailField = (
    <div className="auth-v2-field">
      <label htmlFor="auth-email">{t("auth.email")}</label>
      <input id="auth-email" className="auth-v2-email" type="email" dir="ltr" value={form.email} onChange={(event) => updateForm("email", event.target.value)} inputMode="email" autoComplete={mode === "signup" ? "username email" : "email"} autoCapitalize="none" autoCorrect="off" spellCheck="false" enterKeyHint={mode === "forgot" ? "send" : "next"} placeholder={t("auth.emailPlaceholder")} {...fieldErrorAttributes(error, "email", "auth-email-error")} />
      <AccountFieldErrors error={error} field="email" id="auth-email-error" />
    </div>
  );

  const studyPathFields = (
    <>
      <div className="auth-v2-field">
        <label htmlFor="auth-college">{t("auth.college")}</label>
        <select id="auth-college" value={form.collegeId} onChange={(event) => { setForm((current) => ({ ...current, collegeId: event.target.value, specialtyId: "", cohortId: "" })); clearFieldError("college", "specialty", "cohort_id"); }} disabled={cohortLoading || !colleges.length || busy} aria-describedby={cohortLoading || cohortError ? "auth-cohort-status" : undefined} {...fieldErrorAttributes(error, "college", "auth-college-error")}>
          <option value="">{cohortLoading ? t("auth.loadingPrograms") : t("auth.chooseCollege")}</option>
          {colleges.map((college) => <option value={college.id} key={college.id}>{college.label}</option>)}
        </select>
        {cohortLoading && <p id="auth-cohort-status" className="auth-v2-cohort-status" role="status">{t("auth.loadingPrograms")}</p>}
        {cohortError && <div id="auth-cohort-status" className="auth-v2-cohort-status auth-v2-cohort-error" role="alert"><span>{t("auth.cohortsUnavailable")}</span><button type="button" onClick={() => setCohortRetry((current) => current + 1)}>{t("common.tryAgain")}</button></div>}
        <AccountFieldErrors error={error} field="college" id="auth-college-error" />
      </div>

      <div className="auth-v2-field">
        <label htmlFor="auth-specialty">{t("auth.specialty")}</label>
        <select id="auth-specialty" value={form.specialtyId} onChange={(event) => { setForm((current) => ({ ...current, specialtyId: event.target.value, cohortId: "" })); clearFieldError("specialty", "cohort_id"); }} disabled={!form.collegeId || cohortLoading || !specialties.length || busy} {...fieldErrorAttributes(error, "specialty", "auth-specialty-error")}>
          {/* A closed select says what opens it, so it reads as waiting rather than broken. */}
          <option value="">{form.collegeId ? t("auth.chooseSpecialty") : t("auth.chooseCollegeFirst")}</option>
          {specialties.map((specialty) => <option value={specialty.id} key={specialty.id}>{specialty.label}</option>)}
        </select>
        <AccountFieldErrors error={error} field="specialty" id="auth-specialty-error" />
      </div>

      <div className="auth-v2-field">
        <label htmlFor="auth-cohort">{t("auth.yearBatch")}</label>
        <select id="auth-cohort" value={form.cohortId} onChange={(event) => updateForm("cohortId", event.target.value)} disabled={!form.specialtyId || cohortLoading || !availableCohorts.length || busy} {...fieldErrorAttributes(error, "cohort_id", "auth-cohort-error")}>
          <option value="">{form.specialtyId ? t("auth.chooseYear") : t("auth.chooseSpecialtyFirst")}</option>
          {availableCohorts.map((cohort) => <option value={cohort.id} key={cohort.id}>{educationPathFor(cohort, locale).yearLabel}</option>)}
        </select>
        <AccountFieldErrors error={error} field="cohort_id" id="auth-cohort-error" />
      </div>
    </>
  );

  const submitLabel = loading
    ? (mode === "signup" && signupStep === 2 ? t("auth.creatingAccount") : t("auth.working"))
    : mode === "signup"
      ? (signupStep === 1 ? t("auth.continue") : t("auth.create"))
      : mode === "forgot" ? t("auth.sendReset") : mode === "complete" ? t("auth.continue") : t("auth.login");
  const submitButton = (
    <button className="auth-v2-primary" type="submit" disabled={busy} aria-busy={loading || undefined}>
      {loading && <span className="auth-v2-spinner auth-v2-spinner-light" aria-hidden="true" />}<span>{submitLabel}</span>
    </button>
  );

  return (
    <main className="auth-v2" dir={direction}>
      <header className="auth-v2-topbar">
        <div className="auth-v2-brand" aria-label="Lock-in">
          <img src={assetPath("/icons/lockin-light-192-v2.png")} alt="" width="38" height="38" />
          <div><strong>Lock-in</strong><span>{t("auth.platform")}</span></div>
        </div>
        <label className="auth-v2-language">
          <Icon name="globe" size={16} aria-hidden="true" />
          <span className="auth-v2-language-label">{t("auth.language")}</span>
          <select value={locale} onChange={(event) => changeLanguage(event.target.value)} aria-label={t("auth.language")}>
            <option value="ar">{t("auth.languageArabic")}</option>
            <option value="en">{t("auth.languageEnglish")}</option>
          </select>
        </label>
      </header>

      <div className="auth-v2-stage">
        <section className="auth-v2-card" aria-labelledby="auth-v2-title">
          <div className="auth-v2-card-inner">
            {signupForm && (
              <div className="auth-v2-progress">
                <p className="auth-v2-progress-label" id="auth-step-status">
                  {t("auth.stepProgress", { current: signupStep, total: SIGNUP_STEP_COUNT })}
                  <span aria-hidden="true"> · </span>
                  <span>{signupStep === 1 ? t("auth.stepAccount") : t("auth.stepProfile")}</span>
                </p>
                <div className="auth-v2-progress-track" aria-hidden="true">
                  {Array.from({ length: SIGNUP_STEP_COUNT }, (_, index) => (
                    <span key={index} className={index < signupStep ? "is-reached" : undefined} />
                  ))}
                </div>
              </div>
            )}

            <div className="auth-v2-heading" key={signupForm ? `signup-${signupStep}` : mode} data-motion={signupForm && stepMotion ? stepMotion : undefined}>
              <h1 id="auth-v2-title" ref={headingRef} tabIndex={-1} aria-describedby={signupForm ? "auth-step-status" : undefined}>{heading[0]}</h1>
              <p>{heading[1]}</p>
            </div>

            {notice && (
              <p className="form-alert error auth-v2-session-notice" role="status" dir="auto">{notice}</p>
            )}

            {socialVisible && (
              <div className="auth-v2-social" aria-label={t("auth.or")}>
                <button type="button" className="auth-v2-social-button" onClick={() => beginSocial("google")} disabled={busy || providers.google !== true} aria-describedby={googleUnavailable ? "auth-social-unavailable" : "auth-social-consent"}>
                  {socialLoading === "google" ? <span className="auth-v2-spinner" /> : <GoogleIcon />}<span>{t("auth.continueGoogle")}</span>
                </button>
                {googleUnavailable ? (
                  <p className="auth-v2-social-consent auth-v2-social-unavailable" id="auth-social-unavailable">{t("auth.googleUnavailable")}</p>
                ) : (
                  <p className="auth-v2-social-consent" id="auth-social-consent">
                    {t("auth.socialConsentPrefix")} <Link to="/terms" {...POLICY_LINK_PROPS}>{t("auth.terms")}</Link> {t("auth.and")} <Link to="/privacy" {...POLICY_LINK_PROPS}>{t("auth.privacy")}</Link>{t("auth.socialConsentSuffix")}
                  </p>
                )}
                <div className="auth-v2-divider"><span>{t("auth.or")}</span></div>
              </div>
            )}

            {signedUp && (
              <VerificationCodeStep
                email={form.email.trim()}
                error={error}
                message={message}
                busy={busy}
                loading={loading}
                deliveryDelayed={deliveryState === "delayed"}
                t={t}
                onVerified={(user) => onAuthed(user, { newSession: true })}
                onFailed={(nextError) => setError(nextError)}
                onResend={resendVerification}
                onUseAnotherEmail={() => {
                  setVerificationPending(false);
                  setError(null);
                  setMessage("");
                  // The address is on the account screen, so that is where
                  // the reader goes to change it.
                  if (mode === "signup" && signupStep !== 1) {
                    pendingFocus.current = "email";
                    leaveStudyPathStep();
                  }
                }}
              />
            )}

            {/* The browser's own bubbles cannot be placed under the field, cannot
                be translated, and stop at the first box. This form states every
                problem itself, beside the box it belongs to. */}
            {!signedUp && (
            <form className="auth-v2-form" onSubmit={handleSubmit} noValidate>
              {mode === "complete" && requiresUsername && (
                <div className="auth-v2-field auth-v2-username-step">
                  <label htmlFor="auth-username">{t("auth.username")}</label>
                  <input
                    id="auth-username"
                    type="text"
                    dir="ltr"
                    value={form.username}
                    onChange={(event) => updateForm("username", event.target.value.toLowerCase())}
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck="false"
                    inputMode="text"
                    pattern="[a-z0-9][a-z0-9_]{2,29}"
                    minLength={3}
                    maxLength={30}
                    placeholder={t("auth.usernamePlaceholder")}
                    {...fieldErrorAttributes(error, "username", "auth-username-error", "auth-username-hint")}
                  />
                  <p id="auth-username-hint" className="auth-v2-cohort-status">{t("auth.usernameHint")}</p>
                  <AccountFieldErrors error={error} field="username" id="auth-username-error" />
                </div>
              )}

              {mode === "complete" && !requiresUsername && requiresName && nameField}
              {studyPathVisible && studyPathFields}

              {mode === "signup" && (
                <>
                  {/* Hidden, not unmounted: the values survive the trip to the
                      second screen and back, and a password manager still finds
                      the address and new password on the form it submits. */}
                  <div className="auth-v2-step" hidden={signupStep !== 1} data-motion={signupStep === 1 && stepMotion ? stepMotion : undefined}>
                    {nameField}
                    {emailField}
                    <PasswordField id="auth-password" label={t("auth.password")} value={form.password} onChange={(event) => updateForm("password", event.target.value)} autoComplete="new-password" placeholder={t("auth.passwordPlaceholder")} error={error} show={showPassword} onToggle={() => setShowPassword((current) => !current)} t={t} hint={t("auth.passwordRule")} enterKeyHint="next" />
                    <PasswordField id="auth-confirm" label={t("auth.confirmPassword")} value={form.confirm} onChange={(event) => updateForm("confirm", event.target.value)} autoComplete="new-password" placeholder={t("auth.confirmPasswordPlaceholder")} error={error} show={showConfirm} onToggle={() => setShowConfirm((current) => !current)} t={t} enterKeyHint="next" />
                  </div>
                  <div className="auth-v2-step" hidden={signupStep !== 2} data-motion={signupStep === 2 && stepMotion ? stepMotion : undefined}>
                    {studyPathFields}
                    <div>
                      <label className="auth-v2-check auth-v2-policy">
                        <input id="auth-policies" type="checkbox" disabled={busy} checked={form.acceptPolicies} onChange={(event) => updateForm("acceptPolicies", event.target.checked)} {...fieldErrorAttributes(error, "accept_policies", "auth-policies-error")} />
                        <span>{t("auth.termsPrefix")} <Link to="/terms" {...POLICY_LINK_PROPS}>{t("auth.terms")}</Link> {t("auth.and")} <Link to="/privacy" {...POLICY_LINK_PROPS}>{t("auth.privacy")}</Link></span>
                      </label>
                      <AccountFieldErrors error={error} field="accept_policies" id="auth-policies-error" />
                    </div>
                  </div>
                </>
              )}

              {(mode === "login" || mode === "forgot") && emailField}

              {mode === "login" && <PasswordField id="auth-password" label={t("auth.password")} value={form.password} onChange={(event) => updateForm("password", event.target.value)} autoComplete="current-password" placeholder={t("auth.passwordPlaceholder")} error={error} show={showPassword} onToggle={() => setShowPassword((current) => !current)} t={t} enterKeyHint="go" />}

              {mode === "login" && (
                <div className="auth-v2-options">
                  <label className="auth-v2-check"><input type="checkbox" checked={form.remember} onChange={(event) => updateForm("remember", event.target.checked)} /><span>{t("auth.remember")}</span></label>
                  <button type="button" onClick={() => changeMode("forgot")}>{t("auth.forgotPassword")}</button>
                </div>
              )}

              <AccountFormAlert error={error} message={verificationPending ? "" : message} />
              {mode === "forgot" && message && deliveryState === "delayed" && (
                <p className="form-alert warning auth-v2-delivery-note" role="status">{t("auth.emailDelayed")}</p>
              )}

              {/* A rejected sign-in is most often an account whose email was
                  never verified -- which the server cannot say out loud without
                  telling a stranger the address is registered. Offering the
                  resend here gives the reader the way out either way. */}
              {mode === "login" && error?.code === "invalid_credentials" && (
                <p className="auth-v2-inline-hint">
                  {t("auth.loginVerifyHint")}{" "}
                  <button type="button" disabled={busy} onClick={startVerification}>{t("auth.codeSendNew")}</button>
                </p>
              )}

              {mode === "signup" && signupStep === 2 ? (
                <div className="auth-v2-actions">
                  <button className="auth-v2-secondary" type="button" disabled={busy} onClick={() => goToSignupStep(1)}>
                    <Icon name={backIcon} size={18} aria-hidden="true" /><span>{t("auth.back")}</span>
                  </button>
                  {submitButton}
                </div>
              ) : submitButton}
              {loading && slowRequest && (
                <p className="auth-v2-slow-note" role="status">{t("auth.stillWorking")}</p>
              )}
            </form>
            )}

            <div className="auth-v2-switch">
              <p><a href={locale === "en" ? "/en/about/" : "/about/"}>{t("auth.aboutLockin")}</a></p>
              {mode === "login" && <p>{t("auth.noAccount")} <button type="button" onClick={() => changeMode("signup")}>{t("auth.create")}</button></p>}
              {mode === "signup" && (signupStep === 1 || signedUp) && <p>{t("auth.hasAccount")} <button type="button" onClick={() => changeMode("login")}>{t("auth.login")}</button></p>}
              {mode === "forgot" && <button type="button" onClick={() => changeMode("login")}><Icon name={backIcon} size={17} />{t("auth.backToLogin")}</button>}
              {mode === "complete" && onSignOut && <button type="button" onClick={onSignOut}>{t("auth.signOut")}</button>}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
