import { useEffect, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";

import { apiRequest } from "../../api/client";
import { LegacyIcon } from "../../legacy/LegacyIcon";
import { useI18n } from "../../i18n/I18nProvider";
import type { Role } from "../auth/types";
import { learningDashboard } from "../learning/api";
import type { LearningDashboard } from "../learning/types";
import { progressionApi } from "../motivation/api";
import type { StreakSummary, XpSummary } from "../motivation/types";

type AccountDashboard = {
  roles: Role[];
  account: { email_verified: boolean; active_sessions: number; preferred_language: "en" | "ar" };
  administration?: { total: number; verified: number; suspended: number };
};

type DashboardState = {
  account: AccountDashboard;
  learning: LearningDashboard | null;
  xp: XpSummary | null;
  streak: StreakSummary | null;
};

function CompactStat({ icon, value, label, detail }: { icon: Parameters<typeof LegacyIcon>[0]["name"]; value: string | number; label: string; detail: string }) {
  return (
    <article className="stat-card">
      <span className="stat-icon"><LegacyIcon name={icon} /></span>
      <div><strong>{value}</strong><p>{label}<small>{detail}</small></p></div>
    </article>
  );
}

function ContinueCard({ data }: { data: LearningDashboard | null }) {
  const { locale, t } = useI18n();
  const next = data?.next_item;
  const reviewCount = data?.review_due.length ?? 0;
  return (
    <article className="panel continue-card">
      <p className="eyebrow">{locale === "ar" ? "تابع دراستك" : "Continue Studying"}</p>
      <h2>{next?.title ?? t("chooseStudyPath")}</h2>
      <div className="progress-line" aria-label={next ? `${next.completion_percent}% ${t("complete")}` : undefined}><span style={{ width: `${next?.completion_percent ?? 0}%` }} /></div>
      <div className="progress-meta"><span>{next ? `${reviewCount} ${t("dueReview").toLowerCase()}` : t("chooseStudyPathCopy")}</span><strong>{next ? `${next.completion_percent}%` : ""}</strong></div>
      <Link className="btn btn-primary" to={next ? `/learn/content/${next.learning_object_id}` : "/learn"}>{next ? t("continueStudy") : t("browseSubjects")}</Link>
    </article>
  );
}

function StreakGoalCard({ streak }: { streak: StreakSummary | null }) {
  const { locale } = useI18n();
  const days = streak?.current_days ?? 0;
  const longest = streak?.longest_days ?? 0;
  const personalBestProgress = longest ? Math.round((days / longest) * 100) : 0;
  return (
    <article className="panel daily-goal-card">
      <div className="daily-goal-ring" style={{ "--goal-progress": `${personalBestProgress}%` } as CSSProperties}>
        <strong>{days}</strong><span>{locale === "ar" ? "أيام" : "days"}</span>
      </div>
      <div>
        <p className="eyebrow">{locale === "ar" ? "المواظبة" : "Study Streak"}</p>
        <h2>{days === 1 ? (locale === "ar" ? "يوم واحد متتالٍ" : "1 day in a row") : (locale === "ar" ? `${days} أيام متتالية` : `${days} days in a row`)}</h2>
        <p>{longest ? (locale === "ar" ? `أفضل سلسلة لديك: ${longest} يومًا.` : `Your personal best is ${longest} days.`) : (locale === "ar" ? "أكمل نشاطًا دراسيًا لبدء المواظبة." : "Complete a study activity to begin your streak.")}</p>
        <Link className="btn btn-soft" to="/progression">{locale === "ar" ? "عرض التقدّم" : "View progress"}</Link>
      </div>
    </article>
  );
}

function ReviewCard({ learning }: { learning: LearningDashboard | null }) {
  const { locale, t } = useI18n();
  const due = learning?.review_due.length ?? 0;
  const completed = learning?.completed_count ?? 0;
  const saved = learning?.bookmark_count ?? 0;
  return (
    <article className={`panel dashboard-review-card${due ? " urgent" : ""}`}>
      <div className="panel-title"><div><p className="eyebrow">{locale === "ar" ? "قائمة المراجعة" : "Review Queue"}</p><h2>{due ? `${due} ${t("dueReview").toLowerCase()}` : (locale === "ar" ? "لا توجد مراجعات مستحقة" : "No reviews due")}</h2></div><span><LegacyIcon name="target" size={16} /></span></div>
      <div className="review-pulse-row">
        <div><strong>{due}</strong><span>{t("dueReview")}</span></div>
        <div><strong>{completed}</strong><span>{t("completedItems")}</span></div>
        <div><strong>{saved}</strong><span>{t("bookmarks")}</span></div>
      </div>
      <div className="dashboard-review-list">
        <p>{due ? (locale === "ar" ? "افتح التقييم لمراجعة العناصر المستحقة الآن." : "Open assessments to work through the items due now.") : (locale === "ar" ? "ستظهر المواد المستحقة هنا عند توفرها." : "Due learning will appear here when it is ready.")}</p>
      </div>
      <Link className={due ? "btn btn-primary" : "btn btn-soft"} to="/assessments">{due ? (locale === "ar" ? "ابدأ المراجعة" : "Start review") : (locale === "ar" ? "فتح التقييمات" : "Open assessments")}</Link>
    </article>
  );
}

function LevelCard({ xp }: { xp: XpSummary | null }) {
  const { locale } = useI18n();
  const progress = xp?.level_target ? Math.round((xp.level_progress / xp.level_target) * 100) : 0;
  return (
    <article className="panel level-card">
      <div className="level-badge"><span>LVL</span><strong>{xp?.level ?? 0}</strong></div>
      <div>
        <p className="eyebrow">{locale === "ar" ? "مستوى XP" : "XP Level"}</p>
        <h2>{xp ? (locale === "ar" ? "تقدّمك الدراسي" : "Learning progression") : (locale === "ar" ? "جارٍ تحميل التقدّم" : "Loading progression")}</h2>
        <div className="progress-line" aria-label={locale === "ar" ? "تقدم المستوى" : "Level progress"}><span style={{ width: `${progress}%` }} /></div>
        <div className="progress-meta"><span>{(xp?.total_points ?? 0).toLocaleString(locale)} XP</span><strong>{xp ? `${xp.level_progress.toLocaleString(locale)} / ${xp.level_target.toLocaleString(locale)}` : ""}</strong></div>
      </div>
    </article>
  );
}

function RecentLearningCard({ learning }: { learning: LearningDashboard | null }) {
  const { locale, t } = useI18n();
  const items = learning?.recent_content ?? [];
  return (
    <article className="panel study-table-card">
      <div className="panel-title"><h2>{t("recentLearning")}</h2><span>{items.length}</span></div>
      <div className="plan-list">
        {items.length ? items.slice(0, 5).map((item) => (
          <Link className="plan-row" key={item.learning_object_id} to={`/learn/content/${item.learning_object_id}`}>
            <strong>{item.content_type.toUpperCase()}</strong><span>{item.title}</span><LegacyIcon name="chevron-right" size={17} />
          </Link>
        )) : <p className="dashboard-empty-copy">{t("noRecentLearningCopy")}</p>}
      </div>
      <Link className="btn btn-soft" to="/learn">{locale === "ar" ? "استكشف التعلّم" : "Explore learning"}</Link>
    </article>
  );
}

function AccountCard({ account }: { account: AccountDashboard }) {
  const { locale, t } = useI18n();
  return (
    <article className="panel onboarding-summary-card">
      <div className="panel-title"><div><p className="eyebrow">{locale === "ar" ? "الحساب" : "Account"}</p><h2>{t("accountReady")}</h2></div><span><LegacyIcon name="shield" size={16} /></span></div>
      <div className="onboarding-summary-grid">
        <div><span>{t("emailVerifiedLabel")}</span><strong>{account.account.email_verified ? t("yes") : t("no")}</strong></div>
        <div><span>{t("activeSessions")}</span><strong>{account.account.active_sessions}</strong></div>
        <div><span>{t("languageLabel")}</span><strong>{account.account.preferred_language === "ar" ? t("arabic") : t("english")}</strong></div>
      </div>
      <Link className="btn btn-soft" to="/security">{t("reviewSecurity")}</Link>
    </article>
  );
}

function AdministrationCard({ administration }: { administration: NonNullable<AccountDashboard["administration"]> }) {
  const { locale, t } = useI18n();
  return (
    <article className="panel onboarding-summary-card">
      <div className="panel-title"><div><p className="eyebrow">{locale === "ar" ? "المنصة" : "Platform"}</p><h2>{t("adminSummary")}</h2></div><span><LegacyIcon name="user" size={16} /></span></div>
      <div className="onboarding-summary-grid">
        <div><span>{t("totalUsers")}</span><strong>{administration.total}</strong></div>
        <div><span>{t("verifiedUsers")}</span><strong>{administration.verified}</strong></div>
        <div><span>{t("suspendedUsers")}</span><strong>{administration.suspended}</strong></div>
      </div>
      <Link className="btn btn-soft" to="/admin/people">{locale === "ar" ? "إدارة المستخدمين" : "Manage people"}</Link>
    </article>
  );
}

export function DashboardPage() {
  const { locale, t } = useI18n();
  const [data, setData] = useState<DashboardState | null>(null);
  const [failed, setFailed] = useState(false);
  const [partialError, setPartialError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.allSettled([
      apiRequest<AccountDashboard>("/dashboard", { signal: controller.signal }),
      learningDashboard(controller.signal),
      progressionApi.xp(controller.signal),
      progressionApi.streak(controller.signal)
    ]).then(([accountResult, learningResult, xpResult, streakResult]) => {
      if (controller.signal.aborted) return;
      if (accountResult.status === "rejected") {
        setFailed(true);
        setLoading(false);
        return;
      }
      setPartialError([learningResult, xpResult, streakResult].some((result) => result.status === "rejected"));
      setData({
        account: accountResult.value,
        learning: learningResult.status === "fulfilled" ? learningResult.value : null,
        xp: xpResult.status === "fulfilled" ? xpResult.value : null,
        streak: streakResult.status === "fulfilled" ? streakResult.value : null
      });
      setLoading(false);
    });
    return () => controller.abort();
  }, [revision]);

  if (loading) {
    return <div className="dashboard-layout" aria-busy="true"><section className="panel"><p className="eyebrow">Lock-in</p><h2>{t("loading")}</h2></section></div>;
  }
  if (failed || !data) {
    return <div className="dashboard-layout"><section className="panel"><p className="form-alert error" role="alert">{t("genericError")}</p><button className="btn btn-primary" type="button" onClick={() => { setLoading(true); setFailed(false); setPartialError(false); setRevision((value) => value + 1); }}>{t("retry")}</button></section></div>;
  }

  const learning = data.learning;
  return (
    <div className="dashboard-layout">
      {partialError ? <p className="form-alert error" role="status">{t("learningPartialError")}</p> : null}
      <section className="stats-grid" aria-label={t("learningSummary")}>
        <CompactStat icon="file" value={learning?.completed_count ?? 0} label={t("completedItems")} detail={locale === "ar" ? "مواد مكتملة" : "learning items"} />
        <CompactStat icon="bookmark" value={learning?.bookmark_count ?? 0} label={t("bookmarks")} detail={locale === "ar" ? "محفوظة" : "saved items"} />
        <CompactStat icon="target" value={learning?.review_due.length ?? 0} label={t("dueReview")} detail={locale === "ar" ? "جاهزة الآن" : "ready now"} />
        <CompactStat icon="award" value={(data.xp?.total_points ?? 0).toLocaleString(locale)} label="XP" detail={locale === "ar" ? "مكتسبة" : "earned"} />
        <CompactStat icon="activity" value={data.streak?.current_days ?? 0} label={locale === "ar" ? "المواظبة" : "Streak"} detail={locale === "ar" ? "أيام متتالية" : "days in a row"} />
      </section>
      <section className="dashboard-main">
        <div className="dashboard-left">
          <ContinueCard data={learning} />
          <StreakGoalCard streak={data.streak} />
          <ReviewCard learning={learning} />
        </div>
        <div className="dashboard-right">
          <LevelCard xp={data.xp} />
          <RecentLearningCard learning={learning} />
          <AccountCard account={data.account} />
          {data.account.administration ? <AdministrationCard administration={data.account.administration} /> : null}
        </div>
      </section>
    </div>
  );
}
