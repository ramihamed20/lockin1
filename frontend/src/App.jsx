import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { authApi, isApiError, onUnauthorized } from "./lib/api.js";
import {
  autoThemeForDate,
  normalizeThemeSettings,
  normalizeReminderSettings,
  parseReminderTime,
  readLocalThemeSettings,
  readReminderSettings,
  reminderKey,
  todayStamp
} from "./lib/utils.js";
import { Shell } from "./components/layout/index.jsx";
import { AuthPage } from "./components/auth/AuthPage.jsx";
import { FullScreenState, ReminderToast } from "./components/shared/index.jsx";
import { ErrorPanel, LoadingPanel } from "./components/ui/index.jsx";
import { ErrorBoundary } from "./components/ErrorBoundary.jsx";
import { ProtectedRoute } from "./components/auth/ProtectedRoute.jsx";
import { TokenActionPage } from "./components/auth/TokenActionPage.jsx";
import { setSessionMarker } from "./api/client.js";

// --- Lazy-loaded pages ---
const Dashboard = lazy(() => import("./pages/Dashboard.jsx"));
const Materials = lazy(() => import("./pages/Materials.jsx"));
const MaterialSheets = lazy(() => import("./pages/Materials.jsx").then((m) => ({ default: m.MaterialSheets })));
const LearningObjectStudy = lazy(() => import("./pages/LearningObjectStudy.jsx"));
const FocusWorkspace = lazy(() => import("./pages/FocusWorkspace.jsx"));
const Search = lazy(() => import("./pages/Search.jsx"));
const Questions = lazy(() => import("./pages/Questions.jsx"));
const QuizDetail = lazy(() => import("./pages/QuizDetail.jsx"));
const Attempt = lazy(() => import("./pages/Attempt.jsx"));
const AssessmentResult = lazy(() => import("./pages/AssessmentResult.jsx"));
const Review = lazy(() => import("./pages/Review.jsx"));
const Community = lazy(() => import("./pages/Community.jsx"));
const CommunityContext = lazy(() => import("./pages/Community.jsx").then((module) => ({ default: module.CommunityContext })));
const Discussion = lazy(() => import("./pages/Discussion.jsx"));
const CommunitySpace = lazy(() => import("./pages/CommunitySpace.jsx"));
const CommunityReport = lazy(() => import("./pages/CommunityReport.jsx"));
const Ranked = lazy(() => import("./pages/Ranked.jsx"));
const Analytics = lazy(() => import("./pages/Analytics.jsx"));
const Bookmarks = lazy(() => import("./pages/Bookmarks.jsx"));
const Progress = lazy(() => import("./pages/Progress.jsx"));
const Achievements = lazy(() => import("./pages/Achievements.jsx"));
const Notifications = lazy(() => import("./pages/Notifications.jsx"));
const Profile = lazy(() => import("./pages/Profile.jsx"));
const Settings = lazy(() => import("./pages/Settings.jsx"));
const CreatorEducation = lazy(() => import("./pages/CreatorEducation.jsx"));
const CreatorContent = lazy(() => import("./pages/CreatorContent.jsx"));
const CreatorContentDetail = lazy(() => import("./pages/CreatorContent.jsx").then((module) => ({ default: module.CreatorContentDetail })));
const CreatorQuestions = lazy(() => import("./pages/CreatorAssessments.jsx").then((module) => ({ default: module.CreatorQuestions })));
const CreatorQuestionDetail = lazy(() => import("./pages/CreatorAssessments.jsx").then((module) => ({ default: module.CreatorQuestionDetail })));
const CreatorQuizzes = lazy(() => import("./pages/CreatorAssessments.jsx").then((module) => ({ default: module.CreatorQuizzes })));
const CreatorQuizDetail = lazy(() => import("./pages/CreatorAssessments.jsx").then((module) => ({ default: module.CreatorQuizDetail })));
const CreatorRoute = lazy(() => import("./components/creator/index.jsx").then((module) => ({ default: module.CreatorRoute })));
const OperationsAdmin = lazy(() => import("./pages/OperationsAdmin.jsx"));

function DeferredWorkspace({ message }) {
  return <ErrorPanel message={message} />;
}

