import { Link, useParams } from "react-router-dom";
import { moderationApi } from "../api/community.js";
import { Icon } from "../lib/icons.jsx";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { ErrorPanel, LoadingPanel, Page } from "../components/ui/index.jsx";
import { statusText } from "../components/community/index.jsx";
import { formatDateTime } from "../lib/i18n.js";

export default function CommunityReport() {
  const { reportId = "" } = useParams();
  const report = useAsyncData(() => moderationApi.getReport(reportId), [reportId]);

  if (report.loading) return <LoadingPanel />;
  if (report.error) return <ErrorPanel message={report.error} onRetry={report.reload} />;

  const value = report.data;
  return (
    <Page title="Report status" subtitle="Access to this report and its moderation workflow follows your permissions.">
      <section className="community-top">
        <article className="panel community-composer"><p className="eyebrow">Server-managed report</p><h2>{value.target_label || `${statusText(value.target_type)} report`}</h2><p>{value.description}</p><div className="post-meta"><span>{statusText(value.status)}</span><span>{statusText(value.reason)}</span><span>Revision {value.revision}</span></div></article>
        <article className="panel announcement-panel"><div className="panel-title"><h2>Report details</h2><span><Icon name="help" size={16} /></span></div><div className="announcement-list"><article className="announcement-item"><span className="stat-icon"><Icon name="clock" /></span><div><h3>{statusText(value.priority)}</h3><p>Created {value.created_at ? formatDateTime(value.created_at) : "by the system"}</p>{value.resolved_at && <small>Resolved {formatDateTime(value.resolved_at)}</small>}</div></article>{value.resolution_notes && <article className="announcement-item"><span className="stat-icon"><Icon name="check" /></span><div><h3>Resolution</h3><p>{value.resolution_notes}</p></div></article>}</div><Link className="btn btn-soft" to="/community">Back to community</Link></article>
      </section>
      <p className="save-hint">This page deliberately does not display moderation evidence or moderation controls. Those need workspace capabilities that arrive in a later phase.</p>
    </Page>
  );
}
