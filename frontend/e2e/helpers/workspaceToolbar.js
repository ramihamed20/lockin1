/**
 * Phones fold some workspace actions into the More menu for room (Notes below
 * 561px, Study below 400px). These reach the action the way a student would at
 * the current width: the toolbar button when it is on screen, else More.
 */

/**
 * Opens or closes the Notes panel, as the Notes button does. Where Notes lives
 * in More, the open panel closes with its own close button.
 * @param {import("@playwright/test").Page} page
 */
export async function toggleNotesPanel(page) {
  const toolbarNotes = page.locator('.workspace-v2-toolbar [data-workspace-tool="note"]');
  if (await toolbarNotes.isVisible()) {
    await toolbarNotes.click();
    return;
  }
  if (await page.locator("#workspace-notes-panel.is-open").count()) {
    await page.locator("#workspace-notes-panel .workspace-v2-side-close").click();
    return;
  }
  await page.locator('.workspace-v2-toolbar [data-workspace-surface="more"]').click();
  await page.locator('#workspace-more-popover [data-workspace-action="notes"]').click();
}
