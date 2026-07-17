import { beforeEach, describe, expect, it, vi } from "vitest";

import { apiRequest } from "../../api/client";
import {
  completeLesson,
  educationChildren,
  educationNode,
  learningDashboard,
  learningObject,
  learningObjects,
  saveLearningProgress,
  searchLearning,
  toggleBookmark
} from "./api";

vi.mock("../../api/client", () => ({ apiRequest: vi.fn() }));

describe("learning API contracts", () => {
  beforeEach(() => vi.mocked(apiRequest).mockReset().mockResolvedValue({}));

  it("builds encoded browse, detail, dashboard, and search paths", async () => {
    const controller = new AbortController();
    await educationChildren();
    await educationChildren("node/1", controller.signal);
    await educationNode("node/1", controller.signal);
    await learningObjects();
    await learningObjects("node 1", "pdf", controller.signal);
    await learningObject("content/1", controller.signal);
    await learningDashboard(controller.signal);
    await searchLearning("cranial nerve", "", controller.signal);
    await searchLearning("cranial nerve", "pdf");

    expect(apiRequest).toHaveBeenCalledWith("/education/nodes", {});
    expect(apiRequest).toHaveBeenCalledWith("/education/nodes?parent=node%2F1", { signal: controller.signal });
    expect(apiRequest).toHaveBeenCalledWith("/education/nodes/node%2F1", { signal: controller.signal });
    expect(apiRequest).toHaveBeenCalledWith("/learning-objects?node=node+1&content_type=pdf", { signal: controller.signal });
    expect(apiRequest).toHaveBeenCalledWith("/search?q=cranial+nerve&content_types=pdf", {});
  });

  it("uses revision-aware mutation contracts", async () => {
    await toggleBookmark("content/1", false);
    await toggleBookmark("content/1", true);
    await saveLearningProgress("content/1", { status: "in_progress", completion_percent: 45, position: { page: 4 }, revision: 3 });
    await completeLesson("lesson/1");
    await completeLesson("lesson/1", 4);

    expect(apiRequest).toHaveBeenCalledWith("/bookmarks", { method: "POST", body: { learning_object_id: "content/1" } });
    expect(apiRequest).toHaveBeenCalledWith("/bookmarks/content%2F1", { method: "DELETE" });
    expect(apiRequest).toHaveBeenCalledWith("/progress/learning-objects/content%2F1", { method: "PUT", body: { expected_revision: 3, status: "in_progress", completion_percent: 45, position: { page: 4 } } });
    expect(apiRequest).toHaveBeenLastCalledWith("/progress/lessons/lesson%2F1/complete", { method: "POST", body: { expected_revision: 4 } });
  });
});
