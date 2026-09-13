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
import { AccountFieldErrors, fieldErrorAttributes } from "../components/account/AccountFormErrors.jsx";
import { useI18n } from "../components/I18nProvider.jsx";
import { SessionList } from "../components/account/SessionList.jsx";
import { SubscriptionStatus } from "../components/subscription/SubscriptionStatus.jsx";
import { Page, ErrorPanel, RadioGroup, RadioOption, ToggleButton } from "../components/ui/index.jsx";
import { ResponsiveThemePreview } from "../components/shared/ResponsiveThemePreview.jsx";

export default function Settings({ user, onUserUpdate, settings, activeTheme, reminderSettings, onReminderSettingsChange, onSettingsChange, onSignedOut }) {
  const { t } = useI18n();
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
    const previous = normalizeThemeSettings(settings);
    onSettingsChange(normalized);
    setSaving(source);
    setError("");
    try {
      const updated = await accountsApi.updateProfile({
        mascotPreference: normalized.character,
        themePreference: normalized.theme,
        dynamicTheme: normalized.autoTheme
      });
      onUserUpdate(updated);
    } catch (requestError) {
      onSettingsChange(previous);
      setError(requestError.message || t("settings.themeSaveError"));
    } finally {
      setSaving("");
    }
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
          setReminderError(t("settings.notificationsDenied"));
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
      setReminderError(t("settings.notificationsUnsupported"));
      return;
    }
    if (Notification.permission !== "granted") {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setReminderError(t("settings.testReminderDenied"));
        return;
      }
    }
    new Notification(t("settings.reminderNotificationTitle"), {
      body: t("settings.reminderNotificationBody")
    });
  }

  return (
    <Page title={t("settings.pageTitle")} subtitle={t("settings.pageSubtitle")}>
      <section className="themes-page" data-active-section={activeSection}>
        {(error || reminderError) && <ErrorPanel message={error || reminderError} />}
        <nav className="settings-local-nav" aria-label={t("settings.sectionsLabel")}>
          {[["character", "settings.character"], ["app-icon", "settings.appIcon"], ["themes", "settings.themes"], ["reminder", "settings.reminder"], ["account", "common.account"]].map(([section, labelKey]) => <button type="button" key={section} onClick={() => openSection(section)} aria-controls={`settings-${section}`} aria-current={activeSection === section ? "location" : undefined}>{t(labelKey)}</button>)}
        </nav>
        <article className="theme-section" id="settings-character" aria-labelledby="settings-character-heading">
          <div className="theme-section-head">
            <div><p className="eyebrow">{t("settings.personalization")}</p><h2 id="settings-character-heading" tabIndex={-1}>{t("settings.character")}</h2></div>
            <span className="pill">{t(`settings.character.${settings.character}`)}</span>
          </div>
          {/* One character is in use, so this is a single choice. The options
              used to be independent toggles reporting aria-pressed. */}
          <RadioGroup className="character-grid" label={t("settings.studyCharacter")} value={settings.character} onChange={(next) => saveSettings({ ...settings, character: next }, `character-${next}`)}>
            {characterOptions.map((option) => {
              const selected = settings.character === option.id;
              return (
                <RadioOption
                  className={`theme-card character-card ${selected ? "selected" : ""}`}
                  key={option.id}
                  value={option.id}
                >
                  <ResponsiveThemePreview character={option.id} theme={activeTheme} alt={t("settings.previewNamed", { name: t(`settings.character.${option.id}`) })} sizes="(max-width: 639px) 42vw, 210px" />
                  <span>{t(`settings.character.${option.id}`)}</span>
                  {selected && <i><Icon name="check" size={18} /></i>}
                </RadioOption>
              );
            })}
          </RadioGroup>
        </article>

        <article className="theme-section app-icon-section" id="settings-app-icon" aria-labelledby="settings-app-icon-heading">
          <div className="theme-section-head">
            <div>
              <p className="eyebrow">{t("settings.personalization")}</p>
              <h2 id="settings-app-icon-heading" tabIndex={-1}>{t("settings.appIcon")}</h2>
              <p className="app-icon-description">{t("settings.appIconDescription")}</p>
            </div>
            <span className="pill">{t(`settings.appIcon.${settings.appIcon}`)}</span>
          </div>
          <RadioGroup className="app-icon-grid" label={t("settings.appIconChoices")} value={settings.appIcon} onChange={(next) => saveSettings({ ...settings, appIcon: next }, `app-icon-${next}`)}>
            {appIconOptions.map((option) => {
              const selected = settings.appIcon === option.id;
              return (
                <RadioOption
                  className={`app-icon-option ${selected ? "selected" : ""}`}
                  key={option.id}
                  value={option.id}
                >
                  <img src={assetPath(option.preview)} alt="" />
                  <span>{t(`settings.appIcon.${option.id}`)}</span>
                  {selected && <i aria-hidden="true"><Icon name="check" size={15} /></i>}
                </RadioOption>
              );
            })}
          </RadioGroup>
          <p className="app-icon-platform-note">{t("settings.appIconPlatformNote")}</p>
        </article>

        <article className="theme-section" id="settings-themes" aria-labelledby="settings-themes-heading">
          <div className="theme-section-head">
            <div><p className="eyebrow">{t("common.appearance")}</p><h2 id="settings-themes-heading" tabIndex={-1}>{t("settings.chooseTheme")}</h2></div>
            <span className="pill">{settings.autoTheme ? t("settings.autoThemeValue", { name: t(`settings.theme.${activeTheme}`) }) : t(`settings.theme.${settings.theme}`)}</span>
          </div>
          <RadioGroup className={`theme-grid ${settings.autoTheme ? "manual-disabled" : ""}`} label={t("settings.themeLabel")} value={settings.autoTheme ? "" : settings.theme} onChange={(next) => saveSettings({ ...settings, theme: next, autoTheme: false }, `theme-${next}`)}>
            {themeOptions.map((option) => {
              const selected = settings.theme === option.id && !settings.autoTheme;
              return (
                <RadioOption
                  className={`theme-card ${option.id} ${selected ? "selected" : ""}`}
                  key={option.id}
                  value={option.id}
                  disabled={settings.autoTheme}
                >
                  <ResponsiveThemePreview character={settings.character} theme={option.id} alt={t("settings.themePreviewNamed", { name: t(`settings.theme.${option.id}`) })} sizes="(max-width: 639px) 42vw, 210px" />
                  <span>{t(`settings.theme.${option.id}`)}</span>
                  <small>{option.time}</small>
                  {selected && <i><Icon name="check" size={18} /></i>}
                </RadioOption>
              );
            })}
          </RadioGroup>
        </article>

        <article className="auto-theme-card">
          <div>
            <p className="eyebrow">{t("common.appearance")}</p>
            <h2>{t("settings.autoTheme")}</h2>
            <p>{t("settings.autoThemeDescription")}</p>
          </div>
          <ToggleButton
            className={`auto-toggle ${settings.autoTheme ? "on" : ""}`}
            label={t("settings.automaticTheme")}
            pressed={settings.autoTheme}
            onClick={() => saveSettings({ ...settings, autoTheme: !settings.autoTheme }, "auto")}
          >
            <span>{t(settings.autoTheme ? "settings.on" : "settings.off")}</span>
            <i />
          </ToggleButton>
          <div className="theme-schedule">
            {themeOptions.map((option) => <span key={option.id}><strong>{t(`settings.theme.${option.id}`)}</strong>{option.time}</span>)}
          </div>
        </article>

        <article className="theme-section reminder-section" id="settings-reminder" aria-labelledby="settings-reminder-heading">
          <div className="theme-section-head">
            <div>
              <p className="eyebrow">{t("settings.studyRoutine")}</p>
              <h2 id="settings-reminder-heading" tabIndex={-1}>{t("settings.studyReminder")}</h2>
            </div>
            <span className={`pill ${reminderSettings.enabled ? "success" : ""}`}>{t(reminderSettings.enabled ? "settings.enabled" : "settings.off")}</span>
          </div>
          <div className="reminder-grid">
            <label className="field">
              <span>{t("settings.reminderTime")}</span>
              <input type="time" value={reminderSettings.time} onChange={(event) => saveReminder({ ...reminderSettings, time: event.target.value }, "reminder-time")} />
            </label>
            <ToggleButton
              className={`auto-toggle ${reminderSettings.enabled ? "on" : ""}`}
              label={t("settings.dailyStudyReminder")}
              pressed={reminderSettings.enabled}
              onClick={() => saveReminder({ ...reminderSettings, enabled: !reminderSettings.enabled }, "reminder-toggle")}
            >
              <span>{t(reminderSettings.enabled ? "settings.on" : "settings.off")}</span>
              <i />
            </ToggleButton>
            <button className="btn btn-soft" type="button" onClick={testReminder}>{t("settings.testReminder")}</button>
          </div>
          <p className="save-hint">{t("settings.reminderHint")}</p>
        </article>

        <section className="settings-account-management" id="settings-account" aria-labelledby="settings-account-heading">
          <div className="settings-account-heading">
            <div>
              <p className="eyebrow">{t("common.account")}</p>
              <h2 id="settings-account-heading" tabIndex={-1}>{t("settings.accountSecurity")}</h2>
              <p>{t("settings.accountDescription")}</p>
            </div>
            <span className="pill success">{t("settings.protected")}</span>
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
          <div className="settings-row"><div><h2>{t("settings.apiMode")}</h2><p>{t("settings.liveService")}</p></div><span className="pill success">{t("settings.live")}</span></div>
        </section>}
        {saving && <p className="save-hint">{t("settings.saving")}</p>}
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
  const { t } = useI18n();
  const [form, setForm] = useState({ currentPassword: "", password: "", passwordConfirm: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState("");

  async function submit(event) {
    event.preventDefault();
    if (form.password !== form.passwordConfirm) {
      setError({ message: t("settings.passwordMismatch"), fields: { new_password_confirm: [t("settings.passwordMismatch")] } });
      return;
    }
    setSaving(true);
    setError(null);
    setMessage("");
    try {
      await accountsApi.changePassword(form.currentPassword, form.password, form.passwordConfirm);
      setForm({ currentPassword: "", password: "", passwordConfirm: "" });
      setMessage(t("settings.passwordUpdated"));
    } catch (requestError) {
      setError(requestError);
    } finally {
      setSaving(false);
    }
  }

  return <article className="panel account-management-card"><div className="panel-title"><div><p className="eyebrow">{t("settings.accountSecurity")}</p><h2>{t("settings.changePassword")}</h2></div><Icon name="lock" size={18} /></div><form className="account-password-form" onSubmit={submit}><label className="field"><span>{t("settings.currentPassword")}</span><input type="password" autoComplete="current-password" value={form.currentPassword} onChange={(event) => setForm({ ...form, currentPassword: event.target.value })} required {...fieldErrorAttributes(error, "current_password", "settings-current-password-error")} /><AccountFieldErrors error={error} field="current_password" id="settings-current-password-error" /></label><label className="field"><span>{t("settings.newPassword")}</span><input type="password" autoComplete="new-password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} required {...fieldErrorAttributes(error, "new_password", "settings-new-password-error")} /><AccountFieldErrors error={error} field="new_password" id="settings-new-password-error" /></label><label className="field"><span>{t("settings.confirmNewPassword")}</span><input type="password" autoComplete="new-password" value={form.passwordConfirm} onChange={(event) => setForm({ ...form, passwordConfirm: event.target.value })} required {...fieldErrorAttributes(error, "new_password_confirm", "settings-confirm-password-error")} /><AccountFieldErrors error={error} field="new_password_confirm" id="settings-confirm-password-error" /></label><AccountFieldErrors error={error} /><div className="account-password-actions"><span role="status">{message}</span><button className="btn btn-primary compact" type="submit" disabled={saving}>{saving ? t("settings.updatingPassword") : t("settings.updatePassword")}</button></div></form></article>;
}

function AccountDeletionCard({ confirmationToken, onConfirmationHandled }) {
  const { t } = useI18n();
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
        ? t("settings.deletionCancelled")
        : t("settings.deletionCheckEmail"));
    } catch (requestError) {
      setError(requestError);
    } finally {
      setBusy(false);
    }
  }

  const isOpen = ["pending_confirmation", "confirmed", "processing"].includes(state.status);
  const statusLabel = state.status === "pending_confirmation"
    ? t("settings.deletionEmailRequired")
    : state.status === "confirmed"
      ? t("settings.deletionConfirmed")
      : state.status === "processing"
        ? t("settings.deletionProcessing")
        : state.status === "completed"
          ? t("settings.deletionCompleted")
          : t("settings.deletionNone");

  return <article className="panel account-management-card account-deletion-card">
    <div className="panel-title"><div><p className="eyebrow">{t("settings.dataRights")}</p><h2>{t("settings.deleteAccount")}</h2></div><Icon name="trash" size={18} /></div>
    <p>{t("settings.deletionDescription")}</p>
    <p className="save-hint" role="status">{state.loading ? t("settings.deletionChecking") : statusLabel}</p>
    {state.status === "confirmed" && !state.request?.policy_version && <p className="form-notice" role="alert">{t("settings.deletionPolicyPending")}</p>}
    <label className="field"><span>{t("settings.currentPassword")}</span><input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy || state.loading || state.status === "processing" || state.status === "completed"} /></label>
    <AccountFieldErrors error={error} />
    {message && <p className="save-hint" role="status">{message}</p>}
    <div className="account-password-actions">
      {isOpen ? <button className="btn btn-outline compact" type="button" onClick={() => void submit("cancel")} disabled={!password || busy}>{t("settings.cancelDeletion")}</button> : <button className="btn btn-danger compact" type="button" onClick={() => void submit("request")} disabled={!password || busy || state.loading || state.status === "completed"}>{busy ? t("settings.submittingDeletion") : t("settings.requestDeletion")}</button>}
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
      <select value={locale} disabled={saving} onChange={(event) => { void change(event.target.value); }} {...fieldErrorAttributes(error, "preferred_language", "settings-language-error")}>
        <option value="en">English</option>
        <option value="ar">العربية</option>
      </select>
    </label>
    <AccountFieldErrors error={error} field="preferred_language" id="settings-language-error" />
    <AccountFieldErrors error={error} />
    {message && <p className="save-hint" role="status">{message}</p>}
  </article>;
}

