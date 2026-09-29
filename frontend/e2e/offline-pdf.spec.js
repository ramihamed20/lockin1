import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { fulfillAccessContract } from "./fixtures/productionApi.js";
import { signE2eLease } from "./fixtures/offlineLease.js";

/**
 * A downloaded PDF opens from the device.
 *
 * The sheet here is published from the server, as every production sheet is:
 * it carries no pdfUrl of its own, so the workspace resolves it to its
 * protected file, and offline to the copy Offline Mode stored. (The bundled
 * fixture sheets carry a static pdfUrl and never reach that path.)
 *
 * Production serves every document with `connect-src 'self'`, which blocks a
 * fetch of a `blob:` URL. The reader used to hand PDF.js one for a downloaded
 * PDF, and PDF.js reported "Unexpected server response (0)", so downloaded
 * PDFs never opened behind the real edge. These specs apply that policy.
 */

const USER_ID = "offline-pdf-student";
const MATERIAL = "server-histology";
const SHEET = "sheet-1";
const ROUTE = `/#/materials/catalog/${MATERIAL}/sheets/${SHEET}/workspace`;
const DOCUMENT_ID = "0b6c1d2e-3f40-4a51-8b62-7c8d9e0f1a2b";
const VERSION_ID = "1c7d2e3f-4051-4b62-9c73-8d9e0f1a2b3c";
const FILE_ID = "2d8e3f40-5162-4c73-8d84-9e0f1a2b3c4d";
const PDF_ITEM = `${DOCUMENT_ID}:sheet`;
const pdfBytes = readFile(new URL("./fixtures/pdf/sheet-17.pdf", import.meta.url));

async function productionPolicy() {
  const config = await readFile(new URL("../nginx/default.conf", import.meta.url), "utf8");
  const policy = config.match(/Content-Security-Policy "([^"]+)"/)?.[1] || "";
  expect(policy, "the production policy was not found in nginx/default.conf").toContain("connect-src 'self'");
  return policy;
}

/** Serves every document with the production Content-Security-Policy. */
async function applyProductionPolicy(page, baseURL) {
  const policy = await productionPolicy();
  const origin = new URL(baseURL || "http://127.0.0.1:4173").origin;
  await page.route((url) => url.origin === origin && !url.pathname.startsWith("/api/") && !/\.\w+$/.test(url.pathname), async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, headers: { ...response.headers(), "content-security-policy": policy } });
  });
}

async function mockServer(page, state) {
  const pdf = await pdfBytes;
  const checksum = createHash("sha256").update(pdf).digest("hex");
  await page.addInitScript(() => {
    try { window.localStorage.setItem("lock-in.pwa-launch.dismissed-at", String(Date.now())); } catch { /* private mode */ }
  });
  page.on("console", (message) => {
    if (/Content Security Policy|Unexpected server response/i.test(message.text())) state.errors.push(message.text());
  });
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const { pathname } = url;
    const method = request.method();
    if (state.serverDown) {
      state.offlineRequests.push(pathname);
      return route.abort("internetdisconnected");
    }
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (pathname === "/api/v1/auth/session") {
      return json({ user: { id: USER_ID, email: "pdf@example.test", full_name: "Offline Reader", preferred_language: "en", status: "active", is_email_verified: true, roles: ["student"], date_joined: "2026-01-01T00:00:00Z" } });
    }
    if (pathname === "/api/v1/auth/csrf") return json({ csrf_token: "offline-csrf" });
    if (pathname === "/api/v1/operations/session") return json({ error: { code: "permission_denied", message: "Student" } }, 403);
    if (await fulfillAccessContract(route, pathname)) return undefined;
    if (pathname === "/api/v1/focus/lock-in" && method === "GET") return json({ active_session: null });
    if (pathname === "/api/v1/offline/lease/") return json({ lease: signE2eLease(USER_ID) });
    if (pathname === "/api/v1/offline/manifest/") {
      return json({
        version: 1,
        subjects: [{ id: "subject-histology", title: "Server Histology", material_slug: MATERIAL, cohort: "y1", program: "dds" }],
        items: [{
          id: PDF_ITEM, type: "sheet", document_id: DOCUMENT_ID, document_version_id: VERSION_ID, material_slug: MATERIAL, sheet_slug: SHEET,
          subject_id: "subject-histology", sheet_id: "server-sheet-1", edition: "university", title: "Sheet 1", version: 1, updated_at: null,
          size: pdf.length, checksum, download_url: `/api/v1/files/${FILE_ID}/view`, dependencies: [], available: true
        }]
      });
    }
    if (pathname === `/api/v1/files/${FILE_ID}/view`) {
      state.fileRequests += 1;
      return route.fulfill({ status: 200, contentType: "application/pdf", body: pdf });
    }
    if (pathname === "/api/v1/offline/review/") return json({ bank: { active_count: 0, mastered_this_week: 0, subjects: [] }, queue: { count: 0, results: [] }, subjects: {}, weekly: { available: false, session: null }, answer_keys: {}, version: "e2e" });
    if (pathname === "/api/v1/catalog/materials") {
      return json({ count: 1, results: [{ slug: MATERIAL, title: "Server Histology", sheets: [{ slug: SHEET, number: 1, title: "Sheet 1", summary: "", pageCount: 17, hasActiveStudy: false }] }] });
    }
    if (pathname === "/api/v1/catalog/questions") return json({ count: 0, results: [] });
    if (pathname === `/api/v1/catalog/documents/${MATERIAL}/${SHEET}`) {
      return json({ document: { id: DOCUMENT_ID, document_version_id: VERSION_ID, file_id: FILE_ID, view_url: `/api/v1/files/${FILE_ID}/view` } });
    }
    if (pathname === `/api/v1/catalog/documents/${DOCUMENT_ID}/workspace` && method === "GET") return json({ revision: 0, state: {} });
    if (pathname === `/api/v1/focus/documents/${VERSION_ID}/annotations` && method === "GET") {
      return json({ collection_revision: 0, count: 0, next: null, previous: null, results: [] });
    }
    return json({ error: { code: "not_found", message: "Not used by the offline PDF tests" } }, 404);
  });
}

