import { expect, test } from '@playwright/test';

test('ordinary build shows a failed directory and a successful retry, without an empty-catalog claim', async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem('lock-in.pwa-launch.dismissed-at', String(Date.now())); });
  let fail = true;
  await page.route('**/api/v1/catalog/materials', async (route) => {
    if (fail) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'service_unavailable', message: 'Synthetic catalog unavailable' } }) });
    return route.continue();
  });
  await page.goto('/#/materials');
  // Production error presentation intentionally replaces untrusted server
  // messages with safe copy while retaining the failed-list recovery action.
  const errorPanel = page.locator('.error-panel[role="alert"]');
  await expect(errorPanel).toBeVisible();
  await expect(errorPanel.getByRole('button', { name: 'Try again', exact: true })).toBeVisible();
  await expect(page.locator('.catalog-directory')).toHaveCount(0);
  fail = false;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('link', { name: /Synthetic Subject 1\b/ }).first()).toBeVisible();
  await expect(errorPanel).toHaveCount(0);
});
