import { offlineDatabase } from "./database.js";
import { getOfflineActiveStudy, readDownloadMetadata } from "./downloads.js";
import { offlineAccessStatus } from "./lease.js";
import { currentOfflineUserId } from "./profile.js";
import { enqueueOperation, hasPendingFor, pendingOfflineOperations, registerOperationHandler } from "./queue.js";
import { isNetworkFailure, offlineUnavailableError } from "./resolver.js";

/**
 * Managed Active Study without a connection.
 *
 * The workspace keeps calling the same `focusApi` methods. Online, they reach
 * Django and their responses are mirrored here, so a connection lost halfway
 * through a part continues from exactly where the server was. Offline, this
 * module answers with the same response shapes from the downloaded bundle and
 * the device's own run, following the server's rules step for step: the same
 * part ranges, the same checkpoint and final pass marks, the same stage
 * transitions. Each finished checkpoint or final exam becomes one immutable
 * queued attempt; the server replays it, grades it again and alone awards XP.
 */

const RUN_PREFIX = "as-run:";
const RUN_ID_PREFIX = "as-runid:";

function displayOptions(question) {
  return question.type === "true_false" ? { T: "True", F: "False" } : question.options;
}

function correctAnswer(question) {
  return question.type === "true_false" ? (question.correct_answer ? "T" : "F") : question.correct_answer;
}

export const runKey = (sheetId, edition, difficulty) => `${sheetId}:${edition || "university"}:${difficulty}`;
export const orderingKey = (key) => `active_study:${key}`;

function queued() {
  // The app shell listens and syncs soon if a connection is available.
  globalThis.window?.dispatchEvent?.(new globalThis.window.CustomEvent("lock-in:offline-queued"));
}

async function readRun(userId, key) {
  return offlineDatabase.get(userId, `${RUN_PREFIX}${key}`);
}

async function keyForRunId(userId, runId) {
  return runId ? offlineDatabase.get(userId, `${RUN_ID_PREFIX}${runId}`) : null;
}

/** @returns {Array<[string, any]>} */
function runRecords(run) {
  /** @type {Array<[string, any]>} */
  const records = [[`${RUN_PREFIX}${run.key}`, run], [`${RUN_ID_PREFIX}${run.id}`, run.key]];
  if (run.server_id && run.server_id !== run.id) records.push([`${RUN_ID_PREFIX}${run.server_id}`, run.key]);
  return records;
}

async function saveRun(userId, run) {
  await offlineDatabase.putMany(userId, runRecords({ ...run, updated_at: new Date().toISOString() }));
}

/** The server's `run_payload` shape, so the workspace cannot tell the difference. */
export function runPayload(run) {
  if (!run) return null;
  const ranges = run.page_ranges || [];
  return {
    id: run.id,
    sheet_id: run.sheet_id,
    difficulty: run.difficulty,
    status: run.status,
    stage: run.stage,
    current_part: run.current_part,
    number_of_parts: ranges.length,
    current_page_range: ranges.find((item) => item.part === run.current_part) || null,
    completed_parts: [...run.completed_parts],
    checkpoint_attempts: run.checkpoint_attempts,
    final_attempts: run.final_attempts,
    last_score: run.last_score,
    last_outcome: run.last_outcome,
    xp_awarded: run.xp_awarded,
    ...(run.origin === "local" || run.dirty ? { offline: true } : {})
  };
}

function fromServer(payload, { key, sheetId, edition, pageRanges, previous = null }) {
  return {
    key,
    id: previous?.id && previous.server_id === payload.id ? previous.id : payload.id,
    server_id: payload.id,
    origin: "server",
    dirty: false,
    sheet_id: sheetId,
    edition,
    difficulty: payload.difficulty,
    status: payload.status,
    stage: payload.stage,
    current_part: payload.current_part,
    completed_parts: [...(payload.completed_parts || [])],
    checkpoint_attempts: payload.checkpoint_attempts || 0,
    final_attempts: payload.final_attempts || 0,
    last_score: payload.last_score ?? null,
    last_outcome: payload.last_outcome || "",
    xp_awarded: payload.xp_awarded || 0,
    page_ranges: pageRanges || previous?.page_ranges || [],
    open_attempt: previous && previous.server_id === payload.id && previous.stage === payload.stage ? previous.open_attempt : null
  };
}

