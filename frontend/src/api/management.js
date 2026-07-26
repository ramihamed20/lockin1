import { ApiError, request } from "./client.js";
import { buildQueryString } from "./pagination.js";

const PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function compact(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Django's optional text fields use serializer defaults when omitted, but its
 * CharField validation rejects an explicit empty string. Keep an intentionally
 * blank UI field blank without sending an invalid value to the API.
 */
function optionalText(key, value) {
  const text = compact(value);
  return text ? { [key]: text } : {};
}

function objectPayload(payload, message) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new ApiError(500, payload, message, "invalid_response");
  }
  return /** @type {Record<string, unknown>} */ (payload);
}

function objectWithId(payload, message) {
  const value = objectPayload(payload, message);
  if (typeof value.id !== "string" || !value.id) {
    throw new ApiError(500, payload, message, "invalid_response");
  }
  return value;
}

function uuid(value, label = "identifier") {
  const id = compact(value);
  if (!UUID_PATTERN.test(id)) {
    throw new ApiError(0, null, `A valid ${label} is required.`, "invalid_request");
  }
  return id;
}

function pageSize(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, MAX_PAGE_SIZE) : PAGE_SIZE;
}

function pagePayload(payload, message) {
  const source = objectPayload(payload, message);
  if (!Array.isArray(source.results) || typeof source.count !== "number") {
    throw new ApiError(500, payload, message, "invalid_response");
  }
  return {
    count: source.count,
    results: source.results,
    hasNext: typeof source.next === "string" && Boolean(source.next)
  };
}

function managedPage(path, { page = 1, pageSize: size = PAGE_SIZE, status = null } = {}) {
  const parsedPage = Number(page);
  return path + buildQueryString({
    page: Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1,
    page_size: pageSize(size),
    status: compact(status)
  });
}

function writeContent(data) {
  return {
    academic_node_id: uuid(data.academicNodeId, "education node identifier"),
    content_type: compact(data.contentType),
    title: compact(data.title),
    ...optionalText("summary", data.summary),
    language: compact(data.language) || "en",
    allow_download: data.allowDownload === true,
    metadata: data.metadata && typeof data.metadata === "object" && !Array.isArray(data.metadata) ? data.metadata : {},
    available_from: data.availableFrom || null,
    available_until: data.availableUntil || null,
    primary_file_id: data.primaryFileId ? uuid(data.primaryFileId, "primary file identifier") : null
  };
}

function writeQuestion(data) {
  const options = Array.isArray(data.options)
    ? data.options.map((option) => ({ text: compact(option?.text), is_correct: option?.isCorrect === true }))
    : [];
  return {
    academic_node_id: uuid(data.academicNodeId, "education node identifier"),
    question_type: compact(data.questionType),
    prompt: compact(data.prompt),
    ...optionalText("explanation", data.explanation),
    difficulty: compact(data.difficulty),
    language: compact(data.language) || "en",
    metadata: data.metadata && typeof data.metadata === "object" && !Array.isArray(data.metadata) ? data.metadata : {},
    options
  };
}

function writeQuiz(data) {
  const questionIds = Array.isArray(data.questionIds) ? data.questionIds.map((id) => uuid(id, "question identifier")) : [];
  const allowedDifficulties = Array.isArray(data.allowedDifficulties)
    ? data.allowedDifficulties.filter((value) => ["easy", "medium", "hard"].includes(value))
    : [];
  return {
    academic_node_id: uuid(data.academicNodeId, "education node identifier"),
    title: compact(data.title),
    ...optionalText("instructions", data.instructions),
    mode: compact(data.mode),
    selection_mode: compact(data.selectionMode),
    question_count: Number(data.questionCount),
    question_ids: questionIds,
    duration_seconds: data.durationSeconds == null || data.durationSeconds === "" ? null : Number(data.durationSeconds),
    maximum_attempts: Number(data.maximumAttempts),
    available_from: data.availableFrom || null,
    available_until: data.availableUntil || null,
    randomize_questions: data.randomizeQuestions === true,
    randomize_options: data.randomizeOptions === true,
    result_release: compact(data.resultRelease),
    pass_percent: String(data.passPercent),
    ranking_eligible: data.rankingEligible === true,
    achievement_eligible: data.achievementEligible === true,
    focus_required: data.focusRequired === true,
    allowed_difficulties: allowedDifficulties,
    language: compact(data.language) || "en",
    metadata: data.metadata && typeof data.metadata === "object" && !Array.isArray(data.metadata) ? data.metadata : {}
  };
}

function revision(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new ApiError(0, null, "The latest server revision is required.", "invalid_request");
  }
  return parsed;
}

function lifecycleEndpoint(domain, id, action) {
  const allowed = {
    content: ["submit", "publish", "reject", "archive", "transfer"],
    question: ["submit", "publish", "reject", "retire"],
    quiz: ["submit", "publish", "reject", "retire"]
  };
  const roots = { content: "/management/content", question: "/management/questions", quiz: "/management/quizzes" };
  if (!allowed[domain]?.includes(action) || !roots[domain]) {
    throw new ApiError(0, null, "This workflow action is not supported by Django.", "invalid_request");
  }
  return `${roots[domain]}/${uuid(id, `${domain} identifier`)}/${action}`;
}

