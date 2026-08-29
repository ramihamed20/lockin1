/**
 * Playwright cannot deliver routed responses to a page that a service worker
 * controls: in WebKit the worker's own fetches bypass interception entirely,
 * and in every engine the worker answers `/assets/**` from its cache before the
 * network is consulted. Specs that re-navigate with a mocked API, or that need
 * an asset request to actually fail, therefore run without a worker.
 *
 * The application already supports this: `PwaLifecycleProvider` reports
 * `unsupported` when `serviceWorker` is missing from `navigator`, which is the
 * same path taken by browsers that have no service worker support. The Chromium
 * suite still exercises the real worker in `focus-workspace.spec.js`.
 *
 * @param {import("@playwright/test").Page} page
 */
export async function withoutServiceWorker(page) {
  await page.addInitScript(() => {
    const prototype = Object.getPrototypeOf(navigator);
    if (prototype && "serviceWorker" in prototype) delete prototype.serviceWorker;
  });
}
