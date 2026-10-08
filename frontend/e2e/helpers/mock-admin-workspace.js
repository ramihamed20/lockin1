import { STUDIO_AREAS } from "../../src/lib/studioAreas.js";
export const ID = "00000000-0000-4000-8000-000000000201";
export const STUDENT = { id: ID, full_name: "Synthetic Student", email: "long.synthetic.student.address@example.test", status: "active", product_roles: ["student"], cohort: null, date_joined: "2026-10-01T12:00:00Z" };
const DETAIL = { ...STUDENT, email_verified: true, preferred_language: "ar", sessions: [], subscriptions: [], purchases: [], learning_activity: { focus_sessions: [], progress: [] }, assessments: { attempts: [], results: [] } };
const ANALYTICS = {
  period: { from: "2026-09-01", to: "2026-10-01" },
  users: { total: 1, new_week: 1, online_now: 0, seen_today: 0 },
  learning: { active_learners: 0, focus_sessions: 0, focus_sessions_today: 0, focus_seconds: 0, focus_activity: [], completion_rate: 0, material_completions: 0, quiz_attempts: 0, exam_attempts: 0, average_score: null, pass_rate: null, most_used_materials: [], most_active_subjects: [] },
  creators: { content_awaiting_review: 0 }, operations: { failed_notification_deliveries: 0 },
  revenue: { net_minor: 0, paying_users: 0, gross_minor: 0, refund_total_minor: 0, average_order_minor: 0, failed_payments: 0 },
  subscriptions: { churn_rate: null, renewals: 0, active: 0, trial: 0, expired: 0, cancelled: 0, upcoming_expirations: 0 },
  manual_reviews: { pending: 0, approved: 0, rejected: 0 }
};

export async function mockAdmin(page, { locale = "en", detailGate = null, detailStatus = 200, listStatus = () => 200, actionGate = null } = {}) {
  const writes = [];
  await page.addInitScript((lang) => {
    localStorage.setItem("lock-in.locale", lang);
    localStorage.setItem("lock-in.pwa-launch.dismissed-at", String(Date.now()));
  }, locale);
  await page.route("**/api/v1/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    const json = (data, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });
    if (pathname.endsWith("/auth/session")) return json({ user: { ...STUDENT, roles: ["student", "administrator"], is_email_verified: true, preferred_language: locale } });
    if (pathname.endsWith("/auth/csrf")) return json({ csrf_token: "synthetic-csrf" });
    if (pathname.endsWith("/operations/session")) return json({ roles: ["administrator"], capabilities: [...STUDIO_AREAS.map((area) => area[2]), "users.manage", "configuration.manage", "notifications.manage", "content.manage", "assessments.manage"], dashboards: ["overview"], timezone: "UTC" });
    if (pathname.endsWith("/analytics/dashboard")) return json(ANALYTICS);
    if (pathname.endsWith("/analytics/scope")) return json({ scope: { level: "overall" }, options: { universities: [], specialties: [], years: [] }, metrics: {}, breakdown: { level: "university", rows: [] } });
    if (pathname.endsWith("/dashboards/overview")) return json({ queues: {}, recent_events: [] });
    if (pathname.endsWith("/system-health")) return json({ status: "ok", components: [{ code: "database", status: "ok" }], checked_at: "2026-10-01T12:00:00Z" });
    if (pathname.endsWith("/configuration")) return json({ results: [{ key: "trial.enabled", name: "Trial availability", description: "Synthetic setting", value: true, value_type: "boolean", version: 1 }] });
    if (pathname.endsWith("/operations/users")) {
      const status = listStatus();
      return json(status === 200 ? { count: 1, results: [STUDENT] } : { error: { code: status === 403 ? "permission_denied" : "server_error", message: "Synthetic load failure" } }, status);
    }
    if (pathname.endsWith(`/users/${ID}/actions`)) {
      writes.push(route.request().postDataJSON());
      if (actionGate) await actionGate;
      return json({ user: DETAIL });
    }
    if (pathname.endsWith(`/users/${ID}`)) {
      if (detailGate) await detailGate;
      return json(detailStatus === 200 ? DETAIL : { error: { code: "server_error", message: "Synthetic detail failure" } }, detailStatus);
    }
    if (pathname.endsWith("/lofi-scenes")) return json({ scenes: [], max_scenes: 12, min_seconds: 2, max_seconds: 300, max_bytes: 50 * 1024 * 1024, recommended: { width: 1920, height: 1080, alternative: "1280×720" } });
    return json({ count: 0, results: [], plans: [], editions: [] });
  });
  return writes;
}

