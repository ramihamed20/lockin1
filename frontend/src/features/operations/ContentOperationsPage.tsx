import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { Button } from "../../components/Button";
import { Alert, PageSkeleton } from "../../components/Feedback";
import { useI18n } from "../../i18n/I18nProvider";
import { operationsApi } from "./api";
import { Metric, MetricStrip, OperationsSection, StatusList } from "./components";
import { useOperationsSession } from "./useOperationsSession";
import type { ContentDashboard } from "./types";

export function ContentOperationsPage() {
  const { t } = useI18n();
  const session = useOperationsSession();
  const [data, setData] = useState<ContentDashboard | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(() => {
    const controller = new AbortController();
    void operationsApi.content(controller.signal).then(setData).catch(() => {
      if (!controller.signal.aborted) setFailed(true);
    });
    return () => controller.abort();
  }, []);
  useEffect(() => load(), [load]);
  if (!data && !failed) return <PageSkeleton label={t("operationsLoading")} />;
  if (failed) return <Alert><span>{t("genericError")}</span> <Button variant="secondary" onClick={() => { setFailed(false); load(); }}>{t("retry")}</Button></Alert>;
  if (!data) return null;
  return (
    <div className="operations-page">
      <OperationsSection id="content-inventory" title={t("contentInventory")}>
        <MetricStrip>
          <Metric label={t("achievementDefinitions")} value={data.achievement_definitions} />
          <Metric label={t("openQualityReports")} value={data.quality.open_question_reports} />
        </MetricStrip>
      </OperationsSection>
      <div className="operations-domain-grid">
        <OperationsSection id="education-status" title={t("educationalStructure")}><StatusList values={data.education} /></OperationsSection>
        <OperationsSection id="learning-object-status" title={t("learningObjects")}><StatusList values={data.learning_objects} /></OperationsSection>
        <OperationsSection id="question-status" title={t("questions")}><StatusList values={data.questions} /></OperationsSection>
        <OperationsSection id="quiz-status" title={t("quizzes")}><StatusList values={data.quizzes} /></OperationsSection>
      </div>
      <div className="operations-actions-row">
        {session.capabilities.includes("content.manage") ? <Link className="button button--secondary" to="/management/content">{t("manageContent")}</Link> : null}
        {session.capabilities.includes("assessments.manage") ? <Link className="button button--secondary" to="/management/assessments">{t("manageAssessments")}</Link> : null}
      </div>
    </div>
  );
}