/** Creator and administrator management APIs. Django remains the scope/ownership authority. */
export const managementApi = {
  async listNodes(options = {}) {
    return pagePayload(await request(managedPage("/management/education/nodes", options)), "The education-node list response was incomplete.");
  },

  async listScopes() {
    const payload = objectPayload(await request("/management/education/scopes"), "The creator-scope response was incomplete.");
    if (!Array.isArray(payload.scopes)) throw new ApiError(500, payload, "The creator-scope response was incomplete.", "invalid_response");
    return payload.scopes;
  },

  async createNode({ parentId = null, kind, title, slug = "", description = "", position = 0 }) {
    return objectWithId(await request("/management/education/nodes", {
      method: "POST",
      body: { parent_id: parentId ? uuid(parentId, "parent node identifier") : null, kind: compact(kind), title: compact(title), ...(compact(slug) ? { slug: compact(slug) } : {}), ...(compact(description) ? { description: compact(description) } : {}), position: Number(position) }
    }), "The created education node response was incomplete.");
  },

  async updateNode(nodeId, { expectedRevision, title, slug, description, position }) {
    const body = { expected_revision: revision(expectedRevision) };
    if (title != null) body.title = compact(title);
    if (slug != null) body.slug = compact(slug);
    if (description != null) body.description = compact(description);
    if (position != null) body.position = Number(position);
    return objectWithId(await request(`/management/education/nodes/${uuid(nodeId, "education node identifier")}`, { method: "PATCH", body }), "The updated education node response was incomplete.");
  },

  async moveNode(nodeId, { expectedRevision, parentId = null, position = 0 }) {
    return objectWithId(await request(`/management/education/nodes/${uuid(nodeId, "education node identifier")}/move`, {
      method: "POST",
      body: { expected_revision: revision(expectedRevision), parent_id: parentId ? uuid(parentId, "parent node identifier") : null, position: Number(position) }
    }), "The moved education node response was incomplete.");
  },

  async setNodeStatus(nodeId, { expectedRevision, status }) {
    return objectWithId(await request(`/management/education/nodes/${uuid(nodeId, "education node identifier")}/status`, {
      method: "POST", body: { expected_revision: revision(expectedRevision), status: compact(status) }
    }), "The updated education-node status response was incomplete.");
  },

  async listContent(options = {}) {
    return pagePayload(await request(managedPage("/management/content", options)), "The content list response was incomplete.");
  },

  async getContent(contentId) {
    return objectWithId(await request(`/management/content/${uuid(contentId, "content identifier")}`), "The content response was incomplete.");
  },

  async createContent(data) {
    return objectWithId(await request("/management/content", { method: "POST", body: writeContent(data) }), "The created content response was incomplete.");
  },

  async updateContent(contentId, data) {
    return objectWithId(await request(`/management/content/${uuid(contentId, "content identifier")}`, { method: "PATCH", body: { ...writeContent(data), expected_revision: revision(data.expectedRevision) } }), "The updated content response was incomplete.");
  },

  async uploadFile({ kind, file }) {
    if (typeof File === "undefined" || !(file instanceof File)) throw new ApiError(0, null, "Choose a file before uploading.", "invalid_request");
    const body = new FormData();
    body.append("kind", compact(kind));
    body.append("file", file);
    return objectWithId(await request("/management/files", { method: "POST", body }), "The file-upload response was incomplete.");
  },

  async listQuestions(options = {}) {
    return pagePayload(await request(managedPage("/management/questions", options)), "The question list response was incomplete.");
  },

  async getQuestion(questionId) {
    return objectWithId(await request(`/management/questions/${uuid(questionId, "question identifier")}`), "The question response was incomplete.");
  },

  async createQuestion(data) {
    return objectWithId(await request("/management/questions", { method: "POST", body: writeQuestion(data) }), "The created question response was incomplete.");
  },

  async updateQuestion(questionId, data) {
    return objectWithId(await request(`/management/questions/${uuid(questionId, "question identifier")}`, { method: "PATCH", body: { ...writeQuestion(data), expected_revision: revision(data.expectedRevision) } }), "The updated question response was incomplete.");
  },

  async listQuizzes(options = {}) {
    return pagePayload(await request(managedPage("/management/quizzes", options)), "The quiz list response was incomplete.");
  },

  async getQuiz(quizId) {
    return objectWithId(await request(`/management/quizzes/${uuid(quizId, "quiz identifier")}`), "The quiz response was incomplete.");
  },

  async createQuiz(data) {
    return objectWithId(await request("/management/quizzes", { method: "POST", body: writeQuiz(data) }), "The created quiz response was incomplete.");
  },

  async updateQuiz(quizId, data) {
    return objectWithId(await request(`/management/quizzes/${uuid(quizId, "quiz identifier")}`, { method: "PATCH", body: { ...writeQuiz(data), expected_revision: revision(data.expectedRevision) } }), "The updated quiz response was incomplete.");
  },

  async lifecycle(domain, id, action, options = {}) {
    const { expectedRevision, reviewNote = "", ownerId = "" } = /** @type {{expectedRevision?: unknown, reviewNote?: string, ownerId?: string}} */ (options);
    const body = { expected_revision: revision(expectedRevision) };
    if (action === "reject") body.review_note = compact(reviewNote);
    if (action === "transfer") body.owner_id = uuid(ownerId, "new owner identifier");
    return objectWithId(await request(lifecycleEndpoint(domain, id, action), { method: "POST", body }), "The server workflow response was incomplete.");
  }
};

export const EDUCATION_NODE_KINDS = Object.freeze(["institution", "college", "department", "academic_year", "semester", "subject", "unit", "lesson"]);
export const CONTENT_TYPES = Object.freeze(["pdf", "audio", "video"]);
export const QUESTION_TYPES = Object.freeze(["single_choice", "true_false", "completion_choice"]);
export const DIFFICULTIES = Object.freeze(["easy", "medium", "hard"]);
export const QUIZ_MODES = Object.freeze(["quiz", "practice", "mastery"]);
export const QUIZ_SELECTION_MODES = Object.freeze(["fixed", "pool"]);
export const RESULT_RELEASES = Object.freeze(["immediate", "after_close"]);
