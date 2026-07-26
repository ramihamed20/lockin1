import { ApiError, request } from "./client.js";
import { buildQueryString, generateIdempotencyKey } from "./pagination.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function id(value, label = "identifier") {
  const clean = typeof value === "string" ? value.trim() : "";
  if (!UUID.test(clean)) throw new ApiError(0, null, `A valid ${label} is required.`, "invalid_request");
  return clean;
}

function page(payload, message) {
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.results) || typeof payload.count !== "number") {
    throw new ApiError(500, payload, message, "invalid_response");
  }
  return payload;
}

function pagePath(path, options = {}) {
  return path + buildQueryString({
    page: options.page || 1,
    page_size: options.pageSize || 25,
    q: options.query?.trim(),
    status: options.status,
    without_subscription: options.withoutSubscription ? "true" : ""
  });
}

function reason(value) {
  const clean = typeof value === "string" ? value.trim() : "";
  if (clean.length < 8) throw new ApiError(0, null, "An administrative reason of at least 8 characters is required.", "invalid_request");
  return clean;
}

/** Real, same-origin Django administration endpoints only. */
export const adminControlApi = {
  overview: () => request("/operations/dashboards/overview"),
  analytics: ({ from, to } = {}) => request("/operations/admin/analytics/dashboard" + buildQueryString({ from, to })),
  systemHealth: () => request("/operations/system-health"),
  configurations: () => request("/operations/configuration"),
  updateConfiguration(key, { value, expectedVersion, changeReason }) {
    const cleanKey = typeof key === "string" ? key.trim() : "";
    if (!/^[a-z][a-z0-9_.-]{1,119}$/i.test(cleanKey)) {
      throw new ApiError(0, null, "A valid configuration key is required.", "invalid_request");
    }
    return request(`/operations/configuration/${cleanKey}`, {
      method: "PATCH",
      body: { value, expected_version: expectedVersion, reason: reason(changeReason) }
    });
  },
  audit: (options = {}) => request("/operations/audit" + buildQueryString({ page: options.page || 1, page_size: options.pageSize || 25, action: options.action, domain: options.domain })),

  users: (options = {}) => request(pagePath("/operations/users", options)).then((data) => page(data, "The user list response was incomplete.")),
  user: (userId) => request(`/operations/admin/users/${id(userId, "user identifier")}`),
  userAction(userId, body) {
    return request(`/operations/admin/users/${id(userId, "user identifier")}/actions`, { method: "POST", body: { ...body, reason: reason(body.reason) } });
  },
  userEntitlements: (userId) => request(`/operations/admin/users/${id(userId, "user identifier")}/entitlements`),
  grantEntitlement(userId, body) {
    return request(`/operations/admin/users/${id(userId, "user identifier")}/entitlements/grants`, { method: "POST", body: { ...body, reason: reason(body.reason) } });
  },
  revokeEntitlement(grantId, body) {
    return request(`/operations/admin/entitlements/grants/${id(grantId, "grant identifier")}/revoke`, { method: "POST", body: { reason: reason(body.reason) } });
  },
  userCapabilities: (userId) => request(`/operations/admin/users/${id(userId, "user identifier")}/capabilities`),
  updateUserCapabilities(userId, capabilities, changeReason) {
    return request(`/operations/admin/users/${id(userId, "user identifier")}/capabilities`, { method: "PATCH", body: { capabilities, reason: reason(changeReason) } });
  },
  roleCatalog: () => request("/operations/admin/roles"),
  updateOperationalRoles(userId, roles, changeReason) {
    return request(`/operations/users/${id(userId, "user identifier")}/roles`, { method: "PATCH", body: { roles, reason: reason(changeReason) } });
  },

  purchases: (options = {}) => request(pagePath("/operations/admin/purchases", options)).then((data) => page(data, "The purchase list response was incomplete.")),
  purchase: (paymentId) => request(`/operations/admin/purchases/${id(paymentId, "purchase identifier")}`),
  refund(paymentId, { amountMinor, refundReason, idempotencyKey } = {}) {
    return request(`/operations/admin/purchases/${id(paymentId, "purchase identifier")}/refunds`, {
      method: "POST",
      body: { amount_minor: Number(amountMinor), reason: reason(refundReason) },
      idempotencyKey: idempotencyKey || generateIdempotencyKey()
    });
  },
  requestPaymentCorrection(paymentId, body) {
    return request(`/operations/admin/purchases/${id(paymentId, "purchase identifier")}/corrections`, {
      method: "POST",
      body: { requested_status: body.requestedStatus, provider_reference: body.providerReference, reason: reason(body.reason) },
      idempotencyKey: body.idempotencyKey || generateIdempotencyKey()
    });
  },
  reviewPaymentCorrection(correctionId, body) {
    return request(`/operations/admin/purchases/corrections/${id(correctionId, "correction identifier")}/review`, {
      method: "POST",
      body: { decision: body.decision, reason: reason(body.reason) },
      idempotencyKey: body.idempotencyKey || generateIdempotencyKey()
    });
  },

  subscriptions: (options = {}) => request(pagePath("/operations/admin/subscriptions", options)).then((data) => page(data, "The subscription list response was incomplete.")),
  subscription: (subscriptionId) => request(`/operations/admin/subscriptions/${id(subscriptionId, "subscription identifier")}`),
  subscriptionAction(subscriptionId, body) {
    return request(`/operations/admin/subscriptions/${id(subscriptionId, "subscription identifier")}/actions`, {
      method: "POST",
      body: { ...body, reason: reason(body.reason) },
      idempotencyKey: body.idempotencyKey || generateIdempotencyKey()
    });
  },
  plans: () => request("/operations/admin/plans"),
  planAction(planId, body) {
    return request(`/operations/admin/plans/${id(planId, "plan identifier")}/actions`, { method: "POST", body: { ...body, reason: reason(body.reason) } });
  },

  campaigns: (options = {}) => request(pagePath("/operations/admin/notifications/campaigns", options)).then((data) => page(data, "The notification campaign list response was incomplete.")),
  createCampaign(body) {
    return request("/operations/admin/notifications/campaigns", { method: "POST", body: { ...body, reason: reason(body.reason) } });
  },
  dispatchCampaign(campaignId, dispatchReason) {
    return request(`/operations/admin/notifications/campaigns/${id(campaignId, "campaign identifier")}/dispatch`, { method: "POST", body: { reason: reason(dispatchReason) } });
  },

  moderationReports(options = {}) {
    return request("/moderation/reports" + buildQueryString({ page_size: options.pageSize || 25, status: options.status, assignment: options.assignment }));
  },
  transitionModerationReport(reportId, body) {
    return request(`/moderation/reports/${id(reportId, "report identifier")}/transition`, { method: "POST", body });
  },

  reports: () => request("/operations/reports"),
  previewReport(reportCode, filters = {}, outputFormat = "csv") {
    return request("/operations/reports/previews", { method: "POST", body: { report_code: reportCode, filters, output_format: outputFormat } });
  },
  executeReport(exportId, confirmationToken) {
    return request(`/operations/reports/${id(exportId, "export identifier")}/execute`, {
      method: "POST",
      body: { confirmation_token: confirmationToken },
      responseType: "blob"
    });
  }
};
