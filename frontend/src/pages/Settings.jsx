import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { accountsApi } from "../api/accounts.js";
import { motivationApi } from "../api/motivation.js";
import { PRODUCT_ROLES } from "../api/contracts.js";
import { Icon } from "../lib/icons.jsx";
import { hasProductRole } from "../lib/authz.js";
import { useSubscriptionSession } from "../lib/SubscriptionSessionContext.jsx";
import { appIconOptions, characterOptions, themeOptions } from "../lib/constants.js";
import { assetPath, normalizeThemeSettings, normalizeReminderSettings } from "../lib/utils.js";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { AccountFieldErrors } from "../components/account/AccountFormErrors.jsx";
import { useI18n } from "../components/I18nProvider.jsx";
import { SessionList } from "../components/account/SessionList.jsx";
import { SubscriptionStatus } from "../components/subscription/SubscriptionStatus.jsx";
import { Page, ErrorPanel, RadioGroup, RadioOption, ToggleButton } from "../components/ui/index.jsx";
import { ResponsiveThemePreview } from "../components/shared/ResponsiveThemePreview.jsx";

export default function Settings({ user, onUserUpdate, settings, activeTheme, reminderSettings, onReminderSettingsChange, onSettingsChange, onSignedOut }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const [reminderError, setReminderError] = useState("");
  const isAdministrator = hasProductRole(user, PRODUCT_ROLES.ADMINISTRATOR);
  const searchParameters = new URLSearchParams(location.search);
  const requestedSection = searchParameters.get("section") || "";
  const deletionToken = searchParameters.get("token") || "";
  const activeSection = requestedSection || (deletionToken ? "account" : "character");
  const handleDeletionConfirmation = useCallback(() => {
    const search = new URLSearchParams(location.search);
    search.delete("token");
    search.set("section", "account");
    navigate(
      { pathname: "/settings", search: `?${search.toString()}` },
      { replace: true }
    );
  }, [location.search, navigate]);

  useEffect(() => {
    if (!requestedSection) return undefined;
    const section = document.getElementById(`settings-${activeSection}`);
    const heading = document.getElementById(`settings-${activeSection}-heading`);
    if (!section || !heading) return undefined;
    const frame = window.requestAnimationFrame(() => {
      section.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "start"
      });
      heading.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeSection, requestedSection]);

  function openSection(section) {
    const search = new URLSearchParams(location.search);
    search.set("section", section);
    navigate({ pathname: "/settings", search: `?${search.toString()}` });
  }

  async function saveSettings(nextSettings, source) {
    const normalized = normalizeThemeSettings(nextSettings);
    onSettingsChange(normalized);
    setSaving(source);
    setError("");
    // Theme choices are intentionally device-local: the current Django profile API
    // only owns account language and name, not visual preferences.
    window.setTimeout(() => setSaving(""), 0);
  }

  async function saveReminder(nextSettings, source) {
    const normalized = normalizeReminderSettings(nextSettings);
    setReminderError("");
    onReminderSettingsChange(normalized);
    setSaving(source);
    try {
      if (normalized.enabled && window.Notification && Notification.permission === "default") {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          onReminderSettingsChange({ ...normalized, enabled: false });
          setReminderError("Notifications were not allowed, so the reminder stays off.");
          return;
        }
      }
    } catch (err) {
      setReminderError(err.message);
    } finally {
      setSaving("");
    }
  }

  async function testReminder() {
    setReminderError("");
    if (!window.Notification) {
      setReminderError("Notifications are not supported in this browser.");
      return;
    }
    if (Notification.permission !== "granted") {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setReminderError("Permission denied, so test reminder could not be shown.");
        return;
      }
    }
    new Notification("Lock-in study reminder", {
      body: "This is a test reminder from Lock-in."
    });
  }

  return (
    <Page title="Settings" subtitle="Choose your study character, app icon, theme, reminders, and account preferences.">
      <section className="themes-page" data-active-section={activeSection}>
        {(error || reminderError) && <ErrorPanel message={error || reminderError} />}
        <nav className="settings-local-nav" aria-label="Settings sections">
          {[["character", "Character"], ["app-icon", "App Icon"], ["themes", "Themes"], ["reminder", "Reminder"], ["account", "Account"]].map(([section, label]) => <button type="button" key={section} onClick={() => openSection(section)} aria-controls={`settings-${section}`} aria-current={activeSection === section ? "location" : undefined}>{label}</button>)}
        </nav>
        <article className="theme-section" id="settings-character" aria-labelledby="settings-character-heading">
          <div className="theme-section-head">
            <div><p className="eyebrow">Section 1</p><h2 id="settings-character-heading" tabIndex={-1}>Character</h2></div>
            <span className="pill">{settings.character === "black" ? "Black Cat" : "White Cat"}</span>
          </div>
          {/* One character is in use, so this is a single choice. The options
              used to be independent toggles reporting aria-pressed. */}
          <RadioGroup className="character-grid" label="Study character" value={settings.character} onChange={(next) => saveSettings({ ...settings, character: next }, `character-${next}`)}>
            {characterOptions.map((option) => {
              const selected = settings.character === option.id;
              return (
                <RadioOption
                  className={`theme-card character-card ${selected ? "selected" : ""}`}
                  key={option.id}
                  value={option.id}
                >
                  <ResponsiveThemePreview character={option.id} theme={activeTheme} alt={`${option.label} preview`} sizes="(max-width: 639px) 42vw, 210px" />
                  <span>{option.label}</span>
                  {selected && <i><Icon name="check" size={18} /></i>}
                </RadioOption>
              );
            })}
          </RadioGroup>
        </article>

        <article className="theme-section app-icon-section" id="settings-app-icon" aria-labelledby="settings-app-icon-heading">
          <div className="theme-section-head">
            <div>
              <p className="eyebrow">Section 2</p>
              <h2 id="settings-app-icon-heading" tabIndex={-1}>App Icon</h2>
              <p className="app-icon-description">Choose the icon used in this browser and saved on this device.</p>
            </div>
            <span className="pill">{appIconOptions.find((option) => option.id === settings.appIcon)?.label}</span>
          </div>
          <RadioGroup className="app-icon-grid" label="App icon choices" value={settings.appIcon} onChange={(next) => saveSettings({ ...settings, appIcon: next }, `app-icon-${next}`)}>
            {appIconOptions.map((option) => {
              const selected = settings.appIcon === option.id;
              return (
                <RadioOption
                  className={`app-icon-option ${selected ? "selected" : ""}`}
                  key={option.id}
                  value={option.id}
                >
                  <img src={assetPath(option.preview)} alt="" />
                  <span>{option.label}</span>
                  {selected && <i aria-hidden="true"><Icon name="check" size={15} /></i>}
                </RadioOption>
              );
            })}
          </RadioGroup>
          <p className="app-icon-platform-note">Installed PWA icons are chosen when the app is installed. iPhone and iPad cannot change an existing Home Screen icon from the website; reinstall to use a different one there.</p>
        </article>

        <article className="theme-section" id="settings-themes" aria-labelledby="settings-themes-heading">
          <div className="theme-section-head">
            <div><p className="eyebrow">Section 3</p><h2 id="settings-themes-heading" tabIndex={-1}>Choose Theme</h2></div>
            <span className="pill">{settings.autoTheme ? `Auto: ${activeTheme}` : themeOptions.find((theme) => theme.id === settings.theme)?.label}</span>
          </div>
          <RadioGroup className={`theme-grid ${settings.autoTheme ? "manual-disabled" : ""}`} label="Theme" value={settings.autoTheme ? "" : settings.theme} onChange={(next) => saveSettings({ ...settings, theme: next, autoTheme: false }, `theme-${next}`)}>
            {themeOptions.map((option) => {
              const selected = settings.theme === option.id && !settings.autoTheme;
              return (
                <RadioOption
                  className={`theme-card ${option.id} ${selected ? "selected" : ""}`}
                  key={option.id}
                  value={option.id}
                  disabled={settings.autoTheme}
                >
                  <ResponsiveThemePreview character={settings.character} theme={option.id} alt={`${option.label} theme preview`} sizes="(max-width: 639px) 42vw, 210px" />
                  <span>{option.label}</span>
                  <small>{option.time}</small>
                  {selected && <i><Icon name="check" size={18} /></i>}
                </RadioOption>
              );
            })}
          </RadioGroup>
        </article>

        <article className="auto-theme-card">
          <div>
            <p className="eyebrow">Section 4</p>
            <h2>Auto Theme</h2>
            <p>Automatically switch themes based on the current time of day.</p>
          </div>
          <ToggleButton
            className={`auto-toggle ${settings.autoTheme ? "on" : ""}`}
            label="Automatic theme"
            pressed={settings.autoTheme}
            onClick={() => saveSettings({ ...settings, autoTheme: !settings.autoTheme }, "auto")}
          >
            <span>{settings.autoTheme ? "ON" : "OFF"}</span>
            <i />
          </ToggleButton>
          <div className="theme-schedule">
            {themeOptions.map((option) => <span key={option.id}><strong>{option.label}</strong>{option.time}</span>)}
          </div>
        </article>

        <article className="theme-section reminder-section" id="settings-reminder" aria-labelledby="settings-reminder-heading">
          <div className="theme-section-head">
            <div>
              <p className="eyebrow">Section 5</p>
              <h2 id="settings-reminder-heading" tabIndex={-1}>Study Reminder</h2>
            </div>
            <span className={`pill ${reminderSettings.enabled ? "success" : ""}`}>{reminderSettings.enabled ? "Enabled" : "Off"}</span>
          </div>
          <div className="reminder-grid">
            <label className="field">
              <span>Reminder time</span>
              <input type="time" value={reminderSettings.time} onChange={(event) => saveReminder({ ...reminderSettings, time: event.target.value }, "reminder-time")} />
            </label>
            <ToggleButton
              className={`auto-toggle ${reminderSettings.enabled ? "on" : ""}`}
              label="Daily study reminder"
              pressed={reminderSettings.enabled}
              onClick={() => saveReminder({ ...reminderSettings, enabled: !reminderSettings.enabled }, "reminder-toggle")}
            >
              <span>{reminderSettings.enabled ? "ON" : "OFF"}</span>
              <i />
            </ToggleButton>
            <button className="btn btn-soft" type="button" onClick={testReminder}>Test reminder</button>
          </div>
          <p className="save-hint">Lock-in will ping once per day after the selected time while the app is open.</p>
        </article>

        <section className="settings-account-management" id="settings-account" aria-labelledby="settings-account-heading">
          <div className="settings-account-heading">
            <div>
              <p className="eyebrow">Account</p>
              <h2 id="settings-account-heading" tabIndex={-1}>Account & security</h2>
              <p>Manage your password, sign-in methods, and active devices.</p>
            </div>
            <span className="pill success">Protected</span>
          </div>
          <div className="account-management-grid">
            <AccountSubscriptionCard onOpen={() => navigate("/subscription")} />
            <LanguageCard onUserUpdate={onUserUpdate} />
            <PasswordCard />
            <ConnectedAccountsCard email={user?.email} />
            <SessionList onCurrentSessionRevoked={onSignedOut} />
            <AccountDeletionCard
              confirmationToken={deletionToken}
              onConfirmationHandled={handleDeletionConfirmation}
            />
          </div>
        </section>

        {isAdministrator && <NotificationPreferences />}
        {isAdministrator && <section className="settings-panel compact">
          <div className="settings-row"><div><h2>API mode</h2><p>Connected to the live service.</p></div><span className="pill success">Live</span></div>
        </section>}
        {saving && <p className="save-hint">Saving theme settings...</p>}
      </section>
    </Page>
  );
}

