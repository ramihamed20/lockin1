import { useEffect, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { billingApi } from "../../api/billing.js";
import { canAccessRoute } from "../../lib/authz.js";
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
  const [subscription, setSubscription] = useState(undefined);

  useEffect(() => {
    if (!user || !requiresSubscription(location.pathname)) return undefined;
    let active = true;
    setSubscription(undefined);
    billingApi.currentSubscription()
      .then((value) => { if (active) setSubscription(value); })
      .catch(() => { if (active) setSubscription(null); });
    return () => { active = false; };
  }, [location.pathname, user]);

  if (loading) return <FullScreenState message="Opening your study room..." />;
  if (!user) return <Navigate to="/" replace state={{ from: location }} />;
  if (!canAccessRoute(user, location.pathname, operationsSession)) {
    return <ForbiddenState />;
  }
  if (requiresSubscription(location.pathname) && subscription === undefined) {
    return <FullScreenState message="Checking your Lock-in access…" />;
  }
  if (requiresSubscription(location.pathname) && subscription && !subscription.access_allowed) {
    return <ExpiredAccess subscription={subscription} />;
  }

  return <Outlet />;
}
