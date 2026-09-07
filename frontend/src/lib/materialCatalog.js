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

/**
 * Biochemistry 1 is the first subject with published sheets. Active Study is
 * left off until its questions are written, so these open in Normal Study.
 * @param {[string, string, string, number][]} entries
 */
function buildSheets(entries) {
  return entries.map(([slug, title, fileName, pageCount], index) => Object.freeze({
    slug,
    number: index + 1,
    title,
    fileName,
    pdfUrl: `/assets/biochemistry/${slug}.pdf`,
    pageCount
  }));
}

const BIOCHEMISTRY_1_SHEETS = buildSheets([
  ["vitamin-1", "Vitamin -1", "VITAMIN 2025 part 1.pdf", 41],
  ["vitamin-2", "Vitamin -2", "vitamin 2025 part 2.pdf", 17],
  ["vitamin-3", "Vitamin -3", "vitamin part 3.pdf", 33]
]);

const DENTISTRY_MATERIALS = buildMaterials([
  ["conservative", "Conservative"],
  ["microbiology", "Microbiology"],
  ["pharmacy", "Pharmacy"],
  ["general-pathology", "General pathology"],
  ["oral-histology", "Oral histology"],
  ["fixed-prosthodontic", "Fixed prosthodontic"],
  ["removeable-prosthodontic", "Removeable prosthodontic"]
]);

const HUMAN_MEDICINE_60_MATERIALS = buildMaterials([
  ["anatomy-1", "Anatomy 1"],
  ["physiology-1", "Physiology 1"],
  ["histology-1", "Histology 1"],
  ["biochemistry-1", "Biochemistry 1"]
]).map((material) => (material.slug === "biochemistry-1"
  ? Object.freeze({ ...material, sheets: BIOCHEMISTRY_1_SHEETS })
  : material));

/** @type {CohortCatalog[]} */
export const COHORT_CATALOGS = [
  {
    programCodes: ["human-medicine"],
    cohortCodes: ["60"],
    materials: HUMAN_MEDICINE_60_MATERIALS,
    questionCategories: STANDARD_QUESTION_CATEGORIES
  },
  {
    programCodes: ["dentistry", "dentistry-tripoli", "dentistry-zawiya", "dentistry-benghazi"],
    cohortCodes: [],
    materials: DENTISTRY_MATERIALS,
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

/** @param {{cohort?: {code?: string, program?: {code?: string}}|null}|null|undefined} user */
export function getCohortMaterials(user) {
  return getCohortCatalog(user?.cohort).materials;
}

/** @param {{cohort?: {code?: string, program?: {code?: string}}|null}|null|undefined} user */
export function getCohortQuestionCategories(user) {
  return getCohortCatalog(user?.cohort).questionCategories;
}

/** Subject slugs are unique across cohorts, so a link resolves without one. */
const ALL_MATERIALS = COHORT_CATALOGS.flatMap((catalog) => catalog.materials);

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
