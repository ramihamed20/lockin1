import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock("../../api/client", () => ({ apiRequest }));

import { notificationApi, progressionApi } from "./api";

describe("motivation API contracts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiRequest.mockResolvedValue({});
  });

  it("uses read-only progression endpoints and forwards cancellation", async () => {
    const controller = new AbortController();
    await progressionApi.xp(controller.signal);
    await progressionApi.xp();
    await progressionApi.streak(controller.signal);
    await progressionApi.achievements();
    await progressionApi.ranking(controller.signal);
    await progressionApi.rankingProfile();

    expect(apiRequest).toHaveBeenNthCalledWith(1, "/progression/xp", {
      signal: controller.signal
    });
    expect(apiRequest).toHaveBeenNthCalledWith(2, "/progression/xp", {});
    expect(apiRequest).toHaveBeenCalledWith("/progression/streak", {
      signal: controller.signal
    });
    expect(apiRequest).toHaveBeenCalledWith("/progression/achievements", {});
    expect(apiRequest).toHaveBeenCalledWith("/progression/rankings/current", {
      signal: controller.signal
    });
    expect(apiRequest).toHaveBeenCalledWith("/progression/rankings/profile", {});
  });

  it("sends only ranking privacy fields", async () => {
    await progressionApi.saveRankingProfile({ included: false, display_mode: "anonymous" });
    expect(apiRequest).toHaveBeenCalledWith("/progression/rankings/profile", {
      method: "PUT",
      body: { included: false, display_mode: "anonymous" }
    });
  });

  it("owns notification reads, navigation, counters, and preference payloads", async () => {
    const controller = new AbortController();
    await notificationApi.list(controller.signal);
    await notificationApi.list();
    await notificationApi.summary();
    await notificationApi.markRead("notice id");
    await notificationApi.markAllRead();
    await notificationApi.open("notice id");
    await notificationApi.preferences(controller.signal);
    await notificationApi.preferences();
    await notificationApi.savePreferences([
      {
        category: "community",
        channel: "in_app",
        enabled: false,
        required: false,
        available: true
      }
    ]);

    expect(apiRequest).toHaveBeenCalledWith("/notifications", { signal: controller.signal });
    expect(apiRequest).toHaveBeenCalledWith("/notifications", {});
    expect(apiRequest).toHaveBeenCalledWith("/notifications/summary", {});
    expect(apiRequest).toHaveBeenCalledWith("/notifications/notice%20id/read", {
      method: "POST"
    });
    expect(apiRequest).toHaveBeenCalledWith("/notifications/read-all", { method: "POST" });
    expect(apiRequest).toHaveBeenCalledWith("/notifications/notice%20id/open", {
      method: "POST"
    });
    expect(apiRequest).toHaveBeenCalledWith("/notifications/preferences", {
      method: "PUT",
      body: [{ category: "community", channel: "in_app", enabled: false }]
    });
  });
});
