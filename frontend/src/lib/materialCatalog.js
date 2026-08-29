/**
 * The Materials landing page is intentionally a small, curated study
 * directory. This catalogue controls navigation and presentation only; it
 * never invents study progress, permissions, or protected content state.
 */
/**
 * @typedef {object} CatalogSheet
 * @property {string} slug
 * @property {number} number
 * @property {string} title
 * @property {string} summary
 * @property {string=} fileName
 * @property {string=} pdfUrl
 * @property {number=} pageCount
 * @property {boolean=} isTestSheet
 *
 * @typedef {object} CatalogMaterial
 * @property {string} slug
 * @property {string} title
 * @property {CatalogSheet[]} sheets
 */
const ORAL_HISTO_TEST_SHEET = Object.freeze({
  summary: "Test PDF: Oral Histo 2.",
  fileName: "Oral Histo 2.pdf",
  pdfUrl: "/assets/oral-histology-test.pdf",
  pageCount: 16,
  isTestSheet: true
});

export const MATERIAL_CATALOG = /** @type {CatalogMaterial[]} */ ([
  ["conservative", "Conservative"],
  ["microbiology", "Microbiology"],
  ["pharmacy", "Pharmacy"],
  ["general-pathology", "General pathology"],
  ["oral-histology", "Oral histology"],
  ["fixed-prosthodontic", "Fixed prosthodontic"],
  ["removeable-prosthodontic", "Removeable prosthodontic"]
].map(([slug, title]) => ({
  slug,
  title,
  sheets: [1, 2, 3].map((number) => ({
    slug: `sheet-${number}`,
    number,
    title: `${title} sheet ${number}`,
    ...ORAL_HISTO_TEST_SHEET
  }))
})));

const oralHistology = MATERIAL_CATALOG.find((material) => material.slug === "oral-histology");

const LAST_OPENED_SHEET_STORAGE_KEY = "lock-in.materials.last-opened-sheet";
const RECENT_OPENED_SHEETS_STORAGE_KEY = "lock-in.materials.recent-opened-sheets";
const MAX_RECENT_OPENED_SHEETS = 4;

oralHistology?.sheets.push({
  slug: "sheet-4",
  number: 4,
  title: "Oral histology sheet 4",
  ...ORAL_HISTO_TEST_SHEET
});

export function getCatalogMaterial(slug) {
  return MATERIAL_CATALOG.find((material) => material.slug === slug) || null;
}

export function getCatalogSheet(materialSlug, sheetSlug) {
  const material = getCatalogMaterial(materialSlug);
  return {
    material,
    sheet: material?.sheets.find((item) => item.slug === sheetSlug) || null
  };
}

export function rememberLastOpenedCatalogSheet(materialSlug, sheetSlug) {
  const { material, sheet } = getCatalogSheet(materialSlug, sheetSlug);
  if (!material || !sheet) return;

  try {
    const current = readRecentOpenedSheetEntries();
    const next = [{ materialSlug, sheetSlug }, ...current.filter((entry) => entry.materialSlug !== materialSlug || entry.sheetSlug !== sheetSlug)].slice(0, MAX_RECENT_OPENED_SHEETS);
    globalThis.localStorage?.setItem(RECENT_OPENED_SHEETS_STORAGE_KEY, JSON.stringify(next));
    globalThis.localStorage?.setItem(LAST_OPENED_SHEET_STORAGE_KEY, JSON.stringify(next[0]));
  } catch {
    // Continue study remains available during private browsing or when storage is disabled.
  }
}

function readRecentOpenedSheetEntries() {
  try {
    const stored = JSON.parse(globalThis.localStorage?.getItem(RECENT_OPENED_SHEETS_STORAGE_KEY) || "null");
    if (Array.isArray(stored)) return stored;

    const legacy = JSON.parse(globalThis.localStorage?.getItem(LAST_OPENED_SHEET_STORAGE_KEY) || "null");
    return legacy ? [legacy] : [];
  } catch {
    return [];
  }
}

function resolveOpenedSheet(entry) {
  if (!entry || typeof entry.materialSlug !== "string" || typeof entry.sheetSlug !== "string") return null;
  const { material, sheet } = getCatalogSheet(entry.materialSlug, entry.sheetSlug);
  return material && sheet ? { material, sheet, path: `/materials/catalog/${material.slug}/sheets/${sheet.slug}` } : null;
}

export function getRecentOpenedCatalogSheets() {
  return readRecentOpenedSheetEntries().map(resolveOpenedSheet).filter(Boolean);
}

export function getLastOpenedCatalogSheet() {
  return getRecentOpenedCatalogSheets()[0] || null;
}
