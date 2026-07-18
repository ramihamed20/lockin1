import { EmptyState } from "../../../components/Feedback";
import { useI18n } from "../../../i18n/I18nProvider";
import { formatMoney } from "../format";
import type { Product } from "../types";

export function AvailablePlans({
  products,
  checkoutAvailable
}: {
  products: Product[];
  checkoutAvailable: boolean;
}) {
  const { locale, t } = useI18n();
  const offers = products.flatMap((product) =>
    product.plans.flatMap((plan) =>
      plan.current_version.prices.map((price) => ({ product, plan, price }))
    )
  );
  return (
    <section className="billing-section" aria-labelledby="plans-heading">
      <header>
        <div>
          <p className="billing-kicker">{t("plansEyebrow")}</p>
          <h2 id="plans-heading">{t("availablePlans")}</h2>
        </div>
        <p>{t("availablePlansCopy")}</p>
      </header>
      {offers.length ? (
        <ul className="offer-list">
          {offers.map(({ plan, price }) => (
            <li key={price.id}>
              <div>
                <h3>{plan.current_version.title}</h3>
                <p>{plan.current_version.description}</p>
              </div>
              <strong>
                {formatMoney(
                  price.amount_minor,
                  price.currency,
                  price.currency_exponent,
                  locale
                )}
                <small>
                  / {price.interval_count > 1 ? price.interval_count : ""} {t(`interval_${price.interval}`)}
                </small>
              </strong>
              <span>{checkoutAvailable ? t("checkoutProviderRequired") : t("checkoutUnavailable")}</span>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title={t("noPaidPlans")}>{t("noPaidPlansCopy")}</EmptyState>
      )}
    </section>
  );
}
