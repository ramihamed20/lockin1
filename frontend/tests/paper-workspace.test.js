import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { parseYouTubeVideoId, youTubeEmbedUrl, youTubeSearchUrl } from "../src/lib/youtube.js";

const ID = "dQw4w9WgXcQ";

test("YouTube links of every common shape resolve to their video id", () => {
  for (const input of [
    ID,
    `https://www.youtube.com/watch?v=${ID}&t=42s`,
    `youtube.com/watch?v=${ID}`,
    `https://m.youtube.com/watch?v=${ID}`,
    `https://youtu.be/${ID}?si=abc`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://www.youtube.com/live/${ID}`,
    `https://www.youtube-nocookie.com/embed/${ID}`
  ]) {
    assert.equal(parseYouTubeVideoId(input), ID, input);
  }
});

test("text that is not a YouTube video is not treated as one", () => {
  for (const input of ["", "lofi beats", "https://example.com/watch?v=" + ID, "https://youtu.be/short", "https://www.youtube.com/channel/UC123"]) {
    assert.equal(parseYouTubeVideoId(input), "", input);
  }
});

test("the embed uses the privacy-enhanced host that the CSP admits", async () => {
  assert.match(youTubeEmbedUrl(ID), /^https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ\?/);
  assert.equal(youTubeEmbedUrl("not an id"), "");
  assert.equal(youTubeSearchUrl(" oral histology "), "https://www.youtube.com/results?search_query=oral+histology");
  for (const path of ["../nginx/default.conf", "../../deploy/container-host/nginx.conf.template"]) {
    const config = await readFile(new URL(path, import.meta.url), "utf8");
    assert.match(config, /frame-src 'self' https:\/\/www\.youtube-nocookie\.com;/, path);
  }
});

test("Paper Workspace is a subscription-protected Study route in the sidebar", async () => {
  const { navItems } = await import("../src/lib/constants.js");
  const item = navItems.find((entry) => entry.path === "/paper-workspace");
  assert.ok(item);
  assert.equal(item.group, "Study");
  const [app, guard] = await Promise.all([
    readFile(new URL("../src/App.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/auth/ProtectedRoute.jsx", import.meta.url), "utf8")
  ]);
  assert.match(app, /<Route path="\/paper-workspace" element=\{<PaperWorkspace user=\{user\} \/>\} \/>/);
  assert.match(guard, /"\/paper-workspace"/);
});

test("skips move exactly 10 seconds and stay inside the media", async () => {
  const { SKIP_SECONDS, skipTarget, formatMediaTime, IDLE_DELAY_MS } = await import("../src/workspace/paper/mediaTime.js");
  assert.equal(SKIP_SECONDS, 10);
  assert.equal(skipTarget(100, SKIP_SECONDS, 300), 110);
  assert.equal(skipTarget(100, -SKIP_SECONDS, 300), 90);
  assert.equal(skipTarget(4, -SKIP_SECONDS, 300), 0);
  assert.equal(skipTarget(295, SKIP_SECONDS, 300), 300);
  // A duration not known yet does not cap a forward skip.
  assert.equal(skipTarget(5, SKIP_SECONDS, 0), 15);
  assert.equal(formatMediaTime(7), "0:07");
  assert.equal(formatMediaTime(750), "12:30");
  assert.equal(formatMediaTime(3725), "1:02:05");
  assert.equal(formatMediaTime(Number.NaN), "0:00");
  // Controls fade after 3–4 quiet seconds.
  assert.ok(IDLE_DELAY_MS >= 3000 && IDLE_DELAY_MS <= 4000);
});

test("the embed takes Lock-in's control bar and is never muted on purpose", () => {
  const url = new URL(youTubeEmbedUrl(ID, "https://app.example"));
  assert.equal(url.searchParams.get("enablejsapi"), "1");
  assert.equal(url.searchParams.get("controls"), "0");
  assert.equal(url.searchParams.get("origin"), "https://app.example");
  assert.equal(url.searchParams.get("mute"), null);
});

test("workspace media plays with sound; only admin previews are muted", async () => {
  const [media, panel, controls] = await Promise.all([
    readFile(new URL("../src/workspace/paper/WorkspaceMedia.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/admin/PaperWorkspaceMediaPanel.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/workspace/paper/MediaControls.jsx", import.meta.url), "utf8")
  ]);
  assert.match(media, /muted=\{preview\}/);
  assert.doesNotMatch(media, /^\s+muted\s*$/m);
  assert.equal((panel.match(/<WorkspaceMedia [^>]* preview \/>/g) || []).length, 2);
  assert.doesNotMatch(controls, /\.muted = true/);
});

test("both checkpoint surfaces guard exits and discard only the open attempt", async () => {
  const [paper, focus] = await Promise.all([
    readFile(new URL("../src/pages/PaperWorkspace.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/CatalogFocusWorkspace.jsx", import.meta.url), "utf8")
  ]);
  for (const source of [paper, focus]) {
    // Held for the dialog's whole life, so a loading state never drops it.
    assert.match(source, /useExitGuard\(\{ active: true, onRequestExit: request(Close|Exit) \}\)/);
    assert.match(source, /<CheckpointExitDialog/);
    assert.match(source, /<CheckpointRestartDialog/);
    assert.match(source, /"discard-attempt"/);
    assert.match(source, /<QuestionExplanation/);
  }
});
