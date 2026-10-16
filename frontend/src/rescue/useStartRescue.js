import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { rescueApi } from "../api/rescue.js";
import { resolveContent } from "../offline/resolver.js";
import { resolveOfflineDocument } from "../offline/documents.js";
import { offlineAccessStatus } from "../offline/lease.js";
import { createRescueStore } from "./storage.js";
import { createRescueClock, proposeRescue, recoverRescue, sameRescueSource, TERMINAL } from "./model.js";

export function useStartRescue(userId, source, page, pageLimit, ready, blocked, toolsEnabled, onActivity) {
  const store = useMemo(() => createRescueStore(userId, rescueApi), [userId]);
  const [state, setState] = useState({ record: null, activities: [], loading: false, error: "", saved: false, loaded: false });
  const ref = useRef({ clock: null, version: 0, record: null, writes: Promise.resolve(), live: true, offline: false });
  const activityRef = useRef(onActivity);
  activityRef.current = onActivity;
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const update = useCallback((patch) => {
    if (ref.current.live && store.assertCurrent.isCurrent()) setState((old) => ({ ...old, ...patch }));
  }, [store]);
  const persist = useCallback((record) => {
    const runtime = ref.current;
    runtime.record = record;
    update({ record });
    runtime.writes = runtime.writes.catch(() => {}).then(async () => {
      if (!store.assertCurrent.isCurrent()) return;
      const envelope = await store.save(record, runtime.version);
      runtime.version = envelope.localVersion;
      update({ saved: true, error: "" });
      // Synchronization is recoverable and independent of the foreground timer.
      void store.sync(record.id).catch((error) => {
        if (error.status === 409 && runtime.record?.id === record.id) {
          runtime.clock?.transition("pause", "interrupted");
          update({ error: "rescue.conflict" });
        }
      });
    }).catch((error) => {
      runtime.clock?.transition("pause", "interrupted");
      update({ error: error.code === "rescue_conflict" ? "rescue.conflict" : "rescue.unsaved", saved: false });
    });
    return runtime.writes;
  }, [store, update]);
  useEffect(() => {
    const runtime = ref.current;
    runtime.live = true;
    store.current().then((envelope) => {
      if (!runtime.live || !store.assertCurrent.isCurrent()) return;
      update({ loaded: true });
      if (!envelope || TERMINAL.has(envelope.record.status)) return;
      runtime.version = envelope.localVersion;
      const record = recoverRescue(envelope.record);
      runtime.record = record;
      runtime.clock = createRescueClock(record);
      update({ record, saved: true, error: envelope.conflict ? "rescue.conflict" : "" });
      // Recovery is read-only until the student acts; an open tab must not steal another clock.
    }).catch(() => update({ error: "rescue.unsaved", loaded: true }));
    return () => {
      runtime.live = false;
      if (runtime.clock && runtime.record?.status === "active") {
        const record = runtime.clock.transition("pause", "workspace_left");
        // Persist the final observed interval without any time credit after unmount.
        void persist(record);
      }
    };
  }, [store, persist, update]);

  useEffect(() => {
    const changed = () => {
      if (store.assertCurrent.isCurrent()) return;
      ref.current.live = false;
      ref.current.clock?.transition("pause", "interrupted");
      setState({ record: null, activities: [], loading: false, error: "", saved: false, loaded: false });
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, [store]);

  const transition = useCallback(async (action, reason = "") => {
    const runtime = ref.current;
    if (!runtime.clock) return false;
    if (action === "start" || action === "resume") {
      if (!ready || blocked || !sameRescueSource(runtime.record, sourceRef.current) || runtime.record.page_end > pageLimit) {
        update({ error: "rescue.unavailable" }); return false;
      }
      if ((runtime.offline || sourceRef.current.offline) && !(await offlineAccessStatus(userId)).available) {
        update({ error: "rescue.unavailable" }); return false;
      }
      if (activityRef.current(runtime.record) === false) return false;
    }
    const record = runtime.clock.transition(action, reason);
    await persist(record);
    return true;
  }, [ready, blocked, pageLimit, userId, persist, update]);

  useEffect(() => {
    const runtime = ref.current;
    const sample = () => {
      if (!runtime.clock || !store.assertCurrent.isCurrent()) return;
      const before = runtime.record;
      const record = runtime.clock.sample();
      runtime.record = record;
      update({ record });
      if (record.status !== before?.status || record.status === "active" && Math.floor(record.active_duration_seconds) % 5 === 0) void persist(record);
      if ((runtime.offline || sourceRef.current.offline) && record.status === "active") {
        void offlineAccessStatus(userId).then((access) => {
          if (!access.available) void transition("pause", "unavailable");
        }).catch(() => { void transition("pause", "unavailable"); });
      }
    };
    const hidden = () => { if (document.hidden) void transition("pause", "background"); };
    const leaving = () => { void transition("pause", "interrupted"); };
    const timer = globalThis.setInterval(sample, 1000);
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", leaving);
    return () => {
      globalThis.clearInterval(timer);
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", leaving);
    };
  }, [store, userId, transition, persist, update]);
  useEffect(() => {
    if ((!ready || blocked) && ref.current.record?.status === "active") void transition("pause", "interrupted");
  }, [ready, blocked, transition]);

  const propose = useCallback(async () => {
    const runtime = ref.current;
    if (!ready || blocked) { update({ error: "rescue.existingTimer" }); return; }
    if (runtime.record && !TERMINAL.has(runtime.record.status)) return;
    update({ loading: true, error: "", saved: false });
    try {
      runtime.offline = false;
      const suggestedPage = Math.min(pageLimit, Math.max(1, page));
      const data = await resolveContent(userId,
        () => rescueApi.suggestions(sourceRef.current.catalog_document_id, suggestedPage),
        async () => {
          const saved = await resolveOfflineDocument(userId, { materialSlug: sourceRef.current.material_slug, sheetSlug: sourceRef.current.sheet_slug });
          if (!saved || saved.document.id !== sourceRef.current.catalog_document_id || saved.document.document_version_id !== sourceRef.current.learning_object_version_id || saved.document.file_id !== sourceRef.current.managed_file_id) return null;
          runtime.offline = true;
          return { activities: [{ ...sourceRef.current, page_start: suggestedPage, page_end: suggestedPage, task_type: "read" }] };
        });
      store.assertCurrent();
      if (!runtime.live) return;
      const activities = data.activities.filter((item) => (toolsEnabled || item.task_type === "read") && sameRescueSource(item, sourceRef.current) && item.page_end <= pageLimit && item.page_start >= 1);
      if (!activities.length) { update({ error: "rescue.unavailable", loading: false }); return; }
      const record = proposeRescue(userId, activities[0]);
      runtime.version = 0; runtime.clock = createRescueClock(record);
      update({ activities, loading: false });
      await persist(record);
    } catch {
      update({ loading: false, error: "rescue.unavailable" });
    }
  }, [ready, blocked, toolsEnabled, userId, page, pageLimit, store, persist, update]);

  const choose = useCallback(async (index) => {
    const activity = state.activities[index];
    if (!activity) return;
    await transition("stop", "changed_task");
    const record = proposeRescue(userId, activity);
    ref.current.version = 0; ref.current.clock = createRescueClock(record);
    await persist(record);
  }, [state.activities, transition, userId, persist]);
  return { ...state, propose, choose, transition };
}