function ConnectedAccountsCard({ email }) {
  const { t } = useI18n();
  return <article className="panel account-management-card"><div className="panel-title"><div><p className="eyebrow">{t("settings.signInMethods")}</p><h2>{t("settings.connectedAccounts")}</h2></div><Icon name="user" size={18} /></div><div className="account-auth-methods"><div className="account-auth-method primary"><span><Icon name="lock" size={16} /></span><div><strong>{t("settings.emailPassword")}</strong><small>{email || t("settings.primarySignIn")}</small></div><b>{t("settings.primary")}</b></div><div className="account-auth-method"><span><Icon name="globe" size={16} /></span><div><strong>Google</strong><small>{t("settings.providerLinkingDisabled")}</small></div><b>{t("settings.notConnected")}</b></div><div className="account-auth-method"><span><Icon name="user" size={16} /></span><div><strong>Apple</strong><small>{t("settings.providerLinkingDisabled")}</small></div><b>{t("settings.notConnected")}</b></div></div></article>;
}

function NotificationPreferences() {
  const { t } = useI18n();
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
      setError(requestError.message || t("settings.notificationSaveError"));
    } finally {
      setSaving("");
    }
  }

  return (
    <article className="theme-section">
      <div className="theme-section-head">
        <div><p className="eyebrow">{t("settings.notifications")}</p><h2>{t("settings.serverNotifications")}</h2></div>
        <span className="pill">{t("settings.preferences")}</span>
      </div>
      <p className="save-hint">{t("settings.serverNotificationsHint")}</p>
      {preferenceData.loading && <p className="save-hint">{t("settings.loadingNotifications")}</p>}
      {preferenceData.error && <ErrorPanel message={preferenceData.error} onRetry={preferenceData.reload} />}
      {error && <ErrorPanel message={error} onRetry={preferenceData.reload} />}
      {!preferenceData.loading && !preferenceData.error && <section className="settings-panel compact">
        {!preferences.length && <p className="save-hint">{t("settings.noNotificationCategories")}</p>}
        {preferences.map((preference, index) => {
          const unavailable = !preference.available;
          const locked = preference.required;
          const isSaving = saving === `${preference.category}-${preference.channel}`;
          return (
            <div className="settings-row" key={`${preference.category}-${preference.channel}`}>
              <div><h2 dir="auto">{preference.category} · {preference.channel.replace("_", " ")}</h2><p>{t(locked ? "settings.alwaysOn" : unavailable ? "settings.channelUnavailable" : preference.enabled ? "settings.enabled" : "settings.disabled")}</p></div>
              <ToggleButton className={`auto-toggle ${preference.enabled ? "on" : ""}`} label={t("settings.notificationToggleLabel", { category: preference.category, channel: preference.channel.replace("_", " ") })} pressed={preference.enabled} onClick={() => { void togglePreference(index); }} disabled={locked || unavailable || Boolean(saving)}><span>{isSaving ? "…" : t(preference.enabled ? "settings.on" : "settings.off")}</span><i /></ToggleButton>
            </div>
          );
        })}
      </section>}
    </article>
  );
}