/**
 * Adopts the server's progress for runs this device has no unsynced work on.
 * Called with a downloaded bundle and with every online availability read.
 */
export async function seedActiveStudyRuns(userId, bundle) {
  if (!bundle?.availability?.difficulties) return;
  for (const row of bundle.availability.difficulties) {
    const key = runKey(bundle.sheet_id, bundle.edition, row.difficulty);
    if (await hasPendingFor(userId, orderingKey(key))) continue;
    const previous = await readRun(userId, key);
    if (previous?.dirty) continue;
    const pageRanges = bundle.difficulties?.[row.difficulty]?.page_ranges || row.page_ranges;
    if (row.progress) {
      await saveRun(userId, fromServer(row.progress, { key, sheetId: bundle.sheet_id, edition: bundle.edition, pageRanges, previous }));
    } else if (previous && previous.status === "active") {
      // Completed or abandoned elsewhere: the server's view wins.
      await offlineDatabase.delete(userId, `${RUN_PREFIX}${key}`);
    }
    if (row.completed) await offlineDatabase.put(userId, `as-completed:${key}`, true);
  }
}

// --- Rules (mirrors apps.focus.managed_active_study) ------------------------

class ActiveStudyRuleError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
    this.code = "active_study_rule";
  }
}

async function requireBundle(userId, sheetId, edition, difficulty = "") {
  const bundle = await getOfflineActiveStudy(userId, sheetId, edition);
  if (!bundle || (difficulty && !bundle.difficulties?.[difficulty])) throw offlineUnavailableError();
  return bundle;
}

async function requireRun(userId, runId) {
  if (!(await offlineAccessStatus(userId)).available) throw offlineUnavailableError();
  const key = await keyForRunId(userId, runId);
  const run = key ? await readRun(userId, key) : null;
  if (!run || (run.id !== runId && run.server_id !== runId)) throw new ActiveStudyRuleError("Active Study session not found.");
  const bundle = await requireBundle(userId, run.sheet_id, run.edition, run.difficulty);
  const content = bundle.difficulties[run.difficulty];
  return { run, content, rules: content.rules || bundle.rules };
}

function questionsFor(content, kind, part) {
  if (kind === "final") return content.final_exam.questions;
  return content.parts.find((item) => item.part === part)?.questions || [];
}

function advanceAfterPart(run) {
  const completed = [...run.completed_parts, run.current_part];
  if (run.current_part >= run.page_ranges.length) return { ...run, completed_parts: completed, stage: "final" };
  return { ...run, completed_parts: completed, current_part: run.current_part + 1, stage: "reading" };
}

