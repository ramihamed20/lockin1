import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { authApi } from "../lib/api.js";
import { useSubscriptionSession } from "../lib/SubscriptionSessionContext.jsx";
import { formatDateTime } from "../lib/i18n.js";
import { assetPath, autoThemeForDate, normalizeThemeSettings } from "../lib/utils.js";
import { defaultThemeSettings, themeOptions } from "../lib/constants.js";
import { useI18n } from "../components/I18nProvider.jsx";
import { ErrorPanel, LoadingPanel } from "../components/ui/index.jsx";

function initialPreferences(user, locale) {
  return {
    settings: normalizeThemeSettings(user?.themeSettings || defaultThemeSettings),
    language: user?.preferredLanguage || locale
  };
}

export default function WelcomeOnboarding({ user, onUserUpdate, onThemeSettingsChange }) {
  const navigate = useNavigate();
  const { direction, locale, setLocale, t } = useI18n();
  const subscriptionSession = useSubscriptionSession();
  const [preferences, setPreferences] = useState(() => initialPreferences(user, locale));
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");
  const previewTheme = preferences.settings.autoTheme
    ? autoThemeForDate()
    : preferences.settings.theme;

  function chooseSettings(nextSettings) {
    const settings = normalizeThemeSettings(nextSettings);
    setPreferences((current) => ({ ...current, settings }));
    onThemeSettingsChange?.(settings);
  }

  function chooseLanguage(language) {
    setPreferences((current) => ({ ...current, language }));
    setLocale(language);
  }

  async function continueTo(destination) {
    if (pending) return;
    setPending(destination);
    setError("");
    try {
      const updatedUser = await authApi.completeWelcome({
        // Mascot choice is intentionally absent from first-run UI. Preserve
        // the existing profile value so this redesign cannot reset it.
        mascotPreference: preferences.settings.character,
        themePreference: preferences.settings.theme,
        dynamicTheme: preferences.settings.autoTheme,
        preferredLanguage: preferences.language
      });
      onUserUpdate(updatedUser);
      onThemeSettingsChange?.(updatedUser.themeSettings);
      navigate(destination, { replace: true });
    } catch (requestError) {
      setError(requestError.message || t("welcome.error"));
    } finally {
      setPending("");
    }
  }

  if (!subscriptionSession.ready) return <LoadingPanel />;
  if (subscriptionSession.error || !subscriptionSession.subscription) {
    return <ErrorPanel message={subscriptionSession.error || t("welcome.error")} onRetry={subscriptionSession.refresh} />;
  }

  const { trial_started_at: trialStart, trial_ends_at: trialEnd } = subscriptionSession.subscription;
  const trialSpan = Date.parse(trialEnd || "") - Date.parse(trialStart || "");
  const trialDays = Number.isFinite(trialSpan) && trialSpan > 0
    ? Math.round(trialSpan / 86_400_000)
    : 7;

  return (
    <main className="welcome-onboarding" data-preview-theme={previewTheme} dir={direction}>
      <div className="welcome-onboarding-shell">
        <header className="welcome-onboarding-header">
          <span className="welcome-brand">
            <img src={assetPath("/icons/lockin-light-192-v2.png")} width="40" height="40" alt="" />
            <strong>Lock-in</strong>
          </span>
          <span className="welcome-trial-badge">{t("subscription.freeTrial")} · {t("welcome.trialLength", { count: trialDays })}</span>
        </header>

        <section className="welcome-onboarding-content" aria-labelledby="welcome-title">
          <div className="welcome-intro">
            <h1 id="welcome-title">{t("welcome.title")}</h1>
            <p>{t("welcome.themeLead")}</p>
          </div>

          <fieldset className="welcome-choice-group welcome-theme-group" role="radiogroup" aria-label={t("welcome.theme")}>
            <legend>{t("welcome.theme")}</legend>
            <div className="welcome-theme-options">
              {themeOptions.map((option) => {
                const selected = !preferences.settings.autoTheme && preferences.settings.theme === option.id;
                return (
                  <button
                    className={`welcome-theme-choice ${option.id} ${selected ? "selected" : ""}`}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    key={option.id}
                    onClick={() => chooseSettings({ ...preferences.settings, theme: option.id, autoTheme: false })}
                  >
                    <span className="welcome-theme-sample" aria-hidden="true"><span /></span>
                    <span className="welcome-theme-label">
                      <strong>{t(`welcome.theme.${option.id}`)}</strong>
                      <small>{option.time}</small>
                    </span>
                    <span className="welcome-selection-mark" aria-hidden="true">✓</span>
                  </button>
                );
              })}
            </div>
            <button
              className={`welcome-auto-theme ${preferences.settings.autoTheme ? "selected" : ""}`}
              type="button"
              role="radio"
              aria-checked={preferences.settings.autoTheme}
              onClick={() => chooseSettings({ ...preferences.settings, autoTheme: true })}
            >
              <span><strong>{t("welcome.dynamicTheme")}</strong><small>{t("welcome.dynamicThemeHint")}</small></span>
              <span className="welcome-auto-state" aria-hidden="true">{preferences.settings.autoTheme ? "✓" : ""}</span>
            </button>
          </fieldset>

          <div className="welcome-preference-row">
            <fieldset className="welcome-choice-group welcome-language-group" role="radiogroup" aria-label={t("welcome.language")}>
              <legend>{t("welcome.language")}</legend>
              <div className="welcome-language-options">
                <button className={preferences.language === "en" ? "selected" : ""} type="button" role="radio" aria-checked={preferences.language === "en"} onClick={() => chooseLanguage("en")}>{t("welcome.english")}</button>
                <button className={preferences.language === "ar" ? "selected" : ""} type="button" role="radio" aria-checked={preferences.language === "ar"} onClick={() => chooseLanguage("ar")}>{t("welcome.arabic")}</button>
              </div>
            </fieldset>

            <dl className="welcome-trial-facts">
              <div><dt>{t("welcome.access")}</dt><dd>{t("welcome.trialLength", { count: trialDays })}</dd></div>
              <div><dt>{t("welcome.expires")}</dt><dd>{formatDateTime(trialEnd)}</dd></div>
            </dl>
          </div>

          {error && <p className="form-alert error" role="alert">{error}</p>}
        </section>

        <footer className="welcome-actions">
          <button className="btn btn-primary" type="button" disabled={Boolean(pending)} onClick={() => void continueTo("/dashboard")}>{pending === "/dashboard" ? t("welcome.starting") : t("welcome.start")}</button>
          <button className="welcome-subscribe-link" type="button" disabled={Boolean(pending)} onClick={() => void continueTo("/subscription")}>{pending === "/subscription" ? t("welcome.opening") : t("welcome.subscribe")}</button>
        </footer>
      </div>
    </main>
  );
}
