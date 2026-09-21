import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { withoutServiceWorker } from "./helpers/serviceWorker.js";
import { fulfillAccessContract } from "./fixtures/productionApi.js";

/**
 * A Sheet Summary is read in the study reader, and its ink belongs to the
 * server like any other sheet's.
 *
 * It is a different document from the sheet it summarises -- a different file
 * with its own page numbers -- so the server stores its marks under their own
 * identity. These tests drive the real reader: one device draws, a second
 * device with an empty store opens the same address and sees the same marks,
 * and neither the sheet's own document nor its other edition is touched.
 */

const MATERIAL = "server-anatomy";
const SHEET = "sheet-1";
const LOCKIN_SHEET = "sheet-1-lockin";
const STUDY_ROUTE = `/#/materials/catalog/${MATERIAL}/sheets/${SHEET}/workspace`;
const SUMMARY_ROUTE = `/#/materials/catalog/${MATERIAL}/sheets/${SHEET}/summary`;
const VERSION_ID = "7a2e3d4c-5b6a-4f9e-8d7c-2b3c4d5e6f70";
const STUDY_DOCUMENT_ID = "6f1d2c3b-4a59-4e8d-9c7b-1a2b3c4d5e6f";
const LOCKIN_DOCUMENT_ID = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
// The server derives a summary's identity rather than carrying a catalog row
// for it; any stable id stands in for that here.
const SUMMARY_DOCUMENT_ID = "9d8c7b6a-5f4e-4d3c-2b1a-0f9e8d7c6b5a";
const STUDY_FILE_ID = "8b3f4e5d-6c7b-4a0f-9e8d-3c4d5e6f7081";
const SUMMARY_FILE_ID = "2e3f4a5b-6c7d-4e8f-9a0b-1c2d3e4f5a6b";
const LOCKIN_FILE_ID = "3f4a5b6c-7d8e-4f9a-0b1c-2d3e4f5a6b7c";
const pdf = readFile(new URL("./fixtures/pdf/sheet-17.pdf", import.meta.url));

/** One collection per document, exactly as the server keeps them. */
function createServer() {
  return {
    collections: new Map(),
    workspace: { revision: 0, state: {} },
    receipts: new Map()
  };
}

/** The scope in a request names which of the sheet's PDFs it addresses. */
function scopeKey(url) {
  const edition = url.searchParams.get("edition") || "university";
  const view = url.searchParams.get("view") || "study";
  return `${edition}:${view}`;
}

function collectionFor(server, key) {
  if (!server.collections.has(key)) server.collections.set(key, { revision: 0, annotations: new Map() });
  return server.collections.get(key);
}

