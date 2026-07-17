import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { apiPath } from "../../api/client";
import { Button } from "../../components/Button";
import { Alert, PageSkeleton } from "../../components/Feedback";
import { FormField } from "../../components/FormField";
import { useI18n } from "../../i18n/I18nProvider";
import { learningObject, saveLearningProgress, toggleBookmark } from "./api";
import type { LearningObject, LearningProgress } from "./types";

export function LearningObjectPage() {
  const { contentId = "" } = useParams();
  const { t } = useI18n();
  const audioRef = useRef<HTMLAudioElement>(null);
  const [content, setContent] = useState<LearningObject | null>(null);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [pageNumber, setPageNumber] = useState(1);
  const [completion, setCompletion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    learningObject(contentId, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setContent(result);
      setCompletion(result.progress?.completion_percent ?? 0);
      const page = result.progress?.position.page;
      if (typeof page === "number") setPageNumber(page);
    }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [contentId]);

  if (failed) return <div className="page"><Alert>{t("learningLoadError")}</Alert></div>;
  if (!content) return <PageSkeleton label={t("loadingLearning")} />;
  const { version } = content;
  const primary = version.assets.find((asset) => asset.role === "primary");

  async function save(status: LearningProgress["status"]) {
    if (!content) return;
    setSaving(true);
    setSaved(false);
    const position = version.content_type === "pdf"
      ? { page: pageNumber }
      : version.content_type === "audio"
        ? { seconds: audioRef.current?.currentTime ?? 0 }
        : {};
    try {
      const progress = await saveLearningProgress(content.id, {
        status,
        completion_percent: status === "completed" ? 100 : completion,
        position,
        revision: content.progress?.revision ?? 0
      });
      setContent({ ...content, progress });
      setCompletion(progress.completion_percent);
      setSaved(true);
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  }

  async function bookmark() {
    const current = content;
    if (!current) return;
    try {
      await toggleBookmark(current.id, current.is_bookmarked);
      setContent((latest) => latest ? { ...latest, is_bookmarked: !current.is_bookmarked } : latest);
    } catch {
      setFailed(true);
    }
  }

  return (
    <div className="learning-object-page">
      <header className="learning-object-header">
        <Link to={`/learn/nodes/${version.academic_node_id}`}>{version.academic_node_title}</Link>
        <div>
          <span className="resource-type">{version.content_type}</span>
          <h1>{version.title}</h1>
          <p>{version.summary}</p>
        </div>
        <Button variant="secondary" onClick={() => void bookmark()}>{content.is_bookmarked ? t("removeBookmark") : t("addBookmark")}</Button>
      </header>

      {failed ? <Alert>{t("learningPartialError")}</Alert> : null}

      <div className="learning-object-workspace">
        <section className="media-workspace" aria-label={t("documentWorkspace")}>
          {version.content_type === "pdf" && primary ? (
            <object className="pdf-frame" data={apiPath(`/files/${primary.file_id}/view`)} type="application/pdf" aria-label={version.title}>
              <p>{t("pdfFallback")} <a href={apiPath(`/files/${primary.file_id}/view`)}>{t("openPdf")}</a></p>
            </object>
          ) : null}
          {version.content_type === "audio" && primary ? (
            <div className="audio-workspace"><p>{t("audioStudyCopy")}</p><audio ref={audioRef} controls preload="metadata" src={apiPath(`/files/${primary.file_id}/view`)}>{t("audioFallback")}</audio></div>
          ) : null}
          {version.content_type === "video" ? <div className="future-media"><h2>{t("videoPrepared")}</h2><p>{t("videoPreparedCopy")}</p></div> : null}
        </section>

        <aside className="study-progress-panel" aria-labelledby="progress-panel-title">
          <h2 id="progress-panel-title">{t("studyProgress")}</h2>
          <p>{t("studyProgressCopy")}</p>
          {version.content_type === "pdf" ? <FormField label={t("currentPage")} type="number" min={1} value={pageNumber} onChange={(event) => setPageNumber(Number(event.target.value))} /> : null}
          <FormField label={t("completionPercent")} type="number" min={0} max={99} value={completion} onChange={(event) => setCompletion(Number(event.target.value))} />
          <div className="study-progress-panel__actions"><Button disabled={saving} onClick={() => void save("in_progress")}>{saving ? t("saving") : t("saveProgress")}</Button><Button variant="secondary" disabled={saving} onClick={() => void save("completed")}>{t("markComplete")}</Button></div>
          {saved ? <p className="inline-success" role="status">{t("progressSaved")}</p> : null}
          {primary?.download_url ? <a className="text-action" href={apiPath(`/files/${primary.file_id}/download`)}>{t("downloadFile")}</a> : <p className="muted-copy">{t("downloadRestricted")}</p>}
        </aside>
      </div>
    </div>
  );
}
