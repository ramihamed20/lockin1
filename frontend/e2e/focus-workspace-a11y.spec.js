import { expect, test } from "@playwright/test";
import { withoutServiceWorker } from "./helpers/serviceWorker.js";
import { fulfillAccessContract } from "./fixtures/productionApi.js";

const ROUTE = "/#/materials/catalog/microbiology/sheets/sheet-1/workspace";

async function mockWorkspace(page) {
  await withoutServiceWorker(page);
  await page.route("**/api/v1/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === "/api/v1/auth/session") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ user: { id: "a11y-student", email: "a11y@example.test", full_name: "A11y Student", preferred_language: "en", status: "active", is_email_verified: true, roles: ["student"], date_joined: "2026-01-01T00:00:00Z" } })
      });
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
    await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "not_found", message: "Not used by accessibility tests" } }) });
  });
}

async function openWorkspace(page, viewport = { width: 1280, height: 900 }) {
  await page.setViewportSize(viewport);
  await page.goto(ROUTE);
  await page.getByRole("button", { name: /Normal Study/ }).click();
  await expect(page.locator(".workspace-v2-a4-canvas.is-visible").first()).toBeVisible({ timeout: 20_000 });
}

/** A page key pressed mid-jump acts on the page the reader is still leaving. */
async function waitForScrollToSettle(page) {
  await expect.poll(async () => page.evaluate(async () => {
    const stage = document.querySelector(".workspace-v2-document-stage");
    const first = stage.scrollTop;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return Math.abs(stage.scrollTop - first) < 0.5;
  }), { timeout: 15_000 }).toBe(true);
}

