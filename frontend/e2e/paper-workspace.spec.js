import { expect, test } from "@playwright/test";
import { fulfillAccessContract, studentSession } from "./fixtures/productionApi.js";
import { withoutServiceWorker } from "./helpers/serviceWorker.js";

/**
 * Paper Workspace: a student studying from a printed sheet picks the sheet and
 * the Active Study difficulty, keeps the workspace open, and takes each
 * checkpoint in a dialog. The managed run below follows the server's stages
 * (reading -> checkpoint -> reading of the next part) so the page is exercised
 * against the real contract shape.
 */

const SHEET_ID = "5b0e2f7a-9d4c-4a51-8f11-2a7c0e3b9a10";
const RUN_ID = "0c9a3f55-6b7e-4d20-9e1a-3f5c7d8e9b01";

const MATERIALS = {
  count: 2,
  results: [
    {
      slug: "paper-e2e-dental-anatomy",
      title: "Dental Anatomy",
      sheets: [
        { slug: "anatomy-1", learningObjectId: "5b0e2f7a-9d4c-4a51-8f11-2a7c0e3b9a20", number: 1, title: "Sheet 1 · Maxillary Incisors", pageCount: 12, hasActiveStudy: true, deliverable: true }
      ]
    },
    {
      slug: "paper-e2e-oral-histology",
      title: "Oral Histology",
      sheets: [
        { slug: "sheet-3-epithelium", learningObjectId: SHEET_ID, number: 1, title: "Sheet 3 · Epithelial Tissue", pageCount: 10, hasActiveStudy: true, deliverable: true },
        // Listed with Active Study, but unknown to the Active Study service.
        { slug: "sheet-5-unknown", learningObjectId: "e2e-unknown-sheet", number: 3, title: "Sheet 5 · Unknown to the server", pageCount: 6, hasActiveStudy: true, deliverable: true },
        { slug: "sheet-4-no-active-study", learningObjectId: "5b0e2f7a-9d4c-4a51-8f11-2a7c0e3b9a11", number: 2, title: "Sheet 4 · Not configured", pageCount: 8, hasActiveStudy: false, deliverable: true }
      ]
    }
  ]
};

const QUESTIONS = [
  { question: "Which junction seals neighbouring epithelial cells?", options: { A: "Tight junction", B: "Gap junction", C: "Desmosome", D: "Hemidesmosome" }, correct: "A", explanation: "Tight junctions fuse neighbouring membranes into a seal." },
  { question: "Epithelium receives nutrients mainly by…", options: { A: "Its own capillaries", B: "Diffusion from the lamina propria", C: "Lymph vessels", D: "Saliva" }, correct: "B", explanation: "Epithelium is avascular." }
];

function createServer() {
  const ranges = [{ part: 1, start_page: 1, end_page: 5 }, { part: 2, start_page: 6, end_page: 10 }];
  const run = { id: RUN_ID, sheet_id: SHEET_ID, difficulty: "medium", status: "active", stage: "reading", current_part: 1, completed_parts: [], last_score: null };
  let answers = {};
  let attempt = 1;
  const calls = [];
  const payload = () => ({ ...run, number_of_parts: ranges.length, current_page_range: ranges.find((item) => item.part === run.current_part) || null });
  return {
    calls,
    answers: () => ({ ...answers }),
    /** Another tab (or a double open) already moved the run to its checkpoint. */
    moveToCheckpoint() { run.stage = "checkpoint"; },
    async handle(route, pathname, method) {
      const json = async (body, status = 200) => {
        await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
        return true;
      };
      if (!pathname.startsWith("/api/v1/focus/managed-active-study")) return false;
      calls.push(`${method} ${pathname.replace(RUN_ID, ":run").replace(SHEET_ID, ":sheet")}`);
      if (pathname.endsWith(`/sheets/${SHEET_ID}`)) {
        return json({ sheet_id: SHEET_ID, enabled: true, difficulties: ["easy", "medium", "hard"].map((difficulty) => ({ difficulty, status: difficulty === "hard" ? "missing_questions" : "ready", number_of_parts: 2, page_ranges: ranges, progress: null, completed: false })) });
      }
      if (pathname.endsWith("/start")) return json({ run: payload(), resumed: false });
      if (pathname.endsWith("/complete-reading")) {
        // The server's rule: only a part still being read can move to its checkpoint.
        if (run.stage !== "reading") return json({ error: { code: "rule_error", message: "This part is not ready for its checkpoint." } }, 400);
        run.stage = "checkpoint";
        return json({ run: payload() });
      }
      if (pathname.endsWith("/questions")) {
        return json({ run: payload(), attempt_id: `attempt-${attempt}`, kind: "checkpoint", questions: QUESTIONS.map((item, index) => ({ position: index + 1, question: item.question, options: item.options, answered: answers[index + 1] || null })) });
      }
      if (pathname.endsWith("/answer")) {
        const body = route.request().postDataJSON();
        answers[body.position] = body.selected_answer;
        const question = QUESTIONS[body.position - 1];
        return json({ correct: body.selected_answer === question.correct, correct_answer: question.correct, explanation: question.explanation, answered_count: Object.keys(answers).length, total: QUESTIONS.length });
      }
      if (pathname.endsWith("/discard-attempt")) {
        // Only the open attempt goes; the run and its completed parts stay.
        answers = {};
        attempt += 1;
        return json({ run: payload() });
      }
      if (pathname.endsWith("/submit")) {
        const score = QUESTIONS.filter((item, index) => answers[index + 1] === item.correct).length;
        run.completed_parts = [run.current_part];
        run.current_part = 2;
        run.stage = "reading";
        run.last_score = score;
        return json({ run: payload(), result: { score, total: QUESTIONS.length, passed: true, completed: false, xp_awarded: 0 } });
      }
      return json({ error: { code: "not_found", message: "Unused" } }, 404);
    }
  };
}

