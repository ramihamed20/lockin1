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

function NotFoundPage() {
  const { t } = useI18n();
  return <main className="not-found"><p>404</p><h1>{t("unexpectedPage")}</h1><a className="button button--primary" href="/">{t("goHome")}</a></main>;
}

export function App() {
  const { t } = useI18n();
  const pwa = usePwaStatus();
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
          <Route element={<AppShell />}>
            <Route index element={<DashboardPage />} />
            <Route path="learn" element={<LearningHomePage />} />
            <Route path="learn/nodes/:nodeId" element={<EducationNodePage />} />
            <Route path="learn/content/:contentId" element={<LearningObjectPage />} />
            <Route path="profile" element={<ProfilePage />} />
            <Route path="security" element={<SecurityPage />} />
            <Route element={<CreatorRoute />}>
              <Route path="management/content" element={<ContentStudioPage />} />
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
      {pwa.updateAvailable ? (
        <aside className="update-notice" aria-live="polite">
          <p>{t("updateReady")}</p>
          <Button onClick={() => void applyPwaUpdate()}>{t("updateNow")}</Button>
        </aside>
      ) : null}
    </>
  );
}
