import { Link, useParams } from "react-router-dom";
import { moderationApi } from "../api/community.js";
import { Icon } from "../lib/icons.jsx";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { ErrorPanel, LoadingPanel, Page } from "../components/ui/index.jsx";
import { statusText } from "../components/community/index.jsx";
import { formatDateTime } from "../lib/i18n.js";
import { useI18n } from "../components/I18nProvider.jsx";

export default function CommunityReport() {
  const { t } = useI18n();
  const { reportId = "" } = useParams();
  const report = useAsyncData(() => moderationApi.getReport(reportId), [reportId]);

  if (report.loading) return <LoadingPanel />;
  if (report.error) return <ErrorPanel message={report.error} onRetry={report.reload} />;

  const value = report.data;
  return (
    <Page title={t("community.reportStatus")} subtitle={t("community.reportSubtitle")}>
      <section className="community-top">
        <article className="panel community-composer"><p className="eyebrow">{t("community.managedReport")}</p><h2 dir="auto">{value.target_label || t("community.reportOf", { type: statusText(value.target_type) })}</h2><p dir="auto">{value.description}</p><div className="post-meta"><span dir="auto">{statusText(value.status)}</span><span dir="auto">{statusText(value.reason)}</span><span dir="auto">{t("community.revisionOf", { number: value.revision })}</span></div></article>
        <article className="panel announcement-panel"><div className="panel-title"><h2>{t("community.reportDetails")}</h2><span><Icon name="help" size={16} /></span></div><div className="announcement-list"><article className="announcement-item"><span className="stat-icon"><Icon name="clock" /></span><div><h3 dir="auto">{statusText(value.priority)}</h3><p dir="auto">{t("community.createdOn", { date: value.created_at ? formatDateTime(value.created_at) : t("community.createdBySystem") })}</p>{value.resolved_at && <small dir="auto">{t("community.resolvedOn", { date: formatDateTime(value.resolved_at) })}</small>}</div></article>{value.resolution_notes && <article className="announcement-item"><span className="stat-icon"><Icon name="check" /></span><div><h3>{t("community.resolution")}</h3><p dir="auto">{value.resolution_notes}</p></div></article>}</div><Link className="btn btn-soft" to="/community">{t("community.backToCommunity")}</Link></article>
      </section>
      <p className="save-hint">{t("community.reportNote")}</p>
    </Page>
  );
}
