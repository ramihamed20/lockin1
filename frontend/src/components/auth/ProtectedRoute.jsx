import { Navigate, Outlet, useLocation } from "react-router-dom";
import { canAccessRoute } from "../../lib/authz.js";
import { FullScreenState } from "../shared/index.jsx";
import { ForbiddenState } from "../shared/ForbiddenState.jsx";

export function ProtectedRoute({ user, loading = false, operationsSession = null }) {
  const location = useLocation();

  if (loading) return <FullScreenState message="Opening your study room..." />;
  if (!user) return <Navigate to="/" replace state={{ from: location }} />;
  if (!canAccessRoute(user, location.pathname, operationsSession)) {
    return <ForbiddenState />;
  }

  return <Outlet />;
}
