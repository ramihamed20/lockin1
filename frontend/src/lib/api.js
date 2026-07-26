import {
  ApiError,
  apiClient,
  getSessionMarker,
  isApiError,
  onUnauthorized,
  request,
  setSessionMarker
} from "../api/client.js";
import { accountsApi } from "../api/accounts.js";
import { normalizeOperationsSession } from "../api/contracts.js";

function compatibilityBody(body) {
  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch {
      throw new ApiError(0, null, "This action has an invalid JSON payload.", "invalid_request");
    }
  }
  return body && typeof body === "object" ? body : {};
}

export class UnsupportedFeatureError extends ApiError {
  constructor(feature) {
    super(
      501,
      {
        error: {
          code: "feature_unavailable",
          message: feature + " is not available from the current Django API integration.",
          fields: null,
          request_id: null
        }
      },
      "This feature is not available.",
      "feature_unavailable"
    );
    this.name = "UnsupportedFeatureError";
  }
}

function unavailable(feature) {
  throw new UnsupportedFeatureError(feature);
}

/**
 * Legacy UI compatibility boundary. Domain mappings are deliberately deferred
 * to their scheduled phases instead of returning fabricated success data.
 * @param {string} path
 * @param {{method?: string, body?: unknown}} [options]
 */
export async function api(path, options = {}) {
  const method = (options.method || "GET").toUpperCase();

  if (path === "/api/profile" && method === "PUT") {
    const payload = compatibilityBody(options.body);
    return accountsApi.updateProfile({
      fullName: payload.name,
      preferredLanguage: payload.preferredLanguage
    });
  }

  if (path === "/api/profile/password" && method === "PUT") {
    const payload = compatibilityBody(options.body);
    return accountsApi.changePassword(payload.currentPassword, payload.newPassword, payload.newPassword);
  }

  unavailable("This screen");
}

export const authApi = {
  me: () => accountsApi.currentSession(),

  async operationsSession() {
    const payload = await request("/operations/session");
    const session = normalizeOperationsSession(payload);
    if (!session) {
      throw new ApiError(
        500,
        payload,
        "The operations-session response was incomplete.",
        "invalid_session"
      );
    }
    return session;
  },

  login: (payload) => accountsApi.login(payload),

  register: (payload) => accountsApi.register(payload),

  requestPasswordReset: (email) => accountsApi.requestPasswordReset(email),
  resendVerification: (email) => accountsApi.resendVerification(email),
  verifyEmail: (token) => accountsApi.verifyEmail(token),
  confirmPasswordReset: (token, password, passwordConfirm) =>
    accountsApi.confirmPasswordReset(token, password, passwordConfirm),
  confirmEmailChange: (token) => accountsApi.confirmEmailChange(token),

  logout: () => accountsApi.logout(),
  logoutAll: () => accountsApi.logoutAll()
};

// Compatibility aliases for existing callers. These never contain or transmit
// a token; the value is only the documented local session boot marker.
export function getToken() {
  return getSessionMarker();
}

export function setToken(value) {
  setSessionMarker(Boolean(value));
}

export {
  ApiError,
  apiClient,
  isApiError,
  onUnauthorized,
  request
};
