import { Navigate, Outlet, useLocation } from "react-router-dom";
import { canAccessRoute } from "../../lib/authz.js";
import { useSubscriptionSession } from "../../lib/SubscriptionSessionContext.jsx";
import { FullScreenState } from "../shared/index.jsx";
import { LoadingPanel } from "../ui/index.jsx";
import { ForbiddenState } from "../shared/ForbiddenState.jsx";
import { ExpiredAccess } from "../subscription/ExpiredAccess.jsx";

const SUBSCRIPTION_PROTECTED_PATHS = [
  "/dashboard", "/study-plan", "/materials", "/paper-workspace", "/lock-in", "/search",
  "/questions", "/review", "/bookmarks", "/progress", "/progression",
  "/achievements"
];

function requiresSubscription(pathname) {
  if (pathname === "/") return true;
  return SUBSCRIPTION_PROTECTED_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export function ProtectedRoute({ user, loading = false, operationsSession = null, operationsSessionPending = false }) {
  const location = useLocation();
  const subscriptionSession = useSubscriptionSession();

  if (loading) return <FullScreenState message="Opening your study room..." />;
  if (!user) return <Navigate to="/" replace state={{ from: location }} />;
  if (!canAccessRoute(user, location.pathname, operationsSession)) {
    // Capabilities arrive after the user on a restored session. Until they
    // do, a capability route is undecided, not forbidden.
    if (operationsSessionPending) return <LoadingPanel />;
    return <ForbiddenState />;
  }
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
