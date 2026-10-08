/**
 * Paper Workspace subject list, built from the Materials directory.
 *
 * Every subject that has at least one openable sheet is listed, and every such
 * sheet is shown. Active Study readiness only decides whether a sheet can be
 * started (`ready`); it never decides whether a subject or sheet is visible, so
 * a subject can no longer vanish without a reason because its sheets are not
 * ready yet. Nothing here depends on a subject's title, slug, cohort or number.
 */
export function buildPaperGroups(materials) {
  return (materials || [])
    .map((material) => {
      const sheets = (material.sheets || [])
        .filter((sheet) => sheet.learningObjectId)
        .map((sheet) => ({ ...sheet, ready: Boolean(sheet.hasActiveStudy) }));
      return {
        slug: material.slug,
        title: material.title,
        sheets,
        readyCount: sheets.filter((sheet) => sheet.ready).length
      };
    })
    .filter((group) => group.sheets.length);
}
