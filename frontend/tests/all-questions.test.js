import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import test from "node:test";

import { allQuestionsTotals, buildAllQuestionsPrompt, existingQuestionSets, normalizeSheetQuestionCount, parseAllQuestionsJson } from "../src/lib/allQuestionsPrompt.js";

const panel = await readFile(new URL("../src/pages/admin/AllQuestionsPanel.jsx", import.meta.url), "utf8");
const page = await readFile(new URL("../src/pages/AdminContentManagement.jsx", import.meta.url), "utf8");
const api = await readFile(new URL("../src/api/adminControl.js", import.meta.url), "utf8");

function ranges(bounds) {
  return bounds.map(([start, end], index) => ({ part: index + 1, start_page: start, end_page: end }));
}

function difficulty(key, bounds, existing = {}) {
  return {
    difficulty: key,
    label: key[0].toUpperCase() + key.slice(1),
    number_of_parts: bounds.length,
    page_ranges: ranges(bounds),
    questions_per_checkpoint: 15,
    final_exam_questions: 50,
    prompt_template_supported: true,
    existing: { revision: 0, checkpoint_question_count: 0, final_exam_question_count: 0, ...existing }
  };
}

/** The backend context for the example in the request: pages 2–18 of a 20-page PDF. */
function context(overrides = {}) {
  return {
    edition: "university",
    edition_label: "University Sheet",
    effective_start_page: 2,
    effective_end_page: 18,
    excluded_start_pages: 1,
    excluded_end_pages: 2,
    difficulties: [
      difficulty("easy", [[2, 7], [8, 16]]),
      difficulty("medium", [[2, 6], [7, 11], [12, 17]]),
      difficulty("hard", [[2, 5], [6, 9], [10, 16]])
    ],
    sheet_questions: { existing_count: 0, max_count: 200 },
    ...overrides
  };
}

test("the counts preview is calculated from the backend plan, not hardcoded", () => {
  const totals = allQuestionsTotals(context(), 30);
  assert.deepEqual(totals.difficulties.map((row) => [row.label, row.parts, row.partQuestions, row.finalExam, row.total]), [
    ["Easy", 2, 30, 50, 80],
    ["Medium", 3, 45, 50, 95],
    ["Hard", 3, 45, 50, 95]
  ]);
  assert.equal(totals.normal, 30);
  assert.equal(totals.total, 300);
  assert.equal(allQuestionsTotals(context(), 0).total, 270);
});

test("the Normal Questions count is a whole number the Question import accepts", () => {
  assert.equal(normalizeSheetQuestionCount("40"), 40);
  assert.equal(normalizeSheetQuestionCount(12.7), 12);
  assert.equal(normalizeSheetQuestionCount(-5), 0);
  assert.equal(normalizeSheetQuestionCount(900), 200);
  assert.equal(normalizeSheetQuestionCount(""), 0);
  assert.equal(normalizeSheetQuestionCount("abc"), 0);
});

test("one prompt lists every part, each difficulty's own Final Exam and the Normal Questions", () => {
  const prompt = buildAllQuestionsPrompt(context(), 30);
  for (const line of [
    "- Part 1: pages 2–7 — 15 questions",
    "- Part 2: pages 8–16 — 15 questions",
    "- Part 3: pages 12–17 — 15 questions",
    "- Part 3: pages 10–16 — 15 questions",
    "- Easy Final Exam — 50 questions (entire effective sheet, pages 2–18)",
    "- Medium Final Exam — 50 questions",
    "- Hard Final Exam — 50 questions",
    "- 30 questions (entire effective sheet, pages 2–18)",
    "Total: 300 questions",
    "Edition: University Sheet",
    "Effective pages: 2–18"
  ]) assert.ok(prompt.includes(line), line);
  for (const rule of [
    "Use only information contained in the supplied sheet.",
    "Do not invent facts that are not present in the sheet.",
    "Every question must contain exactly four options: A, B, C, D.",
    "Exactly one option must be correct.",
    "Include a concise explanation for every question.",
    "Avoid duplicate questions and avoid repeated wording.",
    "Return valid JSON only. Do not return Markdown.",
    "Easy: Focus on direct recall, recognition and basic understanding.",
    "Medium: Focus on understanding, interpretation and application.",
    "never introduce information outside the sheet",
    "Each Final Exam covers the entire effective sheet",
    "There is no shared Final Exam"
  ]) assert.ok(prompt.includes(rule), rule);
});

test("the prompt's JSON structure puts final_exam inside every difficulty, never at the root", () => {
  const prompt = buildAllQuestionsPrompt(context(), 30);
  const structure = JSON.parse(prompt.slice(prompt.indexOf("{\n  \"active_study\""), prompt.indexOf("\n\nBEFORE RETURNING")));
  assert.deepEqual(Object.keys(structure), ["active_study", "sheet_questions"]);
  assert.deepEqual(Object.keys(structure.active_study), ["easy", "medium", "hard"]);
  assert.equal(structure.active_study.final_exam, undefined);
  for (const key of ["easy", "medium", "hard"]) assert.deepEqual(structure.active_study[key].final_exam, { questions: [] });
  assert.deepEqual(structure.active_study.easy.parts.map((part) => [part.part, part.pages]), [[1, "2-7"], [2, "8-16"]]);
  assert.equal(structure.active_study.hard.parts.length, 3);
});

