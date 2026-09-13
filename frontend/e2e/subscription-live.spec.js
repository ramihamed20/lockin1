import { mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";

const LIVE_QA = process.env.LOCKIN_SUBSCRIPTION_LIVE === "1";
const SCREENSHOT_DIR = "output/playwright/subscription";

test.describe.configure({ mode: "serial" });
test.skip(!LIVE_QA, "Runs only against the isolated local Django subscription QA database.");

async function useLocale(page, locale) {
  await page.addInitScript((value) => {
    localStorage.setItem("lock-in.locale", value);
  }, locale);
}

async function login(page, email, password, locale = "en") {
  await useLocale(page, locale);
  await page.goto("/#/");
  const emailLabel = locale === "ar" ? "البريد الإلكتروني" : "Email";
  const passwordLabel = locale === "ar" ? "كلمة المرور" : "Password";
  const emailField = page.getByLabel(emailLabel, { exact: true });
  const passwordField = page.getByLabel(passwordLabel, { exact: true });
  // The sign-in form becomes actionable a little before the application has
  // finished settling around it, and a value written inside that window is
  // discarded by the render that follows -- measured at roughly the first
  // 100-300ms after navigation, on this build and on the one before this
  // branch. A person cannot click and type that fast; Playwright can, and did,
  // which made this whole serial file fail at its first login with an empty
  // form. Write the credentials and keep writing them until they stay.
  await expect(async () => {
    await emailField.fill(email);
    await passwordField.fill(password);
    await expect(emailField).toHaveValue(email, { timeout: 1_000 });
    await expect(passwordField).toHaveValue(password, { timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  const loginResponse = page.waitForResponse((response) => (
    response.url().includes("/auth/login") && response.request().method() === "POST"
  ));
  await page.locator(".auth-v2-primary").click();
  await loginResponse;
}

async function loginAdmin(page) {
  await login(page, "admin@lockin.local", "Admin123!");
  const usernameHeading = page.getByRole("heading", { name: "Choose your username" });
  const needsUsername = await usernameHeading.waitFor({ state: "visible", timeout: 2_000 })
    .then(() => true)
    .catch(() => false);
  if (needsUsername) {
    await page.getByLabel("Username", { exact: true }).fill("qa_admin");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
  }
}

async function responsiveAudit(page, viewports, prefix) {
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    const audit = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      hiddenActions: [...document.querySelectorAll("button, a, input, select")]
        .filter((node) => {
          const box = node.getBoundingClientRect();
          const style = getComputedStyle(node);
          return style.visibility !== "hidden" && style.display !== "none"
            && box.width > 0 && box.height > 0
            && (box.right < -1 || box.left > window.innerWidth + 1);
        }).length
    }));
    expect(audit, `${prefix} ${viewport.width}x${viewport.height}`).toEqual({
      overflow: 0,
      hiddenActions: 0
    });
  }
}

async function currentSubscription(page) {
  return page.evaluate(async () => {
    const response = await fetch("/api/v1/subscriptions/current", { credentials: "same-origin" });
    if (!response.ok) throw new Error(`Subscription request failed: ${response.status}`);
    return response.json();
  });
}

function addDays(iso, days) {
  return new Date(new Date(iso).getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

test.beforeAll(async () => {
  await mkdir(SCREENSHOT_DIR, { recursive: true });
});

test("Google-created accounts complete username onboarding once, then see welcome", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, "qa.google@lockin.local", "StudyQA123!");

  await expect(page.getByRole("heading", { name: "Choose your username" })).toBeVisible();
  await page.getByLabel("Username", { exact: true }).fill("qa_google");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Welcome to Lock-in" })).toBeVisible();
  await expect(page.getByText("7 days", { exact: true })).toBeVisible();
  await page.screenshot({ path: `${SCREENSHOT_DIR}/google-username-to-welcome-phone.png`, fullPage: true });

  await page.getByRole("button", { name: "Start my free trial" }).click();
  await expect(page).toHaveURL(/#\/dashboard$/);
  await expect(page.getByRole("heading", { name: "Choose your username" })).toHaveCount(0);
});

test("trial welcome and provisional Libyana payment work on production viewports", async ({ page }) => {
  await login(page, "qa.trial@lockin.local", "StudyQA123!");
  await expect(page.getByRole("heading", { name: "Welcome to Lock-in" })).toBeVisible();

  await responsiveAudit(page, [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
    { width: 430, height: 932 },
    { width: 834, height: 1194 },
    { width: 1194, height: 834 }
  ], "welcome");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${SCREENSHOT_DIR}/welcome-phone-portrait.png`, fullPage: true });
  await page.setViewportSize({ width: 844, height: 390 });
  await page.screenshot({ path: `${SCREENSHOT_DIR}/welcome-phone-landscape.png`, fullPage: true });
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.screenshot({ path: `${SCREENSHOT_DIR}/welcome-ipad-portrait.png`, fullPage: true });
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.screenshot({ path: `${SCREENSHOT_DIR}/welcome-ipad-landscape.png`, fullPage: true });

  await page.getByRole("button", { name: "Subscribe now" }).click();
  await expect(page.getByRole("heading", { name: "Pay with Libyana" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Plans coming soon" })).toBeVisible();
  await expect(page.getByText("نصف السنة - طب الأسنان", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Coming Soon", exact: true })).toBeDisabled();
  const code = page.locator("#libyana-payment input[required]");
  await expect(code).toHaveAttribute("dir", "ltr");
  await code.fill("4567890123456");
  await page.getByRole("button", { name: "Submit card and continue" }).click();
  await expect(page.getByText("Payment being reviewed", { exact: true })).toBeVisible({
    timeout: 15_000
  });
  await expect(page.getByText("4567890123456", { exact: true })).toHaveCount(0);

  await responsiveAudit(page, [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
    { width: 430, height: 932 },
    { width: 834, height: 1194 },
    { width: 1194, height: 834 }
  ], "payment");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${SCREENSHOT_DIR}/payment-pending-phone.png`, fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: `${SCREENSHOT_DIR}/payment-pending-desktop.png`, fullPage: true });
});

