import { useEffect, useState } from "react";
import { motivationApi } from "../api/motivation.js";
import { Icon } from "../lib/icons.jsx";
import { characterOptions, themeOptions } from "../lib/constants.js";
import { normalizeThemeSettings, normalizeReminderSettings, themePreview } from "../lib/utils.js";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { Page, ErrorPanel } from "../components/ui/index.jsx";

export default function Settings({ settings, activeTheme, reminderSettings, onReminderSettingsChange, onSettingsChange }) {
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const [reminderError, setReminderError] = useState("");

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
    new Notification("Dentify study reminder", {
      body: "This is a test reminder from Dentify."
    });
  }

  return (
    <Page title="Themes" subtitle="Choose your study character, time-of-day theme, and automatic schedule.">
      <section className="themes-page">
        {(error || reminderError) && <ErrorPanel message={error || reminderError} />}
        <article className="theme-section">
          <div className="theme-section-head">
            <div><p className="eyebrow">Section 1</p><h2>Character</h2></div>
            <span className="pill">{settings.character === "black" ? "Black Cat" : "White Cat"}</span>
          </div>
          <div className="character-grid">
            {characterOptions.map((option) => {
              const selected = settings.character === option.id;
              return (
                <button
                  className={`theme-card character-card ${selected ? "selected" : ""}`}
                  key={option.id}
                  onClick={() => saveSettings({ ...settings, character: option.id }, `character-${option.id}`)}
                  aria-pressed={selected}
                >
                  <img src={themePreview(option.id, activeTheme)} alt={`${option.label} preview`} />
                  <span>{option.label}</span>
                  {selected && <i><Icon name="check" size={18} /></i>}
                </button>
              );
            })}
          </div>
        </article>

        <article className="theme-section">
          <div className="theme-section-head">
            <div><p className="eyebrow">Section 2</p><h2>Choose Theme</h2></div>
            <span className="pill">{settings.autoTheme ? `Auto: ${activeTheme}` : themeOptions.find((theme) => theme.id === settings.theme)?.label}</span>
          </div>
          <div className={`theme-grid ${settings.autoTheme ? "manual-disabled" : ""}`}>
            {themeOptions.map((option) => {
              const selected = settings.theme === option.id && !settings.autoTheme;
              return (
                <button
                  className={`theme-card ${option.id} ${selected ? "selected" : ""}`}
                  key={option.id}
                  onClick={() => saveSettings({ ...settings, theme: option.id, autoTheme: false }, `theme-${option.id}`)}
                  disabled={settings.autoTheme}
                  aria-pressed={selected}
                >
                  <img src={themePreview(settings.character, option.id)} alt={`${option.label} theme preview`} />
                  <span>{option.label}</span>
                  <small>{option.time}</small>
                  {selected && <i><Icon name="check" size={18} /></i>}
                </button>
              );
            })}
          </div>
        </article>

        <article className="auto-theme-card">
          <div>
            <p className="eyebrow">Section 3</p>
            <h2>Auto Theme</h2>
            <p>Automatically switch themes based on the current time of day.</p>
          </div>
          <button
            className={`auto-toggle ${settings.autoTheme ? "on" : ""}`}
            onClick={() => saveSettings({ ...settings, autoTheme: !settings.autoTheme }, "auto")}
            aria-pressed={settings.autoTheme}
          >
            <span>{settings.autoTheme ? "ON" : "OFF"}</span>
            <i />
          </button>
          <div className="theme-schedule">
            {themeOptions.map((option) => <span key={option.id}><strong>{option.label}</strong>{option.time}</span>)}
          </div>
        </article>

        <article className="theme-section reminder-section">
          <div className="theme-section-head">
            <div>
              <p className="eyebrow">Section 4</p>
              <h2>Study Reminder</h2>
            </div>
            <span className={`pill ${reminderSettings.enabled ? "success" : ""}`}>{reminderSettings.enabled ? "Enabled" : "Off"}</span>
          </div>
          <div className="reminder-grid">
            <label className="field">
              <span>Reminder time</span>
              <input type="time" value={reminderSettings.time} onChange={(event) => saveReminder({ ...reminderSettings, time: event.target.value }, "reminder-time")} />
            </label>
            <button
              className={`auto-toggle ${reminderSettings.enabled ? "on" : ""}`}
              onClick={() => saveReminder({ ...reminderSettings, enabled: !reminderSettings.enabled }, "reminder-toggle")}
              aria-pressed={reminderSettings.enabled}
            >
              <span>{reminderSettings.enabled ? "ON" : "OFF"}</span>
              <i />
            </button>
            <button className="btn btn-soft" type="button" onClick={testReminder}>Test reminder</button>
          </div>
          <p className="save-hint">Dentify will ping once per day after the selected time while the app is open.</p>
        </article>

        <NotificationPreferences />
        <section className="settings-panel compact">
          <div className="settings-row"><div><h2>API mode</h2><p>Connected to the Django backend.</p></div><span className="pill success">Live</span></div>
        </section>
        {saving && <p className="save-hint">Saving theme settings...</p>}
      </section>
    </Page>
  );
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
      <p className="save-hint">These are Django notification-delivery preferences. Study reminders above remain device-local.</p>
      {preferenceData.loading && <p className="save-hint">Loading notification preferences…</p>}
      {preferenceData.error && <ErrorPanel message={preferenceData.error} onRetry={preferenceData.reload} />}
      {error && <ErrorPanel message={error} onRetry={preferenceData.reload} />}
      {!preferenceData.loading && !preferenceData.error && <section className="settings-panel compact">
        {!preferences.length && <p className="save-hint">Django has not made notification preference categories available for this account.</p>}
        {preferences.map((preference, index) => {
          const unavailable = !preference.available;
          const locked = preference.required;
          const isSaving = saving === `${preference.category}-${preference.channel}`;
          return (
            <div className="settings-row" key={`${preference.category}-${preference.channel}`}>
              <div><h2>{preference.category} · {preference.channel.replace("_", " ")}</h2><p>{locked ? "Required by Django" : unavailable ? "This delivery channel is not available yet" : preference.enabled ? "Enabled" : "Disabled"}</p></div>
              <button className={`auto-toggle ${preference.enabled ? "on" : ""}`} type="button" aria-pressed={preference.enabled} onClick={() => { void togglePreference(index); }} disabled={locked || unavailable || Boolean(saving)}><span>{isSaving ? "…" : preference.enabled ? "ON" : "OFF"}</span><i /></button>
            </div>
          );
        })}
      </section>}
    </article>
  );
}
