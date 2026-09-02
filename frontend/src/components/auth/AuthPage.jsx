import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Icon } from "../../lib/icons.jsx";
import { authApi } from "../../lib/api.js";
import { assetPath } from "../../lib/utils.js";
import { useI18n } from "../I18nProvider.jsx";
import { AccountFieldErrors, AccountFormAlert } from "../account/AccountFormErrors.jsx";
import "./auth.css";

const EMPTY_FORM = Object.freeze({
  username: "",
  name: "",
  email: "",
  password: "",
  confirm: "",
  programId: "",
  cohortId: "",
  remember: true,
  acceptPolicies: false
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

function AppleIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
      <path d="M17.04 12.54c.02 3.04 2.67 4.05 2.7 4.07-.02.08-.42 1.46-1.4 2.88-.85 1.23-1.73 2.45-3.12 2.48-1.36.03-1.8-.8-3.36-.8-1.56 0-2.05.77-3.34.83-1.34.05-2.36-1.35-3.22-2.57C3.55 16.9 2.2 12.28 4 9.14a5 5 0 0 1 4.25-2.57c1.33-.03 2.58.9 3.36.9.78 0 2.24-1.12 3.78-.96.64.03 2.46.26 3.62 1.96-.1.06-2.16 1.25-2.14 3.73l.17.34ZM14.38 4.9c.71-.86 1.19-2.06 1.06-3.25-1.02.04-2.25.68-2.99 1.54-.66.76-1.24 1.98-1.08 3.14 1.13.09 2.3-.58 3.01-1.43Z" />
    </svg>
  );
}

function PasswordField({ id, label, value, onChange, autoComplete, placeholder, error, show, onToggle, t }) {
  return (
    <div className="auth-v2-field">
      <label htmlFor={id}>{label}</label>
      <div className="auth-v2-input-shell auth-v2-password-shell">
        <input id={id} type={show ? "text" : "password"} value={value} onChange={onChange} autoComplete={autoComplete} placeholder={placeholder} required />
        <button className="auth-v2-password-toggle" type="button" onClick={onToggle} aria-label={show ? t("auth.hidePassword") : t("auth.showPassword")} aria-pressed={show}>
          <Icon name={show ? "eye-off" : "eye"} size={18} />
        </button>
      </div>
      <AccountFieldErrors error={error} field={id === "auth-confirm" ? "password_confirm" : "password"} />
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
    provider_error: "auth.oauthProviderError"
  };
  return t(keys[code] || "auth.oauthProviderError");
}

