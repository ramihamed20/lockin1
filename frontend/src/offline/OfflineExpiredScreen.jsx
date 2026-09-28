import { useI18n } from "../components/I18nProvider.jsx";
import { assetPath } from "../lib/utils.js";

export default function OfflineExpiredScreen({ onCheck, checking = false, reason = "" }) {
  const { t } = useI18n();
  return <main className="screen-state startup-shell startup-shell--settled" aria-labelledby="offline-expired-heading">
    <span className="startup-emblem" aria-hidden="true"><span className="startup-halo" /><span className="startup-logo-frame"><img src={assetPath("/icons/lockin-light-192-v2.png")} alt="" width="96" height="96" className="startup-logo" /></span></span>
    <h1 id="offline-expired-heading">{t("offline.expired")}</h1>
    <p className="startup-message">{t(reason === "clock_rollback" ? "offline.clockRollback" : "offline.expiredMessage")}</p>
    <button className="btn btn-soft" type="button" onClick={onCheck} disabled={checking}>{t("offline.checkConnection")}</button>
  </main>;
}
