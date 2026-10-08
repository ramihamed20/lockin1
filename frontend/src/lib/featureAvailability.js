/**
 * The single product-level source of truth for features that are intentionally
 * not available yet. Navigation, dashboard discovery and route guards all
 * derive their state from this registry so a feature cannot accidentally be
 * exposed through one path while hidden in another.
 */
export const FEATURE_AVAILABILITY = Object.freeze({
  AVAILABLE: "available",
  COMING_SOON: "coming-soon"
});

const FEATURE_REGISTRY = Object.freeze([
  // Lockin Mode keeps its lobby, sessions and API client intact; flipping this
  // status back to AVAILABLE re-opens every entry point at once.
  Object.freeze({
    id: "lock-in",
    primaryPath: "/lock-in",
    routes: ["/lock-in"],
    labelKey: "nav.lockInMode",
    status: FEATURE_AVAILABILITY.COMING_SOON
  }),
  Object.freeze({
    id: "study-plan",
    primaryPath: "/study-plan",
    routes: ["/study-plan"],
    labelKey: "nav.studyPlan",
    status: FEATURE_AVAILABILITY.COMING_SOON
  }),
  Object.freeze({
    id: "rank",
    primaryPath: "/ranked",
    routes: ["/ranked"],
    labelKey: "nav.ranked",
    status: FEATURE_AVAILABILITY.COMING_SOON
  }),
  Object.freeze({
    id: "community",
    primaryPath: "/community",
    routes: ["/community"],
    labelKey: "nav.community",
    status: FEATURE_AVAILABILITY.COMING_SOON
  })
]);

export function getFeature(featureId) {
  return FEATURE_REGISTRY.find((feature) => feature.id === featureId) || null;
}

export function getFeatureForPath(pathname) {
  if (typeof pathname !== "string") return null;
  return FEATURE_REGISTRY.find((feature) => feature.routes.some((route) => pathname === route || pathname.startsWith(`${route}/`))) || null;
}

export function getFeatureForNavigationPath(pathname) {
  return getFeatureForPath(pathname);
}

export function isFeatureComingSoon(featureOrId) {
  const feature = typeof featureOrId === "string" ? getFeature(featureOrId) : featureOrId;
  return feature?.status === FEATURE_AVAILABILITY.COMING_SOON;
}

export function comingSoonFeatures() {
  return FEATURE_REGISTRY.filter(isFeatureComingSoon);
}
