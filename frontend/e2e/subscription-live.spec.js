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
  await page.locator(".auth-v2-primary").click();
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
  await code.fill("456789012345");
  await page.getByRole("button", { name: "Submit card and continue" }).click();
  await expect(page.getByText("Payment being reviewed", { exact: true })).toBeVisible();
  await expect(page.getByText("456789012345", { exact: true })).toHaveCount(0);

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
  await expect(page.getByText("565656561234", { exact: true })).toBeVisible();
  await page.getByLabel("Review reason").fill("Recharge card value verified");
  await page.getByRole("button", { name: "Approve payment" }).click();
  await page.getByRole("button", { name: "Approve", exact: true }).click();

  await expect(page.locator(".manual-payment-review .creator-badge")).toHaveText("Approved");
  await expect(page.getByText("565656561234", { exact: true })).toHaveCount(0);
  await expect(page.locator(".manual-recharge-code")).toContainText("1234");
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.screenshot({ path: `${SCREENSHOT_DIR}/admin-payment-approved-ipad.png`, fullPage: true });
});
