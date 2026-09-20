import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { isStudioRoute, studioSearchResults } from "../src/lib/studioAreas.js";

const admin = { capabilities: ["overview.view", "payments.view", "users.view", "content.view"] };
const subjects = [
  { id: "a1", title: "Dental Anatomy", college_title: "Tripoli", academic_year_title: "Year 2" },
  { id: "b2", title: "Oral Histology", college_title: "Zawiya", academic_year_title: "Year 2" }
];

test("areas match by label and by the words operators use for them", () => {
  const byLabel = studioSearchResults("pay", admin, []);
  assert.equal(byLabel[0].destination, "/operations/admin/purchases");
  const byAlias = studioSearchResults("approvals", admin, []);
  assert.equal(byAlias[0].title, "Payments");
});

test("only areas the session may open are offered", () => {
  const results = studioSearchResults("settings", admin, []);
  assert.equal(results.some((result) => result.destination === "/operations/admin/settings"), false);
});

test("subjects link straight to their sheet list, and students to a directory search", () => {
  const results = studioSearchResults("anat", admin, subjects);
  assert.ok(results.some((result) => result.destination === "/operations/admin/content?subject=a1" && result.subtitle === "Tripoli · Year 2"));
  const student = results.find((result) => result.type === "studio-student");
  assert.equal(student.destination, "/operations/admin/users?q=anat");
});

test("nothing is offered without capabilities or a query", () => {
  assert.deepEqual(studioSearchResults("anat", null, subjects), []);
  assert.deepEqual(studioSearchResults("   ", admin, subjects), []);
  assert.equal(isStudioRoute("/operations/admin/users"), true);
  assert.equal(isStudioRoute("/materials"), false);
});

test("global search offers Studio results only inside the Studio and loads admin code lazily", async () => {
  const source = await readFile(new URL("../src/components/search/GlobalSearch.jsx", import.meta.url), "utf8");
  assert.match(source, /isStudioRoute\(location\.pathname\) && Boolean\(operationsSession\)/);
  assert.match(source, /import\("\.\.\/\.\.\/api\/adminControl\.js"\)/);
  assert.doesNotMatch(source, /^import .*adminControl/m);
});
