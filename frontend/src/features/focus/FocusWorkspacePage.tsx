import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { Alert, PageSkeleton } from "../../components/Feedback";
import { Button } from "../../components/Button";
import { useI18n } from "../../i18n/I18nProvider";
import { useAuth } from "../auth/AuthProvider";
import { annotationReducer, emptyAnnotationState } from "./annotations/reducer";
import { clearFocusRecovery, loadFocusRecovery, saveFocusRecovery } from "./autosave/recovery";
import { useFocusAutosave } from "./autosave/useFocusAutosave";
import type { FocusAnnotation, FocusDocument, FocusSaveState, FocusWorkspaceState } from "./contracts/types";
import { focusSessionAction, getFocusDocument, loadFocusAnnotations, startFocusSession } from "./api";
import { PdfDocumentAdapter } from "./renderer/PdfDocumentAdapter";
import { FocusToolbar } from "./toolbar/FocusToolbar";
import { DocumentViewer } from "./viewer/DocumentViewer";
import { FocusSidebar } from "./workspace/FocusSidebar";

const around = (page: number, count: number) => [page - 1, page, page + 1].filter((value) => value >= 1 && value <= count);
const workspaceSignature = (workspace: FocusWorkspaceState) => JSON.stringify({ currentPage: workspace.currentPage, pageCount: workspace.pageCount, zoom: workspace.zoom, sidebar: workspace.sidebar, activeTool: workspace.activeTool, layout: workspace.layout, openTabs: workspace.openTabs });

