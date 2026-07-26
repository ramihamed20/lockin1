import { ApiError, request, API_BASE_PATH } from "./client.js";
import { normalizePaginatedResponse } from "./contracts.js";
import { buildQueryString } from "./pagination.js";

function objectPayload(payload, message) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new ApiError(500, payload, message, "invalid_response");
  }
  return /** @type {Record<string, unknown>} */ (payload);
}

function pagePayload(payload, message) {
  const source = objectPayload(payload, message);
  if (!Array.isArray(source.results)) {
    throw new ApiError(500, payload, message, "invalid_response");
  }
  return normalizePaginatedResponse(source);
}

function listPayload(payload, message) {
  if (!Array.isArray(payload)) {
    throw new ApiError(500, payload, message, "invalid_response");
  }
  return payload;
}

function notificationCursor(next) {
  if (typeof next !== "string" || !next) return null;
  try {
    const url = new URL(next, "http://lock-in.invalid");
    const endpoint = `${API_BASE_PATH === "/" ? "" : API_BASE_PATH}/notifications`;
    return url.pathname === endpoint ? url.searchParams.get("cursor") : null;
  } catch {
    return null;
  }
}

/** Server-authoritative personal motivation, ranking, and notification APIs. */
export const motivationApi = {
  async xpSummary() {
    return objectPayload(await request("/progression/xp"), "The XP summary response was incomplete.");
  },

  async xpLedger({ page = 1, pageSize = 25 } = {}) {
    return pagePayload(
      await request("/progression/xp/ledger" + buildQueryString({ page, page_size: pageSize })),
      "The XP ledger response was incomplete."
    );
  },

  async streakSummary() {
    return objectPayload(await request("/progression/streak"), "The streak response was incomplete.");
  },

  async achievements() {
    return listPayload(await request("/progression/achievements"), "The achievement response was incomplete.");
  },

  /** @param {{code?: string}} [options] */
  async currentRanking(options = {}) {
    const code = options.code;
    return objectPayload(
      await request("/progression/rankings/current" + buildQueryString({ code })),
      "The ranking response was incomplete."
    );
  },

  async rankingProfile() {
    return objectPayload(
      await request("/progression/rankings/profile"),
      "The ranking-profile response was incomplete."
    );
  },

  async updateRankingProfile({ included, displayMode }) {
    return objectPayload(
      await request("/progression/rankings/profile", {
        method: "PUT",
        body: { included, display_mode: displayMode }
      }),
      "The ranking-profile response was incomplete."
    );
  },

  async listNotifications({ cursor = null, pageSize = 30, unreadOnly = false } = {}) {
    const payload = objectPayload(
      await request("/notifications" + buildQueryString({ cursor, page_size: pageSize, unread: unreadOnly ? "true" : null })),
      "The notification response was incomplete."
    );
    if (!Array.isArray(payload.results)) {
      throw new ApiError(500, payload, "The notification response was incomplete.", "invalid_response");
    }
    return {
      results: payload.results,
      nextCursor: notificationCursor(payload.next),
      previousCursor: notificationCursor(payload.previous)
    };
  },

  async notificationSummary() {
    return objectPayload(
      await request("/notifications/summary"),
      "The notification-summary response was incomplete."
    );
  },

  async markNotificationRead(notificationId) {
    return objectPayload(
      await request(`/notifications/${notificationId}/read`, { method: "POST", body: {} }),
      "The notification read response was incomplete."
    );
  },

  async openNotification(notificationId) {
    return objectPayload(
      await request(`/notifications/${notificationId}/open`, { method: "POST", body: {} }),
      "The notification destination response was incomplete."
    );
  },

  async markAllNotificationsRead() {
    return objectPayload(
      await request("/notifications/read-all", { method: "POST", body: {} }),
      "The notification read-all response was incomplete."
    );
  },

  async notificationPreferences() {
    return listPayload(
      await request("/notifications/preferences"),
      "The notification-preference response was incomplete."
    );
  },

  async updateNotificationPreferences(preferences) {
    const body = Array.isArray(preferences)
      ? preferences.map((item) => ({
          category: item?.category,
          channel: item?.channel,
          enabled: item?.enabled === true
        }))
      : [];
    return listPayload(
      await request("/notifications/preferences", { method: "PUT", body }),
      "The notification-preference response was incomplete."
    );
  }
};
