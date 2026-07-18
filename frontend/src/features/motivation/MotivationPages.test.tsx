import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../i18n/I18nProvider";
import { ApiError } from "../../api/client";
import { NotificationsPage } from "./NotificationsPage";
import { ProgressionPage } from "./ProgressionPage";

const api = vi.hoisted(() => ({
  progressionApi: {
    xp: vi.fn(),
    streak: vi.fn(),
    achievements: vi.fn(),
    ranking: vi.fn(),
    rankingProfile: vi.fn(),
    saveRankingProfile: vi.fn()
  },
  notificationApi: {
    list: vi.fn(),
    preferences: vi.fn(),
    markAllRead: vi.fn(),
    markRead: vi.fn(),
    open: vi.fn(),
    savePreferences: vi.fn()
  }
}));

vi.mock("./api", () => api);

const profile = {
  included: true,
  display_mode: "initials" as const,
  updated_at: "2026-07-18T00:00:00Z"
};

function renderRoute(element: React.ReactNode) {
  return render(
    <MemoryRouter initialEntries={["/progression"]}>
      <I18nProvider>
        <Routes>
          <Route path="/progression" element={element} />
          <Route path="/learn" element={<h1>Learning destination</h1>} />
        </Routes>
      </I18nProvider>
    </MemoryRouter>
  );
}

