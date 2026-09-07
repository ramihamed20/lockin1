import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Icon } from "../../lib/icons.jsx";
import { authApi } from "../../lib/api.js";
import { assetPath } from "../../lib/utils.js";
import { AccountFieldErrors, AccountFormAlert, fieldErrorAttributes } from "../account/AccountFormErrors.jsx";
import { useI18n } from "../I18nProvider.jsx";

const FLOW = {
  verify: {
    titleKey: "token.verifyTitle",
    subtitleKey: "token.verifySubtitle",
    actionKey: "token.verifyAction",
    run: (token) => authApi.verifyEmail(token),
    successKey: "token.verifySuccess",
    successAuthenticatedKey: "token.verifySuccessAuthenticated"
  },
  "confirm-email": {
    titleKey: "token.confirmEmailTitle",
    subtitleKey: "token.confirmEmailSubtitle",
    actionKey: "token.confirmEmailAction",
    run: (token) => authApi.confirmEmailChange(token),
    successKey: "token.confirmEmailSuccess"
  }
};

export function TokenActionPage({ type, onAccountChanged }) {
  const { direction, t } = useI18n();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // Capture only the current route token. It is never persisted, logged, or
  // copied into application state beyond the one-time action request.
  const [token] = useState(() => searchParams.get("token") || "");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [error, setError] = useState(null);
  // Preserve only a non-sensitive completion message if replacing the URL
  // remounts this route. The token itself is never placed in navigation state.
  const [message, setMessage] = useState(() => location.state?.accountActionMessage || "");
  const [loading, setLoading] = useState(false);
  const isReset = type === "reset-password";
  const flow = FLOW[type];
  const pageTitle = isReset ? t("token.resetPageTitle") : t(flow.titleKey);
  // The route this page was mounted on. The flow type is not a route name
  // ("verify" is served at /verify-email), so replacing the URL with a name
  // derived from the type navigates away from this page and discards the
  // token before the visitor can confirm anything.
  const routePath = location.pathname;

  useEffect(() => {
    if (!token || !searchParams.has("token")) return;
    // Keep one-time credentials out of browser history and referrers as soon
    // as the router has captured them. The component instance retains the
    // in-memory token while the public URL is replaced with the clean route.
    navigate(routePath, { replace: true });
  }, [navigate, routePath, searchParams, token]);

  useEffect(() => {
    document.title = `${pageTitle} — Lock-in`;
  }, [pageTitle]);

  async function submit(event) {
    event.preventDefault();
    setError(null);
    setMessage("");
    if (!token) {
      setError(new Error(t("token.missingToken")));
      return;
    }
    if (isReset && password !== passwordConfirm) {
      setError({ message: t("auth.passwordMismatch"), fields: { new_password_confirm: [t("auth.passwordMismatch")] } });
      return;
    }
    setLoading(true);
    try {
      let authenticated = false;
      if (isReset) {
        await authApi.confirmPasswordReset(token, password, passwordConfirm);
        setMessage(t("token.resetSuccess"));
      } else {
        // Verifying an account the server is willing to sign in returns that
        // account, and the session cookie arrives with the same response.
        const result = await flow.run(token);
        authenticated = Boolean(result?.user);
        setMessage(t(authenticated ? flow.successAuthenticatedKey || flow.successKey : flow.successKey));
      }
      // The single-use token is spent either way, so a failure to refresh the
      // signed-in account must not be reported as a failed confirmation.
      let refreshedUser = null;
      try {
        refreshedUser = (await onAccountChanged?.()) || null;
      } catch {
        // The account action already completed on the server.
      }
      if (authenticated && refreshedUser) {
        // Signed in and confirmed: leave this one-time route for the authed
        // destination, which drops the spent token's route from the URL too.
        navigate("/", { replace: true });
        return;
      }
      // The one-time token has been consumed; remove it from the visible URL.
      // Keep a non-secret message so this route remains useful if HashRouter
      // remounts it while processing the replacement navigation.
      navigate(routePath, {
        replace: true,
        state: { accountActionMessage: isReset ? t("token.resetSuccess") : t(flow.successKey) }
      });
    } catch (requestError) {
      setError(requestError);
    } finally {
      setLoading(false);
    }
  }

  const title = isReset ? t("token.choosePassword") : t(flow.titleKey);
  const subtitle = isReset
    ? t("token.resetSubtitle")
    : t(flow.subtitleKey);
  const action = isReset ? t("token.resetAction") : t(flow.actionKey);

  return (
    <main className="auth-page auth-forgot" dir={direction}>
      <div className="auth-bg-orbs" aria-hidden="true"><span className="auth-orb auth-orb-1" /><span className="auth-orb auth-orb-2" /><span className="auth-orb auth-orb-3" /></div>
      <section className="auth-card" aria-label={t("token.accountConfirmation")}>
        <div className="auth-panel"><div className="auth-panel-inner">
          <div className="auth-brand"><div className="auth-brand-logo"><span className="auth-brand-mark"><img src={assetPath("/icons/lockin-light-192-v2.png")} alt={t("token.logoAlt")} className="brand-logo-img" /></span></div><span className="auth-brand-badge">{t("token.accountSecurity")}</span></div>
          <div className="auth-header"><h1 className="auth-title">{title}</h1><p className="auth-subtitle">{subtitle}</p></div>
          <form className="auth-form" onSubmit={submit}>
            {isReset && <>
              <label className="auth-field-group" htmlFor="reset-password"><span className="auth-field-label">{t("token.newPassword")}</span><div className="auth-input-wrap"><span className="auth-input-icon" aria-hidden="true"><Icon name="lock" size={18} /></span><input id="reset-password" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} required {...fieldErrorAttributes(error, "new_password", "reset-password-error")} /></div><AccountFieldErrors error={error} field="new_password" id="reset-password-error" /></label>
              <label className="auth-field-group" htmlFor="reset-password-confirm"><span className="auth-field-label">{t("token.confirmNewPassword")}</span><div className="auth-input-wrap"><span className="auth-input-icon" aria-hidden="true"><Icon name="lock" size={18} /></span><input id="reset-password-confirm" type="password" autoComplete="new-password" value={passwordConfirm} onChange={(event) => setPasswordConfirm(event.target.value)} required {...fieldErrorAttributes(error, "new_password_confirm", "reset-password-confirm-error")} /></div><AccountFieldErrors error={error} field="new_password_confirm" id="reset-password-confirm-error" /></label>
            </>}
            <AccountFormAlert error={error} message={message} />
            {!message && <button className="auth-submit-btn" type="submit" disabled={loading}>{loading ? t("auth.working") : action}<Icon name="chevron-right" size={18} /></button>}
            {message && <button className="auth-submit-btn" type="button" onClick={() => navigate("/")}>{t("token.continueSignIn")}<Icon name="chevron-right" size={18} /></button>}
          </form>
          <div className="auth-switch"><p><Link className="auth-switch-link" to="/"><Icon name="chevron-left" size={16} /> {t("token.backSignIn")}</Link></p></div>
        </div></div>
      </section>
    </main>
  );
}
