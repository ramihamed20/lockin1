// A signed-in student with no content. Viewport specs need the real shell —
// top bar, sidebar or bottom bar, and a page that is shorter than the screen —
// without depending on fixture data that changes shape over time.
export async function mockStudentApi(page) {
  await page.route("**/api/v1/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    const normalizedPath = pathname.replace(/\/$/, "");

    if (normalizedPath === "/api/v1/auth/session") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          user: {
            id: "viewport-student",
            email: "viewport@example.test",
            full_name: "Viewport Student",
            preferred_language: "en",
            status: "active",
            is_email_verified: true,
            roles: ["student"],
            date_joined: "2026-01-01T00:00:00Z"
          }
        })
      });
      return;
    }

    if (normalizedPath === "/api/v1/operations/session") {
      await route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "permission_denied", message: "Student account" } })
      });
      return;
    }

    if (normalizedPath === "/api/v1/subscriptions/current") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ subscription: { id: "viewport-subscription", status: "active", plan_id: "viewport-plan", access_allowed: true, expires_at: "2999-01-01T00:00:00Z", current_period_ends_at: "2999-01-01T00:00:00Z" } })
      });
      return;
    }

    if (normalizedPath === "/api/v1/entitlements/me") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ results: [] }) });
      return;
    }

    if (normalizedPath === "/api/v1/bookmarks") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ count: 0, next: null, previous: null, results: [] })
      });
      return;
    }

    if (route.request().method() === "GET") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ count: 0, results: [] }) });
      return;
    }

    await route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "not_found", message: "Not used by the viewport tests" } })
    });
  });
}