/** POST through the browser's own session, so the server sees a real reviewer. */
async function postAsSession(page, path, body) {
  return page.evaluate(async ({ path: target, body: payload }) => {
    const csrf = await fetch("/api/v1/auth/csrf", { credentials: "same-origin" })
      .then((response) => response.json())
      .then((data) => data.csrf_token);
    const response = await fetch(`/api/v1${target}`, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "X-CSRFToken": csrf,
        "Idempotency-Key": `live-qa-${Math.random().toString(36).slice(2)}${Date.now()}`
      },
      body: JSON.stringify(payload)
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  }, { path, body });
}

async function accessSnapshot(page) {
  return page.evaluate(async () => {
    const [subscription, entitlements] = await Promise.all([
      fetch("/api/v1/subscriptions/current", { credentials: "same-origin" }).then((r) => r.json()),
      fetch("/api/v1/entitlements/me", { credentials: "same-origin" }).then((r) => r.json())
    ]);
    return { subscription: subscription.subscription, entitlements: entitlements.results };
  });
}

test("a repeated approval grants nothing twice and entitlements match the settled state", async ({ browser }) => {
  test.setTimeout(90_000);
  // qa.trial submitted a card in the previous test and is still awaiting review.
  const studentContext = await browser.newContext();
  const studentPage = await studentContext.newPage();
  await login(studentPage, "qa.trial@lockin.local", "StudyQA123!");
  await studentPage.goto("/#/subscription");
  const before = await accessSnapshot(studentPage);
  expect(before.subscription.manual_payment_review.status).toBe("pending");
  const paymentId = before.subscription.manual_payment_review.payment_id;

  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  await loginAdmin(adminPage);
  await adminPage.goto("/#/operations/admin/purchases");

  const first = await postAsSession(adminPage, `/operations/admin/purchases/${paymentId}/manual-review`, {
    decision: "approve",
    reason: "Live QA approval, first decision"
  });
  expect(first.status).toBe(200);
  const afterFirst = await accessSnapshot(studentPage);

  // The same decision again, with a different idempotency key, through the same
  // endpoint an administrator's second click would reach.
  const second = await postAsSession(adminPage, `/operations/admin/purchases/${paymentId}/manual-review`, {
    decision: "approve",
    reason: "Live QA approval, repeated decision"
  });
  const afterSecond = await accessSnapshot(studentPage);
  await adminContext.close();

  // Repeating it neither extends the subscription nor bumps its revision.
  expect(afterSecond.subscription.current_period_ends_at).toBe(afterFirst.subscription.current_period_ends_at);
  expect(afterSecond.subscription.revision).toBe(afterFirst.subscription.revision);
  expect(afterSecond.subscription.status).toBe("active");
  expect(afterSecond.subscription.payment_verification).toBe("verified");
  expect(second.status).toBe(200);

  // Entitlements describe the subscription that is actually in force: granted,
  // sourced from it, and ending no earlier than the access it pays for.
  const studyCodes = afterSecond.entitlements.map((grant) => grant.code);
  for (const code of ["focus.workspace", "content.premium"]) {
    expect(studyCodes, `${code} is granted after approval`).toContain(code);
  }
  // The endpoint returns only grants that can authorise access right now, so
  // their presence is the assertion; what is checked here is that each one
  // covers the paid period rather than expiring inside it.
  const expiry = Date.parse(afterSecond.subscription.current_period_ends_at);
  for (const grant of afterSecond.entitlements) {
    expect(grant.source_type).toBe("subscription");
    if (grant.ends_at) expect(Date.parse(grant.ends_at)).toBeGreaterThanOrEqual(expiry);
  }
  expect(afterSecond.subscription.access_allowed).toBe(true);

  // And the console no longer presents a decision that has already been taken.
  const reviewedContext = await browser.newContext();
  const reviewedPage = await reviewedContext.newPage();
  await loginAdmin(reviewedPage);
  await reviewedPage.goto("/#/operations/admin/purchases");
  await reviewedPage.getByRole("button", { name: "Approved", exact: true }).click();
  await reviewedPage.getByRole("button").filter({ hasText: "@qa_trial" }).first().click();
  await expect(reviewedPage.locator(".ops-review .ops-badge")).toHaveText("Approved");
  await expect(reviewedPage.getByRole("button", { name: "Approve payment" })).toHaveCount(0);
  await expect(reviewedPage.getByRole("button", { name: "Reject payment" })).toHaveCount(0);
  await reviewedContext.close();
  await studentContext.close();
});

