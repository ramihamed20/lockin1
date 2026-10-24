import {
  ApiError,
  apiClient,
  isApiError,
  onUnauthorized,
  request
} from "../api/client.js";
import { accountsApi } from "../api/accounts.js";
import { normalizeOperationsSession } from "../api/contracts.js";

/** @type {Record<string, Promise<any>>} */
const earlySignInData = {};

/** Hands out an answer fetched at start-up once; later calls ask again. */
function takeEarly(name, load) {
  const early = earlySignInData[name];
  delete earlySignInData[name];
  return early || load();
}

/**
 * A device with no session will show the sign-in screen, which needs the study
 * paths and the sign-in providers. Ask for both alongside the session check
 * (main.jsx) instead of after the screen has mounted.
 */
export function prefetchSignInData() {
  earlySignInData.cohorts = accountsApi.listCohorts();
  earlySignInData.providers = accountsApi.oauthProviders();
  // The screen reads the outcome; an unread rejection is not an error here.
  Object.values(earlySignInData).forEach((early) => early.catch(() => undefined));
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
  listCohorts: () => takeEarly("cohorts", () => accountsApi.listCohorts()),
  oauthProviders: () => takeEarly("providers", () => accountsApi.oauthProviders()),
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
