export const ACTIVE_SUBSCRIPTION = Object.freeze({
  id: "subscription-active",
  status: "active",
  access_allowed: true,
  current_period_ends_at: "2999-01-01T00:00:00Z",
  expires_at: "2999-01-01T00:00:00Z",
  cancel_at_period_end: false,
  plan: {
    id: "plan-student",
    code: "student-monthly",
    title: "Student Monthly"
  }
});

export const EMPTY_ENTITLEMENTS = Object.freeze([]);

export function studentSession(overrides = {}) {
  return {
    id: "e2e-student",
    email: "student@example.test",
    full_name: "E2E Student",
    preferred_language: "en",
    status: "active",
    is_email_verified: true,
    onboarding_required: false,
    required_profile_fields: [],
    roles: ["student"],
    date_joined: "2026-01-01T00:00:00Z",
    ...overrides
  };
}

export async function fulfillAccessContract(route, pathname) {
  if (pathname === "/api/v1/subscriptions/current") {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ subscription: ACTIVE_SUBSCRIPTION })
    });
    return true;
  }
  if (pathname === "/api/v1/entitlements/me") {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ results: EMPTY_ENTITLEMENTS })
    });
    return true;
  }
  return false;
}
