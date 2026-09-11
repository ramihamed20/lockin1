import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { authApi } from "../lib/api.js";
import { useSubscriptionSession } from "../lib/SubscriptionSessionContext.jsx";
import { formatDateTime } from "../lib/i18n.js";
import { assetPath, autoThemeForDate, normalizeThemeSettings } from "../lib/utils.js";
import { characterOptions, defaultThemeSettings, themeOptions } from "../lib/constants.js";
import { useI18n } from "../components/I18nProvider.jsx";
import { ResponsiveThemePreview } from "../components/shared/ResponsiveThemePreview.jsx";
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

  function useDefaults() {
    chooseSettings(defaultThemeSettings);
    chooseLanguage("en");
  }

  async function continueTo(destination) {
    if (pending) return;
    setPending(destination);
    setError("");
    try {
      const updatedUser = await authApi.completeWelcome({
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

  return (
    <main className="welcome-onboarding" dir={direction}>
      <section className="welcome-onboarding-copy" aria-labelledby="welcome-title">
        <img className="welcome-onboarding-mark" src={assetPath("/icons/lockin-light-192-v2.png")} width="56" height="56" alt="" />
        <div>
          <p className="welcome-kicker">Lock-in</p>
          <h1 id="welcome-title">{t("welcome.title")}</h1>
          <p className="welcome-lead">{t("welcome.lead")}</p>
        </div>
        <dl className="welcome-trial-facts">
          <div><dt>{t("welcome.access")}</dt><dd>{t("welcome.sevenDays")}</dd></div>
          <div><dt>{t("welcome.expires")}</dt><dd>{formatDateTime(subscriptionSession.subscription.trial_ends_at)}</dd></div>
        </dl>
        <section className="welcome-personalization" aria-labelledby="welcome-personalization-title">
          <div className="welcome-personalization-head">
            <div>
              <p className="welcome-kicker">{t("welcome.personalizeKicker")}</p>
              <h2 id="welcome-personalization-title">{t("welcome.personalizeTitle")}</h2>
              <p>{t("welcome.personalizeLead")}</p>
            </div>
            <div className="welcome-live-preview">
              <ResponsiveThemePreview
                character={preferences.settings.character}
                theme={previewTheme}
                alt={t("welcome.previewAlt")}
                sizes="(max-width: 639px) 44vw, 180px"
              />
              <span>{t("welcome.livePreview")}</span>
            </div>
          </div>
          <fieldset className="welcome-choice-group">
            <legend>{t("welcome.mascot")}</legend>
            <div className="welcome-choice-row" role="radiogroup" aria-label={t("welcome.mascot")}>
              {characterOptions.map((option) => {
                const selected = preferences.settings.character === option.id;
                const label = option.id === "none" ? t("welcome.noMascot") : option.id === "black" ? t("welcome.blackCat") : t("welcome.whiteCat");
                return <button className={`welcome-choice ${selected ? "selected" : ""}`} type="button" role="radio" aria-checked={selected} key={option.id} onClick={() => chooseSettings({ ...preferences.settings, character: option.id })}>{label}</button>;
              })}
            </div>
          </fieldset>
          <fieldset className="welcome-choice-group">
            <legend>{t("welcome.theme")}</legend>
            <div className="welcome-theme-options" role="radiogroup" aria-label={t("welcome.theme")}>
              {themeOptions.map((option) => {
                const selected = !preferences.settings.autoTheme && preferences.settings.theme === option.id;
                return <button className={`welcome-theme-choice ${option.id} ${selected ? "selected" : ""}`} type="button" role="radio" aria-checked={selected} key={option.id} onClick={() => chooseSettings({ ...preferences.settings, theme: option.id, autoTheme: false })}><span>{option.label}</span></button>;
              })}
              <button className={`welcome-theme-choice dynamic ${preferences.settings.autoTheme ? "selected" : ""}`} type="button" role="radio" aria-checked={preferences.settings.autoTheme} onClick={() => chooseSettings({ ...preferences.settings, autoTheme: true })}><span>{t("welcome.dynamicTheme")}</span></button>
            </div>
          </fieldset>
          <fieldset className="welcome-choice-group">
            <legend>{t("welcome.language")}</legend>
            <div className="welcome-choice-row" role="radiogroup" aria-label={t("welcome.language")}>
              <button className={`welcome-choice ${preferences.language === "en" ? "selected" : ""}`} type="button" role="radio" aria-checked={preferences.language === "en"} onClick={() => chooseLanguage("en")}>{t("welcome.english")}</button>
              <button className={`welcome-choice ${preferences.language === "ar" ? "selected" : ""}`} type="button" role="radio" aria-checked={preferences.language === "ar"} onClick={() => chooseLanguage("ar")}>{t("welcome.arabic")}</button>
            </div>
          </fieldset>
          <button className="welcome-skip" type="button" onClick={useDefaults}>{t("welcome.useDefaults")}</button>
        </section>
        <p className="welcome-data-note">{t("welcome.saved")}</p>
        {error && <p className="form-alert error" role="alert">{error}</p>}
        <div className="welcome-actions">
          <button className="btn btn-primary" type="button" disabled={Boolean(pending)} onClick={() => void continueTo("/dashboard")}>{pending === "/dashboard" ? t("welcome.starting") : t("welcome.start")}</button>
          <button className="btn btn-outline" type="button" disabled={Boolean(pending)} onClick={() => void continueTo("/subscription")}>{pending === "/subscription" ? t("welcome.opening") : t("welcome.subscribe")}</button>
        </div>
      </section>
      <aside className="welcome-onboarding-visual" aria-hidden="true">
        {preferences.settings.character !== "none" && <img src={assetPath("/assets/mascot-study-640.webp")} alt="" width="640" height="640" />}
      </aside>
    </main>
  );
}
