import assert from "node:assert/strict";
import test from "node:test";
import { acquireBodyScrollLock } from "../src/lib/bodyScrollLock.js";

function documentStub(overflow = "", touchAction = "") {
  return { body: { style: { overflow, touchAction } } };
}

test("nested overlay locks restore the original body styles only after the last owner closes", () => {
  const doc = documentStub("auto", "pan-y");
  const releaseMenu = acquireBodyScrollLock({ touchAction: "none" }, doc);
  const releaseDialog = acquireBodyScrollLock({}, doc);

  assert.deepEqual(doc.body.style, { overflow: "hidden", touchAction: "none" });
  releaseMenu();
  assert.deepEqual(doc.body.style, { overflow: "hidden", touchAction: "pan-y" });
  releaseDialog();
  assert.deepEqual(doc.body.style, { overflow: "auto", touchAction: "pan-y" });
  releaseDialog();
  assert.deepEqual(doc.body.style, { overflow: "auto", touchAction: "pan-y" });
});
