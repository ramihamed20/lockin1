import { ApiError, request } from "./client.js";
import { uploadWithProgress } from "./personalSheets.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Only a same-origin managed-file view, which Django authorizes per request.
const IMAGE_URL_PATTERN = /^\/api\/v1\/files\/[0-9a-f-]+\/view$/i;

export const PRACTICE_ANSWER_MAX_LENGTH = 200;
export const PRACTICE_TITLE_MAX_LENGTH = 120;
export const PRACTICE_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
export const PRACTICE_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

function uuid(value, label = "identifier") {
  const clean = typeof value === "string" ? value.trim() : "";
  if (!UUID_PATTERN.test(clean)) throw new ApiError(0, null, `A valid ${label} is required.`, "invalid_request");
  return clean;
}

/**
 * The only differences Practice forgives: letter case and spaces. The server
 * grades with the same rule; this copy exists so the page can say "same name,
 * different spelling" without a request, and for the admin's duplicate check.
 * @param {string} value
 */
export function foldAnswer(value) {
  return String(value || "").normalize("NFC").replace(/[\s​-‏‪-‮⁠﻿]+/g, "").toLowerCase();
}

export const PRACTICE_HOTSPOT_SHAPES = ["circle", "arrow"];
const SLIDE_STATES = ["new", "missed", "due", "learned"];

/** @returns {{ x: number, y: number, shape: "circle" | "arrow" } | null} */
function parseHotspot(value) {
  if (!value || typeof value !== "object") return null;
  const x = Number(value.x);
  const y = Number(value.y);
  const shape = PRACTICE_HOTSPOT_SHAPES.includes(value.shape) ? /** @type {"circle" | "arrow"} */ (value.shape) : null;
  if (!shape || !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) return null;
  return { x, y, shape };
}

function parseStats(value) {
  const count = (key) => Math.max(0, Number(value?.[key]) || 0);
  const stamp = typeof value?.last_practiced_at === "string" ? value.last_practiced_at : "";
  return {
    total: count("total"),
    newCount: count("new"),
    missed: count("missed"),
    due: count("due"),
    learned: count("learned"),
    review: count("review"),
    lastPracticedAt: Number.isNaN(Date.parse(stamp)) ? "" : stamp
  };
}

function parseSlide(value) {
  if (!value || !UUID_PATTERN.test(String(value.id))) return null;
  const imageUrl = IMAGE_URL_PATTERN.test(String(value.image_url)) ? String(value.image_url) : "";
  const state = SLIDE_STATES.includes(value.state) ? String(value.state) : "new";
  return { id: String(value.id), position: Number(value.position) || 0, imageUrl, hotspot: parseHotspot(value.hotspot), state };
}

function parseSetSummary(value) {
  if (!value || !UUID_PATTERN.test(String(value.id))) return null;
  return {
    id: String(value.id),
    title: String(value.title || ""),
    slideCount: Number(value.slideCount) || 0,
    stats: parseStats(value.stats)
  };
}

export function parseDirectory(payload) {
  const results = Array.isArray(payload?.results) ? payload.results : [];
  return results
    .map((subject) => ({
      slug: String(subject?.slug || ""),
      title: String(subject?.title || ""),
      slideCount: Number(subject?.slideCount) || 0,
      sets: (Array.isArray(subject?.sets) ? subject.sets : []).map(parseSetSummary).filter(Boolean)
    }))
    .filter((subject) => subject.slug && subject.sets.length);
}

export function parseSet(payload) {
  if (!payload || !UUID_PATTERN.test(String(payload.id))) return null;
  return {
    id: String(payload.id),
    title: String(payload.title || ""),
    subject: { slug: String(payload.subject?.slug || ""), title: String(payload.subject?.title || "") },
    preview: payload.preview === true,
    stats: parseStats(payload.stats),
    slides: (Array.isArray(payload.slides) ? payload.slides : []).map(parseSlide).filter((slide) => slide && slide.imageUrl),
    mostMissed: (Array.isArray(payload.most_missed) ? payload.most_missed : [])
      .filter((item) => item && UUID_PATTERN.test(String(item.id)) && IMAGE_URL_PATTERN.test(String(item.image_url)))
      .map((item) => ({
        id: String(item.id),
        position: Number(item.position) || 0,
        imageUrl: String(item.image_url),
        expected: String(item.expected || ""),
        misses: Number(item.misses) || 0
      }))
  };
}

