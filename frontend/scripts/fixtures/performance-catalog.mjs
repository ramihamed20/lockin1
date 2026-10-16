import { E2E_CATALOG_MATERIALS, E2E_FIXTURE_URL_PREFIX } from "../../e2e/fixtures/catalog.js";

// HTTP fixtures for ordinary-build labs. Never imported by application source.
export const PERFORMANCE_CATALOG_MATERIALS = Object.entries(E2E_CATALOG_MATERIALS).map(([slug, sheets]) => ({
  slug,
  title: `Synthetic ${slug}`,
  sheets: sheets.map((sheet) => ({ ...sheet, pdfUrl: `${E2E_FIXTURE_URL_PREFIX}/${sheet.file}` }))
}));
