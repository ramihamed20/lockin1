import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { fulfillAccessContract } from "./fixtures/productionApi.js";

/**
 * Creator Studio → Content: the Lo-Fi scenes of the Paper Workspace player.
 * An administrator uploads a short clip once; the list, the order students see,
 * showing/hiding, replacing and deleting all go through the scene API. The mock
 * below keeps scene state the way the server does, so each step reads back
 * what the previous one saved.
 */

const CLIP = readFileSync(new URL("./fixtures/lofi-loop.webm", import.meta.url));
/** Real servers return UUIDs; the prefix says what kind of thing it is. */
const uuid = (prefix, n) => `${prefix}-0000-4000-8000-${String(n).padStart(12, "0")}`;
const CLIP_ID = (n) => uuid("c11bc11b", n);
const COVER_ID = (n) => uuid("c07ec07e", n);
const SCENE_ID = (n) => uuid("5ce05ce0", n);
const LIMITS = { recommended: { width: 1920, height: 1080, alternative: "1280×720", aspect_ratio: "16:9" }, max_bytes: 80 * 1024 * 1024, min_seconds: 1, max_seconds: 300, max_scenes: 24 };

function createStudio() {
  const studio = {
    scenes: /** @type {any[]} */ ([]),
    uploads: /** @type {string[]} */ ([]),
    calls: /** @type {string[]} */ ([]),
    limits: { ...LIMITS },
    payload() { return { ...this.limits, scenes: this.scenes.map((scene, position) => ({ ...scene, position })) }; },
    file(id, type) {
      return { id, url: `/api/v1/files/${id}/view`, content_type: type, media_type: type.startsWith("video/") ? "video" : "image", original_name: `${id}.webm`, size_bytes: CLIP.length, duration_ms: type.startsWith("video/") ? 2000 : null };
    }
  };
  return studio;
}

async function openStudio(page, studio) {
  let fileCount = 0;
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (await fulfillAccessContract(route, url.pathname)) return undefined;
    if (url.pathname === "/api/v1/auth/session") return json({ user: { id: "lofi-admin", email: "lofi@example.test", full_name: "Lo-Fi Admin", preferred_language: "en", status: "active", is_email_verified: true, roles: ["student", "administrator"], date_joined: "2026-01-01T00:00:00Z" } });
    if (url.pathname === "/api/v1/auth/csrf") return json({ csrf_token: "e2e-csrf-token" });
    if (url.pathname === "/api/v1/operations/session") return json({ roles: ["administrator"], capabilities: ["overview.view", "content.view", "content.manage"], dashboards: ["overview"], timezone: "UTC" });
    if (url.pathname.startsWith("/api/v1/files/")) {
      return url.pathname.includes("c07ec07e")
        ? route.fulfill({ status: 200, contentType: "image/svg+xml", body: "<svg xmlns='http://www.w3.org/2000/svg' width='320' height='180'><rect width='320' height='180' fill='#2a2250'/></svg>" })
        : route.fulfill({ status: 200, contentType: "video/webm", body: CLIP });
    }
    if (url.pathname === "/api/v1/management/files" && method === "POST") {
      const body = request.postDataBuffer()?.toString("latin1") || "";
      const kind = /name="kind"\r\n\r\n([^\r]+)/.exec(body)?.[1];
      const isCover = /Content-Type: image\//.test(body);
      fileCount += 1;
      const id = isCover ? COVER_ID(fileCount) : CLIP_ID(fileCount);
      studio.uploads.push(`${kind}:${id}`);
      return json({ id, kind, content_type: isCover ? "image/png" : "video/webm", size_bytes: 10 }, 201);
    }
    const sceneMatch = /^\/api\/v1\/operations\/admin\/lofi-scenes(?:\/([^/]+))?$/.exec(url.pathname);
    if (sceneMatch) {
      const body = method === "GET" ? null : request.postDataJSON();
      studio.calls.push(`${method} ${url.pathname.replace("/api/v1/operations/admin", "")}`);
      const [, target] = sceneMatch;
      if (!target && method === "POST") {
        studio.scenes.push({ id: SCENE_ID(studio.scenes.length + 1), title: body.title.trim(), enabled: body.enabled, focal_x: body.focal_x, focal_y: body.focal_y, revision: 1, deliverable: true, media: studio.file(body.media_file_id, "video/webm"), cover: body.cover_file_id ? studio.file(body.cover_file_id, "image/png") : null });
        return json(studio.payload(), 201);
      }
      if (target === "order" && method === "PUT") {
        studio.scenes = body.scene_ids.map((id) => studio.scenes.find((scene) => scene.id === id));
        return json(studio.payload());
      }
      const scene = studio.scenes.find((item) => item.id === target);
      if (scene && method === "PATCH") {
        if (body.expected_revision !== scene.revision) return json({ error: { code: "lofi_scene_conflict", message: "This scene changed. Reload it and try again." } }, 409);
        if ("title" in body) scene.title = body.title.trim();
        if ("enabled" in body) scene.enabled = body.enabled;
        if (body.media_file_id) scene.media = studio.file(body.media_file_id, "video/webm");
        if ("cover_file_id" in body) scene.cover = body.cover_file_id ? studio.file(body.cover_file_id, "image/png") : null;
        scene.revision += 1;
        return json(studio.payload());
      }
      if (scene && method === "DELETE") {
        studio.scenes = studio.scenes.filter((item) => item !== scene);
        return json(studio.payload());
      }
      return json(studio.payload());
    }
    if (method === "GET") return json({ count: 0, results: [] });
    return json({ error: { code: "not_found", message: "Unused" } }, 404);
  });
  await page.goto("/#/operations/admin/content");
  const panel = page.locator("section.paper-media-admin");
  await expect(panel.getByRole("heading", { name: "Lo-Fi scenes" })).toBeVisible();
  return panel;
}

