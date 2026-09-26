import { useState } from "react";
import { Link } from "react-router-dom";
import { useI18n } from "../I18nProvider.jsx";
import { Icon } from "../../lib/icons.jsx";
import { useAsyncData } from "../../hooks/useAsyncData.js";
import { myGroupApi } from "../../api/myGroup.js";
import { GroupBadge, MyGroupSetup } from "./MyGroupControls.jsx";

/**
 * The compact dashboard entry to the personal timetable. It loads on its own so
 * a slow or failed schedule request never holds back the rest of the Dashboard.
 */
export function MyGroupCard() {
  const { t } = useI18n();
  const remote = useAsyncData((signal) => myGroupApi.get(signal), []);
  const [saved, setSaved] = useState(null);
  const data = saved || remote.data;

  if (remote.loading && !data) return <article className="panel mg-card mg-card--loading" aria-busy="true" aria-label={t("myGroup.title")} />;
  if (remote.error && !data) {
    return (
      <article className="panel mg-card">
        <h2 className="mg-title">{t("myGroup.title")}</h2>
        <p className="mg-muted">{t("myGroup.loadError")}</p>
        <button type="button" className="btn btn-soft compact" onClick={remote.reload}>{t("common.tryAgain")}</button>
      </article>
    );
  }
  if (!data?.configured) {
    return <article className="panel mg-card mg-card--setup"><MyGroupSetup idPrefix="dashboard-my-group" onSaved={setSaved} /></article>;
  }

  const { theory_group: theoryGroup, default_practical_group: practicalGroup } = data.preferences;
  return (
    <article className="panel mg-card">
      <Link className="mg-card-main" to="/my-group" aria-label={`${t("myGroup.title")} — ${t("myGroup.openTimetable")}`}>
        <span className="mg-card-icon" aria-hidden="true"><Icon name="calendar" size={18} /></span>
        <h2 className="mg-title">{t("myGroup.title")}</h2>
        <span className="mg-badges">
          <GroupBadge labelKey="myGroup.theory" code={theoryGroup} />
          <GroupBadge labelKey="myGroup.practical" code={practicalGroup} />
        </span>
      </Link>
      <Link className="btn btn-soft compact mg-customize" to="/my-group?customize=1">{t("myGroup.customize")}</Link>
    </article>
  );
}
