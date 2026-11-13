import { Link } from "react-router-dom";
import { adminControlApi } from "../../api/adminControl.js";
import { useAsyncData } from "../../hooks/useAsyncData.js";
import { hasOperationalCapability } from "../../lib/authz.js";
import { Icon } from "../../lib/icons.jsx";
import "./admin-automation.css";

/**
 * Capability-gated cross-functional shortcuts. These are real Studio routes,
 * not pretend automation or actions that bypass Django authorization.
 */
const WORKFLOWS = {
  overview: ["automation", "purchases", "reports"],
  analytics: ["users", "content", "exports"],
  users: ["subscriptions", "purchases", "audit"],
  purchases: ["subscriptions", "users", "audit"],
  subscriptions: ["users", "purchases", "settings"],
  content: ["automation", "questions", "audit"],
  automation: ["content", "questions", "audit"],
  questions: ["automation", "content", "audit"],
  notifications: ["feedback", "analytics", "audit"],
  feedback: ["reports", "notifications", "content"],
  reports: ["feedback", "users", "audit"],
  audit: ["system", "settings", "exports"],
  exports: ["analytics", "audit", "system"],
  system: ["audit", "settings", "overview"],
  settings: ["audit", "system", "overview"]
};

const LABELS = {
  automation: ["Automate content", "sparkles", "content.view"],
  content: ["Open library", "file", "content.view"],
  questions: ["Question banks", "file-question", "assessments.view"],
  purchases: ["Payment review", "coins", "payments.view"],
  subscriptions: ["Student access", "layers", "subscriptions.view"],
  users: ["Find students", "user", "users.view"],
  reports: ["Moderation queue", "messages", "moderation.view"],
  feedback: ["Student feedback", "messages", "moderation.view"],
  notifications: ["Student updates", "bell", "notifications.view"],
  analytics: ["Learning analytics", "analytics", "analytics.view"],
  exports: ["Reports export", "file", "reports.export"],
  audit: ["Audit changes", "activity", "audit.view"],
  settings: ["Configuration", "settings", "configuration.view"],
  system: ["System health", "activity", "system_health.view"],
  overview: ["Overview", "home", "overview.view"]
};

export default function Admin2ActionBar({ active, operationsSession }) {
  const canSeeOverview = hasOperationalCapability(operationsSession, "overview.view");
  const pulse = useAsyncData(() => canSeeOverview ? adminControlApi.overview().catch(() => null) : Promise.resolve(null), [canSeeOverview]);
  const queues = pulse.data?.queues || {};
  const waiting = { purchases: queues.pending_payment_reviews, reports: queues.moderation, notifications: queues.failed_notifications };
  const links = (WORKFLOWS[active] || WORKFLOWS.overview)
    .filter((key) => LABELS[key] && hasOperationalCapability(operationsSession, LABELS[key][2]));
  if (!links.length) return null;
  return <nav className="admin2-actions" aria-label="Related administration workflows">
    <span className="admin2-actions-title">Next actions</span>
    {links.map((key) => <Link key={key} to={"/operations/admin/" + key}>
      <Icon name={LABELS[key][1]} size={16}/>{LABELS[key][0]}{Number(waiting[key]) > 0 ? " (" + waiting[key] + ")" : ""}
    </Link>)}
  </nav>;
}
