import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildFillInList, foldAnswer, parseAdminDetail, parseAnswersJson, parseDirectory, parseFillInList, parseSet } from "../src/api/practice.js";

const ID = "0f8c2f1e-6a7b-4c1d-9e2f-3a4b5c6d7e8f";
const OTHER = "1a8c2f1e-6a7b-4c1d-9e2f-3a4b5c6d7e8f";

const [questions, i18n, admin, panel, player] = await Promise.all([
  readFile(new URL("../src/pages/Questions.jsx", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/i18n.js", import.meta.url), "utf8"),
  readFile(new URL("../src/pages/AdminContentManagement.jsx", import.meta.url), "utf8"),
  readFile(new URL("../src/pages/admin/PracticePanel.jsx", import.meta.url), "utf8"),
  readFile(new URL("../src/components/learning/PracticeQuestions.jsx", import.meta.url), "utf8")
]);

test("only letter case and spaces are folded away", () => {
  assert.equal(foldAnswer("  Femur  "), foldAnswer("FEMUR"));
  assert.equal(foldAnswer("Temporal Bone"), foldAnswer("temporalbone"));
  assert.notEqual(foldAnswer("Femur"), foldAnswer("Femor"));
  assert.notEqual(foldAnswer("Cafe"), foldAnswer("Café"));
  assert.notEqual(foldAnswer("Os-coxae"), foldAnswer("Os coxae"));
});

test("a slide image is accepted only from a same-origin managed-file view", () => {
  const set = parseSet({
    id: ID, title: "Skull", subject: { slug: "anatomy", title: "Anatomy" },
    slides: [
      { id: ID, position: 1, image_url: `/api/v1/files/${ID}/view` },
      { id: OTHER, position: 2, image_url: "https://evil.example/x.png" },
      { id: "nope", position: 3, image_url: `/api/v1/files/${ID}/view` }
    ]
  });
  assert.deepEqual(set?.slides.map((slide) => slide.id), [ID]);
  assert.equal(parseSet({ id: "bad" }), null);
});

test("the student payload never carries an answer", () => {
  const set = parseSet({ id: ID, title: "Skull", subject: {}, slides: [{ id: ID, position: 1, image_url: `/api/v1/files/${ID}/view`, answer: "Femur" }] });
  assert.equal("answer" in set.slides[0], false);
});

test("the directory keeps only subjects that have sets", () => {
  const directory = parseDirectory({ results: [
    { slug: "anatomy", title: "Anatomy", slideCount: 4, sets: [{ id: ID, title: "Skull", slideCount: 4 }] },
    { slug: "empty", title: "Empty", slideCount: 0, sets: [] }
  ] });
  assert.deepEqual(directory.map((subject) => subject.slug), ["anatomy"]);
});

test("an admin reply is read into one tidy shape", () => {
  const detail = parseAdminDetail({
    set: { id: ID, title: "Skull", is_published: false, slide_count: 2, answered_count: 1 },
    subject: { id: OTHER, title: "Anatomy" },
    slides: [{ id: ID, position: 1, answer: "Femur", image_url: `/api/v1/files/${ID}/view`, file_name: "1.png" }],
    limits: { max_slides: 200 },
    rejected: [{ name: "x.gif", message: "Unsupported" }],
    added: 1
  });
  assert.equal(detail.set.answeredCount, 1);
  assert.equal(detail.maxSlides, 200);
  assert.deepEqual(detail.rejected, [{ name: "x.gif", message: "Unsupported" }]);
  assert.throws(() => parseAdminDetail({}));
});

test("a pasted answers list is read in order", () => {
  assert.deepEqual(parseAnswersJson('{"answers": ["Femur", "Tibia"]}'), { answers: ["Femur", "Tibia"] });
  assert.deepEqual(parseAnswersJson('["A", "B"]'), { answers: ["A", "B"] });
  assert.deepEqual(parseAnswersJson('```json\n{"answers":[{"answer":"A"},"B"]}\n```'), { answers: ["A", "B"] });
  assert.deepEqual(parseAnswersJson('{"answers": ["A", "", "C"]}'), { answers: ["A", "", "C"] });
  assert.deepEqual(parseAnswersJson(""), { error: "empty" });
  assert.deepEqual(parseAnswersJson("{oops"), { error: "syntax" });
  assert.deepEqual(parseAnswersJson('{"names": []}'), { error: "shape" });
  assert.deepEqual(parseAnswersJson('{"answers": [1]}'), { error: "item" });
});

test("the prompt asks for exactly one name per slide, in order", () => {
  assert.match(panel, /export function buildPracticePrompt\(count\)/);
  assert.match(panel, /in the same order, give the one exact name/);
  assert.match(panel, /exactly \$\{count\} string/);
  assert.match(panel, /\{\\"answers\\": \[/);
});

test("the player checks on the server and never preloads answers", () => {
  assert.match(player, /practiceApi\.check/);
  assert.doesNotMatch(player, /slide\.answer|\.expected\s*===/);
});

test("Practice is open in the Questions directory and routed to the typing player", () => {
  assert.match(questions, /id: "practice"[^}]*available: true/);
  assert.match(questions, /categoryId === "practice"\) return <PracticeCategory/);
  assert.match(questions, /categoryId === "practice"\) return <PracticeSubject/);
  assert.match(questions, /categoryId === "practice"\) return <PracticePlayerPage/);
});

