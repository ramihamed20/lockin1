import { Navigate } from "react-router-dom";

export function ExpiredAccess() {
  return <Navigate replace to="/subscription" />;
}