/** Six embeddable videos, shaped like the server's YouTube search payload. */
const YOUTUBE_RESULTS = Array.from({ length: 6 }, (_, index) => ({
  video_id: `lockin${String(index).padStart(3, "0")}yt`,
  title: index === 0 ? "Oral Histology: Epithelium – full lecture" : `Epithelium lecture ${index + 1}`,
  channel_title: "Dental Lectures",
  thumbnail: `https://i.ytimg.com/vi/lockin${String(index).padStart(3, "0")}yt/mqdefault.jpg`
}));

/** Answers the in-app YouTube search; `youtube.queries` records what was asked. */
function youTubeSearch(respond = () => ({ body: { results: YOUTUBE_RESULTS } })) {
  const handler = { queries: /** @type {string[]} */ ([]), respond };
  return handler;
}

async function mockStudent(page, server, session = {}, media = null, youtube = youTubeSearch()) {
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (pathname === "/api/v1/auth/session") return json({ user: studentSession(session) });
    if (pathname === "/api/v1/auth/csrf") return json({ csrf_token: "e2e-csrf-token" });
    if (await fulfillAccessContract(route, pathname)) return undefined;
    if (pathname === "/api/v1/catalog/materials") return json(MATERIALS);
    if (pathname === "/api/v1/focus/paper-workspace/media") return json({ media });
    if (pathname === "/api/v1/focus/paper-workspace/youtube-search") {
      const query = new URL(request.url()).searchParams.get("q") || "";
      youtube.queries.push(query);
      const { status = 200, body, delay = 0 } = youtube.respond(query);
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      return json({ query, ...body }, status);
    }
    if (await server.handle(route, pathname, request.method())) return undefined;
    if (request.method() === "GET") return json({ count: 0, results: [] });
    return json({ error: { code: "not_found", message: "Unused" } }, 404);
  });
  // The YouTube embed and thumbnails are never fetched in tests.
  await page.route("https://www.youtube-nocookie.com/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<html><body style='background:#111'></body></html>" }));
  await page.route("https://i.ytimg.com/**", (route) => route.fulfill({ status: 200, contentType: "image/svg+xml", body: "<svg xmlns='http://www.w3.org/2000/svg' width='320' height='180'><rect width='320' height='180' fill='#3a2f5c'/></svg>" }));
  // youtube.com itself must never be reached from the workspace.
  await page.route(/^https:\/\/(www\.)?youtube\.com\//, (route) => route.abort());
}