test("the admin has a Practice area behind the content permission", () => {
  assert.match(admin, /\["practice", "Practice", "content\.view", "brain"\]/);
  assert.match(admin, /<PracticeSetEditor key=\{setId\}/);
});

test("every practice string exists in English and Arabic", () => {
  const keys = [...player.matchAll(/t\("(practice\.[A-Za-z]+)"/g)].map((match) => match[1]);
  assert.ok(keys.length > 10);
  for (const key of new Set(keys)) {
    const count = i18n.split(`"${key}"`).length - 1;
    const plural = i18n.split(`"${key}.`).length - 1;
    assert.ok(count >= 2 || plural >= 2, `${key} is missing a translation`);
  }
});

const SLIDE = { id: ID, position: 1, image_url: `/api/v1/files/${ID}/view` };

test("a mark is accepted only when it lies on the picture with a known shape", () => {
  const slides = parseSet({
    id: ID, title: "Skull", subject: {},
    slides: [
      { ...SLIDE, hotspot: { x: 0.25, y: 0.5, shape: "arrow" }, state: "missed" },
      { ...SLIDE, id: OTHER, hotspot: { x: 1.4, y: 0.5, shape: "circle" } },
      { ...SLIDE, id: "2a8c2f1e-6a7b-4c1d-9e2f-3a4b5c6d7e8f", hotspot: { x: 0.5, y: 0.5, shape: "star" }, state: "bogus" }
    ]
  }).slides;
  assert.deepEqual(slides[0].hotspot, { x: 0.25, y: 0.5, shape: "arrow" });
  assert.equal(slides[0].state, "missed");
  assert.equal(slides[1].hotspot, null);
  assert.equal(slides[2].hotspot, null);
  assert.equal(slides[2].state, "new");
});

test("a set carries its review stats and most-missed slides", () => {
  const set = parseSet({
    id: ID, title: "Skull", subject: {}, preview: true, slides: [SLIDE],
    stats: { total: 4, new: 1, missed: 1, due: 1, learned: 1, review: 2, last_practiced_at: "2026-10-08T10:00:00Z" },
    most_missed: [
      { id: ID, position: 1, image_url: `/api/v1/files/${ID}/view`, expected: "Femur", misses: 3 },
      { id: OTHER, position: 2, image_url: "https://evil.example/x.png", expected: "Tibia", misses: 2 }
    ]
  });
  assert.equal(set.preview, true);
  assert.deepEqual(set.stats, { total: 4, newCount: 1, missed: 1, due: 1, learned: 1, review: 2, lastPracticedAt: "2026-10-08T10:00:00Z" });
  assert.deepEqual(set.mostMissed.map((item) => [item.expected, item.misses]), [["Femur", 3]]);
  assert.equal(parseSet({ id: ID, title: "x", subject: {}, slides: [] }).stats.review, 0);
});

test("directory sets keep their review counts", () => {
  const [subject] = parseDirectory({ results: [{ slug: "anatomy", title: "Anatomy", slideCount: 4, sets: [{ id: ID, title: "Skull", slideCount: 4, stats: { total: 4, review: 2 } }] }] });
  assert.equal(subject.sets[0].stats.review, 2);
});

test("an admin slide and subject carry the mark and the preview slug", () => {
  const detail = parseAdminDetail({
    set: { id: ID, title: "Skull", is_published: true, slide_count: 1, answered_count: 1 },
    subject: { id: OTHER, title: "Anatomy", slug: "anatomy" },
    slides: [{ ...SLIDE, answer: "Femur", hotspot: { x: 0.1, y: 0.9, shape: "circle" } }]
  });
  assert.equal(detail.subject.slug, "anatomy");
  assert.deepEqual(detail.slides[0].hotspot, { x: 0.1, y: 0.9, shape: "circle" });
});

test("the player keeps grading, hints and XP on the server and offers review and shuffle", () => {
  assert.match(player, /practiceApi\.hint/);
  assert.match(player, /verdict\.xpAwarded/);
  assert.match(player, /reviewQueue\(set\.slides\)/);
  assert.match(player, /shuffled\(base\)/);
  assert.match(player, /<PracticeMark mark=\{mark\} \/>/);
  assert.match(player, /result\.nearMiss|nearMiss/);
  assert.match(player, /try \{ return window\.localStorage/);
});

test("the admin editor can mark, replace, move to a position, duplicate and preview", () => {
  for (const call of ["setHotspot", "replaceImage", "moveSlide", "duplicate"]) assert.match(panel, new RegExp(`adminPracticeApi\.${call}`));
  assert.match(panel, /Preview as student/);
  assert.match(panel, /\/#\/questions\/categories\/practice\/subjects\//);
});

test("every new practice string exists in English and Arabic", () => {
  const keys = [
    "playAgain", "startLabel", "start", "preview", "modeLabel", "modeAll", "modeReview", "reviewEmpty", "shuffle", "xpNote",
    "stat.learned", "stat.due", "stat.missed", "stat.new", "lastPracticed", "neverPracticed", "mostMissedLabel", "missCount",
    "tileReview", "slideAltMarked", "shape.circle", "shape.arrow", "hint", "hintCost", "hintLetter", "hintFailed", "nearMiss",
    "nearMissText", "xpGain", "xpHinted", "setBonus", "xpEarned", "hintsUsed"
  ];
  for (const key of keys) {
    const occurrences = i18n.split(`"practice.${key}"`).length - 1;
    assert.equal(occurrences, 2, `practice.${key} must be defined once in English and once in Arabic`);
  }
});

const FILES = [{ fileName: "Image1.png" }, { fileName: "Image2.jpg" }, { fileName: "Image10.webp" }, { fileName: "skull-3.png" }];

test("the fill-in list has one line per slide, named after its file", () => {
  assert.equal(buildFillInList(FILES), "Image1 - (name)\nImage2 - (name)\nImage10 - (name)\nskull-3 - (name)");
  assert.equal(buildFillInList([{ fileName: "Image1.png", answer: "Femur" }]), "Image1 - Femur");
});

test("a completed list is matched by file name, in any order, and Image1 never swallows Image10", () => {
  const read = parseFillInList("Image10 - Temporal bone\nimage1: Femur\nImage2 – Tibia\nskull-3 - (name)", FILES);
  assert.deepEqual(read.answers, ["Femur", "Tibia", "Temporal bone", ""]);
  assert.equal(read.matched, 4);
  assert.deepEqual(read.unmatched, []);
});

test("lines without a slide name are reported and a list with none is refused", () => {
  const read = parseFillInList("Image1 - Femur\nsomething else\nImage1 - again", FILES);
  assert.deepEqual(read.answers, ["Femur", "", "", ""]);
  assert.deepEqual(read.unmatched, ["something else", "Image1 - again"]);
  assert.deepEqual(parseFillInList("hello\nworld", FILES), { error: "nolines" });
  assert.deepEqual(parseFillInList("  \n ", FILES), { error: "empty" });
});

test("the editor takes a ZIP through the same drop zone and pastes the list back", () => {
  assert.match(panel, /adminPracticeApi\.addArchive/);
  assert.match(panel, /buildFillInList\(slides\)/);
  assert.match(panel, /parseFillInList\(text, slides\)/);
});
