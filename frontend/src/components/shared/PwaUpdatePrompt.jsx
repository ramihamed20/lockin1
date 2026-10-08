import { useLocation } from "react-router-dom";
import { Icon } from "../../lib/icons.jsx";
import { useI18n } from "../I18nProvider.jsx";
import { usePwaUpdates } from "../../pwa/usePwaUpdates.js";
import { UPDATE_STATUS } from "../../pwa/updateManager.js";
import { isFeatureComingSoon } from "../../lib/featureAvailability.js";
import { whatsNewText } from "../../lib/whatsNew.js";
import { usePendingRelease } from "../../pwa/usePendingRelease.js";

/**
 * A quiet card, never a modal: finding an update must not interrupt a reader
 * mid-checkpoint, mid-exam, or mid-stroke. It applies only when they choose.
 */
export function PwaUpdatePrompt({ deferred = false }) {
  const location = useLocation();
  const { t, locale } = useI18n();
  const { status, dismissed, error, applyUpdate, dismiss } = usePwaUpdates();
  const inImmersiveWorkspace = (!isFeatureComingSoon("lock-in") && (location.pathname === "/lock-in"
    || location.pathname.startsWith("/lock-in/")))
    || location.pathname.endsWith("/workspace");

  const updating = status === UPDATE_STATUS.UPDATING;
  const reloadRequired = status === UPDATE_STATUS.RELOAD_REQUIRED;
  const activationFailed = status === UPDATE_STATUS.AVAILABLE && error === "activation-failed";
  const visible = status === UPDATE_STATUS.AVAILABLE || updating || reloadRequired;
  const pending = usePendingRelease(status === UPDATE_STATUS.AVAILABLE && !activationFailed);
  if (deferred || inImmersiveWorkspace || dismissed || !visible) return null;

  const title = reloadRequired ? t("pwa.update.reloadTitle") : activationFailed ? t("pwa.update.paused") : pending ? t("pwa.update.titleVersion", { version: pending.version }) : t("pwa.update.title");
  const body = reloadRequired ? t("pwa.update.reloadBody") : activationFailed ? t("pwa.update.error") : updating ? t("pwa.update.applying") : pending ? whatsNewText(pending.summary, locale) : t("pwa.update.body");

  return (
    <aside className="pwa-update-prompt" role="status" aria-live="polite" data-update-status={status}>
      <div className="pwa-update-prompt__content">
        <span className="stat-icon pwa-update-prompt__icon"><Icon name={activationFailed ? "alert-triangle" : "sparkles"} size={20} /></span>
        <div>
          <h2>{title}</h2>
          <p>{body}</p>
        </div>
      </div>
      <div className="pwa-update-prompt__actions">
        <button className="btn btn-outline compact" type="button" onClick={dismiss} disabled={updating}>{t("pwa.update.later")}</button>
        <button className="btn btn-primary compact" type="button" aria-busy={updating || undefined} disabled={updating} onClick={() => { void applyUpdate(); }}>
          {updating ? t("pwa.update.updating") : reloadRequired ? t("pwa.update.reload") : t("pwa.update.now")}
        </button>
      </div>
    </aside>
  );
}
