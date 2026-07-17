import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../i18n/I18nProvider";
import { ContentStudioPage } from "./ContentStudioPage";
import { EducationAdminPage } from "./EducationAdminPage";

const api = vi.hoisted(() => ({
  managedNodes: vi.fn(), createNode: vi.fn(), setNodeStatus: vi.fn(), managedContent: vi.fn(), uploadManagedFile: vi.fn(),
  saveContentDraft: vi.fn(), contentAction: vi.fn(), creatorScopes: vi.fn(), adminUsers: vi.fn(), grantScope: vi.fn(), revokeScope: vi.fn()
}));
vi.mock("./api", () => api);

const node = { id: "node-1", parent_id: null, kind: "subject", title: "Anatomy", slug: "anatomy", description: "", position: 0, path: "node-1", depth: 0, status: "draft", is_discoverable: false, revision: 1, updated_at: "2026-07-15" };
const item = { id: "content-1", owner: "creator-1", owner_name: "Creator", owner_email: "creator@example.com", current_version: { id: "version-1", version_number: 1, academic_node_id: "node-1", academic_node_title: "Anatomy", content_type: "pdf", title: "Anatomy notes", summary: "Core reading", language: "en", allow_download: false, metadata: {}, available_from: null, available_until: null, assets: [{ id: "asset-1", file_id: "file-1", role: "primary", position: 0, original_name: "notes.pdf", content_type: "application/pdf", size_bytes: 100, view_url: "/api/v1/files/file-1/view", download_url: null }], focus_context: { context_type: "study", context_id: "version-1" }, created_at: "2026-07-15" }, published_version_id: null, workflow_status: "in_review", review_note: "", revision: 2, published_at: null, archived_at: null, updated_at: "2026-07-15" };
const page = <T,>(results: T[]) => ({ count: results.length, next: null, previous: null, results });

function renderPage(pageElement: React.ReactNode) {
  return render(<MemoryRouter><I18nProvider>{pageElement}</I18nProvider></MemoryRouter>);
}