export const practiceApi = {
  /** @param {{ signal?: AbortSignal }} [options] */
  async directory({ signal } = {}) {
    return parseDirectory(await request("/catalog/practice", { signal }));
  },
  /**
   * One published set: its images in order. The names are not in it.
   * @param {string} setId
   * @param {{ signal?: AbortSignal }} [options]
   */
  async get(setId, { signal } = {}) {
    const set = parseSet(await request(`/catalog/practice/${encodeURIComponent(setId)}`, { signal }));
    if (!set) throw new ApiError(404, null, "Practice set not found.", "not_found");
    return set;
  },
  /**
   * Grade one typed name. The server is the only place the name is known.
   * @param {string} setId
   * @param {string} slideId
   * @param {string} answer
   * @returns {Promise<{ correct: boolean, expected: string, nearMiss: boolean, hinted: boolean, xpAwarded: number, setXpAwarded: number }>}
   */
  async check(setId, slideId, answer) {
    const payload = await request(`/catalog/practice/${encodeURIComponent(setId)}/slides/${encodeURIComponent(slideId)}/check`, {
      method: "POST", retryable: true, body: { answer }
    });
    return {
      correct: payload?.correct === true,
      expected: String(payload?.expected || ""),
      nearMiss: payload?.near_miss === true,
      hinted: payload?.hinted === true,
      xpAwarded: Math.max(0, Number(payload?.xp_awarded) || 0),
      setXpAwarded: Math.max(0, Number(payload?.set_xp_awarded) || 0)
    };
  },
  /**
   * Reveal the first letter of a slide's name. The next check on that slide
   * earns less XP, so this is a deliberate action, never a prefetch.
   * @param {string} setId
   * @param {string} slideId
   * @returns {Promise<string>}
   */
  async hint(setId, slideId) {
    const payload = await request(`/catalog/practice/${encodeURIComponent(setId)}/slides/${encodeURIComponent(slideId)}/hint`, { method: "POST" });
    return String(payload?.first_letter || "");
  }
};

/* ---------------------------- Administrators ---------------------------- */

function parseAdminSet(value) {
  if (!value || !UUID_PATTERN.test(String(value.id))) return null;
  return {
    id: String(value.id),
    title: String(value.title || ""),
    isPublished: value.is_published === true,
    slideCount: Number(value.slide_count) || 0,
    answeredCount: Number(value.answered_count) || 0
  };
}

function parseAdminSlide(value) {
  if (!value || !UUID_PATTERN.test(String(value.id))) return null;
  return {
    id: String(value.id),
    position: Number(value.position) || 0,
    answer: String(value.answer || ""),
    imageUrl: IMAGE_URL_PATTERN.test(String(value.image_url)) ? String(value.image_url) : "",
    fileName: String(value.file_name || ""),
    hotspot: parseHotspot(value.hotspot)
  };
}

export function parseAdminDetail(payload) {
  const set = parseAdminSet(payload?.set);
  if (!set) throw new ApiError(500, payload, "The practice set response was incomplete.", "invalid_response");
  return {
    set,
    subject: { id: String(payload?.subject?.id || ""), title: String(payload?.subject?.title || ""), slug: String(payload?.subject?.slug || "") },
    slides: (Array.isArray(payload?.slides) ? payload.slides : []).map(parseAdminSlide).filter(Boolean),
    maxSlides: Number(payload?.limits?.max_slides) || 200,
    rejected: (Array.isArray(payload?.rejected) ? payload.rejected : []).map((item) => ({ name: String(item?.name || ""), message: String(item?.message || "") })),
    added: Number(payload?.added) || 0,
    changed: Number(payload?.changed) || 0
  };
}

const adminBase = "/operations/admin/content";

