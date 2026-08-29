import { Link } from "react-router-dom";
import { Icon } from "../../lib/icons.jsx";
import { ProgressLine } from "../ui/index.jsx";
import { BookmarkButton } from "./BookmarkButton.jsx";
import { useI18n } from "../I18nProvider.jsx";

function contentTypeLabel(contentType, t) {
  if (contentType === "pdf") return t("materials.pdfDocument");
  if (contentType === "audio") return t("materials.audio");
  if (contentType === "video") return t("materials.video");
  return t("materials.learningMaterial");
}

/** Renders a public learning object with the replacement's existing sheet-card vocabulary. */
export function LearningObjectCard({ learningObject, onBookmarkChanged }) {
  const { t } = useI18n();
  const version = learningObject?.version;
  if (!version) return null;
  const progress = learningObject.progress;
  const completion = progress?.completion_percent;
  return (
    <article className="sheet-card">
      <div className="card-head">
        <div>
          <span className="pill">{contentTypeLabel(version.content_type, t)}</span>
          <h2 dir="auto">{version.title}</h2>
          <p dir="auto">{version.summary || t("materials.noSummary")}</p>
        </div>
        <span className="stat-icon"><Icon name="file" /></span>
      </div>
      {typeof completion === "number" && <ProgressLine value={completion} />}
      <div className="progress-meta">
        <span dir="auto">{typeof completion === "number" ? `${progress.status.replace("_", " ")}` : t("materials.notStarted")}</span>
        <strong dir="auto">{typeof completion === "number" ? `${completion}%` : contentTypeLabel(version.content_type, t)}</strong>
      </div>
      <div className="focus-timer-actions">
        <Link className="btn btn-primary" to={`/materials/objects/${learningObject.id}`}>{t("materials.openMaterial")}</Link>
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
