import assert from "node:assert/strict";
import test from "node:test";
import {
  assistanceForPage, assistanceScopeKey, companionPreferenceKey, companionPreferences,
  normalizeAssistanceIdea, savedAssistanceForRange, writingDuration, writingGraphemes
} from "../src/lib/studyAssistance.js";

const row = (changes = {}) => ({
  id: "3a078288-a226-47ec-a1aa-cea84eb2ea45", page: 2, kind: "understand",
  teaser: "Help with this point", question: "Why?", explanation: "Because.",
  followup_question: "Another question?", followup_answer: "Its solution.", saved: false,
  ...changes
});

test("saved ideas remain available on an empty page within the accessible range", () => {
  const rows = [row({ page: 2, saved: true }), row({ page: 5, saved: true }), row({ page: null, saved: true }), row({ page: 3, saved: false })];
  assert.deepEqual(savedAssistanceForRange(rows, 2, 3).map((item) => item.page), [2, null]);
  assert.deepEqual(savedAssistanceForRange(rows, 4, 4).map((item) => item.page), [null]);
  assert.deepEqual(savedAssistanceForRange([], 1, 10), []);
});

test("help is shown only on a real, accessible PDF page, with whole-sheet ideas included", () => {
  const rows = [row(), row({ page: null }), row({ page: 3 }), row({ page: -1 })];
  assert.deepEqual(assistanceForPage(rows, 2).map((x) => x.page), [2, null]);
  for (const page of [-1, 0, 2.5, NaN]) assert.deepEqual(assistanceForPage(rows, page), []);
  assert.deepEqual(assistanceForPage(rows, 2, 3, 7), []);
  assert.deepEqual(assistanceForPage(rows, 2, 1, 1), []);
});

test("incomplete or malformed server help is not rendered as a fake explanation", () => {
  assert.equal(normalizeAssistanceIdea(row({ followup_answer: "" })), null);
  assert.equal(normalizeAssistanceIdea(row({ page: "2" })), null);
  assert.equal(normalizeAssistanceIdea(row({ id: "../other" })), null);
  assert.equal(normalizeAssistanceIdea(row({ kind: "unknown" })), null);
  assert.equal(normalizeAssistanceIdea(row({ saved: "true" })).saved, false);
});

test("account, edition, view, version and page have independent in-memory identities", () => {
  const baseline = ["a", "document", "university", "study", "v1", 1];
  const original = assistanceScopeKey(...baseline);
  for (let i = 0; i < baseline.length; i++) {
    const changed = [...baseline]; changed[i] = "different";
    assert.notEqual(assistanceScopeKey(...changed), original);
  }
  assert.notEqual(companionPreferenceKey("a"), companionPreferenceKey("b"));
  assert.equal(companionPreferenceKey(""), "");
});

test("untrusted browser preferences contain only the permitted appearance choices", () => {
  assert.deepEqual(companionPreferences({ character: "admin", motion: "false", hidden: "true", token: "ignored" }), {
    character: "boy", motion: true, hidden: false
  });
  assert.deepEqual(companionPreferences({ character: "girl", motion: false, hidden: true }), {
    character: "girl", motion: false, hidden: true
  });
});

test("writing preserves Arabic combining marks and emoji as graphemes", () => {
  const value = "فَهْم 👩🏽‍⚕️";
  const chunks = writingGraphemes(value);
  assert.equal(chunks.join(""), value);
  assert.equal(chunks[0], "فَ");
  assert.equal(chunks.at(-1), "👩🏽‍⚕️");
  assert.ok(writingDuration(5000) <= 4800);
  assert.ok(writingDuration(1) >= 400);
});