const local = {
  async availability(userId, sheetId, edition) {
    const bundle = await requireBundle(userId, sheetId, edition);
    const rows = await Promise.all(bundle.availability.difficulties.map(async (row) => {
      const key = runKey(sheetId, edition, row.difficulty);
      const run = await readRun(userId, key);
      const content = bundle.difficulties[row.difficulty];
      return {
        difficulty: row.difficulty,
        status: content ? "ready" : row.status === "ready" ? "unavailable" : row.status,
        number_of_parts: content?.number_of_parts ?? row.number_of_parts,
        page_ranges: content?.page_ranges ?? row.page_ranges,
        progress: run?.status === "active" ? runPayload(run) : null,
        completed: Boolean(row.completed || run?.status === "completed" || await offlineDatabase.get(userId, `as-completed:${key}`))
      };
    }));
    return { sheet_id: sheetId, enabled: bundle.availability.enabled, difficulties: rows, offline: true };
  },

  async start(userId, { sheetId, difficulty, edition }) {
    if (!(await offlineAccessStatus(userId)).available) throw offlineUnavailableError();
    const bundle = await requireBundle(userId, sheetId, edition, difficulty);
    const key = runKey(sheetId, edition, difficulty);
    const existing = await readRun(userId, key);
    if (existing?.status === "active") return { run: runPayload(existing), resumed: true };
    // The server starts the same run itself when the first checkpoint syncs.
    const run = {
      key, id: globalThis.crypto.randomUUID(), server_id: null, origin: "local", dirty: true,
      sheet_id: sheetId, edition, difficulty, status: "active", stage: "reading", current_part: 1,
      completed_parts: [], checkpoint_attempts: 0, final_attempts: 0, last_score: null, last_outcome: "",
      xp_awarded: 0, page_ranges: bundle.difficulties[difficulty].page_ranges, open_attempt: null
    };
    await saveRun(userId, run);
    return { run: runPayload(run), resumed: false };
  },

  async action(userId, runId, action) {
    const { run } = await requireRun(userId, runId);
    if (action === "complete-reading") {
      if (run.status !== "active" || run.stage !== "reading") throw new ActiveStudyRuleError("This part is not ready for its checkpoint.");
      const next = { ...run, stage: "checkpoint" };
      await saveRun(userId, next);
      return { run: runPayload(next) };
    }
    if (action === "study-again") {
      if (run.stage !== "checkpoint_result") throw new ActiveStudyRuleError("This checkpoint cannot be studied again now.");
      const next = { ...run, stage: "reading", last_outcome: "study_again" };
      await saveRun(userId, next);
      return { run: runPayload(next) };
    }
    if (action === "retry-final") {
      if (run.status !== "active" || run.stage !== "final_result") throw new ActiveStudyRuleError("The final exam cannot be retried now.");
      const next = { ...run, stage: "final", last_outcome: "retry_final" };
      await saveRun(userId, next);
      return { run: runPayload(next) };
    }
    if (action === "discard-attempt") {
      if (run.status !== "active" || !["checkpoint", "final"].includes(run.stage)) throw new ActiveStudyRuleError("There is no open question attempt to discard.");
      const next = { ...run, open_attempt: null };
      await saveRun(userId, next);
      return { run: runPayload(next) };
    }
    if (action === "continue") {
      if (run.stage !== "checkpoint_result" || run.last_outcome !== "failed") throw new ActiveStudyRuleError("This checkpoint does not need a continuation choice.");
      const next = { ...advanceAfterPart(run), last_outcome: "continued_anyway", dirty: true };
      await enqueueOperation(userId, {
        type: "active_study_continue", entityType: "active_study_run", entityId: run.key, orderingKey: orderingKey(run.key),
        payload: { sheet_id: run.sheet_id, edition: run.edition, difficulty: run.difficulty, part: run.current_part }
      }, runRecords({ ...next, updated_at: new Date().toISOString() }));
      queued();
      return { run: runPayload(next) };
    }
    if (action === "restart") {
      if (run.status !== "active") throw new ActiveStudyRuleError("Only an active Active Study run can be restarted.");
      const fresh = {
        ...run, id: globalThis.crypto.randomUUID(), server_id: null, origin: "local", dirty: true,
        status: "active", stage: "reading", current_part: 1, completed_parts: [], checkpoint_attempts: 0,
        final_attempts: 0, last_score: null, last_outcome: "", xp_awarded: 0, open_attempt: null
      };
      await enqueueOperation(userId, {
        type: "active_study_restart", entityType: "active_study_run", entityId: run.key, orderingKey: orderingKey(run.key),
        payload: { sheet_id: run.sheet_id, edition: run.edition, difficulty: run.difficulty }
      }, runRecords({ ...fresh, updated_at: new Date().toISOString() }));
      queued();
      return { run: runPayload(fresh) };
    }
    throw offlineUnavailableError("This action needs a connection.");
  },

  async questions(userId, runId) {
    const { run, content } = await requireRun(userId, runId);
    if (run.status !== "active" || !["checkpoint", "final"].includes(run.stage)) throw new ActiveStudyRuleError("Questions are not available at this stage.");
    const kind = run.stage === "final" ? "final" : "checkpoint";
    const part = kind === "final" ? null : run.current_part;
    const source = questionsFor(content, kind, part);
    const attempt = run.open_attempt?.kind === kind && run.open_attempt.part === part
      ? run.open_attempt
      : { id: globalThis.crypto.randomUUID(), kind, part, answers: {} };
    if (attempt !== run.open_attempt) await saveRun(userId, { ...run, open_attempt: attempt });
    return {
      run: runPayload(run),
      attempt_id: attempt.id,
      kind,
      questions: source.map((item, index) => ({
        position: index + 1,
        question: item.question,
        question_type: item.type || "mcq",
        options: displayOptions(item),
        answered: attempt.answers[String(index + 1)] ?? null
      })),
      offline: true
    };
  },

  async answer(userId, runId, { attemptId, position, selectedAnswer }) {
    const { run, content } = await requireRun(userId, runId);
    const attempt = run.open_attempt;
    if (!attempt || attempt.id !== attemptId) throw new ActiveStudyRuleError("This question attempt is no longer active.");
    const kind = run.stage === "final" ? "final" : "checkpoint";
    if (attempt.kind !== kind || attempt.part !== (kind === "final" ? null : run.current_part)) {
      throw new ActiveStudyRuleError("This question does not belong to the current Active Study stage.");
    }
    const source = questionsFor(content, kind, attempt.part);
    if (!Number.isInteger(position) || position < 1 || position > source.length) throw new ActiveStudyRuleError("Question position is invalid.");
    const question = source[position - 1];
    if (!Object.hasOwn(displayOptions(question), selectedAnswer)) throw new ActiveStudyRuleError("Choose an answer for this question.");
    const existing = attempt.answers[String(position)];
    if (existing && existing !== selectedAnswer) throw new ActiveStudyRuleError("This answer was already submitted.");
    const answers = { ...attempt.answers, [String(position)]: selectedAnswer };
    await saveRun(userId, { ...run, open_attempt: { ...attempt, answers } });
    return {
      correct: selectedAnswer === correctAnswer(question),
      correct_answer: correctAnswer(question),
      explanation: question.explanation,
      answered_count: Object.keys(answers).length,
      total: source.length
    };
  },

  async submit(userId, runId, attemptId) {
    const { run, content, rules } = await requireRun(userId, runId);
    const attempt = run.open_attempt;
    if (!attempt || attempt.id !== attemptId) throw new ActiveStudyRuleError("Question attempt not found.");
    const expected = attempt.kind === "final" ? "final" : "checkpoint";
    if (run.stage !== expected || (attempt.kind === "checkpoint" && attempt.part !== run.current_part)) {
      throw new ActiveStudyRuleError("This attempt cannot be submitted now.");
    }
    const source = questionsFor(content, attempt.kind, attempt.part);
    if (Object.keys(attempt.answers).length !== source.length) throw new ActiveStudyRuleError("Answer every question before submitting.");
    const score = source.filter((question, index) => attempt.answers[String(index + 1)] === correctAnswer(question)).length;
    const passed = score >= (attempt.kind === "final" ? rules.final_pass : rules.checkpoint_pass);
    let next = { ...run, open_attempt: null, last_score: score, last_outcome: passed ? "passed" : "failed", dirty: true };
    if (attempt.kind === "checkpoint") {
      next.checkpoint_attempts += 1;
      next = passed ? advanceAfterPart(next) : { ...next, stage: "checkpoint_result" };
    } else {
      next.final_attempts += 1;
      next.stage = "final_result";
      if (passed) next.status = "completed";
    }
    // One immutable record of the attempt. Its ID becomes the server
    // attempt's ID, so a repeated upload can never grade or reward it twice.
    await enqueueOperation(userId, {
      type: "active_study_attempt", entityType: "active_study_run", entityId: run.key, orderingKey: orderingKey(run.key),
      payload: {
        sheet_id: run.sheet_id,
        edition: run.edition,
        difficulty: run.difficulty,
        kind: attempt.kind,
        part: attempt.kind === "final" ? null : attempt.part,
        attempt_id: attempt.id,
        answers: source.map((_, index) => ({ position: index + 1, selected_answer: attempt.answers[String(index + 1)] }))
      }
    }, runRecords({ ...next, updated_at: new Date().toISOString() }));
    queued();
    return {
      run: runPayload(next),
      result: { score, total: source.length, passed, completed: next.status === "completed", xp_awarded: 0, pending_sync: true }
    };
  }
};