export function AuthPage({ onAuthed, completionUser = null, onSignOut = null }) {
  const { locale, direction, setLocale, t } = useI18n();
  const [mode, setMode] = useState(completionUser ? "complete" : "login");
  const [form, setForm] = useState(() => ({
    ...EMPTY_FORM,
    username: completionUser?.username || "",
    name: completionUser?.name || "",
    programId: completionUser?.cohort?.program?.id || "",
    cohortId: completionUser?.cohort?.id || ""
  }));
  const [cohorts, setCohorts] = useState([]);
  const [cohortLoading, setCohortLoading] = useState(true);
  const [cohortError, setCohortError] = useState(false);
  const [cohortRetry, setCohortRetry] = useState(0);
  const [providers, setProviders] = useState({ google: null, apple: null });
  const [error, setError] = useState(null);
  const [message, setMessage] = useState("");
  const [verificationPending, setVerificationPending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [socialLoading, setSocialLoading] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const policyRef = useRef(null);
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

  const programs = useMemo(() => {
    const uniquePrograms = new Map();
    cohorts.forEach((cohort) => {
      const program = cohort.program || {};
      const name = locale === "ar" ? program.name_ar : program.name_en;
      if (program.id && !uniquePrograms.has(program.id)) {
        uniquePrograms.set(program.id, { id: program.id, name });
      }
    });
    return Array.from(uniquePrograms.values());
  }, [cohorts, locale]);

  const availableCohorts = useMemo(
    () => cohorts.filter((cohort) => cohort.program?.id === form.programId),
    [cohorts, form.programId]
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
    authApi.oauthProviders().then((status) => { if (active) setProviders(status); }).catch(() => { if (active) setProviders({ google: false, apple: false }); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get("oauth");
    if (!outcome) return;
    if (outcome === "cancelled") setMessage(oauthMessage(t, outcome, ""));
    if (outcome === "error") setError(new Error(oauthMessage(t, outcome, params.get("oauth_error") || "")));
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.hash}`);
  }, [t]);

  useEffect(() => { document.title = `${heading[0]} — Lock-in`; }, [heading]);

  function updateForm(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function changeMode(nextMode) {
    setMode(nextMode);
    setError(null);
    setMessage("");
    setVerificationPending(false);
    setShowPassword(false);
    setShowConfirm(false);
    window.scrollTo({ top: 0 });
  }

  async function beginSocial(provider) {
    setError(null);
    setMessage("");
    if (mode === "signup" && !form.acceptPolicies) {
      const nextError = { message: t("auth.acceptRequired"), fields: { accept_policies: [t("auth.acceptRequired")] } };
      setError(nextError);
      policyRef.current?.focus();
      return;
    }
    setSocialLoading(provider);
    try {
      const authorizationUrl = await authApi.startOAuth(provider, {
        intent: mode === "signup" ? "register" : "login",
        preferredLanguage: locale,
        remember: form.remember,
        acceptPolicies: form.acceptPolicies
      });
      window.location.assign(authorizationUrl);
    } catch (nextError) {
      setError(nextError);
      setSocialLoading("");
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    setMessage("");
    if (mode === "signup" && form.password !== form.confirm) {
      setError({ message: t("auth.passwordMismatch"), fields: { password_confirm: [t("auth.passwordMismatch")] } });
      return;
    }
    setLoading(true);
    try {
      if (mode === "forgot") {
        await authApi.requestPasswordReset(form.email);
        setMessage(t("auth.resetSent"));
      } else if (mode === "signup") {
        await authApi.register({ fullName: form.name, email: form.email, password: form.password, passwordConfirm: form.confirm, preferredLanguage: locale, cohortId: form.cohortId, acceptPolicies: form.acceptPolicies });
        setMessage(t("auth.accountCreated"));
        setVerificationPending(true);
      } else if (mode === "complete") {
        const nextUser = await authApi.updateProfile({
          username: requiresUsername ? form.username : undefined,
          fullName: !requiresUsername && requiresName ? form.name : undefined,
          cohortId: !requiresUsername && requiresCohort ? form.cohortId : undefined,
          preferredLanguage: locale
        });
        onAuthed(nextUser, { newSession: false });
      } else {
        const result = await authApi.login({ email: form.email, password: form.password, remember: form.remember });
        onAuthed(result.user, { newSession: true });
      }
    } catch (nextError) {
      setError(nextError);
    } finally {
      setLoading(false);
    }
  }

  const busy = loading || Boolean(socialLoading);
  const socialVisible = mode === "login" || mode === "signup";

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

            {socialVisible && (
              <div className="auth-v2-social" aria-label={t("auth.or")}>
                <button type="button" className="auth-v2-social-button" onClick={() => beginSocial("google")} disabled={busy || providers.google !== true} title={providers.google === false ? t("auth.providerUnavailable") : undefined}>
                  {socialLoading === "google" ? <span className="auth-v2-spinner" /> : <GoogleIcon />}<span>{t("auth.continueGoogle")}</span>
                </button>
                <button type="button" className="auth-v2-social-button auth-v2-apple" onClick={() => beginSocial("apple")} disabled={busy || providers.apple !== true} title={providers.apple === false ? t("auth.providerUnavailable") : undefined}>
                  {socialLoading === "apple" ? <span className="auth-v2-spinner" /> : <AppleIcon />}<span>{t("auth.continueApple")}</span>
                </button>
                <div className="auth-v2-divider"><span>{t("auth.or")}</span></div>
              </div>
            )}

            <form className="auth-v2-form" onSubmit={handleSubmit}>
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
                    aria-describedby="auth-username-hint"
                    required
                  />
                  <p id="auth-username-hint" className="auth-v2-cohort-status">{t("auth.usernameHint")}</p>
                  <AccountFieldErrors error={error} field="username" />
                </div>
              )}

              {(mode === "signup" || (mode === "complete" && !requiresUsername && requiresName)) && (
                <div className="auth-v2-field">
                  <label htmlFor="auth-name">{t("auth.fullName")}</label>
                  <input id="auth-name" type="text" value={form.name} onChange={(event) => updateForm("name", event.target.value)} autoComplete="name" enterKeyHint="next" placeholder={t("auth.fullNamePlaceholder")} required />
                  <AccountFieldErrors error={error} field="full_name" />
                </div>
              )}

              {(mode === "signup" || (mode === "complete" && !requiresUsername && requiresCohort)) && (
                <>
                <div className="auth-v2-field">
                  <label htmlFor="auth-program">{t("auth.program")}</label>
                  <select id="auth-program" value={form.programId} onChange={(event) => setForm((current) => ({ ...current, programId: event.target.value, cohortId: "" }))} required disabled={cohortLoading || !programs.length || busy} aria-describedby={cohortLoading || cohortError ? "auth-cohort-status" : undefined}>
                    <option value="">{cohortLoading ? t("auth.loadingPrograms") : t("auth.chooseProgram")}</option>
                    {programs.map((program) => <option value={program.id} key={program.id}>{program.name}</option>)}
                  </select>
                  {cohortLoading && <p id="auth-cohort-status" className="auth-v2-cohort-status" role="status">{t("auth.loadingPrograms")}</p>}
                  {cohortError && <div id="auth-cohort-status" className="auth-v2-cohort-status auth-v2-cohort-error" role="alert"><span>{t("auth.cohortsUnavailable")}</span><button type="button" onClick={() => setCohortRetry((current) => current + 1)}>{t("common.tryAgain")}</button></div>}
                </div>

                <div className="auth-v2-field">
                  <label htmlFor="auth-cohort">{t("auth.cohort")}</label>
                  <select id="auth-cohort" value={form.cohortId} onChange={(event) => updateForm("cohortId", event.target.value)} required disabled={!form.programId || cohortLoading || !availableCohorts.length || busy}>
                    <option value="">{t("auth.chooseCohort")}</option>
                    {availableCohorts.map((cohort) => <option value={cohort.id} key={cohort.id}>{locale === "ar" ? cohort.name_ar : cohort.name_en}</option>)}
                  </select>
                  <AccountFieldErrors error={error} field="cohort_id" />
                </div>
                </>
              )}

              {mode !== "complete" && (
                <div className="auth-v2-field">
                  <label htmlFor="auth-email">{t("auth.email")}</label>
                  <input id="auth-email" className="auth-v2-email" type="email" value={form.email} onChange={(event) => updateForm("email", event.target.value)} inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck="false" enterKeyHint={mode === "forgot" ? "send" : "next"} placeholder={t("auth.emailPlaceholder")} required />
                  <AccountFieldErrors error={error} field="email" />
                </div>
              )}

              {(mode === "login" || mode === "signup") && <PasswordField id="auth-password" label={t("auth.password")} value={form.password} onChange={(event) => updateForm("password", event.target.value)} autoComplete={mode === "signup" ? "new-password" : "current-password"} placeholder={t("auth.passwordPlaceholder")} error={error} show={showPassword} onToggle={() => setShowPassword((current) => !current)} t={t} />}
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
                    <input ref={policyRef} type="checkbox" checked={form.acceptPolicies} onChange={(event) => updateForm("acceptPolicies", event.target.checked)} required />
                    <span>{t("auth.termsPrefix")} <Link to="/terms">{t("auth.terms")}</Link> {t("auth.and")} <Link to="/privacy">{t("auth.privacy")}</Link></span>
                  </label>
                  <AccountFieldErrors error={error} field="accept_policies" />
                </div>
              )}

              <AccountFormAlert error={error} message={message} />
              <button className="auth-v2-primary" type="submit" disabled={busy || (requiresUsername && form.username.length < 3) || ((mode === "signup" || mode === "complete") && !requiresUsername && requiresCohort && (cohortLoading || cohortError || !form.programId || !form.cohortId))}>
                {loading && <span className="auth-v2-spinner auth-v2-spinner-light" aria-hidden="true" />}<span>{loading ? t("auth.working") : mode === "signup" ? t("auth.create") : mode === "forgot" ? t("auth.sendReset") : mode === "complete" ? t("auth.continue") : t("auth.login")}</span>
              </button>

              {mode === "signup" && verificationPending && (
                <button className="auth-v2-text-action" type="button" disabled={busy} onClick={async () => {
                  setLoading(true); setError(null);
                  try { await authApi.resendVerification(form.email); setMessage(t("auth.verificationSent")); }
                  catch (nextError) { setError(nextError); }
                  finally { setLoading(false); }
                }}>{t("auth.resendVerification")}</button>
              )}
            </form>

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