test("the prompt follows the edition and exclusions it was built for", () => {
  const lockin = buildAllQuestionsPrompt(context({ edition: "lockin", edition_label: "Lockin Sheet", effective_start_page: 1, effective_end_page: 20 }), 0);
  assert.match(lockin, /Edition: Lockin Sheet/);
  assert.match(lockin, /Effective pages: 1–20/);
  assert.match(lockin, /None requested\. Leave sheet_questions\.questions as an empty array\./);
  assert.throws(() => buildAllQuestionsPrompt({ ...context(), difficulties: context().difficulties.slice(0, 2) }, 10), /Easy, Medium and Hard/);
  assert.throws(() => buildAllQuestionsPrompt(null, 10), /has not loaded/);
});

test("existing sets are listed for the replacement warning; Normal Questions are reported apart", () => {
  const withExisting = context({
    difficulties: [
      difficulty("easy", [[2, 7], [8, 16]], { revision: 1, checkpoint_question_count: 30, final_exam_question_count: 50 }),
      difficulty("medium", [[2, 6]], { revision: 2, final_exam_question_count: 50 }),
      difficulty("hard", [[2, 5]])
    ],
    sheet_questions: { existing_count: 25, max_count: 200 }
  });
  const sets = existingQuestionSets(withExisting);
  assert.deepEqual(sets.replaced.map((item) => `${item.label} — ${item.count}`), ["Easy Parts — 30", "Easy Final Exam — 50", "Medium Final Exam — 50"]);
  assert.equal(sets.normalExisting, 25);
  assert.equal(sets.normalAllQuestions, 0);
  assert.equal(sets.normalOther, 25);
  const rerun = existingQuestionSets(context({ sheet_questions: { existing_count: 35, all_questions_count: 30, max_count: 200 } }));
  assert.deepEqual([rerun.normalAllQuestions, rerun.normalOther], [30, 5]);
  assert.deepEqual(existingQuestionSets(context()).replaced, []);
});

test("a large pasted document parses whole, and a Markdown fence is tolerated", () => {
  const question = (index) => ({ question: `Q${index}?`, options: { A: "a", B: "b", C: "c", D: "d" }, correct_answer: "A", explanation: "Because the sheet says so. ".repeat(60) });
  const big = { active_study: {}, sheet_questions: { questions: Array.from({ length: 200 }, (_, index) => question(index)) } };
  for (const key of ["easy", "medium", "hard"]) big.active_study[key] = { parts: Array.from({ length: 10 }, (_, part) => ({ part: part + 1, questions: Array.from({ length: 15 }, (_, index) => question(`${key}${part}-${index}`)) })), final_exam: { questions: Array.from({ length: 50 }, (_, index) => question(`${key}F${index}`)) } };
  const text = JSON.stringify(big, null, 2);
  assert.ok(text.length > 1_000_000);
  const started = performance.now();
  const parsed = parseAllQuestionsJson(text);
  assert.ok(performance.now() - started < 1000);
  assert.equal(parsed.active_study.hard.parts[9].questions.length, 15);
  assert.equal(parsed.sheet_questions.questions.length, 200);
  assert.deepEqual(parseAllQuestionsJson("```json\n{\"a\": 1}\n```"), { a: 1 });
  assert.throws(() => parseAllQuestionsJson("{ \"a\": 1, }"), /Invalid JSON syntax/);
  assert.throws(() => parseAllQuestionsJson("   "), /Paste the All Questions JSON/);
});

test("All Questions opens as its own sheet tab and keeps every existing tool", () => {
  assert.match(page, /\['all-questions', 'All Questions'\]/);
  assert.match(page, /manageTab === "all-questions" && <section className="admin-control-section" aria-label="All Questions">/);
  assert.match(page, /<AllQuestionsPanel sheet=\{sheet\} canManageQuestions=\{canManageQuestions\} onSaved=\{onChanged\} \/>/);
  assert.match(page, /canManageQuestions=\{hasOperationalCapability\(operationsSession, "assessments\.manage"\)\}/);
  // The individual workflows are untouched.
  assert.match(page, /function ActiveStudyCopyPromptButton/);
  assert.match(page, /function ActiveStudyJsonEditor/);
  assert.match(page, /function QuestionImporter/);
  assert.match(page, /Copy JSON Prompt/);
});

