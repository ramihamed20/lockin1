import { Navigate } from "react-router-dom";

// Personal summaries remain saved but are not exposed in this release.
export default function MySummaries() {
  return <Navigate to="/materials" replace />;
}