function App() {
  const location = useLocation();
  const [themeSettings, setThemeSettings] = useState(readLocalThemeSettings);
  const [themeClock, setThemeClock] = useState(() => new Date());
  const [reminderClock, setReminderClock] = useState(() => new Date());
  const [reminderSettings, setReminderSettings] = useState(() => readReminderSettings());
  const [reminderToast, setReminderToast] = useState("");
  const [user, setUser] = useState(null);
  const [operationsSession, setOperationsSession] = useState(null);
  const operationsRequestRef = useRef(0);
  const [booting, setBooting] = useState(true);
  const [bootError, setBootError] = useState(null);
  const [sessionAttempt, setSessionAttempt] = useState(0);
  const [sessionNotice, setSessionNotice] = useState("");
  const [notificationVersion, setNotificationVersion] = useState(0);
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const activeTheme = themeSettings.autoTheme ? autoThemeForDate(themeClock) : themeSettings.theme;

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
    } catch (error) {
      // Students and other non-operational users correctly receive 403. A
      // missing or failed capability response must never grant fallback access.
      if (operationsRequestRef.current === requestId) setOperationsSession(null);
      return null;
    }
  }, []);

  const clearAuthenticatedUi = useCallback(() => {
    setSessionMarker(false);
    setUser(null);
    clearOperationsSession();
  }, [clearOperationsSession]);

  const refreshActiveAccount = useCallback(async () => {
    try {
      const nextUser = await authApi.me();
      setUser(nextUser);
      setThemeSettings(normalizeThemeSettings(nextUser.themeSettings));
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
    const handleBeforeInstallPrompt = (event) => {
      event.preventDefault();
      setDeferredPrompt(event);
    };
    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = activeTheme;
    document.documentElement.dataset.character = themeSettings.character;
    localStorage.setItem("lock-in.theme", activeTheme);
    localStorage.setItem("lock-in.theme.settings", JSON.stringify(themeSettings));
  }, [activeTheme, themeSettings]);

  useEffect(() => {
    if (!themeSettings.autoTheme) return undefined;
    setThemeClock(new Date());
    let timer = null;
    function start() { timer = window.setInterval(() => setThemeClock(new Date()), 60000); }
    function stop() { if (timer) { window.clearInterval(timer); timer = null; } }
    function onVisibility() { document.hidden ? stop() : start(); }
    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => { stop(); document.removeEventListener("visibilitychange", onVisibility); };
  }, [themeSettings.autoTheme]);

  useEffect(() => {
    setReminderSettings(readReminderSettings(user?.email));
  }, [user?.email]);

  useEffect(() => {
    localStorage.setItem(reminderKey(user?.email), JSON.stringify(reminderSettings));
  }, [user?.email, reminderSettings]);

  useEffect(() => {
    let timer = null;
    function start() { timer = window.setInterval(() => setReminderClock(new Date()), 60000); }
    function stop() { if (timer) { window.clearInterval(timer); timer = null; } }
    function onVisibility() { document.hidden ? stop() : start(); }
    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => { stop(); document.removeEventListener("visibilitychange", onVisibility); };
  }, []);

  useEffect(() => {
    if (!reminderSettings.enabled) return;
    const now = reminderClock;
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
  }, [reminderClock, reminderSettings]);

  useEffect(() => onUnauthorized(() => {
    clearAuthenticatedUi();
    setBootError(null);
    setBooting(false);
  }), [clearAuthenticatedUi]);

  useEffect(() => {
    let active = true;
    setBooting(true);
    setBootError(null);

    authApi
      .me()
      .then(async (nextUser) => {
        if (!active) return;
        setUser(nextUser);
        setThemeSettings(normalizeThemeSettings(nextUser.themeSettings));
        await loadOperationsSession();
      })
      .catch((error) => {
        if (!active) return;
        // GET /auth/session is authentication-specific: this Django setup uses
        // 403 for anonymous sessions and 401 for expired session credentials.
        if (isApiError(error) && (error.status === 401 || error.status === 403)) {
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

  function applyAuthedUser(nextUser) {
    setSessionNotice("");
    setUser(nextUser);
    setThemeSettings(normalizeThemeSettings(nextUser.themeSettings));
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

  if (booting) return <FullScreenState message="Opening your study room..." />;
  if (bootError) {
    return (
      <FullScreenState
        message={bootError.message || "We could not reach your session. Please try again."}
        actionLabel="Try again"
        onAction={() => setSessionAttempt((attempt) => attempt + 1)}
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

  return (
    <>
      <Shell user={user} operationsSession={operationsSession} theme={activeTheme} onThemeChange={setManualTheme} onLogout={handleLogout} notificationVersion={notificationVersion} onNotificationsChanged={() => setNotificationVersion((version) => version + 1)}>
        <ErrorBoundary>
        <Suspense fallback={<LoadingPanel />}>
          <Routes>
              <Route element={<ProtectedRoute user={user} operationsSession={operationsSession} />}>
                <Route path="/" element={<Dashboard themeSettings={themeSettings} activeTheme={activeTheme} user={user} deferredPrompt={deferredPrompt} onClearInstallPrompt={() => setDeferredPrompt(null)} />} />
                <Route path="/dashboard" element={<Dashboard themeSettings={themeSettings} activeTheme={activeTheme} user={user} deferredPrompt={deferredPrompt} onClearInstallPrompt={() => setDeferredPrompt(null)} />} />
                <Route path="/materials" element={<Materials />} />
                <Route path="/materials/objects/:learningObjectId" element={<LearningObjectStudy />} />
                <Route path="/materials/:materialId" element={<MaterialSheets />} />
                <Route path="/materials/:materialId/sheets/:sheetId" element={<LearningObjectStudy />} />
                <Route path="/focus/:documentVersionId" element={<FocusWorkspace />} />
                <Route path="/search" element={<Search />} />
                <Route path="/questions" element={<Questions />} />
                <Route path="/questions/quizzes/:quizId" element={<QuizDetail />} />
                <Route path="/questions/attempts/:attemptId" element={<Attempt />} />
                <Route path="/questions/results/:resultId" element={<AssessmentResult />} />
                <Route path="/review" element={<Review />} />
                <Route path="/community" element={<Community user={user} />} />
                <Route path="/community/context/:contextType/:contextId" element={<CommunityContext user={user} />} />
                <Route path="/community/discussions/:discussionId" element={<Discussion user={user} />} />
                <Route path="/community/spaces/:spaceId" element={<CommunitySpace />} />
                <Route path="/community/reports/:reportId" element={<CommunityReport />} />
                <Route path="/ranked" element={<Ranked />} />
                <Route path="/analytics" element={<Analytics />} />
                <Route path="/bookmarks" element={<Bookmarks />} />
                <Route path="/progress" element={<Progress />} />
                <Route path="/progression" element={<Progress />} />
                <Route path="/achievements" element={<Achievements />} />
                <Route path="/notifications" element={<Notifications onNotificationsChanged={() => setNotificationVersion((version) => version + 1)} />} />
                <Route path="/profile" element={<Profile user={user} onUserUpdate={setUser} onSignedOut={clearAuthenticatedUi} />} />
                <Route path="/security" element={<Profile user={user} onUserUpdate={setUser} onSignedOut={clearAuthenticatedUi} />} />
                <Route path="/subscription" element={<DeferredWorkspace message="Subscription details are not available from the current Django API integration." />} />
                <Route path="/settings" element={<Settings settings={themeSettings} activeTheme={activeTheme} reminderSettings={reminderSettings} onReminderSettingsChange={setReminderSettings} onSettingsChange={updateThemeSettings} />} />
                <Route path="/admin/*" element={<OperationsAdmin operationsSession={operationsSession} />} />
                <Route path="/creator" element={<CreatorRoute user={user} operationsSession={operationsSession}><Navigate to={operationsSession?.capabilities?.includes("content.manage") || user.roles?.includes("creator") || user.roles?.includes("administrator") ? "/creator/education" : "/creator/questions"} replace /></CreatorRoute>} />
                <Route path="/creator/education" element={<CreatorRoute user={user} operationsSession={operationsSession}><CreatorEducation /></CreatorRoute>} />
                <Route path="/creator/content" element={<CreatorRoute user={user} operationsSession={operationsSession}><CreatorContent user={user} /></CreatorRoute>} />
                <Route path="/creator/content/:contentId" element={<CreatorRoute user={user} operationsSession={operationsSession}><CreatorContentDetail user={user} operationsSession={operationsSession} /></CreatorRoute>} />
                <Route path="/creator/questions" element={<CreatorRoute user={user} operationsSession={operationsSession}><CreatorQuestions /></CreatorRoute>} />
                <Route path="/creator/questions/:questionId" element={<CreatorRoute user={user} operationsSession={operationsSession}><CreatorQuestionDetail /></CreatorRoute>} />
                <Route path="/creator/quizzes" element={<CreatorRoute user={user} operationsSession={operationsSession}><CreatorQuizzes /></CreatorRoute>} />
                <Route path="/creator/quizzes/:quizId" element={<CreatorRoute user={user} operationsSession={operationsSession}><CreatorQuizDetail /></CreatorRoute>} />
                <Route path="/moderation/*" element={<DeferredWorkspace message="Moderation tools will be connected in their scheduled phase." />} />
                <Route path="/operations/*" element={<OperationsAdmin operationsSession={operationsSession} />} />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </Suspense>
        </ErrorBoundary>
      </Shell>
      {reminderToast && <ReminderToast message={reminderToast} onDismiss={() => setReminderToast("")} />}
      {sessionNotice && <ReminderToast title="Session" icon="alert-triangle" message={sessionNotice} onDismiss={() => setSessionNotice("")} />}
    </>
  );
}

export default App;
