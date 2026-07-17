import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { apiRequest } from "../../api/client";
import { Button } from "../../components/Button";
import { Alert, EmptyState, PageSkeleton } from "../../components/Feedback";
import { useI18n } from "../../i18n/I18nProvider";
import type { Role } from "../auth/types";
import { useAuth } from "../auth/AuthProvider";
import { learningDashboard } from "../learning/api";
import type { LearningDashboard } from "../learning/types";

type AccountDashboard = {
  roles: Role[];
  account: { email_verified: boolean; active_sessions: number; preferred_language: "en" | "ar" };
  administration?: { total: number; verified: number; suspended: number };
};

type DashboardState = { account: AccountDashboard; learning: LearningDashboard | null };

export function DashboardPage() {
  const { user } = useAuth();
  const { t } = useI18n();
  const [data, setData] = useState<DashboardState | null>(null);
  const [failed, setFailed] = useState(false);
  const [learningUnavailable, setLearningUnavailable] = useState(false);

  const load = useCallback(() => {
    const controller = new AbortController();
    void Promise.allSettled([
      apiRequest<AccountDashboard>("/dashboard", { signal: controller.signal }),
      learningDashboard(controller.signal)
    ]).then(([accountResult, learningResult]) => {
      if (controller.signal.aborted) return;
      if (accountResult.status === "rejected") { setFailed(true); return; }
      setLearningUnavailable(learningResult.status === "rejected");
      setData({ account: accountResult.value, learning: learningResult.status === "fulfilled" ? learningResult.value : null });
    });
    return () => controller.abort();
  }, []);

  useEffect(() => load(), [load]);

  if (!data && !failed) return <PageSkeleton label={t("loading")} />;
  if (failed) return <Alert><span>{t("genericError")}</span> <Button variant="secondary" onClick={() => { setFailed(false); setLearningUnavailable(false); load(); }}>{t("retry")}</Button></Alert>;
  if (!data) return null;

  const next = data.learning?.next_item;

  return (
    <div className="page page--dashboard">
      <header className="page-heading page-heading--wide">
        <h1>{t("dashboardGreeting")}, {user?.full_name.split(" ")[0]}</h1>
        <p>{t("dashboardCommandCopy")}</p>
      </header>
      {learningUnavailable ? <Alert>{t("learningPartialError")}</Alert> : null}

      <section className="next-action" aria-labelledby="next-action-title">
        <div>
          <p>{next?.reason === "resume" ? t("resumeStudy") : next?.reason === "bookmark" ? t("savedForLater") : t("nextStudySession")}</p>
          <h2 id="next-action-title">{next?.title ?? t("chooseStudyPath")}</h2>
          <span>{next ? `${next.completion_percent}% ${t("complete")}` : t("chooseStudyPathCopy")}</span>
        </div>
        <Link className="button button--primary" to={next ? `/learn/content/${next.learning_object_id}` : "/learn"}>{next ? t("continueStudy") : t("browseSubjects")}</Link>
      </section>

      <section className="command-summary" aria-label={t("learningSummary")}>
        <div><strong>{data.learning?.bookmark_count ?? 0}</strong><span>{t("bookmarks")}</span></div>
        <div><strong>{data.learning?.completed_count ?? 0}</strong><span>{t("completedItems")}</span></div>
        <div><strong>{data.learning?.review_due?.length ?? 0}</strong><span>{t("dueReview")}</span></div>
      </section>

      <section className="study-section" aria-labelledby="recent-content-title">
        <header className="study-section__heading"><h2 id="recent-content-title">{t("recentLearning")}</h2><Link to="/learn">{t("viewAllLearning")}</Link></header>
        {data.learning?.recent_content?.length ? <ul className="resource-list">{data.learning.recent_content.map((item) => <li key={item.learning_object_id}><Link to={`/learn/content/${item.learning_object_id}`}><span className="resource-type">{item.content_type}</span><strong>{item.title}</strong><span>{t("startOrContinue")}</span></Link></li>)}</ul> : <EmptyState title={t("noRecentLearning")}>{t("noRecentLearningCopy")}</EmptyState>}
      </section>

      <section className="account-readiness" aria-labelledby="account-ready-title">
        <header><h2 id="account-ready-title">{t("accountReady")}</h2><Link to="/security">{t("reviewSecurity")}</Link></header>
        <dl>
          <div><dt>{t("emailVerifiedLabel")}</dt><dd>{data.account.account.email_verified ? t("yes") : t("no")}</dd></div>
          <div><dt>{t("activeSessions")}</dt><dd>{data.account.account.active_sessions}</dd></div>
          <div><dt>{t("languageLabel")}</dt><dd>{data.account.account.preferred_language === "ar" ? t("arabic") : t("english")}</dd></div>
        </dl>
      </section>

      {data.account.administration ? (
        <section className="admin-strip" aria-labelledby="admin-summary-title">
          <h2 id="admin-summary-title">{t("adminSummary")}</h2>
          <dl><div><dt>{t("totalUsers")}</dt><dd>{data.account.administration.total}</dd></div><div><dt>{t("verifiedUsers")}</dt><dd>{data.account.administration.verified}</dd></div><div><dt>{t("suspendedUsers")}</dt><dd>{data.account.administration.suspended}</dd></div></dl>
        </section>
      ) : null}
    </div>
  );
}
