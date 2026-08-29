import { Link } from "react-router-dom";
import { Icon } from "../lib/icons.jsx";
import { useI18n } from "../components/I18nProvider.jsx";

export default function LockInComingSoon() {
  const { t } = useI18n();
  return (
    <main className="lock-in-coming-soon">
      <section aria-labelledby="lock-in-coming-soon-title">
        <span><Icon name="clock" size={28} /></span>
        <p>{t("materials.lockInMode")}</p>
        <h1 id="lock-in-coming-soon-title">{t("lockIn.comingSoon")}</h1>
        <p>{t("lockIn.comingSoonBody")}</p>
        <div>
          <Link className="btn btn-primary" to="/study-plan">{t("lockIn.openStudyPlan")}</Link>
          <Link className="btn btn-soft" to="/review">{t("lockIn.openReview")}</Link>
        </div>
      </section>
    </main>
  );
}
