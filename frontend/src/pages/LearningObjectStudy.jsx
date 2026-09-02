import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { learningApi } from "../api/learning.js";
import { progressApi } from "../api/progress.js";
import { isApiError } from "../api/client.js";
import { BookmarkButton } from "../components/learning/BookmarkButton.jsx";
import { ErrorPanel, LoadingPanel, Page, ProgressLine } from "../components/ui/index.jsx";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { Icon } from "../lib/icons.jsx";

function safeFilePath(value, disposition) {
  if (typeof value !== "string") return null;
  return new RegExp(`^/api/v1/files/[0-9a-f-]+/${disposition}$`, "i").test(value) ? value : null;
}

async function loadStudyEntry(learningObjectId) {
  const learningObject = await learningApi.getLearningObject(learningObjectId);
  const version = learningObject?.version;
  if (!version || typeof version !== "object") {
    throw new Error("This learning material no longer has a published version.");
  }
  const progressResult = await Promise.allSettled([
    progressApi.getLearningObjectProgress(learningObjectId)
  ]);
  return {
    learningObject,
    version,
    progress: progressResult[0].status === "fulfilled" ? progressResult[0].value : null,
    progressError: progressResult[0].status === "rejected" ? progressResult[0].reason : null
  };
}

export default function LearningObjectStudy() {
  const { learningObjectId, sheetId } = useParams();
  const objectId = learningObjectId || sheetId;
  const detail = useAsyncData(() => loadStudyEntry(objectId), [objectId]);

  if (detail.loading) {
    return <Page title="Opening study workspace" showHeading><LoadingPanel /></Page>;
  }
  if (detail.error) {
    return <Page title="Study workspace unavailable" showHeading><ErrorPanel message={detail.error} onRetry={detail.reload} /></Page>;
  }

  const { learningObject, progress, progressError, version } = detail.data;

  return <NonFocusStudyEntry
    learningObject={learningObject}
    version={version}
    progress={progress}
    progressError={progressError}
    onProgressUpdated={detail.reload}
  />;
}

function NonFocusStudyEntry({ learningObject, version, progress, progressError, onProgressUpdated }) {
  const [isBookmarked, setIsBookmarked] = useState(learningObject.is_bookmarked === true);
  const asset = Array.isArray(version.assets) ? version.assets[0] : null;
  const viewUrl = safeFilePath(asset?.view_url, "view");
  const downloadUrl = safeFilePath(asset?.download_url, "download");

  useEffect(() => setIsBookmarked(learningObject.is_bookmarked === true), [learningObject]);

  return (
    <Page title={version.title} subtitle={version.summary || "Published learning material"} showHeading>
      <section className="study-entry">
        <article className="panel study-entry__overview">
          <div className="study-entry__icon" aria-hidden="true"><Icon name="file" size={22} /></div>
          <div>
            <p className="study-entry__meta">{version.content_type?.toUpperCase() || "MATERIAL"} · {version.language || "Available"}</p>
            <h2>{version.academic_node_title || "Study material"}</h2>
            <p>This material opens in its secure viewer.</p>
          </div>
          <div className="study-entry__actions" aria-label="Material actions">
            {viewUrl ? <a className="btn btn-primary" href={viewUrl} target="_blank" rel="noreferrer"><Icon name="eye" size={16} /> Open material</a> : <button className="btn btn-primary" type="button" disabled>Viewer unavailable</button>}
            {downloadUrl && <a className="btn btn-soft" href={downloadUrl}><Icon name="arrow-up-right" size={16} /> Download</a>}
            {/* Lock In can already open its setup form on a chosen material,
                but nothing handed it one: the setup always started on
                "Independent study" even when the student arrived from a
                specific version. The version travels in router state, and Lock
                In falls back to that empty selection if it is not one of the
                materials the session offers. */}
            <Link className="btn btn-soft" to="/lock-in" state={{ preselectedDocumentVersionId: version.id }}><Icon name="target" size={16} /> Study in Lock In</Link>
            <BookmarkButton learningObjectId={learningObject.id} isBookmarked={isBookmarked} onChanged={setIsBookmarked} />
            <Link className="btn btn-soft" to={`/community/context/learning_object/${learningObject.id}`}><Icon name="messages" size={16} /> Discuss</Link>
          </div>
        </article>
        {progress ? <ProgressEditor learningObjectId={learningObject.id} progress={progress} onProgressUpdated={onProgressUpdated} /> : <ErrorPanel message={progressError || "Learning progress could not be loaded."} onRetry={onProgressUpdated} />}
        <Link className="study-entry__back" to="/materials"><Icon name="arrow-left" size={16} /> All materials</Link>
      </section>
    </Page>
  );
}

function ProgressEditor({ learningObjectId, progress, onProgressUpdated }) {
  const [currentProgress, setCurrentProgress] = useState(progress);
  const [percent, setPercent] = useState(progress.completion_percent || 0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    setCurrentProgress(progress);
    setPercent(progress.completion_percent || 0);
  }, [progress]);

  async function saveProgress(event) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const updated = await progressApi.updateLearningObjectProgress(learningObjectId, {
        expectedRevision: currentProgress.revision,
        status: Number(percent) === 100 ? "completed" : "in_progress",
        completionPercent: Number(percent),
        position: {}
      });
      setCurrentProgress(updated);
      onProgressUpdated?.();
    } catch (requestError) {
      if (isApiError(requestError) && requestError.status === 409) {
        setError(new Error("Progress changed in another session. Refresh and try again."));
      } else {
        setError(requestError);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className="panel study-entry__progress">
      <div className="study-entry__progress-heading"><div><p className="study-entry__meta">Study progress</p><h2>{percent}% complete</h2></div><span className="pill">Saved to your account</span></div>
      <ProgressLine value={percent} />
      <form className="study-entry__progress-form" onSubmit={saveProgress}>
        <label className="field"><span>Completion</span><input type="range" min="0" max="100" step="1" value={percent} onChange={(event) => setPercent(Number(event.target.value))} /><small>{percent}%</small></label>
        {error && <p className="inline-error" role="alert">{error.message}</p>}
        <button className="btn btn-primary" type="submit" disabled={saving}>{saving ? "Saving…" : "Save progress"}</button>
      </form>
    </article>
  );
}