export function FocusWorkspacePage() {
  const { documentVersionId = "" } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { t, direction } = useI18n();
  const renderer = useMemo(() => new PdfDocumentAdapter(), []);
  const [focusDocument, setFocusDocument] = useState<FocusDocument | null>(null);
  const [workspace, setWorkspace] = useState<FocusWorkspaceState | null>(null);
  const [workspaceDirty, setWorkspaceDirty] = useState(false);
  const [annotations, dispatch] = useReducer(annotationReducer, emptyAnnotationState);
  const [collectionRevision, setCollectionRevision] = useState(0);
  const [clientInstanceId, setClientInstanceId] = useState("");
  const [failed, setFailed] = useState(false);
  const [recovered, setRecovered] = useState(false);
  const [color, setColor] = useState("#f2c94c");
  const [thickness, setThickness] = useState(2.5);
  const [fullscreen, setFullscreen] = useState(false);
  const [shortcutHelp, setShortcutHelp] = useState(false);
  const loadedPages = useRef(new Set<number>());
  const sessionStatus = useRef<"active" | "paused" | "completed" | "abandoned">("active");

  const updateWorkspace = useCallback((change: Partial<FocusWorkspaceState>) => {
    setWorkspace((current) => {
      if (!current) return current;
      const next = { ...current, ...change };
      if (workspaceSignature(next) === workspaceSignature(current)) return current;
      setWorkspaceDirty(true);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!user || !documentVersionId) return;
    const controller = new AbortController();
    void Promise.all([getFocusDocument(documentVersionId, controller.signal), loadFocusRecovery(user.id, documentVersionId)]).then(async ([descriptor, recovery]) => {
      const instanceId = recovery?.clientInstanceId ?? crypto.randomUUID();
      const session = await startFocusSession(documentVersionId, instanceId, controller.signal);
      if (!session.workspace) throw new Error("Focus session did not include workspace state.");
      const rendered = await renderer.load(descriptor.document.viewUrl);
      if (controller.signal.aborted) return;
      const authoritative = session.workspace;
      const recoveredWorkspace = recovery?.workspace;
      const pageCount = authoritative.pageCount ?? descriptor.document.pageCount ?? rendered.pageCount;
      const initialWorkspace: FocusWorkspaceState = {
        ...authoritative,
        currentPage: Math.min(recoveredWorkspace?.currentPage ?? authoritative.currentPage, pageCount),
        pageCount,
        zoom: recoveredWorkspace?.zoom ?? authoritative.zoom,
        sidebar: recoveredWorkspace?.sidebar ?? authoritative.sidebar,
        activeTool: recoveredWorkspace?.activeTool ?? authoritative.activeTool,
        layout: recoveredWorkspace?.layout ?? authoritative.layout,
        openTabs: [documentVersionId]
      };
      const pages = around(initialWorkspace.currentPage, pageCount);
      const serverAnnotations = await loadFocusAnnotations(documentVersionId, pages, controller.signal);
      if (controller.signal.aborted) return;
      const initialItems = new Map(serverAnnotations.annotations.map((item) => [item.id, item]));
      recovery?.annotations.forEach((item) => {
        if (!pages.includes(item.pageNumber) || recovery.pendingUpserts.some((pending) => pending.id === item.id)) initialItems.set(item.id, item);
      });
      setFocusDocument(descriptor.document);
      setClientInstanceId(instanceId);
      setWorkspace(initialWorkspace);
      setWorkspaceDirty(workspaceSignature(initialWorkspace) !== workspaceSignature(authoritative));
      setCollectionRevision(serverAnnotations.collectionRevision);
      dispatch({ type: "hydrate", annotations: [...initialItems.values()], ...(recovery ? { pendingUpserts: recovery.pendingUpserts, pendingDeletes: recovery.pendingDeletes } : {}) });
      pages.forEach((page) => loadedPages.current.add(page));
      setRecovered(Boolean(recovery && (recovery.pendingUpserts.length || recovery.pendingDeletes.length || workspaceSignature(recovery.workspace) !== workspaceSignature(authoritative))));
      sessionStatus.current = session.status === "paused" ? "paused" : "active";
      window.setTimeout(() => globalThis.document.getElementById(`focus-page-${initialWorkspace.currentPage}`)?.scrollIntoView({ block: "start" }), 0);
    }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => { controller.abort(); void renderer.destroy(); };
  }, [documentVersionId, renderer, user]);

  const sessionId = workspace?.sessionId;
  useEffect(() => {
    if (!workspace) return;
    const missing = around(workspace.currentPage, workspace.pageCount ?? 1).filter((page) => !loadedPages.current.has(page));
    if (!missing.length) return;
    const controller = new AbortController();
    void loadFocusAnnotations(workspace.documentVersionId, missing, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      missing.forEach((page) => loadedPages.current.add(page));
      dispatch({ type: "merge", annotations: result.annotations });
      if (!Object.keys(annotations.pendingUpserts).length && !annotations.pendingDeletes.length) setCollectionRevision(result.collectionRevision);
    }).catch(() => { /* keep the visible document usable; retry when the page re-enters */ });
    return () => controller.abort();
  }, [annotations.pendingDeletes.length, annotations.pendingUpserts, workspace]);

  const onWorkspaceSaved = useCallback((saved: FocusWorkspaceState, sent: FocusWorkspaceState) => {
    setWorkspace((current) => {
      if (!current) return current;
      if (workspaceSignature(current) === workspaceSignature(sent)) {
        setWorkspaceDirty(false);
        return saved;
      }
      return { ...current, revision: saved.revision, updatedAt: saved.updatedAt };
    });
  }, []);
  const onAnnotationsSaved = useCallback((saved: readonly FocusAnnotation[], deletedIds: readonly string[], revision: number, sentUpserts: readonly FocusAnnotation[], sentDeletedIds: readonly string[]) => {
    setCollectionRevision(revision);
    dispatch({ type: "synced", annotations: saved, deletedIds, sentUpserts, sentDeletedIds });
  }, []);

  const autosave = useFocusAutosave({
    enabled: Boolean(user && workspace && clientInstanceId),
    accountId: user?.id ?? "", clientInstanceId, workspace: workspace ?? ({ documentVersionId: "" } as FocusWorkspaceState),
    workspaceDirty: Boolean(workspace && workspaceDirty), annotations, collectionRevision,
    onWorkspaceSaved, onAnnotationsSaved
  });

  useEffect(() => {
    if (!sessionId) return;
    const handler = () => {
      const action = globalThis.document.visibilityState === "hidden" ? "pause" : "resume";
      if ((action === "pause" && sessionStatus.current !== "active") || (action === "resume" && sessionStatus.current !== "paused")) return;
      void focusSessionAction(sessionId, action).then((session) => { sessionStatus.current = session.status; }).catch(() => undefined);
    };
    globalThis.document.addEventListener("visibilitychange", handler);
    return () => { globalThis.document.removeEventListener("visibilitychange", handler); if (sessionStatus.current === "active") void focusSessionAction(sessionId, "pause").catch(() => undefined); };
  }, [sessionId]);

  useEffect(() => {
    if (!workspace) return;
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable=true]")) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { event.preventDefault(); dispatch({ type: event.shiftKey ? "redo" : "undo" }); return; }
      if (event.key === "ArrowDown" || event.key === "PageDown") jumpTo(workspace.currentPage + 1);
      else if (event.key === "ArrowUp" || event.key === "PageUp") jumpTo(workspace.currentPage - 1);
      else if (event.key === "+" || event.key === "=") updateWorkspace({ zoom: Math.min(4, workspace.zoom + 0.1) });
      else if (event.key === "-") updateWorkspace({ zoom: Math.max(0.5, workspace.zoom - 0.1) });
      else if (event.key.toLowerCase() === "b") updateWorkspace({ sidebar: workspace.sidebar === "thumbnails" ? "closed" : "thumbnails" });
      else if (event.key.toLowerCase() === "n") updateWorkspace({ sidebar: workspace.sidebar === "notes" ? "closed" : "notes" });
      else if (event.key === "Escape") updateWorkspace({ activeTool: null });
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  function jumpTo(page: number) {
    if (!workspace?.pageCount) return;
    const bounded = Math.max(1, Math.min(workspace.pageCount, page));
    updateWorkspace({ currentPage: bounded });
    globalThis.document.getElementById(`focus-page-${bounded}`)?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  }

  async function persistLocal() {
    if (!user || !workspace) return;
    await saveFocusRecovery({ schemaVersion: 1, accountId: user.id, documentVersionId: workspace.documentVersionId, clientInstanceId, workspace, annotations: Object.values(annotations.items), pendingUpserts: Object.values(annotations.pendingUpserts), pendingDeletes: annotations.pendingDeletes, collectionRevision, savedLocallyAt: new Date().toISOString() });
  }

  async function leave() {
    if (!workspace || !focusDocument) return;
    await persistLocal().catch(() => undefined);
    if (sessionStatus.current === "active") await focusSessionAction(workspace.sessionId, "pause").catch(() => undefined);
    void navigate(`/learn/content/${focusDocument.documentId}`);
  }

  async function finish() {
    if (!workspace || !user || autosave.pending || autosave.saveState !== "saved") return;
    try {
      await focusSessionAction(workspace.sessionId, "complete");
      await clearFocusRecovery(user.id, workspace.documentVersionId);
      sessionStatus.current = "completed";
      void navigate(`/learn/content/${workspace.documentId}`);
    } catch { setFailed(true); }
  }

  async function toggleFullscreen() {
    if (!globalThis.document.fullscreenElement) await globalThis.document.documentElement.requestFullscreen(); else await globalThis.document.exitFullscreen();
  }

  useEffect(() => {
    const handler = () => setFullscreen(Boolean(globalThis.document.fullscreenElement));
    globalThis.document.addEventListener("fullscreenchange", handler);
    return () => globalThis.document.removeEventListener("fullscreenchange", handler);
  }, []);

  if (failed) return <main className="focus-failure"><Alert>{t("focusLoadError")}</Alert><Button onClick={() => void navigate("/learn")}>{t("focusBack")}</Button></main>;
  if (!focusDocument || !workspace || !workspace.pageCount) return <PageSkeleton label={t("focusLoading")} />;

  const labels: Record<string, string> = {
    focusTools: t("focusTools"), pan: t("focusPan"), pen: t("focusPen"), pencil: t("focusPencil"), highlighter: t("focusHighlighter"), eraser: t("focusEraser"), line: t("focusLine"), arrow: t("focusArrow"), rectangle: t("focusRectangle"), circle: t("focusCircle"), text: t("focusText"), "sticky-note": t("focusStickyNote"), color: t("focusColor"), thickness: t("focusThickness"), undo: t("focusUndo"), redo: t("focusRedo"), clearPage: t("focusClearPage"), thumbnails: t("focusThumbnails"), notes: t("focusNotes"), noNotes: t("focusNoNotes"), closePanel: t("focusClosePanel"), page: t("focusPage")
  };
  const statusLabels: Record<FocusSaveState, string> = { saved: t("focusSaved"), saving: t("focusSaving"), local: t("focusLocal"), offline: t("focusOffline"), conflict: t("focusConflict"), failed: t("focusSaveFailed") };
  const pageAnnotations = Object.values(annotations.items).filter((item) => item.pageNumber === workspace.currentPage);

  return (
    <main className="focus-workspace" dir={direction} aria-label={t("focusWorkspace")}>
      <header className="focus-topbar">
        <button type="button" className="focus-back" onClick={() => void leave()}><span aria-hidden="true">←</span><span>{t("focusBack")}</span></button>
        <div className="focus-document-title"><span>{t("focusWorkspace")}</span><h1 dir="auto">{focusDocument.title}</h1></div>
        <div className="focus-session-actions">
          <span className={`focus-save-state focus-save-state--${autosave.saveState}`} role="status" aria-live="polite">{statusLabels[autosave.saveState]}</span>
          {autosave.saveState === "failed" ? <button type="button" className="focus-text-button" onClick={autosave.retry}>{t("focusRetrySync")}</button> : null}
          <button type="button" className="focus-icon-button" onClick={() => setShortcutHelp((value) => !value)} aria-expanded={shortcutHelp} aria-controls="focus-shortcuts" aria-label={t("focusKeyboardHelp")}>?</button>
          <button type="button" className="focus-icon-button" onClick={() => void toggleFullscreen()} aria-label={fullscreen ? t("focusExitFullscreen") : t("focusFullscreen")}>⛶</button>
          <Button disabled={autosave.pending || autosave.saveState !== "saved"} title={autosave.pending ? t("focusFinishBlocked") : undefined} onClick={() => void finish()}>{t("focusFinish")}</Button>
        </div>
      </header>
      {shortcutHelp ? <div id="focus-shortcuts" className="focus-shortcuts" role="note"><strong>{t("focusKeyboardHelp")}</strong><span>{t("focusShortcutCopy")}</span></div> : null}
      {recovered ? <div className="focus-recovery-notice" role="status">{t("focusRecovered")}</div> : null}
      <FocusToolbar activeTool={workspace.activeTool} color={color} thickness={thickness} canUndo={annotations.undo.length > 0} canRedo={annotations.redo.length > 0} labels={labels} onTool={(activeTool) => updateWorkspace({ activeTool })} onColor={setColor} onThickness={setThickness} onUndo={() => dispatch({ type: "undo" })} onRedo={() => dispatch({ type: "redo" })} onClearPage={() => { if (window.confirm(t("focusClearConfirm"))) pageAnnotations.forEach((item) => dispatch({ type: "remove", id: item.id })); }} />
      <div className="focus-workspace__body">
        <FocusSidebar mode={workspace.sidebar} pageCount={workspace.pageCount} currentPage={workspace.currentPage} annotations={Object.values(annotations.items)} labels={labels} onPage={jumpTo} onUpdateNote={(annotation, value) => { if (!value.trim() || annotation.payload.kind === "stroke" || annotation.payload.kind === "shape") return; dispatch({ type: "upsert", annotation: { ...annotation, payload: { ...annotation.payload, value: value.trim() }, updatedAt: new Date().toISOString() } }); }} onClose={() => updateWorkspace({ sidebar: "closed" })} />
        <section className="focus-stage" aria-label={focusDocument.title}>
          <div className="focus-navigation" aria-label={t("focusPage")}>
            <button type="button" onClick={() => updateWorkspace({ sidebar: workspace.sidebar === "thumbnails" ? "closed" : "thumbnails" })} aria-label={t("focusThumbnails")} aria-pressed={workspace.sidebar === "thumbnails"}>{t("focusThumbnails")}</button>
            <button type="button" onClick={() => updateWorkspace({ sidebar: workspace.sidebar === "notes" ? "closed" : "notes" })} aria-label={t("focusNotes")} aria-pressed={workspace.sidebar === "notes"}>{t("focusNotes")}</button>
            <button type="button" onClick={() => jumpTo(workspace.currentPage - 1)} disabled={workspace.currentPage <= 1} aria-label={t("focusPreviousPage")}>←</button>
            <label><span className="sr-only">{t("focusJumpPage")}</span><input type="number" min="1" max={workspace.pageCount} value={workspace.currentPage} onChange={(event) => jumpTo(Number(event.target.value))} /> <span>/ {workspace.pageCount}</span></label>
            <button type="button" onClick={() => jumpTo(workspace.currentPage + 1)} disabled={workspace.currentPage >= workspace.pageCount} aria-label={t("focusNextPage")}>→</button>
            <button type="button" onClick={() => updateWorkspace({ zoom: Math.max(0.5, workspace.zoom - 0.1) })} aria-label={t("focusZoomOut")}>−</button>
            <output>{Math.round(workspace.zoom * 100)}%</output>
            <button type="button" onClick={() => updateWorkspace({ zoom: Math.min(4, workspace.zoom + 0.1) })} aria-label={t("focusZoomIn")}>+</button>
          </div>
          <DocumentViewer renderer={renderer} pageCount={workspace.pageCount} currentPage={workspace.currentPage} zoom={workspace.zoom} activeTool={workspace.activeTool} color={color} thickness={thickness} annotations={Object.values(annotations.items)} pageLabel={t("focusPage")} viewerLabel={t("focusDocumentRegion")} newStickyNoteLabel={t("focusNewStickyNote")} newTextNoteLabel={t("focusNewTextNote")} onPage={(currentPage) => updateWorkspace({ currentPage })} onZoom={(zoom) => updateWorkspace({ zoom: Math.round(zoom * 100) / 100 })} onCreate={(annotation) => dispatch({ type: "upsert", annotation })} onRemove={(id) => dispatch({ type: "remove", id })} />
        </section>
      </div>
      <p className="sr-only">{t("focusStylusNotice")}</p>
    </main>
  );
}