function AccountSubscriptionCard({ onOpen }) {
  const { t } = useI18n();
  const { subscription } = useSubscriptionSession();
  return <article className="panel account-management-card"><div className="panel-title"><div><p className="eyebrow">{t("subscription.title")}</p><h2>{subscription?.plan_title || t("subscription.noPlan")}</h2></div><Icon name="coins" size={18} /></div><SubscriptionStatus subscription={subscription} /><button className="btn btn-outline compact" type="button" onClick={onOpen}>{t("subscription.view")}</button></article>;
}

function PasswordCard() {
  const [form, setForm] = useState({ currentPassword: "", password: "", passwordConfirm: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState("");

  async function submit(event) {
    event.preventDefault();
    if (form.password !== form.passwordConfirm) {
      setError({ message: "New passwords do not match.", fields: { new_password_confirm: ["New passwords do not match."] } });
      return;
    }
    setSaving(true);
    setError(null);
    setMessage("");
    try {
      await accountsApi.changePassword(form.currentPassword, form.password, form.passwordConfirm);
      setForm({ currentPassword: "", password: "", passwordConfirm: "" });
      setMessage("Your password has been updated.");
    } catch (requestError) {
      setError(requestError);
    } finally {
      setSaving(false);
    }
  }

  return <article className="panel account-management-card"><div className="panel-title"><div><p className="eyebrow">Account security</p><h2>Change password</h2></div><Icon name="lock" size={18} /></div><form className="account-password-form" onSubmit={submit}><label className="field"><span>Current password</span><input type="password" autoComplete="current-password" value={form.currentPassword} onChange={(event) => setForm({ ...form, currentPassword: event.target.value })} required /><AccountFieldErrors error={error} field="current_password" /></label><label className="field"><span>New password</span><input type="password" autoComplete="new-password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} required /><AccountFieldErrors error={error} field="new_password" /></label><label className="field"><span>Confirm new password</span><input type="password" autoComplete="new-password" value={form.passwordConfirm} onChange={(event) => setForm({ ...form, passwordConfirm: event.target.value })} required /><AccountFieldErrors error={error} field="new_password_confirm" /></label><AccountFieldErrors error={error} /><div className="account-password-actions"><span>{message}</span><button className="btn btn-primary compact" type="submit" disabled={saving}>{saving ? "Updating…" : "Update password"}</button></div></form></article>;
}

function AccountDeletionCard({ confirmationToken, onConfirmationHandled }) {
  const [state, setState] = useState({ loading: true, status: "not_requested", request: null });
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        let payload;
        if (confirmationToken) {
          payload = await accountsApi.confirmDeletion(confirmationToken);
          onConfirmationHandled?.();
        } else {
          payload = await accountsApi.getDeletionStatus();
        }
        if (active) setState({ loading: false, ...payload });
      } catch (requestError) {
        if (active) {
          setError(requestError);
          setState((current) => ({ ...current, loading: false }));
        }
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [confirmationToken, onConfirmationHandled]);

  async function submit(action) {
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    setMessage("");
    try {
      const payload = action === "cancel"
        ? await accountsApi.cancelDeletion(password)
        : await accountsApi.requestDeletion(password);
      setState({ loading: false, ...payload });
      setPassword("");
      setMessage(action === "cancel"
        ? "The deletion request was cancelled."
        : "Check your email and confirm the request using the single-use link.");
    } catch (requestError) {
      setError(requestError);
    } finally {
      setBusy(false);
    }
  }

  const isOpen = ["pending_confirmation", "confirmed", "processing"].includes(state.status);
  const statusLabel = state.status === "pending_confirmation"
    ? "Email confirmation required"
    : state.status === "confirmed"
      ? "Confirmed — awaiting approved retention processing"
      : state.status === "processing"
        ? "Deletion processing"
        : state.status === "completed"
          ? "Completed"
          : "No deletion request";

  return <article className="panel account-management-card account-deletion-card">
    <div className="panel-title"><div><p className="eyebrow">Data rights</p><h2>Delete account</h2></div><Icon name="trash" size={18} /></div>
    <p>Deletion is different from sign-out or suspension. A verified request is tracked before eligible data can be erased or anonymized under the approved retention policy.</p>
    <p className="save-hint" role="status">{state.loading ? "Checking deletion status…" : statusLabel}</p>
    {state.status === "confirmed" && !state.request?.policy_version && <p className="form-notice" role="alert">Your request is confirmed but cannot be processed until the retention policy is approved.</p>}
    <label className="field"><span>Current password</span><input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy || state.loading || state.status === "processing" || state.status === "completed"} /></label>
    <AccountFieldErrors error={error} />
    {message && <p className="save-hint" role="status">{message}</p>}
    <div className="account-password-actions">
      {isOpen ? <button className="btn btn-outline compact" type="button" onClick={() => void submit("cancel")} disabled={!password || busy}>Cancel request</button> : <button className="btn btn-danger compact" type="button" onClick={() => void submit("request")} disabled={!password || busy || state.loading || state.status === "completed"}>{busy ? "Submitting…" : "Request deletion"}</button>}
    </div>
  </article>;
}

