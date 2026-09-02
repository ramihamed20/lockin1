import assert from "node:assert/strict";
import test from "node:test";
import { readFile, stat } from "node:fs/promises";

const iconFamilies = ["light", "midnight", "gold"];
const iconSizes = [16, 32, 180, 192, 512];

function pngDimensions(bytes) {
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20)
  };
}

test("PWA app icons use the supplied three icon families at every required size", async () => {
  for (const family of iconFamilies) {
    for (const size of iconSizes) {
      const file = new URL(`../public/icons/lockin-${family}-${size}-v2.png`, import.meta.url);
      const bytes = await readFile(file);
      assert.deepEqual(pngDimensions(bytes), { width: size, height: size });
      assert.ok((await stat(file)).size > 500, `${family} ${size}px icon must not be empty`);
    }
    const maskable = await readFile(new URL(`../public/icons/lockin-${family}-maskable-512-v2.png`, import.meta.url));
    assert.deepEqual(pngDimensions(maskable), { width: 512, height: 512 });
  }
});

test("PWA, Apple touch, and browser icon metadata use the versioned primary icon", async () => {
  const [config, html, serviceWorker] = await Promise.all([
    readFile(new URL("../vite.config.js", import.meta.url), "utf8"),
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../src/service-worker.js", import.meta.url), "utf8")
  ]);

  assert.match(config, /icons\/lockin-light-192-v2\.png/);
  assert.match(config, /icons\/lockin-light-512-v2\.png/);
  assert.match(config, /icons\/lockin-light-maskable-512-v2\.png/);
  assert.match(config, /purpose: "maskable"/);
  assert.doesNotMatch(config, /pwa-192x192|pwa-512x512|maskable-icon\.png|assets\/favicon\.svg|apple-touch-icon\.png/);
  assert.match(html, /id="app-apple-touch-icon"/);
  assert.match(html, /id="app-favicon-32"/);
  assert.match(html, /id="app-favicon-16"/);
  assert.doesNotMatch(html, /apple-touch-icon\.png|assets\/favicon\.svg/);
  assert.match(serviceWorker, /cleanupOutdatedCaches\(\)/);
  assert.match(serviceWorker, /lock-in-optional-assets-/);
});

test("app icon preference is persistent and the Settings UI exposes all three choices", async () => {
  const [constants, utils, app, settings] = await Promise.all([
    readFile(new URL("../src/lib/constants.js", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/utils.js", import.meta.url), "utf8"),
    readFile(new URL("../src/App.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/Settings.jsx", import.meta.url), "utf8")
  ]);

  assert.match(constants, /export const appIconOptions = \[/);
  for (const family of iconFamilies) assert.match(constants, new RegExp(`id: "${family}"`));
  assert.match(utils, /appIcon/);
  assert.match(app, /lock-in\.theme\.settings/);
  assert.match(app, /app-apple-touch-icon/);
  assert.match(app, /mergeRemoteThemeSettings/);
  assert.match(settings, /id="settings-app-icon"/);
  assert.match(settings, /appIconOptions\.map/);
  // Choosing an app icon is one-of-N, so the options are radios rather than a
  // row of independent toggle buttons each reporting aria-pressed.
  assert.match(settings, /<RadioGroup className="app-icon-grid"/);
  assert.match(settings, /<RadioOption/);
  assert.match(settings, /cannot change an existing Home Screen icon/);
});

test("PWA registration and browser-owned installation are centralized at bootstrap", async () => {
  const [app, main, provider, installEvents, updatePrompt, launchStyles, lazyRecovery] = await Promise.all([
    readFile(new URL("../src/App.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/main.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pwa/PwaLifecycleProvider.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pwa/installEvents.js", import.meta.url), "utf8"),
    readFile(new URL("../src/components/shared/PwaUpdatePrompt.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/launch-readiness.css", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/lazyWithRecovery.js", import.meta.url), "utf8")
  ]);

  assert.doesNotMatch(app, /PwaUpdatePrompt|beforeinstallprompt|deferredPrompt/);
  assert.match(main, /<PwaLifecycleProvider>[\s\S]*<App \/>[\s\S]*<PwaUpdatePrompt \/>/);
  assert.match(provider, /useRegisterSW/);
  assert.match(provider, /checking|installed|installable|ios-instructions|manual-install|dismissed|unsupported|error|ready/);
  assert.doesNotMatch(provider, /setTimeout/);
  assert.match(installEvents, /beforeinstallprompt/);
  assert.match(installEvents, /appinstalled/);
  assert.match(installEvents, /event\.preventDefault\(\)/);
  assert.match(updatePrompt, /usePwaLifecycle/);
  assert.match(updatePrompt, /className="pwa-update-prompt"/);
  assert.match(launchStyles, /\.pwa-launch-screen/);
  assert.match(launchStyles, /env\(safe-area-inset|--safe-top/);
  assert.match(launchStyles, /prefers-reduced-motion/);
  assert.match(launchStyles, /\.pwa-update-prompt/);
  assert.match(lazyRecovery, /navigator\.serviceWorker\.getRegistration/);
});

test("manifest and runtime cache include Android installability safeguards", async () => {
  const [config, serviceWorker, nginx] = await Promise.all([
    readFile(new URL("../vite.config.js", import.meta.url), "utf8"),
    readFile(new URL("../src/service-worker.js", import.meta.url), "utf8"),
    readFile(new URL("../nginx/default.conf", import.meta.url), "utf8")
  ]);

  assert.match(config, /id: basePath/);
  assert.match(config, /display_override: \["standalone", "minimal-ui"\]/);
  assert.match(config, /prefer_related_applications: false/);
  assert.match(config, /purpose: "any"/);
  assert.match(serviceWorker, /optionalAssetCacheLimit = 96/);
  assert.match(serviceWorker, /if \(cached\) return cached/);
  assert.match(serviceWorker, /pendingAssetRequests/);
  assert.doesNotMatch(serviceWorker, /event\.waitUntil\(refresh\)/);
  assert.doesNotMatch(serviceWorker, /woff2\?\|pdf/);
  assert.match(nginx, /application\/manifest\+json/);
  assert.match(nginx, /Service-Worker-Allowed/);
});

test("startup shell continues the Android splash frame before React mounts", async () => {
  const [config, html, startupStyles, app, shared] = await Promise.all([
    readFile(new URL("../vite.config.js", import.meta.url), "utf8"),
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/startup.css", import.meta.url), "utf8"),
    readFile(new URL("../src/App.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/shared/index.jsx", import.meta.url), "utf8")
  ]);

  assert.match(config, /background_color: "#070b16"/);
  assert.match(config, /theme_color: "#070b16"/);
  assert.match(config, /"startup\.css"/);
  assert.match(html, /rel="stylesheet" href="%BASE_URL%startup\.css"/);
  assert.match(html, /<main class="startup-shell"/);
  assert.match(html, /lockin-light-192-v2\.png/);
  assert.match(startupStyles, /--startup-bg: #070b16/);
  assert.match(startupStyles, /\.startup-shell--continuation/);
  assert.match(startupStyles, /prefers-reduced-motion: reduce/);
  assert.match(app, /FullScreenState message="Opening your study room\.\.\." startup/);
  assert.match(shared, /startup-shell--\$\{startup \? "continuation" : "settled"\}/);

  for (const legacyIcon of ["pwa-192x192.png", "pwa-512x512.png", "apple-touch-icon.png", "maskable-icon.png"]) {
    await assert.rejects(stat(new URL(`../public/${legacyIcon}`, import.meta.url)), { code: "ENOENT" });
  }
});
