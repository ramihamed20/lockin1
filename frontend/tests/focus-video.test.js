import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { clampPanelPosition, resizePanel } from "../src/workspace/catalog/focusVideo.js";
import { youTubePlayerUrl } from "../src/lib/youtube.js";

const ID = "dQw4w9WgXcQ";

test("the Focus video player embeds only the privacy-enhanced host, with YouTube's own controls", () => {
  const url = new URL(youTubePlayerUrl(ID));
  assert.equal(url.origin, "https://www.youtube-nocookie.com");
  assert.equal(url.pathname, `/embed/${ID}`);
  assert.equal(url.searchParams.get("playsinline"), "1");
  assert.equal(url.searchParams.has("controls"), false);
  // A tap on the drag surface plays or pauses through the iframe API.
  assert.equal(new URL(youTubePlayerUrl(ID, "https://lock-in.example")).searchParams.get("origin"), "https://lock-in.example");
  assert.equal(url.searchParams.get("enablejsapi"), "1");
  assert.equal(youTubePlayerUrl("not a video"), "");
  assert.equal(youTubePlayerUrl(`${ID}"><script>`), "");
});

test("the floating player is kept inside the screen however far it is dragged", () => {
  const size = { width: 340, height: 200 };
  const screen = { width: 1024, height: 768 };
  assert.deepEqual(clampPanelPosition({ x: -50, y: -50 }, size, screen, 12), { x: 12, y: 12 });
  assert.deepEqual(clampPanelPosition({ x: 5000, y: 5000 }, size, screen, 12), { x: 672, y: 556 });
  assert.deepEqual(clampPanelPosition({ x: 300.4, y: 200.6 }, size, screen, 12), { x: 300, y: 201 });
  // A panel wider than a phone still keeps its start edge on screen.
  assert.deepEqual(clampPanelPosition({ x: 40, y: 40 }, { width: 400, height: 260 }, { width: 375, height: 667 }, 12), { x: 12, y: 40 });
});

test("one player is mounted beside the kept readers and opened from the new-tab menu", async () => {
  const keepAlive = await readFile(new URL("../src/workspace/catalog/WorkspaceKeepAlive.jsx", import.meta.url), "utf8");
  const tabBar = await readFile(new URL("../src/workspace/catalog/WorkspaceTabBar.jsx", import.meta.url), "utf8");
  const player = await readFile(new URL("../src/workspace/catalog/FocusVideoPlayer.jsx", import.meta.url), "utf8");
  assert.match(keepAlive, /<>\{readers\}<FocusVideoPlayer \/><\/>/);
  assert.match(tabBar, /requestFocusVideo\(\)/);
  // The top layer keeps it above a reader in full screen.
  assert.match(player, /popover="manual"/);
  assert.match(player, /fullscreenchange/);
});

test("resizing keeps the video's shape and pins the opposite edge", () => {
  const start = { x: 400, y: 300, width: 320, height: 182 }; // 180 of video + a 2px border
  const screen = { width: 1180, height: 820 };
  // Right edge: wider, height follows 16:9, top-left stays.
  assert.deepEqual(resizePanel({ edge: "e", dx: 160, dy: 0, start, viewport: screen, margin: 12 }), { width: 480, x: 400, y: 300 });
  // Left edge: the right edge stays where it was.
  assert.deepEqual(resizePanel({ edge: "w", dx: -160, dy: 0, start, viewport: screen, margin: 12 }), { width: 480, x: 240, y: 300 });
  // Bottom edge: 90px taller is 160px wider.
  assert.equal(resizePanel({ edge: "s", dx: 0, dy: 90, start, viewport: screen, margin: 12 }).width, 480);
  // Top-left corner: the bottom-right corner stays put.
  const nw = resizePanel({ edge: "nw", dx: -160, dy: -10, start, viewport: screen, margin: 12 });
  assert.equal(nw.width, 480);
  assert.equal(nw.x + nw.width, 720);
  assert.equal(Math.round(nw.y + nw.width * 9 / 16 + 2), 482);
  // Never smaller than the minimum, never past the screen edge it grows towards.
  assert.equal(resizePanel({ edge: "se", dx: -900, dy: -900, start, viewport: screen, margin: 12 }).width, 220);
  assert.equal(resizePanel({ edge: "e", dx: 5000, dy: 0, start, viewport: screen, margin: 12 }).width, 768);
  assert.equal(resizePanel({ edge: "s", dx: 0, dy: 5000, start, viewport: screen, margin: 12 }).width, 1180 - 12 - 400);
  assert.equal(resizePanel({ edge: "s", dx: 0, dy: 5000, start: { ...start, x: 12 }, viewport: screen, margin: 12 }).width, Math.round((820 - 12 - 300 - 2) * 16 / 9));
});