async function mockServer(page, server) {
  await withoutServiceWorker(page);
  await page.addInitScript(() => {
    try { window.localStorage.setItem("lock-in.pwa-launch.dismissed-at", String(Date.now())); } catch { /* private mode */ }
  });
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const { pathname } = url;
    const method = request.method();
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (await fulfillAccessContract(route, pathname)) return undefined;
    if (pathname === "/api/v1/auth/session") {
      return json({ user: { id: "sync-reader", email: "sync@example.test", full_name: "Sync Reader", preferred_language: "en", status: "active", is_email_verified: true, roles: ["student"], date_joined: "2026-01-01T00:00:00Z" } });
    }
    if (pathname === "/api/v1/auth/csrf") return json({ csrf_token: "csrf" });
    if (pathname === "/api/v1/operations/session") return json({ error: { code: "permission_denied", message: "Student" } }, 403);
    if (pathname === "/api/v1/focus/lock-in" && method === "GET") return json({ active_session: null });
    if (pathname === "/api/v1/catalog/materials") {
      const editions = [
        { edition: "university", label: "University Sheet", slug: SHEET, summaryPdf: { viewUrl: `/api/v1/files/${SUMMARY_FILE_ID}/view`, pageCount: 17 }, summaryStatus: "available", pageCount: 17, hasActiveStudy: false, deliverable: true },
        { edition: "lockin", label: "Lockin Sheet", slug: LOCKIN_SHEET, summaryPdf: null, summaryStatus: "missing", pageCount: 17, hasActiveStudy: false, deliverable: true }
      ];
      return json({ count: 1, results: [{ slug: MATERIAL, title: "Server Anatomy", sheets: [{ slug: SHEET, number: 1, title: "Sheet 1", summary: "", pageCount: 17, hasActiveStudy: false, deliverable: true, summaryPdf: editions[0].summaryPdf, summaryStatus: "available", editions }] }] });
    }
    if (pathname === `/api/v1/catalog/documents/${MATERIAL}/${SHEET}`) {
      return url.searchParams.get("view") === "summary"
        ? json({ document: { id: SUMMARY_DOCUMENT_ID, document_version_id: VERSION_ID, file_id: SUMMARY_FILE_ID, view_url: `/api/v1/files/${SUMMARY_FILE_ID}/view` } })
        : json({ document: { id: STUDY_DOCUMENT_ID, document_version_id: VERSION_ID, file_id: STUDY_FILE_ID, view_url: `/api/v1/files/${STUDY_FILE_ID}/view` } });
    }
    if (pathname === `/api/v1/catalog/documents/${MATERIAL}/${LOCKIN_SHEET}`) {
      return json({ document: { id: LOCKIN_DOCUMENT_ID, document_version_id: VERSION_ID, file_id: LOCKIN_FILE_ID, view_url: `/api/v1/files/${LOCKIN_FILE_ID}/view` } });
    }
    if ([STUDY_FILE_ID, SUMMARY_FILE_ID, LOCKIN_FILE_ID].some((id) => pathname === `/api/v1/files/${id}/view`)) {
      return route.fulfill({ status: 200, contentType: "application/pdf", body: await pdf });
    }
    if (pathname === `/api/v1/catalog/documents/${STUDY_DOCUMENT_ID}/workspace` || pathname === `/api/v1/catalog/documents/${LOCKIN_DOCUMENT_ID}/workspace`) {
      if (method === "GET") return json(server.workspace);
      const body = request.postDataJSON();
      if (server.receipts.has(body.idempotency_key)) return json({ ...server.receipts.get(body.idempotency_key), replayed: true });
      if (body.expected_revision !== server.workspace.revision) return json({ error: { code: "catalog_workspace_conflict", message: "Conflict" } }, 409);
      server.workspace = { revision: server.workspace.revision + 1, state: body.state };
      const result = { ...server.workspace, replayed: false };
      server.receipts.set(body.idempotency_key, result);
      return json(result);
    }
    // A summary has no catalog workspace row, exactly as the server has none.
    if (pathname === `/api/v1/catalog/documents/${SUMMARY_DOCUMENT_ID}/workspace`) {
      return json({ error: { code: "not_found", message: "No workspace for a summary." } }, 404);
    }
    if (pathname === `/api/v1/focus/documents/${VERSION_ID}/annotations`) {
      const collection = collectionFor(server, scopeKey(url));
      if (method === "GET") {
        const pages = (url.searchParams.get("pages") || "").split(",").map(Number);
        const results = [...collection.annotations.values()].filter((item) => pages.includes(item.page_number));
        return json({ collection_revision: collection.revision, count: results.length, next: null, previous: null, results });
      }
      const body = request.postDataJSON();
      if (server.receipts.has(body.idempotency_key)) return json({ ...server.receipts.get(body.idempotency_key), replayed: true });
      if (body.expected_collection_revision !== collection.revision) {
        return json({ error: { code: "focus_conflict", message: "Annotations changed." } }, 409);
      }
      for (const item of body.annotations) collection.annotations.set(item.id, { ...item, created_at: "2026-09-11T10:00:00Z" });
      for (const id of body.deleted_ids) collection.annotations.delete(id);
      collection.revision += 1;
      const result = { collection_revision: collection.revision, saved_at: "2026-09-11T10:00:00Z", annotations: body.annotations, deleted_ids: body.deleted_ids, replayed: false };
      server.receipts.set(body.idempotency_key, result);
      return json(result);
    }
    return json({ error: { code: "not_found", message: "Not used by the sync tests" } }, 404);
  });
}