export const offlineActiveStudy = local;

// --- Online mirror --------------------------------------------------------

async function hasBundle(userId, sheetId, edition) {
  return Boolean(await readDownloadMetadata(userId, `active_study:${sheetId}:${edition || "university"}`));
}

/** @param {string} userId @param {string | null} key @param {any} payload @param {{ openAttempt?: any }} [options] */
async function mirrorRun(userId, key, payload, { openAttempt } = {}) {
  if (!payload?.id || !key) return;
  if (await hasPendingFor(userId, orderingKey(key))) return;
  const previous = await readRun(userId, key);
  const [sheetId, edition] = key.split(":");
  const run = fromServer(payload, { key, sheetId, edition, pageRanges: previous?.page_ranges, previous });
  if (!run.page_ranges.length) {
    const bundle = await getOfflineActiveStudy(userId, sheetId, edition).catch(() => null);
    run.page_ranges = bundle?.difficulties?.[payload.difficulty]?.page_ranges || [];
  }
  if (openAttempt !== undefined) run.open_attempt = openAttempt;
  await saveRun(userId, run);
}

async function localRunFor(userId, runId) {
  const key = await keyForRunId(userId, runId);
  return key ? { key, run: await readRun(userId, key) } : { key: null, run: null };
}

/**
 * Online first; the device's copy when the network fails. A run that still has
 * unsynced offline work, or that the server has not seen yet, stays on the
 * device until the queue delivers it, so events are never applied out of order.
 */
