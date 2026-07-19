import { useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { ApiError, apiRequest } from "../../api/client";
import { Alert } from "../../components/Feedback";
import { Button } from "../../components/Button";
import { FormField, SelectField } from "../../components/FormField";
import { formValue } from "../../components/formValue";
import { useI18n } from "../../i18n/I18nProvider";
import { useAuth } from "./AuthProvider";

function AuthHeading({ title, copy }: { title: string; copy?: string }) {
  return (
    <header className="auth-card__heading">
      <h1>{title}</h1>
      {copy ? <p>{copy}</p> : null}
    </header>
  );
}

function readableError(error: unknown, fallback: string, credentials?: string): string {
  if (error instanceof ApiError && error.code === "invalid_credentials" && credentials) {
    return credentials;
  }
  return error instanceof ApiError ? error.message : fallback;
}

export function LoginPage() {
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
      await navigate("/");
    } catch (reason) {
      setError(readableError(reason, t("genericError"), t("invalidCredentials")));
    } finally {
      setPending(false);
      submitLock.current = false;
    }
  }

  return (
    <main className="legacy-login" dir={direction} aria-labelledby="login-title">
      <a className="skip-link" href="#legacy-login-form">{t("skip")}</a>
      <div className="legacy-login__orbs" aria-hidden="true">
        <span className="legacy-login__orb legacy-login__orb--gold" />
        <span className="legacy-login__orb legacy-login__orb--violet" />
        <span className="legacy-login__orb legacy-login__orb--green" />
      </div>
      <section className="legacy-login__panel" aria-label="Lock-in authentication">
        <div className="legacy-login__content">
          <header className="legacy-login__brand">
            <div className="legacy-login__identity">
              <span className="legacy-login__mark" aria-hidden="true">L</span>
              <span className="legacy-login__badge">Lock-in</span>
            </div>
            <button className="legacy-login__language" type="button" onClick={toggleLocale}>
              <span aria-hidden="true">◎</span>
              {locale === "ar" ? "English" : "العربية"}
            </button>
          </header>
          <header className="legacy-login__heading">
            <h1 id="login-title">{t("loginTitle")}</h1>
            <p>{t("loginCopy")}</p>
          </header>
          {error ? <div className="legacy-login__alert" role="alert" aria-live="assertive">{error}</div> : null}
          <form id="legacy-login-form" className="legacy-login__form" onSubmit={(event) => void submit(event)}>
            <div className="legacy-login__field">
              <label htmlFor="login-email">{t("email")}</label>
              <span className="legacy-login__input-wrap">
                <span className="legacy-login__input-icon" aria-hidden="true">✉</span>
                <input id="login-email" name="email" type="email" placeholder="you@example.com" autoComplete="email" disabled={pending} required />
              </span>
            </div>
            <div className="legacy-login__field">
              <label htmlFor="login-password">{t("password")}</label>
              <span className="legacy-login__input-wrap">
                <span className="legacy-login__input-icon" aria-hidden="true">⌑</span>
                <input id="login-password" name="password" type={showPassword ? "text" : "password"} placeholder={t("password")} autoComplete="current-password" disabled={pending} required />
                <button className="legacy-login__reveal" type="button" disabled={pending} onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword}>
                  {showPassword ? "◉" : "◌"}
                </button>
              </span>
            </div>
            <div className="legacy-login__options">
              <label className="legacy-login__remember">
                <input name="remember_me" type="checkbox" disabled={pending} />
                <span>{t("remember")}</span>
              </label>
              <Link to="/forgot-password">{t("forgotPassword")}</Link>
            </div>
            <button className="legacy-login__submit" disabled={pending} type="submit" aria-busy={pending}>
              {pending ? <span className="legacy-login__spinner" aria-hidden="true" /> : null}
              {pending ? t("saving") : t("login")}
              {!pending ? <span aria-hidden="true">{direction === "rtl" ? "←" : "→"}</span> : null}
            </button>
          </form>
          <p className="legacy-login__switch">{t("noAccount")} <Link to="/register">{t("register")}</Link></p>
        </div>
      </section>
    </main>
  );
}

