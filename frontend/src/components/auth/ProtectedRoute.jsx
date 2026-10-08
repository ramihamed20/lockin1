import { useCallback, useEffect, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { canAccessRoute } from "../../lib/authz.js";
import { useSubscriptionSession } from "../../lib/SubscriptionSessionContext.jsx";
import { FullScreenState } from "../shared/index.jsx";
import { LoadingPanel } from "../ui/index.jsx";
import { ForbiddenState } from "../shared/ForbiddenState.jsx";
import { ExpiredAccess } from "../subscription/ExpiredAccess.jsx";
import { offlineAccessStatus } from "../../offline/lease.js";
import { synchronizeOffline } from "../../offline/coordinator.js";
import { getConnectionSnapshot, subscribeConnection } from "../../lib/connectionState.js";
import OfflineExpiredScreen from "../../offline/OfflineExpiredScreen.jsx";

const SUBSCRIPTION_PROTECTED_PATHS = [
  "/dashboard", "/study-plan", "/materials", "/paper-workspace", "/lock-in", "/search",
  "/questions", "/review", "/bookmarks", "/progress", "/progression",
  "/achievements", "/whiteboards"
];

function isDefinitelyOffline() {
  return !navigator.onLine || getConnectionSnapshot().status === "offline";
}

function requiresSubscription(pathname) {
  if (pathname === "/") return true;
  return SUBSCRIPTION_PROTECTED_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export function ProtectedRoute({ user, loading = false, operationsSession = null, operationsSessionPending = false }) {
  const location = useLocation();
  const subscriptionSession = useSubscriptionSession();
  const [offlineState, setOfflineState] = useState(null);
  const [checking, setChecking] = useState(false);
  // Only a definitive loss of connection switches to the offline lease. A
  // single failed request ("reconnecting") must never replace the open route:
  // that unmounted the reader mid-stroke and mid-quiz.
  const [online, setOnline] = useState(() => !isDefinitelyOffline());
  // The lease is read continuously, online too, so going offline never shows
  // a loading state that would unmount the page while the check runs.
  const checkOfflineLease = useCallback(() => {
    if (!user?.id) { setOfflineState(null); return; }
    void offlineAccessStatus(user.id).then(setOfflineState).catch(() => setOfflineState({ available: false }));
  }, [user?.id]);
  useEffect(() => {
    checkOfflineLease();
    const handleConnection = () => { setOnline(!isDefinitelyOffline()); checkOfflineLease(); };
    const handleVisibility = () => { if (document.visibilityState === "visible") checkOfflineLease(); };
    const timer = window.setInterval(checkOfflineLease, 30_000);
    window.addEventListener("online", handleConnection);
    window.addEventListener("offline", handleConnection);
    window.addEventListener("pageshow", checkOfflineLease);
    document.addEventListener("visibilitychange", handleVisibility);
    const unsubscribe = subscribeConnection(handleConnection);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("online", handleConnection);
      window.removeEventListener("offline", handleConnection);
      window.removeEventListener("pageshow", checkOfflineLease);
      document.removeEventListener("visibilitychange", handleVisibility);
      unsubscribe();
    };
  }, [checkOfflineLease]);
  // Every navigation, including a deep link or a history step back into a
  // previously opened page, re-checks the lease before protected content shows.
  useEffect(() => { checkOfflineLease(); }, [checkOfflineLease, location.pathname]);
  // Lock at the moment the lease ends rather than at the next poll.
  const leaseExpiry = offlineState?.available ? offlineState.claims?.exp : 0;
  useEffect(() => {
    if (!leaseExpiry) return undefined;
    const timer = window.setTimeout(checkOfflineLease, Math.max(0, leaseExpiry * 1000 - Date.now()) + 50);
    return () => window.clearTimeout(timer);
  }, [checkOfflineLease, leaseExpiry]);

  if (loading) return <FullScreenState message="Opening your study room..." />;
  if (!user) return <Navigate to="/" replace state={{ from: location }} />;
  if (!canAccessRoute(user, location.pathname, operationsSession)) {
    // Capabilities arrive after the user on a restored session. Until they
    // do, a capability route is undecided, not forbidden.
    if (operationsSessionPending) return <LoadingPanel />;
    return <ForbiddenState />;
  }
  if (requiresSubscription(location.pathname) && !online && !offlineState) return <LoadingPanel />;
  if (requiresSubscription(location.pathname) && !online && offlineState && !offlineState.available) {
    return <OfflineExpiredScreen reason={offlineState.reason} checking={checking} onCheck={() => {
      setChecking(true);
      void synchronizeOffline(user.id)
        .then(() => { setOnline(!isDefinitelyOffline()); checkOfflineLease(); void subscriptionSession.refresh({ blocking: false }); })
        .catch(checkOfflineLease)
        .finally(() => setChecking(false));
    }} />;
  }
  if (requiresSubscription(location.pathname) && !online && offlineState?.available) return <Outlet />;
  // Access is enforced by Django on every protected request. Do not replace a
  // restored route with a full-screen gate while its local access snapshot is
  // silently being refreshed; if the server says access is unavailable, the
  // normal expired-access state renders immediately afterward.
  if (requiresSubscription(location.pathname) && !subscriptionSession.ready && subscriptionSession.error) {
    return <FullScreenState message={subscriptionSession.error || "Checking your Lock-in access…"} actionLabel={subscriptionSession.error ? "Try again" : ""} onAction={subscriptionSession.error ? subscriptionSession.refresh : null} />;
  }
  if (requiresSubscription(location.pathname) && subscriptionSession.ready && !subscriptionSession.canAccessNow()) {
    return <ExpiredAccess />;
  }

  return <Outlet />;
}