async function addScene(panel, title, { cover = false } = {}) {
  await panel.getByRole("button", { name: "Add scene" }).click();
  const editor = panel.getByRole("form", { name: "New scene" });
  await editor.getByTestId("lofi-video-input").setInputFiles({ name: "rain-loop.webm", mimeType: "video/webm", buffer: CLIP });
  // The clip is read in the browser first: its length is shown before upload.
  await expect(editor.getByText(/rain-loop\.webm · .* · 0:02 loop/)).toBeVisible();
  if (cover) await editor.getByTestId("lofi-cover-input").setInputFiles({ name: "cover.png", mimeType: "image/png", buffer: readFileSync(new URL("../public/icons/lockin-gold-192-v2.png", import.meta.url)) });
  await editor.getByLabel("Title").fill(title);
  await editor.getByRole("button", { name: "Add scene" }).click();
  await expect(editor).toHaveCount(0);
}

test("an administrator uploads short clips once and manages the scenes students see", async ({ page }, testInfo) => {
  const studio = createStudio();
  await page.setViewportSize({ width: 1440, height: 1000 });
  const panel = await openStudio(page, studio);
  await expect(panel.getByText("No scenes yet. Students see the built-in lofi scene.")).toBeVisible();

  await addScene(panel, "Rainy night", { cover: true });
  await expect(panel.getByRole("status")).toContainText("“Rainy night” was added");
  await addScene(panel, "Library");
  // One upload per clip and cover, as Lo-Fi media: nothing else is generated.
  expect(studio.uploads).toEqual([`workspace_media:${CLIP_ID(1)}`, `workspace_media:${COVER_ID(2)}`, `workspace_media:${CLIP_ID(3)}`]);

  const rows = panel.getByRole("list", { name: "Scenes, in the order students see them" }).getByRole("listitem");
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText("Rainy night");
  await expect(rows.first()).toContainText("0:02 loop");
  await expect(rows.first().locator("img")).toHaveAttribute("src", `/api/v1/files/${COVER_ID(2)}/view`);
  await page.screenshot({ path: testInfo.outputPath("lofi-admin-list.png"), fullPage: true });

  // Reorder, hide, rename, delete.
  await panel.getByRole("button", { name: "Move “Library” up" }).click();
  await expect(rows.first()).toContainText("Library");
  expect(studio.calls).toContain("PUT /lofi-scenes/order");
  await rows.first().getByRole("checkbox").click();
  await expect(rows.first().getByRole("checkbox")).not.toBeChecked();
  await expect(rows.first()).toContainText("Hidden");
  await rows.nth(1).getByRole("button", { name: "Edit" }).click();
  const editor = panel.getByRole("form", { name: "Edit “Rainy night”" });
  await editor.getByLabel("Title").fill("Rainy night, city");
  await editor.getByRole("button", { name: "Remove cover" }).click();
  await editor.getByRole("button", { name: "Save" }).click();
  await expect(rows.nth(1)).toContainText("Rainy night, city");
  expect(studio.scenes[1].cover).toBeNull();

  await panel.getByRole("button", { name: "Delete “Library”" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await expect(rows).toHaveCount(1);
  expect(studio.calls.filter((call) => call.startsWith("DELETE"))).toEqual([`DELETE /lofi-scenes/${SCENE_ID(2)}`]);
});

test("unsuitable clips are explained before anything is uploaded", async ({ page }) => {
  const studio = createStudio();
  studio.limits.min_seconds = 3;
  await page.setViewportSize({ width: 1280, height: 900 });
  const panel = await openStudio(page, studio);
  await panel.getByRole("button", { name: "Add scene" }).click();
  const editor = panel.getByRole("form", { name: "New scene" });
  const input = editor.getByTestId("lofi-video-input");

  await input.setInputFiles({ name: "clip.mov", mimeType: "video/quicktime", buffer: CLIP });
  await expect(editor.getByRole("alert")).toHaveText("Choose an MP4 or WebM video.");
  await input.setInputFiles({ name: "short.webm", mimeType: "video/webm", buffer: CLIP });
  await expect(editor.getByRole("alert")).toHaveText("This video is 2.0 s long; a loop must be at least 3 s.");
  await input.setInputFiles({ name: "broken.webm", mimeType: "video/webm", buffer: Buffer.from("not really a video") });
  await expect(editor.getByRole("alert")).toContainText("can't be played in the browser");
  await editor.getByRole("button", { name: "Add scene" }).click();
  await expect(editor.getByRole("alert")).toHaveText("Give the scene a title.");
  expect(studio.uploads).toEqual([]);
  expect(studio.calls.filter((call) => !call.startsWith("GET"))).toEqual([]);
});

test("the scene list stays usable on an iPad in portrait", async ({ page }, testInfo) => {
  const studio = createStudio();
  studio.scenes = [1, 2, 3].map((index) => ({ id: SCENE_ID(index), title: ["Cat at desk", "Rainy night", "Coffee shop"][index - 1], enabled: index !== 3, focal_x: 50, focal_y: 50, revision: 1, deliverable: true, media: studio.file(CLIP_ID(index), "video/webm"), cover: null }));
  await page.setViewportSize({ width: 820, height: 1180 });
  const panel = await openStudio(page, studio);
  await expect(panel.getByRole("listitem")).toHaveCount(3);
  await expect(panel.getByRole("button", { name: "Move “Cat at desk” up" })).toBeDisabled();
  await expect(panel.getByRole("button", { name: "Move “Coffee shop” down" })).toBeDisabled();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await panel.screenshot({ path: testInfo.outputPath("lofi-admin-ipad.png") });
});
