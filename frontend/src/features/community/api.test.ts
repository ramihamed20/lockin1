import { beforeEach, describe, expect, it, vi } from "vitest";

import { apiEndpointFromUrl, apiRequest } from "../../api/client";
import {
  comments,
  createComment,
  createDiscussion,
  createReport,
  createSpace,
  deleteComment,
  deleteDiscussion,
  discussion,
  discussions,
  inviteSpaceMember,
  moderationAudit,
  nextComments,
  nextDiscussions,
  nextReports,
  reports,
  space,
  spaces,
  transitionReport
} from "./api";
import type { Report } from "./types";

vi.mock("../../api/client", () => ({
  apiRequest: vi.fn(),
  apiEndpointFromUrl: vi.fn((url: string) => url)
}));

describe("community and moderation API contracts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiRequest).mockResolvedValue({});
  });

  it("builds contextual, private-space, and cursor-safe read paths", async () => {
    const signal = new AbortController().signal;
    await discussions({ contextType: "lesson", contextId: "lesson/1" }, signal);
    await discussions({ spaceId: "space/1" });
    await nextDiscussions("https://lockin.test/api/v1/community/discussions?cursor=abc", signal);

    expect(apiRequest).toHaveBeenCalledWith(
      "/community/discussions?context_type=lesson&context_id=lesson%2F1",
      { signal }
    );
    expect(apiRequest).toHaveBeenCalledWith(
      "/community/discussions?space_id=space%2F1",
      {}
    );
    expect(apiEndpointFromUrl).toHaveBeenCalledWith(
      "https://lockin.test/api/v1/community/discussions?cursor=abc"
    );
  });

  it("sends idempotent contextual writes and email-based membership", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue("00000000-0000-4000-8000-000000000001");
    await createDiscussion({
      context_type: "lesson",
      context_id: "lesson-1",
      title: "Clinical sequence",
      body: "Please explain how these steps connect."
    });
    await createComment("discussion-1", "A useful explanation.", "comment-1");
    await inviteSpaceMember("space/1", "Student@Example.com", "moderator");
    await createReport({
      target_type: "discussion",
      target_id: "discussion-1",
      reason: "spam",
      description: "This is duplicated across multiple lesson discussions."
    });

    expect(apiRequest).toHaveBeenCalledWith("/community/discussions", {
      method: "POST",
      body: {
        context_type: "lesson",
        context_id: "lesson-1",
        title: "Clinical sequence",
        body: "Please explain how these steps connect.",
        client_request_id: "00000000-0000-4000-8000-000000000001"
      }
    });
    expect(apiRequest).toHaveBeenCalledWith("/community/spaces/space%2F1/members", {
      method: "POST",
      body: { email: "Student@Example.com", role: "moderator" }
    });
  });

  it("preserves report revisions in server-authoritative transitions", async () => {
    const report = { id: "report/1", revision: 7 } as Report;
    await reports({ status: "open", targetType: "comment" });
    await transitionReport(report, {
      status: "resolved",
      resolution_notes: "Confirmed after independent review.",
      content_action: "remove"
    });

    expect(apiRequest).toHaveBeenCalledWith(
      "/moderation/reports?status=open&target_type=comment",
      {}
    );
    expect(apiRequest).toHaveBeenCalledWith("/moderation/reports/report%2F1/transition", {
      method: "POST",
      body: {
        expected_revision: 7,
        status: "resolved",
        resolution_notes: "Confirmed after independent review.",
        content_action: "remove"
      }
    });
  });

  it("covers detail, deletion, space, audit, and remaining cursor contracts", async () => {
    const signal = new AbortController().signal;
    await discussion("discussion/1", signal);
    await comments("discussion/1", signal);
    await deleteDiscussion({ id: "discussion/1", revision: 4 } as never);
    await nextComments("next-comments", signal);
    await deleteComment({ id: "comment/1", revision: 2 } as never);
    await spaces(signal);
    await space("space/1");
    await createSpace({
      context_type: "lesson",
      context_id: "lesson-1",
      title: "Study room",
      description: "Private contextual study."
    });
    await nextReports("next-reports");
    await moderationAudit(signal);

    expect(apiRequest).toHaveBeenCalledWith("/community/discussions/discussion%2F1", { signal });
    expect(apiRequest).toHaveBeenCalledWith("/community/discussions/discussion%2F1", {
      method: "DELETE",
      body: { expected_revision: 4 }
    });
    expect(apiRequest).toHaveBeenCalledWith("/community/comments/comment%2F1", {
      method: "DELETE",
      body: { expected_revision: 2 }
    });
    expect(apiRequest).toHaveBeenCalledWith("/community/spaces", { signal });
    expect(apiRequest).toHaveBeenCalledWith("/community/spaces/space%2F1", {});
    expect(apiRequest).toHaveBeenCalledWith("/moderation/audit", { signal });
  });

  it("supports unscoped reads, optional private writes, and no-signal variants", async () => {
    await discussions();
    await discussion("discussion-1");
    await createDiscussion({
      context_type: "lesson",
      context_id: "lesson-1",
      space_id: "space-1",
      title: "Private context",
      body: "A sufficiently detailed private contextual question."
    });
    await createComment("discussion-1", "A root explanation without a parent.");
    await spaces();
    await reports();
    await moderationAudit();

    expect(apiRequest).toHaveBeenCalledWith("/community/discussions", {});
    expect(apiRequest).toHaveBeenCalledWith("/moderation/reports", {});
    expect(apiRequest).toHaveBeenCalledWith("/moderation/audit", {});
  });
});
