import { Link } from "react-router-dom";
import { useI18n } from "../I18nProvider.jsx";
import { Icon } from "../../lib/icons.jsx";
import { useAsyncData } from "../../hooks/useAsyncData.js";
import { myGroupApi } from "../../api/myGroup.js";
import { GroupBadge } from "./MyGroupControls.jsx";

/**
 * The compact dashboard entry to the personal timetable. It loads on its own so
 * a slow or failed schedule request never holds back the rest of the Dashboard.
 */
export function MyGroupCard() {
  const { t } = useI18n();
  const remote = useAsyncData((signal) => myGroupApi.get(signal), []);
  const data = remote.data;

  if (remote.loading && !data) {
    // The card's own shape, so nothing moves when the groups arrive.
    return (
      <article className="panel mg-card mg-card--loading" aria-busy="true" aria-label={t("myGroup.title")}>
        <span className="skeleton mg-skeleton-icon" aria-hidden="true" />
        <span className="mg-card-text" aria-hidden="true"><span className="skeleton mg-skeleton-line" /><span className="skeleton mg-skeleton-line is-short" /></span>
        <span className="mg-skeleton-badges" aria-hidden="true"><span className="skeleton mg-skeleton-pill" /><span className="skeleton mg-skeleton-pill" /></span>
      </article>
    );
  }
  if (remote.error && !data) {
    return (
      <article className="panel mg-card mg-card--error">
        <span className="mg-card-icon is-quiet" aria-hidden="true"><Icon name="calendar" size={18} /></span>
        <span className="mg-card-text">
          <h2 className="mg-title">{t("myGroup.title")}</h2>
          <p className="mg-muted">{t("myGroup.loadError")}</p>
        </span>
        <button type="button" className="btn btn-soft compact" onClick={remote.reload}>{t("common.tryAgain")}</button>
      </article>
    );
  }
  // No timetable exists for this student's cohort: the Dashboard stays as it was.
  if (!data?.available) return null;
  if (!data.configured) {
    // Never a forced interruption: an invitation, and the flow on My Group.
    return (
      <article className="panel mg-card mg-card--invite">
        <span className="mg-card-icon" aria-hidden="true"><Icon name="calendar" size={18} /></span>
        <span className="mg-card-text">
          <h2 className="mg-title">{t("myGroup.title")}</h2>
          <p className="mg-muted">{t("myGroup.setupCardText")}</p>
        </span>
        <Link className="btn btn-primary compact mg-customize" to="/my-group">{t("myGroup.setUp")}</Link>
      </article>
    );
  }

  const { theory_group: theoryGroup, default_practical_group: practicalGroup } = data.preferences;
  return (
    <article className="panel mg-card">
      <Link className="mg-card-main" to="/my-group" aria-label={`${t("myGroup.title")} — ${t("myGroup.openTimetable")}`}>
        <span className="mg-card-icon" aria-hidden="true"><Icon name="calendar" size={18} /></span>
        <span className="mg-card-text">
          <h2 className="mg-title">{t("myGroup.title")}</h2>
          <span className="mg-card-sub">{t("myGroup.personalSchedule")}</span>
        </span>
        <span className="mg-badges">
          <GroupBadge labelKey="myGroup.theory" code={theoryGroup} />
          <GroupBadge labelKey="myGroup.practical" code={practicalGroup} />
        </span>
      </Link>
      {data.options?.per_subject_overrides
        ? <Link className="btn btn-soft compact mg-customize" to="/my-group?customize=1">{t("myGroup.customize")}</Link>
        : <Link className="btn btn-soft compact mg-customize" to="/my-group?change=1">{t("myGroup.changeGroup")}</Link>}
    </article>
  );
}
