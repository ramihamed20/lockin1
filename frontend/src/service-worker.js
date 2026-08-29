/// <reference lib="webworker" />
/* global __APP_VERSION__ */
import { clientsClaim } from "workbox-core";
import { cleanupOutdatedCaches, precacheAndRoute } from "workbox-precaching";

clientsClaim();

/** @type {ServiceWorkerGlobalScope & {__WB_MANIFEST: Array<import("workbox-precaching").PrecacheEntry | string>}} */
const workerScope = /** @type {any} */ (self);

workerScope.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") workerScope.skipWaiting();
});

// @ts-expect-error Workbox injects this compile-time manifest placeholder.
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

const runtimeCachePrefix = "lock-in-optional-assets-";
const optionalAssetCache = `${runtimeCachePrefix}${__APP_VERSION__}`;
const optionalAssetExtensions = /\.(?:avif|webp|png|jpe?g|svg|gif|woff2?|js|css)$/i;
const optionalAssetCacheLimit = 96;
const pendingAssetRequests = new Map();

async function trimOptionalAssetCache(cache) {
  const keys = await cache.keys();
  const overflow = keys.length - optionalAssetCacheLimit;
  if (overflow > 0) await Promise.all(keys.slice(0, overflow).map((request) => cache.delete(request)));
}

async function fetchAndCacheOptionalAsset(cache, request) {
  const key = request.url;
  if (pendingAssetRequests.has(key)) return pendingAssetRequests.get(key).then((response) => response.clone());
  const pending = fetch(request)
    .then(async (response) => {
      if (response.ok && response.type === "basic") {
        await cache.put(request, response.clone());
        await trimOptionalAssetCache(cache);
      }
      return response;
    })
    .finally(() => pendingAssetRequests.delete(key));
  pendingAssetRequests.set(key, pending);
  return pending;
}

// Cache public presentation assets only after they are requested. The cache is
// versioned with the application build, so a cache hit is already current for
// this release and must not trigger a background network fetch/cache write on
// every PWA launch. That avoids competing I/O while the first screen scrolls.
// API and navigation responses are deliberately excluded because they may
// contain private account or study data.
workerScope.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== workerScope.location.origin || url.pathname.startsWith("/api/")) return;
  if (!url.pathname.startsWith("/assets/") && !optionalAssetExtensions.test(url.pathname)) return;

  event.respondWith((async () => {
    const cache = await caches.open(optionalAssetCache);
    const cached = await cache.match(request);
    if (cached) return cached;
    return await fetchAndCacheOptionalAsset(cache, request).catch(() => Response.error());
  })());
});

// Version 1 of the replacement cached authenticated API GET responses. Delete
// that cache on activation without registering any API runtime caching again.
const legacyPrivateCacheName = ["api", "cache"].join("-");
workerScope.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    await caches.delete(legacyPrivateCacheName);
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames.map((cacheName) => {
      if (cacheName.startsWith(runtimeCachePrefix) && cacheName !== optionalAssetCache) return caches.delete(cacheName);
      return Promise.resolve(false);
    }));
  })());
});
