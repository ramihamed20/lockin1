import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { authApi, isApiError, onUnauthorized } from "./lib/api.js";
import {
  autoThemeForDate,
  assetPath,
  normalizeThemeSettings,
  parseReminderTime,
  readLocalThemeSettings,
  readReminderSettings,
  reminderKey,
  todayStamp
} from "./lib/utils.js";
import { appIconOptions } from "./lib/constants.js";
import { Shell } from "./components/layout/index.jsx";
import { AuthPage } from "./components/auth/AuthPage.jsx";
import { FullScreenState, ReminderToast } from "./components/shared/index.jsx";
import { bootFailureMessage, bootRetryDelayMs, shouldRetryBootAutomatically } from "./lib/sessionBootstrap.js";
import { LoadingPanel } from "./components/ui/index.jsx";
import { ErrorBoundary } from "./components/ErrorBoundary.jsx";
import { ProtectedRoute } from "./components/auth/ProtectedRoute.jsx";
import { TokenActionPage } from "./components/auth/TokenActionPage.jsx";
import { setSessionMarker } from "./api/client.js";
import { lazyWithRecovery } from "./lib/lazyWithRecovery.js";
import { useVisibleNow } from "./hooks/useVisibleNow.js";
import { useI18n } from "./components/I18nProvider.jsx";
import { NotFoundPage } from "./components/ui/index.jsx";
import { PublicInfoPage } from "./components/PublicInfoPage.jsx";
import { SubscriptionSessionProvider } from "./lib/SubscriptionSessionContext.jsx";
import { clearSubscriptionSnapshots } from "./lib/subscriptionSession.js";

// --- Lazy-loaded pages ---
const Dashboard = lazyWithRecovery(() => import("./pages/Dashboard.jsx"));
const StudyPlan = lazyWithRecovery(() => import("./pages/StudyPlan.jsx"));
const Materials = lazyWithRecovery(() => import("./pages/Materials.jsx"));
const MaterialSheets = lazyWithRecovery(() => import("./pages/Materials.jsx").then((m) => ({ default: m.MaterialSheets })));
const CatalogMaterialSheets = lazyWithRecovery(() => import("./pages/Materials.jsx").then((m) => ({ default: m.CatalogMaterialSheets })));
const CatalogSheetStudy = lazyWithRecovery(() => import("./pages/Materials.jsx").then((m) => ({ default: m.CatalogSheetStudy })));
const CatalogFocusWorkspace = lazyWithRecovery(() => import("./pages/CatalogFocusWorkspace.jsx"));
const LearningObjectStudy = lazyWithRecovery(() => import("./pages/LearningObjectStudy.jsx"));
const LockInMode = lazyWithRecovery(() => import("./pages/LockInMode.jsx"));
const Search = lazyWithRecovery(() => import("./pages/Search.jsx"));
const Questions = lazyWithRecovery(() => import("./pages/Questions.jsx"));
const QuestionCategory = lazyWithRecovery(() => import("./pages/Questions.jsx").then((module) => ({ default: module.QuestionCategory })));
const QuestionSubjectQuizzes = lazyWithRecovery(() => import("./pages/Questions.jsx").then((module) => ({ default: module.QuestionSubjectQuizzes })));
const DemoQuiz = lazyWithRecovery(() => import("./pages/Questions.jsx").then((module) => ({ default: module.DemoQuiz })));
const QuizDetail = lazyWithRecovery(() => import("./pages/QuizDetail.jsx"));
const Attempt = lazyWithRecovery(() => import("./pages/Attempt.jsx"));
const AssessmentResult = lazyWithRecovery(() => import("./pages/AssessmentResult.jsx"));
const Review = lazyWithRecovery(() => import("./pages/Review.jsx"));
const ReviewBank = lazyWithRecovery(() => import("./pages/Review.jsx").then((module) => ({ default: module.ReviewBank })));
const SubjectReviewSession = lazyWithRecovery(() => import("./pages/Review.jsx").then((module) => ({ default: module.SubjectReviewSession })));
const WeeklyRecall = lazyWithRecovery(() => import("./pages/Review.jsx").then((module) => ({ default: module.WeeklyRecall })));
const Community = lazyWithRecovery(() => import("./pages/Community.jsx"));
const CommunityContext = lazyWithRecovery(() => import("./pages/Community.jsx").then((module) => ({ default: module.CommunityContext })));
const Discussion = lazyWithRecovery(() => import("./pages/Discussion.jsx"));
const CommunitySpace = lazyWithRecovery(() => import("./pages/CommunitySpace.jsx"));
const CommunityReport = lazyWithRecovery(() => import("./pages/CommunityReport.jsx"));
const Ranked = lazyWithRecovery(() => import("./pages/Ranked.jsx"));
const Bookmarks = lazyWithRecovery(() => import("./pages/Bookmarks.jsx"));
const Progress = lazyWithRecovery(() => import("./pages/Progress.jsx"));
const Achievements = lazyWithRecovery(() => import("./pages/Achievements.jsx"));
const Notifications = lazyWithRecovery(() => import("./pages/Notifications.jsx"));
const Store = lazyWithRecovery(() => import("./pages/Store.jsx"));
const Profile = lazyWithRecovery(() => import("./pages/Profile.jsx"));
const Settings = lazyWithRecovery(() => import("./pages/Settings.jsx"));
const CreatorEducation = lazyWithRecovery(() => import("./pages/CreatorEducation.jsx"));
const CreatorContent = lazyWithRecovery(() => import("./pages/CreatorContent.jsx"));
const CreatorContentDetail = lazyWithRecovery(() => import("./pages/CreatorContent.jsx").then((module) => ({ default: module.CreatorContentDetail })));
const CreatorQuestions = lazyWithRecovery(() => import("./pages/CreatorAssessments.jsx").then((module) => ({ default: module.CreatorQuestions })));
const CreatorQuestionDetail = lazyWithRecovery(() => import("./pages/CreatorAssessments.jsx").then((module) => ({ default: module.CreatorQuestionDetail })));
const CreatorQuizzes = lazyWithRecovery(() => import("./pages/CreatorAssessments.jsx").then((module) => ({ default: module.CreatorQuizzes })));
const CreatorQuizDetail = lazyWithRecovery(() => import("./pages/CreatorAssessments.jsx").then((module) => ({ default: module.CreatorQuizDetail })));
const CreatorRoute = lazyWithRecovery(() => import("./components/creator/index.jsx").then((module) => ({ default: module.CreatorRoute })));
const OperationsAdmin = lazyWithRecovery(() => import("./pages/OperationsAdmin.jsx"));

