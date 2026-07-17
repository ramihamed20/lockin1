import { beforeEach, describe, expect, it, vi } from "vitest";

import { apiRequest } from "../../api/client";
import {
  adminUsers, contentAction, createNode, creatorScopes, grantScope, managedContent, managedNodes,
  revokeScope, saveContentDraft, setNodeStatus, uploadManagedFile
} from "./api";
import type { ManagedLearningObject } from "./types";

vi.mock("../../api/client", () => ({ apiRequest: vi.fn() }));

const item = { id: "content-1", revision: 3 } as ManagedLearningObject;

describe("management API contracts", () => {
  beforeEach(() => vi.mocked(apiRequest).mockReset().mockResolvedValue({}));

  it("builds management list and hierarchy mutation requests", async () => {
    const controller = new AbortController();
    await managedNodes();
    await managedNodes(controller.signal);
    await createNode({ parent_id: null, kind: "institution", title: "University", description: "", position: 0 });
    await setNodeStatus({ id: "node-1", revision: 2 } as never, "published");
    await managedContent();
    await managedContent(controller.signal);
    await creatorScopes();
    await creatorScopes(controller.signal);
    await adminUsers();
    await adminUsers(controller.signal);
    await revokeScope("scope-1");

    expect(apiRequest).toHaveBeenCalledWith("/management/education/nodes?page_size=100", {});
    expect(apiRequest).toHaveBeenCalledWith("/management/education/nodes/node-1/status", { method: "POST", body: { expected_revision: 2, status: "published" } });
    expect(apiRequest).toHaveBeenCalledWith("/management/education/scopes/scope-1", { method: "DELETE" });
  });

  it("uploads files and creates or revises content", async () => {
    const file = new File(["%PDF-1.7"], "lesson.pdf", { type: "application/pdf" });
    await uploadManagedFile(file, "pdf");
    const body = vi.mocked(apiRequest).mock.calls[0]?.[1]?.body;
    expect(body).toBeInstanceOf(FormData);
    expect((body as FormData).get("kind")).toBe("pdf");
    const draft = { academic_node_id: "node-1", content_type: "pdf", title: "Guide", summary: "", language: "en", allow_download: false, primary_file_id: "file-1" } as const;
    await saveContentDraft(draft);
    await saveContentDraft(draft, item);
    expect(apiRequest).toHaveBeenCalledWith("/management/content", { method: "POST", body: draft });
    expect(apiRequest).toHaveBeenCalledWith("/management/content/content-1", { method: "PATCH", body: { ...draft, expected_revision: 3 } });
  });

  it("sends all workflow and scope capability actions", async () => {
    await contentAction(item, "submit");
    await contentAction(item, "publish");
    await contentAction(item, "archive");
    await contentAction(item, "reject");
    await contentAction(item, "reject", "Add labels");
    await grantScope({
      user_id: "user-1",
      node_id: "node-1",
      can_create_content: true,
      can_review_content: false,
      can_publish_content: false,
      can_create_assessments: false,
      can_review_assessments: false,
      can_publish_assessments: false,
      can_manage_hierarchy: false
    });

    expect(apiRequest).toHaveBeenCalledWith("/management/content/content-1/reject", { method: "POST", body: { expected_revision: 3, review_note: "Changes requested." } });
    expect(apiRequest).toHaveBeenCalledWith("/management/content/content-1/reject", { method: "POST", body: { expected_revision: 3, review_note: "Add labels" } });
    expect(apiRequest).toHaveBeenLastCalledWith("/management/education/scopes", {
      method: "POST",
      body: {
        user_id: "user-1",
        node_id: "node-1",
        can_create_content: true,
        can_review_content: false,
        can_publish_content: false,
        can_create_assessments: false,
        can_review_assessments: false,
        can_publish_assessments: false,
        can_manage_hierarchy: false
      }
    });
  });
});