export function RegisterPage() {
  const { t, locale } = useI18n();
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      await apiRequest("/auth/register", {
        method: "POST",
        body: {
          full_name: formValue(data, "full_name"),
          email: formValue(data, "email"),
          password: formValue(data, "password"),
          password_confirm: formValue(data, "password_confirm"),
          preferred_language: formValue(data, "preferred_language"),
          accept_policies: data.get("accept_policies") === "on"
        }
      });
      setSuccess(true);
    } catch (reason) {
      setError(readableError(reason, t("genericError")));
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="auth-card" aria-labelledby="register-title">
      <AuthHeading title={t("registerTitle")} copy={t("registerCopy")} />
      {success ? <Alert tone="success">{t("verificationRequired")}</Alert> : null}
      {error ? <Alert>{error}</Alert> : null}
      <form onSubmit={(event) => void submit(event)}>
        <FormField label={t("fullName")} name="full_name" autoComplete="name" required />
        <FormField label={t("email")} name="email" type="email" autoComplete="email" required />
        <FormField
          label={t("password")}
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={10}
          required
        />
        <FormField
          label={t("confirmPassword")}
          name="password_confirm"
          type="password"
          autoComplete="new-password"
          minLength={10}
          required
        />
        <SelectField label={t("preferredLanguage")} name="preferred_language" defaultValue={locale}>
          <option value="en">{t("english")}</option>
          <option value="ar">{t("arabic")}</option>
        </SelectField>
        <label className="check-control">
          <input name="accept_policies" type="checkbox" required />
          <span>{t("policy")}</span>
        </label>
        <Button fullWidth disabled={pending || success} type="submit">
          {pending ? t("saving") : t("register")}
        </Button>
      </form>
      <p className="auth-card__switch">
        {t("haveAccount")} <Link to="/login">{t("login")}</Link>
      </p>
    </section>
  );
}

export function ForgotPasswordPage() {
  const { t } = useI18n();
  const [error, setError] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      await apiRequest("/auth/password-reset", {
        method: "POST",
        body: { email: formValue(data, "email") }
      });
      setAccepted(true);
    } catch (reason) {
      setError(readableError(reason, t("genericError")));
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="auth-card">
      <AuthHeading title={t("forgotTitle")} copy={t("forgotCopy")} />
      {accepted ? <Alert tone="success">{t("resetAccepted")}</Alert> : null}
      {error ? <Alert>{error}</Alert> : null}
      <form onSubmit={(event) => void submit(event)}>
        <FormField label={t("email")} name="email" type="email" autoComplete="email" required />
        <Button fullWidth disabled={pending || accepted} type="submit">
          {pending ? t("saving") : t("sendReset")}
        </Button>
      </form>
      <p className="auth-card__switch">
        <Link to="/login">{t("login")}</Link>
      </p>
    </section>
  );
}

export function ResetPasswordPage() {
  const { t } = useI18n();
  const [search] = useSearchParams();
  const token = search.get("token");
  const [error, setError] = useState(token ? "" : t("missingToken"));
  const [success, setSuccess] = useState(false);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    setPending(true);
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      await apiRequest("/auth/password-reset/confirm", {
        method: "POST",
        body: {
          token,
          new_password: formValue(data, "new_password"),
          new_password_confirm: formValue(data, "new_password_confirm")
        }
      });
      setSuccess(true);
    } catch (reason) {
      setError(readableError(reason, t("genericError")));
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="auth-card">
      <AuthHeading title={t("resetTitle")} />
      {success ? <Alert tone="success">{t("passwordReset")}</Alert> : null}
      {error ? <Alert>{error}</Alert> : null}
      <form onSubmit={(event) => void submit(event)}>
        <FormField label={t("newPassword")} name="new_password" type="password" minLength={10} required />
        <FormField
          label={t("confirmPassword")}
          name="new_password_confirm"
          type="password"
          minLength={10}
          required
        />
        <Button fullWidth disabled={pending || success || !token} type="submit">
          {pending ? t("saving") : t("savePassword")}
        </Button>
      </form>
      {success ? <p className="auth-card__switch"><Link to="/login">{t("login")}</Link></p> : null}
    </section>
  );
}

export function TokenConfirmationPage({ mode }: { mode: "verify" | "email-change" }) {
  const { t } = useI18n();
  const [search] = useSearchParams();
  const token = search.get("token");
  const [state, setState] = useState<"ready" | "pending" | "success" | "error">(token ? "ready" : "error");
  const [message, setMessage] = useState(token ? "" : t("missingToken"));

  async function confirm() {
    if (!token) return;
    setState("pending");
    try {
      await apiRequest(mode === "verify" ? "/auth/verify-email" : "/account/email/confirm", {
        method: "POST",
        body: { token }
      });
      setState("success");
      setMessage(mode === "verify" ? t("emailVerified") : t("emailConfirmed"));
    } catch (reason) {
      setState("error");
      setMessage(readableError(reason, t("genericError")));
    }
  }

  return (
    <section className="auth-card">
      <AuthHeading title={mode === "verify" ? t("verifyTitle") : t("confirmEmailTitle")} />
      {message ? <Alert tone={state === "success" ? "success" : "error"}>{message}</Alert> : null}
      {state === "success" ? (
        <Button fullWidth type="button" onClick={() => (window.location.href = "/login")}>{t("login")}</Button>
      ) : (
        <Button fullWidth type="button" disabled={!token || state === "pending"} onClick={() => void confirm()}>
          {state === "pending" ? t("confirming") : t("verify")}
        </Button>
      )}
    </section>
  );
}
