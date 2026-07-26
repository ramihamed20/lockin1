import { Link } from "react-router-dom";
import { Icon } from "../../lib/icons.jsx";
import { ProgressLine } from "../ui/index.jsx";
import { BookmarkButton } from "./BookmarkButton.jsx";

function contentTypeLabel(contentType) {
  return contentType === "pdf" ? "PDF document" : contentType === "audio" ? "Audio" : contentType === "video" ? "Video" : "Learning material";
}

/** Renders a public learning object with the replacement's existing sheet-card vocabulary. */
export function LearningObjectCard({ learningObject, onBookmarkChanged }) {
  const version = learningObject?.version;
  if (!version) return null;
  const progress = learningObject.progress;
  const completion = progress?.completion_percent;
  return (
    <article className="sheet-card">
      <div className="card-head">
        <div>
          <span className="pill">{contentTypeLabel(version.content_type)}</span>
          <h2>{version.title}</h2>
          <p>{version.summary || "No summary was provided for this learning material."}</p>
        </div>
        <span className="stat-icon"><Icon name="file" /></span>
      </div>
      {typeof completion === "number" && <ProgressLine value={completion} />}
      <div className="progress-meta">
        <span>{typeof completion === "number" ? `${progress.status.replace("_", " ")}` : "Not started"}</span>
        <strong>{typeof completion === "number" ? `${completion}%` : contentTypeLabel(version.content_type)}</strong>
      </div>
      <div className="focus-timer-actions">
        <Link className="btn btn-primary" to={`/materials/objects/${learningObject.id}`}>Open material</Link>
        <BookmarkButton
          compact
          learningObjectId={learningObject.id}
          isBookmarked={learningObject.is_bookmarked === true}
          onChanged={(isBookmarked) => onBookmarkChanged?.(learningObject.id, isBookmarked)}
        />
      </div>
    </article>
  );
}
