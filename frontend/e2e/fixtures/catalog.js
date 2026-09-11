/**
 * The catalogue sheets the browser tests read, and nothing else reads.
 *
 * Why this exists: the reader specs need a published sheet to open, and the
 * production catalogue publishes none. It used to publish three Biochemistry
 * PDFs that shipped as public front-end assets, which nginx served straight from
 * `location /assets/` -- outside Django, and therefore outside authentication,
 * the subscription gate and `can_access_managed_file`. Those files are gone and
 * are not coming back; the next published sheet will be a `ManagedFile` behind
 * `/api/v1/files/<id>/view`.
 *
 * How it is injected: `vite.config.js` reads this module at build time and only
 * when `LOCKIN_E2E_CATALOG=1` is set in the build environment. It becomes the
 * compile-time constant `__E2E_CATALOG_MATERIALS__`, which is `null` in every
 * ordinary build. `src/lib/materialCatalog.js` merges it only when it is not
 * null, so a production build is byte-for-byte unchanged and there is no runtime
 * switch an attacker could flip.
 *
 * The PDFs are served by `scripts/serve-dist.mjs`, the test-only static server,
 * from `e2e/fixtures/pdf/`. They are never copied into `dist/`.
 *
 * Slugs and page counts deliberately match what the existing specs assert, so
 * those specs keep testing the reader instead of being rewritten around the
 * fixture.
 */

export const E2E_FIXTURE_URL_PREFIX = "/e2e-fixtures/pdf";

/** Sheets attached to an existing production material, keyed by material slug. */
export const E2E_CATALOG_MATERIALS = {
  "biochemistry-1": [
    { slug: "vitamin-1", number: 1, title: "Vitamin -1", file: "sheet-41.pdf", pageCount: 41 },
    { slug: "vitamin-2", number: 2, title: "Vitamin -2", file: "sheet-17.pdf", pageCount: 17 },
    { slug: "vitamin-3", number: 3, title: "Vitamin -3", file: "sheet-33.pdf", pageCount: 33 },
    // Large enough that pdf.js reads it in ranges rather than one GET, which is
    // what e2e/pdf-range-requests.spec.js needs in order to measure the burst
    // the edge rate limit has to absorb.
    {
      slug: "range-probe",
      number: 4,
      title: "Range probe",
      file: "sheet-range.pdf",
      pageCount: 24
    }
  ]
};

/** The shape `materialCatalog.js` expects: a plain CatalogSheet per entry. */
export function e2eCatalogMaterials() {
  return Object.fromEntries(
    Object.entries(E2E_CATALOG_MATERIALS).map(([materialSlug, sheets]) => [
      materialSlug,
      sheets.map(({ slug, number, title, file, pageCount }) => ({
        slug,
        number,
        title,
        fileName: file,
        pdfUrl: `${E2E_FIXTURE_URL_PREFIX}/${file}`,
        pageCount
      }))
    ])
  );
}