test("a student sets up a paper session, plays a video and passes a checkpoint", async ({ page }, testInfo) => {
  const server = createServer();
  await mockStudent(page, server);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/paper-workspace");

  // Setup is Subject -> Sheet -> Difficulty: no sheet is listed before a subject is chosen.
  await expect(page.getByRole("heading", { name: "Ready when you are" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Dental Anatomy/ })).toBeVisible();
  await expect(page.getByRole("radio", { name: /Sheet/ })).toHaveCount(0);
  await expect(page.getByRole("radiogroup", { name: "Active Study" })).toHaveCount(0);
  await page.getByRole("button", { name: /Oral Histology/ }).click();

  // Only that subject's sheets with Active Study; the difficulty waits for a sheet.
  await expect(page.getByRole("radio", { name: /Sheet 3 · Epithelial Tissue/ })).toBeVisible();
  await expect(page.getByRole("radio", { name: /Maxillary Incisors/ })).toHaveCount(0);
  await expect(page.getByRole("radiogroup", { name: "Active Study" })).toHaveCount(0);
  await page.getByRole("radio", { name: /Sheet 3 · Epithelial Tissue/ }).click();
  await expect(page.getByRole("radio", { name: /Not configured/ })).toHaveCount(0);
  await expect(page.getByRole("radio", { name: "Hard" })).toBeDisabled();

  // A sheet the server cannot confirm is never started.
  await page.getByRole("radio", { name: /Unknown to the server/ }).click();
  await expect(page.getByText("Active Study isn't available for this sheet yet. Choose another sheet.")).toBeVisible();
  await expect(page.getByRole("button", { name: /Start Session/ })).toBeDisabled();
  expect(server.calls.filter((call) => call.endsWith("/start"))).toHaveLength(0);
  await page.getByRole("radio", { name: /Sheet 3 · Epithelial Tissue/ }).click();

  await page.getByRole("radio", { name: "Medium" }).click();
  await page.screenshot({ path: testInfo.outputPath("paper-setup.png") });
  await page.getByRole("button", { name: /Start Session/ }).click();

  // Workspace: timer, lofi scene, notes and the run's status.
  await expect(page.getByRole("timer")).toHaveText(/^(50:00|49:5\d)$/);
  await expect(page.getByRole("img", { name: /cat asleep/ })).toBeVisible();
  const status = page.locator(".paper-status");
  await expect(status.getByText("Part 1 of 2")).toBeVisible();
  await expect(status.getByText("1 – 5")).toBeVisible();
  await page.getByRole("textbox", { name: "Notes" }).fill("Basal lamina = lucida + densa");
  await page.getByRole("button", { name: "Pause" }).first().click();
  await expect(page.getByText("Paused")).toBeVisible();
  await page.getByRole("button", { name: "Resume" }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: testInfo.outputPath("paper-workspace.png") });

  // A pasted link plays in place of the lofi scene, and can be switched back.
  const search = page.getByRole("searchbox", { name: "Search YouTube" });
  await search.fill("https://youtu.be/dQw4w9WgXcQ");
  await page.getByRole("button", { name: "Play this video" }).click();
  await expect(page.locator("iframe.paper-player-frame")).toHaveAttribute("src", /^https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ\?/);
  // A text search lists results in place; nothing links out to youtube.com.
  await search.fill("oral histology epithelium");
  await search.press("Enter");
  await expect(page.locator(".paper-results").getByRole("button", { name: /Oral Histology: Epithelium/ })).toBeVisible();
  await expect(page.locator(".paper-results a")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("paper-search.png") });
  await page.keyboard.press("Escape");
  await page.locator(".paper-player").hover();
  await page.getByRole("button", { name: "Back to lofi" }).click();
  await expect(page.locator("iframe.paper-player-frame")).toHaveCount(0);

  // Checkpoint opens a modal dialog and answers are checked one by one. The
  // run was already moved on elsewhere, so completing the reading is refused;
  // the questions still open.
  server.moveToCheckpoint();
  await page.getByRole("button", { name: /Checkpoint/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: QUESTIONS[0].question })).toBeVisible();
  expect(server.calls).toContain("POST /api/v1/focus/managed-active-study/:run/complete-reading");
  await dialog.getByRole("button", { name: /Gap junction/ }).click();
  // The explanation waits behind the product's Explanation control.
  await expect(dialog.getByText(QUESTIONS[0].explanation)).toHaveCount(0);
  await dialog.getByRole("button", { name: "Explanation" }).click();
  await expect(dialog.getByText(QUESTIONS[0].explanation)).toBeVisible();
  await dialog.getByRole("button", { name: "Hide explanation" }).click();
  await expect(dialog.getByText(QUESTIONS[0].explanation)).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: /Tight junction/ })).toHaveClass(/is-correct/);
  await expect(dialog.getByRole("button", { name: /Gap junction/ })).toHaveClass(/is-wrong/);
  await page.screenshot({ path: testInfo.outputPath("paper-checkpoint.png") });
  await dialog.getByRole("button", { name: /Next/ }).click();
  await dialog.getByRole("button", { name: /Diffusion/ }).click();
  await dialog.getByRole("button", { name: /See result/ }).click();
  await expect(dialog.getByRole("heading", { name: "Part 1 done" })).toBeVisible();
  await expect(dialog.getByText("1 / 2")).toBeVisible();
  await dialog.getByRole("button", { name: "Continue" }).click();
  await expect(dialog).toHaveCount(0);

  // The status follows the run: part 1 is done, part 2 is current.
  await expect(status.getByText("Part 2 of 2")).toBeVisible();
  await expect(status.getByText("6 – 10")).toBeVisible();
  await expect(status.locator(".paper-step.is-done")).toHaveCount(1);
  await expect(status.locator(".paper-step.is-current")).toHaveText(/Part 2/);

  // Notes survive leaving and returning.
  await page.getByRole("button", { name: "Change" }).click();
  await page.getByRole("button", { name: /Start Session/ }).click();
  await expect(page.getByRole("textbox", { name: "Notes" })).toHaveValue("Basal lamina = lucida + densa");
});

