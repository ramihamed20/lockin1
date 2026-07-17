import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { Button } from "../../components/Button";
import { Alert, EmptyState, PageSkeleton } from "../../components/Feedback";
import { useI18n } from "../../i18n/I18nProvider";
import type { MessageKey } from "../../i18n/catalogs";
import { completeLesson, educationChildren, educationNode, learningObjects } from "./api";
import type { EducationNode, EducationNodeDetail, LearningObject } from "./types";

const nodeKindLabels: Record<EducationNode["kind"], MessageKey> = {
  institution: "node_institution",
  college: "node_college",
  department: "node_department",
  academic_year: "node_academic_year",
  semester: "node_semester",
  subject: "node_subject",
  unit: "node_unit",
  lesson: "node_lesson"
};

export function EducationNodePage() {
  const { nodeId = "" } = useParams();
  const { t } = useI18n();
  const [detail, setDetail] = useState<EducationNodeDetail | null>(null);
  const [children, setChildren] = useState<EducationNode[]>([]);
  const [content, setContent] = useState<LearningObject[]>([]);
  const [contentType, setContentType] = useState("");
  const [failedNodeId, setFailedNodeId] = useState<string | null>(null);
  const [lessonComplete, setLessonComplete] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      educationNode(nodeId, controller.signal),
      educationChildren(nodeId, controller.signal),
      learningObjects(nodeId, contentType, controller.signal)
    ]).then(([node, childPage, contentPage]) => {
      if (controller.signal.aborted) return;
      setDetail(node);
      setChildren(childPage.results);
      setContent(contentPage.results);
      setFailedNodeId(null);
    }).catch(() => {
      if (!controller.signal.aborted) setFailedNodeId(nodeId);
    });
    return () => controller.abort();
  }, [nodeId, contentType]);

  if (failedNodeId === nodeId) return <div className="page"><Alert>{t("learningLoadError")}</Alert></div>;
  if (!detail || detail.node.id !== nodeId) return <PageSkeleton label={t("loadingLearning")} />;

  async function markLessonComplete() {
    try {
      await completeLesson(detail!.node.id);
      setLessonComplete(true);
    } catch {
      setFailedNodeId(nodeId);
    }
  }

  return (
    <div className="page education-page">
      <nav className="breadcrumbs" aria-label={t("breadcrumbs")}>
        <Link to="/learn">{t("navLearn")}</Link>
        {detail.breadcrumbs.map((crumb) => <Link key={crumb.id} to={`/learn/nodes/${crumb.id}`} aria-current={crumb.id === detail.node.id ? "page" : undefined}>{crumb.title}</Link>)}
      </nav>
      <header className="page-heading page-heading--wide">
        <span className="resource-type">{t(nodeKindLabels[detail.node.kind])}</span>
        <h1>{detail.node.title}</h1>
        <p>{detail.node.description || t("educationNodeCopy")}</p>
      </header>

      {detail.node.kind === "lesson" ? (
        <div className="lesson-completion">
          <div><strong>{lessonComplete ? t("lessonCompleted") : t("finishLesson")}</strong><span>{t("finishLessonCopy")}</span></div>
          <Button variant={lessonComplete ? "secondary" : "primary"} disabled={lessonComplete} onClick={() => void markLessonComplete()}>{lessonComplete ? t("completed") : t("markComplete")}</Button>
        </div>
      ) : null}

      {children.length ? (
        <section className="study-section" aria-labelledby="continue-path-title">
          <header className="study-section__heading"><h2 id="continue-path-title">{t("continuePath")}</h2><span>{children.length}</span></header>
          <ul className="path-list">{children.map((child) => <li key={child.id}><Link to={`/learn/nodes/${child.id}`}><strong>{child.title}</strong><span>{child.description || t("explorePath")}</span></Link></li>)}</ul>
        </section>
      ) : null}

      <section className="study-section" aria-labelledby="learning-material-title">
        <header className="study-section__heading study-section__heading--filter">
          <div><h2 id="learning-material-title">{t("learningMaterial")}</h2><span>{content.length}</span></div>
          <label>{t("filterType")}<select value={contentType} onChange={(event) => setContentType(event.target.value)}><option value="">{t("allTypes")}</option><option value="pdf">{t("pdfDocument")}</option><option value="audio">{t("audioLesson")}</option></select></label>
        </header>
        {content.length ? (
          <ul className="resource-list">
            {content.map((item) => <li key={item.id}><Link to={`/learn/content/${item.id}`}><span className="resource-type">{item.version.content_type}</span><strong>{item.version.title}</strong><span>{item.progress ? `${item.progress.completion_percent}% ${t("complete")}` : item.version.summary || t("openLearningObject")}</span></Link></li>)}
          </ul>
        ) : <EmptyState title={t("noLearningMaterial")}>{t("noLearningMaterialCopy")}</EmptyState>}
      </section>
    </div>
  );
}
