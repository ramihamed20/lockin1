import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
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
import { ErrorBoundary } from "./components/ErrorBoundary.jsx";
import { ConfirmDialog } from "./components/shared/ConfirmDialog.jsx";
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
import { FeatureComingSoon } from "./components/FeatureComingSoon.jsx";

// --- Lazy-loaded pages ---
const Dashboard = lazyWithRecovery(() => import("./pages/Dashboard.jsx"));
const Materials = lazyWithRecovery(() => import("./pages/Materials.jsx"));
const CatalogMaterialSheets = lazyWithRecovery(() => import("./pages/Materials.jsx").then((m) => ({ default: m.CatalogMaterialSheets })));
const CatalogSheetStudy = lazyWithRecovery(() => import("./pages/Materials.jsx").then((m) => ({ default: m.CatalogSheetStudy })));
const CatalogFocusWorkspace = lazyWithRecovery(() => import("./pages/CatalogFocusWorkspace.jsx"));
const LockInMode = lazyWithRecovery(() => import("./pages/LockInMode.jsx"));
const Search = lazyWithRecovery(() => import("./pages/Search.jsx"));
const Questions = lazyWithRecovery(() => import("./pages/Questions.jsx"));
const QuestionCategory = lazyWithRecovery(() => import("./pages/Questions.jsx").then((module) => ({ default: module.QuestionCategory })));
const QuestionSubjectQuestions = lazyWithRecovery(() => import("./pages/Questions.jsx").then((module) => ({ default: module.QuestionSubjectQuestions })));
const QuizDetail = lazyWithRecovery(() => import("./pages/QuizDetail.jsx"));
const Attempt = lazyWithRecovery(() => import("./pages/Attempt.jsx"));
const AssessmentResult = lazyWithRecovery(() => import("./pages/AssessmentResult.jsx"));
const Review = lazyWithRecovery(() => import("./pages/Review.jsx"));
const ReviewBank = lazyWithRecovery(() => import("./pages/Review.jsx").then((module) => ({ default: module.ReviewBank })));
const SubjectReviewSession = lazyWithRecovery(() => import("./pages/Review.jsx").then((module) => ({ default: module.SubjectReviewSession })));
const WeeklyRecall = lazyWithRecovery(() => import("./pages/Review.jsx").then((module) => ({ default: module.WeeklyRecall })));
const Bookmarks = lazyWithRecovery(() => import("./pages/Bookmarks.jsx"));
const Progress = lazyWithRecovery(() => import("./pages/Progress.jsx"));
const Achievements = lazyWithRecovery(() => import("./pages/Achievements.jsx"));
const Notifications = lazyWithRecovery(() => import("./pages/Notifications.jsx"));
const Store = lazyWithRecovery(() => import("./pages/Store.jsx"));
const Profile = lazyWithRecovery(() => import("./pages/Profile.jsx"));
const Settings = lazyWithRecovery(() => import("./pages/Settings.jsx"));
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
const SESSION_USER_SNAPSHOT_KEY = "lock-in.session-user";

function readSessionUserSnapshot() {
  try {
    const value = JSON.parse(window.sessionStorage.getItem(SESSION_USER_SNAPSHOT_KEY) || "null");
    if (value && typeof value === "object" && typeof value.id === "string" && typeof value.email === "string") return value;
  } catch {
    // Session storage is optional and a malformed snapshot is never trusted.
  }
  return null;
}

