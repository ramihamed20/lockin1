import assert from "node:assert/strict";
import test from "node:test";
import { companionNudge, companionNudgeCopy } from "../src/lib/companionTips.js";

test("quick coaching remains generic, bilingual and deterministic", () => {
  const firstEn = companionNudge("en", 0);
  const firstAr = companionNudge("ar", 0);
  assert.match(firstEn, /Read two important lines/);
  assert.match(firstAr, /اقرأ سطرين/);
  assert.equal(companionNudge("en", 5), firstEn);
  assert.equal(companionNudge("ar", -1), firstAr);
  assert.equal(companionNudge("invalid", 0), firstEn);
  assert.match(companionNudgeCopy.ar.source, /ليست شرحًا/);
  assert.match(companionNudgeCopy.en.source, /General study tip/);
  for (const locale of ["ar", "en"]) {
    for (let index = 0; index < 10; index++) {
      assert.ok(companionNudge(locale, index).length > 20);
      assert.ok(companionNudge(locale, index).length < 240);
    }
  }
});
