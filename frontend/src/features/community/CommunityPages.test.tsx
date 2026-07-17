import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../../api/client";
import { I18nProvider } from "../../i18n/I18nProvider";
import { CommunityPage } from "./CommunityPage";
import { DiscussionPage } from "./DiscussionPage";
import { ModerationPage } from "./ModerationPage";
import { SpacePage } from "./SpacePage";

const api = vi.hoisted(() => ({
  discussions: vi.fn(), nextDiscussions: vi.fn(), discussion: vi.fn(), createDiscussion: vi.fn(),
  deleteDiscussion: vi.fn(), comments: vi.fn(), nextComments: vi.fn(), createComment: vi.fn(),
  deleteComment: vi.fn(), spaces: vi.fn(), space: vi.fn(), createSpace: vi.fn(),
  inviteSpaceMember: vi.fn(), createReport: vi.fn(), reports: vi.fn(), nextReports: vi.fn(),
  transitionReport: vi.fn(), moderationAudit: vi.fn()
}));
vi.mock("./api", () => api);

const user = {
  id: "student-1",
  email: "student@example.com",
  full_name: "Rami Student",
  roles: ["student"]
};
vi.mock("../auth/AuthProvider", () => ({ useAuth: () => ({ user }) }));

const author = { id: "author-1", full_name: "Maya Student", badges: ["creator"] };
const discussion = {
  id: "discussion-1",
  author,
  space_id: null,
  space_title: null,
  context_type: "lesson",
  context_id: "lesson-1",
  context_title: "Cranial nerves",
  context_route: "/learn/nodes/lesson-1",
  title: "How does the facial nerve pathway connect?",
  body: "I understand the origin but need help connecting the pathway to the clinical finding.",
  status: "active",
  revision: 1,
  comment_count: 0,
  last_activity_at: "2026-07-17T10:00:00Z",
  created_at: "2026-07-17T10:00:00Z",
  updated_at: "2026-07-17T10:00:00Z",
  can_edit: false,
  can_delete: false
};
const emptyPage = { next: null, previous: null, results: [] };

function route(path: string, routePath: string, element: React.ReactNode) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <I18nProvider>
        <Routes><Route path={routePath} element={element} /></Routes>
      </I18nProvider>
    </MemoryRouter>
  );
}