async function route(userId, key, online, offline) {
  if (userId && key) {
    const run = await readRun(userId, key);
    const [sheetId, edition] = key.split(":");
    const unsynced = await hasPendingFor(userId, orderingKey(key)) || Boolean(run && run.origin === "local" && !run.server_id);
    // Without the bundle (download removed) the device cannot continue the
    // run; the server starts or resumes it and queued work still syncs.
    if (unsynced && await hasBundle(userId, sheetId, edition)) return offline();
  }
  try {
    return await online();
  } catch (error) {
    if (!userId || !key || !isNetworkFailure(error)) throw error;
    const [sheetId, edition] = key.split(":");
    if (!(await hasBundle(userId, sheetId, edition))) throw error;
    return offline();
  }
}

async function hasPendingForScope(userId, sheetId, edition) {
  return (await pendingOfflineOperations(userId)).some((operation) => operation.ordering_key?.startsWith(`active_study:${sheetId}:${edition}:`));
}

/**
 * The managed Active Study client the `focusApi` methods delegate to.
 * `online` receives the run ID the server knows.
 */
export const activeStudyClient = {
  async availability({ sheetId, edition }, online) {
    const userId = currentOfflineUserId();
    const scope = edition || "university";
    let payload;
    try {
      payload = await online();
    } catch (error) {
      if (!userId || !isNetworkFailure(error) || !(await hasBundle(userId, sheetId, scope))) throw error;
      return local.availability(userId, sheetId, scope);
    }
    if (userId && await hasBundle(userId, sheetId, scope)) {
      const bundle = await getOfflineActiveStudy(userId, sheetId, scope).catch(() => null);
      if (bundle) await seedActiveStudyRuns(userId, { ...bundle, availability: payload }).catch(() => undefined);
      // Offline progress the server has not received yet stays visible.
      if (await hasPendingForScope(userId, sheetId, scope)) return local.availability(userId, sheetId, scope).catch(() => payload);
    }
    return payload;
  },

  async start({ sheetId, difficulty, edition }, online) {
    const userId = currentOfflineUserId();
    const key = runKey(sheetId, edition || "university", difficulty);
    return route(userId, key, async () => {
      const payload = await online();
      if (userId && await hasBundle(userId, sheetId, edition)) await mirrorRun(userId, key, payload.run).catch(() => undefined);
      else if (userId && payload?.run?.id) await offlineDatabase.put(userId, `${RUN_ID_PREFIX}${payload.run.id}`, key).catch(() => undefined);
      return payload;
    }, () => local.start(userId, { sheetId, difficulty, edition: edition || "university" }));
  },

  async action(runId, action, online) {
    const userId = currentOfflineUserId();
    const { key, run } = userId ? await localRunFor(userId, runId) : { key: null, run: null };
    return route(userId, key, async () => {
      const payload = await online(run?.server_id || runId);
      if (key && payload?.run) {
        if (action === "restart") await offlineDatabase.put(userId, `${RUN_ID_PREFIX}${payload.run.id}`, key).catch(() => undefined);
        await mirrorRun(userId, key, payload.run, ["complete-reading", "discard-attempt", "retry-final", "restart"].includes(action) ? { openAttempt: null } : {}).catch(() => undefined);
      }
      return payload;
    }, () => local.action(userId, run?.id || runId, action));
  },

  async questions(runId, online) {
    const userId = currentOfflineUserId();
    const { key, run } = userId ? await localRunFor(userId, runId) : { key: null, run: null };
    return route(userId, key, async () => {
      const payload = await online(run?.server_id || runId);
      if (key && payload?.run) {
        const answers = {};
        for (const question of payload.questions || []) if (question.answered) answers[String(question.position)] = question.answered;
        const kind = payload.kind === "final" ? "final" : "checkpoint";
        await mirrorRun(userId, key, payload.run, {
          openAttempt: { id: payload.attempt_id, kind, part: kind === "final" ? null : payload.run.current_part, answers }
        }).catch(() => undefined);
      }
      return payload;
    }, () => local.questions(userId, run?.id || runId));
  },

  async answer(runId, body, online) {
    const userId = currentOfflineUserId();
    const { key, run } = userId ? await localRunFor(userId, runId) : { key: null, run: null };
    return route(userId, key, async () => {
      const payload = await online(run?.server_id || runId);
      // The server holds this answer now; so does the device's open attempt,
      // in case the rest of the attempt finishes offline.
      if (key && run?.open_attempt?.id === body.attemptId) {
        const answers = { ...run.open_attempt.answers, [String(body.position)]: body.selectedAnswer };
        await saveRun(userId, { ...run, open_attempt: { ...run.open_attempt, answers } }).catch(() => undefined);
      }
      return payload;
    }, () => local.answer(userId, run?.id || runId, body));
  },

  async submit(runId, attemptId, online) {
    const userId = currentOfflineUserId();
    const { key, run } = userId ? await localRunFor(userId, runId) : { key: null, run: null };
    return route(userId, key, async () => {
      const payload = await online(run?.server_id || runId);
      if (key && payload?.run) await mirrorRun(userId, key, payload.run, { openAttempt: null }).catch(() => undefined);
      return payload;
    }, () => local.submit(userId, run?.id || runId, attemptId));
  }
};

