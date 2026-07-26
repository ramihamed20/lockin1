import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { educationApi, learningApi } from "../api/learning.js";
import { progressApi } from "../api/progress.js";
import { Icon } from "../lib/icons.jsx";
import { isApiError } from "../api/client.js";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { BreadcrumbBar, ErrorPanel, LoadingPanel, Page, ProgressLine } from "../components/ui/index.jsx";
import { BookmarkButton } from "../components/learning/BookmarkButton.jsx";

function safeFilePath(value, disposition) {
  if (typeof value !== "string") return null;
  const pattern = new RegExp(`^/api/v1/files/[0-9a-f-]+/${disposition}$`, "i");
  return pattern.test(value) ? value : null;
}

async function loadLearningObject(learningObjectId) {
  const learningObject = await learningApi.getLearningObject(learningObjectId);
  const version = learningObject.version;
  if (!version || typeof version !== "object" || typeof version.academic_node_id !== "string") {
    throw new Error("The learning material does not have a published version.");
  }
  const [nodeResult, progressResult] = await Promise.allSettled([
    educationApi.getNode(version.academic_node_id),
    progressApi.getLearningObjectProgress(learningObjectId)
  ]);
  return {
    learningObject,
    node: nodeResult.status === "fulfilled" ? nodeResult.value : null,
    nodeError: nodeResult.status === "rejected" ? nodeResult.reason : null,
    progress: progressResult.status === "fulfilled" ? progressResult.value : null,
    progressError: progressResult.status === "rejected" ? progressResult.reason : null
  };
}

export default function LearningObjectStudy() {
  const { learningObjectId, sheetId } = useParams();
  // Older links used `sheets/:sheetId`; the Django contract identifies the
  // same server resource as a learning object. Resolve either URL without
  // preserving the legacy page's mock study state.
  const objectId = learningObjectId || sheetId;
  const detail = useAsyncData(() => loadLearningObject(objectId), [objectId]);
  const [isBookmarked, setIsBookmarked] = useState(false);

  useEffect(() => {
    if (detail.data) setIsBookmarked(detail.data.learningObject.is_bookmarked === true);
  }, [detail.data]);

  if (detail.loading) return <LoadingPanel />;
  if (detail.error) return <ErrorPanel message={detail.error} onRetry={detail.reload} />;

  const { learningObject, node, nodeError, progress, progressError } = detail.data;
  const version = learningObject.version;
  const asset = Array.isArray(version.assets) ? version.assets[0] : null;
  const viewUrl = safeFilePath(asset?.view_url, "view");
  const downloadUrl = safeFilePath(asset?.download_url, "download");
  const focusDocumentVersionId = version.focus_context?.context_type === "study" && typeof version.focus_context.context_id === "string"
    ? version.focus_context.context_id
    : null;
  const breadcrumbItems = [
    ["Materials", "/materials"],
    ...(node?.breadcrumbs || []).map((item) => [item.title, `/materials/${item.id}`])
  ];

  return (
    <Page title={version.title} subtitle={version.summary || "Published learning material from your academic library."}>
      {node && <BreadcrumbBar items={breadcrumbItems} current={version.title} />}
      {nodeError && <p className="muted">The material is available, but its academic breadcrumb could not be loaded.</p>}
      <section className="dashboard-main">
        <div className="dashboard-left">
          <article className="panel continue-card">
            <p className="eyebrow">Published material</p>
            <h2>{version.academic_node_title}</h2>
            <p>{version.content_type.toUpperCase()} · {version.language}</p>
            <div className="focus-timer-actions">
              {viewUrl ? <a className="btn btn-primary" href={viewUrl} target="_blank" rel="noreferrer"><Icon name="eye" size={16} /> Open secure viewer</a> : <button className="btn btn-primary" type="button" disabled>Viewer unavailable</button>}
              {focusDocumentVersionId ? <Link className="btn btn-soft" to={`/focus/${focusDocumentVersionId}`}><Icon name="expand" size={16} /> Open Focus workspace</Link> : <button className="btn btn-soft" type="button" disabled>Focus unavailable</button>}
              {downloadUrl ? <a className="btn btn-soft" href={downloadUrl}><Icon name="arrow-up-right" size={16} /> Download</a> : <button className="btn btn-soft" type="button" disabled>Download unavailable</button>}
              <BookmarkButton learningObjectId={learningObject.id} isBookmarked={isBookmarked} onChanged={setIsBookmarked} />
              <Link className="btn btn-soft" to={`/community/context/learning_object/${learningObject.id}`}><Icon name="messages" size={16} /> Discuss material</Link>
            </div>
            {!asset && <p className="save-hint">This published item does not provide a secure file through the current API.</p>}
            {asset && !viewUrl && <p className="save-hint">The server did not provide a safe viewer link for this file.</p>}
          </article>
      {progress ? <ProgressEditor learningObjectId={learningObject.id} contentType={version.content_type} progress={progress} onProgressUpdated={detail.reload} /> : <ErrorPanel message={progressError?.message || "Learning progress could not be loaded."} onRetry={detail.reload} />}
        </div>
        <div className="dashboard-right">
          <article className="panel dashboard-review-card">
            <div className="panel-title"><div><p className="eyebrow">File access</p><h2>{asset?.original_name || "No file attached"}</h2></div><span><Icon name="file" size={16} /></span></div>
            {asset ? <div className="review-pulse-row"><div><strong>{asset.content_type || "File"}</strong><span>format</span></div><div><strong>{asset.size_bytes ?? "—"}</strong><span>bytes</span></div></div> : <p>No file metadata was returned for this learning object.</p>}
          </article>
          <article className="panel study-table-card"><div className="panel-title"><h2>Study actions</h2></div><p className="muted">Focus workspace and annotations are available only when Django supplies a Focus document and grants access. Quiz and advanced checkpoint actions remain server-controlled through their dedicated assessment routes.</p><Link className="btn btn-soft" to="/materials">Back to materials</Link></article>
        </div>
      </section>
    </Page>
  );
}