const THEME_META_COLORS = {
  light: "#F4F5F7",
  day: "#F4F5F7",
  dawn: "#F3F1EC",
  sunset: "#F3ECEA",
  night: "#070B16"
};
const Subscription = lazyWithRecovery(() => import("./pages/Subscription.jsx"));
const WelcomeOnboarding = lazyWithRecovery(() => import("./pages/WelcomeOnboarding.jsx"));
const Moderation = lazyWithRecovery(() => import("./pages/Moderation.jsx"));

function mergeRemoteThemeSettings(remoteSettings, currentSettings) {
  return normalizeThemeSettings({
    ...remoteSettings,
    // App icon selection is a device preference. The current profile endpoint
    // does not store it, so retain the locally selected icon across sign-in.
    appIcon: remoteSettings?.appIcon || currentSettings?.appIcon
  });
}

function App() {
  const location = useLocation();
  const { setLocale } = useI18n();
  const [themeSettings, setThemeSettings] = useState(readLocalThemeSettings);
  const [reminderSettings, setReminderSettings] = useState(() => readReminderSettings());
  const clockTick = useVisibleNow(themeSettings.autoTheme || reminderSettings.enabled, 60_000);
  const [reminderToast, setReminderToast] = useState("");
  const [user, setUser] = useState(null);
  const [operationsSession, setOperationsSession] = useState(null);
  const operationsRequestRef = useRef(0);
  const [booting, setBooting] = useState(true);
  const [bootError, setBootError] = useState(null);
  const [bootRetrying, setBootRetrying] = useState(false);
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine !== false);
  const bootRetryAttemptsRef = useRef(0);
  const bootErrorRef = useRef(null);
  const bootingRef = useRef(true);
  const oauthSessionBootRef = useRef(new URLSearchParams(window.location.search).has("oauth"));
  const [sessionAttempt, setSessionAttempt] = useState(0);
  const [sessionNotice, setSessionNotice] = useState("");
  const [notificationVersion, setNotificationVersion] = useState(0);
  const [storeCartCount, setStoreCartCount] = useState(0);
  const [lockBalance, setLockBalance] = useState(0);
  const activeTheme = themeSettings.autoTheme
    ? autoThemeForDate(new Date(clockTick))
    : themeSettings.theme;
  const inLockInMode = location.pathname === "/lock-in" || location.pathname.startsWith("/lock-in/");
  const inFocusWorkspace = location.pathname.endsWith("/workspace");

  const clearOperationsSession = useCallback(() => {
    operationsRequestRef.current += 1;
    setOperationsSession(null);
  }, []);

  const loadOperationsSession = useCallback(async () => {
    const requestId = operationsRequestRef.current + 1;
    operationsRequestRef.current = requestId;
    try {
      const nextOperationsSession = await authApi.operationsSession();
      if (operationsRequestRef.current === requestId) {
        setOperationsSession(nextOperationsSession);
      }
      return nextOperationsSession;
    } catch {
      // Students and other non-operational users correctly receive 403. A
      // missing or failed capability response must never grant fallback access.
      if (operationsRequestRef.current === requestId) setOperationsSession(null);
      return null;
    }
  }, []);

  const clearAuthenticatedUi = useCallback(() => {
    // Lock In uses only a per-user return-route hint locally; authoritative
    // session data remains in Django. Never carry that hint into another user.
    try {
      Object.keys(window.sessionStorage)
        .filter((key) => key.startsWith("lock-in.return."))
        .forEach((key) => window.sessionStorage.removeItem(key));
    } catch { /* Storage may be unavailable in privacy-restricted browsers. */ }
    setSessionMarker(false);
    clearSubscriptionSnapshots();
    setUser(null);
    clearOperationsSession();
  }, [clearOperationsSession]);

  const refreshActiveAccount = useCallback(async () => {
    try {
      const nextUser = await authApi.me();
      clearSubscriptionSnapshots();
      setUser(nextUser);
      setThemeSettings((current) => mergeRemoteThemeSettings(nextUser.themeSettings, current));
      await loadOperationsSession();
      return nextUser;
    } catch (error) {
      if (isApiError(error) && (error.status === 401 || error.status === 403)) {
        clearAuthenticatedUi();
        return null;
      }
      throw error;
    }
  }, [clearAuthenticatedUi, loadOperationsSession]);

  useEffect(() => {
    document.documentElement.dataset.theme = activeTheme;
    document.documentElement.dataset.character = themeSettings.character;
    document.documentElement.dataset.appIcon = themeSettings.appIcon;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_META_COLORS[activeTheme] || THEME_META_COLORS.night);
    localStorage.setItem("lock-in.theme", activeTheme);
    localStorage.setItem("lock-in.theme.settings", JSON.stringify(themeSettings));
  }, [activeTheme, themeSettings]);

  useEffect(() => {
    const selectedIcon = appIconOptions.find((option) => option.id === themeSettings.appIcon) || appIconOptions[0];
    const setIconHref = (id, path) => {
      const link = document.getElementById(id);
      if (link) link.setAttribute("href", assetPath(path));
    };

    setIconHref("app-apple-touch-icon", selectedIcon.appleTouchIcon);
    setIconHref("app-favicon-32", selectedIcon.favicon);
    setIconHref("app-favicon-16", selectedIcon.favicon16);
    setIconHref("app-shortcut-icon", selectedIcon.favicon);
  }, [themeSettings.appIcon]);

  useEffect(() => {
    if (user?.preferredLanguage) {
      setLocale(user.preferredLanguage === "ar" ? "ar" : "en");
    }
  }, [setLocale, user?.preferredLanguage]);

  useEffect(() => {
    if (!booting && user && new URLSearchParams(window.location.search).has("oauth")) {
      window.history.replaceState(
        window.history.state,
        "",
        `${window.location.pathname}${window.location.hash}`
      );
    }
  }, [booting, user]);

  useEffect(() => {
    setReminderSettings(readReminderSettings(user?.email));
  }, [user?.email]);

  useEffect(() => {
    localStorage.setItem(reminderKey(user?.email), JSON.stringify(reminderSettings));
  }, [user?.email, reminderSettings]);

  useEffect(() => {
    if (!reminderSettings.enabled) return;
    const now = new Date(clockTick);
    const { hours, minutes } = parseReminderTime(reminderSettings.time);
    const target = new Date(now);
    target.setHours(hours, minutes, 0, 0);
    const shouldPing = now >= target && reminderSettings.lastSentDate !== todayStamp(now);
    if (!shouldPing) return;
    const message = `Reminder: your ${reminderSettings.time} study block is ready.`;
    setReminderSettings((current) => ({ ...current, lastSentDate: todayStamp(now) }));
    setReminderToast(message);
    if (window.Notification && Notification.permission === "granted") {
      new Notification("Lock-in study reminder", { body: message });
    }
  }, [clockTick, reminderSettings]);

  useEffect(() => onUnauthorized(() => {
    clearAuthenticatedUi();
    bootRetryAttemptsRef.current = 0;
    setBootError(null);
    setBooting(false);
  }), [clearAuthenticatedUi]);

  useEffect(() => {
    bootErrorRef.current = bootError;
    bootingRef.current = booting;
  }, [bootError, booting]);

  const retryBootstrap = useCallback(() => {
    // One bootstrap at a time. A queued retry would race the in-flight request
    // and could resolve against a session that has already been replaced.
    if (bootingRef.current) return;
    bootRetryAttemptsRef.current = 0;
    setBootRetrying(false);
    setSessionAttempt((attempt) => attempt + 1);
  }, []);

  // A transient failure retries a bounded number of times behind a short
  // backoff before the reader is asked to do anything.
  useEffect(() => {
    if (!bootError) return undefined;
    if (!shouldRetryBootAutomatically(bootError, { online, attempts: bootRetryAttemptsRef.current })) {
      setBootRetrying(false);
      return undefined;
    }
    const attempt = bootRetryAttemptsRef.current + 1;
    bootRetryAttemptsRef.current = attempt;
    setBootRetrying(true);
    const timer = window.setTimeout(() => setSessionAttempt((value) => value + 1), bootRetryDelayMs(attempt));
    return () => window.clearTimeout(timer);
  }, [bootError, online]);

  useEffect(() => {
    const goOnline = () => {
      setOnline(true);
      if (bootErrorRef.current && !bootingRef.current) retryBootstrap();
    };
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, [retryBootstrap]);

  useEffect(() => {
    let active = true;
    setBooting(true);
    setBootError(null);

    authApi
      .me()
      .then(async (nextUser) => {
        if (!active) return;
        bootRetryAttemptsRef.current = 0;
        if (oauthSessionBootRef.current) clearSubscriptionSnapshots();
        setUser(nextUser);
        setThemeSettings((current) => mergeRemoteThemeSettings(nextUser.themeSettings, current));
        await loadOperationsSession();
      })
      .catch((error) => {
        if (!active) return;
        // GET /auth/session is authentication-specific: this Django setup uses
        // 403 for anonymous sessions and 401 for expired session credentials.
        if (isApiError(error) && (error.status === 401 || error.status === 403)) {
          bootRetryAttemptsRef.current = 0;
          setUser(null);
          return;
        }
        setBootError(error);
      })
      .finally(() => {
        if (active) setBooting(false);
      });

    return () => {
      active = false;
    };
  }, [loadOperationsSession, sessionAttempt]);

  function applyAuthedUser(nextUser, { newSession = false } = {}) {
    setSessionNotice("");
    if (newSession) clearSubscriptionSnapshots();
    setUser(nextUser);
    setThemeSettings((current) => mergeRemoteThemeSettings(nextUser.themeSettings, current));
    clearOperationsSession();
    void loadOperationsSession();
  }

  function updateThemeSettings(nextSettings) {
    setThemeSettings(normalizeThemeSettings(nextSettings));
    setUser((current) => current ? { ...current, themeSettings: normalizeThemeSettings(nextSettings) } : current);
  }

  function setManualTheme(nextTheme) {
    updateThemeSettings({ ...themeSettings, theme: nextTheme, autoTheme: false });
  }

  const handleLogout = useCallback(async () => {
    setSessionNotice("");
    try {
      await authApi.logout();
      clearAuthenticatedUi();
    } catch (error) {
      // Django returns 403/not_authenticated for an already-expired session.
      // Treat only that precise anonymous response as a completed local
      // logout; permission and CSRF failures must keep the current UI state.
      if (isApiError(error) && (error.status === 401 || (error.status === 403 && error.code === "not_authenticated"))) {
        clearAuthenticatedUi();
        return;
      }
      setSessionNotice(error.message || "We could not sign you out. Your current session is unchanged.");
    }
  }, [clearAuthenticatedUi]);

  if (["/terms", "/privacy", "/support"].includes(location.pathname)) {
    return <PublicInfoPage page={location.pathname.slice(1)} />;
  }

  if (booting) return <FullScreenState message="Opening your study room..." startup />;
  if (bootError) {
    return (
      <FullScreenState
        message={bootFailureMessage(bootError, { online, retrying: bootRetrying })}
        actionLabel={bootRetrying ? "" : "Try again"}
        onAction={bootRetrying ? null : retryBootstrap}
        startup={bootRetrying}
      />
    );
  }

  if (["/verify-email", "/confirm-email", "/reset-password"].includes(location.pathname)) {
    const tokenType = location.pathname === "/verify-email"
      ? "verify"
      : location.pathname === "/confirm-email"
        ? "confirm-email"
        : "reset-password";
    return <TokenActionPage type={tokenType} onAccountChanged={refreshActiveAccount} />;
  }

  if (!user) {
    return <AuthPage onAuthed={applyAuthedUser} />;
  }

  if (user.onboardingRequired) {
    return (
      <AuthPage
        key={user.usernameRequired ? "username" : user.requiredProfileFields.join("-")}
        completionUser={user}
        onAuthed={applyAuthedUser}
        onSignOut={handleLogout}
      />
    );
  }

  if (user.welcomeRequired) {
    return (
      <SubscriptionSessionProvider key={user.id} user={user}>
        <Suspense fallback={<LoadingPanel />}>
          <WelcomeOnboarding onUserUpdate={setUser} />
        </Suspense>
      </SubscriptionSessionProvider>
    );
  }

  return (
    <SubscriptionSessionProvider key={user.id} user={user}>
      <>
      <Shell user={user} operationsSession={operationsSession} theme={activeTheme} onThemeChange={setManualTheme} onLogout={handleLogout} notificationVersion={notificationVersion} onNotificationsChanged={() => setNotificationVersion((version) => version + 1)} storeCartCount={storeCartCount} lockBalance={lockBalance} storeCommerceEnabled={false}>
        <ErrorBoundary>
        <Suspense fallback={<LoadingPanel />}>
          <Routes>
              <Route element={<ProtectedRoute user={user} operationsSession={operationsSession} />}>
                <Route path="/" element={<Dashboard themeSettings={themeSettings} activeTheme={activeTheme} />} />
                <Route path="/dashboard" element={<Dashboard themeSettings={themeSettings} activeTheme={activeTheme} />} />
                <Route path="/study-plan" element={<StudyPlan />} />
                <Route path="/materials" element={<Materials />} />
                <Route path="/materials/catalog" element={<NotFoundPage variant="material-catalog" />} />
                <Route path="/materials/catalog/:materialSlug" element={<CatalogMaterialSheets />} />
                <Route path="/materials/catalog/:materialSlug/sheets/:sheetSlug" element={<CatalogSheetStudy />} />
                <Route path="/materials/catalog/:materialSlug/sheets/:sheetSlug/workspace" element={<CatalogFocusWorkspace user={user} />} />
                <Route path="/materials/objects/:learningObjectId" element={<LearningObjectStudy />} />
                <Route path="/materials/:materialId" element={<MaterialSheets />} />
                <Route path="/materials/:materialId/sheets/:sheetId" element={<LearningObjectStudy />} />
                <Route path="/lock-in" element={<LockInMode user={user} />} />
                <Route path="/lock-in/:sessionId" element={<LockInMode user={user} />} />
                <Route path="/search" element={<Search />} />
                <Route path="/questions" element={<Questions />} />
                <Route path="/questions/categories/:categoryId" element={<QuestionCategory />} />
                <Route path="/questions/categories/:categoryId/subjects/:subjectId" element={<QuestionSubjectQuizzes />} />
                <Route path="/questions/demo/:materialSlug/:sheetSlug" element={<DemoQuiz />} />
                <Route path="/questions/quizzes/:quizId" element={<QuizDetail />} />
                <Route path="/questions/attempts/:attemptId" element={<Attempt />} />
                <Route path="/questions/results/:resultId" element={<AssessmentResult />} />
                <Route path="/review" element={<Review />} />
                <Route path="/review/bank" element={<ReviewBank />} />
                <Route path="/review/bank/:subjectKey" element={<SubjectReviewSession />} />
                <Route path="/review/weekly" element={<WeeklyRecall />} />
                <Route path="/community" element={<Community />} />
                <Route path="/community/context/:contextType/:contextId" element={<CommunityContext user={user} />} />
                <Route path="/community/discussions/:discussionId" element={<Discussion user={user} />} />
                <Route path="/community/spaces/:spaceId" element={<CommunitySpace />} />
                <Route path="/community/reports/:reportId" element={<CommunityReport />} />
                <Route path="/ranked" element={<Ranked />} />
                <Route path="/bookmarks" element={<Bookmarks />} />
                <Route path="/progress" element={<Progress />} />
                <Route path="/progression" element={<Progress />} />
                <Route path="/achievements" element={<Achievements />} />
                <Route path="/notifications" element={<Notifications onNotificationsChanged={() => setNotificationVersion((version) => version + 1)} />} />
                <Route path="/store" element={<Store commerceEnabled={false} onLockBalanceChange={setLockBalance} onCartCountChange={setStoreCartCount} />} />
                <Route path="/profile" element={<Profile user={user} onUserUpdate={setUser} />} />
                <Route path="/security" element={<Navigate to="/settings" replace />} />
                <Route path="/subscription" element={<Subscription />} />
                <Route path="/settings" element={<Settings user={user} onUserUpdate={setUser} settings={themeSettings} activeTheme={activeTheme} reminderSettings={reminderSettings} onReminderSettingsChange={setReminderSettings} onSettingsChange={updateThemeSettings} onSignedOut={clearAuthenticatedUi} />} />
                <Route path="/admin/*" element={<OperationsAdmin operationsSession={operationsSession} />} />
                <Route path="/creator" element={<CreatorRoute user={user} operationsSession={operationsSession}><Navigate to={operationsSession?.capabilities?.includes("content.manage") || user.roles?.includes("creator") || user.roles?.includes("administrator") ? "/creator/education" : "/creator/questions"} replace /></CreatorRoute>} />
                <Route path="/creator/education" element={<CreatorRoute user={user} operationsSession={operationsSession}><CreatorEducation /></CreatorRoute>} />
                <Route path="/creator/content" element={<CreatorRoute user={user} operationsSession={operationsSession}><CreatorContent /></CreatorRoute>} />
                <Route path="/creator/content/:contentId" element={<CreatorRoute user={user} operationsSession={operationsSession}><CreatorContentDetail user={user} operationsSession={operationsSession} /></CreatorRoute>} />
                <Route path="/creator/questions" element={<CreatorRoute user={user} operationsSession={operationsSession}><CreatorQuestions /></CreatorRoute>} />
                <Route path="/creator/questions/:questionId" element={<CreatorRoute user={user} operationsSession={operationsSession}><CreatorQuestionDetail /></CreatorRoute>} />
                <Route path="/creator/quizzes" element={<CreatorRoute user={user} operationsSession={operationsSession}><CreatorQuizzes /></CreatorRoute>} />
                <Route path="/creator/quizzes/:quizId" element={<CreatorRoute user={user} operationsSession={operationsSession}><CreatorQuizDetail /></CreatorRoute>} />
                <Route path="/moderation/*" element={<Moderation user={user} />} />
                <Route path="/operations/*" element={<OperationsAdmin operationsSession={operationsSession} />} />
              </Route>
              <Route path="*" element={<NotFoundPage />} />
          </Routes>
          </Suspense>
        </ErrorBoundary>
      </Shell>
      {!inLockInMode && !inFocusWorkspace && reminderToast && <ReminderToast message={reminderToast} onDismiss={() => setReminderToast("")} />}
      {!inLockInMode && !inFocusWorkspace && sessionNotice && <ReminderToast title="Session" icon="alert-triangle" message={sessionNotice} onDismiss={() => setSessionNotice("")} />}
      </>
    </SubscriptionSessionProvider>
  );
}

export default App;
