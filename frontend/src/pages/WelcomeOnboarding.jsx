import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { billingApi } from "../api/billing.js";
import { authApi } from "../lib/api.js";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { formatDateTime } from "../lib/i18n.js";
import { assetPath } from "../lib/utils.js";
import { useI18n } from "../components/I18nProvider.jsx";
import { ErrorPanel, LoadingPanel } from "../components/ui/index.jsx";

export default function WelcomeOnboarding({ onUserUpdate }) {
  const navigate = useNavigate();
  const { direction, t } = useI18n();
  const subscription = useAsyncData(() => billingApi.currentSubscription(), []);
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");

  async function continueTo(destination) {
    if (pending) return;
    setPending(destination);
    setError("");
    try {
      const user = await authApi.completeWelcome();
      onUserUpdate(user);
      navigate(destination, { replace: true });
    } catch (requestError) {
      setError(requestError.message || t("welcome.error"));
    } finally {
      setPending("");
    }
  }

  if (subscription.loading) return <LoadingPanel />;
  if (subscription.error || !subscription.data) {
    return <ErrorPanel message={subscription.error || t("welcome.error")} onRetry={subscription.reload} />;
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
          <div><dt>{t("welcome.expires")}</dt><dd>{formatDateTime(subscription.data.trial_ends_at)}</dd></div>
        </dl>
        <p className="welcome-data-note">{t("welcome.saved")}</p>
        {error && <p className="form-alert error" role="alert">{error}</p>}
        <div className="welcome-actions">
          <button className="btn btn-primary" type="button" disabled={Boolean(pending)} onClick={() => void continueTo("/dashboard")}>{pending === "/dashboard" ? t("welcome.starting") : t("welcome.start")}</button>
          <button className="btn btn-outline" type="button" disabled={Boolean(pending)} onClick={() => void continueTo("/subscription")}>{pending === "/subscription" ? t("welcome.opening") : t("welcome.subscribe")}</button>
        </div>
      </section>
      <aside className="welcome-onboarding-visual" aria-hidden="true">
        <img src={assetPath("/assets/mascot-study-640.webp")} alt="" width="640" height="640" />
      </aside>
    </main>
  );
}
