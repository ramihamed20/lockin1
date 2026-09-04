import { mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { fulfillAccessContract } from "./fixtures/productionApi.js";

const COHORTS = [
  { id: "cohort-61", code: "61", name_en: "Human Medicine 61", name_ar: "الطب البشري 61", program: { id: "medicine", code: "human-medicine", name_en: "Human Medicine", name_ar: "الطب البشري" } },
  { id: "cohort-60", code: "60", name_en: "Human Medicine 60", name_ar: "الطب البشري 60", program: { id: "medicine", code: "human-medicine", name_en: "Human Medicine", name_ar: "الطب البشري" } },
  { id: "cohort-tripoli-dentistry-2", code: "year-2", name_en: "Tripoli Dentistry — Year 2", name_ar: "طب أسنان طرابلس سنة ثانية", program: { id: "dentistry-tripoli", code: "dentistry-tripoli", name_en: "Dentistry — Tripoli", name_ar: "طب الأسنان طرابلس" } },
  { id: "cohort-tripoli-dentistry-1", code: "year-1", name_en: "Tripoli Dentistry — Year 1", name_ar: "طب أسنان طرابلس سنة أولى", program: { id: "dentistry-tripoli", code: "dentistry-tripoli", name_en: "Dentistry — Tripoli", name_ar: "طب الأسنان طرابلس" } },
  { id: "cohort-zawiya-dentistry-2", code: "year-2", name_en: "Zawiya Dentistry — Year 2", name_ar: "طب أسنان زاوية سنة ثانية", program: { id: "dentistry-zawiya", code: "dentistry-zawiya", name_en: "Dentistry — Zawiya", name_ar: "طب الأسنان زاوية" } },
  { id: "cohort-benghazi-dentistry-2", code: "year-2", name_en: "Benghazi Dentistry — Year 2", name_ar: "طب أسنان بنغازي سنة ثانية", program: { id: "dentistry-benghazi", code: "dentistry-benghazi", name_en: "Dentistry — Benghazi", name_ar: "طب الأسنان بنغازي" } },
  { id: "cohort-tripoli-preparatory", code: "preparatory", name_en: "Preparatory Medical Sciences — Tripoli", name_ar: "تمهيدي علوم طبية طرابلس", program: { id: "medical-sciences-tripoli", code: "medical-sciences-tripoli", name_en: "Medical Sciences — Tripoli", name_ar: "علوم طبية طرابلس" } }
];

function userPayload(overrides = {}) {
  return {
    id: "auth-student",
    email: "student@example.test",
    full_name: "Auth Student",
    preferred_language: "en",
    cohort: COHORTS[0],
    status: "active",
    is_email_verified: true,
    onboarding_required: false,
    required_profile_fields: [],
    roles: ["student"],
    date_joined: "2026-01-01T00:00:00Z",
    ...overrides
  };
}

async function mockAuth(page, { sessionUser = null, loginDelay = 0, cohortFailures = 0, sessionFailures = 0, sessionFailureStatus = 503, isDisconnected = () => false } = {}) {
  const captured = { registration: null, profile: null, sessionRequests: 0 };
  let cohortRequests = 0;
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (pathname === "/api/v1/auth/session") {
      captured.sessionRequests += 1;
      if (isDisconnected()) {
        await route.abort("internetdisconnected");
        return;
      }
      if (captured.sessionRequests <= sessionFailures) {
        await route.fulfill({ status: sessionFailureStatus, contentType: "application/json", body: JSON.stringify({ error: { code: "service_unavailable", message: "upstream connect error to db-prod-3" } }) });
        return;
      }
      if (sessionUser) await route.fulfill({ contentType: "application/json", body: JSON.stringify({ user: sessionUser }) });
      else await route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: { code: "not_authenticated", message: "Authentication required." } }) });
      return;
    }
    if (pathname === "/api/v1/auth/csrf") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ csrf_token: "auth-csrf" }) });
      return;
    }
    if (pathname === "/api/v1/auth/cohorts") {
      cohortRequests += 1;
      if (cohortRequests <= cohortFailures) {
        await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "service_unavailable", message: "Temporarily unavailable" } }) });
        return;
      }
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ cohorts: COHORTS }) });
      return;
    }
    if (pathname === "/api/v1/auth/oauth/providers") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ providers: { google: true, apple: true } }) });
      return;
    }
    if (pathname === "/api/v1/auth/login" && request.method() === "POST") {
      if (loginDelay) await new Promise((resolve) => setTimeout(resolve, loginDelay));
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ user: userPayload() }) });
      return;
    }
    if (pathname === "/api/v1/auth/register" && request.method() === "POST") {
      captured.registration = request.postDataJSON();
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ status: "verification_required" }) });
      return;
    }
    if (pathname === "/api/v1/auth/password-reset" && request.method() === "POST") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ status: "accepted" }) });
      return;
    }
    if (pathname === "/api/v1/account/profile" && request.method() === "PATCH") {
      captured.profile = request.postDataJSON();
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ user: userPayload({ cohort: COHORTS[0] }) }) });
      return;
    }
    if (pathname === "/api/v1/operations/session") {
      await route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: { code: "permission_denied", message: "Student account" } }) });
      return;
    }
    if (await fulfillAccessContract(route, pathname)) return;
    await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "not_found", message: "Not used in auth tests" } }) });
  });
  return captured;
}

