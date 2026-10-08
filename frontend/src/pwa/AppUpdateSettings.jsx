import { useEffect, useState } from "react";
import { Icon } from "../lib/icons.jsx";
import { useI18n } from "../components/I18nProvider.jsx";
import { BUILD_INFO } from "./buildInfo.js";
import { UPDATE_STATUS } from "./updateManager.js";
import { usePwaUpdates } from "./usePwaUpdates.js";
import { OPEN_WHATS_NEW_EVENT, ReleaseNotesDialog } from "../components/WhatsNew.jsx";
import { WHATS_NEW, whatsNewText } from "../lib/whatsNew.js";
import { usePendingRelease } from "./usePendingRelease.js";

const STATUS_COPY = {
  [UPDATE_STATUS.IDLE]: ["settings.updates.idle", ""],
  [UPDATE_STATUS.CHECKING]: ["settings.updates.checking", ""],
  [UPDATE_STATUS.UP_TO_DATE]: ["settings.updates.latest", ""],
  [UPDATE_STATUS.AVAILABLE]: ["settings.updates.available", "settings.updates.availableBody"],
  [UPDATE_STATUS.UPDATING]: ["settings.updates.updating", "pwa.update.applying"],
  [UPDATE_STATUS.RELOAD_REQUIRED]: ["pwa.update.reloadTitle", "pwa.update.reloadBody"],
  [UPDATE_STATUS.OFFLINE]: ["settings.updates.offline", "settings.updates.offlineBody"],
  [UPDATE_STATUS.ERROR]: ["settings.updates.error", "settings.updates.errorBody"],
  [UPDATE_STATUS.UNSUPPORTED]: ["settings.updates.unsupported", "settings.updates.unsupportedBody"]
};

function useNow(intervalMs) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

function lastCheckedLabel(t, locale, checkedAt, now) {
  if (!checkedAt) return "";
  const seconds = Math.max(0, Math.round((now - checkedAt) / 1000));
  if (seconds < 60) return t("settings.updates.lastCheckedNow");
  const format = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const minutes = Math.round(seconds / 60);
  const relative = minutes < 60 ? format.format(-minutes, "minute") : format.format(-Math.round(minutes / 60), "hour");
  return t("settings.updates.lastChecked", { time: relative });
}

/** Settings → Updates: what is installed, and a real worker update check. */
export default function AppUpdateSettings() {
  const { t, locale } = useI18n();
  const { status, error, lastCheckedAt, checkForUpdates, applyUpdate } = usePwaUpdates();
  const now = useNow(30 * 1000);
  const pending = usePendingRelease(status === UPDATE_STATUS.AVAILABLE);
  const [explaining, setExplaining] = useState(false);
  const [titleKey, detailKey] = STATUS_COPY[status] || STATUS_COPY[UPDATE_STATUS.IDLE];
  const checked = lastCheckedLabel(t, locale, lastCheckedAt, now);
  const activationFailed = status === UPDATE_STATUS.AVAILABLE && error === "activation-failed";
  const announced = status === UPDATE_STATUS.AVAILABLE && !activationFailed && pending;
  const detail = activationFailed ? t("pwa.update.error") : announced ? whatsNewText(pending.summary, locale) : detailKey ? t(detailKey) : checked;
  const title = announced ? t("pwa.update.titleVersion", { version: pending.version }) : t(titleKey);
  const canApply = status === UPDATE_STATUS.AVAILABLE || status === UPDATE_STATUS.RELOAD_REQUIRED || status === UPDATE_STATUS.UPDATING;
  const busy = status === UPDATE_STATUS.CHECKING || status === UPDATE_STATUS.UPDATING;
  const ok = status === UPDATE_STATUS.UP_TO_DATE;
  const icon = ok ? "check" : canApply ? "sparkles" : status === UPDATE_STATUS.IDLE || status === UPDATE_STATUS.CHECKING ? "rotate-forward" : "alert-triangle";

  return <section className="settings-v2-section app-updates" id="settings-updates" aria-labelledby="settings-updates-heading">
    <div className="ui-group-block settings-v2-block">
      <div className="ui-group">
        <div className="ui-row">
          <span className="ui-row-body"><span>{t("settings.updates.version")}</span></span>
          <span className="ui-row-value app-updates-id" dir="ltr" data-testid="app-version">{BUILD_INFO.version}</span>
        </div>
        <div className="ui-row">
          <span className="ui-row-body"><span>{t("settings.updates.build")}</span></span>
          <span className="ui-row-value app-updates-id" dir="ltr" title={BUILD_INFO.release} data-testid="app-build">{BUILD_INFO.build}</span>
        </div>
      </div>
    </div>

    <div className="ui-group-block settings-v2-block">
      <h3 className="ui-group-title">{t("settings.updates.title")}</h3>
      <div className="ui-group">
        <div className="ui-row app-updates-status" data-update-status={status}>
          <span className={`ui-row-icon app-updates-icon${ok ? " is-ok" : canApply ? " is-ready" : ""}`} aria-hidden="true"><Icon name={icon} size={17} /></span>
          <span className="ui-row-body" role="status" aria-live="polite">
            <strong>{title}</strong>
            {detail && <small>{detail}</small>}
          </span>
          {busy && <span className="offline-v2-spinner" aria-hidden="true" />}
        </div>
        {/* A press started on Check must not activate a newly arrived update. */}
        {canApply
          ? <button key="apply" type="button" className="ui-row settings-v2-action" onClick={() => { if (announced) setExplaining(true); else void applyUpdate(); }} disabled={status === UPDATE_STATUS.UPDATING}>
            <span className="ui-row-body"><span>{status === UPDATE_STATUS.RELOAD_REQUIRED ? t("pwa.update.reload") : t("pwa.update.now")}</span></span>
          </button>
          : <button key="check" type="button" className="ui-row settings-v2-action" onClick={() => { void checkForUpdates(); }} disabled={busy || status === UPDATE_STATUS.UNSUPPORTED}>
            <span className="ui-row-body"><span>{t("settings.updates.check")}</span></span>
          </button>}
        <button type="button" className="ui-row settings-v2-action" onClick={() => window.dispatchEvent(new Event(OPEN_WHATS_NEW_EVENT))}>
          <span className="ui-row-body"><span>{t("whatsNew.open")}</span></span>
        </button>
      </div>
      <p className="ui-group-footer">{t("settings.updates.auto")}</p>
    </div>
    <ReleaseNotesDialog
      open={explaining && Boolean(announced)}
      release={pending || WHATS_NEW}
      mode="before"
      onClose={() => setExplaining(false)}
      onConfirm={() => { setExplaining(false); void applyUpdate(); }}
    />
  </section>;
}
