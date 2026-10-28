import EmailChangeSettings from "../components/settings/EmailChangeSettings.jsx";
import AccountDataExport from "../components/settings/AccountDataExport.jsx";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { accountsApi } from "../api/accounts.js";
import { motivationApi } from "../api/motivation.js";
import { Icon } from "../lib/icons.jsx";
import { useSubscriptionSession } from "../lib/SubscriptionSessionContext.jsx";
import { appIconOptions, characterOptions, themeOptions } from "../lib/constants.js";
import { assetPath, normalizeThemeSettings } from "../lib/utils.js";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { AccountFieldErrors, AccountFormAlert, fieldErrorAttributes } from "../components/account/AccountFormErrors.jsx";
import { normalizeAuthError } from "../lib/authValidation.js";
import { useI18n } from "../components/I18nProvider.jsx";
import PaymentHistory from "../components/settings/PaymentHistory.jsx";
import { SETTINGS_SECTIONS, resolveSettingsSection, searchSettingsSections } from "../lib/settingsNavigation.js";
import { SessionList } from "../components/account/SessionList.jsx";
import { SubscriptionStatus } from "../components/subscription/SubscriptionStatus.jsx";
import { UserAvatar } from "../components/shared/UserAvatar.jsx";
import { Page, ErrorPanel, RadioGroup, RadioOption, Switch } from "../components/ui/index.jsx";
import { ResponsiveThemePreview } from "../components/shared/ResponsiveThemePreview.jsx";
import OfflineSettings from "../offline/OfflineSettings.jsx";
import StudyReminderSettings from "../pwa/StudyReminderSettings.jsx";
import DevicePushSettings from "../pwa/DevicePushSettings.jsx";
import AppUpdateSettings from "../pwa/AppUpdateSettings.jsx";
import FeedbackSettings from "./Feedback.jsx";
import AddedSubjectsSettings, { canAddSubjects } from "../components/learning/AddedSubjectsSettings.jsx";
import PublicKnowledgeSettings from "./PublicKnowledgeSettings.jsx";
import { BUILD_INFO } from "../pwa/buildInfo.js";
import { UPDATE_STATUS } from "../pwa/updateManager.js";
import { usePwaUpdates } from "../pwa/usePwaUpdates.js";

/**
 * Settings is organised the way a native settings app is: a short list of
 * sections, each a page of grouped rows. On phones and tablets the list is its
 * own screen and a section opens over it with a way back; on wide screens the
 * list stays beside the open section.
 *
 * Earlier links name the six sections the page used to have. They still work:
 * each one opens the section that now holds it and scrolls to its group.
 */
const SECTIONS = SETTINGS_SECTIONS;
const DEFAULT_WIDE_SECTION = "account";

