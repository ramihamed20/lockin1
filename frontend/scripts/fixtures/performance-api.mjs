import { ACTIVE_SUBSCRIPTION, EMPTY_ENTITLEMENTS, studentSession } from '../../e2e/fixtures/productionApi.js';

// Local benchmark data only. Used by a test server, never by the application.
const materials = Array.from({ length: 12 }, (_, index) => ({
  slug: 'perf-subject-' + (index + 1), title: 'Synthetic Subject ' + (index + 1),
  sheets: Array.from({ length: 12 }, (_, sheet) => ({
    slug: 'sheet-' + (sheet + 1), number: sheet + 1, title: 'Synthetic Sheet ' + (sheet + 1),
    pdfUrl: '/e2e-fixtures/pdf/sheet-41.pdf', pageCount: 41, hasActiveStudy: false
  }))
}));
export function performanceApiResponse(pathname) {
  const path = pathname.replace(/\/$/, '');
  const responses = {
    '/api/v1/auth/session': { user: studentSession({ id: 'perf-navigation', email: 'perf@example.test' }) },
    '/api/v1/subscriptions/current': { subscription: ACTIVE_SUBSCRIPTION },
    '/api/v1/entitlements/me': EMPTY_ENTITLEMENTS,
    '/api/v1/dashboard': { account: { active_sessions: 1 } },
    '/api/v1/learning/dashboard': { completed_count: 14, bookmark_count: 8 },
    '/api/v1/progression/streak': { current_days: 7, longest_days: 12 },
    '/api/v1/progression/xp': { level: 2, total_xp: 100 },
    '/api/v1/notifications/summary': { unread_count: 0 },
    '/api/v1/focus/lock-in': { active_session: null },
    '/api/v1/catalog/materials': { count: materials.length, results: materials },
    '/api/v1/review-bank': { count: 0, active_count: 0, hidden_count: 0, subjects: [], results: [] }
  };
  if (path === '/api/v1/operations/session') return { status: 403, body: { error: { code: 'permission_denied', message: 'Synthetic student' } } };
  if (path in responses) return { status: 200, body: responses[path] };
  return { status: 200, body: { count: 0, next: null, previous: null, results: [] } };
}
