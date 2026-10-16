import { offlineDatabase } from "../../offline/database.js";
import { captureOfflineSession } from "../../offline/sessionScope.js";
import { resolveStored } from "../../offline/resolver.js";
import { newId, documentSize, MAX_DOCUMENT_BYTES } from "./model.js";

const prefix = (documentId) => `knowledge:${documentId}:`;
const draftKey = (documentId, id) => `${prefix(documentId)}artifact:${id}`;
const attemptKey = (documentId, id) => `${prefix(documentId)}attempt:${id}`;
const queues = new Map();

async function locked(name, action) {
  if (globalThis.navigator?.locks) return navigator.locks.request(name, action);
  const before = queues.get(name) || Promise.resolve();
  const next = before.catch(() => {}).then(action);
  queues.set(name, next);
  try { return await next; }
  finally { if (queues.get(name) === next) queues.delete(name); }
}

/** Local draft writes and network acknowledgements share a lock and generation check. */
export function createKnowledgeStore(userId, documentId, api, db = offlineDatabase) {
  const assertCurrent = captureOfflineSession(userId);
  const write = (key, value) => db.putScoped(userId, key, value, assertCurrent);
  const withDraft = (id, action) => locked(`knowledge:${userId}:${documentId}:${id}`, action);
  let uiVersion = 0;
  const mutate = async (key, action) => {
    if (db.updateScoped) return db.updateScoped(userId, key, action, assertCurrent);
    // In-memory adapters used by unit tests; the browser always uses atomic IndexedDB.
    const previous = await db.get(userId, key);
    assertCurrent();
    const next = action(previous);
    if (next === undefined) await db.deleteScoped(userId, key, assertCurrent);
    else await write(key, next);
    return next;
  };
  return {
    assertCurrent,
    async readUI() {
      const value = await db.get(userId, `${prefix(documentId)}ui`);
      assertCurrent(); uiVersion = value?._knowledgeUiRevision || 0;
      const { _knowledgeUiRevision: _revision, ...ui } = value || {};
      return ui;
    },
    async saveUI(value) {
      assertCurrent();
      return withDraft("ui", async () => {
        const saved = await mutate(`${prefix(documentId)}ui`, (previous) => {
          if ((previous?._knowledgeUiRevision || 0) !== uiVersion) throw Object.assign(new Error("local_conflict"), { code: "knowledge_conflict" });
          return { ...value, _knowledgeUiRevision: uiVersion + 1 };
        });
        uiVersion = saved._knowledgeUiRevision;
        return saved;
      });
    },
    async bootstrap() {
      return resolveStored(userId, `${prefix(documentId)}bootstrap`, () => api.bootstrap(documentId));
    },
    async detail(id, revision) {
      return resolveStored(userId, `${prefix(documentId)}detail:${id}:${revision}`, () => api.detail(documentId, id));
    },
    async drafts() {
      assertCurrent();
      const keys = (await db.keys(userId)).filter((key) => String(key).startsWith(prefix(documentId))
        && (String(key).includes(":artifact:") || String(key).includes(":attempt:")));
      const values = await db.getMany(userId, keys);
      assertCurrent();
      return values.filter(Boolean);
    },
    async edit(record, expectedLocalVersion = 0) {
      assertCurrent();
      if (documentSize(record) > MAX_DOCUMENT_BYTES) throw Object.assign(new Error("document_limit"), { code: "document_limit" });
      return withDraft(record.id, async () => {
        assertCurrent();
        const key = draftKey(documentId, record.id);
        return mutate(key, (previous) => {
        if (previous && previous.localVersion !== expectedLocalVersion) {
          // The caller retains the rejected draft in memory for export/copy.
          throw Object.assign(new Error("local_conflict"), { code: "knowledge_conflict" });
        }
        const envelope = {
          record, dirty: true, localVersion: expectedLocalVersion + 1,
          baseRevision: previous?.dirty ? previous.baseRevision : record.revision,
          pending: previous?.dirty ? previous.pending : null, conflict: previous?.dirty ? previous.conflict : null,
        };
        return envelope;
        });
      });
    },
    async sync(id) {
      assertCurrent();
      const key = draftKey(documentId, id);
      const sent = await withDraft(id, async () => {
        const next = await mutate(key, (envelope) => {
        if (!envelope?.dirty || envelope.conflict) return envelope;
        const record = envelope.record;
        const pending = envelope.pending || {
          generation: envelope.localVersion,
          body: {
            account_id: userId,
            mutation_id: newId(), expected_revision: envelope.baseRevision,
            source_version_id: record.source_version_id, source_file_id: record.source_file_id,
            kind: record.kind, title: record.title || record.kind,
            page_start: record.page_start, page_end: record.page_end,
            content: record.content, deleted: record.deleted === true,
          },
        };
        return { ...envelope, pending };
        });
        return next?.dirty && !next.conflict ? next.pending : null;
      });
      if (!sent) return null;
      try {
        assertCurrent();
        const response = await api.save(documentId, id, sent.body);
        assertCurrent();
        return await withDraft(id, () => mutate(key, (current) => {
          if (current?.pending?.body.mutation_id !== sent.body.mutation_id) return current;
          const edited = current.localVersion !== sent.generation;
          const next = { ...current, pending: null, baseRevision: response.revision,
            dirty: edited, record: edited ? { ...current.record, revision: response.revision } : response };
          return next;
        }));
      } catch (error) {
        if (error.status === 409 && assertCurrent.isCurrent()) {
          await withDraft(id, () => mutate(key, (current) => current?.pending?.body.mutation_id === sent.body.mutation_id ? { ...current, conflict: true } : current));
        }
        throw error;
      }
    },
    async archiveDraft(id, expectedLocalVersion) {
      return withDraft(id, async () => {
        assertCurrent();
        const key = draftKey(documentId, id);
        const draft = await db.get(userId, key);
        if (!draft || (expectedLocalVersion !== undefined && draft.localVersion !== expectedLocalVersion)) return false;
        await write(`${prefix(documentId)}recovery:${id}:${newId()}`, draft);
        let removed = false;
        await mutate(key, (current) => {
          if (current?.localVersion !== draft.localVersion) return current;
          removed = true; return undefined;
        });
        return removed;
      });
    },
    async queueAttempt(id, body) {
      assertCurrent();
      await write(attemptKey(documentId, id), { attemptId: id, body: { ...body, account_id: userId }, pendingAttempt: true });
    },
    async syncAttempt(id) {
      assertCurrent();
      const key = attemptKey(documentId, id);
      const pending = await db.get(userId, key);
      if (!pending?.pendingAttempt) return pending?.response;
      assertCurrent();
      const response = await api.attempt(documentId, id, pending.body);
      assertCurrent();
      await write(key, { ...pending, pendingAttempt: false, response });
      return response;
    },
  };
}
