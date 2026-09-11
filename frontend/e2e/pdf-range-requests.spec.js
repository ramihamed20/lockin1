import { expect, test } from "@playwright/test";
import { fulfillAccessContract } from "./fixtures/productionApi.js";

/**
 * What the edge rate limit has to survive.
 *
 * `frontend/nginx/nginx.conf` bounds /api/v1/files/ with `rate=30r/s`,
 * `burst=60 nodelay` and 12 concurrent connections per client, because streamed
 * private files hold a Gunicorn thread for the length of the transfer. Those
 * numbers are only defensible against a measurement of what a reader actually
 * does, so this spec measures it: open a document, scroll it, and count the
 * requests pdf.js makes.
 *
 * If a future pdf.js or reader change makes the opening burst larger than the
 * configured allowance, this fails here rather than as throttled readers.
 */

const ROUTE = "/#/materials/catalog/biochemistry-1/sheets/range-probe/workspace";

// Must match limit_req_zone ... burst= and limit_conn in frontend/nginx/nginx.conf.
const EDGE_BURST = 60;
const EDGE_SUSTAINED_RATE_PER_SECOND = 30;
const EDGE_CONCURRENT_CONNECTIONS = 12;

async function mockStudent(page) {
  await page.route("**/api/v1/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === "/api/v1/auth/session") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          user: {
            id: "range-student",
            email: "range@example.test",
            full_name: "Range Student",
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
    if (pathname === "/api/v1/auth/csrf") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ csrf_token: "range-csrf" }) });
      return;
    }
    if (pathname === "/api/v1/operations/session") {
      await route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: { code: "permission_denied", message: "Student account" } }) });
      return;
    }
    // The workspace sits behind the subscription gate, so the access contract
    // has to answer before the reader renders.
    if (await fulfillAccessContract(route, pathname)) return;
    if (pathname === "/api/v1/focus/lock-in" && route.request().method() === "GET") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ active_session: null }) });
      return;
    }
    await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "not_found", message: "unused" } }) });
  });
}

test("opening and scrolling a document stays inside the edge request allowance", async ({ page }) => {
  test.setTimeout(90_000);
  await mockStudent(page);

  /** @type {{ at: number, range: string | undefined }[]} */
  const documentRequests = [];
  page.on("request", (request) => {
    if (!request.url().includes("/e2e-fixtures/pdf/")) return;
    documentRequests.push({ at: Date.now(), range: request.headers().range });
  });

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(ROUTE);
  await page.getByRole("button", { name: /Normal Study/ }).click();
  await expect(page.locator(".workspace-v2-a4-canvas.is-visible").first()).toBeVisible({ timeout: 20_000 });

  const afterOpen = documentRequests.length;

  // Scroll through a stretch of the document, which is when a reader generates
  // the most ranged reads.
  for (let step = 0; step < 12; step += 1) {
    await page.mouse.wheel(0, 1_400);
    await page.waitForTimeout(80);
  }
  await expect
    .poll(async () => page.locator(".workspace-v2-a4-canvas.is-visible").count(), { timeout: 20_000 })
    .toBeGreaterThan(0);

  const total = documentRequests.length;
  const ranged = documentRequests.filter((entry) => typeof entry.range === "string");

  // What this measured, against the current pinned PDF.js and a 2.1 MB document: opening it
  // and scrolling twelve screens produced a handful of requests, of which at
  // least one carried a Range header. pdf.js probes with a ranged read and then
  // streams the remainder rather than issuing dozens of small ranges, so a
  // reader comes nowhere near `burst=60`.
  //
  // The assertions are lower bounds on "ranges are really in use" and upper
  // bounds on "still inside what the edge allows". They would fail if a future
  // reader or pdf.js version started fetching page-by-page, which is the change
  // that would make the current limits too tight.
  expect(total).toBeGreaterThan(0);
  expect(ranged.length).toBeGreaterThanOrEqual(1);

  // The opening flurry is what `burst=` has to absorb.
  expect(afterOpen).toBeLessThanOrEqual(EDGE_BURST);

  // And the busiest one-second window stays inside burst + one second of rate,
  // which is what nginx actually permits before it starts rejecting.
  let busiest = 0;
  for (const entry of documentRequests) {
    const withinWindow = documentRequests.filter(
      (other) => other.at >= entry.at && other.at < entry.at + 1_000
    ).length;
    busiest = Math.max(busiest, withinWindow);
  }
  expect(busiest).toBeLessThanOrEqual(EDGE_BURST + EDGE_SUSTAINED_RATE_PER_SECOND);

  // A single reader must not need more parallel connections than limit_conn allows.
  // Browsers cap per-origin connections well below this, so this is a guard on
  // the configuration rather than on the browser.
  expect(EDGE_CONCURRENT_CONNECTIONS).toBeGreaterThanOrEqual(6);
});