test("the workspace reads right to left and stacks on a phone", async ({ page }, testInfo) => {
  await mockStudent(page, createServer(), { preferred_language: "ar" });
  await page.addInitScript(() => window.localStorage.setItem("lock-in.locale", "ar"));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/paper-workspace");
  await page.getByRole("button", { name: /Oral Histology/ }).click();
  await page.getByRole("radio", { name: /Sheet 3/ }).click();
  await page.getByRole("button", { name: /ابدأ الجلسة/ }).click();
  await expect(page.getByRole("timer")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.screenshot({ path: testInfo.outputPath("paper-phone-rtl.png"), fullPage: true });
});

test("an administrator's media replaces the lofi scene and crops around its focal point", async ({ page }, testInfo) => {
  const media = { id: "media-1", url: "/e2e-media/lofi.svg", content_type: "image/svg+xml", media_type: "image", original_name: "lofi.svg", size_bytes: 1, focal_x: 30, focal_y: 70, revision: 2 };
  // Re-navigates with a mocked media file, which a controlling worker would answer itself.
  await withoutServiceWorker(page);
  await mockStudent(page, createServer(), {}, media);
  await page.route("**/e2e-media/lofi.svg", (route) => route.fulfill({
    status: 200,
    contentType: "image/svg+xml",
    body: "<svg xmlns='http://www.w3.org/2000/svg' width='1920' height='1080'><rect width='1920' height='1080' fill='#2a2250'/><circle cx='576' cy='756' r='200' fill='#f5c542'/></svg>"
  }));
  await page.addInitScript(() => window.localStorage.setItem("lock-in.paper-workspace.setup", JSON.stringify({ subjectSlug: "paper-e2e-oral-histology", sheetId: "5b0e2f7a-9d4c-4a51-8f11-2a7c0e3b9a10", difficulty: "medium" })));
  for (const [width, height, name] of [[1440, 900, "desktop"], [1180, 820, "ipad-landscape"], [820, 1180, "ipad-portrait"], [390, 844, "mobile"]]) {
    await page.setViewportSize({ width, height });
    await page.goto("about:blank");
    await page.goto("/#/paper-workspace");
    // The last setup is remembered, so Start is one tap away.
    await page.getByRole("button", { name: /Start Session/ }).click();
    const image = page.getByRole("img", { name: "Lock-in lofi" });
    await expect(image).toBeVisible();
    await expect(page.getByRole("img", { name: /cat asleep/ })).toHaveCount(0);
    expect(await image.evaluate((node) => [getComputedStyle(node).objectFit, getComputedStyle(node).objectPosition])).toEqual(["cover", "30% 70%"]);
    // The media always fills the player frame, whatever its shape.
    const [frame, box] = await Promise.all([page.locator(".paper-player").boundingBox(), image.boundingBox()]);
    expect(Math.abs(frame.width - box.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(frame.height - box.height)).toBeLessThanOrEqual(1);
    // Between 16:9 and 21:9, so a 16:9 source is at most trimmed top and bottom.
    expect(frame.width / frame.height).toBeGreaterThanOrEqual(16 / 9 - 0.02);
    expect(frame.width / frame.height).toBeLessThanOrEqual(21 / 9 + 0.02);
    // The player is the primary element: Status sits below it at the same width.
    const status = await page.locator(".paper-status").boundingBox();
    expect(status.y).toBeGreaterThan(frame.y + frame.height);
    expect(Math.abs(status.x - frame.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(status.width - frame.width)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath(`paper-media-${name}.png`) });
  }
});

/**
 * A stand-in for the YouTube embed that speaks the iframe API's postMessage
 * protocol: it reports time and duration once asked to listen, and applies the
 * play / seek / volume commands the control bar sends. Every command is kept on
 * `window.__commands` so the test can read what was asked for.
 */
const FAKE_YOUTUBE_PLAYER = `<!doctype html><html><body style="margin:0;background:#111"><script>
  let time = 100, state = 2, volume = 100, muted = false;
  const duration = 300;
  window.__commands = [];
  const report = () => parent.postMessage(JSON.stringify({ event: "infoDelivery", info: { currentTime: time, duration, playerState: state, volume, muted } }), "*");
  window.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.event === "listening") { report(); return; }
    if (message.event !== "command") return;
    window.__commands.push({ func: message.func, args: message.args });
    if (message.func === "seekTo") time = message.args[0];
    if (message.func === "playVideo") state = 1;
    if (message.func === "pauseVideo") state = 2;
    if (message.func === "setVolume") volume = message.args[0];
    if (message.func === "mute") muted = true;
    if (message.func === "unMute") muted = false;
    report();
  });
</script></body></html>`;

async function startSession(page) {
  await page.addInitScript(() => window.localStorage.setItem("lock-in.paper-workspace.setup", JSON.stringify({ subjectSlug: "paper-e2e-oral-histology", sheetId: "5b0e2f7a-9d4c-4a51-8f11-2a7c0e3b9a10", difficulty: "medium" })));
  await page.goto("/#/paper-workspace");
  await page.getByRole("button", { name: /Start Session/ }).click();
  await expect(page.getByRole("timer")).toBeVisible();
}

test("the player has one control bar: ±10 s, a scrubbable timeline, and controls that fade and return", async ({ page }, testInfo) => {
  await mockStudent(page, createServer());
  await page.route("https://www.youtube-nocookie.com/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: FAKE_YOUTUBE_PLAYER }));
  await page.setViewportSize({ width: 1440, height: 900 });
  await startSession(page);

  const player = page.locator(".paper-player");
  const bar = page.getByRole("group", { name: "Video controls" });
  // No "Lock-in lofi" title and no separate Stop / Fullscreen buttons above the scene.
  await expect(page.locator(".paper-now, .paper-player-controls")).toHaveCount(0);
  await expect(player.getByText("Lock-in lofi")).toHaveCount(0);
  await expect(bar.getByRole("button", { name: "Pause" })).toBeVisible();
  await expect(bar.getByRole("button", { name: "Fullscreen" })).toBeVisible();

  await page.getByRole("searchbox", { name: "Search YouTube" }).fill("https://youtu.be/dQw4w9WgXcQ");
  await page.getByRole("button", { name: "Play this video" }).click();
  const frame = page.locator("iframe.paper-player-frame");
  await expect(frame).toHaveAttribute("src", /enablejsapi=1/);
  await expect(frame).toHaveAttribute("src", /controls=0/);
  await expect(frame).not.toHaveAttribute("src", /mute=1/);
  const seek = bar.getByRole("slider", { name: "Playback position" });
  await expect(seek).toHaveAttribute("aria-valuetext", "1:40 / 5:00");

  await player.hover();
  await bar.getByRole("button", { name: "Forward 10 seconds" }).click();
  await expect(seek).toHaveAttribute("aria-valuetext", "1:50 / 5:00");
  await bar.getByRole("button", { name: "Back 10 seconds" }).click();
  await bar.getByRole("button", { name: "Back 10 seconds" }).click();
  await expect(seek).toHaveAttribute("aria-valuetext", "1:30 / 5:00");

  // Dragging the timeline seeks there.
  const box = await seek.boundingBox();
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => Number(await seek.inputValue())).toBeGreaterThan(130);
  await expect.poll(async () => Number(await seek.inputValue())).toBeLessThan(170);

  const commands = await page.frames().find((item) => item.url().includes("youtube-nocookie"))?.evaluate(() => window.__commands);
  expect(commands).toContainEqual({ func: "seekTo", args: [110, true] });
  expect(commands).toContainEqual({ func: "seekTo", args: [90, true] });
  expect(commands.filter((item) => item.func === "mute")).toHaveLength(0);

  // Quiet for a few seconds: the controls fade to almost nothing...
  await page.mouse.move(box.x + box.width * 0.5, box.y - 160);
  await expect(player).toHaveClass(/is-idle/, { timeout: 6000 });
  await expect.poll(() => bar.evaluate((node) => Number(getComputedStyle(node).opacity))).toBeLessThan(0.12);
  await page.screenshot({ path: testInfo.outputPath("paper-controls-faded.png") });
  // ...and come straight back on the next pointer movement.
  await page.mouse.move(box.x + box.width * 0.5, box.y - 120);
  await expect(player).not.toHaveClass(/is-idle/);
  await expect.poll(() => bar.evaluate((node) => Number(getComputedStyle(node).opacity))).toBeGreaterThan(0.95);
  await page.screenshot({ path: testInfo.outputPath("paper-controls-visible.png") });
});

test("a checkpoint cannot be closed by accident: Exit & Save resumes, Exit Without Saving and Restart clear only the attempt", async ({ page }, testInfo) => {
  const server = createServer();
  await mockStudent(page, server);
  await page.setViewportSize({ width: 1280, height: 860 });
  await startSession(page);
  const status = page.locator(".paper-status");
  await expect(status.getByText("Part 1 of 2")).toBeVisible();

  // Answer question 1, then try to close: the student is asked first.
  await page.getByRole("button", { name: /Checkpoint/ }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: /Tight junction/ }).click();
  await expect(dialog.getByRole("button", { name: "Explanation" })).toBeVisible();
  await dialog.getByRole("button", { name: "Close" }).click();
  const exit = page.getByRole("alertdialog", { name: "Leave this checkpoint?" });
  await expect(exit).toBeVisible();
  await expect(exit.getByRole("button")).toHaveText(["Cancel", "Exit Without Saving", "Exit & Save"]);
  await page.screenshot({ path: testInfo.outputPath("paper-checkpoint-exit.png") });

  // Cancel stays inside the checkpoint; Escape asks again instead of closing.
  await exit.getByRole("button", { name: "Cancel" }).click();
  await expect(exit).toHaveCount(0);
  await expect(dialog.getByRole("heading", { name: QUESTIONS[0].question })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(exit).toBeVisible();

  // Exit & Save keeps the answer; reopening resumes at question 2.
  await exit.getByRole("button", { name: "Exit & Save" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(server.calls.filter((call) => call.endsWith("/discard-attempt"))).toHaveLength(0);
  await page.getByRole("button", { name: /Checkpoint/ }).click();
  await expect(dialog.getByRole("heading", { name: QUESTIONS[1].question })).toBeVisible();
  await expect(dialog.locator(".paper-quiz-count")).toHaveText(/2 of 2$/);

  // Restart asks, then clears the attempt and starts again at question 1.
  await dialog.getByRole("button", { name: "Restart" }).click();
  const restart = page.getByRole("alertdialog", { name: "Restart this checkpoint?" });
  await restart.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog.locator(".paper-quiz-count")).toHaveText(/2 of 2$/);
  await dialog.getByRole("button", { name: "Restart" }).click();
  await restart.getByRole("button", { name: "Restart" }).click();
  await expect(dialog.getByRole("heading", { name: QUESTIONS[0].question })).toBeVisible();
  await expect(dialog.locator(".paper-quiz-count")).toHaveText(/1 of 2$/);
  await expect(dialog.getByRole("button", { name: /Tight junction/ })).toBeEnabled();
  expect(server.calls.filter((call) => call.endsWith("/discard-attempt"))).toHaveLength(1);

  // The browser's Back is caught as an exit attempt, not a navigation.
  await dialog.getByRole("button", { name: /Gap junction/ }).click();
  const url = page.url();
  await page.goBack();
  await expect(exit).toBeVisible();
  expect(page.url()).toBe(url);
  await expect(page.getByRole("dialog")).toBeVisible();

  // Exit Without Saving discards only this attempt; the part is untouched.
  await exit.getByRole("button", { name: "Exit Without Saving" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(server.calls.filter((call) => call.endsWith("/discard-attempt"))).toHaveLength(2);
  expect(server.answers()).toEqual({});
  await expect(status.getByText("Part 1 of 2")).toBeVisible();
  await page.getByRole("button", { name: /Checkpoint/ }).click();
  await expect(dialog.locator(".paper-quiz-count")).toHaveText(/1 of 2$/);
  await expect(dialog.getByRole("button", { name: /Gap junction/ })).toBeEnabled();
});

test("YouTube search lists results under the search bar and plays the chosen video inside Lock-in", async ({ page }, testInfo) => {
  const youtube = youTubeSearch(() => ({ body: { results: YOUTUBE_RESULTS }, delay: 500 }));
  await mockStudent(page, createServer(), {}, null, youtube);
  const popups = [];
  page.context().on("page", (opened) => popups.push(opened.url()));
  await page.setViewportSize({ width: 1440, height: 900 });
  await startSession(page);

  const search = page.getByRole("searchbox", { name: "Search YouTube" });
  await search.fill("oral histology");
  // Typing alone costs no quota: the search runs on Enter.
  await expect(page.getByRole("button", { name: /Search YouTube for “oral histology”/ })).toBeVisible();
  expect(youtube.queries).toEqual([]);
  await search.press("Enter");
  await expect(page.locator(".paper-results").getByRole("status")).toHaveText(/Searching YouTube/);
  const results = page.getByRole("list", { name: "YouTube results" }).getByRole("button");
  await expect(results).toHaveCount(6);
  expect(youtube.queries).toEqual(["oral histology"]);
  await expect(results.first()).toContainText("Dental Lectures");
  await expect(results.first().locator("img")).toHaveAttribute("src", "https://i.ytimg.com/vi/lockin000yt/mqdefault.jpg");

  // Directly below the search bar, at its width.
  const [box, panel] = await Promise.all([page.locator(".paper-search-box").boundingBox(), page.locator(".paper-results").boundingBox()]);
  expect(panel.y).toBeGreaterThanOrEqual(box.y + box.height);
  expect(panel.y - (box.y + box.height)).toBeLessThanOrEqual(12);
  expect(Math.abs(panel.x - box.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(panel.width - box.width)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath("paper-search-results.png") });

  // The keyboard reaches the results from the box.
  await search.press("ArrowDown");
  await expect(results.first()).toBeFocused();

  // Choosing one closes the results and plays it in the existing player.
  await results.nth(1).click();
  await expect(page.locator(".paper-results")).toHaveCount(0);
  await expect(search).toHaveValue("");
  const frame = page.locator("iframe.paper-player-frame");
  await expect(frame).toHaveAttribute("src", /^https:\/\/www\.youtube-nocookie\.com\/embed\/lockin001yt\?/);
  await expect(page.getByRole("img", { name: /cat asleep/ })).toHaveCount(0);
  expect(popups).toEqual([]);
  expect(page.url()).toContain("#/paper-workspace");
  await page.screenshot({ path: testInfo.outputPath("paper-search-playing.png") });

  // One tap back to the default lofi.
  await page.locator(".paper-player").hover();
  await page.getByRole("button", { name: "Back to lofi" }).click();
  await expect(frame).toHaveCount(0);
  await expect(page.getByRole("img", { name: /cat asleep/ })).toBeVisible();
});

test("an empty or refused YouTube search says so and suggests a link", async ({ page }) => {
  const youtube = youTubeSearch((query) => {
    if (query === "busy") return { status: 503, body: { error: { code: "youtube_quota_exceeded", message: "busy" } } };
    if (query === "down") return { status: 503, body: { error: { code: "youtube_search_unavailable", message: "off" } } };
    return { body: { results: [] } };
  });
  await mockStudent(page, createServer(), {}, null, youtube);
  await page.setViewportSize({ width: 1180, height: 820 });
  await startSession(page);
  const search = page.getByRole("searchbox", { name: "Search YouTube" });
  await search.fill("zzzz nothing");
  await search.press("Enter");
  await expect(page.locator(".paper-results")).toContainText("No videos found");
  await search.fill("busy");
  await search.press("Enter");
  await expect(page.locator(".paper-results").getByRole("alert")).toHaveText(/busy right now.*paste a video link/i);
  await search.fill("down");
  await search.press("Enter");
  await expect(page.locator(".paper-results").getByRole("alert")).toHaveText(/isn’t available right now\. Paste a video link/);
  // A pasted link still plays with no search at all.
  await search.fill("https://youtu.be/dQw4w9WgXcQ");
  await page.getByRole("button", { name: "Play this video" }).click();
  await expect(page.locator("iframe.paper-player-frame")).toHaveAttribute("src", /embed\/dQw4w9WgXcQ\?/);
  expect(youtube.queries).toEqual(["zzzz nothing", "busy", "down"]);
});

test("the default lofi plays its own soundtrack, with volume and mute, and yields to a video", async ({ page }) => {
  // Records the real-time contexts and the looping soundtrack they play.
  await page.addInitScript(() => {
    const contexts = [];
    const loops = [];
    window.__lofi = { contexts, loops };
    const Native = window.AudioContext;
    window.AudioContext = class extends Native {
      constructor(...args) { super(...args); contexts.push(this); }
    };
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) {
      if (this.context instanceof Native && this.buffer) {
        let peak = 0;
        const data = this.buffer.getChannelData(0);
        for (let index = 0; index < data.length; index += 7) peak = Math.max(peak, Math.abs(data[index]));
        loops.push({ duration: this.buffer.duration, loop: this.loop, peak });
      }
      return start.apply(this, args);
    };
  });
  await mockStudent(page, createServer());
  await page.setViewportSize({ width: 1440, height: 900 });
  await startSession(page);

  const bar = page.getByRole("group", { name: "Video controls" });
  // The bar fades after a few quiet seconds by design; a pointer move brings it back.
  let nudge = 0;
  const wake = async () => {
    const box = await page.locator(".paper-player").boundingBox();
    nudge = (nudge + 1) % 5;
    await page.mouse.move(box.x + box.width / 2 + nudge * 8, box.y + box.height / 3);
  };
  await wake();
  await expect(bar.getByRole("button", { name: "Mute" })).toBeVisible();
  await expect(bar.getByRole("slider", { name: "Volume" })).toBeVisible();
  // A real, audible, seamless loop is playing.
  await expect.poll(() => page.evaluate(() => window.__lofi.loops.length)).toBe(1);
  const loop = await page.evaluate(() => window.__lofi.loops[0]);
  expect(loop.loop).toBe(true);
  expect(loop.duration).toBeGreaterThan(20);
  expect(loop.peak).toBeGreaterThan(0.05);
  expect(loop.peak).toBeLessThan(1);
  await expect.poll(() => page.evaluate(() => window.__lofi.contexts[0]?.state)).toBe("running");

  await wake();
  await bar.getByRole("button", { name: "Mute" }).click();
  await expect(bar.getByRole("button", { name: "Unmute" })).toBeVisible();
  await wake();
  await bar.getByRole("button", { name: "Unmute" }).click();

  // Pausing the scene pauses its sound.
  await wake();
  await bar.getByRole("button", { name: "Pause" }).click();
  await expect.poll(() => page.evaluate(() => window.__lofi.contexts[0].state)).toBe("suspended");
  await wake();
  await bar.getByRole("button", { name: "Play" }).click();
  await expect.poll(() => page.evaluate(() => window.__lofi.contexts[0].state)).toBe("running");

  // A YouTube video silences the lofi; returning brings it back.
  await page.getByRole("searchbox", { name: "Search YouTube" }).fill("https://youtu.be/dQw4w9WgXcQ");
  await page.getByRole("button", { name: "Play this video" }).click();
  await expect.poll(() => page.evaluate(() => window.__lofi.contexts[0].state)).toBe("suspended");
  await page.locator(".paper-player").hover();
  await page.getByRole("button", { name: "Back to lofi" }).click();
  await expect.poll(() => page.evaluate(() => window.__lofi.contexts[0].state)).toBe("running");
  expect(await page.evaluate(() => window.__lofi.contexts.length)).toBe(1);
});

test("search results fit iPad and an Arabic phone without horizontal scrolling", async ({ page }, testInfo) => {
  await mockStudent(page, createServer(), { preferred_language: "ar" });
  await page.addInitScript(() => window.localStorage.setItem("lock-in.locale", "ar"));
  await page.addInitScript(() => window.localStorage.setItem("lock-in.paper-workspace.setup", JSON.stringify({ subjectSlug: "paper-e2e-oral-histology", sheetId: "5b0e2f7a-9d4c-4a51-8f11-2a7c0e3b9a10", difficulty: "medium" })));
  for (const [width, height, name] of [[820, 1180, "ipad-portrait"], [390, 844, "phone"]]) {
    await page.setViewportSize({ width, height });
    await page.goto("about:blank");
    await page.goto("/#/paper-workspace");
    await page.getByRole("button", { name: /ابدأ الجلسة/ }).click();
    const search = page.getByRole("searchbox", { name: "ابحث في يوتيوب" });
    await search.fill("أنسجة الفم");
    await search.press("Enter");
    const results = page.getByRole("list", { name: "نتائج يوتيوب" }).getByRole("button");
    await expect(results).toHaveCount(6);
    // Thumbnails sit on the reading side in Arabic.
    const [row, thumb] = await Promise.all([results.first().boundingBox(), results.first().locator(".paper-result-video-thumb").boundingBox()]);
    expect(thumb.x + thumb.width).toBeGreaterThan(row.x + row.width - 20);
    const panel = await page.locator(".paper-results").boundingBox();
    expect(panel.x).toBeGreaterThanOrEqual(0);
    expect(panel.x + panel.width).toBeLessThanOrEqual(width);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await page.screenshot({ path: testInfo.outputPath(`paper-search-${name}-rtl.png`) });
    await results.first().click();
    await expect(page.locator("iframe.paper-player-frame")).toHaveAttribute("src", /embed\/lockin000yt\?/);
  }
});
