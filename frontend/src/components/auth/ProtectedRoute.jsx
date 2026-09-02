import { Navigate, Outlet, useLocation } from "react-router-dom";
import { canAccessRoute } from "../../lib/authz.js";
import { useSubscriptionSession } from "../../lib/SubscriptionSessionContext.jsx";
import { FullScreenState } from "../shared/index.jsx";
import { ForbiddenState } from "../shared/ForbiddenState.jsx";
import { ExpiredAccess } from "../subscription/ExpiredAccess.jsx";

const SUBSCRIPTION_PROTECTED_PATHS = [
  "/dashboard", "/study-plan", "/materials", "/lock-in", "/search",
  "/questions", "/review", "/bookmarks", "/progress", "/progression",
  "/achievements"
];

function requiresSubscription(pathname) {
  if (pathname === "/") return true;
  return SUBSCRIPTION_PROTECTED_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export function ProtectedRoute({ user, loading = false, operationsSession = null }) {
  const location = useLocation();
  const subscriptionSession = useSubscriptionSession();
  const { subscription } = subscriptionSession;

  if (loading) return <FullScreenState message="Opening your study room..." />;
  if (!user) return <Navigate to="/" replace state={{ from: location }} />;
  if (!canAccessRoute(user, location.pathname, operationsSession)) {
    return <ForbiddenState />;
  }
  if (requiresSubscription(location.pathname) && !subscriptionSession.ready) {
    return <FullScreenState message={subscriptionSession.error || "Checking your Lock-in access…"} actionLabel={subscriptionSession.error ? "Try again" : ""} onAction={subscriptionSession.error ? subscriptionSession.refresh : null} />;
  }
  if (requiresSubscription(location.pathname) && !subscriptionSession.canAccessNow()) {
    return <ExpiredAccess subscription={subscription} />;
  }

  return <Outlet />;
}
