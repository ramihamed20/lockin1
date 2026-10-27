/** Merge account history with newer unsynced work on this device. */
export function recentStudyEntries(serverEntries, localEntries = []) {
  const remote = (Array.isArray(serverEntries) ? serverEntries : []).filter(item => item?.material_slug && item?.sheet_slug).map(item => ({
    material: { slug: item.material_slug, title: item.material_title },
    sheet: { slug: item.sheet_slug, title: item.sheet_title, number: "" },
    openedAt: item.updated_at,
    path: `/materials/catalog/${encodeURIComponent(item.material_slug)}/sheets/${encodeURIComponent(item.sheet_slug)}/workspace`
  }));
  const all = [...remote, ...localEntries].sort((a, b) => (Date.parse(b.openedAt) || 0) - (Date.parse(a.openedAt) || 0));
  const seen = new Set();
  return all.filter(item => {
    if (seen.has(item.path)) return false;
    seen.add(item.path);
    return true;
  }).slice(0, 5);
}
