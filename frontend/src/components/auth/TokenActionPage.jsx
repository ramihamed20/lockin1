import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Icon } from "../../lib/icons.jsx";
import { authApi } from "../../lib/api.js";
import { assetPath } from "../../lib/utils.js";
import { AccountFieldErrors, AccountFormAlert } from "../account/AccountFormErrors.jsx";

const FLOW = {
  verify: {
    title: "Verify your email",
    subtitle: "Confirm this one-time link to activate your account.",
    action: "Verify email",
    run: (token) => authApi.verifyEmail(token),
    success: "Your email is verified. You can now sign in."
  },
  "confirm-email": {
    title: "Confirm your new email",
    subtitle: "Confirm this one-time link to finish changing your account email.",
    action: "Confirm email",
    run: (token) => authApi.confirmEmailChange(token),
    success: "Your email address has been updated."
  }
};

export function TokenActionPage({ type, onAccountChanged }) {
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
  const pageTitle = isReset ? "Reset your password" : flow.title;

  useEffect(() => {
    if (!token || !searchParams.has("token")) return;
    // Keep one-time credentials out of browser history and referrers as soon
    // as the router has captured them. The component instance retains the
    // in-memory token while the public URL is replaced with the clean route.
    navigate(`/${type}`, { replace: true });
  }, [navigate, searchParams, token, type]);

  useEffect(() => {
    document.title = `${pageTitle} — Lock-in`;
  }, [pageTitle]);

  async function submit(event) {
    event.preventDefault();
    setError(null);
    setMessage("");
    if (!token) {
      setError(new Error("This link is missing its verification token."));
      return;
    }
    if (isReset && password !== passwordConfirm) {
      setError({ message: "Passwords do not match.", fields: { new_password_confirm: ["Passwords do not match."] } });
      return;
    }
    setLoading(true);
    try {
      if (isReset) {
        await authApi.confirmPasswordReset(token, password, passwordConfirm);
        setMessage("Your password has been reset. Please sign in with your new password.");
        await onAccountChanged?.();
      } else {
        await flow.run(token);
        setMessage(flow.success);
        await onAccountChanged?.();
      }
      // The one-time token has been consumed; remove it from the visible URL.
      // Keep a non-secret message so this route remains useful if HashRouter
      // remounts it while processing the replacement navigation.
      navigate(`/${type}`, {
        replace: true,
        state: { accountActionMessage: isReset ? "Your password has been reset. Please sign in with your new password." : flow.success }
      });
    } catch (requestError) {
      setError(requestError);
    } finally {
      setLoading(false);
    }
  }

  const title = isReset ? "Choose a new password" : flow.title;
  const subtitle = isReset
    ? "Use this one-time link to securely set a new password."
    : flow.subtitle;
  const action = isReset ? "Reset password" : flow.action;

  return (
    <main className="auth-page auth-forgot">
      <div className="auth-bg-orbs" aria-hidden="true"><span className="auth-orb auth-orb-1" /><span className="auth-orb auth-orb-2" /><span className="auth-orb auth-orb-3" /></div>
      <section className="auth-card" aria-label="Account confirmation">
        <div className="auth-panel"><div className="auth-panel-inner">
          <div className="auth-brand"><div className="auth-brand-logo"><span className="auth-brand-mark"><img src={assetPath("/icons/lockin-light-192-v2.png")} alt="Lock-in Logo" className="brand-logo-img" /></span></div><span className="auth-brand-badge">Account security</span></div>
          <div className="auth-header"><h1 className="auth-title">{title}</h1><p className="auth-subtitle">{subtitle}</p></div>
          <form className="auth-form" onSubmit={submit}>
            {isReset && <>
              <label className="auth-field-group" htmlFor="reset-password"><span className="auth-field-label">New password</span><div className="auth-input-wrap"><span className="auth-input-icon" aria-hidden="true"><Icon name="lock" size={18} /></span><input id="reset-password" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></div><AccountFieldErrors error={error} field="new_password" /></label>
              <label className="auth-field-group" htmlFor="reset-password-confirm"><span className="auth-field-label">Confirm new password</span><div className="auth-input-wrap"><span className="auth-input-icon" aria-hidden="true"><Icon name="lock" size={18} /></span><input id="reset-password-confirm" type="password" autoComplete="new-password" value={passwordConfirm} onChange={(event) => setPasswordConfirm(event.target.value)} required /></div><AccountFieldErrors error={error} field="new_password_confirm" /></label>
            </>}
            <AccountFormAlert error={error} message={message} />
            {!message && <button className="auth-submit-btn" type="submit" disabled={loading}>{loading ? "Please wait..." : action}<Icon name="chevron-right" size={18} /></button>}
            {message && <button className="auth-submit-btn" type="button" onClick={() => navigate("/")}>Continue to sign in<Icon name="chevron-right" size={18} /></button>}
          </form>
          <div className="auth-switch"><p><Link className="auth-switch-link" to="/"><Icon name="chevron-left" size={16} /> Back to sign in</Link></p></div>
        </div></div>
      </section>
    </main>
  );
}
