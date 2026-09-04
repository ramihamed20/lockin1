import {
  ApiError,
  clearCsrfToken,
  isApiError,
  request,
  setSessionMarker
} from "./client.js";
import { normalizeCohort, normalizeSessionResponse, normalizeUser } from "./contracts.js";

const OAUTH_AUTHORIZATION_ORIGINS = Object.freeze({
  google: "https://accounts.google.com",
  apple: "https://appleid.apple.com"
});

export function isTrustedOAuthAuthorizationUrl(provider, value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.origin === OAUTH_AUTHORIZATION_ORIGINS[provider];
  } catch {
    return false;
  }
}

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
    username: normalized.username,
    name: normalized.full_name,
    roles: normalized.roles,
    preferredLanguage: normalized.preferred_language,
    cohort: normalized.cohort,
    onboardingRequired: normalized.onboarding_required,
    requiredProfileFields: normalized.required_profile_fields,
    usernameRequired: normalized.username_required,
    welcomeRequired: normalized.welcome_required,
    welcomeCompletedAt: normalized.welcome_completed_at,
    emailVerified: normalized.is_email_verified,
    status: normalized.status,
    dateJoined: normalized.date_joined,
    avatar: normalized.avatar
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

  async register({ fullName, email, password, passwordConfirm, preferredLanguage, cohortId, acceptPolicies }) {
    return request("/auth/register", {
      method: "POST",
      body: {
        full_name: fullName,
        email,
        password,
        password_confirm: passwordConfirm,
        preferred_language: preferredLanguage,
        cohort_id: cohortId,
        accept_policies: acceptPolicies
      }
    });
  },

  async listCohorts() {
    const payload = await request("/auth/cohorts");
    const source = payload && typeof payload === "object"
      ? /** @type {{cohorts?: unknown}} */ (payload)
      : null;
    if (!source || !Array.isArray(source.cohorts)) {
      throw new ApiError(500, payload, "The cohort list was incomplete.", "invalid_response");
    }
    return source.cohorts.map(normalizeCohort).filter(Boolean);
  },

  async oauthProviders() {
    const payload = await request("/auth/oauth/providers");
    const source = payload && typeof payload === "object"
      ? /** @type {{providers?: unknown}} */ (payload)
      : null;
    const providers = source?.providers && typeof source.providers === "object"
      ? /** @type {Record<string, unknown>} */ (source.providers)
      : null;
    if (!providers) {
      throw new ApiError(500, payload, "The sign-in provider status was incomplete.", "invalid_response");
    }
    return { google: providers.google === true, apple: providers.apple === true };
  },

  async startOAuth(provider, { intent, preferredLanguage, remember, acceptPolicies }) {
    if (!(provider in OAUTH_AUTHORIZATION_ORIGINS)) {
      throw new ApiError(400, null, "This sign-in provider is not supported.", "unsupported_provider");
    }
    const payload = await request(`/auth/oauth/${provider}/start`, {
      method: "POST",
      body: {
        intent,
        preferred_language: preferredLanguage,
        remember_me: Boolean(remember),
        accept_policies: Boolean(acceptPolicies)
      }
    });
    const authorizationUrl = payload && typeof payload === "object"
      ? /** @type {{authorization_url?: unknown}} */ (payload).authorization_url
      : null;
    if (typeof authorizationUrl !== "string" || !isTrustedOAuthAuthorizationUrl(provider, authorizationUrl)) {
      throw new ApiError(500, payload, "The sign-in redirect was invalid.", "invalid_oauth_redirect");
    }
    return authorizationUrl;
  },

  async verifyEmail(token) {
    const payload = await request("/auth/verify-email", { method: "POST", body: { token } });
    const source = payload && typeof payload === "object" ? payload : null;
    // A verified account that may sign in is signed in by the server, in the
    // same response. Nothing about the session travels in the URL: the cookie
    // is set on this request and the body carries only the public user record.
    const user = toAppUser(source && "user" in source ? source.user : null);
    if (user) {
      // Django rotates CSRF state on login, exactly as it does for a password
      // sign-in. Do not reuse a token minted before this response.
      clearCsrfToken();
      setSessionMarker(true);
    }
    return { status: source?.status || "verified", user };
  },
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

  async updateProfile({ username = undefined, fullName = undefined, preferredLanguage = undefined, cohortId = undefined, avatarDefault = undefined }) {
    const body = {};
    if (typeof username === "string") body.username = username;
    if (typeof fullName === "string") body.full_name = fullName;
    if (typeof preferredLanguage === "string") body.preferred_language = preferredLanguage;
    if (typeof cohortId === "string") body.cohort_id = cohortId;
    if (typeof avatarDefault === "string") body.avatar_default = avatarDefault;
    return userFromPayload(
      await request("/account/profile", {
        method: "PATCH",
        body
      }),
      "The profile response was incomplete."
    );
  },

  async uploadProfileAvatar(file) {
    if (typeof File === "undefined" || !(file instanceof File)) {
      throw new ApiError(0, null, "Choose an image before saving.", "invalid_request");
    }
    const body = new FormData();
    body.append("file", file);
    return userFromPayload(
      await request("/account/profile/avatar", { method: "POST", body }),
      "The profile image response was incomplete."
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
  revokeSession: (sessionId) => request(`/account/sessions/${sessionId}`, { method: "DELETE" }),
  getDeletionStatus: () => request("/account/deletion"),
  requestDeletion: (currentPassword) =>
    request("/account/deletion", {
      method: "POST",
      body: { current_password: currentPassword }
    }),
  confirmDeletion: (token) =>
    request("/account/deletion/confirm", { method: "POST", body: { token } }),
  cancelDeletion: (currentPassword) =>
    request("/account/deletion", {
      method: "DELETE",
      body: { current_password: currentPassword }
    })
};

accountsApi.completeWelcome = async function completeWelcome() {
  return userFromPayload(
    await request("/account/welcome/complete", { method: "POST", body: {} }),
    "The welcome response was incomplete."
  );
};
