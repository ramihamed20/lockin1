/**
 * The study directory behind Materials and Questions. This catalogue controls
 * navigation and presentation only; it never invents study progress,
 * permissions, or protected content state.
 *
 * Subjects are scoped to the cohort a learner is enrolled in, so each intake
 * sees its own list. Sheets and questions are published separately and stay
 * empty here until real content is loaded.
 */
/**
 * @typedef {object} CatalogSheet
 * @property {string} slug
 * @property {number} number
 * @property {string} title
 * @property {string=} summary
 * @property {string=} fileName
 * @property {string=} pdfUrl
 * @property {number=} pageCount
 * @property {boolean=} hasActiveStudy Set once the sheet has Active Study questions.
 *
 * @typedef {object} CatalogMaterial
 * @property {string} slug
 * @property {string} title
 * @property {CatalogSheet[]} sheets
 *
 * @typedef {object} CohortCatalog
 * @property {string[]} programCodes
 * @property {string[]} cohortCodes Empty means every cohort in the program.
 * @property {CatalogMaterial[]} materials
 * @property {string[]} questionCategories
 */

/** Question categories a cohort can open, in the order they are shown. */
const STANDARD_QUESTION_CATEGORIES = ["practice", "years", "ai-sheet", "mix"];

/** @param {[string, string][]} entries */
function buildMaterials(entries) {
  return entries.map(([slug, title]) => Object.freeze({ slug, title, sheets: [] }));
}

const FIRST_YEAR = [
  ["dental-anatomy", "Dental Anatomy"], ["dental-material", "Dental Material"],
  ["general-histology", "General Histology"], ["general-anatomy", "General Anatomy"],
  ["physiology", "Physiology"], ["biochemistry", "Biochemistry"]
];
const SECOND_YEAR = [
  ["conservative", "Conservative"],
  ["microbiology", "Microbiology"],
  ["pharmacy", "Pharmacy"],
  ["general-pathology", "General Pathology"], ["oral-histology", "Oral Histology"],
  ["fixed-prosthodontic", "Fixed Prosthodontic"], ["removable-prosthodontic", "Removable Prosthodontic"]
];

function scopedMaterials(scope, entries) {
  return buildMaterials(entries.map(([slug, title]) => [`${scope}-${slug}`, title]));
}

const HUMAN_MEDICINE_60_MATERIALS = buildMaterials([
  ["human-medicine-60-anatomy-1", "Anatomy 1"],
  ["human-medicine-60-physiology-1", "Physiology 1"],
  ["human-medicine-60-histology-1", "Histology 1"],
  ["human-medicine-60-biochemistry-1", "Biochemistry 1"]
]);

/** @type {CohortCatalog[]} */
export const COHORT_CATALOGS = [
  {
    programCodes: ["human-medicine"],
    cohortCodes: ["60"],
    materials: HUMAN_MEDICINE_60_MATERIALS,
    questionCategories: STANDARD_QUESTION_CATEGORIES
  },
  ...["tripoli", "benghazi", "zawiya"].flatMap((college) => [
    {
      programCodes: [`dentistry-${college}`], cohortCodes: ["year-1"],
      materials: scopedMaterials(`dentistry-${college}-year-1`, FIRST_YEAR), questionCategories: STANDARD_QUESTION_CATEGORIES
    },
    {
      programCodes: [`dentistry-${college}`], cohortCodes: ["year-2"],
      materials: scopedMaterials(`dentistry-${college}-year-2`, SECOND_YEAR), questionCategories: STANDARD_QUESTION_CATEGORIES
    }
  ]),
  {
    programCodes: ["human-medicine"], cohortCodes: ["61"],
    materials: scopedMaterials("human-medicine-61", [["intro-histology", "Intro Histology"], ["intro-anatomy", "Intro Anatomy"], ["english", "English"], ["it", "IT"]]),
    questionCategories: STANDARD_QUESTION_CATEGORIES
  }
];

/** @type {CohortCatalog} */
const EMPTY_CATALOG = {
  programCodes: [],
  cohortCodes: [],
  materials: [],
  questionCategories: STANDARD_QUESTION_CATEGORIES
};

/**
 * Resolves the catalogue for an enrolment. An unknown or missing cohort gets
 * the empty catalogue rather than another intake's subjects.
 * @param {{code?: string, program?: {code?: string}}|null|undefined} cohort
 * @returns {CohortCatalog}
 */
export function getCohortCatalog(cohort) {
  const programCode = cohort?.program?.code || "";
  const cohortCode = cohort?.code || "";
  if (!programCode) return EMPTY_CATALOG;
  return COHORT_CATALOGS.find((catalog) => (
    catalog.programCodes.includes(programCode)
    && (!catalog.cohortCodes.length || catalog.cohortCodes.includes(cohortCode))
  )) || EMPTY_CATALOG;
}

