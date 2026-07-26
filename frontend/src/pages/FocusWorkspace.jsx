import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { focusApi } from "../api/focus.js";
import { isApiError } from "../api/client.js";
import { generateIdempotencyKey } from "../api/pagination.js";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { FocusPdfWorkspace } from "./SheetStudy.jsx";
import { ErrorPanel, LoadingPanel } from "../components/ui/index.jsx";

const PDF_WIDTH = 612;
const PDF_HEIGHT = 792;
const STROKE_TOOLS = new Set(["pen", "pencil", "highlighter"]);

function safeFocusFilePath(value) {
  return typeof value === "string" && /^\/api\/v1\/files\/[0-9a-f-]+\/view$/i.test(value) ? value : null;
}

function sessionStorageValue(key) {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function setSessionStorageValue(key, value) {
  try {
    if (value == null) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, value);
  } catch {
    // A browser may block session storage. The in-memory request still has a
    // stable UUID for its retry; no Focus data is stored as a fallback.
  }
}

function clientSessionKey(documentVersionId) {
  return `lock-in.focus.client-instance.${documentVersionId}`;
}

function focusClientInstance(documentVersionId) {
  const key = clientSessionKey(documentVersionId);
  const existing = sessionStorageValue(key);
  if (typeof existing === "string" && /^[0-9a-f-]{36}$/i.test(existing)) return existing;
  const generated = generateIdempotencyKey();
  setSessionStorageValue(key, generated);
  return generated;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, Number(value) || 0));
}

function rounded(value, minimum, maximum) {
  return Number(clamp(value, minimum, maximum).toFixed(6));
}

function annotationColor(stroke) {
  if (typeof stroke.color === "string" && /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(stroke.color)) return stroke.color;
  if (stroke.tool === "highlighter") return "#fde047";
  return "#f59e0b";
}

function annotationOpacity(stroke) {
  return stroke.tool === "highlighter" ? 0.45 : 1;
}

function boundsFor(samples) {
  const xs = samples.map((sample) => sample.x);
  const ys = samples.map((sample) => sample.y);
  const left = rounded(Math.min(...xs), 0, 1);
  const top = rounded(Math.min(...ys), 0, 1);
  const right = rounded(Math.max(...xs), left, 1);
  const bottom = rounded(Math.max(...ys), top, 1);
  return { x: left, y: top, width: rounded(right - left, 0, 1), height: rounded(bottom - top, 0, 1) };
}

function strokeToMutation(stroke, pageNumber) {
  if (!STROKE_TOOLS.has(stroke.tool)) return null;
  const points = Array.isArray(stroke.points) ? stroke.points : [];
  if (!points.length) return null;
  const canvasWidth = Number(stroke.canvasWidth) || PDF_WIDTH;
  const canvasHeight = Number(stroke.canvasHeight) || PDF_HEIGHT;
  const samples = points.map((point, index) => ({
    x: rounded(stroke.normalized ? point.x : Number(point.x) / canvasWidth, 0, 1),
    y: rounded(stroke.normalized ? point.y : Number(point.y) / canvasHeight, 0, 1),
    pointer: "unknown",
    pressure: rounded(point.p ?? point.pressure ?? 0.5, 0, 1),
    tiltX: 0,
    tiltY: 0,
    timestamp: Number.isFinite(Number(point.t ?? point.timestamp)) ? Number(point.t ?? point.timestamp) : Date.now() + index
  }));
  if (samples.length === 1) samples.push({ ...samples[0], timestamp: samples[0].timestamp + 1 });
  return {
    id: stroke.id,
    page_number: Number(pageNumber),
    tool: stroke.tool,
    layer_key: "personal",
    bounds: boundsFor(samples),
    payload: { kind: "stroke", samples },
    color: annotationColor(stroke),
    thickness: Number(stroke.size) || 4.5,
    opacity: annotationOpacity(stroke)
  };
}

function stableJson(value) {
  return JSON.stringify(value);
}

