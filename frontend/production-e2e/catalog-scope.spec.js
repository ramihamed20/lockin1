import { expect, test } from '@playwright/test';
import { buildReactHookHarness, serveReactHookHarness } from './helpers/react-hook-harness.js';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// Exercise the real hook and React commit/effect order without depending on
// an account editor, server enrolment mutation or the E2E catalog build.
let harnessBundle;
const root = fileURLToPath(new URL('../', import.meta.url));
test.beforeAll(async () => {
  const hook = JSON.stringify(resolve(root, 'src/hooks/useCatalogMaterials.js'));
  const source = `
    import React, { useLayoutEffect, useState } from 'react';
    import { createRoot } from 'react-dom/client';
    import { useCatalogMaterials } from ${hook};
    const first = { id: 'scope-account-a', cohort: { id: 'scope-cohort-a', code: 'a', program: { code: 'synthetic' } } };
    function Harness() {
      const [user, setUser] = useState(first);
      const catalog = useCatalogMaterials(user);
      useLayoutEffect(() => {
        window.__catalogScopeRenders.push({ owner: user.id, cohort: user.cohort.id, loading: catalog.loading, names: catalog.materials.map(item => item.title), error: catalog.error });
      });
      return React.createElement('main', null,
        React.createElement('button', { onClick: () => setUser({ ...first, id: 'scope-account-b' }) }, 'Change account'),
        React.createElement('button', { onClick: () => setUser({ ...first, cohort: { ...first.cohort, id: 'scope-cohort-b', code: 'b' } }) }, 'Change cohort'),
        React.createElement('button', { onClick: () => setUser(first) }, 'Return to first scope'),
        React.createElement('output', { 'data-testid': 'scope', 'aria-busy': catalog.loading }, user.id + '|' + user.cohort.id),
        React.createElement('output', { 'data-testid': 'catalog' }, catalog.loading ? 'pending' : catalog.materials.map(item => item.title).join(',')));
    }
    createRoot(document.getElementById('root')).render(React.createElement(Harness));
  `;
  harnessBundle = await buildReactHookHarness(source);
});

async function openHarness(page, responder) {
  await page.route('**/api/v1/catalog/materials', responder);
  await serveReactHookHarness(page, harnessBundle, { bootstrap: 'window.__catalogScopeRenders=[];' });
}
const payload = title => ({ results: [{ slug: title.toLowerCase().replaceAll(' ', '-'), title, sheets: [] }] });

for (const change of [{ button: 'Change account', owner: 'scope-account-b', cohort: 'scope-cohort-a' }, { button: 'Change cohort', owner: 'scope-account-a', cohort: 'scope-cohort-b' }]) {
  test(`${change.button}: pending new scope never exposes previous materials and warm return reuses its own list`, async ({ page }) => {
    let requests = 0;
    let release;
    const held = new Promise(done => { release = done; });
    try {
      await openHarness(page, async route => {
        const requestNumber = ++requests;
        if (requestNumber === 2) await held;
        if (!page.isClosed()) await route.fulfill({ json: payload(requestNumber === 1 ? 'First scope subject' : 'Second scope subject') });
      });
      await expect(page.getByTestId('catalog')).toHaveText('First scope subject');
      await page.evaluate(() => { window.__catalogScopeRenders.length = 0; });
      await page.getByRole('button', { name: change.button, exact: true }).click();
      await expect.poll(() => requests).toBe(2);
      const transition = await page.evaluate(scope => window.__catalogScopeRenders.filter(row => row.owner === scope.owner && row.cohort === scope.cohort), change);
      expect(transition.length).toBeGreaterThan(0);
      expect(transition.every(row => !row.names.includes('First scope subject'))).toBe(true);
      await expect(page.getByTestId('catalog')).toHaveText('pending');
      release();
      await expect(page.getByTestId('catalog')).toHaveText('Second scope subject');
      await page.evaluate(() => { window.__catalogScopeRenders.length = 0; });
      await page.getByRole('button', { name: 'Return to first scope', exact: true }).click();
      await expect(page.getByTestId('catalog')).toHaveText('First scope subject');
      const returning = await page.evaluate(() => window.__catalogScopeRenders.filter(row => row.owner === 'scope-account-a' && row.cohort === 'scope-cohort-a'));
      expect(returning.every(row => !row.loading && row.names.join(',') === 'First scope subject')).toBe(true);
      expect(requests).toBe(2);
    } finally { release(); }
  });
}