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
    role: options.role,
    ordering: options.ordering,
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
  /** @param {{from?: string, to?: string}} [options] */
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

  contentSubjects: (options = {}) => request("/operations/admin/content/subjects" + buildQueryString({ q: options.query?.trim() })),
  subjectSheets(subjectId, options = {}) {
    return request(`/operations/admin/content/subjects/${id(subjectId, "subject identifier")}/sheets` + buildQueryString({ q: options.query?.trim(), status: options.status }));
  },
  createSheet(subjectId, body) {
    return request(`/operations/admin/content/subjects/${id(subjectId, "subject identifier")}/sheets`, { method: "POST", body });
  },
  updateSheet(sheetId, body) {
    return request(`/operations/admin/content/sheets/${id(sheetId, "sheet identifier")}`, { method: "PATCH", body });
  },
  sheetAction(sheetId, body) {
    return request(`/operations/admin/content/sheets/${id(sheetId, "sheet identifier")}/actions`, { method: "POST", body });
  },
  replaceSheetPdf(sheetId, body) {
    return request(`/operations/admin/content/sheets/${id(sheetId, "sheet identifier")}/pdf`, { method: "POST", body });
  },
  removeSheetPdf(sheetId, expectedRevision) {
    return request(`/operations/admin/content/sheets/${id(sheetId, "sheet identifier")}/pdf`, { method: "DELETE", body: { expected_revision: Number(expectedRevision) } });
  },
  deleteSheet(sheetId) {
    return request(`/operations/admin/content/sheets/${id(sheetId, "sheet identifier")}`, { method: "DELETE" });
  },
  sheetQuestions(sheetId, options = {}) {
    return request(`/operations/admin/content/sheets/${id(sheetId, "sheet identifier")}/questions` + buildQueryString({ q: options.query?.trim(), status: options.status, type: options.type, difficulty: options.difficulty, topic: options.topic }));
  },
  validateQuestionImport(sheetId, payload) {
    return request(`/operations/admin/content/sheets/${id(sheetId, "sheet identifier")}/questions/validate`, { method: "POST", body: { payload } });
  },
  importQuestions(sheetId, payload, publish = false) {
    return request(`/operations/admin/content/sheets/${id(sheetId, "sheet identifier")}/questions/import`, { method: "POST", body: { payload, publish: publish === true } });
  },
  bulkQuestions(questionIds, action, targetSheetId = null) {
    return request("/operations/admin/content/questions/bulk", { method: "POST", body: { question_ids: questionIds.map((value) => id(value, "question identifier")), action, target_sheet_id: targetSheetId ? id(targetSheetId, "target sheet identifier") : null } });
  },
  importHistory: (status = "") => request("/operations/admin/content/imports" + buildQueryString({ status })),
  undoImport(batchId) {
    const cleanId = id(batchId, "import batch identifier");
    return request(`/operations/admin/content/imports/${cleanId}/undo`, { method: "POST", body: { confirmation: `question_import_${cleanId}` } });
  },

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
  reviewManualPayment(paymentId, decision, reviewReason) {
    const cleanReason = typeof reviewReason === "string" ? reviewReason.trim() : "";
    if (!['approve', 'reject'].includes(decision) || cleanReason.length < 3) {
      throw new ApiError(0, null, "A valid review decision and reason are required.", "invalid_request");
    }
    return request(`/operations/admin/purchases/${id(paymentId, "purchase identifier")}/manual-review`, {
      method: "POST",
      body: { decision, reason: cleanReason },
      idempotencyKey: generateIdempotencyKey()
    });
  },
  /** @param {string} paymentId @param {{amountMinor?: number|string, refundReason?: string, idempotencyKey?: string}} [options] */
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
  createPlanVersion(body) {
    return request("/operations/admin/plans", {
      method: "POST",
      body: { ...body, reason: reason(body.reason) }
    });
  },
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
