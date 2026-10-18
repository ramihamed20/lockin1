import { offlineDatabase } from "../offline/database.js";
import { captureOfflineSession } from "../offline/sessionScope.js";
import { TERMINAL } from "./model.js";

const KEY = "rescue:state";
export const RESCUE_OPERATION = "rescue_session_sync";
const BODY_FIELDS = ["account_id", "catalog_document_id", "learning_object_version_id", "managed_file_id", "edition", "task_type", "page_start", "page_end", "started_at", "ended_at", "active_duration_seconds", "status", "exit_reason", "continued_into_study_session_id"];

export function createRescueStore(accountId, api, db = offlineDatabase) {
  const userId = String(accountId), assertCurrent = captureOfflineSession(userId);
  const mutate = (update) => db.updateEntriesScoped(userId, KEY, update, assertCurrent);
  return {
    assertCurrent,
    async current() {
      const state = await db.get(userId, KEY);
      assertCurrent();
      return state?.sessions?.[state.currentId] || null;
    },
    async save(record, expectedLocalVersion = 0) {
      assertCurrent();
      if (record.account_id !== userId) throw Object.assign(new Error("account"), { code: "not_authenticated" });
      const state = await mutate((previous) => {
        const sessions = { ...(previous?.sessions || {}) };
        const existing = sessions[record.id], current = sessions[previous?.currentId];
        if (existing?.conflict || (existing?.localVersion || 0) !== expectedLocalVersion
          || !existing && current && !TERMINAL.has(current.record.status)) {
          throw Object.assign(new Error("rescue_conflict"), { code: "rescue_conflict" });
        }
        if (existing && TERMINAL.has(existing.record.status)) {
          throw Object.assign(new Error("rescue_ended"), { code: "rescue_conflict" });
        }
        const envelope = {
          record, localVersion: expectedLocalVersion + 1, dirty: true,
          baseRevision: existing?.baseRevision ?? record.sync_revision,
          pending: existing?.pending || null, conflict: false,
        };
        sessions[record.id] = envelope;
        // The server retains acknowledged history. Pending work is never pruned.
        const retained = Object.entries(sessions).filter(([id, item]) => id !== record.id && !item.dirty && TERMINAL.has(item.record.status));
        for (const [id] of retained.slice(0, Math.max(0, retained.length - 50))) delete sessions[id];
        const operation = {
          operation_id: record.id, operation_type: RESCUE_OPERATION,
          entity_type: "rescue_session", entity_id: record.id, ordering_key: `rescue:${record.id}`,
          payload: { session_id: record.id }, local_created_at: record.started_at || new Date().toISOString(),
          client_sequence: 0, retry_count: 0, sync_status: "pending", schema_version: 1,
          next_attempt_at: null, local: true,
        };
        return { value: { currentId: record.id, sessions }, entries: [[`operation:${record.id}`, operation]] };
      });
      return state.sessions[record.id];
    },
    async sync(id) {
      const state = await mutate((previous) => {
        const envelope = previous?.sessions?.[id];
        if (!envelope?.dirty || envelope.conflict) return { value: previous, entries: [] };
        const pending = envelope.pending || {
          generation: envelope.localVersion,
          body: {
            ...Object.fromEntries(BODY_FIELDS.map((key) => [key, envelope.record[key]])),
            active_duration_seconds: Math.floor(envelope.record.active_duration_seconds),
            expected_revision: envelope.baseRevision, device_mutation_id: globalThis.crypto.randomUUID(),
          },
        };
        return { value: { ...previous, sessions: { ...previous.sessions, [id]: { ...envelope, pending } } }, entries: [] };
      });
      const envelope = state?.sessions?.[id];
      if (!envelope?.dirty || envelope.conflict) return envelope;
      const sent = envelope.pending;
      try {
        assertCurrent();
        const response = await api.save(id, sent.body);
        assertCurrent();
        const updated = await mutate((previous) => {
          const current = previous?.sessions?.[id];
          if (current?.pending?.body.device_mutation_id !== sent.body.device_mutation_id) return { value: previous, entries: [] };
          const next = {
            ...current, pending: null, baseRevision: response.sync_revision,
            dirty: current.localVersion !== sent.generation,
            record: { ...current.record, sync_revision: response.sync_revision },
          };
          return { value: { ...previous, sessions: { ...previous.sessions, [id]: next } }, entries: [] };
        });
        return updated.sessions[id];
      } catch (error) {
        if (error.status === 409 && assertCurrent.isCurrent()) {
          await mutate((previous) => {
            const current = previous?.sessions?.[id];
            if (current?.pending?.body.device_mutation_id !== sent.body.device_mutation_id) return { value: previous, entries: [] };
            return { value: { ...previous, sessions: { ...previous.sessions, [id]: { ...current, conflict: true } } }, entries: [] };
          });
        }
        throw error;
      }
    },
  };
}