async function authMetrics(page) {
  return page.evaluate(() => {
    const logo = document.querySelector(".auth-v2-brand")?.getBoundingClientRect();
    const language = document.querySelector(".auth-v2-language")?.getBoundingClientRect();
    return {
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      dir: document.documentElement.dir,
      logoLeft: logo?.left ?? -1,
      languageRight: language ? window.innerWidth - language.right : -1,
      physicalOrder: Boolean(logo && language && logo.left < language.left)
    };
  });
}

test.beforeAll(async () => { await mkdir("output/playwright", { recursive: true }); });

test("login remains polished and usable across phone, iPad, landscape, desktop, and standalone PWA", async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(navigator, "standalone", { configurable: true, value: true }); localStorage.setItem("lock-in.locale", "en"); });
  await mockAuth(page);
  await page.goto("/#/");
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeEnabled();
  // Google is the only federated option, even though the mock still offers Apple.
  await expect(page.getByRole("button", { name: /Apple/i })).toHaveCount(0);

  for (const viewport of [
    { width: 320, height: 568 },
    { width: 375, height: 812 },
    { width: 390, height: 844 },
    { width: 412, height: 915 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
    { width: 1440, height: 900 }
  ]) {
    await page.setViewportSize(viewport);
    const metrics = await authMetrics(page);
    expect(metrics.overflow).toBe(0);
    expect(metrics.physicalOrder).toBe(true);
    const googleBox = await page.getByRole("button", { name: "Continue with Google" }).boundingBox();
    expect(googleBox.height).toBeGreaterThanOrEqual(44);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "output/playwright/auth-login-phone.png", fullPage: true });
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.screenshot({ path: "output/playwright/auth-login-ipad-portrait.png", fullPage: true });
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.screenshot({ path: "output/playwright/auth-login-ipad-landscape.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 420 });
  await page.getByLabel("Password", { exact: true }).focus();
  await page.getByLabel("Password", { exact: true }).scrollIntoViewIfNeeded();
  await expect.poll(async () => page.getByLabel("Password", { exact: true }).evaluate((field) => {
    const bounds = field.getBoundingClientRect();
    return bounds.top >= 0 && bounds.bottom <= (window.visualViewport?.height || window.innerHeight);
  })).toBe(true);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: "output/playwright/auth-login-desktop.png", fullPage: true });
});

// The report was that the interface visibly jumped the moment typing started.
// A field that is already fully on screen must not be scrolled at all when it
// receives focus — any motion there is not "revealing an occluded field", it
// is an artifact of scroll geometry (e.g. an oversized `scroll-padding`)
// forcing the browser to scroll further than the gesture needs.
test("focusing an already-visible field never scrolls the page", async ({ page }) => {
  await mockAuth(page);
  await page.addInitScript(() => localStorage.setItem("lock-in.locale", "en"));
  await page.goto("/#/");
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();

  // A phone viewport with a keyboard already occluding the lower part of the
  // screen (the "content resizes" shape some browsers use), so every field is
  // exactly as visible as it will ever be at this width.
  await page.setViewportSize({ width: 390, height: 524 });
  for (const label of ["Email", "Password"]) {
    await page.evaluate(() => window.scrollTo(0, 0));
    const field = page.getByLabel(label, { exact: true });
    const visibleBefore = await field.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return bounds.top >= 0 && bounds.bottom <= window.innerHeight;
    });
    await field.focus();
    await field.evaluate((element) => element.scrollIntoView({ block: "nearest" }));
    await page.waitForTimeout(80);
    const scrollY = await page.evaluate(() => window.scrollY);
    if (visibleBefore) expect({ label, scrollY }).toEqual({ label, scrollY: 0 });
  }
});

