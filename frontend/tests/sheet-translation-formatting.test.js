import test from "node:test";
import assert from "node:assert/strict";
import { tokenizeTranslationText } from "../src/workspace/catalog/translationFormatting.js";

test("emphasizes important sentences and keeps technical vocabulary in English", () => {
  const result = tokenizeTranslationText("==يحمي Enamel سطح السن.== **مهم:** Dentin يقع أسفل Enamel.");
  assert.equal(result[0].kind, "highlight");
  assert.ok(result[0].fragments.some((part) => part.kind === "term" && part.text === "Enamel"));
  assert.equal(result[1].kind, "text");
  assert.equal(result[2].kind, "emphasis");
  assert.ok(result.some((segment) => segment.fragments.some((part) => part.text === "Dentin" && part.kind === "term")));
});

test("treats incoming HTML as literal text and tolerates unmatched markup", () => {
  const result = tokenizeTranslationText("<img src=x onerror=alert(1)> ==نص غير مكتمل");
  assert.equal(result.length, 1);
  assert.equal(result[0].kind, "text");
  assert.equal(result[0].fragments.map((part) => part.text).join(""), "<img src=x onerror=alert(1)> ==نص غير مكتمل");
});

test("works for legacy plain Arabic translations and null values", () => {
  assert.deepEqual(tokenizeTranslationText(null), []);
  const result = tokenizeTranslationText("الطبقة الخارجية Enamel ثم Dentin");
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].fragments.filter((part) => part.kind === "term").map((part) => part.text), ["Enamel", "Dentin"]);
});
