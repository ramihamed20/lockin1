import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Icon } from "../../lib/icons.jsx";
import { authApi } from "../../lib/api.js";
import { assetPath } from "../../lib/utils.js";
import { educationPathFor, isSelectableStudyPath, uniqueEducationOptions } from "../../lib/educationPath.js";
import { useI18n } from "../I18nProvider.jsx";
import { AccountFieldErrors, AccountFormAlert, fieldErrorAttributes } from "../account/AccountFormErrors.jsx";
import { firstInvalidField, focusAuthField, normalizeAuthError, validateAuthForm } from "../../lib/authValidation.js";
import "./auth.css";

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

function PasswordField({ id, label, value, onChange, autoComplete, placeholder, error, show, onToggle, t, hint = "" }) {
  const field = id === "auth-confirm" ? "password_confirm" : "password";
  const errorId = `${id}-error`;
  const hintId = hint ? `${id}-hint` : "";
  return (
    <div className="auth-v2-field">
      <label htmlFor={id}>{label}</label>
      <div className="auth-v2-input-shell auth-v2-password-shell">
        <input id={id} type={show ? "text" : "password"} value={value} onChange={onChange} autoComplete={autoComplete} placeholder={placeholder} {...fieldErrorAttributes(error, field, errorId, hintId)} />
        <button className="auth-v2-password-toggle" type="button" onClick={onToggle} aria-label={show ? t("auth.hidePassword") : t("auth.showPassword")} aria-pressed={show}>
          <Icon name={show ? "eye-off" : "eye"} size={18} />
        </button>
      </div>
      {hint && <p className="auth-v2-field-hint" id={hintId}>{hint}</p>}
      <AccountFieldErrors error={error} field={field} id={errorId} />
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
  // State lags a click by a render, so two clicks inside one frame both saw
  // `loading === false` and both submitted. A ref is written before the first
  // one returns, which is what a second click actually needs to read.
  const submitting = useRef(false);
  const requiresName = !completionUser || completionUser.requiredProfileFields.includes("full_name");
  const requiresCohort = !completionUser || completionUser.requiredProfileFields.includes("cohort");
  const requiresUsername = Boolean(completionUser?.usernameRequired);

  const heading = useMemo(() => ({
    login: [t("auth.welcomeTitle"), t("auth.welcomeSubtitle")],
    signup: [t("auth.createTitle"), t("auth.createSubtitle")],
    forgot: [t("auth.forgotTitle"), t("auth.forgotSubtitle")],
    complete: requiresUsername
      ? [t("auth.usernameTitle"), t("auth.usernameSubtitle")]
      : [t("auth.completeTitle"), t("auth.completeSubtitle")]
  })[mode], [mode, requiresUsername, t]);

  const selectableCohorts = useMemo(() => cohorts.filter(isSelectableStudyPath), [cohorts]);
  const colleges = useMemo(() => uniqueEducationOptions(selectableCohorts, "college"), [selectableCohorts]);
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
      await authApi.resendVerification(form.email.trim());
      setMessage(t("auth.verificationSent"));
    } catch (nextError) {
      setError(normalizeAuthError(nextError, { t, mode }));
    } finally {
      submitting.current = false;
      setLoading(false);
    }
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

    const invalid = validateAuthForm({ mode, form, t, requiresName, requiresCohort, requiresUsername });
    if (Object.keys(invalid).length) {
      submitting.current = false;
      reportFieldErrors({ message: Object.values(invalid).flat()[0], fields: invalid, code: "client_validation" });
      return;
    }

    setLoading(true);
    try {
      if (mode === "forgot") {
        await authApi.requestPasswordReset(form.email.trim());
        setMessage(t("auth.resetSent"));
      } else if (mode === "signup") {
        await authApi.register({ fullName: form.name.trim(), email: form.email.trim(), password: form.password, passwordConfirm: form.confirm, preferredLanguage: locale, cohortId: form.cohortId, acceptPolicies: form.acceptPolicies });
        setMessage(t("auth.accountCreated"));
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
  const signedUp = mode === "signup" && verificationPending;
  const socialVisible = (mode === "login" || mode === "signup") && !signedUp;

  return (
    <main className="auth-v2" dir={direction}>
      <header className="auth-v2-topbar">
        <div className="auth-v2-brand" aria-label="Lock-in">
          <img src={assetPath("/icons/lockin-light-192-v2.png")} alt="" width="38" height="38" />
          <div><strong>Lock-in</strong><span>{t("auth.platform")}</span></div>
        </div>
        <label className="auth-v2-language">
          <Icon name="globe" size={17} aria-hidden="true" />
          <span className="auth-v2-language-label">{t("auth.language")}</span>
          <select value={locale} onChange={(event) => setLocale(event.target.value)} aria-label={t("auth.language")}>
            <option value="ar">{t("auth.languageArabic")}</option>
            <option value="en">{t("auth.languageEnglish")}</option>
          </select>
        </label>
      </header>

      <div className="auth-v2-stage">
        <section className="auth-v2-card" aria-labelledby="auth-v2-title">
          <div className="auth-v2-card-inner">
            <div className="auth-v2-heading"><h1 id="auth-v2-title">{heading[0]}</h1><p>{heading[1]}</p></div>

            {notice && (
              <p className="form-alert error auth-v2-session-notice" role="status" dir="auto">{notice}</p>
            )}

            {socialVisible && (
              <div className="auth-v2-social" aria-label={t("auth.or")}>
                <button type="button" className="auth-v2-social-button" onClick={() => beginSocial("google")} disabled={busy || providers.google !== true} title={providers.google === false ? t("auth.providerUnavailable") : undefined} aria-describedby="auth-social-consent">
                  {socialLoading === "google" ? <span className="auth-v2-spinner" /> : <GoogleIcon />}<span>{t("auth.continueGoogle")}</span>
                </button>
                <p className="auth-v2-social-consent" id="auth-social-consent">
                  {t("auth.socialConsentPrefix")} <Link to="/terms">{t("auth.terms")}</Link> {t("auth.and")} <Link to="/privacy">{t("auth.privacy")}</Link>{t("auth.socialConsentSuffix")}
                </p>
                <div className="auth-v2-divider"><span>{t("auth.or")}</span></div>
              </div>
            )}

            {signedUp && (
              <div className="auth-v2-sent" role="status">
                <span className="auth-v2-sent-icon" aria-hidden="true"><Icon name="check" size={22} /></span>
                <h2>{t("auth.signupCheckInbox")}</h2>
                <p>{t("auth.accountCreated")}</p>
                <p className="auth-v2-sent-address" dir="ltr">{form.email.trim()}</p>
                <p className="auth-v2-sent-note">{t("auth.signupExistingHint")}</p>
                <AccountFormAlert error={error} message={error ? "" : message !== t("auth.accountCreated") ? message : ""} />
                <div className="auth-v2-sent-actions">
                  <button className="auth-v2-primary" type="button" disabled={busy} onClick={() => changeMode("login")}>{t("auth.goToLogin")}</button>
                  <button className="auth-v2-text-action" type="button" disabled={busy} onClick={resendVerification}>{loading ? t("auth.working") : t("auth.resendVerification")}</button>
                </div>
              </div>
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

              {(mode === "signup" || (mode === "complete" && !requiresUsername && requiresName)) && (
                <div className="auth-v2-field">
                  <label htmlFor="auth-name">{t("auth.fullName")}</label>
                  <input id="auth-name" type="text" value={form.name} onChange={(event) => updateForm("name", event.target.value)} autoComplete="name" enterKeyHint="next" placeholder={t("auth.fullNamePlaceholder")} {...fieldErrorAttributes(error, "full_name", "auth-name-error")} />
                  <AccountFieldErrors error={error} field="full_name" id="auth-name-error" />
                </div>
              )}

              {(mode === "signup" || (mode === "complete" && !requiresUsername && requiresCohort)) && (
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
                    <option value="">{t("auth.chooseSpecialty")}</option>
                    {specialties.map((specialty) => <option value={specialty.id} key={specialty.id}>{specialty.label}</option>)}
                  </select>
                  <AccountFieldErrors error={error} field="specialty" id="auth-specialty-error" />
                </div>

                <div className="auth-v2-field">
                  <label htmlFor="auth-cohort">{t("auth.yearBatch")}</label>
                  <select id="auth-cohort" value={form.cohortId} onChange={(event) => updateForm("cohortId", event.target.value)} disabled={!form.specialtyId || cohortLoading || !availableCohorts.length || busy} {...fieldErrorAttributes(error, "cohort_id", "auth-cohort-error")}>
                    <option value="">{t("auth.chooseYear")}</option>
                    {availableCohorts.map((cohort) => <option value={cohort.id} key={cohort.id}>{educationPathFor(cohort, locale).yearLabel}</option>)}
                  </select>
                  <AccountFieldErrors error={error} field="cohort_id" id="auth-cohort-error" />
                </div>
                </>
              )}

              {mode !== "complete" && (
                <div className="auth-v2-field">
                  <label htmlFor="auth-email">{t("auth.email")}</label>
                  <input id="auth-email" className="auth-v2-email" type="email" value={form.email} onChange={(event) => updateForm("email", event.target.value)} inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck="false" enterKeyHint={mode === "forgot" ? "send" : "next"} placeholder={t("auth.emailPlaceholder")} {...fieldErrorAttributes(error, "email", "auth-email-error")} />
                  <AccountFieldErrors error={error} field="email" id="auth-email-error" />
                </div>
              )}

              {(mode === "login" || mode === "signup") && <PasswordField id="auth-password" label={t("auth.password")} value={form.password} onChange={(event) => updateForm("password", event.target.value)} autoComplete={mode === "signup" ? "new-password" : "current-password"} placeholder={t("auth.passwordPlaceholder")} error={error} show={showPassword} onToggle={() => setShowPassword((current) => !current)} t={t} hint={mode === "signup" ? t("auth.passwordRule") : ""} />}
              {mode === "signup" && <PasswordField id="auth-confirm" label={t("auth.confirmPassword")} value={form.confirm} onChange={(event) => updateForm("confirm", event.target.value)} autoComplete="new-password" placeholder={t("auth.confirmPasswordPlaceholder")} error={error} show={showConfirm} onToggle={() => setShowConfirm((current) => !current)} t={t} />}

              {mode === "login" && (
                <div className="auth-v2-options">
                  <label className="auth-v2-check"><input type="checkbox" checked={form.remember} onChange={(event) => updateForm("remember", event.target.checked)} /><span>{t("auth.remember")}</span></label>
                  <button type="button" onClick={() => changeMode("forgot")}>{t("auth.forgotPassword")}</button>
                </div>
              )}

              {mode === "signup" && (
                <div>
                  <label className="auth-v2-check auth-v2-policy">
                    <input id="auth-policies" type="checkbox" checked={form.acceptPolicies} onChange={(event) => updateForm("acceptPolicies", event.target.checked)} {...fieldErrorAttributes(error, "accept_policies", "auth-policies-error")} />
                    <span>{t("auth.termsPrefix")} <Link to="/terms">{t("auth.terms")}</Link> {t("auth.and")} <Link to="/privacy">{t("auth.privacy")}</Link></span>
                  </label>
                  <AccountFieldErrors error={error} field="accept_policies" id="auth-policies-error" />
                </div>
              )}

              <AccountFormAlert error={error} message={verificationPending ? "" : message} />

              {/* A rejected sign-in is most often an account whose email was
                  never verified -- which the server cannot say out loud without
                  telling a stranger the address is registered. Offering the
                  resend here gives the reader the way out either way. */}
              {mode === "login" && error?.code === "invalid_credentials" && (
                <p className="auth-v2-inline-hint">
                  {t("auth.loginVerifyHint")}{" "}
                  <button type="button" disabled={busy} onClick={resendVerification}>{t("auth.resendVerification")}</button>
                </p>
              )}

              <button className="auth-v2-primary" type="submit" disabled={busy}>
                {loading && <span className="auth-v2-spinner auth-v2-spinner-light" aria-hidden="true" />}<span>{loading ? t("auth.working") : mode === "signup" ? t("auth.create") : mode === "forgot" ? t("auth.sendReset") : mode === "complete" ? t("auth.continue") : t("auth.login")}</span>
              </button>
            </form>
            )}

            <div className="auth-v2-switch">
              {mode === "login" && <p>{t("auth.noAccount")} <button type="button" onClick={() => changeMode("signup")}>{t("auth.create")}</button></p>}
              {mode === "signup" && <p>{t("auth.hasAccount")} <button type="button" onClick={() => changeMode("login")}>{t("auth.login")}</button></p>}
              {mode === "forgot" && <button type="button" onClick={() => changeMode("login")}><Icon name={direction === "rtl" ? "chevron-right" : "chevron-left"} size={17} />{t("auth.backToLogin")}</button>}
              {mode === "complete" && onSignOut && <button type="button" onClick={onSignOut}>{t("auth.signOut")}</button>}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
