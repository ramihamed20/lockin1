import { clientsClaim } from "workbox-core";
import { cleanupOutdatedCaches, precacheAndRoute } from "workbox-precaching";

self.skipWaiting();
clientsClaim();

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// Version 1 of the replacement cached authenticated API GET responses. Delete
// that cache on activation without registering any API runtime caching again.
const legacyPrivateCacheName = ["api", "cache"].join("-");
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.delete(legacyPrivateCacheName));
});
