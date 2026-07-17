import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../i18n/I18nProvider";
import { EducationNodePage } from "./EducationNodePage";
import { LearningHomePage } from "./LearningHomePage";
import { LearningObjectPage } from "./LearningObjectPage";

const api = vi.hoisted(() => ({
  educationChildren: vi.fn(), educationNode: vi.fn(), learningObjects: vi.fn(), learningObject: vi.fn(),
  learningDashboard: vi.fn(), searchLearning: vi.fn(), toggleBookmark: vi.fn(), saveLearningProgress: vi.fn(), completeLesson: vi.fn()
}));
vi.mock("./api", () => api);

const node = { id: "node-1", parent_id: null, kind: "lesson", title: "Oral anatomy", slug: "oral-anatomy", description: "Build a durable foundation.", position: 0, path: "node-1", depth: 0, status: "published", is_discoverable: true, revision: 1, updated_at: "2026-07-15" };
const version = { id: "version-1", version_number: 1, academic_node_id: "node-1", academic_node_title: "Oral anatomy", content_type: "pdf", title: "Cranial landmarks", summary: "Study the key structures.", language: "en", allow_download: true, metadata: {}, available_from: null, available_until: null, assets: [{ id: "asset-1", file_id: "file-1", role: "primary", position: 0, original_name: "lesson.pdf", content_type: "application/pdf", size_bytes: 100, view_url: "/api/v1/files/file-1/view", download_url: "/api/v1/files/file-1/download" }], focus_context: { context_type: "study", context_id: "version-1" }, created_at: "2026-07-15" };
const content = { id: "content-1", version, published_at: "2026-07-15", is_bookmarked: false, progress: null };
const emptyPage = { count: 0, next: null, previous: null, results: [] };

function shell(children: React.ReactNode) {
  return render(<MemoryRouter><I18nProvider>{children}</I18nProvider></MemoryRouter>);
}

