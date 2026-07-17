import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../../api/client";
import { I18nProvider } from "../../i18n/I18nProvider";
import { AuthorLine } from "./components/AuthorLine";
import { CommentComposer } from "./components/CommentComposer";
import { DiscussionCard } from "./components/DiscussionCard";
import { DiscussionComposer } from "./components/DiscussionComposer";
import { ReportComposer } from "./components/ReportComposer";
import { SpaceComposer } from "./components/SpaceComposer";

const api = vi.hoisted(() => ({
  createComment: vi.fn(),
  createDiscussion: vi.fn(),
  createReport: vi.fn(),
  createSpace: vi.fn()
}));
vi.mock("./api", () => api);

const author = {
  id: "author-1",
  full_name: "Maya Creator",
  badges: ["creator", "moderator"] as Array<"creator" | "moderator">
};
const discussion = {
  id: "discussion-1",
  author,
  space_id: null,
  space_title: null,
  context_type: "lesson" as const,
  context_id: "lesson-1",
  context_title: "Cranial nerves",
  context_route: "/learn/nodes/lesson-1",
  title: "How does this pathway connect clinically?",
  body: "I followed the first branch, but I need help connecting it to the clinical finding.",
  status: "active" as const,
  revision: 1,
  comment_count: 2,
  last_activity_at: "2026-07-17T10:00:00Z",
  created_at: "2026-07-17T10:00:00Z",
  updated_at: "2026-07-17T10:00:00Z",
  can_edit: false,
  can_delete: false
};

function shell(children: React.ReactNode) {
  return render(<MemoryRouter><I18nProvider>{children}</I18nProvider></MemoryRouter>);
}

describe("community interaction components", () => {
  beforeEach(() => {
    localStorage.setItem("lockin.locale", "en");
    vi.clearAllMocks();
  });

  it("renders role badges, contextual links, reply counts, and tombstones", () => {
    shell(<><AuthorLine author={author} date={discussion.created_at} /><DiscussionCard item={discussion} /></>);
    expect(screen.getAllByText("Creator").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Moderator").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: discussion.title })).toHaveAttribute(
      "href",
      `/community/discussions/${discussion.id}`
    );
    expect(screen.getByText("2 replies")).toBeVisible();

    shell(<DiscussionCard item={{ ...discussion, title: null, body: null, status: "author_deleted" }} />);
    expect(screen.getByText("Discussion no longer available")).toBeVisible();
  });

  it("submits and cancels a contextual discussion while surfacing API errors", async () => {
    const onCreated = vi.fn();
    api.createDiscussion.mockRejectedValueOnce(
      new ApiError(429, { error: { message: "Please wait before posting again." } })
    );
    shell(
      <DiscussionComposer
        contextType="lesson"
        contextId="lesson-1"
        spaceId="space-1"
        onCreated={onCreated}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Ask about this" }));
    fireEvent.change(screen.getByLabelText("Question or discussion title"), {
      target: { value: discussion.title }
    });
    fireEvent.change(screen.getByLabelText("What are you trying to understand?"), {
      target: { value: discussion.body }
    });
    fireEvent.click(screen.getByRole("button", { name: "Publish discussion" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Please wait before posting again.");
    fireEvent.click(screen.getByRole("button", { name: "Cancel editing" }));
    expect(screen.getByRole("button", { name: "Ask about this" })).toBeVisible();
  });

  it("creates a nested reply, invokes cancel, and preserves errors for retry", async () => {
    const created = {
      id: "comment-2",
      discussion_id: discussion.id,
      parent_id: "comment-1",
      author,
      body: "This answer follows the landmark.",
      status: "active",
      revision: 1,
      created_at: discussion.created_at,
      updated_at: discussion.updated_at,
      can_edit: true,
      can_delete: true
    };
    const onCreated = vi.fn();
    const onCancel = vi.fn();
    api.createComment.mockResolvedValue(created);
    shell(
      <CommentComposer
        discussionId={discussion.id}
        parentId="comment-1"
        onCreated={onCreated}
        onCancel={onCancel}
      />
    );
    fireEvent.change(screen.getByLabelText("Reply to this explanation"), {
      target: { value: created.body }
    });
    fireEvent.click(screen.getByRole("button", { name: "Post reply" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(created));
    expect(onCancel).toHaveBeenCalledOnce();

    api.createComment.mockRejectedValueOnce(new Error("offline"));
    fireEvent.change(screen.getByLabelText("Reply to this explanation"), {
      target: { value: "A second explanation for the error path." }
    });
    fireEvent.click(screen.getByRole("button", { name: "Post reply" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Something interrupted");
    fireEvent.click(screen.getByRole("button", { name: "Cancel editing" }));
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it("creates a contextual private space and reports content", async () => {
    const onCreated = vi.fn();
    const createdSpace = {
      id: "space-1",
      title: "Clinical room",
      description: "Private study",
      context_type: "lesson",
      context_id: "lesson-1"
    };
    api.createSpace.mockResolvedValue(createdSpace);
    api.createReport.mockResolvedValue({ id: "report-1" });
    shell(
      <>
        <SpaceComposer contextType="lesson" contextId="lesson-1" onCreated={onCreated} />
        <ReportComposer targetType="discussion" targetId={discussion.id} />
      </>
    );
    fireEvent.click(screen.getByRole("button", { name: "Create private space" }));
    fireEvent.change(screen.getByLabelText("Space name"), { target: { value: "Clinical room" } });
    fireEvent.change(screen.getByLabelText("Purpose and expectations"), {
      target: { value: "Compare clinical reasoning." }
    });
    fireEvent.click(screen.getByRole("button", { name: "Create study space" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(createdSpace));

    fireEvent.click(screen.getByRole("button", { name: "Report" }));
    fireEvent.change(screen.getByLabelText("Reason for review"), { target: { value: "abuse" } });
    fireEvent.change(screen.getByLabelText("Explain the issue"), {
      target: { value: "This language is abusive and unrelated to learning." }
    });
    fireEvent.click(screen.getByRole("button", { name: "Send report" }));
    await waitFor(() => expect(api.createReport).toHaveBeenCalledWith({
      target_type: "discussion",
      target_id: discussion.id,
      reason: "abuse",
      description: "This language is abusive and unrelated to learning."
    }));
    expect(await screen.findByText("Your report was recorded for independent review.")).toBeVisible();
  });

  it("keeps space and report forms open after failures", async () => {
    api.createSpace.mockRejectedValue(new Error("offline"));
    api.createReport.mockRejectedValue(
      new ApiError(400, { error: { message: "This report is already open." } })
    );
    shell(
      <>
        <SpaceComposer contextType="learning_object" contextId="content-1" onCreated={vi.fn()} />
        <ReportComposer targetType="comment" targetId="comment-1" compact />
      </>
    );
    fireEvent.click(screen.getByRole("button", { name: "Create private space" }));
    fireEvent.change(screen.getByLabelText("Space name"), { target: { value: "Review room" } });
    fireEvent.click(screen.getByRole("button", { name: "Create study space" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Something interrupted");
    fireEvent.click(screen.getByRole("button", { name: "Cancel editing" }));

    fireEvent.click(screen.getByRole("button", { name: "Report" }));
    fireEvent.change(screen.getByLabelText("Explain the issue"), {
      target: { value: "This reply is duplicated and needs review." }
    });
    fireEvent.click(screen.getByRole("button", { name: "Send report" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This report is already open.");
    expect(screen.getByLabelText("Explain the issue")).toBeVisible();
  });
});
