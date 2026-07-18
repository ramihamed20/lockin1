import { useEffect, useRef, useState } from "react";

import { ApiError } from "../../../api/client";
import { registerPwaUpdateGuard } from "../../../pwa/update";
import type { AnnotationState } from "../annotations/reducer";
import type { FocusSaveState, FocusWorkspaceState } from "../contracts/types";
import { saveFocusWorkspace, syncFocusAnnotations } from "../api";
import { saveFocusRecovery } from "./recovery";

type Input = {
  enabled: boolean;
  accountId: string;
  clientInstanceId: string;
  workspace: FocusWorkspaceState;
  workspaceDirty: boolean;
  annotations: AnnotationState;
  collectionRevision: number;
  onWorkspaceSaved: (workspace: FocusWorkspaceState, sent: FocusWorkspaceState) => void;
  onAnnotationsSaved: (annotations: readonly import("../contracts/types").FocusAnnotation[], deletedIds: readonly string[], revision: number, sentUpserts: readonly import("../contracts/types").FocusAnnotation[], sentDeletedIds: readonly string[]) => void;
};

export function useFocusAutosave(input: Input) {
  const { enabled, accountId, clientInstanceId, workspace, workspaceDirty, annotations, collectionRevision, onWorkspaceSaved, onAnnotationsSaved } = input;
  const [saveState, setSaveState] = useState<FocusSaveState>("saved");
  const [retryToken, setRetryToken] = useState(0);
  const running = useRef(false);
  const pending = enabled && (workspaceDirty || Object.keys(annotations.pendingUpserts).length > 0 || annotations.pendingDeletes.length > 0);

  useEffect(() => enabled ? registerPwaUpdateGuard(() => !pending && !running.current) : () => undefined, [enabled, pending]);

  useEffect(() => {
    if (!enabled) return;
    const timer = window.setTimeout(() => {
      void saveFocusRecovery({
        schemaVersion: 1, accountId, documentVersionId: workspace.documentVersionId,
        clientInstanceId, workspace,
        annotations: Object.values(annotations.items), pendingUpserts: Object.values(annotations.pendingUpserts),
        pendingDeletes: annotations.pendingDeletes, collectionRevision,
        savedLocallyAt: new Date().toISOString()
      }).then(() => { if (pending && !running.current) setSaveState(navigator.onLine ? "local" : "offline"); }).catch(() => setSaveState("failed"));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [accountId, annotations.items, annotations.pendingDeletes, annotations.pendingUpserts, clientInstanceId, collectionRevision, enabled, pending, workspace]);

  useEffect(() => {
    if (!enabled) return;
    if (!pending) {
      if (!running.current) setSaveState("saved");
      return;
    }
    const timer = window.setTimeout(async () => {
      if (!navigator.onLine) { setSaveState("offline"); return; }
      running.current = true;
      setSaveState("saving");
      try {
        let savedWorkspace = workspace;
        if (workspaceDirty) {
          savedWorkspace = await saveFocusWorkspace(workspace.sessionId, workspace);
          onWorkspaceSaved(savedWorkspace, workspace);
        }
        const upserts = Object.values(annotations.pendingUpserts);
        const deletedIds = annotations.pendingDeletes;
        if (upserts.length || deletedIds.length) {
          const result = await syncFocusAnnotations(workspace.documentVersionId, collectionRevision, upserts, deletedIds, crypto.randomUUID());
          onAnnotationsSaved(result.annotations, result.deletedIds, result.collectionRevision, upserts, deletedIds);
        }
        setSaveState("saved");
      } catch (error) {
        setSaveState(error instanceof ApiError && error.status === 409 ? "conflict" : navigator.onLine ? "failed" : "offline");
      } finally {
        running.current = false;
      }
    }, 900);
    return () => window.clearTimeout(timer);
  }, [annotations.pendingDeletes, annotations.pendingUpserts, collectionRevision, enabled, onAnnotationsSaved, onWorkspaceSaved, pending, retryToken, workspace, workspaceDirty]);

  useEffect(() => {
    if (!enabled) return;
    const listener = () => { if (navigator.onLine) setRetryToken((value) => value + 1); else if (pending) setSaveState("offline"); };
    window.addEventListener("online", listener);
    window.addEventListener("offline", listener);
    return () => { window.removeEventListener("online", listener); window.removeEventListener("offline", listener); };
  }, [enabled, pending]);

  useEffect(() => {
    if (!enabled) return;
    const listener = (event: BeforeUnloadEvent) => {
      if (!pending && !running.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", listener);
    return () => window.removeEventListener("beforeunload", listener);
  }, [enabled, pending]);

  return { saveState, pending, retry: () => setRetryToken((value) => value + 1) };
}
