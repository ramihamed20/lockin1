import { Link } from "react-router-dom";
import { Icon } from "../../lib/icons.jsx";

export function ForbiddenState() {
  return (
    <section className="panel error-panel" role="alert" aria-live="polite">
      <span className="stat-icon"><Icon name="lock" /></span>
      <div>
        <h2>Access unavailable</h2>
        <p>Your current account does not have access to this workspace.</p>
        <Link className="btn btn-soft" to="/">Return to dashboard</Link>
      </div>
    </section>
  );
}
