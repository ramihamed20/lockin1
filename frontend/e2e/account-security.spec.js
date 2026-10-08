import { expect, test } from "@playwright/test";
import { mockStudentApi } from "./helpers/mock-student-api.js";

async function mockAccount(page, state, gate = Promise.resolve()) {
  await mockStudentApi(page);
  await page.addInitScript(() => {
    localStorage.setItem("lock-in.locale", "ar");
    localStorage.setItem("lock-in.pwa-launch.dismissed-at", String(Date.now()));
  });
  await page.route("**/api/v1/auth/session", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ user: { id: "account-audit", email: "synthetic@example.test", full_name: "Synthetic account", preferred_language: "ar", status: "active", is_email_verified: true, roles: ["student"], date_joined: "2026-01-01T00:00:00Z" } }) }));
  await page.route("**/api/v1/auth/csrf", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ csrf_token: "synthetic-csrf" }) }));
  await page.route("**/api/v1/account/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    const method = route.request().method();
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (pathname.endsWith("/sessions") && method === "GET") return json({ sessions: [{ id: "other-session", device_label: "Second device", is_current: false, last_seen_at: "2026-10-01T00:00:00Z" }] });
    if (pathname.endsWith("/sessions/other-session")) {
      state.revokes += 1;
      await gate;
      return route.fulfill({ status: 204 });
    }
    if (pathname.endsWith("/password")) {
      state.passwords += 1;
      if (state.passwords === 1) return json({ error: { code: "invalid", message: "The request could not be completed.", fields: { current_password: ["The current password is incorrect."] } } }, 400);
      return json({ status: "updated" });
    }
    if (pathname.endsWith("/deletion")) {
      if (method !== "GET") state.deletions.push(method);
      return json({ status: method === "POST" ? "pending_confirmation" : "not_requested", request: null });
    }
    return json({ status: "unused" });
  });
}

for (const [device, width, height] of [["phone", 320, 640], ["iPad landscape", 1180, 820]]) {
  test.describe(`account security ${device}`, () => {
    test.use({ viewport: { width, height }, hasTouch: true, serviceWorkers: "block" });
    test("session confirmation cannot repeat or close during revocation", async ({ page }) => {
      let release;
      const gate = new Promise((resolve) => { release = resolve; });
      const state = { revokes: 0, passwords: 0, deletions: [] };
      await mockAccount(page, state, gate);
      await page.goto("/#/settings?section=account");
      await page.locator(".account-security-panel").getByRole("button", { name: "إنهاء", exact: true }).click();
      const dialog = page.getByRole("alertdialog");
      const confirm = dialog.locator(".btn-danger");
      await confirm.click();
      await expect.poll(() => state.revokes).toBe(1);
      await expect(confirm).toBeDisabled();
      await confirm.evaluate((button) => button.click());
      await page.keyboard.press("Escape");
      await expect(dialog).toBeVisible();
      expect(state.revokes).toBe(1);
      release();
      await expect(dialog).toHaveCount(0);
      await expect(page.getByText("Second device")).toHaveCount(0);
    });

    test("password errors stay on their field and deletion keeps its email confirmation step", async ({ page }) => {
      const state = { revokes: 0, passwords: 0, deletions: [] };
      await mockAccount(page, state);
      await page.goto("/#/settings?section=account");
      const password = page.locator("#settings-password");
      const current = password.locator("input").nth(0);
      const confirmation = password.locator("input").nth(2);
      // Password managers may fill several fields before React commits a
      // render. Each change must retain the other fields from that same batch.
      await password.evaluate((node) => {
        const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
        const values = ["synthetic-current-password", "Synthetic-new-password-2026", "different-password"];
        node.querySelectorAll("input").forEach((input, index) => {
          setValue.call(input, values[index]);
          input.dispatchEvent(new Event("input", { bubbles: true }));
        });
      });
      await expect(current).toHaveValue("synthetic-current-password");
      await expect(password.getByLabel("كلمة المرور الجديدة", { exact: true })).toHaveValue("Synthetic-new-password-2026");
      await password.getByRole("button", { name: "تحديث كلمة المرور", exact: true }).click();
      await expect(confirmation).toHaveAttribute("aria-invalid", "true");
      expect(state.passwords).toBe(0);
      await confirmation.fill("Synthetic-new-password-2026");
      await password.getByRole("button", { name: "تحديث كلمة المرور", exact: true }).click();
      await expect(current).toHaveAttribute("aria-invalid", "true");
      await current.fill("synthetic-correct-password");
      await password.getByRole("button", { name: "تحديث كلمة المرور", exact: true }).click();
      await expect(password.getByRole("status")).toHaveText("تم تحديث كلمة المرور.");
      await expect(current).toHaveValue("");
      expect(state.passwords).toBe(2);
      await page.getByRole("button", { name: /حذف الحساب/ }).click();
      const deletion = page.locator("#settings-deletion-form");
      const request = deletion.getByRole("button", { name: "طلب حذف الحساب", exact: true });
      await expect(request).toBeDisabled();
      await deletion.getByLabel("كلمة المرور الحالية").fill("synthetic-correct-password");
      await request.click();
      await expect(deletion.getByRole("status")).toHaveText("تحقّق من بريدك وأكّد الطلب عبر الرابط المستخدم مرة واحدة.");
      await deletion.getByLabel("كلمة المرور الحالية").fill("synthetic-correct-password");
      await deletion.getByRole("button", { name: "إلغاء الطلب", exact: true }).click();
      await expect(deletion.getByRole("status")).toHaveText("تم إلغاء طلب الحذف.");
      expect(state.deletions).toEqual(["POST", "DELETE"]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
      await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    });
  });
}
