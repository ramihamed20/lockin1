import { Link, useParams } from "react-router-dom";
import { moderationApi } from "../api/community.js";
import { Icon } from "../lib/icons.jsx";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { BreadcrumbBar, ErrorPanel, LoadingPanel, Page } from "../components/ui/index.jsx";
import { statusText } from "../components/community/index.jsx";

export default function CommunityReport() {
  const { reportId = "" } = useParams();
  const report = useAsyncData(() => moderationApi.getReport(reportId), [reportId]);

  if (report.loading) return <LoadingPanel />;
  if (report.error) return <ErrorPanel message={report.error} onRetry={report.reload} />;

  const value = report.data;
  return (
    <Page title="Report status" subtitle="Django controls access to this report and its moderation workflow.">
      <BreadcrumbBar items={[["Community", "/community"]]} current="Report status" />
      <section className="community-top">
        <article className="panel community-composer"><p className="eyebrow">Server-managed report</p><h2>{value.target_label || `${statusText(value.target_type)} report`}</h2><p>{value.description}</p><div className="post-meta"><span>{statusText(value.status)}</span><span>{statusText(value.reason)}</span><span>Revision {value.revision}</span></div></article>
        <article className="panel announcement-panel"><div className="panel-title"><h2>Report details</h2><span><Icon name="help" size={16} /></span></div><div className="announcement-list"><article className="announcement-item"><span className="stat-icon"><Icon name="clock" /></span><div><h3>{statusText(value.priority)}</h3><p>Created {value.created_at ? new Date(value.created_at).toLocaleString() : "by Django"}</p>{value.resolved_at && <small>Resolved {new Date(value.resolved_at).toLocaleString()}</small>}</div></article>{value.resolution_notes && <article className="announcement-item"><span className="stat-icon"><Icon name="check" /></span><div><h3>Resolution</h3><p>{value.resolution_notes}</p></div></article>}</div><Link className="btn btn-soft" to="/community">Back to community</Link></article>
      </section>
      <p className="save-hint">This page deliberately does not display moderation evidence or moderation controls. Those require Django-authorized workspace capabilities in a later phase.</p>
    </Page>
  );
}