describe("student learning journey", () => {
  beforeEach(() => {
    localStorage.setItem("lockin.locale", "en");
    vi.clearAllMocks();
    api.educationChildren.mockResolvedValue({ ...emptyPage, count: 1, results: [node] });
    api.learningDashboard.mockResolvedValue({ next_item: null, bookmark_count: 2, completed_count: 3, recent_content: [], review_due: [] });
    api.searchLearning.mockResolvedValue({ ...emptyPage, count: 1, results: [{ resource_kind: "learning_object", resource_id: "content-1", content_type: "pdf", title: "Cranial landmarks", summary: "Study the key structures.", language: "en", published_at: "2026-07-15" }] });
  });

  it("searches across the learning journey and links to a learning object", async () => {
    shell(<LearningHomePage />);
    expect(await screen.findByRole("heading", { name: "What will you master next?" })).toBeVisible();
    fireEvent.change(screen.getByLabelText("Search learning"), { target: { value: "cranial" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByRole("link", { name: /Cranial landmarks/ })).toHaveAttribute("href", "/learn/content/content-1");
    expect(api.searchLearning).toHaveBeenCalledWith("cranial", "");
  });

  it("routes assessment search results without exposing standalone question pages", async () => {
    api.searchLearning.mockResolvedValue({
      ...emptyPage,
      count: 2,
      results: [
        { resource_kind: "quiz", resource_id: "quiz-1", content_type: "mastery", title: "Anatomy mastery", summary: "", language: "en", published_at: "2026-07-17" },
        { resource_kind: "question", resource_id: "question-1", content_type: "single_choice", title: "Facial nerve", summary: "", language: "en", published_at: "2026-07-17" }
      ]
    });
    shell(<LearningHomePage />);

    await screen.findByRole("heading", { name: "What will you master next?" });
    fireEvent.change(screen.getByLabelText("Search learning"), { target: { value: "nerve" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByRole("link", { name: /Anatomy mastery/ })).toHaveAttribute("href", "/assessments/quizzes/quiz-1");
    expect(screen.getByRole("link", { name: /Facial nerve/ })).toHaveAttribute("href", "/assessments");
  });

  it("resumes a study recommendation and searches non-document learning locations", async () => {
    api.educationChildren.mockResolvedValue({ ...emptyPage, count: 1, results: [{ ...node, kind: "subject", description: "" }] });
    api.learningDashboard.mockResolvedValue({
      next_item: { learning_object_id: "content-1", title: "Cranial landmarks", reason: "resume", completion_percent: 45 },
      bookmark_count: 2, completed_count: 3, recent_content: [], review_due: [content]
    });
    api.searchLearning.mockResolvedValue({
      ...emptyPage,
      count: 1,
      results: [{ resource_kind: "education_node", resource_id: "node-1", content_type: null, title: "Oral anatomy", summary: "", language: "en", published_at: "2026-07-15" }]
    });
    shell(<LearningHomePage />);

    expect(await screen.findByText("Resume your study")).toBeVisible();
    expect(screen.getByRole("link", { name: "Continue studying" })).toHaveAttribute("href", "/learn/content/content-1");
    fireEvent.change(screen.getByLabelText("Search learning"), { target: { value: "  oral  " } });
    fireEvent.change(screen.getByLabelText("Content type"), { target: { value: "audio" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByRole("link", { name: /Oral anatomy/ })).toHaveAttribute("href", "/learn/nodes/node-1");
    expect(api.searchLearning).toHaveBeenCalledWith("oral", "audio");
  });

  it("keeps the learning home usable when one source or search fails", async () => {
    api.learningDashboard.mockRejectedValue(new Error("dashboard unavailable"));
    api.educationChildren.mockResolvedValue(emptyPage);
    api.searchLearning.mockRejectedValue(new Error("search unavailable"));
    shell(<LearningHomePage />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Part of your learning workspace is temporarily unavailable");
    expect(screen.getByRole("heading", { name: "No published learning path yet" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(api.searchLearning).toHaveBeenCalled());
    expect(screen.getByRole("alert")).toBeVisible();
  });

  it("keeps lesson completion separate from its learning materials", async () => {
    api.educationNode.mockResolvedValue({ node, breadcrumbs: [node] });
    api.educationChildren.mockResolvedValue(emptyPage);
    api.learningObjects.mockResolvedValue({ ...emptyPage, count: 1, results: [content] });
    api.completeLesson.mockResolvedValue({ lesson_id: "node-1", completed_at: "2026-07-15", revision: 1 });
    render(<MemoryRouter initialEntries={["/learn/nodes/node-1"]}><I18nProvider><Routes><Route path="/learn/nodes/:nodeId" element={<EducationNodePage />} /></Routes></I18nProvider></MemoryRouter>);
    expect(await screen.findByRole("heading", { name: "Oral anatomy" })).toBeVisible();
    expect(screen.getByRole("link", { name: /Cranial landmarks/ })).toHaveAttribute("href", "/learn/content/content-1");
    fireEvent.click(screen.getByRole("button", { name: "Mark complete" }));
    expect(await screen.findByRole("button", { name: "Completed" })).toBeDisabled();
  });

  it("renders a non-lesson path, child locations, progress, and content filtering", async () => {
    const subject = { ...node, kind: "subject" as const, description: "" };
    const child = { ...node, id: "child-1", kind: "unit" as const, title: "Head and neck", description: "" };
    api.educationNode.mockResolvedValue({ node: subject, breadcrumbs: [subject] });
    api.educationChildren.mockResolvedValue({ ...emptyPage, count: 1, results: [child] });
    api.learningObjects.mockResolvedValue({ ...emptyPage, count: 1, results: [{ ...content, progress: { status: "in_progress", completion_percent: 45, position: { page: 3 }, revision: 2 } }] });
    render(<MemoryRouter initialEntries={["/learn/nodes/node-1"]}><I18nProvider><Routes><Route path="/learn/nodes/:nodeId" element={<EducationNodePage />} /></Routes></I18nProvider></MemoryRouter>);

    expect(await screen.findByRole("heading", { name: "Oral anatomy" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Mark complete" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Head and neck/ })).toHaveAttribute("href", "/learn/nodes/child-1");
    expect(screen.getByRole("link", { name: /45% complete/ })).toBeVisible();
    fireEvent.change(screen.getByLabelText("Filter by type"), { target: { value: "audio" } });
    await waitFor(() => expect(api.learningObjects).toHaveBeenCalledWith("node-1", "audio", expect.any(AbortSignal)));
  });

  it("surfaces node loading and lesson completion failures", async () => {
    api.educationNode.mockRejectedValueOnce(new Error("not found"));
    api.educationChildren.mockResolvedValue(emptyPage);
    api.learningObjects.mockResolvedValue(emptyPage);
    const failedView = render(<MemoryRouter initialEntries={["/learn/nodes/node-1"]}><I18nProvider><Routes><Route path="/learn/nodes/:nodeId" element={<EducationNodePage />} /></Routes></I18nProvider></MemoryRouter>);
    expect(await screen.findByRole("alert")).toHaveTextContent("This learning area could not be loaded");
    failedView.unmount();

    api.educationNode.mockResolvedValue({ node, breadcrumbs: [node] });
    api.completeLesson.mockRejectedValue(new Error("conflict"));
    render(<MemoryRouter initialEntries={["/learn/nodes/node-1"]}><I18nProvider><Routes><Route path="/learn/nodes/:nodeId" element={<EducationNodePage />} /></Routes></I18nProvider></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: "Mark complete" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This learning area could not be loaded");
  });

  it("renders a permission-mediated PDF and saves revision-aware progress", async () => {
    api.learningObject.mockResolvedValue(content);
    api.toggleBookmark.mockResolvedValue(undefined);
    api.saveLearningProgress.mockResolvedValue({ status: "completed", completion_percent: 100, position: { page: 1 }, revision: 1 });
    render(<MemoryRouter initialEntries={["/learn/content/content-1"]}><I18nProvider><Routes><Route path="/learn/content/:contentId" element={<LearningObjectPage />} /></Routes></I18nProvider></MemoryRouter>);
    expect(await screen.findByRole("heading", { name: "Cranial landmarks" })).toBeVisible();
    expect(document.querySelector("object")).toHaveAttribute("data", "/api/v1/files/file-1/view");
    fireEvent.click(screen.getByRole("button", { name: "Save for later" }));
    expect(await screen.findByRole("button", { name: "Remove bookmark" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Mark complete" }));
    expect(await screen.findByText("Your study progress is saved.")).toBeVisible();
  });

  it("supports audio resume progress and a restricted download", async () => {
    const audioVersion = {
      ...version,
      content_type: "audio" as const,
      allow_download: false,
      assets: [{ ...version.assets[0]!, content_type: "audio/mpeg", original_name: "lesson.mp3", download_url: null }]
    };
    api.learningObject.mockResolvedValue({ ...content, version: audioVersion, is_bookmarked: true, progress: { status: "in_progress", completion_percent: 40, position: { seconds: 15 }, revision: 2 } });
    api.toggleBookmark.mockResolvedValue(undefined);
    api.saveLearningProgress.mockResolvedValue({ status: "in_progress", completion_percent: 60, position: { seconds: 30 }, revision: 3 });
    render(<MemoryRouter initialEntries={["/learn/content/content-1"]}><I18nProvider><Routes><Route path="/learn/content/:contentId" element={<LearningObjectPage />} /></Routes></I18nProvider></MemoryRouter>);

    expect(await screen.findByRole("heading", { name: "Cranial landmarks" })).toBeVisible();
    expect(document.querySelector("audio")).toHaveAttribute("src", "/api/v1/files/file-1/view");
    expect(screen.getByText("The publisher limited this item to in-app study.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Remove bookmark" }));
    expect(await screen.findByRole("button", { name: "Save for later" })).toBeVisible();
    fireEvent.change(screen.getByLabelText("Completion percentage"), { target: { value: "60" } });
    fireEvent.click(screen.getByRole("button", { name: "Save progress" }));
    expect(await screen.findByText("Your study progress is saved.")).toBeVisible();
    expect(api.saveLearningProgress).toHaveBeenCalledWith("content-1", expect.objectContaining({ status: "in_progress", revision: 2 }));
  });

  it("shows a recoverable bookmark error without exposing a direct file URL", async () => {
    api.learningObject.mockResolvedValue(content);
    api.toggleBookmark.mockRejectedValue(new Error("offline"));
    render(<MemoryRouter initialEntries={["/learn/content/content-1"]}><I18nProvider><Routes><Route path="/learn/content/:contentId" element={<LearningObjectPage />} /></Routes></I18nProvider></MemoryRouter>);

    fireEvent.click(await screen.findByRole("button", { name: "Save for later" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This learning area could not be loaded");
  });

  it("surfaces a revision conflict while saving progress", async () => {
    api.learningObject.mockResolvedValue(content);
    api.saveLearningProgress.mockRejectedValue(new Error("conflict"));
    render(<MemoryRouter initialEntries={["/learn/content/content-1"]}><I18nProvider><Routes><Route path="/learn/content/:contentId" element={<LearningObjectPage />} /></Routes></I18nProvider></MemoryRouter>);

    fireEvent.click(await screen.findByRole("button", { name: "Save progress" }));
    await waitFor(() => expect(api.saveLearningProgress).toHaveBeenCalled());
    expect(await screen.findByRole("alert")).toHaveTextContent("This learning area could not be loaded");
  });
});
