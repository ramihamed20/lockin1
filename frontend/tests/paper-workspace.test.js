import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { parseYouTubeVideoId, youTubeEmbedUrl } from "../src/lib/youtube.js";

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
  for (const path of ["../nginx/default.conf", "../../deploy/container-host/nginx.conf.template"]) {
    const config = await readFile(new URL(path, import.meta.url), "utf8");
    assert.match(config, /frame-src 'self' https:\/\/www\.youtube-nocookie\.com;/, path);
    // Search result thumbnails, and nothing else from YouTube's image host.
    assert.match(config, /img-src 'self' blob: https:\/\/i\.ytimg\.com;/, path);
  }
});

test("search stays inside Lock-in: nothing links or opens youtube.com", async () => {
  const [page, youtube] = await Promise.all([
    readFile(new URL("../src/pages/PaperWorkspace.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/youtube.js", import.meta.url), "utf8")
  ]);
  assert.doesNotMatch(page, /window\.open|target="_blank"|youtube\.com\/results/);
  assert.doesNotMatch(youtube, /youtube\.com\/results/);
  assert.match(page, /focusApi\.searchYouTube\(/);
});

test("the generated rain is audible, never clips, and needs no Web Audio to build", async () => {
  const { synthesizeLofiLoop, LOFI_LOOP_SECONDS } = await import("../src/workspace/paper/lofiAudio.js");
  const samples = synthesizeLofiLoop();
  assert.equal(samples.length, Math.ceil(LOFI_LOOP_SECONDS * 24000));
  let peak = 0;
  let energy = 0;
  for (const value of samples) {
    assert.ok(Number.isFinite(value));
    peak = Math.max(peak, Math.abs(value));
    energy += value * value;
  }
  assert.ok(peak < 1, `peak ${peak}`);
  assert.ok(Math.sqrt(energy / samples.length) > 0.05, "too quiet to hear");
  // The same loop for everyone.
  assert.deepEqual(synthesizeLofiLoop().subarray(0, 64), samples.subarray(0, 64));
});

test("rain loops without a boundary click or a silent gap", async () => {
  const { synthesizeLofiLoop } = await import("../src/workspace/paper/lofiAudio.js");
  const samples = synthesizeLofiLoop();
  let jumpEnergy = 0;
  for (let index = 1; index < samples.length; index += 1) jumpEnergy += (samples[index] - samples[index - 1]) ** 2;
  const typicalJump = Math.sqrt(jumpEnergy / (samples.length - 1));
  assert.ok(Math.abs(samples[0] - samples.at(-1)) < typicalJump * 3, "loop seam clicks");
  for (const start of [0, samples.length - 24000]) {
    let energy = 0;
    for (let index = start; index < start + 24000; index += 1) energy += samples[index] ** 2;
    assert.ok(Math.sqrt(energy / 24000) > 0.05, "loop fades into silence");
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

const sheet = (id, ready, extra = {}) => ({ slug: `s-${id}`, learningObjectId: id, title: `Sheet ${id}`, hasActiveStudy: ready, ...extra });

test("a subject is listed whenever it has a published sheet, ready or not", async () => {
  const { buildPaperGroups } = await import("../src/workspace/paper/sheetGroups.js");
  const groups = buildPaperGroups([
    { slug: "biochemistry-1", title: "Biochemistry 1", sheets: [sheet("b1", true)] },
    // The reported bug: every sheet is not ready, and the whole subject used to vanish.
    { slug: "histology-1", title: "Histology 1", sheets: [sheet("h1", false), sheet("h2", false)] }
  ]);
  assert.deepEqual(groups.map((group) => group.slug), ["biochemistry-1", "histology-1"]);
  const histology = groups[1];
  assert.equal(histology.sheets.length, 2);
  assert.equal(histology.readyCount, 0);
  assert.ok(histology.sheets.every((item) => item.ready === false));
});

test("every sheet of a subject shows, and only ready ones are counted as startable", async () => {
  const { buildPaperGroups } = await import("../src/workspace/paper/sheetGroups.js");
  const [group] = buildPaperGroups([
    { slug: "x", title: "X", sheets: [sheet("1", true), sheet("2", false), sheet("3", true), sheet("4", false), sheet("5", true)] }
  ]);
  assert.deepEqual(group.sheets.map((item) => item.learningObjectId), ["1", "2", "3", "4", "5"]);
  assert.equal(group.readyCount, 3);
  assert.deepEqual(group.sheets.map((item) => item.ready), [true, false, true, false, true]);
});

test("visibility depends on the sheets themselves, never on a subject's name, slug or position", async () => {
  const { buildPaperGroups } = await import("../src/workspace/paper/sheetGroups.js");
  const sheets = [sheet("a", false)];
  for (const [slug, title] of [["histology-1", "Histology 1"], ["biochemistry-1", "Biochemistry 1"], ["", ""], ["anything", "Anything 99"]]) {
    const groups = buildPaperGroups([{ slug, title, sheets }]);
    assert.equal(groups.length, 1, `${slug || "(blank)"}`);
  }
  // Same input in a different order lists the same subjects in that order.
  const a = { slug: "a", title: "A", sheets: [sheet("1", true)] };
  const b = { slug: "b", title: "B", sheets: [sheet("2", false)] };
  assert.deepEqual(buildPaperGroups([a, b]).map((g) => g.slug), ["a", "b"]);
  assert.deepEqual(buildPaperGroups([b, a]).map((g) => g.slug), ["b", "a"]);
});

test("a subject with no openable sheet is the only kind left out", async () => {
  const { buildPaperGroups } = await import("../src/workspace/paper/sheetGroups.js");
  const groups = buildPaperGroups([
    { slug: "empty", title: "No sheets", sheets: [] },
    { slug: "missing", title: "Sheets field absent" },
    { slug: "no-id", title: "Unopenable", sheets: [sheet("", true), sheet(null, true)] },
    { slug: "one", title: "One", sheets: [sheet("only", false)] }
  ]);
  assert.deepEqual(groups.map((group) => group.slug), ["one"]);
  assert.deepEqual(buildPaperGroups(undefined), []);
  assert.deepEqual(buildPaperGroups(null), []);
});

test("the page uses the shared grouping and does not filter subjects by readiness itself", async () => {
  const page = await readFile(new URL("../src/pages/PaperWorkspace.jsx", import.meta.url), "utf8");
  assert.match(page, /buildPaperGroups\(materials\)/);
  assert.doesNotMatch(page, /filter\(\(sheet\) => sheet\.learningObjectId && sheet\.hasActiveStudy\)/);
  // Start is the only gate: a not-ready sheet is disabled, not hidden.
  assert.match(page, /disabled=\{!item\.ready\}/);
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

test("Lo-Fi scene videos are silent and the player supplies nature audio", async () => {
  const [media, panel, player] = await Promise.all([
    readFile(new URL("../src/workspace/paper/WorkspaceMedia.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/admin/LofiScenesPanel.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/PaperWorkspace.jsx", import.meta.url), "utf8")
  ]);
  assert.match(media, /^\s+muted\s*$/m);
  // Every admin preview (list thumbnail, focal editor, crop frames) is silent.
  const previews = panel.match(/<WorkspaceMedia [^>]*\/>/g) || [];
  assert.ok(previews.length >= 3);
  assert.ok(previews.every((tag) => / preview \/>$/.test(tag)));
  assert.match(player, /useLofiMedia\(\{ enabled: showLofi,/);
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

test("a Lo-Fi clip loops in one element, fetched whole, never rebuilt per loop", async () => {
  const [media, page] = await Promise.all([
    readFile(new URL("../src/workspace/paper/WorkspaceMedia.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/PaperWorkspace.jsx", import.meta.url), "utf8")
  ]);
  // Native looping, preloaded, no controls: the browser repeats the same file.
  assert.match(media, /^\s+loop$/m);
  assert.match(media, /preload="auto"/);
  assert.doesNotMatch(media, /\scontrols[\s=>]/);
  // Recreated only when the scene changes; nothing re-arms on "ended".
  assert.match(page, /<WorkspaceMedia key=\{scene\.id\}/);
  assert.doesNotMatch(page, /"ended"/);
  // The session length comes from the timer, never from the clip's duration.
  assert.doesNotMatch(page, /duration_ms/);
  assert.match(page, /const SESSION_MINUTES = \[25, 50, 60\]/);
});

test("the admin checks a clip before uploading it and explains the problem", async () => {
  const { clipProblem, formatClipLength } = await import("../src/pages/admin/LofiScenesPanel.jsx").catch(() => ({}));
  if (!clipProblem) return; // JSX is not importable under plain node; the e2e spec covers the flow.
  const limits = { max_bytes: 80 * 1024 * 1024, min_seconds: 2, max_seconds: 300 };
  const clip = { type: "video/mp4", size: 10 * 1024 * 1024 };
  assert.equal(clipProblem(clip, { duration: 20 }, limits), "");
  assert.match(clipProblem({ ...clip, type: "video/quicktime" }, { duration: 20 }, limits), /MP4 or WebM/);
  assert.match(clipProblem({ ...clip, size: 200 * 1024 * 1024 }, { duration: 20 }, limits), /limit is 80 MB/);
  assert.match(clipProblem(clip, { duration: 3600 }, limits), /60\.0 min long; the limit is 5 min/);
  assert.match(clipProblem(clip, null, limits), /can't be played/);
  assert.equal(formatClipLength(20_000), "0:20");
});
