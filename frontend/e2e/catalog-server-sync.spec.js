import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { withoutServiceWorker } from "./helpers/serviceWorker.js";
import { fulfillAccessContract } from "./fixtures/productionApi.js";

/**
 * A sheet published from the server, as every production sheet is: it carries
 * no pdfUrl of its own. The workspace resolves it to its protected PDF, and the
 * reader's ink is mirrored to the Focus annotation collection so a second
 * device opens the same marks.
 *
 * The fake server below keeps the backend's rules: revisioned writes that
 * answer 409 on a stale revision, and idempotency keys that replay.
 */

const MATERIAL = "server-anatomy";
const SHEET = "sheet-1";
const ROUTE = `/#/materials/catalog/${MATERIAL}/sheets/${SHEET}/workspace`;
const DOCUMENT_ID = "6f1d2c3b-4a59-4e8d-9c7b-1a2b3c4d5e6f";
const VERSION_ID = "7a2e3d4c-5b6a-4f9e-8d7c-2b3c4d5e6f70";
const FILE_ID = "8b3f4e5d-6c7b-4a0f-9e8d-3c4d5e6f7081";
const pdf = readFile(new URL("./fixtures/pdf/sheet-17.pdf", import.meta.url));

function createServer() {
  return {
    annotations: new Map(),
    collectionRevision: 0,
    workspace: { revision: 0, state: {} },
    receipts: new Map(),
    annotationPosts: [],
    // Set to a number of annotation posts to drop, as a lost connection would.
    dropAnnotationPosts: 0
  };
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
      return json({ count: 1, results: [{ slug: MATERIAL, title: "Server Anatomy", sheets: [{ slug: SHEET, number: 1, title: "Sheet 1", summary: "", pageCount: 17, hasActiveStudy: false }] }] });
    }
    if (pathname === `/api/v1/catalog/documents/${MATERIAL}/${SHEET}`) {
      return json({ document: { id: DOCUMENT_ID, document_version_id: VERSION_ID, file_id: FILE_ID, view_url: `/api/v1/files/${FILE_ID}/view` } });
    }
    if (pathname === `/api/v1/files/${FILE_ID}/view`) {
      return route.fulfill({ status: 200, contentType: "application/pdf", body: await pdf });
    }
    if (pathname === `/api/v1/catalog/documents/${DOCUMENT_ID}/workspace`) {
      if (method === "GET") return json(server.workspace);
      const body = request.postDataJSON();
      if (server.receipts.has(body.idempotency_key)) return json({ ...server.receipts.get(body.idempotency_key), replayed: true });
      if (body.expected_revision !== server.workspace.revision) return json({ error: { code: "catalog_workspace_conflict", message: "Conflict" } }, 409);
      server.workspace = { revision: server.workspace.revision + 1, state: body.state };
      const result = { ...server.workspace, replayed: false };
      server.receipts.set(body.idempotency_key, result);
      return json(result);
    }
    if (pathname === `/api/v1/focus/documents/${VERSION_ID}/annotations`) {
      if (method === "GET") {
        const pages = (url.searchParams.get("pages") || "").split(",").map(Number);
        const results = [...server.annotations.values()].filter((item) => pages.includes(item.page_number));
        return json({ collection_revision: server.collectionRevision, count: results.length, next: null, previous: null, results });
      }
      const body = request.postDataJSON();
      server.annotationPosts.push(body);
      if (server.dropAnnotationPosts > 0) {
        server.dropAnnotationPosts -= 1;
        return route.abort("connectionreset");
      }
      if (server.receipts.has(body.idempotency_key)) return json({ ...server.receipts.get(body.idempotency_key), replayed: true });
      if (body.expected_collection_revision !== server.collectionRevision) {
        return json({ error: { code: "focus_conflict", message: "Annotations changed." } }, 409);
      }
      for (const item of body.annotations) server.annotations.set(item.id, { ...item, created_at: "2026-09-11T10:00:00Z" });
      for (const id of body.deleted_ids) server.annotations.delete(id);
      server.collectionRevision += 1;
      const result = { collection_revision: server.collectionRevision, saved_at: "2026-09-11T10:00:00Z", annotations: body.annotations, deleted_ids: body.deleted_ids, replayed: false };
      server.receipts.set(body.idempotency_key, result);
      return json(result);
    }
    return json({ error: { code: "not_found", message: "Not used by the sync tests" } }, 404);
  });
}

async function openWorkspace(page) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(ROUTE);
  await page.getByRole("button", { name: /Normal Study/ }).click();
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

test("a server sheet opens its protected PDF and its ink reaches a second device", async ({ page, browser }) => {
  test.setTimeout(90_000);
  const server = createServer();
  await mockServer(page, server);
  await openWorkspace(page);

  await page.getByRole("button", { name: "Pen", exact: true }).click();
  await drawStroke(page);
  await expect(visibleInk(page)).toHaveCount(1);
  await expect.poll(() => server.annotations.size, { timeout: 15_000 }).toBe(1);
  const [stored] = server.annotations.values();
  expect(stored.tool).toBe("pen");
  expect(stored.page_number).toBe(1);

  // A second device, with an empty local store, opens the same sheet.
  const secondDevice = await browser.newContext();
  const second = await secondDevice.newPage();
  await mockServer(second, server);
  await openWorkspace(second);
  await expect(visibleInk(second)).toHaveCount(1, { timeout: 15_000 });
  await expect(second.locator(`[data-annotation-id="${stored.id}"]`).first()).toBeAttached();
  await secondDevice.close();
});

test("ink drawn while the connection drops is sent once it returns, under its first key", async ({ page }) => {
  test.setTimeout(90_000);
  const server = createServer();
  await mockServer(page, server);
  await openWorkspace(page);
  await expect.poll(() => server.workspace.revision, { timeout: 15_000 }).toBeGreaterThan(0);

  server.dropAnnotationPosts = 1;
  await page.getByRole("button", { name: "Pen", exact: true }).click();
  await drawStroke(page);
  await expect(visibleInk(page)).toHaveCount(1);

  // The dropped post marks the connection as failing; the connection probe
  // then succeeds and the workspace re-sends what it could not deliver.
  await expect.poll(() => server.annotations.size, { timeout: 20_000 }).toBe(1);
  const [dropped, delivered] = server.annotationPosts;
  expect(delivered.idempotency_key).toBe(dropped.idempotency_key);
  expect(delivered.annotations.map((item) => item.id)).toEqual(dropped.annotations.map((item) => item.id));
});