export const adminPracticeApi = {
  /** @param {string} subjectId @param {{ signal?: AbortSignal }} [options] */
  async list(subjectId, { signal } = {}) {
    const payload = await request(`${adminBase}/subjects/${uuid(subjectId, "subject")}/practice`, { signal });
    return {
      subject: { id: String(payload?.subject?.id || subjectId), title: String(payload?.subject?.title || "") },
      sets: (Array.isArray(payload?.results) ? payload.results : []).map(parseAdminSet).filter(Boolean)
    };
  },
  async create(subjectId, title) {
    return parseAdminDetail(await request(`${adminBase}/subjects/${uuid(subjectId, "subject")}/practice`, { method: "POST", body: { title } }));
  },
  /** @param {string} setId @param {{ signal?: AbortSignal }} [options] */
  async get(setId, { signal } = {}) {
    return parseAdminDetail(await request(`${adminBase}/practice/${uuid(setId, "set")}`, { signal }));
  },
  /** @param {string} setId @param {{ title?: string, is_published?: boolean }} changes */
  async update(setId, changes) {
    return parseAdminDetail(await request(`${adminBase}/practice/${uuid(setId, "set")}`, { method: "PATCH", body: changes }));
  },
  async remove(setId) {
    await request(`${adminBase}/practice/${uuid(setId, "set")}`, { method: "DELETE" });
  },
  /**
   * Add images to the end of the set, in the order of `files`.
   * @param {string} setId
   * @param {File[]} files
   * @param {{ onProgress?: (fraction: number) => void, signal?: AbortSignal }} [options]
   */
  async addImages(setId, files, options = {}) {
    const body = new FormData();
    for (const file of files) body.append("files", file);
    return parseAdminDetail(await uploadWithProgress(`${adminBase}/practice/${uuid(setId, "set")}/slides`, body, options));
  },
  /**
   * Add every image inside one ZIP, in natural file-name order.
   * @param {string} setId
   * @param {File} archive
   * @param {{ onProgress?: (fraction: number) => void, signal?: AbortSignal }} [options]
   */
  async addArchive(setId, archive, options = {}) {
    const body = new FormData();
    body.append("archive", archive);
    return parseAdminDetail(await uploadWithProgress(`${adminBase}/practice/${uuid(setId, "set")}/slides`, body, options));
  },
  async setAnswer(setId, slideId, answer) {
    return parseAdminDetail(await request(`${adminBase}/practice/${uuid(setId, "set")}/slides/${uuid(slideId, "slide")}`, { method: "PATCH", body: { answer } }));
  },
  /**
   * Place, change or (with null) clear the mark students see over a slide.
   * @param {string} setId
   * @param {string} slideId
   * @param {{ x: number, y: number, shape: string } | null} hotspot
   */
  async setHotspot(setId, slideId, hotspot) {
    return parseAdminDetail(await request(`${adminBase}/practice/${uuid(setId, "set")}/slides/${uuid(slideId, "slide")}`, { method: "PATCH", body: { hotspot } }));
  },
  /** @param {string} setId @param {string} slideId @param {number} position 1-based */
  async moveSlide(setId, slideId, position) {
    return parseAdminDetail(await request(`${adminBase}/practice/${uuid(setId, "set")}/slides/${uuid(slideId, "slide")}/move`, { method: "POST", body: { position } }));
  },
  /**
   * Swap a slide's picture; its name, position and mark stay.
   * @param {string} setId
   * @param {string} slideId
   * @param {File} file
   * @param {{ onProgress?: (fraction: number) => void, signal?: AbortSignal }} [options]
   */
  async replaceImage(setId, slideId, file, options = {}) {
    const body = new FormData();
    body.append("file", file);
    return parseAdminDetail(await uploadWithProgress(`${adminBase}/practice/${uuid(setId, "set")}/slides/${uuid(slideId, "slide")}/image`, body, options));
  },
  /** An unpublished copy of the set, images included. @param {string} setId @param {string} [title] */
  async duplicate(setId, title) {
    return parseAdminDetail(await request(`${adminBase}/practice/${uuid(setId, "set")}/duplicate`, { method: "POST", body: title ? { title } : {} }));
  },
  async removeSlide(setId, slideId) {
    return parseAdminDetail(await request(`${adminBase}/practice/${uuid(setId, "set")}/slides/${uuid(slideId, "slide")}`, { method: "DELETE" }));
  },
  /** @param {string} setId @param {string[]} ids every slide id, in the new order */
  async reorder(setId, ids) {
    return parseAdminDetail(await request(`${adminBase}/practice/${uuid(setId, "set")}/reorder`, { method: "POST", body: { ids } }));
  },
  /** @param {string} setId @param {string[]} answers by position; a blank entry keeps the current answer */
  async setAnswers(setId, answers) {
    return parseAdminDetail(await request(`${adminBase}/practice/${uuid(setId, "set")}/answers`, { method: "POST", body: { answers } }));
  }
};

