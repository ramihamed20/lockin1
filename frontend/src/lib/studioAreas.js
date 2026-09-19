import { hasOperationalCapability } from "./authz.js";
import { normalizeSearchText } from "./globalSearch.js";

/**
 * Creator Studio areas: [key, label, capability, icon, group]. Shared by the
 * Studio navigation and by global search, which offers these destinations
 * while an operator is working in the Studio. The server still authorizes
 * every request behind them; the capability only decides what is offered.
 */
export const STUDIO_AREAS = [
  ["overview", "Overview", "overview.view", "home", "Workspace"],
  ["analytics", "Analytics", "analytics.view", "analytics", "Workspace"],
  ["users", "Students", "users.view", "user", "Learning"],
  ["subscriptions", "Subscriptions", "subscriptions.view", "layers", "Learning"],
  ["content", "Content", "content.view", "file", "Library"],
  ["questions", "Questions", "assessments.view", "file-question", "Library"],
  ["notifications", "Notifications", "notifications.view", "bell", "Engagement"],
  ["reports", "Moderation", "moderation.view", "messages", "Engagement"],
  ["audit", "Activity", "audit.view", "activity", "Governance"],
  ["purchases", "Payments", "payments.view", "coins", "Governance"],
  ["exports", "Exports", "reports.export", "file", "Governance"],
  ["system", "System", "system_health.view", "activity", "Platform"],
  ["settings", "Settings", "configuration.view", "settings", "Platform"]
];

// Words an operator types for an area that are not its label.
const AREA_ALIASES = {
  purchases: "payments approvals recharge libyana pending",
  subscriptions: "plans trials expired renewals",
  users: "students accounts people",
  content: "sheets pdf subjects library summaries active study",
  questions: "question bank import json",
  audit: "activity log history",
  reports: "moderation reports",
  system: "health status"
};

export function isStudioRoute(pathname) {
  return pathname === "/operations" || String(pathname || "").startsWith("/operations/");
}

/**
 * Studio destinations matching a query: areas the session may open, subjects
 * already loaded for the content area, and a student-directory search.
 *
 * @param {string} query
 * @param {unknown} operationsSession
 * @param {Array<{ id: string, title: string, college_title?: string, academic_year_title?: string }>} [subjects]
 */
export function studioSearchResults(query, operationsSession, subjects = []) {
  const needle = normalizeSearchText(query);
  if (!needle) return [];
  const results = [];
  for (const [key, label, capability] of STUDIO_AREAS) {
    if (!hasOperationalCapability(operationsSession, capability)) continue;
    const haystack = normalizeSearchText(`${label} ${AREA_ALIASES[key] || ""}`);
    if (haystack.includes(needle)) {
      results.push({ type: "studio", title: label, subtitle: "Creator Studio", destination: `/operations/admin/${key}` });
    }
  }
  if (hasOperationalCapability(operationsSession, "content.view")) {
    for (const subject of subjects) {
      if (!normalizeSearchText(subject.title).includes(needle)) continue;
      results.push({
        type: "studio-subject",
        title: subject.title,
        subtitle: [subject.college_title, subject.academic_year_title].filter(Boolean).join(" · "),
        destination: `/operations/admin/content?subject=${encodeURIComponent(subject.id)}`
      });
      if (results.length >= 8) break;
    }
  }
  if (hasOperationalCapability(operationsSession, "users.view") && needle.length >= 2) {
    results.push({ type: "studio-student", title: `Find student “${query.trim()}”`, subtitle: "Students", destination: `/operations/admin/users?q=${encodeURIComponent(query.trim())}` });
  }
  return results;
}
