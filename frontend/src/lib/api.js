import {
  ApiError,
  apiClient,
  isApiError,
  onUnauthorized,
  request
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
  completeWelcome: (preferences) => accountsApi.completeWelcome(preferences),

  requestPasswordReset: (email) => accountsApi.requestPasswordReset(email),
  resendVerification: (email) => accountsApi.resendVerification(email),
  verifyEmailCode: (payload) => accountsApi.verifyEmailCode(payload),
  confirmPasswordReset: (token, password, passwordConfirm) =>
    accountsApi.confirmPasswordReset(token, password, passwordConfirm),
  confirmEmailChange: (token) => accountsApi.confirmEmailChange(token),

  logout: () => accountsApi.logout(),
  logoutAll: () => accountsApi.logoutAll()
};

export {
  ApiError,
  apiClient,
  isApiError,
  onUnauthorized,
  request
};