test("every reachable control has an accessible name and a visible focus ring", async ({ page }) => {
  test.setTimeout(90_000);
  await mockWorkspace(page);
  await openWorkspace(page);

  // Open every surface so the audit covers the palettes and the settings panel.
  const pen = page.locator('[data-workspace-tool="pen"]');
  await pen.click();
  await pen.click();
  await expect(page.locator("#workspace-pen-options")).toBeVisible();
  const unnamedInPalette = await page.evaluate(() => [...document.querySelectorAll(".workspace-v2-tool-options button, .workspace-v2-tool-options input")]
    .filter((control) => !(control.getAttribute("aria-label") || control.textContent || "").trim())
    .map((control) => control.className));
  expect(unnamedInPalette).toEqual([]);

  await page.getByRole("button", { name: "Workspace settings", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Workspace settings" });
  await expect(settings).toBeVisible();

  const unnamed = await page.evaluate(() => [...document.querySelectorAll(".workspace-v2 button:not([disabled]), .workspace-v2 [role='switch']")]
    .filter((control) => {
      const bounds = control.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return false;
      if (control.closest("[inert], [aria-hidden='true']")) return false;
      const label = (control.getAttribute("aria-label") || control.getAttribute("title") || control.textContent || "").trim();
      return !label;
    })
    .map((control) => control.className || control.tagName));
  expect(unnamed).toEqual([]);

  // The popovers carry no close button, so Escape is the keyboard's way out
  // and it has to hand focus back to the control that owns the panel.
  await page.keyboard.press("Escape");
  await expect(settings).toBeHidden();
  await expect(page.getByRole("button", { name: "Workspace settings", exact: true })).toBeFocused();

  // Keyboard focus is visible, not just present.
  const focusRing = await page.evaluate(() => {
    const active = document.activeElement;
    const style = getComputedStyle(active);
    return {
      label: active.getAttribute("aria-label") || active.textContent.trim(),
      focusVisible: active.matches(":focus-visible"),
      outlineWidth: style.outlineWidth,
      outlineStyle: style.outlineStyle
    };
  });
  expect(focusRing.label).toBeTruthy();
  expect(focusRing.focusVisible).toBe(true);
  expect(focusRing.outlineStyle).not.toBe("none");
  expect(Number.parseFloat(focusRing.outlineWidth)).toBeGreaterThan(0);
});

test("global shortcuts never fire while a field or a control has focus", async ({ page }) => {
  test.setTimeout(90_000);
  await mockWorkspace(page);
  await openWorkspace(page);
  const indicator = page.locator(".workspace-v2-page-number");
  await expect(indicator).toHaveAttribute("aria-label", "Page 1 of 16");

  // Typing a page number must not be read as tool shortcuts or page steps.
  await indicator.click();
  const pageInput = page.locator(".workspace-v2-page-navigator input[type='number']");
  await pageInput.click();
  await pageInput.press("ArrowRight");
  await pageInput.press("ArrowLeft");
  await expect(indicator).toHaveAttribute("aria-label", "Page 1 of 16");
  await expect(page.locator('[data-workspace-tool="pen"]')).toHaveAttribute("aria-pressed", "false");
  await pageInput.fill("5");
  await pageInput.press("Enter");
  await expect(indicator).toHaveAttribute("aria-label", "Page 5 of 16");
  await expect(page.locator('[data-workspace-tool="pen"]')).toHaveAttribute("aria-pressed", "false");
  await page.locator(".workspace-v2-page-number").click();
  await waitForScrollToSettle(page);

  // The same keys reach the reader once focus leaves the field.
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  await page.keyboard.press("ArrowRight");
  await expect(indicator).toHaveAttribute("aria-label", "Page 6 of 16");
  await waitForScrollToSettle(page);

  // A note field swallows every shortcut, including Delete and Backspace.
  await page.locator('[data-workspace-tool="note"]').click();
  const noteEditor = page.locator(".workspace-v2-note-editor textarea");
  await noteEditor.click();
  await noteEditor.fill("pencil and eraser");
  await noteEditor.press("Backspace");
  await noteEditor.press("ArrowLeft");
  await expect(noteEditor).toHaveValue("pencil and erase");
  await expect(indicator).toHaveAttribute("aria-label", "Page 6 of 16");
  await expect(page.locator('[data-workspace-tool="eraser"]')).toHaveAttribute("aria-pressed", "false");
});

test("the notes drawer exposes real tabs and panels", async ({ page }) => {
  test.setTimeout(90_000);
  await mockWorkspace(page);
  await openWorkspace(page);
  await page.locator('[data-workspace-tool="note"]').click();

  const notesTab = page.getByRole("tab", { name: "Notes" });
  const highlightsTab = page.getByRole("tab", { name: /Highlights/ });
  await expect(notesTab).toHaveAttribute("aria-selected", "true");
  await expect(notesTab).toHaveAttribute("aria-controls", "workspace-notes-tabpanel");
  await expect(page.getByRole("tabpanel", { name: "Notes" })).toBeVisible();
  // Only the selected tab is in the tab order, which is what a roving tablist
  // needs to be navigable.
  await expect(notesTab).toHaveAttribute("tabindex", "0");
  await expect(highlightsTab).toHaveAttribute("tabindex", "-1");

  await highlightsTab.click();
  await expect(highlightsTab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel", { name: /Highlights/ })).toBeVisible();
  await expect(highlightsTab).toHaveAttribute("tabindex", "0");
  await expect(notesTab).toHaveAttribute("tabindex", "-1");
});

test("status, save failures, and popovers are announced and reachable", async ({ page }) => {
  test.setTimeout(90_000);
  await mockWorkspace(page);
  await openWorkspace(page);

  // The workspace keeps one polite live region for save state and messages.
  const liveRegion = page.locator(".workspace-v2-visually-hidden[role='status']");
  await expect(liveRegion).toHaveAttribute("aria-live", "polite");

  // Popovers announce their expanded state on the control that owns them.
  const settingsButton = page.getByRole("button", { name: "Workspace settings", exact: true });
  await expect(settingsButton).toHaveAttribute("aria-expanded", "false");
  await settingsButton.click();
  await expect(settingsButton).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("dialog", { name: "Workspace settings" })).toBeVisible();

  // Backup controls are ordinary named buttons, not icon-only affordances.
  await expect(page.getByRole("button", { name: /Export marks and notes/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Restore from a backup/ })).toBeVisible();
  await expect(page.getByRole("switch", { name: /Scribble erase/ })).toHaveAttribute("aria-checked", /true|false/);

  // The page dock exposes its own expanded state and named zoom controls.
  await settingsButton.click();
  const pageButton = page.locator(".workspace-v2-page-number");
  await expect(pageButton).toHaveAttribute("aria-expanded", "false");
  await pageButton.click();
  await expect(pageButton).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("button", { name: "Zoom in", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Zoom out", exact: true })).toBeVisible();
  await expect(page.getByRole("group", { name: "Zoom", exact: true })).toBeVisible();
});

test("the study dialog traps focus and hides the workspace behind it", async ({ page }) => {
  test.setTimeout(90_000);
  await mockWorkspace(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(ROUTE);

  const dialog = page.getByRole("dialog", { name: "Choose study mode" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  // Everything outside the dialog is inert while it is open.
  const backgroundHidden = await page.evaluate(() => [...document.querySelectorAll(".workspace-v2 > *")]
    .filter((element) => !element.contains(document.querySelector(".workspace-v2-mode-dialog")))
    .every((element) => element.getAttribute("aria-hidden") === "true" || element.inert || !element.getBoundingClientRect().width));
  expect(backgroundHidden).toBe(true);

  // Tab cycles inside the dialog rather than escaping into the reader.
  for (let step = 0; step < 12; step += 1) await page.keyboard.press("Tab");
  const focusInsideDialog = await page.evaluate(() => Boolean(document.querySelector(".workspace-v2-mode-dialog")?.contains(document.activeElement)));
  expect(focusInsideDialog).toBe(true);
});
