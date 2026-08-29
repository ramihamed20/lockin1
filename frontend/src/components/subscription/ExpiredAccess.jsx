import { Link } from "react-router-dom";
import { useI18n } from "../I18nProvider.jsx";
import { SubscriptionStatus } from "./SubscriptionStatus.jsx";

export function ExpiredAccess({ subscription }) {
  const { t } = useI18n();
  return (
    <section className="expired-access" aria-labelledby="expired-access-title">
      <div className="expired-access-card">
        <SubscriptionStatus subscription={subscription} />
        <div><p className="eyebrow">Lock-in</p><h1 id="expired-access-title">{t("subscription.spaceSaved")}</h1><p>{t("subscription.spaceSavedBody")}</p></div>
        <div className="expired-access-actions">
          <Link className="btn btn-primary" to="/subscription">{t("subscription.renew")}</Link>
          <Link className="btn btn-outline" to="/settings">{t("common.account")}</Link>
        </div>
      </div>
    </section>
  );
}