function ProgressEditor({ learningObjectId, contentType, progress, onProgressUpdated }) {
  const [currentProgress, setCurrentProgress] = useState(progress);
  const [percent, setPercent] = useState(progress.completion_percent || 0);
  const [page, setPage] = useState(progress.position?.page || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [conflict, setConflict] = useState("");

  useEffect(() => {
    setCurrentProgress(progress);
    setPercent(progress.completion_percent || 0);
    setPage(progress.position?.page || "");
    setConflict("");
  }, [progress.completion_percent, progress.position?.page, progress.revision]);

  async function saveProgress(event) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setConflict("");
    const numericPage = Number(page);
    const position = contentType === "pdf" && page !== "" ? { page: numericPage } : {};
    try {
      const updated = await progressApi.updateLearningObjectProgress(learningObjectId, {
        expectedRevision: currentProgress.revision,
        status: Number(percent) === 100 ? "completed" : "in_progress",
        completionPercent: Number(percent),
        position
      });
      setCurrentProgress(updated);
      onProgressUpdated?.();
    } catch (requestError) {
      if (isApiError(requestError) && requestError.status === 409) {
        try {
          const latest = await progressApi.getLearningObjectProgress(learningObjectId);
          setCurrentProgress(latest);
          setPercent(latest.completion_percent || 0);
          setPage(latest.position?.page || "");
          onProgressUpdated?.();
          setConflict("Progress changed on another session. The latest server state was loaded; review it and save again if needed.");
        } catch (reloadError) {
          setError(reloadError);
        }
      } else {
        setError(requestError);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className="panel profile-security-panel">
      <div className="panel-title"><div><p className="eyebrow">Server-saved progress</p><h2>{percent}% complete</h2></div><span className="pill">Revision {currentProgress.revision}</span></div>
      <ProgressLine value={percent} />
      <form className="password-form" onSubmit={saveProgress}>
        <label className="field"><span>Completion</span><input type="range" min="0" max="100" step="1" value={percent} onChange={(event) => setPercent(Number(event.target.value))} /><small>{percent}%</small></label>
        {contentType === "pdf" && <label className="field"><span>Last page (optional)</span><input type="number" min="1" value={page} onChange={(event) => setPage(event.target.value)} /></label>}
        {conflict && <p className="inline-error" role="status">{conflict}</p>}
        {error && <p className="inline-error" role="alert">{error.message}</p>}
        <button className="btn btn-primary" type="submit" disabled={saving}>{saving ? "Saving…" : "Save progress"}</button>
      </form>
    </article>
  );
}