test("expired Arabic account retains renewal/account access without RTL overflow", async ({ page }) => {
  await login(page, "qa.expired@lockin.local", "StudyQA123!", "ar");
  await expect(page.getByRole("heading", { name: "الدفع ببطاقة ليبيانا" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await responsiveAudit(page, [
    { width: 390, height: 844 },
    { width: 844, height: 390 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 }
  ], "expired RTL");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${SCREENSHOT_DIR}/expired-arabic-phone.png`, fullPage: true });

  await expect(page.getByLabel("رمز بطاقة التعبئة")).toHaveAttribute("dir", "ltr");
});

test("an approval reaches the student's open tab without a manual refresh", async ({ browser }) => {
  // The bug this guards: the access snapshot was cached as fresh for ever while
  // a reader had no access, and the poll that could have refreshed it was
  // skipped for exactly those readers. An administrator approved the card and
  // the student kept the "awaiting review" screen for the rest of the session.
  test.setTimeout(120_000);
  const studentContext = await browser.newContext();
  const studentPage = await studentContext.newPage();
  await login(studentPage, "qa.review@lockin.local", "StudyQA123!");
  await studentPage.goto("/#/subscription");
  await expect(studentPage.getByRole("heading", { name: "Your recharge card is being reviewed" })).toBeVisible();

  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  await loginAdmin(adminPage);
  await adminPage.goto("/#/operations/admin/purchases");
  await expect(adminPage.getByRole("heading", { name: "Payments" }).first()).toBeVisible();
  await adminPage.getByRole("button").filter({ hasText: "@qa_review" }).first().click();
  // The full number is readable exactly while the decision is open.
  await expect(adminPage.getByText("5656565612345", { exact: true })).toBeVisible();
  await adminPage.getByLabel("Review reason").fill("Approved during live parity check");
  await adminPage.getByRole("button", { name: "Approve payment" }).click();
  await adminPage.getByRole("button", { name: "Approve payment", exact: true }).last().click();

  await expect(adminPage.locator(".ops-review .ops-badge")).toHaveText("Approved");
  await expect(adminPage.getByText(
    "Payment approved. The subscription is verified and the reader has access.",
    { exact: true }
  )).toBeVisible();
  // Decided: the reversible code is destroyed, the last four digits remain.
  await expect(adminPage.getByText("5656565612345", { exact: true })).toHaveCount(0);
  await expect(adminPage.locator(".ops-review .ops-code").first()).toContainText("2345");
  await adminPage.setViewportSize({ width: 1024, height: 768 });
  await adminPage.screenshot({ path: `${SCREENSHOT_DIR}/admin-payment-approved-ipad.png`, fullPage: true });
  await adminContext.close();

  // No reload, no navigation: the student's own tab has to notice.
  await expect(studentPage.getByRole("heading", { name: "Payment approved" })).toBeVisible({ timeout: 60_000 });
  await expect(studentPage.getByRole("heading", { name: "Your recharge card is being reviewed" })).toHaveCount(0);
  await studentPage.screenshot({ path: `${SCREENSHOT_DIR}/student-sees-approval-live.png`, fullPage: true });
  await studentContext.close();
});

test("early renewal preserves paid days through pending, rejection, and approval", async ({ browser }) => {
  test.setTimeout(90_000);
  const tooEarlyContext = await browser.newContext();
  const tooEarlyPage = await tooEarlyContext.newPage();
  await login(tooEarlyPage, "qa.renewal-early@lockin.local", "StudyQA123!");
  await tooEarlyPage.goto("/#/subscription");
  await expect(tooEarlyPage.getByRole("heading", { name: "Early renewal is not available yet" })).toBeVisible();
  await expect(tooEarlyPage.getByRole("button", { name: "Submit card and continue" })).toHaveCount(0);
  await tooEarlyContext.close();

  const renewalContext = await browser.newContext();
  const renewalPage = await renewalContext.newPage();
  await login(renewalPage, "qa.renewal@lockin.local", "StudyQA123!");
  await renewalPage.goto("/#/subscription");
  const before = (await currentSubscription(renewalPage)).subscription;
  await expect(renewalPage.getByRole("heading", { name: "4 days remain on your subscription" })).toBeVisible();
  await expect(renewalPage.getByText("You will not lose your remaining days. The new plan is added after your current subscription ends.")).toBeVisible();
  await responsiveAudit(renewalPage, [
    { width: 390, height: 844 },
    { width: 834, height: 1112 },
    { width: 1440, height: 900 }
  ], "early renewal");
  await renewalPage.setViewportSize({ width: 390, height: 844 });
  await renewalPage.screenshot({ path: `${SCREENSHOT_DIR}/early-renewal-phone.png`, fullPage: true });
  await renewalPage.setViewportSize({ width: 1440, height: 900 });
  await renewalPage.screenshot({ path: `${SCREENSHOT_DIR}/early-renewal-desktop.png`, fullPage: true });

  await renewalPage.getByRole("radio", { name: /Monthly/ }).check();
  await renewalPage.getByRole("textbox", { name: /^Recharge card code/ }).fill("7000000000001");
  const pendingResponse = renewalPage.waitForResponse((response) => response.url().includes("/payments/manual-libyana") && response.status() === 201);
  await renewalPage.getByRole("button", { name: "Submit card and continue" }).click();
  const pendingPayload = await (await pendingResponse).json();
  const provisionalEnd = pendingPayload.subscription.current_period_ends_at;
  expect(new Date(provisionalEnd).getTime()).toBe(new Date(addDays(before.current_period_ends_at, 30)).getTime());
  await expect(renewalPage.getByText("Payment being reviewed", { exact: true })).toBeVisible();
  await expect(renewalPage.getByRole("heading", { name: "A payment is already under review" })).toBeVisible();

  const rejectAdminContext = await browser.newContext();
  const rejectAdminPage = await rejectAdminContext.newPage();
  await loginAdmin(rejectAdminPage);
  await rejectAdminPage.goto("/#/operations/admin/purchases");
  const rejectedPayment = rejectAdminPage.getByRole("button").filter({ hasText: "@qa_renewal" }).first();
  await rejectedPayment.click();
  await rejectAdminPage.getByLabel("Review reason").fill("Card rejected for E2E verification");
  await rejectAdminPage.getByRole("button", { name: "Reject payment" }).click();
  await rejectAdminPage.getByRole("button", { name: "Reject payment", exact: true }).last().click();
  await expect(rejectAdminPage.locator(".ops-review .ops-badge")).toHaveText("Rejected");
  await rejectAdminContext.close();

  await renewalPage.reload();
  const afterRejection = (await currentSubscription(renewalPage)).subscription;
  expect(afterRejection.current_period_ends_at).toBe(before.current_period_ends_at);
  await expect(renewalPage.getByRole("heading", { name: "Your payment was not approved" })).toBeVisible();

  await renewalPage.getByRole("radio", { name: /Monthly/ }).check();
  await renewalPage.getByRole("textbox", { name: /^Recharge card code/ }).fill("7000000000002");
  const approvedPendingResponse = renewalPage.waitForResponse((response) => response.url().includes("/payments/manual-libyana") && response.status() === 201);
  await renewalPage.getByRole("button", { name: "Submit card and continue" }).click();
  const approvedPendingPayload = await (await approvedPendingResponse).json();
  expect(approvedPendingPayload.subscription.current_period_ends_at).toBe(provisionalEnd);

  const approveAdminContext = await browser.newContext();
  const approveAdminPage = await approveAdminContext.newPage();
  await loginAdmin(approveAdminPage);
  await approveAdminPage.goto("/#/operations/admin/purchases");
  const approvedPayment = approveAdminPage.getByRole("button").filter({ hasText: "@qa_renewal" }).first();
  await approvedPayment.click();
  await approveAdminPage.getByLabel("Review reason").fill("Card accepted for E2E verification");
  await approveAdminPage.getByRole("button", { name: "Approve payment" }).click();
  await approveAdminPage.getByRole("button", { name: "Approve payment", exact: true }).last().click();
  await expect(approveAdminPage.locator(".ops-review .ops-badge")).toHaveText("Approved");
  await approveAdminContext.close();

  await renewalPage.reload();
  const afterApproval = (await currentSubscription(renewalPage)).subscription;
  expect(afterApproval.current_period_ends_at).toBe(provisionalEnd);
  await expect(renewalPage.getByRole("heading", { name: "A payment is already under review" })).toHaveCount(0);
  await renewalContext.close();
});