export default function Settings({ user, onUserUpdate, settings, activeTheme, onSettingsChange, onSignedOut }) {
  const { t } = useI18n();
  const location = useLocation();
  const navigate = useNavigate();
  const savingRef = useRef(false);
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const { status: updateStatus } = usePwaUpdates();
  const searchParameters = new URLSearchParams(location.search);
  const requestedSection = searchParameters.get("section") || "";
  const deletionToken = searchParameters.get("token") || "";
  const resolved = resolveSettingsSection(requestedSection, deletionToken, searchParameters.get("focus"));
  // With no section named, a phone shows the list; a wide screen shows the
  // list beside the default section. CSS decides which of the two is visible.
  const activeSection = resolved.section || DEFAULT_WIDE_SECTION;
  const view = resolved.section ? "detail" : "root";

  const handleDeletionConfirmation = useCallback(() => {
    const search = new URLSearchParams(location.search);
    search.delete("token");
    search.set("section", "privacy");
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
    const heading = document.getElementById(`${focusTarget || `settings-${resolved.section}`}-heading`) || document.getElementById(`settings-${resolved.section}-heading`);
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
    if (savingRef.current) return;
    const normalized = normalizeThemeSettings(nextSettings);
    const previous = normalizeThemeSettings(settings);
    onSettingsChange(normalized);
    setError("");
    if (source.startsWith("app-icon-")) return;
    savingRef.current = true;
    setSaving(source);
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
      savingRef.current = false;
      setSaving("");
    }
  }

  const themeValue = settings.autoTheme
    ? t("settings.autoThemeValue", { name: t(`settings.theme.${activeTheme}`) })
    : t(`settings.theme.${settings.theme}`);
  const sectionValues = {
    account: user?.username || "",
    appearance: themeValue,
    notifications: "",
    offline: "",
    suggest: "",
    updates: updateStatus === UPDATE_STATUS.AVAILABLE || updateStatus === UPDATE_STATUS.RELOAD_REQUIRED
      ? t("settings.updates.availableShort")
      : BUILD_INFO.version
  };
  const visibleSections = searchSettingsSections(SECTIONS.filter(section => section.id !== "subjects" || canAddSubjects(user)), query, t);
  const sectionTitle = t(SECTIONS.find((entry) => entry.id === activeSection)?.labelKey || "settings.pageTitle");

  return (
    <Page title={t("settings.pageTitle")} headingHandled>
      <section className="settings-v2" data-view={view} data-active-section={activeSection}>
        <h1 className="visually-hidden" dir="auto">{t("settings.pageTitle")}</h1>

        <nav className="settings-v2-nav" aria-label={t("settings.sectionsLabel")}>
          <AccountSummary user={user} />
          <div className="settings-search">
            <Icon name="search" size={18} />
            <input type="search" aria-label={t("settings.search")} placeholder={t("settings.searchPlaceholder")} value={query} onChange={event => setQuery(event.target.value)} />
            {query && <button type="button" aria-label={t("settings.searchClear")} onClick={() => setQuery("")}><Icon name="x" size={16} /></button>}
          </div>
          {query && !visibleSections.length && <p className="ui-group-footer" role="status">{t("settings.searchEmpty")}</p>}
          {["account", "preferences", "help"].map(group => visibleSections.some(section => section.group === group) && <div className="ui-group-block settings-nav-group" key={group}>
          <ul className="ui-group" aria-label={t(`settings.group.${group}`)}>
            {visibleSections.filter(section => section.group === group).map((section) => {
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
          </div>)}
          <p className="settings-version" dir="ltr">Lockin · {BUILD_INFO.version}</p>
        </nav>

        <div className="settings-v2-detail" id="settings-v2-detail">
          <header className="settings-v2-detail-head">
            <button type="button" className="settings-v2-back" onClick={backToList}>
              <Icon name="chevron-left" size={20} />
              <span>{t("settings.pageTitle")}</span>
            </button>
            <h2 id={`settings-${activeSection}-heading`} tabIndex={-1} dir="auto">{sectionTitle}</h2>
          </header>

          {error && <ErrorPanel message={error} />}

          {activeSection === "account" && <section className="settings-v2-section" id="settings-account" aria-labelledby="settings-account-heading">
            <AccountSummary user={user} />
            <UsernameCard user={user} onUserUpdate={onUserUpdate} />
            <div className="ui-group">
              {["security", "devices", "billing", "privacy"].map(id => <button type="button" className="ui-row" key={id} onClick={() => openSection(id)}>
                <span className={`ui-row-icon settings-v2-icon settings-v2-icon--${id}`}><Icon name={SECTIONS.find(section => section.id === id).icon} size={18} /></span>
                <span className="ui-row-body"><strong>{t(SECTIONS.find(section => section.id === id).labelKey)}</strong></span>
                <Icon className="ui-row-chevron" name="chevron-right" size={17} />
              </button>)}
            </div>
          </section>}

          {activeSection === "security" && <section className="settings-v2-section" id="settings-security" aria-labelledby="settings-security-heading">
            <PasswordCard id="settings-password" headingId="settings-password-heading" />
            <EmailChangeSettings key={user?.id} email={user?.email} />
          </section>}

          {activeSection === "devices" && <section className="settings-v2-section" id="settings-devices" aria-labelledby="settings-devices-heading">
            <SessionList key={user?.id} onCurrentSessionRevoked={onSignedOut} />
          </section>}

          {activeSection === "billing" && <section className="settings-v2-section" id="settings-billing" aria-labelledby="settings-billing-heading">
            <AccountSubscriptionGroup />
            <PaymentHistory key={user?.id} userId={user?.id} />
          </section>}

          {activeSection === "privacy" && <section className="settings-v2-section" id="settings-privacy" aria-labelledby="settings-privacy-heading">
            <AccountDeletionCard key={user?.id} confirmationToken={deletionToken} onConfirmationHandled={handleDeletionConfirmation} />
            <div className="ui-group-block settings-v2-block"><h3 className="ui-group-title">{t("settings.privacyPolicies")}</h3><div className="ui-group">
              {[["/privacy", "settings.privacyPolicy"], ["/terms", "settings.termsPolicy"], ["/refunds", "settings.refundPolicy"]].map(([to, key]) => <Link className="ui-row" to={to} key={to}><span className="ui-row-body">{t(key)}</span><Icon name="chevron-right" className="ui-row-chevron" size={17} /></Link>)}
            </div></div>
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
                        disabled={settings.autoTheme || Boolean(saving)}
                      >
                        <span className="settings-v2-choice-art"><img src={assetPath(option.preview)} alt={t("settings.themePreviewNamed", { name: t(`settings.theme.${option.id}`) })} width="640" height="640" loading="lazy" decoding="async" /></span>
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
                  <Switch id="settings-auto-theme" disabled={Boolean(saving)} checked={settings.autoTheme} busy={saving === "auto"} onCheckedChange={(next) => saveSettings({ ...settings, autoTheme: next }, "auto")} />
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
                        disabled={Boolean(saving)}
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
                        disabled={Boolean(saving)}
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
            <DevicePushSettings key={`push-${user?.id}`} userId={user?.id} />
            <StudyReminderSettings key={user?.id} userId={user?.id} />
            <NotificationPreferences userId={user?.id} />
          </section>}

          {activeSection === "offline" && user?.id && <OfflineSettings userId={user.id} />}

          {activeSection === "subjects" && canAddSubjects(user) && <AddedSubjectsSettings />}

          {activeSection === "suggest" && <FeedbackSettings />}

          {activeSection === "updates" && <AppUpdateSettings user={user} />}

          {["about", "support"].includes(activeSection) && <PublicKnowledgeSettings section={activeSection} />}

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
        <strong dir="auto">{user?.name || user?.full_name || user?.username || t("common.account")}</strong>
        <small dir="auto">{user?.email}</small>
      </span>
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
          <strong dir="auto">{subscription?.plan_title || subscription?.plan?.title || t(subscription ? "settings.currentSubscription" : "subscription.noPlan")}</strong>
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
      setError(normalizeAuthError(requestError, { t, mode: "complete" }));
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
        <AccountFormAlert error={error} />
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
      setError(normalizeAuthError(requestError, { t, mode: "password_change" }));
    } finally {
      setSaving(false);
    }
  }

  return <div className="ui-group-block settings-v2-block" id={id}>
    <h3 className="ui-group-title" id={headingId} tabIndex={-1}>{t("settings.changePassword")}</h3>
    <form className="ui-group settings-v2-form" onSubmit={submit}>
      <label className="field"><span>{t("settings.currentPassword")}</span><input type="password" autoComplete="current-password" value={form.currentPassword} onChange={(event) => setForm((current) => ({ ...current, currentPassword: event.target.value }))} required {...fieldErrorAttributes(error, "current_password", "settings-current-password-error")} /><AccountFieldErrors error={error} field="current_password" id="settings-current-password-error" /></label>
      <label className="field"><span>{t("settings.newPassword")}</span><input type="password" autoComplete="new-password" value={form.password} onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))} required {...fieldErrorAttributes(error, "new_password", "settings-new-password-error")} /><AccountFieldErrors error={error} field="new_password" id="settings-new-password-error" /></label>
      <label className="field"><span>{t("settings.confirmNewPassword")}</span><input type="password" autoComplete="new-password" value={form.passwordConfirm} onChange={(event) => setForm((current) => ({ ...current, passwordConfirm: event.target.value }))} required {...fieldErrorAttributes(error, "new_password_confirm", "settings-confirm-password-error")} /><AccountFieldErrors error={error} field="new_password_confirm" id="settings-confirm-password-error" /></label>
      <AccountFormAlert error={error} />
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
      setError(normalizeAuthError(requestError, { t, mode: "deletion" }));
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

  return <div className="ui-group-block settings-v2-block account-deletion-card" id="settings-deletion">
    <h3 className="ui-group-title" id="settings-deletion-heading" tabIndex={-1}>{t("settings.dataRights")}</h3>
    <AccountDataExport />
    <div className="ui-group">
      <button type="button" className="ui-row is-danger" aria-expanded={expanded} aria-controls="settings-deletion-form" onClick={() => setOpen((value) => !value)}>
        <span className="ui-row-icon"><Icon name="trash" size={18} /></span><span className="ui-row-body"><strong>{t("settings.deleteAccount")}</strong></span>
        <span className="ui-row-value" role="status">{state.loading ? t("settings.deletionChecking") : statusLabel}</span>
        <Icon className="ui-row-chevron settings-v2-disclosure" name="chevron-down" size={17} />
      </button>
      {expanded && <div className="settings-v2-form settings-v2-form--inset" id="settings-deletion-form">
        <p className="settings-v2-note">{t("settings.deletionDescription")}</p>
        <p className="settings-v2-note">{t("settings.deletionNotice")}</p>
        {state.request?.processing_note && <p className="form-notice" role="status">{state.request.processing_note}</p>}
        {state.status === "confirmed" && !state.request?.policy_version && <p className="form-notice" role="alert">{t("settings.deletionPolicyPending")}</p>}
        <label className="field"><span>{t("settings.currentPassword")}</span><input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy || state.loading || state.status === "processing" || state.status === "completed"} /></label>
        {/* The status load keeps its raw error (its effect must not re-run on a
            language change -- it may spend a single-use link), so it is put
            into words here. */}
        <AccountFormAlert error={error instanceof Error ? normalizeAuthError(error, { t, mode: "deletion" }) : error} />
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
      setError(normalizeAuthError(requestError, { t }));
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
    <AccountFormAlert error={error} />
    {message && <p className="ui-group-footer" role="status">{message}</p>}
  </div>;
}