async function openReader(page, route) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(route);
  // A study sheet asks which mode to read in; a summary is Normal Mode only and
  // opens straight into reading. The route tells us which contract applies;
  // checking visibility once raced the asynchronously mounted study dialog.
  if (route === STUDY_ROUTE) {
    const chooseNormal = page.getByRole("button", { name: /Normal Study/ });
    await expect(chooseNormal).toBeVisible({ timeout: 20_000 });
    await chooseNormal.click();
    await expect(chooseNormal).toBeHidden();
  }
  await expect(page.locator(".workspace-v2-a4-canvas.is-visible").first()).toBeVisible({ timeout: 20_000 });
}

function visibleInk(page) {
  return page.locator(".workspace-v2-annotation-layer [data-annotation-type='pen']:not(.workspace-v2-annotation-hit)");
}

async function drawStroke(page) {
  const stage = page.locator(".workspace-v2-document-stage");
  const bounds = await page.locator(".workspace-v2-a4-page").first().boundingBox();
  const y = bounds.y + bounds.height * 0.3;
  const send = (type, x) => stage.dispatchEvent(type, {
    pointerId: 71, pointerType: "pen", isPrimary: true, clientX: x, clientY: y,
    button: 0, buttons: type === "pointerup" ? 0 : 1, pressure: type === "pointerup" ? 0 : 0.5,
    width: 2, height: 2, bubbles: true, cancelable: true
  });
  await send("pointerdown", bounds.x + bounds.width * 0.25);
  await send("pointermove", bounds.x + bounds.width * 0.45);
  await send("pointermove", bounds.x + bounds.width * 0.62);
  await send("pointerup", bounds.x + bounds.width * 0.62);
}

test("ink on a Sheet Summary reaches the reader's other devices", async ({ page, browser }) => {
  test.setTimeout(90_000);
  const server = createServer();
  await mockServer(page, server);
  await openReader(page, SUMMARY_ROUTE);

  await page.getByRole("button", { name: "Pen", exact: true }).click();
  await drawStroke(page);
  await expect(visibleInk(page)).toHaveCount(1);
  // Stored against the summary, under the summary's own scope.
  await expect
    .poll(() => collectionFor(server, "university:summary").annotations.size, { timeout: 15_000 })
    .toBe(1);
  const [stored] = collectionFor(server, "university:summary").annotations.values();

  // A second device, with an empty local store, opens the same summary.
  const secondDevice = await browser.newContext();
  const second = await secondDevice.newPage();
  await mockServer(second, server);
  await openReader(second, SUMMARY_ROUTE);
  await expect(visibleInk(second)).toHaveCount(1, { timeout: 15_000 });
  await expect(second.locator(`[data-annotation-id="${stored.id}"]`).first()).toBeAttached();
  await secondDevice.close();
});

test("a summary's ink stays out of the sheet it summarises, and out of the other edition", async ({ page }) => {
  test.setTimeout(120_000);
  const server = createServer();
  await mockServer(page, server);

  // One stroke on the summary.
  await openReader(page, SUMMARY_ROUTE);
  await page.getByRole("button", { name: "Pen", exact: true }).click();
  await drawStroke(page);
  await expect(visibleInk(page)).toHaveCount(1);
  await expect
    .poll(() => collectionFor(server, "university:summary").annotations.size, { timeout: 15_000 })
    .toBe(1);

  // The study document of the same sheet is untouched, and opens clean.
  expect(collectionFor(server, "university:study").annotations.size).toBe(0);
  await openReader(page, STUDY_ROUTE);
  await expect(visibleInk(page)).toHaveCount(0);

  // A stroke here belongs to the study document alone.
  await page.getByRole("button", { name: "Pen", exact: true }).click();
  await drawStroke(page);
  await expect(visibleInk(page)).toHaveCount(1);
  await expect
    .poll(() => collectionFor(server, "university:study").annotations.size, { timeout: 15_000 })
    .toBe(1);
  expect(collectionFor(server, "university:summary").annotations.size).toBe(1);
  expect(collectionFor(server, "lockin:study").annotations.size).toBe(0);

  // And the summary still holds its own single stroke, not the sheet's.
  await openReader(page, SUMMARY_ROUTE);
  await expect(visibleInk(page)).toHaveCount(1, { timeout: 15_000 });
  const [summaryStroke] = collectionFor(server, "university:summary").annotations.values();
  await expect(page.locator(`[data-annotation-id="${summaryStroke.id}"]`).first()).toBeAttached();
});
