import { Link } from "react-router-dom";
import { LockinIcon } from "../lib/lockinIcons.jsx";
import { Icon } from "../lib/icons.jsx";
import { Page } from "./ui/index.jsx";
import { useI18n } from "./I18nProvider.jsx";
import { getFeature, isFeatureComingSoon } from "../lib/featureAvailability.js";

/** A route-safe destination for product features scheduled for a later release. */
export function FeatureComingSoon({ featureId }) {
  const { t } = useI18n();
  const feature = getFeature(featureId);

  if (!feature || !isFeatureComingSoon(feature)) return null;

  const label = t(feature.labelKey);
  return (
    <Page title={label} headingHandled>
      <section className="feature-coming-soon" data-feature-id={feature.id} data-feature-status={feature.status} aria-labelledby="feature-coming-soon-title">
        <div className="feature-coming-soon-icon" aria-hidden="true"><LockinIcon name="coming-soon" size={34} /></div>
        <div className="feature-coming-soon-copy">
          <p className="feature-coming-soon-kicker"><LockinIcon name="locked" size={18} />{t("features.comingSoon")}</p>
          <h1 id="feature-coming-soon-title" dir="auto">{t("features.comingSoonTitle", { feature: label })}</h1>
          <p dir="auto">{t("features.comingSoonBody", { feature: label })}</p>
          <Link className="btn btn-soft" to="/dashboard"><Icon name="arrow-left" size={17} />{t("features.returnDashboard")}</Link>
        </div>
      </section>
    </Page>
  );
}
