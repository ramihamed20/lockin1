import { build } from 'vite';
import { fileURLToPath } from 'node:url';

export async function buildReactHookHarness(source) {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const result = await build({
    root, configFile: false, logLevel: 'error',
    define: { __E2E_CATALOG_MATERIALS__: 'null' },
    plugins: [{ name: 'react-hook-regression', resolveId(id) { if (id === 'react-hook-regression') return '\0react-hook-regression'; }, load(id) { if (id === '\0react-hook-regression') return source; } }],
    build: { write: false, minify: false, rollupOptions: { input: 'react-hook-regression', output: { format: 'es', inlineDynamicImports: true } } }
  });
  return result.output.find(item => item.type === 'chunk').code;
}

export async function serveReactHookHarness(page, bundle, { bootstrap = '', query = '' } = {}) {
  const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:4174';
  if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(baseURL).hostname)) throw new Error('React hook harness requires localhost');
  await page.route('**/__react-hook-harness.html*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="en"><body><div id="root"></div><script>' + bootstrap + '</script><script type="module" src="/__react-hook-harness.js"></script></body></html>' }));
  await page.route('**/__react-hook-harness.js', route => route.fulfill({ contentType: 'text/javascript', body: bundle }));
  await page.goto(baseURL + '/__react-hook-harness.html' + (query ? '?' + query : ''));
}