/**
 * The Materials landing page is intentionally a small, curated study
 * directory. This catalogue controls navigation and presentation only; it
 * never invents study progress, permissions, or protected content state.
 */
export const MATERIAL_CATALOG = [
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
    title: `${title} — Sheet ${number}`,
    summary: `Study sheet ${number} for ${title}.`
  }))
}));

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
