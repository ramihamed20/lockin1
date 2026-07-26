import { useEffect, useState } from "react";
import { accountsApi } from "../api/accounts.js";
import { Icon } from "../lib/icons.jsx";
import { assets } from "../lib/constants.js";
import { assetPath } from "../lib/utils.js";
import { Page } from "../components/ui/index.jsx";
import { AccountFieldErrors, AccountFormAlert } from "../components/account/AccountFormErrors.jsx";
import { SessionList } from "../components/account/SessionList.jsx";
import { ConfirmDialog } from "../components/shared/ConfirmDialog.jsx";

export default function Profile({ user, onUserUpdate, onSignedOut }) {
  const [account, setAccount] = useState(user);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: user?.name || "", preferredLanguage: user?.preferredLanguage || "en" });
  const [saving, setSaving] = useState(false);
  const [profileError, setProfileError] = useState(null);
  const [passwordForm, setPasswordForm] = useState({ current: "", next: "", confirm: "" });
  const [passwordError, setPasswordError] = useState(null);
  const [passwordSuccess, setPasswordSuccess] = useState("");
  const [emailForm, setEmailForm] = useState({ newEmail: "", currentPassword: "" });
  const [emailError, setEmailError] = useState(null);
  const [emailSuccess, setEmailSuccess] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [logoutAllOpen, setLogoutAllOpen] = useState(false);
  const [logoutAllError, setLogoutAllError] = useState(null);
  const [sessionRefreshKey, setSessionRefreshKey] = useState(0);

  useEffect(() => {
    setAccount(user);
  }, [user]);

  useEffect(() => {
    let active = true;
    accountsApi.getProfile().then((nextAccount) => {
      if (!active) return;
      setAccount(nextAccount);
      onUserUpdate?.(nextAccount);
    }).catch((requestError) => {
      if (active) setProfileError(requestError);
    });
    return () => { active = false; };
  }, [onUserUpdate]);

  useEffect(() => {
    if (!account) return;
    setForm({ name: account.name, preferredLanguage: account.preferredLanguage || "en" });
  }, [account?.id, account?.name, account?.preferredLanguage]);

  async function saveProfile(event) {
    event.preventDefault();
    setSaving(true);
    setProfileError(null);
    try {
      const updated = await accountsApi.updateProfile({ fullName: form.name, preferredLanguage: form.preferredLanguage });
      setAccount(updated);
      onUserUpdate?.(updated);
      setEditing(false);
    } catch (requestError) {
      setProfileError(requestError);
    } finally {
      setSaving(false);
    }
  }

  async function changePassword(event) {
    event.preventDefault();
    setPasswordError(null);
    setPasswordSuccess("");
    if (passwordForm.next !== passwordForm.confirm) {
      setPasswordError({ message: "Passwords do not match.", fields: { new_password_confirm: ["Passwords do not match."] } });
      return;
    }
    try {
      await accountsApi.changePassword(passwordForm.current, passwordForm.next, passwordForm.confirm);
      setPasswordSuccess("Password updated. Other active sessions were revoked by the server.");
      setPasswordForm({ current: "", next: "", confirm: "" });
      setSessionRefreshKey((current) => current + 1);
    } catch (requestError) {
      setPasswordError(requestError);
    }
  }

  async function requestEmailChange(event) {
    event.preventDefault();
    setEmailError(null);
    setEmailSuccess("");
    try {
      await accountsApi.requestEmailChange(emailForm.newEmail, emailForm.currentPassword);
      setEmailSuccess("Check the new address for its one-time confirmation link.");
      setEmailForm({ newEmail: "", currentPassword: "" });
    } catch (requestError) {
      setEmailError(requestError);
    }
  }

  async function logoutAll() {
    setLogoutAllError(null);
    try {
      await accountsApi.logoutAll();
      onSignedOut?.();
    } catch (requestError) {
      setLogoutAllError(requestError);
    } finally {
      setLogoutAllOpen(false);
    }
  }

  return (
    <Page title="My Profile" subtitle="Manage your identity, language, and account security.">
      <section className="profile-grid">
        <article className="panel profile-card student-id-card">
          <div className="id-card-header"><div className="id-card-logo"><Icon name="award" size={18} /><span>DENTIFY ACADEMY</span></div><span className="id-card-chip" /></div>
          <div className="id-card-body"><div className="profile-avatar-wrap"><img src={assetPath(assets.mascot)} alt="Student avatar" /><div className="profile-level-badge"><span>LVL</span><strong>—</strong></div></div>
            {editing ? <form onSubmit={saveProfile} className="profile-edit-form">
              <label className="field"><span>Display Name</span><input type="text" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required /><AccountFieldErrors error={profileError} field="full_name" /></label>
              <label className="field"><span>Preferred language</span><select value={form.preferredLanguage} onChange={(event) => setForm({ ...form, preferredLanguage: event.target.value })}><option value="en">English</option><option value="ar">Arabic</option></select><AccountFieldErrors error={profileError} field="preferred_language" /></label>
              <label className="field"><span>Academic Year</span><input value="Not provided by the current account API" disabled /></label>
              <AccountFormAlert error={profileError} />
              <div className="profile-edit-actions"><button className="btn btn-primary" type="submit" disabled={saving}>{saving ? "Saving…" : "Save"}</button><button className="btn btn-soft" type="button" onClick={() => setEditing(false)}>Cancel</button></div>
            </form> : <div className="id-card-info"><div className="id-card-field"><span className="id-card-label">STUDENT NAME</span><h2 className="id-card-value">{account?.name || user?.name}</h2></div><div className="id-card-field"><span className="id-card-label">EMAIL ADDRESS</span><p className="id-card-value email">{account?.email || user?.email}</p></div><div className="id-card-row"><div className="id-card-field"><span className="id-card-label">PREFERRED LANGUAGE</span><span className="id-card-value-pill">{account?.preferredLanguage === "ar" ? "Arabic" : "English"}</span></div><div className="id-card-field"><span className="id-card-label">STATUS</span><span className={`id-card-value-pill ${account?.status === "active" ? "active" : ""}`}>{account?.status || "Unknown"}</span></div></div><button className="btn btn-soft edit-id-btn" type="button" onClick={() => setEditing(true)}><Icon name="settings" size={14} /> Edit Profile</button></div>}
          </div>
          <div className="id-card-footer"><div className="id-card-barcode">{["thin", "thick", "medium", "thin", "thick", "thin", "medium", "thin", "thick", "medium"].map((kind, index) => <span className={`barcode-line ${kind}`} key={index} />)}</div><span className="id-card-serial">Account ID {(account?.id || user?.id || "").slice(0, 8)}</span></div>
        </article>

        <article className="panel profile-stats-panel"><h2>Study Overview</h2><p className="muted">Server-backed learning statistics will be connected in Phase 2.</p><div className="profile-identity"><p className="eyebrow">Account verification</p><p>{account?.emailVerified ? "Your email is verified." : "Verify your email before signing in on a new session."}</p><div className="badge-row"><span>{account?.roles?.length ? account.roles.join(" · ") : "No product role returned"}</span><span>{account?.status || "Unknown"}</span></div></div></article>

        <article className="panel profile-security-panel"><h2>Change Password</h2><form onSubmit={changePassword} className="password-form"><label className="field"><span>Current password</span><input type={showPassword ? "text" : "password"} value={passwordForm.current} onChange={(event) => setPasswordForm({ ...passwordForm, current: event.target.value })} required /><AccountFieldErrors error={passwordError} field="current_password" /></label><label className="field"><span>New password</span><input type={showPassword ? "text" : "password"} value={passwordForm.next} onChange={(event) => setPasswordForm({ ...passwordForm, next: event.target.value })} required /><AccountFieldErrors error={passwordError} field="new_password" /></label><label className="field"><span>Confirm new password</span><input type={showPassword ? "text" : "password"} value={passwordForm.confirm} onChange={(event) => setPasswordForm({ ...passwordForm, confirm: event.target.value })} required /><AccountFieldErrors error={passwordError} field="new_password_confirm" /></label><label className="show-password-label"><input type="checkbox" checked={showPassword} onChange={() => setShowPassword(!showPassword)} /> Show passwords</label><AccountFormAlert error={passwordError} message={passwordSuccess} /><button className="btn btn-soft" type="submit"><Icon name="lock" size={16} /> Update password</button></form></article>

        <article className="panel profile-security-panel"><h2>Change Email</h2><form onSubmit={requestEmailChange} className="password-form"><label className="field"><span>New email address</span><input type="email" value={emailForm.newEmail} onChange={(event) => setEmailForm({ ...emailForm, newEmail: event.target.value })} required /><AccountFieldErrors error={emailError} field="new_email" /></label><label className="field"><span>Current password</span><input type="password" value={emailForm.currentPassword} onChange={(event) => setEmailForm({ ...emailForm, currentPassword: event.target.value })} required /><AccountFieldErrors error={emailError} field="current_password" /></label><AccountFormAlert error={emailError} message={emailSuccess} /><button className="btn btn-soft" type="submit"><Icon name="mail" size={16} /> Send confirmation email</button></form></article>

        <SessionList refreshKey={sessionRefreshKey} onCurrentSessionRevoked={onSignedOut} />
        <article className="panel profile-security-panel"><div className="panel-title"><div><p className="eyebrow">Security action</p><h2>Sign out everywhere</h2><p>Revoke this and every other active session.</p></div><button className="btn btn-danger" type="button" onClick={() => setLogoutAllOpen(true)}>Sign out all</button></div>{logoutAllError && <AccountFormAlert error={logoutAllError} />}</article>
      </section>
      <ConfirmDialog open={logoutAllOpen} title="Sign out of every device?" message="Every active session, including this browser, will be revoked." confirmLabel="Sign out all" onCancel={() => setLogoutAllOpen(false)} onConfirm={() => void logoutAll()} />
    </Page>
  );
}
