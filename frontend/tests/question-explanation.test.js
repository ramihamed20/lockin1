import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { translate } from "../src/lib/i18n.js";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("every question surface uses the one Explanation control", async () => {
  for (const path of ["../src/pages/PaperWorkspace.jsx", "../src/pages/CatalogFocusWorkspace.jsx", "../src/pages/Questions.jsx", "../src/pages/Review.jsx", "../src/pages/AssessmentResult.jsx"]) {
    assert.match(await read(path), /<QuestionExplanation /, path);
  }
  // Timed attempts keep explanations until the result is released.
  assert.doesNotMatch(await read("../src/pages/Attempt.jsx"), /<QuestionExplanation /);
});

test("the Explanation control and the exit dialog are translated", () => {
  assert.equal(translate("en", "question.explanation"), "Explanation");
  assert.equal(translate("ar", "question.explanation"), "الشرح");
  for (const key of ["checkpoint.exitSave", "checkpoint.exitDiscard", "checkpoint.restart", "media.back10", "media.forward10"]) {
    assert.notEqual(translate("ar", key), translate("en", key), key);
  }
  assert.equal(translate("en", "checkpoint.exitSave"), "Exit & Save");
  assert.equal(translate("en", "checkpoint.exitDiscard"), "Exit Without Saving");
});