function annotationToStroke(annotation) {
  if (!annotation || !STROKE_TOOLS.has(annotation.tool) || annotation.payload?.kind !== "stroke" || !Array.isArray(annotation.payload.samples)) return null;
  const stroke = {
    id: annotation.id,
    tool: annotation.tool,
    color: annotation.color,
    size: Number(annotation.thickness) || 4.5,
    normalized: true,
    points: annotation.payload.samples.map((sample) => ({
      x: Number(sample.x),
      y: Number(sample.y),
      p: Number(sample.pressure),
      t: Number(sample.timestamp),
      w: Number(annotation.thickness) || 4.5
    }))
  };
  const mutation = strokeToMutation(stroke, annotation.page_number);
  return mutation ? { ...stroke, serverFingerprint: stableJson(mutation) } : null;
}

function stampedDrawings(next) {
  const result = {};
  Object.entries(next || {}).forEach(([page, strokes]) => {
    result[page] = Array.isArray(strokes)
      ? strokes.map((stroke) => ({ ...stroke, id: typeof stroke.id === "string" ? stroke.id : generateIdempotencyKey() }))
      : [];
  });
  return result;
}

function initialWorkspace(session, documentVersionId) {
  const workspace = session?.workspace;
  return workspace && typeof workspace === "object"
    ? workspace
    : {
        current_page: 1,
        page_count: null,
        zoom: 1,
        sidebar: "closed",
        active_tool: "",
        layout: {},
        open_tabs: [documentVersionId],
        revision: 1
      };
}

function errorMessage(error, fallback) {
  if (!error) return fallback;
  const field = error.fields && Object.values(error.fields).flat().find((value) => typeof value === "string");
  return field || error.message || fallback;
}

async function loadFocusWorkspace(documentVersionId) {
  try {
    const documentPayload = await focusApi.getDocument(documentVersionId);
    const session = await focusApi.startSession({
      documentVersionId,
      clientInstanceId: focusClientInstance(documentVersionId)
    });
    const workspace = initialWorkspace(session, documentVersionId);
    const annotations = await focusApi.getAnnotations(documentVersionId, { pages: [workspace.current_page || 1] });
    return { documentPayload, session, workspace, annotations };
  } catch (error) {
    if (isApiError(error) && error.status === 403) {
      throw new Error("Focus workspace access has not been granted for this account.");
    }
    if (isApiError(error) && error.status === 404) {
      throw new Error("This Focus document is no longer available from Django.");
    }
    throw error;
  }
}

