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
  listCohorts: () => accountsApi.listCohorts(),
  oauthProviders: () => accountsApi.oauthProviders(),
  startOAuth: (provider, payload) => accountsApi.startOAuth(provider, payload),
  updateProfile: (payload) => accountsApi.updateProfile(payload),
  completeWelcome: () => accountsApi.completeWelcome(),

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