test("All Questions talks to the backend orchestration endpoints with the chosen edition", () => {
  assert.match(api, /allQuestionsContext\(sheetId, edition = "", exclusions = \{\}\)/);
  assert.match(api, /\/all-questions` \+ buildQueryString\(\{ edition, excluded_start_pages: exclusions\.excluded_start_pages, excluded_end_pages: exclusions\.excluded_end_pages \}\)/);
  assert.match(api, /\/all-questions\/validate` \+ buildQueryString\(\{ edition \}\), \{ method: "POST", body, timeoutMs: 120_000 \}/);
  assert.match(api, /\/all-questions` \+ buildQueryString\(\{ edition \}\), \{ method: "PUT", body, timeoutMs: 180_000 \}/);
  assert.match(panel, /adminControlApi\.allQuestionsContext\(sheet\.id, edition, \{ excluded_start_pages: start, excluded_end_pages: end \}\)/);
  assert.match(panel, /adminControlApi\.validateAllQuestions\(sheet\.id, \{ payload, sheet_question_count: normal, \.\.\.boundaries\(\) \}, edition\)/);
});

test("switching edition reloads its own saved exclusions and discards the old validation", () => {
  assert.match(panel, /function changeEdition\(next\) \{\s*setEdition\(next\); setExclusions\(null\); setResult\(null\);/);
  assert.match(panel, /const ctx = context\.data\?\.edition === edition \? context\.data : null;/);
  assert.match(panel, /disabled=\{!available\}/);
  assert.match(panel, /ctx\.shared_question_bank &&/);
});

test("exclusion controls reuse the Active Study field and drive the backend plan", () => {
  assert.match(panel, /import \{ ExclusionField \} from "\.\/ExclusionField\.jsx";/);
  assert.match(panel, /label="First pages to exclude"/);
  assert.match(panel, /label="Last pages to exclude"/);
  assert.match(panel, /Effective pages \{ctx\.effective_start_page\}–\{ctx\.effective_end_page\}/);
  assert.match(panel, /ctx\.exclusions_changed &&/);
  // Copy and Validate wait until the plan on screen matches what was typed.
  assert.match(panel, /const settled = Boolean\(ctx\) && requested === typed && !context\.loading && !context\.refreshing;/);
  assert.match(panel, /disabled=\{!settled \|\| !prompt\} onClick=\{copy\}>.*Copy All Questions Prompt/);
});

test("the JSON box stays uncontrolled so a large paste does not re-render per keystroke", () => {
  assert.match(panel, /<textarea ref=\{textRef\} spellCheck="false"[^>]*defaultValue=""/);
  assert.doesNotMatch(panel, /<textarea ref=\{textRef\}[^>]*\svalue=\{/);
  assert.match(panel, /parseAllQuestionsJson\(textRef\.current\?\.value\)/);
});

test("validation shows per-part counts, a total, and each error with its location and JSON path", () => {
  assert.match(panel, /Part \{part\.part\} — \{part\.received\}\/\{part\.expected\}/);
  assert.match(panel, /Final Exam — \{row\.final_exam\.received\}\/\{row\.final_exam\.expected\}/);
  assert.match(panel, /Total: \{summary\.total_received\} \/ \{summary\.total_expected\} Questions/);
  assert.match(panel, /<strong>\{item\.section\}<\/strong><span>\{item\.message\}<\/span><code>\{item\.path\}<\/code>/);
  assert.match(panel, /Nothing has been saved\./);
  // A failed validation still carries its summary in the error body.
  assert.match(panel, /if \(requestError\?\.payload\?\.summary\) setResult\(\{ token, body: requestError\.payload, payload: null \}\);/);
});

test("Save is only offered for the exact JSON and choices that validated, after the replacement warning", () => {
  assert.match(panel, /const token = ctx \? \[textVersion, edition, ctx\.excluded_start_pages, ctx\.excluded_end_pages, normal\]\.join\("\|"\) : "";/);
  assert.match(panel, /\{body\.valid && !stale && <>/);
  assert.match(panel, /Existing question sets found:/);
  assert.match(panel, /Saving will replace these question sets\./);
  assert.match(panel, /Existing All Questions batch: \{existing\.normalAllQuestions\} questions/);
  assert.match(panel, /Will be replaced with: \{normal\} questions/);
  assert.match(panel, /other Normal Questions \(manual imports\) stay unchanged/);
  assert.match(panel, /Save All Questions/);
  assert.match(panel, /expected_revisions: Object\.fromEntries\(ctx\.difficulties\.map\(\(row\) => \[row\.difficulty, row\.existing\.revision\]\)\)/);
  assert.match(panel, /settings_revision: ctx\.settings_revision/);
});

test("a successful save reports it and cannot be repeated by a second click", () => {
  assert.match(panel, /A second click must not import the Normal Questions twice\.\s*setResult\(null\);/);
  assert.match(panel, /All Questions saved: \$\{saved\.summary\.total_received\} questions/);
  assert.match(panel, /context\.reload\(\);\s*onSaved\(\);/);
});
