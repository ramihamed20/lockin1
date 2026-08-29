import { useState } from "react";
import { useLocation } from "react-router-dom";
import { Icon } from "../../lib/icons.jsx";
import { useI18n } from "../I18nProvider.jsx";
import { usePwaLifecycle } from "../../pwa/PwaLifecycleProvider.jsx";

export function PwaUpdatePrompt({ deferred = false }) {
  const location = useLocation();
  const { t } = useI18n();
  const [updateError, setUpdateError] = useState("");
  const {
    needRefresh,
    setNeedRefresh,
    updateServiceWorker
  } = usePwaLifecycle();
  const inImmersiveWorkspace = location.pathname === "/lock-in"
    || location.pathname.startsWith("/lock-in/")
    || location.pathname.endsWith("/workspace");

  if (deferred || inImmersiveWorkspace || (!needRefresh && !updateError)) return null;

  async function applyUpdate() {
    setUpdateError("");
    try {
      await updateServiceWorker(true);
    } catch {
      setUpdateError(t("pwa.update.error"));
    }
  }

  return (
    <aside className="pwa-update-prompt" role="status" aria-live="polite">
      <div className="pwa-update-prompt__content">
        <span className="stat-icon pwa-update-prompt__icon"><Icon name={updateError ? "alert-triangle" : "sparkles"} size={20} /></span>
        <div>
          <h2>{updateError ? t("pwa.update.paused") : t("pwa.update.title")}</h2>
          <p>{updateError || t("pwa.update.body")}</p>
        </div>
      </div>
      <div className="pwa-update-prompt__actions">
        <button className="btn btn-outline compact" type="button" onClick={() => { setNeedRefresh(false); setUpdateError(""); }}>{t("pwa.update.later")}</button>
        {!updateError && <button className="btn btn-primary compact" type="button" onClick={() => { void applyUpdate(); }}>{t("pwa.update.now")}</button>}
      </div>
    </aside>
  );
}
