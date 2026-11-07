import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { knowledgeApi } from "../../api/knowledge.js";
import { createKnowledgeStore } from "./storage.js";
import { createArtifact } from "./model.js";

export function useKnowledgeWorkspace(userId, documentId) {
  const store = useMemo(() => createKnowledgeStore(userId, documentId, knowledgeApi), [userId, documentId]);
  const [state, setState] = useState({ loading: true, records: [], bootstrap: null, attempts: [], status: "loading", error: "", ui: {} });
  /** @typedef {{explanationDrafts?: Record<string, string>, [key: string]: unknown}} KnowledgeUI */
  const uiRef = useRef(/** @type {KnowledgeUI} */ ({}));
  const recordsRef = useRef(state.records);
  recordsRef.current = state.records;
  const latestRecord = useCallback((id) => recordsRef.current.find((record) => record.id === id), []);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const refresh = useCallback(() => setRefreshVersion((value) => value + 1), []);
  const meta = useRef(new Map());
  const sequence = useRef(new Map());
  const writes = useRef(Promise.resolve());
  const syncBusy = useRef(false);
  const syncAgain = useRef(false);
  const syncRef = useRef(null);
  const mounted = useRef(true);
  const editBlocked = useRef(false);
  const update = useCallback((patch) => {
    if (mounted.current && store.assertCurrent.isCurrent()) setState((old) => ({ ...old, ...patch }));
  }, [store]);
  const sync = useCallback(async () => {
    if (!store.assertCurrent.isCurrent()) return;
    if (syncBusy.current) { syncAgain.current = true; return; }
    syncBusy.current = true;
    try {
      await writes.current;
      if (editBlocked.current) { update({ status: "unsaved" }); return; }
      const drafts = await store.drafts();
      let attemptsChanged = false;
      for (const draft of drafts) {
        if (draft.pendingAttempt) {
          const response = await store.syncAttempt(draft.attemptId);
          if (response) attemptsChanged = true;
          if (response && mounted.current) setState((old) => ({
            ...old, attempts: [...old.attempts.filter((item) => item.id !== response.id), response],
          }));
        } else if (draft.dirty && !draft.conflict) {
          const next = await store.sync(draft.record.id);
          if (next) {
            meta.current.set(draft.record.id, next);
            if (next.localVersion === sequence.current.get(draft.record.id) && mounted.current) {
              setState((old) => ({ ...old, records: old.records.map((record) => record.id === draft.record.id ? next.record : record) }));
            }
          }
        }
      }
      if (attemptsChanged) update({ bootstrap: await store.bootstrap() });
      const remaining = await store.drafts();
      if (editBlocked.current) { update({ status: "unsaved" }); return; }
      update({ status: remaining.some((item) => item.conflict) ? "conflict" :
        remaining.some((item) => item.dirty || item.pendingAttempt) ? "local" :
        Object.values(uiRef.current.explanationDrafts || {}).some((text) => text.trim()) ? "draft" : "synced", error: "" });
    } catch (error) {
      if (editBlocked.current) { update({ status: "unsaved" }); return; }
      update({ status: error.status === 409 || error.code === "knowledge_conflict" ? "conflict" : "local",
        error: error.status && error.status !== 0 ? "sync_error" : "" });
    } finally {
      syncBusy.current = false;
      if (syncAgain.current && mounted.current && store.assertCurrent.isCurrent()) {
        syncAgain.current = false;
        void syncRef.current?.();
      }
    }
  }, [store, update]);
  syncRef.current = sync;
  useEffect(() => {
    mounted.current = true;
    let active = true;
    const load = async () => {
      try {
        update({ loading: true, error: "" });
        await writes.current;
        const bootstrap = await store.bootstrap();
        if (!bootstrap.enabled) { if (active) update({ loading: false, bootstrap }); return; }
        const drafts = await store.drafts();
        const ui = await store.readUI();
        uiRef.current = ui;
        const records = new Map(bootstrap.artifacts.map((record) => [record.id, record]));
        const attempts = new Map(bootstrap.attempts.map((item) => [item.id, item]));
        for (const draft of drafts) {
          if (draft.record) {
            meta.current.set(draft.record.id, draft);
            sequence.current.set(draft.record.id, draft.localVersion);
            if (draft.dirty || records.get(draft.record.id)?.revision === draft.baseRevision) records.set(draft.record.id, draft.record);
          } else if (draft.response) attempts.set(draft.response.id, draft.response);
          else if (draft.pendingAttempt) attempts.set(draft.attemptId, {
            id: draft.attemptId, ...draft.body, evaluation_status: "pending",
          });
        }
        if (active) {
          update({ bootstrap, ui, records: [...records.values()], attempts: [...attempts.values()], loading: false, status: "local" });
          void sync();
        }
      } catch { if (active) update({ loading: false, error: "load_error" }); }
    };
    void load();
    const fence = () => {
      if (store.assertCurrent.isCurrent()) return;
      if (mounted.current) setState({ loading: false, records: [], bootstrap: null, attempts: [], ui: {}, status: "loading", error: "load_error" });
    };
    window.addEventListener("storage", fence);
    const reconnect = () => { fence(); void sync(); };
    window.addEventListener("online", reconnect);
    return () => { active = false; mounted.current = false; window.removeEventListener("online", reconnect); window.removeEventListener("storage", fence); };
  }, [store, sync, update, refreshVersion]);
  useEffect(() => {
    if (state.status !== "saving" && state.status !== "local") return undefined;
    const timer = window.setTimeout(() => { void sync(); }, 1200);
    return () => window.clearTimeout(timer);
  }, [state.records, state.status, sync]);
  useEffect(() => {
    const guard = (event) => {
      if (state.status === "saving" || state.status === "unsaved") {
        event.preventDefault(); event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [state.status]);
  const edit = useCallback((record) => {
    if (!store.assertCurrent.isCurrent()) return;
    if (editBlocked.current) return;
    const version = (sequence.current.get(record.id) || 0) + 1;
    sequence.current.set(record.id, version);
    recordsRef.current = recordsRef.current.some((item) => item.id === record.id) ? recordsRef.current.map((item) => item.id === record.id ? record : item) : [...recordsRef.current, record];
    setState((old) => ({ ...old, records: old.records.some((item) => item.id === record.id)
      ? old.records.map((item) => item.id === record.id ? record : item) : [...old.records, record],
      status: "saving", error: "" }));
    writes.current = writes.current.then(async () => {
      if (editBlocked.current) return;
      try {
        const envelope = await store.edit(record, meta.current.get(record.id)?.localVersion || 0);
        meta.current.set(record.id, envelope);
        update({ status: "local" });
      } catch (error) {
        editBlocked.current = true;
        update({ status: "unsaved", error: error.code === "knowledge_conflict" ? "local_conflict" : error.code === "document_limit" ? "documentLimit" : "storage_error" });
      }
    });
  }, [store, update]);
  const create = useCallback((kind, page) => {
    if (!state.bootstrap) return null;
    const record = createArtifact(kind, state.bootstrap.source, page);
    edit(record);
    return record;
  }, [edit, state.bootstrap]);
  const submit = useCallback(async (question, answer, rating = "", reflection = {}) => {
    const id = globalThis.crypto.randomUUID();
    const body = { question_id: question.id, question_revision: question.revision, answer, self_rating: rating, confidence: reflection.confidence || "", error_reason: reflection.error_reason || "" };
    await store.queueAttempt(id, body);
    setState((old) => ({ ...old, attempts: [...old.attempts, { id, ...body, evaluation_status: "pending" }], status: "local" }));
    await sync();
  }, [store, sync]);
  const discardUnsaved = useCallback(async () => {
    await writes.current;
    const drafts = await store.drafts().catch(() => []);
    const savedUI = await store.readUI().catch(() => ({}));
    const records = new Map((state.bootstrap?.artifacts || []).map((item) => [item.id, item]));
    meta.current.clear(); sequence.current.clear();
    for (const draft of drafts) if (draft.record) {
      records.set(draft.record.id, draft.record);
      meta.current.set(draft.record.id, draft);
      sequence.current.set(draft.record.id, draft.localVersion);
    }
    editBlocked.current = false;
    uiRef.current = savedUI;
    update({ records: [...records.values()], ui: savedUI, status: "local", error: "" });
  }, [state.bootstrap, store, update]);
  const saveCopy = useCallback(async (record, title) => {
    await writes.current;
    const copy = { ...record, id: globalThis.crypto.randomUUID(), revision: 0, title: [...title].slice(0, 220).join(""), deleted: false };
    const envelope = await store.edit(copy, 0);
    if (!editBlocked.current) await store.archiveDraft(record.id, meta.current.get(record.id)?.localVersion);
    meta.current.delete(record.id);
    meta.current.set(copy.id, envelope);
    sequence.current.set(copy.id, envelope.localVersion);
    editBlocked.current = false;
    update({ status: "local", error: "" });
    if (mounted.current) setState((old) => ({ ...old, records: [...old.records.filter((item) => item.id !== record.id), copy] }));
    void sync();
    return copy;
  }, [store, sync, update]);
  const exportRecords = useCallback(async (records) => {
    const full = [];
    for (const record of records.filter((item) => !item.deleted)) {
      full.push(record.content ? record : await store.detail(record.id, record.revision));
    }
    return full;
  }, [store]);
  const loadDocument = useCallback(async (id, revision) => {
    try {
      const record = await store.detail(id, revision);
      store.assertCurrent();
      if (mounted.current) setState((old) => ({
        ...old, records: old.records.map((item) => item.id === id && !item.content ? record : item),
      }));
    } catch { update({ error: "load_error" }); }
  }, [store, update]);
  const editUI = useCallback((patch) => {
    if (!store.assertCurrent.isCurrent()) return;
    uiRef.current = { ...uiRef.current, ...patch };
    const value = uiRef.current;
    update({ ui: value });
    update({ status: editBlocked.current ? "unsaved" : "saving" });
    writes.current = writes.current.then(async () => {
      await store.saveUI(value);
      update({ status: editBlocked.current ? "unsaved" : "local" });
    }).catch((error) => {
      editBlocked.current = true;
      update({ status: "unsaved", error: error.code === "knowledge_conflict" ? "local_conflict" : "storage_error" });
    });
  }, [store, update]);
  return { ...state, edit, create, submit, sync, editUI, loadDocument, exportRecords, saveCopy, refresh, latestRecord, discardUnsaved };
}
