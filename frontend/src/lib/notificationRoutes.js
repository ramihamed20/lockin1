const NOTIFICATION_DESTINATIONS = new Set([
  "/",
  "/dashboard",
  "/progress",
  "/progression",
  "/achievements",
  "/profile",
  "/security",
  "/subscription"
]);

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
  return NOTIFICATION_DESTINATIONS.has(pathname) || /^\/community\/discussions\/[^/]+$/.test(pathname);
}