test("program and class selection recover when the cohort request initially fails", async ({ page }) => {
  await mockAuth(page, { cohortFailures: 1 });
  await page.goto("/#/");
  await page.getByRole("button", { name: "Create account" }).click();
  const program = page.getByRole("combobox", { name: "Program" });
  const cohort = page.getByRole("combobox", { name: "Class" });
  await expect(page.getByText("We couldn’t load the available programs and classes.")).toBeVisible();
  await expect(program).toBeDisabled();
  await expect(cohort).toBeDisabled();

  await page.getByRole("button", { name: "Try again" }).click();
  await expect(program.getByRole("option", { name: "Human Medicine" })).toBeAttached();
  await expect(program).toBeEnabled();
  await expect(page.getByText("We couldn’t load the available programs and classes.")).toHaveCount(0);
  // The class list stays closed until a program narrows it.
  await expect(cohort).toBeDisabled();

  await program.selectOption("medicine");
  await expect(cohort).toBeEnabled();
  await cohort.selectOption("cohort-61");
  await expect(cohort).toHaveValue("cohort-61");

  // Switching program clears a class that no longer belongs to it.
  await program.selectOption("dentistry-tripoli");
  await expect(cohort).toHaveValue("");
  await expect(cohort.getByRole("option", { name: "Human Medicine 61" })).toHaveCount(0);
  await expect(cohort.getByRole("option", { name: "Tripoli Dentistry — Year 2" })).toBeAttached();
});