describe("contextual community experience", () => {
  beforeEach(() => {
    localStorage.setItem("lockin.locale", "en");
    vi.clearAllMocks();
    user.roles = ["student"];
    api.discussions.mockResolvedValue(emptyPage);
    api.spaces.mockResolvedValue(emptyPage);
    api.comments.mockResolvedValue(emptyPage);
    api.moderationAudit.mockResolvedValue(emptyPage);
  });

  it("starts a discussion only from an explicit learning context", async () => {
    api.createDiscussion.mockResolvedValue(discussion);
    route(
      "/community/context/lesson/lesson-1?label=Cranial%20nerves",
      "/community/context/:contextType/:contextId",
      <CommunityPage />
    );

    expect(await screen.findByRole("heading", { name: "Cranial nerves" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Ask about this" }));
    fireEvent.change(screen.getByLabelText("Question or discussion title"), {
      target: { value: discussion.title }
    });
    fireEvent.change(screen.getByLabelText("What are you trying to understand?"), {
      target: { value: discussion.body }
    });
    fireEvent.click(screen.getByRole("button", { name: "Publish discussion" }));

    await waitFor(() => expect(api.createDiscussion).toHaveBeenCalledWith({
      context_type: "lesson",
      context_id: "lesson-1",
      title: discussion.title,
      body: discussion.body
    }));
    expect(await screen.findByRole("link", { name: discussion.title })).toBeVisible();
  });

  it("keeps the global community as a contextual feed without a standalone composer", async () => {
    api.discussions.mockResolvedValue({ ...emptyPage, results: [discussion] });
    route("/community", "/community", <CommunityPage />);
    expect(await screen.findByRole("heading", { name: "Questions grounded in what you study." })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Ask about this" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Cranial nerves" })).toHaveAttribute("href", "/learn/nodes/lesson-1");
  });

  it("filters creator spaces by context and appends stable cursor pages", async () => {
    user.roles = ["student", "creator"];
    api.discussions.mockResolvedValue({ ...emptyPage, next: "next-page", results: [discussion] });
    api.nextDiscussions.mockResolvedValue({
      ...emptyPage,
      results: [{ ...discussion, id: "discussion-2", title: "A second contextual question" }]
    });
    api.spaces.mockResolvedValue({
      ...emptyPage,
      results: [
        {
          id: "space-1", owner: author, context_type: "lesson", context_id: "lesson-1",
          context_title: "Cranial nerves", context_route: "/learn/nodes/lesson-1",
          title: "Clinical room", description: "", status: "active", revision: 1,
          member_count: 3, membership_role: "owner", can_manage: true,
          created_at: discussion.created_at, updated_at: discussion.updated_at
        },
        {
          id: "space-2", owner: author, context_type: "lesson", context_id: "lesson-2",
          context_title: "Other lesson", context_route: "/learn/nodes/lesson-2",
          title: "Other room", description: "", status: "active", revision: 1,
          member_count: 2, membership_role: "member", can_manage: false,
          created_at: discussion.created_at, updated_at: discussion.updated_at
        }
      ]
    });
    route(
      "/community/context/lesson/lesson-1",
      "/community/context/:contextType/:contextId",
      <CommunityPage />
    );
    expect(await screen.findByRole("link", { name: /Clinical room/ })).toBeVisible();
    expect(screen.queryByText("Other room")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create private space" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Load more discussions" }));
    expect(await screen.findByRole("link", { name: "A second contextual question" })).toBeVisible();
    expect(api.nextDiscussions).toHaveBeenCalledWith("next-page");
  });

  it("surfaces contextual loading failures", async () => {
    api.discussions.mockRejectedValueOnce(
      new ApiError(503, { error: { message: "Community is temporarily unavailable." } })
    );
    route("/community", "/community", <CommunityPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Community is temporarily unavailable."
    );
  });

  it("adds a reply and keeps reports scoped to the selected discussion", async () => {
    api.discussion.mockResolvedValue(discussion);
    api.createComment.mockResolvedValue({
      id: "comment-1",
      discussion_id: discussion.id,
      parent_id: null,
      author: { id: user.id, full_name: user.full_name, badges: [] },
      body: "Trace the larger landmark first, then follow the border.",
      status: "active",
      revision: 1,
      created_at: "2026-07-17T11:00:00Z",
      updated_at: "2026-07-17T11:00:00Z",
      can_edit: true,
      can_delete: true
    });
    route(
      `/community/discussions/${discussion.id}`,
      "/community/discussions/:discussionId",
      <DiscussionPage />
    );
    expect(await screen.findByRole("heading", { name: discussion.title })).toBeVisible();
    fireEvent.change(screen.getByLabelText("Add a useful explanation"), {
      target: { value: "Trace the larger landmark first, then follow the border." }
    });
    fireEvent.click(screen.getByRole("button", { name: "Post reply" }));
    expect(await screen.findByText("Trace the larger landmark first, then follow the border.")).toBeVisible();
    expect(api.createComment).toHaveBeenCalledWith(
      discussion.id,
      "Trace the larger landmark first, then follow the border.",
      undefined
    );
  });

  it("handles deletion, nested replies, tombstones, and comment cursors", async () => {
    const root = {
      id: "comment-root", discussion_id: discussion.id, parent_id: null,
      author: { id: user.id, full_name: user.full_name, badges: [] },
      body: "Start from the larger landmark.", status: "active", revision: 1,
      created_at: discussion.created_at, updated_at: discussion.updated_at,
      can_edit: true, can_delete: true
    };
    const child = {
      ...root, id: "comment-child", parent_id: root.id,
      author, body: "Then follow the border.", can_edit: false, can_delete: true
    };
    api.discussion.mockResolvedValue({ ...discussion, can_delete: true });
    api.comments.mockResolvedValue({ next: "next-comments", previous: null, results: [root, child] });
    api.deleteDiscussion.mockResolvedValue({
      ...discussion, title: null, body: null, status: "author_deleted", revision: 2
    });
    api.deleteComment.mockImplementation((item: typeof root) => Promise.resolve({
      ...item, body: null, status: "author_deleted", revision: item.revision + 1
    }));
    api.nextComments.mockResolvedValue({
      ...emptyPage,
      results: [{ ...root, id: "comment-more", body: "A later explanation.", can_delete: false }]
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    route(
      `/community/discussions/${discussion.id}`,
      "/community/discussions/:discussionId",
      <DiscussionPage />
    );
    await screen.findByRole("heading", { name: discussion.title });
    fireEvent.click(screen.getAllByRole("button", { name: "Delete" })[0]!);
    await waitFor(() => expect(api.deleteDiscussion).toHaveBeenCalled());
    expect(await screen.findByRole("heading", { name: "Discussion no longer available" })).toBeVisible();
    fireEvent.click(screen.getAllByRole("button", { name: "Delete" })[0]!);
    await waitFor(() => expect(api.deleteComment).toHaveBeenCalledWith(root));
    expect(await screen.findByText("This reply is no longer available.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Load more replies" }));
    expect(await screen.findByText("A later explanation.")).toBeVisible();
  });

  it("keeps locked discussions readable and respects cancelled deletion", async () => {
    api.discussion.mockResolvedValue({
      ...discussion,
      status: "locked",
      can_delete: true,
      comment_count: 1
    });
    api.comments.mockResolvedValue({
      ...emptyPage,
      results: [{
        id: "comment-root", discussion_id: discussion.id, parent_id: null,
        author, body: "A preserved explanation.", status: "active", revision: 1,
        created_at: discussion.created_at, updated_at: discussion.updated_at,
        can_edit: false, can_delete: false
      }]
    });
    vi.spyOn(window, "confirm").mockReturnValue(false);
    route(
      `/community/discussions/${discussion.id}`,
      "/community/discussions/:discussionId",
      <DiscussionPage />
    );
    expect(await screen.findByText("This discussion is locked. Existing explanations remain available for study.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Post reply" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(api.deleteDiscussion).not.toHaveBeenCalled();
    expect(screen.getByText("A preserved explanation.")).toBeVisible();
  });

  it("invites a private-space member by university email", async () => {
    api.space.mockResolvedValue({
      id: "space-1",
      owner: author,
      context_type: "lesson",
      context_id: "lesson-1",
      context_title: "Cranial nerves",
      context_route: "/learn/nodes/lesson-1",
      title: "Clinical pathway room",
      description: "Compare reasoning around this lesson.",
      status: "active",
      revision: 1,
      member_count: 2,
      membership_role: "owner",
      can_manage: true,
      created_at: "2026-07-17T10:00:00Z",
      updated_at: "2026-07-17T10:00:00Z"
    });
    api.inviteSpaceMember.mockResolvedValue({ user_id: "student-2", role: "member", status: "active" });
    route("/community/spaces/space-1", "/community/spaces/:spaceId", <SpacePage />);
    expect(await screen.findByRole("heading", { name: "Clinical pathway room" })).toBeVisible();
    fireEvent.change(screen.getByLabelText("University email"), { target: { value: "new@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Add to space" }));
    await waitFor(() => expect(api.inviteSpaceMember).toHaveBeenCalledWith("space-1", "new@example.com", "member"));
    expect(await screen.findByText("The student now has access to this study space.")).toBeVisible();
  });

  it("keeps private-space errors actionable", async () => {
    api.space.mockRejectedValue(
      new ApiError(404, { error: { message: "Creator space not found." } })
    );
    route("/community/spaces/missing", "/community/spaces/:spaceId", <SpacePage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Creator space not found.");
  });

  it("renders a member-only space without owner controls", async () => {
    api.space.mockResolvedValue({
      id: "space-2", owner: author, context_type: "lesson", context_id: "lesson-1",
      context_title: "Cranial nerves", context_route: "/learn/nodes/lesson-1",
      title: "Member room", description: "", status: "active", revision: 1,
      member_count: 4, membership_role: "member", can_manage: false,
      created_at: discussion.created_at, updated_at: discussion.updated_at
    });
    api.discussions.mockResolvedValue({ ...emptyPage, results: [discussion] });
    route("/community/spaces/space-2", "/community/spaces/:spaceId", <SpacePage />);
    expect(await screen.findByRole("heading", { name: "Member room" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Invite by university email" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: discussion.title })).toBeVisible();
  });

  it("shows preserved evidence and sends revision-aware moderation decisions", async () => {
    const report = {
      id: "report-1",
      reporter_id: "student-2",
      reporter_name: "Nora Student",
      target_type: "discussion",
      target_id: discussion.id,
      target_label: discussion.title,
      context_type: "lesson",
      context_id: "lesson-1",
      private_space_id: null,
      reason: "abuse",
      description: "This language is abusive and distracts from the learning discussion.",
      status: "open",
      priority: "important",
      assigned_to_id: null,
      assigned_to_name: null,
      duplicate_of_id: null,
      resolution_notes: "",
      revision: 3,
      resolved_at: null,
      created_at: "2026-07-17T10:00:00Z",
      updated_at: "2026-07-17T10:00:00Z",
      can_manage: true,
      evidence_snapshot: { body: discussion.body }
    };
    api.reports.mockResolvedValue({ ...emptyPage, results: [report] });
    api.moderationAudit.mockResolvedValue({
      ...emptyPage,
      results: [{
        id: "audit-1", report_id: "report-1", actor_id: "moderator-1",
        actor_name: "Mona Moderator", action: "report_created", target_type: "discussion",
        target_id: discussion.id, reason: "abuse", metadata: {},
        created_at: "2026-07-17T10:01:00Z"
      }]
    });
    api.transitionReport.mockResolvedValue({ ...report, status: "resolved", revision: 4 });
    route("/moderation", "/moderation", <ModerationPage />);

    expect(await screen.findByText("Evidence captured when reported")).toBeVisible();
    fireEvent.change(screen.getByLabelText("Decision"), { target: { value: "resolved" } });
    fireEvent.change(screen.getByLabelText("Content action"), { target: { value: "remove" } });
    fireEvent.change(screen.getByLabelText("Review notes"), {
      target: { value: "Confirmed after an independent review of the preserved evidence." }
    });
    fireEvent.click(screen.getByRole("button", { name: "Record decision" }));
    await waitFor(() => expect(api.transitionReport).toHaveBeenCalledWith(report, {
      status: "resolved",
      resolution_notes: "Confirmed after an independent review of the preserved evidence.",
      content_action: "remove"
    }));
    expect(screen.getByText("Mona Moderator")).toBeVisible();
  });

  it("shows a clear queue and contains moderation fetch failures", async () => {
    api.reports.mockResolvedValue(emptyPage);
    api.moderationAudit.mockRejectedValue(new Error("audit unavailable"));
    const view = route("/moderation", "/moderation", <ModerationPage />);
    expect(await screen.findByRole("heading", { name: "No reports need attention" })).toBeVisible();
    expect(screen.getByText("No moderation actions are visible in your scope yet.")).toBeVisible();
    view.unmount();

    api.reports.mockRejectedValue(
      new ApiError(403, { error: { message: "Moderation workspace permission is required." } })
    );
    route("/moderation", "/moderation", <ModerationPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Moderation workspace permission is required."
    );
  });

  it("shows non-community evidence without offering conflicted actions", async () => {
    api.reports.mockResolvedValue({
      ...emptyPage,
      results: [{
        id: "report-question", reporter_id: user.id, reporter_name: user.full_name,
        target_type: "question", target_id: "question-1", target_label: "Which nerve?",
        context_type: "question", context_id: "question-1", private_space_id: null,
        reason: "incorrect_question", description: "The wording may have two valid answers.",
        status: "open", priority: "routine", assigned_to_id: null, assigned_to_name: null,
        duplicate_of_id: null, resolution_notes: "", revision: 1, resolved_at: null,
        created_at: discussion.created_at, updated_at: discussion.updated_at,
        can_manage: false, evidence_snapshot: { prompt: "Which nerve controls this pathway?" }
      }]
    });
    route("/moderation", "/moderation", <ModerationPage />);
    expect(await screen.findByText("Which nerve controls this pathway?")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Record decision" })).not.toBeInTheDocument();
  });
});
