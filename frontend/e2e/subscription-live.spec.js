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
  await page.getByLabel(emailLabel, { exact: true }).fill(email);
  await page.getByLabel(passwordLabel, { exact: true }).fill(password);
  const loginResponse = page.waitForResponse((response) => (
    response.url().includes("/auth/login") && response.request().method() === "POST"
  ));
  await page.locator(".auth-v2-primary").click();
  await loginResponse;
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
    { width: 390, height: 844 },
    { width: 844, height: 390 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
    { width: 1440, height: 900 }
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
  const code = page.getByLabel("Recharge card code");
  await expect(code).toHaveAttribute("dir", "ltr");
  await code.fill("4567890123456");
  await page.getByRole("button", { name: "Submit card and continue" }).click();
  await expect(page.getByText("Payment being reviewed", { exact: true })).toBeVisible();
  await expect(page.getByText("4567890123456", { exact: true })).toHaveCount(0);

  await responsiveAudit(page, [
    { width: 390, height: 844 },
    { width: 844, height: 390 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
    { width: 1440, height: 900 }
  ], "payment");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${SCREENSHOT_DIR}/payment-pending-phone.png`, fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: `${SCREENSHOT_DIR}/payment-pending-desktop.png`, fullPage: true });
});

test("expired Arabic account retains renewal/account access without RTL overflow", async ({ page }) => {
  await login(page, "qa.expired@lockin.local", "StudyQA123!", "ar");
  await expect(page.getByRole("heading", { name: "مساحتك الدراسية محفوظة." })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await responsiveAudit(page, [
    { width: 390, height: 844 },
    { width: 844, height: 390 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 }
  ], "expired RTL");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${SCREENSHOT_DIR}/expired-arabic-phone.png`, fullPage: true });

  await page.getByRole("link", { name: "تجديد الاشتراك" }).click();
  await expect(page.getByRole("heading", { name: "الدفع ببطاقة ليبيانا" })).toBeVisible();
  await expect(page.getByLabel("رمز بطاقة التعبئة")).toHaveAttribute("dir", "ltr");
});

test("authorized admin reviews the pending code once and the full code is then removed", async ({ page }) => {
  await login(page, "admin@lockin.local", "Admin123!");
  await page.goto("/#/operations/admin/purchases");
  await expect(page.getByRole("heading", { name: "Payments" }).first()).toBeVisible();

  const paymentRow = page.getByRole("button").filter({ hasText: "@qa_review" }).first();
  await expect(paymentRow).toBeVisible();
  await paymentRow.click();
  await expect(page.getByText("5656565612345", { exact: true })).toBeVisible();
  await page.getByLabel("Review reason").fill("Recharge card value verified");
  await page.getByRole("button", { name: "Approve payment" }).click();
  await page.getByRole("button", { name: "Approve", exact: true }).click();

  await expect(page.locator(".manual-payment-review .creator-badge")).toHaveText("Approved");
  await expect(page.getByText("5656565612345", { exact: true })).toHaveCount(0);
  await expect(page.locator(".manual-recharge-code")).toContainText("2345");
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.screenshot({ path: `${SCREENSHOT_DIR}/admin-payment-approved-ipad.png`, fullPage: true });
});

test("early renewal preserves paid days through pending, rejection, and approval", async ({ browser }) => {
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
  await renewalPage.getByLabel("Recharge card code", { exact: true }).fill("7000000000001");
  const pendingResponse = renewalPage.waitForResponse((response) => response.url().includes("/payments/manual-libyana") && response.status() === 201);
  await renewalPage.getByRole("button", { name: "Submit card and continue" }).click();
  const pendingPayload = await (await pendingResponse).json();
  const provisionalEnd = pendingPayload.subscription.current_period_ends_at;
  expect(provisionalEnd).toBe(addDays(before.current_period_ends_at, 30));
  await expect(renewalPage.getByText("Payment being reviewed", { exact: true })).toBeVisible();
  await expect(renewalPage.getByRole("heading", { name: "A payment is already under review" })).toBeVisible();

  const rejectAdminContext = await browser.newContext();
  const rejectAdminPage = await rejectAdminContext.newPage();
  await login(rejectAdminPage, "admin@lockin.local", "Admin123!");
  await rejectAdminPage.goto("/#/operations/admin/purchases");
  const rejectedPayment = rejectAdminPage.getByRole("button").filter({ hasText: "@qa_renewal" }).first();
  await rejectedPayment.click();
  await rejectAdminPage.getByLabel("Review reason").fill("Card rejected for E2E verification");
  await rejectAdminPage.getByRole("button", { name: "Reject payment" }).click();
  await rejectAdminPage.getByRole("button", { name: "Reject", exact: true }).click();
  await expect(rejectAdminPage.locator(".manual-payment-review .creator-badge")).toHaveText("Rejected");
  await rejectAdminContext.close();

  await renewalPage.reload();
  const afterRejection = (await currentSubscription(renewalPage)).subscription;
  expect(afterRejection.current_period_ends_at).toBe(before.current_period_ends_at);
  await expect(renewalPage.getByText("Payment could not be confirmed", { exact: false })).toBeVisible();

  await renewalPage.getByRole("radio", { name: /Monthly/ }).check();
  await renewalPage.getByLabel("Recharge card code", { exact: true }).fill("7000000000002");
  const approvedPendingResponse = renewalPage.waitForResponse((response) => response.url().includes("/payments/manual-libyana") && response.status() === 201);
  await renewalPage.getByRole("button", { name: "Submit card and continue" }).click();
  const approvedPendingPayload = await (await approvedPendingResponse).json();
  expect(approvedPendingPayload.subscription.current_period_ends_at).toBe(provisionalEnd);

  const approveAdminContext = await browser.newContext();
  const approveAdminPage = await approveAdminContext.newPage();
  await login(approveAdminPage, "admin@lockin.local", "Admin123!");
  await approveAdminPage.goto("/#/operations/admin/purchases");
  const approvedPayment = approveAdminPage.getByRole("button").filter({ hasText: "@qa_renewal" }).first();
  await approvedPayment.click();
  await approveAdminPage.getByLabel("Review reason").fill("Card accepted for E2E verification");
  await approveAdminPage.getByRole("button", { name: "Approve payment" }).click();
  await approveAdminPage.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(approveAdminPage.locator(".manual-payment-review .creator-badge")).toHaveText("Approved");
  await approveAdminContext.close();

  await renewalPage.reload();
  const afterApproval = (await currentSubscription(renewalPage)).subscription;
  expect(afterApproval.current_period_ends_at).toBe(provisionalEnd);
  await expect(renewalPage.getByRole("heading", { name: "A payment is already under review" })).toHaveCount(0);
  await renewalContext.close();
});