export default function FocusWorkspace() {
  const { documentVersionId } = useParams();
  const navigate = useNavigate();
  const detail = useAsyncData(() => loadFocusWorkspace(documentVersionId), [documentVersionId]);
  const [session, setSession] = useState(null);
  const [workspace, setWorkspace] = useState(null);
  const [workspaceDraft, setWorkspaceDraft] = useState(null);
  const [drawings, setDrawings] = useState({});
  const [collectionRevision, setCollectionRevision] = useState(0);
  const [unsupportedAnnotationCount, setUnsupportedAnnotationCount] = useState(0);
  const [syncState, setSyncState] = useState("saved");
  const [notice, setNotice] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const knownAnnotations = useRef(new Map());
  const collectionRevisionRef = useRef(0);
  const workspaceSignatureRef = useRef("");
  const syncTimer = useRef(null);
  const syncing = useRef(false);
  const loadedAnnotationPages = useRef(new Set());

  const replaceServerAnnotations = useCallback((pageData, replaceDrawings, requestedPages = []) => {
    const resultRows = Array.isArray(pageData.results) ? pageData.results : [];
    setUnsupportedAnnotationCount(resultRows.filter((annotation) => !annotationToStroke(annotation)).length);
    const pagesToReplace = new Set([...requestedPages, ...resultRows.map((annotation) => Number(annotation.page_number))]);
    const nextKnown = new Map();
    resultRows.forEach((annotation) => {
      const stroke = annotationToStroke(annotation);
      if (!stroke) return;
      const page = Number(annotation.page_number);
      if (!nextKnown.has(page)) nextKnown.set(page, new Map());
      nextKnown.get(page).set(stroke.id, stroke.serverFingerprint);
    });
    pagesToReplace.forEach((page) => knownAnnotations.current.set(page, nextKnown.get(page) || new Map()));
    if (!replaceDrawings) return;
    setDrawings((current) => {
      const next = { ...current };
      pagesToReplace.forEach((page) => {
        next[page] = resultRows
          .filter((annotation) => Number(annotation.page_number) === page)
          .map(annotationToStroke)
          .filter(Boolean);
      });
      return stampedDrawings(next);
    });
  }, []);

  useEffect(() => {
    if (!detail.data) return;
    const nextWorkspace = initialWorkspace(detail.data.session, documentVersionId);
    setSession(detail.data.session);
    setWorkspace(nextWorkspace);
    setWorkspaceDraft(nextWorkspace);
    workspaceSignatureRef.current = stableJson(nextWorkspace);
    collectionRevisionRef.current = Number(detail.data.annotations.collection_revision) || 0;
    setCollectionRevision(collectionRevisionRef.current);
    knownAnnotations.current = new Map();
    const initialPage = Number(nextWorkspace.current_page) || 1;
    loadedAnnotationPages.current = new Set([initialPage]);
    replaceServerAnnotations(detail.data.annotations, true, [initialPage]);
    setSyncState("saved");
    setNotice("");
  }, [detail.data, documentVersionId, replaceServerAnnotations]);

  useEffect(() => () => {
    if (syncTimer.current) window.clearTimeout(syncTimer.current);
  }, []);

  const updateDrawings = useCallback((update) => {
    setDrawings((current) => stampedDrawings(typeof update === "function" ? update(current) : update));
  }, []);

  const handlePageReady = useCallback((pageNumber, canvasWidth, canvasHeight) => {
    updateDrawings((current) => {
      const page = String(pageNumber);
      const strokes = current[page];
      if (!Array.isArray(strokes) || !strokes.some((stroke) => stroke.normalized)) return current;
      return {
        ...current,
        [page]: strokes.map((stroke) => stroke.normalized
          ? {
              ...stroke,
              normalized: false,
              canvasWidth,
              canvasHeight,
              points: stroke.points.map((point) => ({
                ...point,
                x: point.x * canvasWidth,
                y: point.y * canvasHeight
              }))
            }
          : stroke)
      };
    });
  }, [updateDrawings]);

  const reloadAnnotationPages = useCallback(async (pages, replaceDrawings = false) => {
    const latest = await focusApi.getAnnotations(documentVersionId, { pages });
    collectionRevisionRef.current = Number(latest.collection_revision) || 0;
    setCollectionRevision(collectionRevisionRef.current);
    replaceServerAnnotations(latest, replaceDrawings, pages);
    return latest;
  }, [documentVersionId, replaceServerAnnotations]);

  useEffect(() => {
    const currentPage = Number(workspaceDraft?.current_page) || 1;
    if (!session || loadedAnnotationPages.current.has(currentPage)) return;
    loadedAnnotationPages.current.add(currentPage);
    reloadAnnotationPages([currentPage], true).catch((error) => {
      setNotice(errorMessage(error, "Annotations for this page could not be loaded."));
    });
  }, [reloadAnnotationPages, session, workspaceDraft?.current_page]);

  const collectAnnotationChanges = useCallback(() => {
    const changes = [];
    const deletedIds = [];
    Object.entries(drawings).forEach(([page, strokes]) => {
      const pageNumber = Number(page);
      const currentIds = new Set();
      const known = knownAnnotations.current.get(pageNumber) || new Map();
      (Array.isArray(strokes) ? strokes : []).forEach((stroke) => {
        const mutation = strokeToMutation(stroke, pageNumber);
        if (!mutation) return;
        currentIds.add(mutation.id);
        const fingerprint = stableJson(mutation);
        if (known.get(mutation.id) !== fingerprint) changes.push(mutation);
      });
      known.forEach((_fingerprint, id) => {
        if (!currentIds.has(id)) deletedIds.push(id);
      });
    });
    return { changes, deletedIds };
  }, [drawings]);

  const syncAnnotations = useCallback(async () => {
    if (syncing.current) return false;
    const { changes, deletedIds } = collectAnnotationChanges();
    if (!changes.length && !deletedIds.length) {
      setSyncState("saved");
      return true;
    }
    syncing.current = true;
    setSyncState("saving");
    setNotice("Saving annotations to Django…");
    try {
      let annotationOffset = 0;
      let deletionOffset = 0;
      while (annotationOffset < changes.length || deletionOffset < deletedIds.length) {
        const annotations = changes.slice(annotationOffset, annotationOffset + 100);
        const room = 100 - annotations.length;
        const deleted = deletedIds.slice(deletionOffset, deletionOffset + room);
        const saved = await focusApi.syncAnnotations(documentVersionId, {
          expectedCollectionRevision: collectionRevisionRef.current,
          idempotencyKey: generateIdempotencyKey(),
          annotations,
          deletedIds: deleted
        });
        collectionRevisionRef.current = Number(saved.collection_revision) || collectionRevisionRef.current;
        setCollectionRevision(collectionRevisionRef.current);
        saved.annotations.forEach((annotation) => {
          const stroke = annotationToStroke(annotation);
          if (!stroke) return;
          const page = Number(annotation.page_number);
          if (!knownAnnotations.current.has(page)) knownAnnotations.current.set(page, new Map());
          knownAnnotations.current.get(page).set(stroke.id, stroke.serverFingerprint);
        });
        saved.deleted_ids.forEach((id) => {
          knownAnnotations.current.forEach((items) => items.delete(id));
        });
        annotationOffset += annotations.length;
        deletionOffset += deleted.length;
      }
      setDrawings((current) => stampedDrawings(current));
      setSyncState("saved");
      setNotice("All annotations are saved.");
      return true;
    } catch (error) {
      if (isApiError(error) && error.status === 409) {
        const pages = Object.keys(drawings).map(Number).filter(Number.isInteger).slice(0, 10);
        try {
          await reloadAnnotationPages(pages.length ? pages : [1], false);
          setNotice("Annotations changed elsewhere. The latest server revision was loaded; your unsynced changes remain in this tab. Retry to save them.");
        } catch (reloadError) {
          setNotice(errorMessage(reloadError, "Annotations changed elsewhere and could not be reloaded."));
        }
      } else {
        setNotice(errorMessage(error, "Annotations are not saved. They remain only in this tab; retry when the connection is available."));
      }
      setSyncState("recovery");
      return false;
    } finally {
      syncing.current = false;
    }
  }, [collectAnnotationChanges, documentVersionId, drawings, reloadAnnotationPages]);

  useEffect(() => {
    if (!session || !workspace || syncing.current) return undefined;
    if (syncTimer.current) window.clearTimeout(syncTimer.current);
    syncTimer.current = window.setTimeout(() => { void syncAnnotations(); }, 850);
    return () => window.clearTimeout(syncTimer.current);
  }, [drawings, session, syncAnnotations, workspace]);

  const saveWorkspace = useCallback(async () => {
    if (!session || !workspace || !workspaceDraft || session.status === "completed" || session.status === "abandoned") return true;
    const openTabs = Array.from(new Set([...(Array.isArray(workspaceDraft.open_tabs) ? workspaceDraft.open_tabs : []), documentVersionId])).slice(0, 8);
    const body = {
      currentPage: Number(workspaceDraft.current_page) || 1,
      pageCount: workspaceDraft.page_count ?? null,
      zoom: Number(workspaceDraft.zoom) || 1,
      sidebar: workspaceDraft.sidebar || "closed",
      activeTool: workspaceDraft.active_tool || "",
      layout: workspaceDraft.layout || {},
      openTabs
    };
    const signature = stableJson(body);
    if (signature === workspaceSignatureRef.current) return true;
    setNotice("Saving workspace…");
    try {
      const saved = await focusApi.updateWorkspace(session.id, { expectedRevision: workspace.revision, ...body });
      setWorkspace(saved);
      setWorkspaceDraft(saved);
      workspaceSignatureRef.current = stableJson({
        currentPage: saved.current_page,
        pageCount: saved.page_count,
        zoom: Number(saved.zoom),
        sidebar: saved.sidebar,
        activeTool: saved.active_tool,
        layout: saved.layout || {},
        openTabs: saved.open_tabs || []
      });
      setNotice("Workspace saved.");
      return true;
    } catch (error) {
      if (isApiError(error) && error.status === 409) {
        try {
          const latest = await focusApi.getDocument(documentVersionId);
          if (latest.latest_workspace) {
            setWorkspace(latest.latest_workspace);
            setWorkspaceDraft(latest.latest_workspace);
            workspaceSignatureRef.current = stableJson(latest.latest_workspace);
          }
          setNotice("Workspace changed elsewhere. The latest server state was restored.");
        } catch (reloadError) {
          setNotice(errorMessage(reloadError, "Workspace changed elsewhere and could not be reloaded."));
        }
      } else {
        setNotice(errorMessage(error, "The workspace could not be saved."));
      }
      return false;
    }
  }, [documentVersionId, session, workspace, workspaceDraft]);

  useEffect(() => {
    if (!session || !workspaceDraft) return undefined;
    const timer = window.setTimeout(() => { void saveWorkspace(); }, 700);
    return () => window.clearTimeout(timer);
  }, [saveWorkspace, session, workspaceDraft]);

  const handleWorkspaceChange = useCallback((next) => {
    setWorkspaceDraft((current) => {
      if (!current) return current;
      const updated = {
        ...current,
        current_page: next.currentPage,
        zoom: next.zoom,
        sidebar: next.sidebar,
        active_tool: next.activeTool,
        layout: next.layout
      };
      return stableJson(updated) === stableJson(current) ? current : updated;
    });
  }, []);

  async function runSessionAction(action, navigateAfter = false) {
    if (!session) return false;
    setActionBusy(true);
    try {
      const workspaceSaved = await saveWorkspace();
      if (!workspaceSaved) return false;
      if (action === "complete" || action === "abandon") {
        const annotationsSaved = await syncAnnotations();
        if (!annotationsSaved) return false;
      }
      const updated = await focusApi.sessionAction(session.id, action);
      setSession(updated);
      setNotice(action === "complete" ? "Django completed this Focus session." : action === "abandon" ? "Django abandoned this Focus session." : updated.status === "paused" ? "Focus session paused." : "Focus session resumed.");
      if (action === "complete" || action === "abandon") {
        setSessionStorageValue(clientSessionKey(documentVersionId), null);
        if (navigateAfter) navigate(`/materials/objects/${detail.data.documentPayload.document.document_id}`, { replace: true });
      }
      return true;
    } catch (error) {
      setNotice(errorMessage(error, "The Focus session action could not be completed."));
      return false;
    } finally {
      setActionBusy(false);
    }
  }

  async function closeWorkspace() {
    const annotationsSaved = await syncAnnotations();
    if (!annotationsSaved) return;
    if (session?.status === "active" && !(await runSessionAction("pause", false))) return;
    navigate(`/materials/objects/${detail.data.documentPayload.document.document_id}`);
  }

  if (detail.loading) return <LoadingPanel />;
  if (detail.error) return <ErrorPanel message={detail.error || "Focus workspace is unavailable."} onRetry={detail.reload} />;
  if (!session || !workspace) return <LoadingPanel />;

  const document = detail.data.documentPayload.document;
  const pdfUrl = safeFocusFilePath(document.view_url);
  if (!pdfUrl) return <ErrorPanel message="Django did not provide a safe Focus document viewer link." onRetry={detail.reload} />;

  return (
    <FocusPdfWorkspace
      key={`${documentVersionId}-${workspace.revision}`}
      title={document.title || "Focus workspace"}
      subtitle={syncState === "saving" ? "Saving your workspace" : syncState === "recovery" ? "Changes need recovery" : "Django-backed Focus workspace"}
      pdfUrl={pdfUrl}
      drawings={drawings}
      setDrawings={updateDrawings}
      onClose={() => { void closeWorkspace(); }}
      initialWorkspace={workspace}
      session={session}
      onWorkspaceChange={handleWorkspaceChange}
      onPauseResume={() => { void runSessionAction(session.status === "paused" ? "resume" : "pause"); }}
      onComplete={() => { void runSessionAction("complete", true); }}
      onAbandon={() => { void runSessionAction("abandon", true); }}
      onRetrySync={syncState === "recovery" ? () => { void syncAnnotations(); } : null}
      onPageReady={handlePageReady}
      serverBacked
      sessionBusy={actionBusy}
      sessionNotice={`${notice}${unsupportedAnnotationCount ? ` ${unsupportedAnnotationCount} saved annotation${unsupportedAnnotationCount === 1 ? " uses" : "s use"} a tool that this existing canvas cannot render; Django keeps it unchanged.` : ""}${collectionRevision ? ` Annotation revision ${collectionRevision}.` : ""}`}
    />
  );
}