describe("content and education management", () => {
  beforeEach(() => {
    localStorage.setItem("lockin.locale", "en");
    vi.clearAllMocks();
    api.managedNodes.mockResolvedValue(page([node]));
    api.managedContent.mockResolvedValue(page([item]));
    api.contentAction.mockImplementation((current: typeof item) => Promise.resolve({ ...current, workflow_status: "published", revision: current.revision + 1 }));
    api.adminUsers.mockResolvedValue(page([{ id: "creator-1", email: "creator@example.com", full_name: "Content Creator", preferred_language: "en", status: "active", is_email_verified: true, roles: ["student", "creator"], date_joined: "2026-07-15" }]));
    api.creatorScopes.mockResolvedValue({ scopes: [] });
  });

  it("requires a validated file and exposes the review workflow", async () => {
    renderPage(<ContentStudioPage />);
    expect(await screen.findByRole("heading", { name: "Anatomy notes" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    expect(api.contentAction).toHaveBeenCalledWith(expect.objectContaining({ id: "content-1" }), "publish", undefined);

    fireEvent.change(screen.getByLabelText("Learning location"), { target: { value: "node-1" } });
    fireEvent.change(screen.getByLabelText("Learning object title"), { target: { value: "New guide" } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Choose a validated file");
    expect(api.saveContentDraft).not.toHaveBeenCalled();
  });

  it("manages a discipline-neutral hierarchy and scoped creator access", async () => {
    api.setNodeStatus.mockResolvedValue({ ...node, status: "published", is_discoverable: true, revision: 2 });
    api.grantScope.mockResolvedValue({ id: "scope-1", user: "creator-1", user_name: "Content Creator", user_email: "creator@example.com", node: "node-1", node_title: "Anatomy", can_create_content: true, can_review_content: false, can_publish_content: false, can_manage_hierarchy: false, updated_at: "2026-07-15" });
    renderPage(<EducationAdminPage />);
    expect(await screen.findByRole("heading", { name: "Learning structure" })).toBeVisible();
    expect(screen.getByRole("option", { name: "Institution" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Academic year" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Publish location" }));
    expect(api.setNodeStatus).toHaveBeenCalledWith(expect.objectContaining({ id: "node-1" }), "published");

    fireEvent.change(screen.getByLabelText("Creator"), { target: { value: "creator-1" } });
    fireEvent.change(screen.getByLabelText("Academic scope"), { target: { value: "node-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Grant or update access" }));
    expect(api.grantScope).toHaveBeenCalledWith(expect.objectContaining({ user_id: "creator-1", node_id: "node-1", can_create_content: true }));
    expect(await screen.findByText("Content Creator")).toBeVisible();
  });

  it("uploads a validated file and saves a new content draft", async () => {
    api.managedContent.mockResolvedValue(page([]));
    api.uploadManagedFile.mockResolvedValue({ id: "file-2", kind: "pdf", original_name: "guide.pdf", content_type: "application/pdf", size_bytes: 20, checksum_sha256: "abc", validation_status: "valid", scan_status: "not_configured", created_at: "2026-07-15" });
    api.saveContentDraft.mockResolvedValue({ ...item, id: "content-2", workflow_status: "draft", current_version: { ...item.current_version, title: "New study guide" } });
    renderPage(<ContentStudioPage />);
    await screen.findByRole("heading", { name: "Create learning content" });
    fireEvent.change(screen.getByLabelText("Learning location"), { target: { value: "node-1" } });
    fireEvent.change(screen.getByLabelText("Learning object title"), { target: { value: "New study guide" } });
    fireEvent.change(screen.getByLabelText("PDF file"), { target: { files: [new File(["%PDF-1.7"], "guide.pdf", { type: "application/pdf" })] } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

    expect(await screen.findByText("The learning object draft is saved.")).toBeVisible();
    expect(api.uploadManagedFile).toHaveBeenCalledWith(expect.any(File), "pdf");
    expect(api.saveContentDraft).toHaveBeenCalledWith(expect.objectContaining({ title: "New study guide", primary_file_id: "file-2" }), undefined);
  });

  it("supports draft, review, rejection, archive, edit, and cancel actions", async () => {
    const items = [
      { ...item, id: "draft", workflow_status: "draft", current_version: { ...item.current_version, title: "Draft guide" } },
      { ...item, id: "review", workflow_status: "in_review", current_version: { ...item.current_version, title: "Review guide" } },
      { ...item, id: "published", workflow_status: "published", current_version: { ...item.current_version, title: "Published guide" } },
      { ...item, id: "rejected", workflow_status: "rejected", current_version: { ...item.current_version, title: "Rejected guide" } }
    ];
    api.managedContent.mockResolvedValue(page(items));
    api.contentAction.mockImplementation((current: typeof item) => Promise.resolve({ ...current, revision: current.revision + 1 }));
    vi.spyOn(window, "prompt").mockReturnValue("Add clearer labels");
    renderPage(<ContentStudioPage />);
    const draftHeading = await screen.findByRole("heading", { name: "Draft guide" });
    const draftRow = draftHeading.closest("li");
    expect(draftRow).not.toBeNull();

    fireEvent.click(within(draftRow!).getByRole("button", { name: "Edit or revise" }));
    expect(await screen.findByRole("heading", { name: "Prepare a new revision" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Cancel editing" }));
    expect(await screen.findByRole("heading", { name: "Create learning content" })).toBeVisible();

    fireEvent.click(screen.getAllByRole("button", { name: "Submit for review" })[0]!);
    await waitFor(() => expect(api.contentAction).toHaveBeenCalledWith(expect.objectContaining({ id: "draft" }), "submit", undefined));
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    await waitFor(() => expect(api.contentAction).toHaveBeenCalledWith(expect.objectContaining({ id: "review" }), "publish", undefined));
    fireEvent.click(screen.getByRole("button", { name: "Request changes" }));
    await waitFor(() => expect(api.contentAction).toHaveBeenCalledWith(expect.objectContaining({ id: "review" }), "reject", "Add clearer labels"));
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(api.contentAction).toHaveBeenCalledWith(expect.objectContaining({ id: "published" }), "archive", undefined));
  });

  it("creates hierarchy nodes and revokes an existing creator scope", async () => {
    const existingScope = { id: "scope-1", user: "creator-1", user_name: "Content Creator", user_email: "creator@example.com", node: "node-1", node_title: "Anatomy", can_create_content: true, can_review_content: false, can_publish_content: false, can_manage_hierarchy: false, updated_at: "2026-07-15" };
    api.creatorScopes.mockResolvedValue({ scopes: [existingScope] });
    api.createNode.mockResolvedValue({ ...node, id: "node-2", title: "First Year" });
    api.revokeScope.mockResolvedValue(undefined);
    renderPage(<EducationAdminPage />);
    await screen.findByRole("heading", { name: "Learning structure" });
    fireEvent.change(screen.getByLabelText("Display title"), { target: { value: "First Year" } });
    fireEvent.click(screen.getByRole("button", { name: "Save learning location" }));
    expect(api.createNode).toHaveBeenCalledWith(expect.objectContaining({ title: "First Year", kind: "subject" }));
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    expect(api.revokeScope).toHaveBeenCalledWith("scope-1");
  });
});
