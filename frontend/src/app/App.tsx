import { lazy, Suspense } from "react";
import { Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";

import { Button } from "../components/Button";
import { PageSkeleton } from "../components/Feedback";
import { PeoplePage } from "../features/admin/PeoplePage";
import { ProfilePage } from "../features/account/ProfilePage";
import { SecurityPage } from "../features/account/SecurityPage";
import { AuthLayout } from "../features/auth/AuthLayout";
import { useAuth } from "../features/auth/AuthProvider";
import {
  ForgotPasswordPage,
  LoginPage,
  RegisterPage,
  ResetPasswordPage,
  TokenConfirmationPage
} from "../features/auth/AuthPages";
import { DashboardPage } from "../features/dashboard/DashboardPage";
import { useI18n } from "../i18n/I18nProvider";
import { AppShell } from "../layouts/AppShell";
import { applyPwaUpdate, usePwaStatus } from "../pwa/update";

const LearningHomePage = lazy(() => import("../features/learning/LearningHomePage").then((module) => ({ default: module.LearningHomePage })));
const EducationNodePage = lazy(() => import("../features/learning/EducationNodePage").then((module) => ({ default: module.EducationNodePage })));
const LearningObjectPage = lazy(() => import("../features/learning/LearningObjectPage").then((module) => ({ default: module.LearningObjectPage })));
const ContentStudioPage = lazy(() => import("../features/management/ContentStudioPage").then((module) => ({ default: module.ContentStudioPage })));
const EducationAdminPage = lazy(() => import("../features/management/EducationAdminPage").then((module) => ({ default: module.EducationAdminPage })));
const AssessmentHomePage = lazy(() => import("../features/assessment/AssessmentHomePage").then((module) => ({ default: module.AssessmentHomePage })));
const QuizOverviewPage = lazy(() => import("../features/assessment/QuizOverviewPage").then((module) => ({ default: module.QuizOverviewPage })));
const AttemptPage = lazy(() => import("../features/assessment/AttemptPage").then((module) => ({ default: module.AttemptPage })));
const ResultPage = lazy(() => import("../features/assessment/ResultPage").then((module) => ({ default: module.ResultPage })));
const AssessmentStudioPage = lazy(() => import("../features/assessment/management/AssessmentStudioPage").then((module) => ({ default: module.AssessmentStudioPage })));
const CommunityPage = lazy(() => import("../features/community/CommunityPage").then((module) => ({ default: module.CommunityPage })));
const DiscussionPage = lazy(() => import("../features/community/DiscussionPage").then((module) => ({ default: module.DiscussionPage })));
const SpacePage = lazy(() => import("../features/community/SpacePage").then((module) => ({ default: module.SpacePage })));
const ModerationPage = lazy(() => import("../features/community/ModerationPage").then((module) => ({ default: module.ModerationPage })));
const ProgressionPage = lazy(() => import("../features/motivation/ProgressionPage").then((module) => ({ default: module.ProgressionPage })));
const NotificationsPage = lazy(() => import("../features/motivation/NotificationsPage").then((module) => ({ default: module.NotificationsPage })));
const BillingPage = lazy(() => import("../features/billing/BillingPage").then((module) => ({ default: module.BillingPage })));
const OperationsLayout = lazy(() => import("../features/operations/OperationsLayout").then((module) => ({ default: module.OperationsLayout })));
const OperationsOverviewPage = lazy(() => import("../features/operations/OperationsOverviewPage").then((module) => ({ default: module.OperationsOverviewPage })));
const ContentOperationsPage = lazy(() => import("../features/operations/ContentOperationsPage").then((module) => ({ default: module.ContentOperationsPage })));
const SupportOperationsPage = lazy(() => import("../features/operations/SupportOperationsPage").then((module) => ({ default: module.SupportOperationsPage })));
const UserOperationsPage = lazy(() => import("../features/operations/UserOperationsPage").then((module) => ({ default: module.UserOperationsPage })));
const AuditPage = lazy(() => import("../features/operations/AuditPage").then((module) => ({ default: module.AuditPage })));
const ReportsPage = lazy(() => import("../features/operations/ReportsPage").then((module) => ({ default: module.ReportsPage })));
const ConfigurationPage = lazy(() => import("../features/operations/ConfigurationPage").then((module) => ({ default: module.ConfigurationPage })));

function ProtectedRoute() {
  const { status } = useAuth();
  const { t } = useI18n();
  const location = useLocation();
  if (status === "loading") return <PageSkeleton label={t("loading")} />;
  if (status === "anonymous") return <Navigate to="/login" replace state={{ from: location }} />;
  return <Outlet />;
}

function AdministratorRoute() {
  const { user } = useAuth();
  return user?.roles.includes("administrator") ? <Outlet /> : <Navigate to="/" replace />;
}

function CreatorRoute() {
  const { user } = useAuth();
  return user?.roles.some((role) => role === "creator" || role === "administrator") ? <Outlet /> : <Navigate to="/" replace />;
}

function CommunityModeratorRoute() {
  const { user } = useAuth();
  return user?.roles.some((role) => ["creator", "moderator", "administrator"].includes(role))
    ? <Outlet />
    : <Navigate to="/community" replace />;
}

function NotFoundPage() {
  const { t } = useI18n();
  return <main className="not-found"><p>404</p><h1>{t("unexpectedPage")}</h1><a className="button button--primary" href="/">{t("goHome")}</a></main>;
}

export function App() {
  const { t } = useI18n();
  const pwa = usePwaStatus();
  const location = useLocation();
  const assessmentInProgress = location.pathname.startsWith("/assessments/attempts/");
  return (
    <>
      <Suspense fallback={<PageSkeleton label={t("loading")} />}>
      <Routes>
        <Route element={<AuthLayout />}>
          <Route path="login" element={<LoginPage />} />
          <Route path="register" element={<RegisterPage />} />
          <Route path="forgot-password" element={<ForgotPasswordPage />} />
          <Route path="reset-password" element={<ResetPasswordPage />} />
          <Route path="verify-email" element={<TokenConfirmationPage mode="verify" />} />
          <Route path="confirm-email" element={<TokenConfirmationPage mode="email-change" />} />
        </Route>
        <Route element={<ProtectedRoute />}>
          <Route path="assessments/attempts/:attemptId" element={<AttemptPage />} />
          <Route element={<AppShell />}>
            <Route index element={<DashboardPage />} />
            <Route path="learn" element={<LearningHomePage />} />
            <Route path="learn/nodes/:nodeId" element={<EducationNodePage />} />
            <Route path="learn/content/:contentId" element={<LearningObjectPage />} />
            <Route path="assessments" element={<AssessmentHomePage />} />
            <Route path="assessments/quizzes/:quizId" element={<QuizOverviewPage />} />
            <Route path="assessments/results/:resultId" element={<ResultPage />} />
            <Route path="community" element={<CommunityPage />} />
            <Route path="community/context/:contextType/:contextId" element={<CommunityPage />} />
            <Route path="community/discussions/:discussionId" element={<DiscussionPage />} />
            <Route path="community/spaces/:spaceId" element={<SpacePage />} />
            <Route path="progression" element={<ProgressionPage />} />
            <Route path="notifications" element={<NotificationsPage />} />
            <Route path="subscription" element={<BillingPage />} />
            <Route path="profile" element={<ProfilePage />} />
            <Route path="security" element={<SecurityPage />} />
            <Route path="operations" element={<OperationsLayout />}>
              <Route index element={<OperationsOverviewPage />} />
              <Route path="content" element={<ContentOperationsPage />} />
              <Route path="support" element={<SupportOperationsPage />} />
              <Route path="users" element={<UserOperationsPage />} />
              <Route path="audit" element={<AuditPage />} />
              <Route path="reports" element={<ReportsPage />} />
              <Route path="configuration" element={<ConfigurationPage />} />
            </Route>
            <Route element={<CreatorRoute />}>
              <Route path="management/content" element={<ContentStudioPage />} />
              <Route path="management/assessments" element={<AssessmentStudioPage />} />
            </Route>
            <Route element={<CommunityModeratorRoute />}>
              <Route path="moderation" element={<ModerationPage />} />
            </Route>
            <Route element={<AdministratorRoute />}>
              <Route path="admin/people" element={<PeoplePage />} />
              <Route path="admin/education" element={<EducationAdminPage />} />
            </Route>
          </Route>
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
      </Suspense>
      {pwa.updateAvailable && !assessmentInProgress ? (
        <aside className="update-notice" aria-live="polite">
          <p>{t("updateReady")}</p>
          <Button onClick={() => void applyPwaUpdate()}>{t("updateNow")}</Button>
        </aside>
      ) : null}
    </>
  );
}
