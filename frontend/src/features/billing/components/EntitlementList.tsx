import { EmptyState } from "../../../components/Feedback";
import { useI18n } from "../../../i18n/I18nProvider";
import { formatDate } from "../format";
import type { Entitlement } from "../types";

const entitlementKeys = {
  "focus.workspace": "entitlementFocus",
  "content.premium": "entitlementPremiumContent",
  "files.download": "entitlementDownloads",
  "ai.assistance": "entitlementAi"
} as const;

export function EntitlementList({ entitlements }: { entitlements: Entitlement[] }) {
  const { locale, t } = useI18n();
  return (
    <section className="billing-section" aria-labelledby="access-heading">
      <header>
        <div>
          <p className="billing-kicker">{t("entitlementsEyebrow")}</p>
          <h2 id="access-heading">{t("yourAccess")}</h2>
        </div>
        <p>{t("yourAccessCopy")}</p>
      </header>
      {entitlements.length ? (
        <ul className="entitlement-list">
          {entitlements.map((entitlement) => (
            <li key={entitlement.id}>
              <span className="entitlement-check" aria-hidden="true">✓</span>
              <div>
                <h3>
                  {entitlement.code in entitlementKeys
                    ? t(entitlementKeys[entitlement.code as keyof typeof entitlementKeys])
                    : entitlement.title}
                </h3>
                <p>{entitlement.description}</p>
              </div>
              <small>
                {entitlement.ends_at
                  ? `${t("accessUntil")} ${formatDate(entitlement.ends_at, locale)}`
                  : t("ongoingAccess")}
              </small>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title={t("noEntitlements")}>{t("noEntitlementsCopy")}</EmptyState>
      )}
    </section>
  );
}