/** The device's current view of a run, for refreshing an open workspace after sync. */
export async function readActiveStudyRun(userId, runId) {
  const { run } = await localRunFor(userId, runId);
  return runPayload(run);
}

/**
 * After a sync, adopt the server's run for every key whose offline work is
 * fully acknowledged. `fetchAvailability` reads the online availability.
 */
export async function reconcileActiveStudyRuns(userId, keys, fetchAvailability) {
  const scopes = new Map();
  for (const key of keys) {
    const [sheetId, edition] = key.split(":");
    scopes.set(`${sheetId}:${edition}`, { sheetId, edition });
  }
  for (const { sheetId, edition } of scopes.values()) {
    if (await hasPendingForScope(userId, sheetId, edition)) continue;
    const availability = await fetchAvailability(sheetId, edition);
    for (const row of availability?.difficulties || []) {
      const key = runKey(sheetId, edition, row.difficulty);
      const previous = await readRun(userId, key);
      if (row.progress) {
        await saveRun(userId, fromServer(row.progress, { key, sheetId, edition, pageRanges: previous?.page_ranges || row.page_ranges, previous }));
      } else if (previous) {
        // Completed (or restarted elsewhere). Keep the local ID mapping so an
        // open workspace can still resolve the run it is showing.
        await saveRun(userId, { ...previous, dirty: false, status: row.completed ? "completed" : previous.status });
      }
      if (row.completed) await offlineDatabase.put(userId, `as-completed:${key}`, true);
    }
  }
}

async function adoptServerIds(userId, operation, result) {
  const key = operation.entity_id;
  const run = await readRun(userId, key);
  if (!run || !result?.run?.id) return;
  const serverRunId = result.run.id;
  // A restart replaces the run; its successor's ID is learned the same way.
  await saveRun(userId, {
    ...run,
    server_id: serverRunId,
    xp_awarded: result.result?.xp_awarded ?? run.xp_awarded
  });
}

for (const type of ["active_study_attempt", "active_study_continue", "active_study_restart"]) {
  registerOperationHandler(type, {
    onAccepted: adoptServerIds,
    async onRejected(userId, operation) {
      // The server refused this event; the device's run is no longer a
      // faithful copy. Mark it so the next online read replaces it.
      const run = await readRun(userId, operation.entity_id);
      if (run) await saveRun(userId, { ...run, dirty: false, origin: "server" });
    }
  });
}