function NotificationPreferences({ userId }) {
  const { t } = useI18n();
  const preferenceData = useAsyncData(() => motivationApi.notificationPreferences(), [userId]);
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
        {[...new Set(preferences.map(preference => preference.category))].map(category => <div className="settings-notification-category" key={category}>
          <h4 className="settings-notification-category-title">{t(`notifications.category.${category}`)}</h4>
        {preferences.filter(preference => preference.category === category).map((preference) => {
          const index = preferences.indexOf(preference);
          const unavailable = !preference.available;
          const locked = preference.required;
          const key = `${preference.category}-${preference.channel}`;
          const label = t("settings.notificationToggleLabel", { category: t(`notifications.category.${preference.category}`), channel: t(`notifications.channel.${preference.channel}`) });
          return (
            <div className="ui-row" key={key}>
              <span className="ui-row-body"><label htmlFor={`notification-${key}`} dir="auto">{t(`notifications.channel.${preference.channel}`)}</label><small>{t(locked ? "settings.alwaysOn" : unavailable ? "settings.channelUnavailable" : preference.enabled ? "settings.enabled" : "settings.disabled")}</small></span>
              <Switch id={`notification-${key}`} label={label} checked={preference.enabled} busy={saving === key} onCheckedChange={() => { void togglePreference(index); }} disabled={locked || unavailable || Boolean(saving)} />
            </div>
          );
        })}
        </div>)}
      </div>}
      <p className="ui-group-footer">{t("settings.serverNotificationsHint")}</p>
    </div>
  );
}