describe("motivation and notification experience", () => {
  beforeEach(() => {
    localStorage.setItem("lockin.locale", "en");
    vi.clearAllMocks();
    api.progressionApi.xp.mockResolvedValue({
      total_points: 650,
      ranking_points: 600,
      transaction_count: 8,
      level: 2,
      level_progress: 150,
      level_target: 500,
      last_awarded_at: "2026-07-18T00:00:00Z"
    });
    api.progressionApi.streak.mockResolvedValue({
      current_days: 3,
      longest_days: 5,
      last_qualified_on: "2026-07-18",
      freeze_tokens_available: 0,
      policy: {
        title: "Meaningful learning days",
        version: 1,
        qualifying_activity_types: ["lesson.completed"],
        grace_days: 0,
        freeze_tokens_enabled: false
      }
    });
    api.progressionApi.achievements.mockResolvedValue([
      {
        code: "first_step",
        category: "learning",
        icon_key: "path",
        title: "First step",
        description: "Complete your first lesson.",
        current_value: 1,
        target_value: 1,
        earned_at: "2026-07-18T00:00:00Z"
      },
      {
        code: "deep_focus",
        category: "focus",
        icon_key: "focus",
        title: "Deep focus",
        description: "Accumulate 60 verified focus minutes.",
        current_value: 25,
        target_value: 60,
        earned_at: null
      }
    ]);
    api.progressionApi.ranking.mockResolvedValue({
      definition: {
        code: "learning_all_time",
        title: "Learning progress",
        period: "all_time",
        tie_strategy: "competition",
        rules: { summary: "Only verified learning evidence counts." }
      },
      snapshot: {
        id: "snapshot-1",
        generated_at: "2026-07-18T00:00:00Z",
        participant_count: 2,
        checksum: "abc"
      },
      entries: [
        { position: 1, score: 650, evidence_count: 8, display_name: "R. S.", is_me: true },
        { position: 2, score: 500, evidence_count: 6, display_name: "Learner 1234", is_me: false }
      ],
      own_entry: { position: 1, score: 650, evidence_count: 8, display_name: "R. S.", is_me: true }
    });
    api.progressionApi.rankingProfile.mockResolvedValue(profile);
    api.progressionApi.saveRankingProfile.mockResolvedValue({
      ...profile,
      included: false,
      display_mode: "anonymous"
    });
  });

  it("explains meaningful progression and saves server-owned ranking privacy", async () => {
    renderRoute(<ProgressionPage />);

    expect(await screen.findByRole("heading", { name: "Your learning momentum" })).toBeVisible();
    expect(screen.getByText("650")).toBeVisible();
    expect(screen.getByRole("heading", { name: "First step" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Deep focus" })).toBeVisible();
    fireEvent.click(screen.getByText("How this ranking works"));
    expect(screen.getByText("Only verified learning evidence counts.")).toBeVisible();

    fireEvent.click(screen.getByRole("checkbox", { name: "Include me in published ranking snapshots" }));
    fireEvent.change(screen.getByLabelText("How others see my name"), {
      target: { value: "anonymous" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Save ranking privacy" }));

    await waitFor(() =>
      expect(api.progressionApi.saveRankingProfile).toHaveBeenCalledWith({
        included: false,
        display_mode: "anonymous"
      })
    );
    expect(await screen.findByText("Ranking privacy saved.")).toBeVisible();
  });

  it("keeps notification actions scoped and exposes required preferences", async () => {
    api.notificationApi.list.mockResolvedValue({
      next: null,
      previous: null,
      results: [
        {
          id: "notification-1",
          category: "community",
          template_key: "community.reply",
          title: "New reply in your discussion",
          body: "A learner replied in a study discussion you follow.",
          data: {},
          actor_name: "Maya Student",
          target_type: "discussion",
          has_target: true,
          read_at: null,
          created_at: "2026-07-18T00:00:00Z"
        }
      ]
    });
    const preferences = [
      { category: "account", channel: "in_app", enabled: true, required: true, available: true },
      { category: "community", channel: "in_app", enabled: true, required: false, available: true },
      { category: "community", channel: "email", enabled: true, required: false, available: false }
    ];
    api.notificationApi.preferences.mockResolvedValue(preferences);
    api.notificationApi.open.mockResolvedValue({ route: "/learn" });
    api.notificationApi.savePreferences.mockResolvedValue(preferences);
    renderRoute(<NotificationsPage />);

    expect(await screen.findByRole("heading", { name: "Notifications" })).toBeVisible();
    expect(screen.getByText("New reply in your discussion")).toBeVisible();
    expect(screen.getByRole("checkbox", { name: /Account and security/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /Study discussions/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save preferences" }));
    await waitFor(() => expect(api.notificationApi.savePreferences).toHaveBeenCalled());
    expect(await screen.findByText("Notification preferences saved.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Open update" }));

    expect(await screen.findByRole("heading", { name: "Learning destination" })).toBeVisible();
    expect(api.notificationApi.open).toHaveBeenCalledWith("notification-1");
  });

  it("supports read actions and explains an unavailable safe target", async () => {
    const notifications = [
      {
        id: "notification-1",
        category: "account",
        template_key: "account.notice",
        title: "Account ready",
        body: "Your account is ready.",
        data: {},
        actor_name: null,
        target_type: "",
        has_target: false,
        read_at: null,
        created_at: "2026-07-18T00:00:00Z"
      },
      {
        id: "notification-2",
        category: "community",
        template_key: "community.reply",
        title: "A reply moved",
        body: "The discussion may no longer be available.",
        data: {},
        actor_name: null,
        target_type: "discussion",
        has_target: true,
        read_at: null,
        created_at: "2026-07-18T00:00:00Z"
      }
    ];
    api.notificationApi.list.mockResolvedValue({ next: null, previous: null, results: notifications });
    api.notificationApi.preferences.mockResolvedValue([]);
    api.notificationApi.markRead.mockResolvedValue({});
    api.notificationApi.markAllRead.mockResolvedValue({ updated: 1 });
    api.notificationApi.open.mockRejectedValue(
      new ApiError(410, { error: { message: "Gone" } })
    );
    renderRoute(<NotificationsPage />);

    await screen.findByText("Account ready");
    const firstReadAction = screen.getAllByRole("button", { name: "Mark as read" })[0];
    if (!firstReadAction) throw new Error("Expected an unread notification action.");
    fireEvent.click(firstReadAction);
    await waitFor(() => expect(api.notificationApi.markRead).toHaveBeenCalledWith("notification-1"));
    fireEvent.click(screen.getByRole("button", { name: "Mark all as read" }));
    await waitFor(() => expect(api.notificationApi.markAllRead).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Open update" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That destination is no longer available"
    );
  });

  it("shows an honest empty state before a ranking snapshot exists", async () => {
    api.progressionApi.ranking.mockResolvedValue({
      definition: {
        code: "learning_all_time",
        title: "Learning progress",
        period: "all_time",
        tie_strategy: "competition",
        rules: {}
      },
      snapshot: null,
      entries: [],
      own_entry: null
    });
    api.progressionApi.achievements.mockResolvedValue([]);
    renderRoute(<ProgressionPage />);

    expect(await screen.findByText("The first verified ranking snapshot has not been published yet.")).toBeVisible();
  });

  it("renders a new streak and an opted-out learner without inventing a rank", async () => {
    api.progressionApi.streak.mockResolvedValue({
      current_days: 1,
      longest_days: 1,
      last_qualified_on: "2026-07-18",
      freeze_tokens_available: 0,
      policy: {
        title: "Meaningful learning days",
        version: 1,
        qualifying_activity_types: ["lesson.completed"],
        grace_days: 0,
        freeze_tokens_enabled: false
      }
    });
    api.progressionApi.ranking.mockResolvedValue({
      definition: {
        code: "learning_all_time",
        title: "Learning progress",
        period: "all_time",
        tie_strategy: "competition",
        rules: {}
      },
      snapshot: {
        id: "snapshot-2",
        generated_at: "2026-07-18T00:00:00Z",
        participant_count: 0,
        checksum: "def"
      },
      entries: [],
      own_entry: null
    });
    renderRoute(<ProgressionPage />);

    expect(await screen.findByText("day")).toBeVisible();
    expect(screen.getByLabelText("Your position")).toHaveTextContent("0 Learning XP");
    fireEvent.click(screen.getByText("How this ranking works"));
    expect(screen.getAllByText("A snapshot of eligible learning evidence. It is not recalculated while you open this page.")).not.toHaveLength(0);
  });

  it("recovers when the progression summary initially fails to load", async () => {
    api.progressionApi.xp.mockRejectedValueOnce(new Error("temporary failure"));
    renderRoute(<ProgressionPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Something interrupted that request"
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("heading", { name: "Your learning momentum" })).toBeVisible();
    expect(api.progressionApi.xp).toHaveBeenCalledTimes(2);
  });

  it("recovers when notification loading is temporarily unavailable", async () => {
    api.notificationApi.list
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValue({ next: null, previous: null, results: [] });
    api.notificationApi.preferences.mockResolvedValue([]);
    renderRoute(<NotificationsPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Something interrupted that request"
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("heading", { name: "Notifications" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "You are all caught up" })).toBeVisible();
    expect(api.notificationApi.list).toHaveBeenCalledTimes(2);
  });
});