function writeSessionUserSnapshot(user) {
  try {
    if (user) window.sessionStorage.setItem(SESSION_USER_SNAPSHOT_KEY, JSON.stringify(user));
    else window.sessionStorage.removeItem(SESSION_USER_SNAPSHOT_KEY);
  } catch {
    // The server session remains authoritative when storage is unavailable.
  }
}

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
  const navigate = useNavigate();
  const { setLocale, t } = useI18n();
  const [themeSettings, setThemeSettings] = useState(readLocalThemeSettings);
  const [reminderSettings, setReminderSettings] = useState(() => readReminderSettings());
  const clockTick = useVisibleNow(themeSettings.autoTheme || reminderSettings.enabled, 60_000);
  const [reminderToast, setReminderToast] = useState("");
  // If a browser recreates this document after a short background period, the
  // non-secret profile snapshot lets the existing route paint immediately.
  // The HttpOnly cookie is still checked in the background before any server
  // mutation is allowed; a missing/ended session clears this snapshot.
  const [user, setUser] = useState(readSessionUserSnapshot);
  const [operationsSession, setOperationsSession] = useState(null);
  const operationsRequestRef = useRef(0);
  const [booting, setBooting] = useState(() => !user);
  const [bootError, setBootError] = useState(null);
  const [bootRetrying, setBootRetrying] = useState(false);
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine !== false);
  const bootRetryAttemptsRef = useRef(0);
  const bootErrorRef = useRef(null);
  const bootingRef = useRef(true);
  const oauthSessionBootRef = useRef(new URLSearchParams(window.location.search).has("oauth"));
  const [sessionAttempt, setSessionAttempt] = useState(0);
  const [sessionNotice, setSessionNotice] = useState("");
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const loggingOutRef = useRef(false);
  const authenticatedRef = useRef(false);
  const sessionRevalidationRef = useRef(null);
  const resumedSessionRef = useRef(Boolean(user));
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
    writeSessionUserSnapshot(null);
    clearSubscriptionSnapshots();
    setUser(null);
    clearOperationsSession();
  }, [clearOperationsSession]);

  useEffect(() => {
    writeSessionUserSnapshot(user);
  }, [user]);

  const refreshActiveAccount = useCallback(async () => {
    try {
      const nextUser = await authApi.me();
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
    // Losing a session mid-visit is not the same event as arriving without one.
    // A reader who was signed in a moment ago is owed the reason they are back
    // at the sign-in screen; an anonymous first load is answered with 403 by
    // design and must stay silent. authenticatedRef is what separates the two.
    if (authenticatedRef.current) setSessionNotice(t("auth.sessionExpired"));
    clearAuthenticatedUi();
    bootRetryAttemptsRef.current = 0;
    setBootError(null);
    setBooting(false);
  }), [clearAuthenticatedUi, t]);

  useEffect(() => {
    bootErrorRef.current = bootError;
    bootingRef.current = booting;
    // Read by the pageshow handler, which must not be re-registered on every
    // change of user.
    authenticatedRef.current = Boolean(user);
  }, [bootError, booting, user]);

  const retryBootstrap = useCallback(() => {
    // One bootstrap at a time. A queued retry would race the in-flight request
    // and could resolve against a session that has already been replaced.
    if (bootingRef.current) return;
    bootRetryAttemptsRef.current = 0;
    setBootRetrying(false);
    setSessionAttempt((attempt) => attempt + 1);
  }, []);

  // A page restored from the back/forward cache retains its JavaScript heap,
  // including a user object whose server session may have ended elsewhere.
  // Revalidate that one case quietly: showing the bootstrap screen here would
  // unmount every protected route and discard transient study/form UI even
  // when the session remains valid. Failed transport checks leave the reader
  // in place; an actual ended session still clears the protected UI through
  // the normal unauthorized path.
  useEffect(() => {
    function revalidateRestoredSession(event) {
      if (!event.persisted || !authenticatedRef.current || sessionRevalidationRef.current) return;
      const revalidation = refreshActiveAccount()
        .catch(() => {
          // Background validation must not replace a usable workspace with a
          // boot error for a transient network interruption.
        })
        .finally(() => {
          if (sessionRevalidationRef.current === revalidation) sessionRevalidationRef.current = null;
        });
      sessionRevalidationRef.current = revalidation;
    }
    window.addEventListener("pageshow", revalidateRestoredSession);
    return () => window.removeEventListener("pageshow", revalidateRestoredSession);
  }, [refreshActiveAccount]);

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
    const silentlyRevalidateRestoredApp = resumedSessionRef.current && sessionAttempt === 0;
    if (!silentlyRevalidateRestoredApp) setBooting(true);
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
        // A transient error while restoring a just-backgrounded tab must not
        // replace its visible route with the startup screen. The reader can
        // continue and the next request will revalidate normally.
        if (!silentlyRevalidateRestoredApp) setBootError(error);
      })
      .finally(() => {
        if (active && !silentlyRevalidateRestoredApp) setBooting(false);
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
      return true;
    } catch (error) {
      // Django returns 403/not_authenticated for an already-expired session.
      // Treat only that precise anonymous response as a completed local
      // logout; permission and CSRF failures must keep the current UI state.
      if (isApiError(error) && (error.status === 401 || (error.status === 403 && error.code === "not_authenticated"))) {
        clearAuthenticatedUi();
        return true;
      }
      setSessionNotice(error.message || "We could not sign you out. Your current session is unchanged.");
    }
    // The session outlived the attempt, so the caller must leave the reader
    // exactly where they were.
    return false;
  }, [clearAuthenticatedUi]);

  // Signing out ends work in progress, so it is confirmed before it runs. Every
  // entry point (the drawer, the account menu, the onboarding screen) asks the
  // same question through the same dialog, and the answer -- not the click --
  // is what reaches the unchanged logout call above.
  const requestLogout = useCallback(() => {
    if (loggingOutRef.current) return;
    setLogoutConfirmOpen(true);
  }, []);

  const cancelLogout = useCallback(() => {
    if (loggingOutRef.current) return;
    setLogoutConfirmOpen(false);
  }, []);

  const confirmLogout = useCallback(async () => {
    // The request is in flight exactly once: a second confirmation, however it
    // arrives, is dropped here rather than reaching the API a second time.
    if (loggingOutRef.current) return;
    loggingOutRef.current = true;
    setLoggingOut(true);
    try {
      const signedOut = await handleLogout();
      // Replace rather than push: the reader did not navigate anywhere, so the
      // signed-out screen takes the place of the protected route instead of
      // stacking on top of it. This is a tidiness measure, not the defence --
      // the entries behind it are still reachable, and it is the bfcache
      // revalidation above plus the server's no-store that keep them empty.
      // A failed sign-out leaves the session alive, so it also leaves the
      // reader where they were.
      if (signedOut) navigate("/", { replace: true });
    } finally {
      loggingOutRef.current = false;
      setLoggingOut(false);
      // A failed sign-out leaves the reader signed in, and handleLogout has
      // already put the reason on screen; the dialog closes either way so the
      // notice is not hidden behind it.
      setLogoutConfirmOpen(false);
    }
  }, [handleLogout, navigate]);

  const logoutConfirmDialog = (
    <ConfirmDialog
      open={logoutConfirmOpen}
      busy={loggingOut}
      title={t("auth.logoutConfirmTitle")}
      message={t("auth.logoutConfirmMessage")}
      confirmLabel={loggingOut ? t("auth.logoutWorking") : t("common.logout")}
      onCancel={cancelLogout}
      onConfirm={() => { void confirmLogout(); }}
    />
  );

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
    return (
      <AuthPage
        onAuthed={applyAuthedUser}
        notice={sessionNotice}
        onDismissNotice={() => setSessionNotice("")}
      />
    );
  }

  if (user.onboardingRequired) {
    return (
      <>
        <AuthPage
          key={user.usernameRequired ? "username" : user.requiredProfileFields.join("-")}
          completionUser={user}
          onAuthed={applyAuthedUser}
          onSignOut={requestLogout}
        />
        {logoutConfirmDialog}
      </>
    );
  }

  if (user.welcomeRequired) {
    return (
      <SubscriptionSessionProvider key={user.id} user={user}>
        <Suspense fallback={null}>
          <WelcomeOnboarding user={user} onUserUpdate={setUser} onThemeSettingsChange={updateThemeSettings} />
        </Suspense>
      </SubscriptionSessionProvider>
    );
  }

  return (
    <SubscriptionSessionProvider key={user.id} user={user}>
      <>
      <Shell user={user} operationsSession={operationsSession} theme={activeTheme} onThemeChange={setManualTheme} onLogout={requestLogout} notificationVersion={notificationVersion} onNotificationsChanged={() => setNotificationVersion((version) => version + 1)} storeCartCount={storeCartCount} lockBalance={lockBalance} storeCommerceEnabled={false}>
        <ErrorBoundary>
        {/* Returning from background must keep the shell stable. Route chunks
            resolve in place instead of replacing the screen with a loader. */}
        <Suspense fallback={null}>
          <Routes>
              <Route element={<ProtectedRoute user={user} operationsSession={operationsSession} />}>
                <Route path="/" element={<Dashboard themeSettings={themeSettings} activeTheme={activeTheme} />} />
                <Route path="/dashboard" element={<Dashboard themeSettings={themeSettings} activeTheme={activeTheme} />} />
                <Route path="/study-plan/*" element={<FeatureComingSoon featureId="study-plan" />} />
                <Route path="/materials" element={<Materials user={user} />} />
                <Route path="/materials/catalog" element={<NotFoundPage variant="material-catalog" />} />
                <Route path="/materials/catalog/:materialSlug" element={<CatalogMaterialSheets user={user} />} />
                <Route path="/materials/catalog/:materialSlug/sheets/:sheetSlug" element={<CatalogSheetStudy user={user} />} />
                <Route path="/materials/catalog/:materialSlug/sheets/:sheetSlug/workspace" element={<CatalogFocusWorkspace user={user} />} />
                <Route path="/lock-in" element={<LockInMode user={user} />} />
                <Route path="/lock-in/:sessionId" element={<LockInMode user={user} />} />
                <Route path="/search" element={<Search />} />
                <Route path="/questions" element={<Questions user={user} />} />
                <Route path="/questions/categories/:categoryId" element={<QuestionCategory user={user} />} />
                <Route path="/questions/categories/:categoryId/subjects/:subjectId" element={<QuestionSubjectQuestions user={user} />} />
                <Route path="/questions/quizzes/:quizId" element={<QuizDetail />} />
                <Route path="/questions/attempts/:attemptId" element={<Attempt />} />
                <Route path="/questions/results/:resultId" element={<AssessmentResult />} />
                <Route path="/review" element={<Review />} />
                <Route path="/review/bank" element={<ReviewBank />} />
                <Route path="/review/bank/:subjectKey" element={<SubjectReviewSession />} />
                <Route path="/review/weekly" element={<WeeklyRecall />} />
                <Route path="/community/*" element={<FeatureComingSoon featureId="community" />} />
                <Route path="/ranked/*" element={<FeatureComingSoon featureId="rank" />} />
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
                {/* Same content.view gate as /creator; /admin/* also requires the administrator role. */}
                <Route path="/creator/*" element={<Navigate to="/operations/admin/content" replace />} />
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
      {logoutConfirmDialog}
      </>
    </SubscriptionSessionProvider>
  );
}

export default App;