/**
 * The interface language lived only on the sign-in screen and inside a tab on
 * the profile, so a reader who had already signed in had nowhere obvious to
 * change it. It belongs beside the other account settings.
 */
function LanguageCard({ onUserUpdate }) {
  const { t, locale } = useI18n();
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(null);

  async function change(next) {
    if (next === locale || saving) return;
    setSaving(true);
    setError(null);
    setMessage("");
    try {
      const updated = await accountsApi.updateProfile({ preferredLanguage: next });
      onUserUpdate?.(updated);
      setMessage(t("settings.languageSaved"));
    } catch (requestError) {
      setError(requestError);
    } finally {
      setSaving(false);
    }
  }

  return <article className="panel account-management-card">
    <div className="panel-title">
      <div><p className="eyebrow">{t("common.appearance")}</p><h2>{t("settings.language")}</h2></div>
      <Icon name="globe" size={18} />
    </div>
    <label className="field">
      <span>{t("settings.interfaceLanguage")}</span>
      <select value={locale} disabled={saving} onChange={(event) => { void change(event.target.value); }}>
        <option value="en">English</option>
        <option value="ar">العربية</option>
      </select>
    </label>
    <AccountFieldErrors error={error} field="preferred_language" />
    <AccountFieldErrors error={error} />
    {message && <p className="save-hint" role="status">{message}</p>}
  </article>;
}

