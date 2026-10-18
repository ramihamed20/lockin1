import { expect, test } from '@playwright/test';

test('ordinary build shows a failed directory and a successful retry, without an empty-catalog claim', async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem('lock-in.pwa-launch.dismissed-at', String(Date.now())); });
  let fail = true;
  await page.route('**/api/v1/catalog/materials', async (route) => {
    if (fail) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'service_unavailable', message: 'Synthetic catalog unavailable' } }) });
    return route.continue();
  });
  await page.goto('/#/materials');
  await expect(page.getByText('Synthetic catalog unavailable', { exact: true })).toBeVisible();
  await expect(page.locator('.catalog-directory')).toHaveCount(0);
  fail = false;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('link', { name: /Synthetic Subject 1\b/ }).first()).toBeVisible();
  await expect(page.getByText('Synthetic catalog unavailable', { exact: true })).toHaveCount(0);
});
