import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { COHORT_CATALOGS } from "../src/lib/materialCatalog.js";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

/**
 * A subject list that has not arrived is not a subject list that is empty.
 * Rendering the first as the second is what turned a slow or failed request into
 * a page telling students their subjects were gone, so every screen that reads
 * the directory has to gate on `loading` and `error` before it draws an empty or
 * "not found" state.
 */
test("every catalogue screen separates 'not loaded yet' from 'nothing here'", async () => {
  const materials = await read("../src/pages/Materials.jsx");
  const workspace = await read("../src/pages/CatalogFocusWorkspace.jsx");

  // Materials, CatalogMaterialSheets and CatalogSheetStudy all live in this file.
  const gates = materials.match(/if \(loading\) return/g) || [];
  assert.equal(gates.length, 3, "each of the three catalogue screens gates on loading");
  const errorGates = materials.match(/if \(error\) return/g) || [];
  assert.equal(errorGates.length, 3, "each of the three screens offers a retry instead of 404");
  assert.match(materials, /onRetry=\{reload\}/);
  // The empty state is only reachable after a successful, genuinely empty load.
  assert.ok(
    materials.indexOf("if (loading) return") < materials.indexOf("materials.length === 0"),
    "the loading gate precedes the empty state"
  );
  assert.match(workspace, /materialsLoading/);
  assert.match(workspace, /materialsError/);
});

test("the directory is fetched once per enrolment, not once per screen", async () => {
  const hook = await read("../src/hooks/useCatalogMaterials.js");

  // Four components read this list between Materials and an open sheet. Without
  // a shared entry each one restarts from "nothing loaded", which is what made a
  // correct route show "not found" for a moment on every hop.
  assert.match(hook, /const cache = new Map\(\)/);
  assert.match(hook, /function cacheKey\(user\)/);
  assert.match(hook, /export function clearCatalogMaterialsCache/);
  // A failed list must never be cached as a result, or a retry inherits it.
  assert.match(hook, /cache\.delete\(key\)/);
  // The local fallback stays gone: the server is the only catalog authority.
  assert.doesNotMatch(hook, /getCohortMaterials/);
});

test("the local catalogue and the seeded hierarchy agree on every subject slug", async () => {
  // Materials routes come from the server's material_slug; Questions still reads
  // the local catalogue. A slug that differs between them resolves to nothing on
  // one side -- which is exactly what "removeable" vs "removable" did.
  const seed = await read(
    "../../backend/apps/education/migrations/0007_seed_libyan_education_tree.py"
  );
  const rename = await read(
    "../../backend/apps/education/migrations/0009_rename_removable_prosthodontic_slug.py"
  );

  const slugify = (title) => title.toLowerCase().replaceAll(" ", "-").replaceAll("/", "-");
  const titlesIn = (name) => {
    const block = seed.match(new RegExp(`${name} = \\(([^)]*)\\)`, "s"));
    assert.ok(block, `${name} is declared in the seed migration`);
    return [...block[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  };

  const renamed = new Map([["removeable-prosthodontic", "removable-prosthodontic"]]);
  assert.match(rename, /NEW_SLUG = "removable-prosthodontic"/);
  const seeded = (name) => titlesIn(name).map((title) => renamed.get(slugify(title)) || slugify(title));

  const firstYear = seeded("first_year_subjects");
  const secondYear = seeded("second_year_subjects");

  for (const college of ["tripoli", "benghazi", "zawiya"]) {
    for (const [cohortCode, expected] of [["year-1", firstYear], ["year-2", secondYear]]) {
      const catalog = COHORT_CATALOGS.find((item) => (
        item.programCodes.includes(`dentistry-${college}`) && item.cohortCodes.includes(cohortCode)
      ));
      assert.ok(catalog, `dentistry-${college}/${cohortCode} is configured locally`);
      assert.deepEqual(
        catalog.materials.map((material) => material.slug),
        expected.map((slug) => `dentistry-${college}-${cohortCode}-${slug}`),
        `dentistry-${college}/${cohortCode} slugs match the seeded hierarchy`
      );
    }
  }
});

test("both production edges serve the PDF worker as JavaScript", async () => {
  // The worker is emitted as a hashed .mjs, which nginx's mime.types does not
  // map. Fixing only one of the two documented deployment shapes leaves the
  // other serving application/octet-stream, which the reader refuses to start.
  const rule = /location\s+~\s+\^\/assets\/\.\*\\\.mjs\$\s*\{[^}]*default_type\s+application\/javascript;/s;
  for (const path of ["../nginx/default.conf", "../../deploy/container-host/nginx.conf.template"]) {
    const config = await read(path);
    assert.match(config, rule, `${path} serves /assets/*.mjs as JavaScript`);
    // SPA fallback must never answer a missing worker with index.html.
    assert.match(config, /location\s+~\s+\^\/assets\/\.\*\\\.mjs\$\s*\{[^}]*try_files\s+\$uri\s+=404;/s);
  }
});

test("a new sheet defaults to the state students can actually see", async () => {
  const studio = await read("../src/pages/AdminContentManagement.jsx");

  // A draft is visible in Content Studio and to no student. Defaulting to it
  // made "I added the sheet" and "students have the sheet" different facts with
  // nothing in the interface to say so.
  assert.match(studio, /const \[status, setStatus\] = useState\("published"\)/);
  assert.match(studio, /A draft is visible here and to no student/);
});