/** @param {{cohort?: {code?: string, program?: {code?: string}}|null, roles?: unknown[]}|null|undefined} user */
export function getCohortMaterials(user) {
  if (Array.isArray(user?.roles) && user.roles.some((role) => ["administrator", "admin", "founder"].includes(String(role).toLowerCase()))) {
    return ALL_MATERIALS;
  }
  return withE2eFixtureSheets(getCohortCatalog(user?.cohort).materials);
}

/** @param {{cohort?: {code?: string, program?: {code?: string}}|null}|null|undefined} user */
export function getCohortQuestionCategories(user) {
  return getCohortCatalog(user?.cohort).questionCategories;
}

/* global __E2E_CATALOG_MATERIALS__ */
/**
 * Fixture sheets compiled in only by `npm run build:e2e` (see
 * e2e/fixtures/catalog.js). Every other build defines this as null, so the
 * merge below is a no-op and there is no runtime switch to flip.
 */
const E2E_CATALOG_MATERIALS = typeof __E2E_CATALOG_MATERIALS__ === "object" ? __E2E_CATALOG_MATERIALS__ : null;

/** "biochemistry-1" -> "Biochemistry 1" */
function titleFromSlug(slug) {
  return slug.split("-").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

const allCatalogSlugs = new Set(COHORT_CATALOGS.flatMap((catalog) => catalog.materials.map((material) => material.slug)));

/** @param {string} slug */
function fixtureSheets(slug) {
  return (E2E_CATALOG_MATERIALS?.[slug] || []).map((sheet) => Object.freeze({ ...sheet }));
}

/**
 * A fixture material the catalogue lacks belongs to no cohort, so it is offered
 * to every learner; the reader specs sign in without one.
 */
const E2E_ONLY_MATERIALS = Object.keys(E2E_CATALOG_MATERIALS || {})
  .filter((slug) => !allCatalogSlugs.has(slug))
  .map((slug) => Object.freeze({ slug, title: titleFromSlug(slug), sheets: fixtureSheets(slug) }));

/** Memoized so a merged list keeps one identity across renders. */
const mergedMaterials = new WeakMap();

/** @param {CatalogMaterial[]} materials */
function withE2eFixtureSheets(materials) {
  if (!E2E_CATALOG_MATERIALS) return materials;
  if (!mergedMaterials.has(materials)) {
    mergedMaterials.set(materials, [
      ...materials.map((material) => (E2E_CATALOG_MATERIALS[material.slug]
        ? Object.freeze({ ...material, sheets: fixtureSheets(material.slug) })
        : material)),
      ...E2E_ONLY_MATERIALS
    ]);
  }
  return mergedMaterials.get(materials);
}

/** Subject slugs are cohort-qualified, so a link resolves without a tree path. */
const ALL_MATERIALS = withE2eFixtureSheets(COHORT_CATALOGS.flatMap((catalog) => catalog.materials));

export function getCatalogMaterial(slug) {
  return ALL_MATERIALS.find((material) => material.slug === slug) || null;
}

export function getCatalogSheet(materialSlug, sheetSlug) {
  const material = getCatalogMaterial(materialSlug);
  return {
    material,
    sheet: material?.sheets.find((item) => item.slug === sheetSlug) || null
  };
}

const LAST_OPENED_SHEET_STORAGE_KEY = "lock-in.materials.last-opened-sheet";
const RECENT_OPENED_SHEETS_STORAGE_KEY = "lock-in.materials.recent-opened-sheets";
const MAX_RECENT_OPENED_SHEETS = 4;

export function rememberLastOpenedCatalogSheet(materialSlug, sheetSlug) {
  const { material, sheet } = getCatalogSheet(materialSlug, sheetSlug);
  if (!material || !sheet) return;

  try {
    const current = getRecentOpenedCatalogSheets().map((entry) => ({
      materialSlug: entry.material.slug,
      sheetSlug: entry.sheet.slug
    }));
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
  const recent = [];
  const seen = new Set();

  for (const entry of readRecentOpenedSheetEntries()) {
    const resolved = resolveOpenedSheet(entry);
    if (!resolved || seen.has(resolved.path)) continue;
    seen.add(resolved.path);
    recent.push(resolved);
    if (recent.length === MAX_RECENT_OPENED_SHEETS) break;
  }

  return recent;
}

export function getLastOpenedCatalogSheet() {
  return getRecentOpenedCatalogSheets()[0] || null;
}
