import { expect, test } from "@playwright/test";
import { mockStudentApi } from "./helpers/mock-student-api.js";

test.use({ serviceWorkers: "block", hasTouch: true });

async function openPlayer(page) {
  await mockStudentApi(page);
  await page.addInitScript(() => {
    localStorage.setItem("lock-in.pwa-launch.dismissed-at", String(Date.now()));
    document.addEventListener("pointerdown", (event) => { window.testVideoPointerId = event.pointerId; }, true);
  });
  await page.route("https://www.youtube-nocookie.com/**", (route) => route.fulfill({ contentType: "text/html", body: "<p>Video fixture</p>" }));
  await page.goto("/#/materials/catalog/biochemistry-1/sheets/vitamin-1/workspace");
  await page.getByRole("button", { name: /Normal Study/ }).click();
  await expect(page.locator(".workspace-v2-a4-canvas.is-visible").first()).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("lock-in:focus-video")));
  const panel = page.locator(".focus-video");
  await expect(panel).toBeVisible();
  await panel.locator("input").fill("https://youtu.be/dQw4w9WgXcQ");
  await panel.locator("input").press("Enter");
  await expect(panel).toHaveAttribute("data-mode", "video");
  await panel.locator("iframe").evaluate((frame) => { window.originalVideoFrame = frame; });
  return panel;
}

async function beginDrag(page, panel) {
  const bar = await panel.locator("header").boundingBox();
  await page.mouse.move(bar.x + bar.width / 3, bar.y + bar.height / 2);
  await page.mouse.down();
  await page.mouse.move(bar.x + bar.width / 3 + 2, bar.y + bar.height / 2);
  await expect(panel).toHaveClass(/is-dragging/);
}

test("lost capture and app switching release video gestures without restarting the iframe", async ({ page }) => {
  const panel = await openPlayer(page);
  for (const interruption of ["capture", "blur", "hidden", "pagehide", "fullscreen"]) {
    await beginDrag(page, panel);
    await page.evaluate((kind) => {
      if (kind === "capture") {
        const bar = document.querySelector(".focus-video-bar");
        if (!bar.hasPointerCapture(window.testVideoPointerId)) throw new Error("The drag must own native capture");
        bar.releasePointerCapture(window.testVideoPointerId);
      } else if (kind === "hidden") {
        Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
        document.dispatchEvent(new Event("visibilitychange"));
      } else if (kind === "fullscreen") document.dispatchEvent(new Event("fullscreenchange"));
      else window.dispatchEvent(new Event(kind));
    }, interruption);
    // Native capture loss may be delivered at the next pointer update.
    await page.mouse.move(20, 20);
    await expect(panel, interruption).not.toHaveClass(/is-dragging|is-resizing/);
    await expect(panel.locator("iframe")).toHaveCSS("pointer-events", "auto");
    await page.mouse.up();
    await page.evaluate(() => {
      delete document.visibilityState;
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
    });
  }
  expect(await panel.locator("iframe").evaluate((frame) => frame === window.originalVideoFrame)).toBe(true);
});

for (const viewport of [{ width: 390, height: 844 }, { width: 834, height: 1194 }]) {
  test(`video controls stay in the visual viewport after keyboard and split screen (${viewport.width})`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const panel = await openPlayer(page);
    const fits = () => panel.evaluate((node) => {
      const box = node.getBoundingClientRect();
      const visual = window.visualViewport;
      return box.left >= visual.offsetLeft + 11 && box.top >= visual.offsetTop + 11
        && box.right <= visual.offsetLeft + visual.width - 11 && box.bottom <= visual.offsetTop + visual.height - 11;
    });
    await expect.poll(fits).toBe(true);
    // An on-screen keyboard/pinch changes only the visual viewport, including
    // its offset; window.resize is deliberately not dispatched here.
    await page.evaluate(() => {
      for (const [key, value] of Object.entries({ width: 320, height: 210, offsetLeft: 24, offsetTop: 80 })) {
        Object.defineProperty(window.visualViewport, key, { configurable: true, value });
      }
      window.visualViewport.dispatchEvent(new Event("resize"));
      window.visualViewport.dispatchEvent(new Event("scroll"));
    });
    await expect.poll(fits).toBe(true);
    await page.evaluate(() => {
      for (const key of ["width", "height", "offsetLeft", "offsetTop"]) delete window.visualViewport[key];
      window.visualViewport.dispatchEvent(new Event("resize"));
    });
    await page.setViewportSize({ width: 375, height: 300 });
    await expect.poll(fits).toBe(true);
    await page.setViewportSize({ width: 820, height: 600 });
    await expect.poll(fits).toBe(true);
    expect(await panel.locator("iframe").evaluate((frame) => frame === window.originalVideoFrame)).toBe(true);
  });
}