test("Arabic uses RTL content while the logo and language control keep physical corners", async ({ page }) => {
  await mockAuth(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/");
  await page.getByRole("combobox", { name: "Language" }).selectOption("ar");
  await expect(page.getByRole("heading", { name: "مرحبًا بعودتك" })).toBeVisible();
  const metrics = await authMetrics(page);
  expect(metrics).toMatchObject({ overflow: 0, dir: "rtl", physicalOrder: true });
  expect(Math.abs(metrics.logoLeft - metrics.languageRight)).toBeLessThan(4);
  await expect(page.locator(".auth-v2-brand")).toBeVisible();
  await page.locator(".auth-v2-topbar").screenshot({ path: "output/playwright/auth-header-arabic.png" });
  await page.screenshot({ path: "output/playwright/auth-login-arabic.png", fullPage: true });
});

test("registration sends the selected data-backed cohort and preserves accessible loading geometry", async ({ page }) => {
  const captured = await mockAuth(page, { loginDelay: 6000 });
  await page.goto("/#/");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
  const program = page.getByRole("combobox", { name: "Program" });
  const cohort = page.getByRole("combobox", { name: "Class" });
  await expect(program.getByRole("option", { name: "Human Medicine" })).toBeAttached();
  await expect(program.getByRole("option", { name: "Dentistry — Tripoli" })).toBeAttached();
  await expect(program.getByRole("option", { name: "Medical Sciences — Tripoli" })).toBeAttached();
  await page.getByLabel("Full name").fill("New Student");
  await program.selectOption("medicine");
  await expect(cohort.getByRole("option", { name: "Human Medicine 61" })).toBeAttached();
  await expect(cohort.getByRole("option", { name: "Human Medicine 60" })).toBeAttached();
  // Classes belonging to another program must never leak into the list.
  await expect(cohort.getByRole("option", { name: "Tripoli Dentistry — Year 2" })).toHaveCount(0);
  await cohort.selectOption("cohort-61");
  await page.getByLabel("Email").fill("new@example.test");
  await page.getByLabel("Password", { exact: true }).fill("Lock-in-test-pass-2026");
  await page.getByLabel("Confirm password").fill("Lock-in-test-pass-2026");
  await page.locator(".auth-v2-policy input").check();
  await page.locator(".auth-v2-form").evaluate((form) => form.requestSubmit());
  await expect.poll(() => captured.registration?.cohort_id).toBe("cohort-61");
  await expect(page.getByText(/Account created/)).toBeVisible();

  await page.getByRole("button", { name: "Log in" }).click();
  await page.getByLabel("Email").fill("student@example.test");
  await page.getByLabel("Password", { exact: true }).fill("Lock-in-test-pass-2026");
  const submit = page.locator(".auth-v2-primary");
  const before = await submit.boundingBox();
  await submit.evaluate((button) => button.click());
  await expect(submit).toBeDisabled();
  const during = await submit.boundingBox();
  expect(during.height).toBe(before.height);
  expect(during.y).toBe(before.y);
});

test("social onboarding asks only for the missing class", async ({ page }) => {
  const incomplete = userPayload({ cohort: null, onboarding_required: true, required_profile_fields: ["cohort"] });
  const captured = await mockAuth(page, { sessionUser: incomplete });
  await page.goto("/?oauth=success&provider=google#/");
  await expect(page.getByRole("heading", { name: "Complete your account" })).toBeVisible();
  // The class is chosen through its program, and nothing already supplied by
  // the provider is asked for again.
  await expect(page.getByLabel("Program")).toBeVisible();
  await expect(page.getByLabel("Class")).toBeVisible();
  await expect(page.getByLabel("Full name")).toHaveCount(0);
  await expect(page.getByLabel("Email")).toHaveCount(0);
  await expect(page.getByLabel("Password")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Continue with Google" })).toHaveCount(0);
  await page.getByLabel("Program").selectOption("medicine");
  await page.getByLabel("Class").selectOption("cohort-61");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect.poll(() => captured.profile?.cohort_id).toBe("cohort-61");
});

test("forgot-password flow keeps its generic recovery response", async ({ page }) => {
  await mockAuth(page);
  await page.goto("/#/");
  await page.getByRole("button", { name: "Forgot password?" }).click();
  await expect(page.getByRole("heading", { name: "Reset your password" })).toBeVisible();
  await page.getByLabel("Email").fill("student@example.test");
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByText(/If this email is registered/)).toBeVisible();
});

test("a transient session failure recovers on its own without asking the reader", async ({ page }) => {
  const captured = await mockAuth(page, { sessionUser: userPayload(), sessionFailures: 2 });
  await page.goto("/#/");
  // Two backed-off retries land inside the automatic budget, so the reader is
  // kept informed and is never asked to take an action.
  const shell = page.locator(".startup-shell");
  await expect(shell).toContainText(/Reconnecting|Opening your study room/, { timeout: 10_000 });
  await expect(shell.getByRole("button", { name: "Try again" })).toHaveCount(0);
  await expect(shell).toHaveCount(0, { timeout: 20_000 });
  expect(captured.sessionRequests).toBe(3);
});

test("a persistent session failure stops retrying and offers a retry that works", async ({ page }) => {
  // One initial attempt plus the three automatic retries all fail.
  const captured = await mockAuth(page, { sessionUser: userPayload(), sessionFailures: 4 });
  await page.goto("/#/");
  const retry = page.getByRole("button", { name: "Try again" });
  await expect(retry).toBeVisible({ timeout: 20_000 });
  expect(captured.sessionRequests).toBe(4);

  // The 5xx body named an internal host; the reader is never shown it.
  const shell = page.locator(".startup-shell");
  await expect(shell).toContainText("The server is having trouble right now.");
  await expect(shell).not.toContainText("db-prod-3");
  await expect(shell).not.toContainText("upstream");

  await retry.click();
  await expect(retry).toHaveCount(0);
  await expect(page.locator(".startup-shell")).toHaveCount(0, { timeout: 20_000 });
  expect(captured.sessionRequests).toBe(5);
});

test("an offline start explains itself and recovers when the connection returns", async ({ page }) => {
  let disconnected = true;
  await page.addInitScript(() => {
    window.__forcedOffline = true;
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => !window.__forcedOffline });
  });
  const captured = await mockAuth(page, { sessionUser: userPayload(), isDisconnected: () => disconnected });
  await page.goto("/#/");

  const shell = page.locator(".startup-shell");
  await expect(shell).toContainText("You appear to be offline", { timeout: 20_000 });
  await expect(shell).toContainText("this device");
  // Retrying while offline would only burn the budget, so exactly one attempt was made.
  await page.waitForTimeout(1_200);
  expect(captured.sessionRequests).toBe(1);
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();

  disconnected = false;
  await page.evaluate(() => {
    window.__forcedOffline = false;
    window.dispatchEvent(new Event("online"));
  });
  await expect(page.locator(".startup-shell")).toHaveCount(0, { timeout: 20_000 });
  expect(captured.sessionRequests).toBe(2);
});