function ConnectedAccountsCard({ email }) {
  return <article className="panel account-management-card"><div className="panel-title"><div><p className="eyebrow">Sign-in methods</p><h2>Connected accounts</h2></div><Icon name="user" size={18} /></div><div className="account-auth-methods"><div className="account-auth-method primary"><span><Icon name="lock" size={16} /></span><div><strong>Email & password</strong><small>{email || "Primary Lock In sign-in"}</small></div><b>Primary</b></div><div className="account-auth-method"><span><Icon name="globe" size={16} /></span><div><strong>Google</strong><small>Provider linking is not enabled yet.</small></div><b>Not connected</b></div><div className="account-auth-method"><span><Icon name="user" size={16} /></span><div><strong>Apple</strong><small>Provider linking is not enabled yet.</small></div><b>Not connected</b></div></div></article>;
}

function NotificationPreferences() {
  const preferenceData = useAsyncData(() => motivationApi.notificationPreferences(), []);
  const [preferences, setPreferences] = useState([]);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (preferenceData.data) setPreferences(preferenceData.data);
  }, [preferenceData.data]);

  async function togglePreference(index) {
    const selected = preferences[index];
    if (!selected || selected.required || !selected.available || saving) return;
    const next = preferences.map((item, itemIndex) => itemIndex === index ? { ...item, enabled: !item.enabled } : item);
    setSaving(`${selected.category}-${selected.channel}`);
    setError("");
    try {
      const updated = await motivationApi.updateNotificationPreferences(next);
      setPreferences(updated);
    } catch (requestError) {
      setError(requestError.message || "Notification preferences could not be saved.");
    } finally {
      setSaving("");
    }
  }

  return (
    <article className="theme-section">
      <div className="theme-section-head">
        <div><p className="eyebrow">Section 5</p><h2>Server Notifications</h2></div>
        <span className="pill">Preferences</span>
      </div>
      <p className="save-hint">These are server notification preferences. The study reminders above stay on this device.</p>
      {preferenceData.loading && <p className="save-hint">Loading notification preferences…</p>}
      {preferenceData.error && <ErrorPanel message={preferenceData.error} onRetry={preferenceData.reload} />}
      {error && <ErrorPanel message={error} onRetry={preferenceData.reload} />}
      {!preferenceData.loading && !preferenceData.error && <section className="settings-panel compact">
        {!preferences.length && <p className="save-hint">No notification preference categories are available for this account.</p>}
        {preferences.map((preference, index) => {
          const unavailable = !preference.available;
          const locked = preference.required;
          const isSaving = saving === `${preference.category}-${preference.channel}`;
          return (
            <div className="settings-row" key={`${preference.category}-${preference.channel}`}>
              <div><h2>{preference.category} · {preference.channel.replace("_", " ")}</h2><p>{locked ? "Always on" : unavailable ? "This delivery channel is not available yet" : preference.enabled ? "Enabled" : "Disabled"}</p></div>
              <ToggleButton className={`auto-toggle ${preference.enabled ? "on" : ""}`} label={`${preference.category} ${preference.channel.replace("_", " ")} notifications`} pressed={preference.enabled} onClick={() => { void togglePreference(index); }} disabled={locked || unavailable || Boolean(saving)}><span>{isSaving ? "…" : preference.enabled ? "ON" : "OFF"}</span><i /></ToggleButton>
            </div>
          );
        })}
      </section>}
    </article>
  );
}
