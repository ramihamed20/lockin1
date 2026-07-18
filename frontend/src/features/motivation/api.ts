import { apiRequest } from "../../api/client";
import type {
  Achievement,
  NotificationPage,
  NotificationPreference,
  Ranking,
  RankingProfile,
  StreakSummary,
  XpSummary
} from "./types";

export const progressionApi = {
  xp: (signal?: AbortSignal) =>
    apiRequest<XpSummary>("/progression/xp", signal ? { signal } : {}),
  streak: (signal?: AbortSignal) =>
    apiRequest<StreakSummary>("/progression/streak", signal ? { signal } : {}),
  achievements: (signal?: AbortSignal) =>
    apiRequest<Achievement[]>("/progression/achievements", signal ? { signal } : {}),
  ranking: (signal?: AbortSignal) =>
    apiRequest<Ranking>("/progression/rankings/current", signal ? { signal } : {}),
  rankingProfile: (signal?: AbortSignal) =>
    apiRequest<RankingProfile>("/progression/rankings/profile", signal ? { signal } : {}),
  saveRankingProfile: (profile: Pick<RankingProfile, "included" | "display_mode">) =>
    apiRequest<RankingProfile>("/progression/rankings/profile", {
      method: "PUT",
      body: profile
    })
};

export const notificationApi = {
  list: (signal?: AbortSignal) =>
    apiRequest<NotificationPage>("/notifications", signal ? { signal } : {}),
  summary: (signal?: AbortSignal) =>
    apiRequest<{ unread_count: number }>(
      "/notifications/summary",
      signal ? { signal } : {}
    ),
  markRead: (id: string) =>
    apiRequest(`/notifications/${encodeURIComponent(id)}/read`, { method: "POST" }),
  markAllRead: () =>
    apiRequest<{ updated: number }>("/notifications/read-all", { method: "POST" }),
  open: (id: string) =>
    apiRequest<{ route: string }>(`/notifications/${encodeURIComponent(id)}/open`, {
      method: "POST"
    }),
  preferences: (signal?: AbortSignal) =>
    apiRequest<NotificationPreference[]>(
      "/notifications/preferences",
      signal ? { signal } : {}
    ),
  savePreferences: (preferences: NotificationPreference[]) =>
    apiRequest<NotificationPreference[]>("/notifications/preferences", {
      method: "PUT",
      body: preferences.map(({ category, channel, enabled }) => ({ category, channel, enabled }))
    })
};
