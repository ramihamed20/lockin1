const NOTIFICATION_DESTINATIONS = new Set([
  "/",
  "/dashboard",
  "/progress",
  "/progression",
  "/achievements",
  "/profile",
  "/security",
  "/subscription",
  "/settings",
  "/materials",
  "/questions",
  "/review",
  "/bookmarks",
  "/notifications",
  "/store"
]);

const NOTIFICATION_DESTINATION_PREFIXES = [
  "/materials/catalog/",
  "/questions/",
  "/review/",
  "/community/",
  "/ranked/",
  "/admin/",
  "/operations/",
  "/moderation/"
];

/**
 * Django returns application-relative target routes after it marks a
 * notification as opened. Only destinations that this frontend actually
 * renders are navigable; unsupported routes remain an explicit unavailable
 * state instead of falling through the catch-all dashboard route.
 * @param {unknown} route
 */
export function isKnownNotificationRoute(route) {
  if (typeof route !== "string" || !route.startsWith("/") || route.startsWith("//") || route.includes("\\") || /^[a-z][a-z\d+.-]*:/i.test(route)) return false;
  const pathname = route.split(/[?#]/, 1)[0];
  if (pathname.split("/").includes("..")) return false;
  return NOTIFICATION_DESTINATIONS.has(pathname)
    || NOTIFICATION_DESTINATION_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/** Gives informational notifications a useful destination even when the
 * producer did not attach a specific object route. */
export function notificationFallbackRoute(notification) {
  return {
    account: "/profile",
    learning: "/materials",
    achievement: "/achievements",
    community: "/community",
    moderation: "/moderation",
    billing: "/subscription",
    platform: "/dashboard",
    update: "/dashboard"
  }[notification?.category] || "/notifications";
}
