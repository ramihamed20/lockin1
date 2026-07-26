import {
  ApiError,
  clearCsrfToken,
  isApiError,
  request,
  setSessionMarker
} from "./client.js";
import { normalizeSessionResponse, normalizeUser } from "./contracts.js";

/**
 * Keeps the replacement's existing user prop shape while deriving it only
 * from Django's UserSerializer.
 * @param {unknown} user
 */
export function toAppUser(user) {
  const normalized = normalizeUser(user);
  if (!normalized) return null;
  return {
    id: normalized.id,
    email: normalized.email,
    name: normalized.full_name,
    roles: normalized.roles,
    preferredLanguage: normalized.preferred_language,
    emailVerified: normalized.is_email_verified,
    status: normalized.status,
    dateJoined: normalized.date_joined
  };
}

function userFromPayload(payload, fallbackMessage) {
  const source = payload && typeof payload === "object" ? payload : null;
  const user = toAppUser(source && "user" in source ? source.user : null);
  if (!user) throw new ApiError(500, payload, fallbackMessage, "invalid_response");
  return user;
}

export const accountsApi = {
  async currentSession() {
    let payload;
    try {
      payload = await request("/auth/session");
    } catch (error) {
      // DRF uses 403 for an anonymous request to this authentication-only
      // endpoint. It does not change how other forbidden responses are read.
      if (isApiError(error) && (error.status === 401 || error.status === 403)) {
        clearCsrfToken();
        setSessionMarker(false);
      }
      throw error;
    }
    const session = normalizeSessionResponse(payload);
    const user = toAppUser(session.user);
    if (!session.authenticated || !user) {
      throw new ApiError(500, payload, "The session response was incomplete.", "invalid_session");
    }
    return user;
  },

  async register({ fullName, email, password, passwordConfirm, preferredLanguage, acceptPolicies }) {
    return request("/auth/register", {
      method: "POST",
      body: {
        full_name: fullName,
        email,
        password,
        password_confirm: passwordConfirm,
        preferred_language: preferredLanguage,
        accept_policies: acceptPolicies
      }
    });
  },

  verifyEmail: (token) => request("/auth/verify-email", { method: "POST", body: { token } }),
  resendVerification: (email) =>
    request("/auth/resend-verification", { method: "POST", body: { email } }),
  requestPasswordReset: (email) =>
    request("/auth/password-reset", { method: "POST", body: { email } }),
  confirmPasswordReset: (token, password, passwordConfirm) =>
    request("/auth/password-reset/confirm", {
      method: "POST",
      body: { token, new_password: password, new_password_confirm: passwordConfirm }
    }),

  async login({ email, password, remember }) {
    const payload = await request("/auth/login", {
      method: "POST",
      body: { email, password, remember_me: Boolean(remember) }
    });
    const user = userFromPayload(payload, "The login response was incomplete.");
    // Django rotates CSRF state on login. Do not reuse a pre-login token.
    clearCsrfToken();
    setSessionMarker(true);
    return { user };
  },

  async logout() {
    const result = await request("/auth/logout", { method: "POST" });
    clearCsrfToken();
    setSessionMarker(false);
    return result;
  },

  async logoutAll() {
    const result = await request("/auth/logout-all", { method: "POST" });
    clearCsrfToken();
    setSessionMarker(false);
    return result;
  },

  async getProfile() {
    return userFromPayload(await request("/account/profile"), "The profile response was incomplete.");
  },

  async updateProfile({ fullName, preferredLanguage }) {
    const body = {};
    if (typeof fullName === "string") body.full_name = fullName;
    if (typeof preferredLanguage === "string") body.preferred_language = preferredLanguage;
    return userFromPayload(
      await request("/account/profile", {
        method: "PATCH",
        body
      }),
      "The profile response was incomplete."
    );
  },

  changePassword: (currentPassword, newPassword, newPasswordConfirm) =>
    request("/account/password", {
      method: "POST",
      body: {
        current_password: currentPassword,
        new_password: newPassword,
        new_password_confirm: newPasswordConfirm
      }
    }),

  requestEmailChange: (newEmail, currentPassword) =>
    request("/account/email", {
      method: "POST",
      body: { new_email: newEmail, current_password: currentPassword }
    }),
  confirmEmailChange: (token) =>
    request("/account/email/confirm", { method: "POST", body: { token } }),

  async listSessions() {
    const payload = await request("/account/sessions");
    const source = payload && typeof payload === "object"
      ? /** @type {{sessions?: unknown}} */ (payload)
      : null;
    if (!source || !Array.isArray(source.sessions)) {
      throw new ApiError(500, payload, "The sessions response was incomplete.", "invalid_response");
    }
    return source.sessions;
  },
  revokeSession: (sessionId) => request(`/account/sessions/${sessionId}`, { method: "DELETE" })
};
