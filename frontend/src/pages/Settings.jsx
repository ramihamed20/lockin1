import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
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
import { UserAvatar } from "../components/shared/UserAvatar.jsx";
import { Page, ErrorPanel, RadioGroup, RadioOption, Switch } from "../components/ui/index.jsx";
import { ResponsiveThemePreview } from "../components/shared/ResponsiveThemePreview.jsx";
import OfflineSettings from "../offline/OfflineSettings.jsx";

/**
 * Settings is organised the way a native settings app is: a short list of
 * sections, each a page of grouped rows. On phones and tablets the list is its
 * own screen and a section opens over it with a way back; on wide screens the
 * list stays beside the open section.
 *
 * Earlier links name the six sections the page used to have. They still work:
 * each one opens the section that now holds it and scrolls to its group.
 */
const SECTIONS = [
  { id: "account", labelKey: "common.account", icon: "user" },
  { id: "appearance", labelKey: "common.appearance", icon: "palette" },
  { id: "notifications", labelKey: "settings.notifications", icon: "bell" },
  { id: "offline", labelKey: "offline.title", icon: "package" }
];

const LEGACY_SECTIONS = {
  character: ["appearance", "settings-character"],
  "app-icon": ["appearance", "settings-app-icon"],
  themes: ["appearance", "settings-themes"],
  reminder: ["notifications", "settings-reminder"]
};

const DEFAULT_WIDE_SECTION = "appearance";