function newState() {
  return { serverDown: false, offlineRequests: [], fileRequests: 0, errors: [] };
}

async function downloadSubject(page) {
  await page.goto("/#/settings?section=offline");
  const offlineSection = page.locator("#settings-offline");
  await expect(offlineSection.getByText("Offline access available")).toBeVisible({ timeout: 20_000 });
  await offlineSection.getByRole("button", { name: "Download subject" }).click();
  await expect(offlineSection.getByText("Downloaded", { exact: true })).toBeVisible({ timeout: 30_000 });
}

/** PDF.js drew the sheet: no loading or error notice, and the page is painted. */
async function expectPageDrawn(page, pageNumber = 1) {
  await expect(page.locator(".workspace-v2-a4-status")).toHaveCount(0, { timeout: 20_000 });
  await expect.poll(() => page.evaluate((number) => {
    const canvas = document.querySelector(`.workspace-v2-a4-page[data-pdf-page="${number}"] canvas.workspace-v2-a4-canvas.is-visible`);
    return Boolean(canvas && canvas.width > 0);
  }, pageNumber), { timeout: 20_000 }).toBe(true);
}

async function openSheet(page) {
  await page.goto(ROUTE);
  // The study-mode chooser opens unless a remembered preference skips it, and
  // that preference may still be saving from the previous visit: answer it
  // whenever it is there, until the reader is open with every page.
  const chooser = page.getByRole("dialog", { name: "Choose study mode" });
  const pages = page.locator(".workspace-v2-a4-page[data-pdf-page]");
  const settled = async () => {
    if (await chooser.isVisible()) await chooser.getByRole("button", { name: /Normal Study/ }).click({ timeout: 2_000 });
    await expect(chooser).toBeHidden({ timeout: 1_000 });
    await expect(pages).toHaveCount(17, { timeout: 1_000 });
  };
  await expect(settled).toPass({ timeout: 20_000 });
  await expectPageDrawn(page, 1);
  // A slow start can mount the reader a second time; wait until it stays open.
  await page.waitForTimeout(1_000);
  await expect(settled).toPass({ timeout: 20_000 });
}

async function goToPage(page, pageNumber) {
  const indicator = page.locator(".workspace-v2-page-number");
  await indicator.click();
  const pageInput = page.locator(".workspace-v2-page-navigator input[type='number']");
  await pageInput.fill(String(pageNumber));
  await pageInput.press("Enter");
  await expect(indicator).toHaveAttribute("aria-label", `PDF page ${pageNumber} of 17`);
  await expectPageDrawn(page, pageNumber);
}

test.describe("under the production Content-Security-Policy", () => {
  // The worker would answer the shell from its cache without the header.
  test.use({ serviceWorkers: "block" });

  test("a downloaded PDF opens from the device with the server unreachable", async ({ page, baseURL }) => {
    test.setTimeout(120_000);
    const state = newState();
    await applyProductionPolicy(page, baseURL);
    await mockServer(page, state);
    await page.setViewportSize({ width: 1280, height: 900 });
    await downloadSubject(page);
    const downloadedFileRequests = state.fileRequests;

    state.serverDown = true;
    await openSheet(page);
    await goToPage(page, 12);
    // Leaving and returning reads the stored bytes again.
    await page.goto("/#/");
    await openSheet(page);
    expect(state.fileRequests).toBe(downloadedFileRequests);
    expect(state.errors).toEqual([]);
  });

  test("a sheet opened online reopens from the device once the server is gone", async ({ page, baseURL }) => {
    test.setTimeout(120_000);
    const state = newState();
    await applyProductionPolicy(page, baseURL);
    await mockServer(page, state);
    await page.setViewportSize({ width: 1280, height: 900 });
    await downloadSubject(page);
    await openSheet(page);

    // The workspace keeps the server URL it resolved online; with the server
    // gone, returning to the sheet must open the downloaded copy.
    state.serverDown = true;
    await page.goto("/#/");
    await openSheet(page);
    await goToPage(page, 9);
    expect(state.errors).toEqual([]);
  });
});

test("a downloaded PDF opens after a cold offline start, and again after leaving it", async ({ page }) => {
  test.setTimeout(150_000);
  const state = newState();
  await mockServer(page, state);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/#/settings?section=offline");
  await page.waitForFunction(() => Boolean(navigator.serviceWorker?.controller), null, { timeout: 15_000 });
  await downloadSubject(page);
  const downloadedFileRequests = state.fileRequests;

  // A cold start with no network: the shell comes from the worker, the
  // session from the signed lease, and the PDF from the stored bytes.
  state.serverDown = true;
  await page.context().setOffline(true);
  await page.reload();
  await expect(page.getByText("Offline · ", { exact: false }).first()).toBeVisible({ timeout: 20_000 });
  expect(await page.evaluate(() => navigator.onLine)).toBe(false);
  await openSheet(page);
  await goToPage(page, 15);
  await page.goto("/#/");
  await openSheet(page);
  expect(state.fileRequests).toBe(downloadedFileRequests);

  // No object URL outlives the page that made it.
  const persisted = await page.evaluate(() => Object.values(localStorage).some((value) => String(value).includes("blob:")));
  expect(persisted).toBe(false);
  expect(state.errors).toEqual([]);
});
