import { useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";

import { ApiError } from "../../api/client";
import { formValue } from "../../components/formValue";
import { useI18n } from "../../i18n/I18nProvider";
import { LegacyIcon } from "../../legacy/LegacyIcon";
import { useAuth } from "./AuthProvider";

function readableError(error: unknown, fallback: string, credentials: string): string {
  return error instanceof ApiError && error.code === "invalid_credentials" ? credentials : error instanceof ApiError ? error.message : fallback;
}

export function LegacyLoginPage() {
  const { direction, locale, t, toggleLocale } = useI18n();
  const { login } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const submitLock = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitLock.current) return;
    submitLock.current = true;
    setPending(true);
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      await login({
        email: formValue(data, "email"),
        password: formValue(data, "password"),
        remember_me: data.get("remember_me") === "on"
      });
      void navigate("/");
    } catch (reason) {
      setError(readableError(reason, t("genericError"), t("invalidCredentials")));
    } finally {
      setPending(false);
      submitLock.current = false;
    }
  }

  return (
    <main className="auth-page auth-login" dir={direction} aria-labelledby="login-title">
      <a className="skip-link" href="#login-form">{t("skip")}</a>
      <div className="auth-bg-orbs" aria-hidden="true">
        <span className="auth-orb auth-orb-1" />
        <span className="auth-orb auth-orb-2" />
        <span className="auth-orb auth-orb-3" />
      </div>
      <section className="auth-card" aria-label="Lock-in authentication">
        <div className="auth-panel">
          <div className="auth-panel-inner">
            <div className="auth-brand" style={{ display: "flex", flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: "12px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <div className="auth-brand-logo">
                  <span className="auth-brand-mark"><img src="/assets/logo.jpg" alt="Lock-in" className="brand-logo-img" /></span>
                </div>
                <span className="auth-brand-badge">{locale === "ar" ? "منصة الدراسة" : "Study Platform"}</span>
              </div>
              <button
                type="button"
                className="btn-lang-toggle"
                onClick={toggleLocale}
                aria-label={locale === "ar" ? "Use English" : "استخدم العربية"}
                style={{ background: "rgba(255, 255, 255, 0.06)", border: "1px solid rgba(255, 255, 255, 0.12)", borderRadius: "20px", padding: "6px 14px", color: "var(--text)", fontSize: "12px", fontWeight: "600", display: "flex", alignItems: "center", gap: "6px" }}
              >
                <LegacyIcon name="globe" size={14} />
                {locale === "ar" ? "English" : "العربية"}
              </button>
            </div>

            <header className="auth-header" style={{ textAlign: direction === "rtl" ? "right" : "left" }}>
              <h1 className="auth-title" id="login-title">{t("loginTitle")}</h1>
              <p className="auth-subtitle">{t("loginCopy")}</p>
            </header>

            <form id="login-form" className="auth-form" onSubmit={(event) => void submit(event)}>
              <div className="auth-field-group" style={{ textAlign: direction === "rtl" ? "right" : "left" }}>
                <label className="auth-field-label" htmlFor="login-email">{t("email")}</label>
                <div className="auth-input-wrap">
                  <span className="auth-input-icon" aria-hidden="true" style={{ left: direction === "rtl" ? "auto" : "12px", right: direction === "rtl" ? "12px" : "auto" }}><LegacyIcon name="mail" size={18} /></span>
                  <input id="login-email" name="email" type="email" placeholder="you@example.com" autoComplete="email" disabled={pending} required style={{ paddingLeft: direction === "rtl" ? "12px" : "44px", paddingRight: direction === "rtl" ? "44px" : "12px" }} />
                </div>
              </div>
              <div className="auth-field-group" style={{ textAlign: direction === "rtl" ? "right" : "left" }}>
                <label className="auth-field-label" htmlFor="login-password">{t("password")}</label>
                <div className="auth-input-wrap">
                  <span className="auth-input-icon" aria-hidden="true" style={{ left: direction === "rtl" ? "auto" : "12px", right: direction === "rtl" ? "12px" : "auto" }}><LegacyIcon name="lock" size={18} /></span>
                  <input id="login-password" name="password" type={showPassword ? "text" : "password"} placeholder={t("password")} autoComplete="current-password" disabled={pending} required style={{ paddingLeft: "44px", paddingRight: "44px" }} />
                  <button className="auth-input-toggle" type="button" disabled={pending} onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword} style={{ left: direction === "rtl" ? "4px" : "auto", right: direction === "rtl" ? "auto" : "4px" }}>
                    <LegacyIcon name={showPassword ? "eye-off" : "eye"} size={17} />
                  </button>
                </div>
              </div>
              <div className="auth-options-row">
                <label className="auth-check-row"><input name="remember_me" type="checkbox" disabled={pending} /><span>{t("remember")}</span></label>
                <Link className="auth-forgot-link" to="/forgot-password">{t("forgotPassword")}</Link>
              </div>
              {error ? <p className="form-alert error" role="alert" aria-live="assertive">{error}</p> : null}
              <button className="auth-submit-btn" disabled={pending} type="submit" aria-busy={pending}>
                {pending ? <span className="auth-spinner" aria-hidden="true" /> : null}
                {pending ? t("saving") : t("login")}
                {!pending ? <LegacyIcon name="chevron-right" size={18} /> : null}
              </button>
            </form>
            <div className="auth-switch"><p>{t("noAccount")} <Link className="auth-switch-link" to="/register">{t("register")}</Link></p></div>
          </div>
        </div>
      </section>
    </main>
  );
}