function resolveSection(requested, deletionToken) {
  if (LEGACY_SECTIONS[requested]) return { section: LEGACY_SECTIONS[requested][0], anchor: LEGACY_SECTIONS[requested][1] };
  if (SECTIONS.some((entry) => entry.id === requested)) return { section: requested, anchor: "" };
  if (deletionToken) return { section: "account", anchor: "" };
  return { section: "", anchor: "" };
}

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
  const resolved = resolveSection(requestedSection, deletionToken);
  // With no section named, a phone shows the list; a wide screen shows the
  // list beside the default section. CSS decides which of the two is visible.
  const activeSection = resolved.section || DEFAULT_WIDE_SECTION;
  const view = resolved.section ? "detail" : "root";

  const handleDeletionConfirmation = useCallback(() => {
    const search = new URLSearchParams(location.search);
    search.delete("token");
    search.set("section", "account");
    navigate(
      { pathname: "/settings", search: `?${search.toString()}` },
      { replace: true }
    );
  }, [location.search, navigate]);

  // Opening a section (from the list or a deep link) moves focus to its title,
  // or to the group a deep link names, so the change is announced.
  useEffect(() => {
    if (!resolved.section) return undefined;
    const focus = new URLSearchParams(location.search).get("focus");
    const focusTarget = focus === "username" || focus === "password" ? `settings-${focus}` : resolved.anchor;
    const target = focusTarget ? document.getElementById(focusTarget) : null;
    const heading = document.getElementById(`${focusTarget || `settings-${resolved.section}`}-heading`);
    const frame = window.requestAnimationFrame(() => {
      if (target) {
        target.scrollIntoView({
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
          block: "start"
        });
      }
      heading?.focus({ preventScroll: Boolean(target) });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [location.search, resolved.anchor, resolved.section]);

  function openSection(section) {
    const search = new URLSearchParams(location.search);
    search.set("section", section);
    search.delete("focus");
    navigate({ pathname: "/settings", search: `?${search.toString()}` }, { state: { fromSettingsList: true } });
  }

  function backToList() {
    if (location.state?.fromSettingsList) navigate(-1);
    else navigate({ pathname: "/settings" }, { replace: true });
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

  const themeValue = settings.autoTheme
    ? t("settings.autoThemeValue", { name: t(`settings.theme.${activeTheme}`) })
    : t(`settings.theme.${settings.theme}`);
  const sectionValues = {
    account: user?.username || "",
    appearance: themeValue,
    notifications: reminderSettings.enabled ? reminderSettings.time : t("settings.valueOff"),
    offline: ""
  };
  const sectionTitle = t(SECTIONS.find((entry) => entry.id === activeSection)?.labelKey || "settings.pageTitle");

  return (
    <Page title={t("settings.pageTitle")} headingHandled>
      <section className="settings-v2" data-view={view} data-active-section={activeSection}>
        <header className="settings-v2-head">
          <h1 dir="auto">{t("settings.pageTitle")}</h1>
        </header>

        <nav className="settings-v2-nav" aria-label={t("settings.sectionsLabel")}>
          <ul className="ui-group">
            {SECTIONS.map((section) => {
              const current = activeSection === section.id;
              return <li key={section.id}>
                <button
                  type="button"
                  className="ui-row"
                  aria-label={t(section.labelKey)}
                  aria-controls="settings-v2-detail"
                  aria-current={current ? "location" : undefined}
                  data-current={current ? "" : undefined}
                  onClick={() => openSection(section.id)}
                >
                  <span className={`ui-row-icon settings-v2-icon settings-v2-icon--${section.id}`}><Icon name={section.icon} size={17} /></span>
                  <span className="ui-row-body"><span>{t(section.labelKey)}</span></span>
                  {sectionValues[section.id] && <span className="ui-row-value" aria-hidden="true" dir="auto">{sectionValues[section.id]}</span>}
                  <Icon className="ui-row-chevron" name="chevron-right" size={17} />
                </button>
              </li>;
            })}
          </ul>
        </nav>

        <div className="settings-v2-detail" id="settings-v2-detail">
          <header className="settings-v2-detail-head">
            <button type="button" className="settings-v2-back" onClick={backToList}>
              <Icon name="chevron-left" size={20} />
              <span>{t("settings.pageTitle")}</span>
            </button>
            <h2 id={`settings-${activeSection}-heading`} tabIndex={-1} dir="auto">{sectionTitle}</h2>
          </header>

          {(error || reminderError) && <ErrorPanel message={error || reminderError} />}

          {activeSection === "account" && <section className="settings-v2-section" id="settings-account" aria-labelledby="settings-account-heading">
            <AccountSummary user={user} />
            <AccountSubscriptionGroup />
            <UsernameCard user={user} onUserUpdate={onUserUpdate} />
            <PasswordCard id="settings-password" headingId="settings-password-heading" />
            <ConnectedAccountsCard email={user?.email} />
            <SessionList onCurrentSessionRevoked={onSignedOut} />
            <AccountDeletionCard
              confirmationToken={deletionToken}
              onConfirmationHandled={handleDeletionConfirmation}
            />
          </section>}

          {activeSection === "appearance" && <section className="settings-v2-section" id="settings-appearance" aria-labelledby="settings-appearance-heading">
            <div className="ui-group-block settings-v2-block" id="settings-themes">
              <h3 className="ui-group-title" id="settings-themes-heading" tabIndex={-1}>{t("settings.themeLabel")}</h3>
              <div className="ui-group settings-v2-pad">
                <RadioGroup className={`settings-v2-choices settings-v2-choices--themes ${settings.autoTheme ? "manual-disabled" : ""}`} label={t("settings.themeLabel")} value={settings.autoTheme ? "" : settings.theme} onChange={(next) => saveSettings({ ...settings, theme: next, autoTheme: false }, `theme-${next}`)}>
                  {themeOptions.map((option) => {
                    return (
                      <RadioOption
                        className={`settings-v2-choice settings-v2-choice--${option.id}`}
                        key={option.id}
                        value={option.id}
                        disabled={settings.autoTheme}
                      >
                        <span className="settings-v2-choice-art"><ResponsiveThemePreview character={settings.character} theme={option.id} alt={t("settings.themePreviewNamed", { name: t(`settings.theme.${option.id}`) })} sizes="(max-width: 639px) 42vw, 180px" /></span>
                        <span className="settings-v2-choice-label">{t(`settings.theme.${option.id}`)}</span>
                        <small><span dir="ltr">{option.time}</span></small>
                      </RadioOption>
                    );
                  })}
                </RadioGroup>
              </div>
              <div className="ui-group">
                <div className="ui-row">
                  <span className="ui-row-body"><label htmlFor="settings-auto-theme">{t("settings.autoTheme")}</label><small>{t("settings.autoThemeDescription")}</small></span>
                  <Switch id="settings-auto-theme" checked={settings.autoTheme} busy={saving === "auto"} onCheckedChange={(next) => saveSettings({ ...settings, autoTheme: next }, "auto")} />
                </div>
              </div>
            </div>

            <LanguageCard onUserUpdate={onUserUpdate} />

            <div className="ui-group-block settings-v2-block" id="settings-character">
              <h3 className="ui-group-title" id="settings-character-heading" tabIndex={-1}>{t("settings.studyCharacter")}</h3>
              <div className="ui-group settings-v2-pad">
                {/* One character is in use, so this is a single choice. */}
                <RadioGroup className="settings-v2-choices settings-v2-choices--characters" label={t("settings.studyCharacter")} value={settings.character} onChange={(next) => saveSettings({ ...settings, character: next }, `character-${next}`)}>
                  {characterOptions.map((option) => {
                    return (
                      <RadioOption
                        className="settings-v2-choice"
                        key={option.id}
                        value={option.id}
                      >
                        <span className="settings-v2-choice-art"><ResponsiveThemePreview character={option.id} theme={activeTheme} alt={t("settings.previewNamed", { name: t(`settings.character.${option.id}`) })} sizes="(max-width: 639px) 42vw, 180px" /></span>
                        <span className="settings-v2-choice-label">{t(`settings.character.${option.id}`)}</span>
                      </RadioOption>
                    );
                  })}
                </RadioGroup>
              </div>
            </div>

            <div className="ui-group-block settings-v2-block" id="settings-app-icon">
              <h3 className="ui-group-title" id="settings-app-icon-heading" tabIndex={-1}>{t("settings.appIcon")}</h3>
              <div className="ui-group settings-v2-pad">
                <RadioGroup className="app-icon-grid settings-v2-icons" label={t("settings.appIconChoices")} value={settings.appIcon} onChange={(next) => saveSettings({ ...settings, appIcon: next }, `app-icon-${next}`)}>
                  {appIconOptions.map((option) => {
                    return (
                      <RadioOption
                        className="settings-v2-icon-option"
                        key={option.id}
                        value={option.id}
                      >
                        <img src={assetPath(option.preview)} alt="" />
                        <span>{t(`settings.appIcon.${option.id}`)}</span>
                      </RadioOption>
                    );
                  })}
                </RadioGroup>
              </div>
              <p className="ui-group-footer">{t("settings.appIconPlatformNote")}</p>
            </div>
          </section>}

          {activeSection === "notifications" && <section className="settings-v2-section" id="settings-notifications" aria-labelledby="settings-notifications-heading">
            <div className="ui-group-block settings-v2-block" id="settings-reminder">
              <h3 className="ui-group-title" id="settings-reminder-heading" tabIndex={-1}>{t("settings.studyReminder")}</h3>
              <div className="ui-group">
                <div className="ui-row">
                  <span className="ui-row-body"><label htmlFor="settings-reminder-toggle">{t("settings.dailyStudyReminder")}</label></span>
                  <Switch id="settings-reminder-toggle" checked={reminderSettings.enabled} busy={saving === "reminder-toggle"} onCheckedChange={(next) => saveReminder({ ...reminderSettings, enabled: next }, "reminder-toggle")} />
                </div>
                <div className="ui-row">
                  <span className="ui-row-body"><label htmlFor="settings-reminder-time">{t("settings.reminderTime")}</label></span>
                  <input id="settings-reminder-time" className="ui-row-input" type="time" value={reminderSettings.time} onChange={(event) => saveReminder({ ...reminderSettings, time: event.target.value }, "reminder-time")} />
                </div>
                <button type="button" className="ui-row settings-v2-action" onClick={testReminder}>
                  <span className="ui-row-body"><span>{t("settings.testReminder")}</span></span>
                </button>
              </div>
              <p className="ui-group-footer">{t("settings.reminderHint")}</p>
            </div>
            {isAdministrator && <NotificationPreferences />}
          </section>}

          {activeSection === "offline" && user?.id && <OfflineSettings userId={user.id} />}

          {saving && <p className="save-hint settings-v2-saving" role="status">{t("settings.saving")}</p>}
        </div>
      </section>
    </Page>
  );
}

/** The account's own row at the top, the way a settings app opens on "you". */
function AccountSummary({ user }) {
  const { t } = useI18n();
  return <div className="ui-group settings-v2-profile">
    <Link className="ui-row" to="/profile">
      <UserAvatar user={user} className="settings-v2-avatar" loading="eager" />
      <span className="ui-row-body">
        <strong dir="auto">{user?.full_name || user?.username || t("common.account")}</strong>
        <small dir="auto">{user?.email}</small>
      </span>
      <span className="ui-row-value">{t("settings.viewProfile")}</span>
      <Icon className="ui-row-chevron" name="chevron-right" size={17} />
    </Link>
  </div>;
}

function AccountSubscriptionGroup() {
  const { t } = useI18n();
  const { subscription } = useSubscriptionSession();
  return <div className="ui-group-block settings-v2-block">
    <h3 className="ui-group-title">{t("subscription.title")}</h3>
    <div className="ui-group">
      <Link className="ui-row" to="/subscription">
        <span className="ui-row-icon"><Icon name="coins" size={17} /></span>
        <span className="ui-row-body">
          <strong dir="auto">{subscription?.plan_title || t("subscription.noPlan")}</strong>
          <SubscriptionStatus subscription={subscription} compact />
        </span>
        <Icon className="ui-row-chevron" name="chevron-right" size={17} />
      </Link>
    </div>
  </div>;
}

function UsernameCard({ user, onUserUpdate }) {
  const { t } = useI18n();
  const [username, setUsername] = useState(user?.username || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState("");

  useEffect(() => setUsername(user?.username || ""), [user?.username]);

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage("");
    try {
      const updated = await accountsApi.updateProfile({ username: username.trim() });
      onUserUpdate(updated);
      setUsername(updated.username || "");
      setMessage(t("settings.usernameUpdated"));
    } catch (requestError) {
      setError(requestError);
    } finally {
      setSaving(false);
    }
  }

  const unchanged = username.trim() === (user?.username || "");

  return (
    <div className="ui-group-block settings-v2-block" id="settings-username">
      <h3 className="ui-group-title" id="settings-username-heading" tabIndex={-1}>{t("settings.changeUsername")}</h3>
      <form className="ui-group settings-v2-form" onSubmit={submit}>
        <label className="field">
          <span>{t("auth.username")}</span>
          <input
            type="text"
            autoComplete="username"
            value={username}
            minLength={3}
            maxLength={30}
            pattern="[A-Za-z0-9][A-Za-z0-9_]{2,29}"
            required
            onChange={(event) => setUsername(event.target.value.toLowerCase())}
            {...fieldErrorAttributes(error, "username", "settings-username-error")}
          />
          <small>{t("settings.usernameHint")}</small>
          <AccountFieldErrors error={error} field="username" id="settings-username-error" />
        </label>
        <AccountFieldErrors error={error} />
        <div className="settings-v2-form-actions">
          <span role="status">{message}</span>
          <button className="btn btn-primary compact" type="submit" aria-busy={saving || undefined} disabled={saving || !username.trim() || unchanged}>
            {saving ? t("settings.saving") : t("settings.saveUsername")}
          </button>
        </div>
      </form>
    </div>
  );
}

function PasswordCard({ id, headingId }) {
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

  return <div className="ui-group-block settings-v2-block" id={id}>
    <h3 className="ui-group-title" id={headingId} tabIndex={-1}>{t("settings.changePassword")}</h3>
    <form className="ui-group settings-v2-form" onSubmit={submit}>
      <label className="field"><span>{t("settings.currentPassword")}</span><input type="password" autoComplete="current-password" value={form.currentPassword} onChange={(event) => setForm({ ...form, currentPassword: event.target.value })} required {...fieldErrorAttributes(error, "current_password", "settings-current-password-error")} /><AccountFieldErrors error={error} field="current_password" id="settings-current-password-error" /></label>
      <label className="field"><span>{t("settings.newPassword")}</span><input type="password" autoComplete="new-password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} required {...fieldErrorAttributes(error, "new_password", "settings-new-password-error")} /><AccountFieldErrors error={error} field="new_password" id="settings-new-password-error" /></label>
      <label className="field"><span>{t("settings.confirmNewPassword")}</span><input type="password" autoComplete="new-password" value={form.passwordConfirm} onChange={(event) => setForm({ ...form, passwordConfirm: event.target.value })} required {...fieldErrorAttributes(error, "new_password_confirm", "settings-confirm-password-error")} /><AccountFieldErrors error={error} field="new_password_confirm" id="settings-confirm-password-error" /></label>
      <AccountFieldErrors error={error} />
      <div className="settings-v2-form-actions">
        <span role="status">{message}</span>
        <button className="btn btn-primary compact" type="submit" aria-busy={saving || undefined} disabled={saving}>{saving ? t("settings.updatingPassword") : t("settings.updatePassword")}</button>
      </div>
    </form>
  </div>;
}

function AccountDeletionCard({ confirmationToken, onConfirmationHandled }) {
  const { t } = useI18n();
  const [state, setState] = useState({ loading: true, status: "not_requested", request: null });
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState("");
  const [open, setOpen] = useState(Boolean(confirmationToken));

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
  // A request in progress is always shown; otherwise the destructive form
  // waits behind one deliberate tap instead of sitting open on the page.
  const expanded = open || isOpen || Boolean(error);

  return <div className="ui-group-block settings-v2-block account-deletion-card">
    <h3 className="ui-group-title">{t("settings.dataRights")}</h3>
    <div className="ui-group">
      <button type="button" className="ui-row is-danger" aria-expanded={expanded} aria-controls="settings-deletion-form" onClick={() => setOpen((value) => !value)}>
        <span className="ui-row-body"><strong>{t("settings.deleteAccount")}</strong></span>
        <span className="ui-row-value" role="status">{state.loading ? t("settings.deletionChecking") : statusLabel}</span>
        <Icon className="ui-row-chevron settings-v2-disclosure" name="chevron-down" size={17} />
      </button>
      {expanded && <div className="settings-v2-form settings-v2-form--inset" id="settings-deletion-form">
        <p className="settings-v2-note">{t("settings.deletionDescription")}</p>
        {state.status === "confirmed" && !state.request?.policy_version && <p className="form-notice" role="alert">{t("settings.deletionPolicyPending")}</p>}
        <label className="field"><span>{t("settings.currentPassword")}</span><input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy || state.loading || state.status === "processing" || state.status === "completed"} /></label>
        <AccountFieldErrors error={error} />
        {message && <p className="save-hint" role="status">{message}</p>}
        <div className="settings-v2-form-actions">
          <span />
          {isOpen ? <button className="btn btn-outline compact" type="button" onClick={() => void submit("cancel")} disabled={!password || busy}>{t("settings.cancelDeletion")}</button> : <button className="btn btn-danger compact" type="button" aria-busy={busy || undefined} onClick={() => void submit("request")} disabled={!password || busy || state.loading || state.status === "completed"}>{busy ? t("settings.submittingDeletion") : t("settings.requestDeletion")}</button>}
        </div>
      </div>}
    </div>
  </div>;
}

/**
 * The interface language lived only on the sign-in screen and inside a tab on
 * the profile, so a reader who had already signed in had nowhere obvious to
 * change it. It belongs beside the other appearance settings.
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

  return <div className="ui-group-block settings-v2-block" id="settings-language">
    <h3 className="ui-group-title">{t("settings.language")}</h3>
    <div className="ui-group">
      <div className="ui-row">
        <span className="ui-row-icon"><Icon name="globe" size={17} /></span>
        <span className="ui-row-body"><label htmlFor="settings-language-select">{t("settings.interfaceLanguage")}</label></span>
        <select id="settings-language-select" className="ui-row-input settings-v2-select" value={locale} disabled={saving} onChange={(event) => { void change(event.target.value); }} {...fieldErrorAttributes(error, "preferred_language", "settings-language-error")}>
          <option value="en">English</option>
          <option value="ar">العربية</option>
        </select>
      </div>
    </div>
    <AccountFieldErrors error={error} field="preferred_language" id="settings-language-error" />
    <AccountFieldErrors error={error} />
    {message && <p className="ui-group-footer" role="status">{message}</p>}
  </div>;
}

function ConnectedAccountsCard({ email }) {
  const { t } = useI18n();
  const providers = [
    { id: "email", icon: "lock", title: t("settings.emailPassword"), detail: email || t("settings.primarySignIn"), value: t("settings.primary") },
    { id: "google", icon: "globe", title: "Google", detail: t("settings.providerLinkingDisabled"), value: t("settings.notConnected") },
    { id: "apple", icon: "user", title: "Apple", detail: t("settings.providerLinkingDisabled"), value: t("settings.notConnected") }
  ];
  return <div className="ui-group-block settings-v2-block">
    <h3 className="ui-group-title">{t("settings.connectedAccounts")}</h3>
    <ul className="ui-group">
      {providers.map((provider) => <li key={provider.id} className="ui-row">
        <span className="ui-row-icon"><Icon name={provider.icon} size={17} /></span>
        <span className="ui-row-body"><strong>{provider.title}</strong><small dir="auto">{provider.detail}</small></span>
        <span className="ui-row-value">{provider.value}</span>
      </li>)}
    </ul>
  </div>;
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
    <div className="ui-group-block settings-v2-block">
      <h3 className="ui-group-title">{t("settings.serverNotifications")}</h3>
      {preferenceData.loading && <p className="ui-group-footer">{t("settings.loadingNotifications")}</p>}
      {preferenceData.error && <ErrorPanel message={preferenceData.error} onRetry={preferenceData.reload} />}
      {error && <ErrorPanel message={error} onRetry={preferenceData.reload} />}
      {!preferenceData.loading && !preferenceData.error && <div className="ui-group">
        {!preferences.length && <p className="ui-row">{t("settings.noNotificationCategories")}</p>}
        {preferences.map((preference, index) => {
          const unavailable = !preference.available;
          const locked = preference.required;
          const key = `${preference.category}-${preference.channel}`;
          const label = t("settings.notificationToggleLabel", { category: preference.category, channel: preference.channel.replace("_", " ") });
          return (
            <div className="ui-row" key={key}>
              <span className="ui-row-body"><strong dir="auto">{preference.category} · {preference.channel.replace("_", " ")}</strong><small>{t(locked ? "settings.alwaysOn" : unavailable ? "settings.channelUnavailable" : preference.enabled ? "settings.enabled" : "settings.disabled")}</small></span>
              <Switch label={label} checked={preference.enabled} busy={saving === key} onCheckedChange={() => { void togglePreference(index); }} disabled={locked || unavailable || Boolean(saving)} />
            </div>
          );
        })}
      </div>}
      <p className="ui-group-footer">{t("settings.serverNotificationsHint")}</p>
    </div>
  );
}