/**
 * Read a pasted answers list: `{"answers": ["Femur", ...]}`, a bare array, or
 * `{"answers": [{"answer": "Femur"}]}`. Returns the names in order or a message.
 * @param {string} text
 * @returns {{ answers: string[] } | { error: string }}
 */
export function parseAnswersJson(text) {
  const source = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  if (!source) return { error: "empty" };
  let value;
  try { value = JSON.parse(source); } catch { return { error: "syntax" }; }
  const list = Array.isArray(value) ? value : Array.isArray(value?.answers) ? value.answers : null;
  if (!list) return { error: "shape" };
  const answers = [];
  for (const item of list) {
    const answer = typeof item === "string" ? item : item && typeof item === "object" && typeof item.answer === "string" ? item.answer : null;
    if (answer === null) return { error: "item" };
    answers.push(answer);
  }
  if (!answers.length) return { error: "empty" };
  if (answers.some((answer) => answer.length > PRACTICE_ANSWER_MAX_LENGTH * 2)) return { error: "long" };
  return { answers };
}

const FILL_IN_PLACEHOLDER = "(name)";
const fileStem = (fileName) => String(fileName || "").replace(/\.[^./\\]+$/, "");

/**
 * The fill-in list the admin completes: one line per slide, `Image1 - (name)`.
 * @param {{ fileName: string, answer?: string }[]} slides
 */
export function buildFillInList(slides) {
  return slides.map((slide) => `${fileStem(slide.fileName)} - ${slide.answer || FILL_IN_PLACEHOLDER}`).join("\n");
}

/**
 * Read the completed list: each line starts with a slide's file name, then a
 * dash or colon, then the name. Lines still holding `(name)` are left blank.
 * @param {string} text
 * @param {{ fileName: string }[]} slides
 * @returns {{ answers: string[], matched: number, unmatched: string[] } | { error: string }}
 */
export function parseFillInList(text, slides) {
  const lines = String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return { error: "empty" };
  const stems = slides.map((slide) => fileStem(slide.fileName).trim().toLowerCase());
  const byLength = stems.map((stem, index) => ({ stem, index })).filter((item) => item.stem).sort((a, b) => b.stem.length - a.stem.length);
  const answers = slides.map(() => "");
  const taken = new Set();
  const unmatched = [];
  let matched = 0;
  for (const line of lines) {
    const lower = line.toLowerCase();
    let found = null;
    for (const { stem, index } of byLength) {
      if (taken.has(index) || !lower.startsWith(stem)) continue;
      const rest = line.slice(stem.length).match(/^\s*[-:–—=]\s*(.*)$/);
      if (rest) { found = { index, value: rest[1].trim() }; break; }
    }
    if (!found) { unmatched.push(line); continue; }
    taken.add(found.index);
    matched += 1;
    const value = found.value;
    if (value && value.toLowerCase() !== FILL_IN_PLACEHOLDER) answers[found.index] = value;
  }
  if (!matched) return { error: "nolines" };
  if (answers.some((answer) => answer.length > PRACTICE_ANSWER_MAX_LENGTH * 2)) return { error: "long" };
  return { answers, matched, unmatched };
}
