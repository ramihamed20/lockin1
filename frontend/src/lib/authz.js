import { PRODUCT_ROLES } from "../api/contracts.js";

const CURRENT_AUTHENTICATED_ROUTES = new Set([
  "/",
  "/dashboard",
  "/materials",
  "/search",
  "/questions",
  "/review",
  "/community",
  "/ranked",
  "/analytics",
  "/bookmarks",
  "/progress",
  "/progression",
  "/achievements",
  "/notifications",
  "/profile",
  "/security",
  "/subscription",
  "/settings"
]);

export const ROUTE_ACCESS_CONFIG = Object.freeze([
  { path: "/operations/admin", capability: "overview.view" },
  { path: "/operations/configuration", capability: "configuration.view" },
  { path: "/operations/system-health", capability: "system_health.view" },
  { path: "/operations/analytics", capability: "analytics.view" },
  { path: "/operations/reports", capability: "reports.export" },
  { path: "/operations/actions", capability: "operational_actions.execute" },
  { path: "/operations/content", capability: "content.view" },
  { path: "/operations/support", capability: "users.view" },
  { path: "/operations/users", capability: "users.view" },
  { path: "/operations/audit", capability: "audit.view" },
  { path: "/operations", capability: "overview.view", exact: true },
  { path: "/admin", productRole: PRODUCT_ROLES.ADMINISTRATOR },
  { path: "/creator/questions", productRoles: [PRODUCT_ROLES.CREATOR, PRODUCT_ROLES.ADMINISTRATOR], capabilities: ["assessments.manage"] },
  { path: "/creator/quizzes", productRoles: [PRODUCT_ROLES.CREATOR, PRODUCT_ROLES.ADMINISTRATOR], capabilities: ["assessments.manage"] },
  { path: "/creator/education", productRoles: [PRODUCT_ROLES.CREATOR, PRODUCT_ROLES.ADMINISTRATOR], capabilities: ["content.manage"] },
  { path: "/creator/content", productRoles: [PRODUCT_ROLES.CREATOR, PRODUCT_ROLES.ADMINISTRATOR], capabilities: ["content.manage"] },
  { path: "/creator", productRoles: [PRODUCT_ROLES.CREATOR, PRODUCT_ROLES.ADMINISTRATOR], capabilities: ["content.manage", "assessments.manage"] },
  { path: "/moderation", productRole: PRODUCT_ROLES.MODERATOR }
]);

function routePath(path) {
  return typeof path === "string" ? path.split("?")[0] : "";
}

function routeMatches(config, path) {
  return config.exact ? path === config.path : path === config.path || path.startsWith(config.path + "/");
}

function sessionUser(value) {
  if (!value || typeof value !== "object") return null;
  return value.user && typeof value.user === "object" ? value.user : value;
}

export function hasProductRole(userOrSession, role) {
  const user = sessionUser(userOrSession);
  return Boolean(
    user &&
      Object.values(PRODUCT_ROLES).includes(role) &&
      Array.isArray(user.roles) &&
      user.roles.includes(role)
  );
}

export function hasOperationalCapability(operationsSession, capability) {
  return Boolean(
    operationsSession &&
      typeof operationsSession === "object" &&
      typeof capability === "string" &&
      Array.isArray(operationsSession.capabilities) &&
      operationsSession.capabilities.includes(capability)
  );
}

/**
 * Returns false for unknown routes and unknown or missing permission values.
 * @param {unknown} userOrSession
 * @param {string} path
 * @param {unknown} [operationsSession]
 */
export function canAccessRoute(userOrSession, path, operationsSession) {
  const currentPath = routePath(path);
  const user = sessionUser(userOrSession);
  if (!user || !user.id) return false;

  const configuredRoute = ROUTE_ACCESS_CONFIG.find((config) => routeMatches(config, currentPath));
  if (configuredRoute) {
    if (configuredRoute.productRole) return hasProductRole(user, configuredRoute.productRole);
    if (Array.isArray(configuredRoute.productRoles) && configuredRoute.productRoles.some((role) => hasProductRole(user, role))) return true;
    if (Array.isArray(configuredRoute.capabilities)) return configuredRoute.capabilities.some((capability) => hasOperationalCapability(operationsSession, capability));
    return hasOperationalCapability(operationsSession, configuredRoute.capability);
  }

  if (CURRENT_AUTHENTICATED_ROUTES.has(currentPath)) return true;
  return (
    /^\/materials\/(?:objects\/[^/]+|[^/]+(?:\/sheets\/[^/]+)?)$/.test(currentPath) ||
    /^\/focus\/[^/]+$/.test(currentPath) ||
    /^\/questions\/(?:quizzes|attempts|results)\/[^/]+$/.test(currentPath) ||
    /^\/community\/(?:discussions|spaces|reports)\/[^/]+$/.test(currentPath) ||
    /^\/community\/context\/(?:lesson|learning_object|question|quiz)\/[^/]+$/.test(currentPath)
  );
}
