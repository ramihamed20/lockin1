import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ArrowUpRight, Bookmark, ChevronLeft, ChevronRight, Crown, Eraser, FileText, Flame, Gift, Hand, Highlighter, Image as ImageIcon, LockKeyhole, Maximize2, Medal, MessageSquare, Minimize2, Minus, MoreHorizontal, MousePointer2, PanelRightOpen, Pause, PenLine, Play, Plus, Redo2, Search, Send, Shapes, ShieldCheck, Trophy, TrendingUp, Type, Undo2, UserPlus, Users, X, Zap } from "lucide-react";
import { focusApi } from "../api/focus.js";
import { formatDuration } from "../lib/utils.js";
import { Icon } from "../lib/icons.jsx";
import { notifyProgressionUpdated } from "../lib/progressionEvents.js";
import { ConfirmDialog } from "../components/shared/ConfirmDialog.jsx";
import { ErrorPanel, LoadingPanel, ProgressLine } from "../components/ui/index.jsx";
import { ReferenceAvatar, ReferenceProgress } from "../components/lock-in/ReferenceUi.jsx";
import "./catalog-focus-workspace.css";
import "./lock-in-reference.css";

const DURATIONS = [15, 25, 45, 60];
const WORKSPACE_COLORS = ["#8b5cf6", "#f7ce49", "#45d3a2", "#f27ca8", "#58b9ec"];
const LOCK_IN_VIEWER_TOOLS = [
  ["hand", "Pan", Hand],
  ["select", "Select", MousePointer2],
  ["pen", "Pen", PenLine],
  ["highlighter", "Highlight", Highlighter],
  ["eraser", "Eraser", Eraser],
  ["shapes", "Shapes", Shapes],
  ["text", "Text", Type],
  ["image", "Image", ImageIcon],
  ["note", "Add note", MessageSquare]
];
const LOCK_IN_SYNCED_ANNOTATION_TYPES = new Set(["pen", "highlighter", "shape", "text"]);

function workspaceToolFromServer(value) {
  if (value === "rectangle" || value === "circle" || value === "line" || value === "arrow") return "shapes";
  if (value === "sticky-note") return "note";
  if (value === "pencil") return "pen";
  return ["pen", "highlighter", "eraser", "text"].includes(value) ? value : "hand";
}

function workspaceToolForServer(value) {
  if (value === "shapes") return "rectangle";
  if (["pen", "highlighter", "eraser", "text"].includes(value)) return value;
  return "";
}

function workspacePointerPosition(event) {
  const bounds = event.currentTarget.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(1000, ((event.clientX - bounds.left) / bounds.width) * 1000)),
    y: Math.max(0, Math.min(1000, ((event.clientY - bounds.top) / bounds.height) * 1000))
  };
}

function workspaceStrokePath(points = []) {
  return points.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ");
}

function LockInWorkspaceAnnotation({ annotation, draft = false }) {
  const common = { "data-annotation-id": annotation.id, opacity: draft ? 0.72 : 1 };
  if (annotation.type === "pen" || annotation.type === "highlighter") {
    return <path {...common} d={workspaceStrokePath(annotation.points)} fill="none" stroke={annotation.color} strokeWidth={annotation.width} strokeLinecap="round" strokeLinejoin="round" opacity={annotation.type === "highlighter" ? 0.34 : common.opacity} />;
  }
  if (annotation.type === "shape") {
    const x = Math.min(annotation.start.x, annotation.end.x);
    const y = Math.min(annotation.start.y, annotation.end.y);
    return <rect {...common} x={x} y={y} width={Math.abs(annotation.end.x - annotation.start.x)} height={Math.abs(annotation.end.y - annotation.start.y)} rx="6" fill="none" stroke={annotation.color} strokeWidth={annotation.width} />;
  }
  if (annotation.type === "text") {
    return <text {...common} x={annotation.x} y={annotation.y} fill={annotation.color} fontSize={Math.max(18, annotation.width * 5)} fontFamily="system-ui, sans-serif">{annotation.text}</text>;
  }
  if (annotation.type === "image") {
    return <image {...common} href={annotation.src} x={annotation.x} y={annotation.y} width={annotation.width} height={annotation.height} preserveAspectRatio="xMidYMid meet" />;
  }
  return null;
}

function roundedWorkspaceValue(value) {
  return Number(Math.max(0, Math.min(1, Number(value) || 0)).toFixed(6));
}

function lockInAnnotationBounds(annotation) {
  if (annotation.type === "shape") {
    const left = Math.min(annotation.start.x, annotation.end.x) / 1000;
    const top = Math.min(annotation.start.y, annotation.end.y) / 1000;
    return { x: roundedWorkspaceValue(left), y: roundedWorkspaceValue(top), width: roundedWorkspaceValue(Math.abs(annotation.end.x - annotation.start.x) / 1000), height: roundedWorkspaceValue(Math.abs(annotation.end.y - annotation.start.y) / 1000) };
  }
  if (annotation.type === "text") {
    const x = roundedWorkspaceValue(annotation.x / 1000);
    const y = roundedWorkspaceValue(annotation.y / 1000);
    return { x, y, width: roundedWorkspaceValue(Math.min(0.3, 1 - x)), height: roundedWorkspaceValue(Math.min(0.06, 1 - y)) };
  }
  const points = annotation.points || [];
  const xs = points.map((point) => point.x / 1000);
  const ys = points.map((point) => point.y / 1000);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const right = Math.max(...xs);
  const bottom = Math.max(...ys);
  return { x: roundedWorkspaceValue(left), y: roundedWorkspaceValue(top), width: roundedWorkspaceValue(right - left), height: roundedWorkspaceValue(bottom - top) };
}

function lockInAnnotationMutation(annotation) {
  if (!LOCK_IN_SYNCED_ANNOTATION_TYPES.has(annotation.type)) return null;
  let tool = annotation.type;
  let payload;
  if (annotation.type === "pen" || annotation.type === "highlighter") {
    const samples = annotation.points.map((point, index) => ({ x: roundedWorkspaceValue(point.x / 1000), y: roundedWorkspaceValue(point.y / 1000), pointer: "unknown", pressure: 0.5, tiltX: 0, tiltY: 0, timestamp: Number(point.timestamp) || Date.now() + index }));
    if (samples.length === 1) samples.push({ ...samples[0], timestamp: samples[0].timestamp + 1 });
    payload = { kind: "stroke", samples };
  } else if (annotation.type === "shape") {
    tool = "rectangle";
    payload = { kind: "shape", start: { x: roundedWorkspaceValue(annotation.start.x / 1000), y: roundedWorkspaceValue(annotation.start.y / 1000) }, end: { x: roundedWorkspaceValue(annotation.end.x / 1000), y: roundedWorkspaceValue(annotation.end.y / 1000) } };
  } else {
    payload = { kind: "text", value: annotation.text };
  }
  return { id: annotation.id, page_number: annotation.page, tool, layer_key: "personal", bounds: lockInAnnotationBounds(annotation), payload, color: annotation.color, thickness: Math.max(1, Math.min(64, Number(annotation.width) || 4)), opacity: annotation.type === "highlighter" ? 0.34 : 1 };
}

function serverAnnotationToLockIn(annotation) {
  const base = { id: annotation.id, page: Number(annotation.page_number), color: annotation.color, width: Number(annotation.thickness) || 4, serverBacked: true };
  if (["pen", "pencil", "highlighter"].includes(annotation.tool) && annotation.payload?.kind === "stroke") {
    return { ...base, type: annotation.tool === "highlighter" ? "highlighter" : "pen", points: annotation.payload.samples.map((point) => ({ x: Number(point.x) * 1000, y: Number(point.y) * 1000, timestamp: Number(point.timestamp) })) };
  }
  if (["rectangle", "circle", "line", "arrow"].includes(annotation.tool) && annotation.payload?.kind === "shape") {
    return { ...base, type: "shape", start: { x: Number(annotation.payload.start.x) * 1000, y: Number(annotation.payload.start.y) * 1000 }, end: { x: Number(annotation.payload.end.x) * 1000, y: Number(annotation.payload.end.y) * 1000 } };
  }
  if (["text", "sticky-note"].includes(annotation.tool) && typeof annotation.payload?.value === "string") {
    return { ...base, type: "text", x: Number(annotation.bounds?.x) * 1000, y: Number(annotation.bounds?.y) * 1000, text: annotation.payload.value };
  }
  return null;
}

function LockInWorkspaceIconButton({ label, active = false, children, className = "", ...props }) {
  return <button className={`workspace-v2-icon-button${active ? " is-active" : ""}${className ? ` ${className}` : ""}`} type="button" aria-label={label} title={label} {...props}>{children}</button>;
}

function uuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  throw new Error("This browser cannot create a secure Lock In session identifier.");
}

function isUnfinished(payload) {
  return ["active", "paused", "on_break"].includes(payload?.session?.status);
}

function returnKey(user) {
  return `lock-in.return.${user?.id || "anonymous"}`;
}

function readReturnState(user, fallback) {
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(returnKey(user)) || "null");
    if (parsed && typeof parsed.route === "string" && !parsed.route.startsWith("/lock-in")) return parsed;
  } catch { /* A malformed local hint must not block a persisted server session. */ }
  return fallback;
}

function writeReturnState(user, value) {
  try { window.sessionStorage.setItem(returnKey(user), JSON.stringify(value)); } catch { /* storage is optional */ }
}

function payloadSessionId(payload) {
  return typeof payload?.session?.id === "string" ? payload.session.id : null;
}

function useLiveSessionTiming(payload) {
  const [tick, setTick] = useState(() => Date.now());
  const session = payload?.session;
  const timing = payload?.timing;
  const live = session?.status === "active" || session?.status === "on_break";

  useEffect(() => {
    if (!live) return undefined;
    setTick(Date.now());
    const interval = window.setInterval(() => setTick(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [live, session?.id, session?.status, timing?.server_now]);

  const serverNow = new Date(timing?.server_now || tick).getTime();
  const secondsSinceServer = Math.max(0, Math.floor((tick - (Number.isFinite(serverNow) ? serverNow : tick)) / 1000));
  const activeSeconds = Number(timing?.active_elapsed_seconds || 0) + (session?.status === "active" ? secondsSinceServer : 0);
  const breakSeconds = Number(timing?.break_elapsed_seconds || 0) + (session?.status === "on_break" ? secondsSinceServer : 0);
  const rawPlanned = Number(session?.planned_duration_seconds);
  const planned = Number.isFinite(rawPlanned) && rawPlanned > 0 ? rawPlanned : null;
  const remaining = planned == null ? null : Math.max(0, planned - activeSeconds);
  const progress = planned ? Math.min(100, Math.round((activeSeconds / planned) * 100)) : 0;
  return { session, timing, activeSeconds, breakSeconds, planned, remaining, progress };
}

function ReferenceStatStrip({ payload, material, tasks, busy, onSessionAction }) {
  const { session, activeSeconds, planned, remaining, progress } = useLiveSessionTiming(payload);
  const completedTasks = (tasks || []).filter((task) => task.completed_at).length;
  const totalTasks = tasks?.length || 0;
  const statusAction = session?.status === "active" ? "pause" : session?.status === "paused" ? "resume" : "end-break";
  const statusLabel = session?.status === "active" ? "Pause focus" : session?.status === "paused" ? "Resume focus" : "Resume focus";
  const timerValue = session?.status === "on_break" ? activeSeconds : remaining ?? activeSeconds;
  const ring = `conic-gradient(from 0deg, #f3a377 0 ${Math.max(2, progress)}%, #946ee9 ${Math.max(2, progress)}% ${Math.min(100, progress + 46)}%, #27344f ${Math.min(100, progress + 46)}% 100%)`;

  return (
    <>
      <section className="lockin-reference-stat-card lockin-reference-remaining" aria-label="Time remaining">
        <div><small>Time remaining</small><strong aria-live="off">{formatDuration(timerValue)}</strong></div>
        <button className="lockin-reference-pause" type="button" disabled={Boolean(busy)} onClick={() => onSessionAction(statusAction)} aria-label={statusLabel}>{session?.status === "active" ? <Pause size={20} fill="currentColor" /> : <Play size={19} fill="currentColor" />}</button>
      </section>
      <section className="lockin-reference-stat-card lockin-reference-focus-card lockin-reference-focus-stat" aria-label="Focus timer">
        <div><small>Focus timer</small><strong>{formatDuration(planned ?? activeSeconds)}</strong><span>{material?.title || "Independent study"}</span></div>
        <div className="lockin-reference-ring" style={{ background: ring }} aria-hidden="true" />
      </section>
      <section className="lockin-reference-stat-card lockin-reference-question-card" aria-label="Questions done">
        <small>Questions done</small><strong>{completedTasks} / {totalTasks}</strong>
        <ReferenceProgress className="lockin-reference-question-progress" value={totalTasks ? (completedTasks / totalTasks) * 100 : 0} indicatorClassName="li-bg-gradient-to-r li-from-[#8172ed] li-to-[#d16dcc]" label="Completed session tasks" />
      </section>
    </>
  );
}

function MandibleStudySheet() {
  const teeth = [285, 313, 341, 369, 397, 425, 453, 481, 509];
  return (
    <div className="lockin-reference-study-sheet">
      <div className="lockin-reference-study-copy">
        <h2>Mandible</h2>
        <p>The mandible is the largest and strongest bone of the facial skeleton. It forms the lower jaw and plays a key role in mastication and speech.</p>
        <h3>Key Landmarks</h3>
        <ul><li>Body</li><li>Ramus</li><li>Angle</li><li>Mandibular foramen</li><li>Coronoid process</li><li>Condylar process</li></ul>
      </div>
      <div className="lockin-reference-study-illustration" aria-label="Annotated mandible illustration" role="img">
        <svg viewBox="0 0 600 420" preserveAspectRatio="xMidYMid meet">
          <defs>
            <linearGradient id="jawBone" x1="0" x2="1" y1="0" y2="1"><stop stopColor="#e7d6b8"/><stop offset="0.52" stopColor="#cdb18a"/><stop offset="1" stopColor="#ad8e68"/></linearGradient>
            <filter id="jawShadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="5" stdDeviation="4" floodOpacity=".2"/></filter>
          </defs>
          <g fill="#2f2d2b" fontFamily="Georgia, serif" fontSize="18"><text x="58" y="48">Condylar</text><text x="58" y="69">process</text><text x="382" y="73">Coronoid</text><text x="386" y="94">process</text><text x="0" y="212">Ramus</text><text x="-24" y="295">Mandibular</text><text x="-8" y="316">foramen</text><text x="70" y="374">Angle</text><text x="403" y="405">Body</text></g>
          <g stroke="#44413d" strokeWidth="1.3" fill="none"><path d="M119 74 L139 134"/><path d="M397 99 L338 149"/><path d="M66 207 L167 207"/><path d="M93 297 L174 249"/><path d="M129 365 L190 318"/><path d="M439 390 L426 325"/></g>
          <path filter="url(#jawShadow)" d="M172 104 C155 99 144 118 148 145 C153 177 167 205 171 241 C177 289 208 322 268 340 C321 356 388 366 459 366 C503 366 529 348 531 316 L536 220 C537 193 525 182 507 189 L486 214 C467 233 451 257 432 276 C398 309 337 314 285 298 C248 287 231 273 226 238 L221 128 C218 102 202 88 188 102 L174 127 Z" fill="url(#jawBone)" stroke="#876f52" strokeWidth="2.5"/>
          <path d="M183 126 C193 149 189 189 191 233 C195 273 218 298 255 311" fill="none" stroke="#f7ecd4" strokeOpacity=".72" strokeWidth="7" strokeLinecap="round"/>
          <path d="M248 294 C309 322 390 332 447 312 C479 299 493 272 504 246" fill="none" stroke="#f4e4c9" strokeOpacity=".72" strokeWidth="6" strokeLinecap="round"/>
          <g fill="#f5ebd8" stroke="#8c7255" strokeWidth="1.6">{teeth.map((x, index) => <path key={x} d={`M${x} ${284 - index * 1.3} q11 -17 23 0 l-2 21 q-9 10 -19 0 Z`} />)}</g>
          <g fill="#735d48" opacity=".72"><circle cx="192" cy="231" r="5"/><circle cx="204" cy="252" r="4"/><circle cx="227" cy="286" r="4"/><circle cx="430" cy="306" r="5"/></g>
          <g fill="#eee5d2" opacity=".5"><path d="M196 165 q20 51 17 83" stroke="#fff" strokeWidth="3" fill="none"/><path d="M300 323 q74 23 132 1" stroke="#fff" strokeWidth="3" fill="none"/></g>
        </svg>
      </div>
    </div>
  );
}

function ReferencePdfViewer({ material, session, onMore, onNotes, onWorkspaceChange, workspaceSync, sidebarOpen, onSidebarOpenChange, sidebarContent, fullscreenTools, onFullscreenChange }) {
  const workspace = session?.workspace;
  const [page, setPage] = useState(() => Number(workspace?.current_page) || 1);
  const [zoom, setZoom] = useState(() => Number(workspace?.zoom) || 1);
  const [activeTool, setActiveTool] = useState(() => workspaceToolFromServer(workspace?.active_tool));
  const [activeColor, setActiveColor] = useState(WORKSPACE_COLORS[0]);
  const [brushSize, setBrushSize] = useState(4);
  const [annotations, setAnnotations] = useState([]);
  const [draftAnnotation, setDraftAnnotation] = useState(null);
  const [undoHistory, setUndoHistory] = useState([]);
  const [redoHistory, setRedoHistory] = useState([]);
  const [textEditor, setTextEditor] = useState(null);
  const [bookmarked, setBookmarked] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [annotationSync, setAnnotationSync] = useState("Saved");
  const [annotationRetry, setAnnotationRetry] = useState(0);
  const viewerRef = useRef(null);
  const stageRef = useRef(null);
  const imageInputRef = useRef(null);
  const panRef = useRef(null);
  const syncTimerRef = useRef(null);
  const collectionRevisionRef = useRef(0);
  const knownAnnotationsRef = useRef(new Map());
  const loadedAnnotationPagesRef = useRef(new Set());
  const displayTitle = material?.title || "Independent study";
  const documentVersionId = material?.document_version_id || null;
  const maximumPage = Math.max(page, Number(material?.page_count) || Number(workspace?.page_count) || 1);
  const pdfUrl = typeof material?.view_url === "string" && /^\/api\/v1\/files\/[0-9a-f-]+\/view$/i.test(material.view_url) ? material.view_url : null;
  const annotationMode = ["pen", "highlighter", "eraser", "shapes", "text"].includes(activeTool);
  const currentAnnotations = annotations.filter((annotation) => annotation.page === page);
  const combinedSync = annotationSync !== "Saved" ? annotationSync : workspaceSync;
  const pagePercent = maximumPage > 1 ? Math.max(2, (page / maximumPage) * 100) : 100;

  useEffect(() => {
    const handleFullscreenChange = () => {
      const fullscreen = document.fullscreenElement === viewerRef.current;
      setIsFullscreen(fullscreen);
      onFullscreenChange?.(fullscreen);
      if (fullscreen) onSidebarOpenChange?.(false);
      else if (window.matchMedia?.("(min-width: 1051px)").matches) onSidebarOpenChange?.(true);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, [onFullscreenChange, onSidebarOpenChange]);

  useEffect(() => () => {
    if (syncTimerRef.current) window.clearTimeout(syncTimerRef.current);
  }, []);

  useEffect(() => {
    if (!documentVersionId || loadedAnnotationPagesRef.current.has(page)) return undefined;
    let cancelled = false;
    setAnnotationSync("Loading annotations...");
    focusApi.getAnnotations(documentVersionId, { pages: [page] }).then((payload) => {
      if (cancelled) return;
      const loaded = (payload.results || []).map(serverAnnotationToLockIn).filter(Boolean);
      collectionRevisionRef.current = Number(payload.collection_revision) || 0;
      const known = new Map();
      loaded.forEach((annotation) => known.set(annotation.id, JSON.stringify(lockInAnnotationMutation(annotation))));
      knownAnnotationsRef.current.set(page, known);
      loadedAnnotationPagesRef.current.add(page);
      setAnnotations((current) => [...current.filter((annotation) => annotation.page !== page || !LOCK_IN_SYNCED_ANNOTATION_TYPES.has(annotation.type)), ...loaded]);
      setAnnotationSync("Saved");
    }).catch((error) => {
      if (cancelled) return;
      setAnnotationSync(error.message || "Annotations could not be loaded");
    });
    return () => { cancelled = true; };
  }, [annotationRetry, documentVersionId, page]);

  useEffect(() => {
    if (!documentVersionId || !loadedAnnotationPagesRef.current.size) return undefined;
    const changes = [];
    const deletedIds = [];
    knownAnnotationsRef.current.forEach((known, annotationPage) => {
      const current = annotations.filter((annotation) => annotation.page === annotationPage && LOCK_IN_SYNCED_ANNOTATION_TYPES.has(annotation.type));
      const currentIds = new Set();
      current.forEach((annotation) => {
        const mutation = lockInAnnotationMutation(annotation);
        if (!mutation) return;
        currentIds.add(annotation.id);
        if (known.get(annotation.id) !== JSON.stringify(mutation)) changes.push(mutation);
      });
      known.forEach((_fingerprint, id) => { if (!currentIds.has(id)) deletedIds.push(id); });
    });
    if (!changes.length && !deletedIds.length) return undefined;
    if (syncTimerRef.current) window.clearTimeout(syncTimerRef.current);
    setAnnotationSync(navigator.onLine === false ? "Offline - annotations kept here" : "Saving annotations...");
    if (navigator.onLine === false) return undefined;
    syncTimerRef.current = window.setTimeout(async () => {
      try {
        let changeOffset = 0;
        let deletionOffset = 0;
        while (changeOffset < changes.length || deletionOffset < deletedIds.length) {
          const batch = changes.slice(changeOffset, changeOffset + 100);
          const deleted = deletedIds.slice(deletionOffset, deletionOffset + (100 - batch.length));
          const saved = await focusApi.syncAnnotations(documentVersionId, { expectedCollectionRevision: collectionRevisionRef.current, idempotencyKey: uuid(), annotations: batch, deletedIds: deleted });
          collectionRevisionRef.current = Number(saved.collection_revision) || collectionRevisionRef.current;
          (saved.annotations || []).map(serverAnnotationToLockIn).filter(Boolean).forEach((annotation) => {
            if (!knownAnnotationsRef.current.has(annotation.page)) knownAnnotationsRef.current.set(annotation.page, new Map());
            knownAnnotationsRef.current.get(annotation.page).set(annotation.id, JSON.stringify(lockInAnnotationMutation(annotation)));
          });
          (saved.deleted_ids || []).forEach((id) => knownAnnotationsRef.current.forEach((known) => known.delete(id)));
          changeOffset += batch.length;
          deletionOffset += deleted.length;
        }
        setAnnotationSync("Saved");
      } catch (error) {
        setAnnotationSync(error.message || "Annotation sync failed - select status to retry");
      }
    }, 850);
    return () => {
      if (syncTimerRef.current) window.clearTimeout(syncTimerRef.current);
    };
  }, [annotationRetry, annotations, documentVersionId]);

  const updateWorkspace = (next) => {
    if (!workspace) return;
    onWorkspaceChange?.({
      currentPage: next.page ?? page,
      zoom: next.zoom ?? zoom,
      sidebar: workspace.sidebar || "closed",
      activeTool: next.activeTool ?? workspace.active_tool ?? "",
      layout: workspace.layout || {},
      openTabs: workspace.open_tabs || [],
      pageCount: material?.page_count || workspace.page_count || maximumPage
    });
  };

  const changePage = (nextPage) => {
    const value = Math.max(1, Math.min(maximumPage, nextPage));
    setPage(value);
    setTextEditor(null);
    updateWorkspace({ page: value });
  };

  const changeZoom = (nextZoom) => {
    const value = Math.max(0.5, Math.min(4, Number(nextZoom.toFixed(2))));
    setZoom(value);
    updateWorkspace({ zoom: value });
  };

  function selectTool(nextTool) {
    if (nextTool === "note") {
      onNotes?.();
      return;
    }
    if (nextTool === "image") {
      imageInputRef.current?.click();
      return;
    }
    setActiveTool(nextTool);
    updateWorkspace({ activeTool: workspaceToolForServer(nextTool) });
  }

  function commitAnnotations(nextAnnotations) {
    setAnnotations((current) => {
      const next = typeof nextAnnotations === "function" ? nextAnnotations(current) : nextAnnotations;
      setUndoHistory((history) => [...history.slice(-49), current]);
      setRedoHistory([]);
      return next;
    });
  }

  function undoTool() {
    setUndoHistory((history) => {
      if (!history.length) return history;
      const previous = history[history.length - 1];
      setRedoHistory((items) => [...items.slice(-49), annotations]);
      setAnnotations(previous);
      return history.slice(0, -1);
    });
  }

  function redoTool() {
    setRedoHistory((history) => {
      if (!history.length) return history;
      const next = history[history.length - 1];
      setUndoHistory((items) => [...items.slice(-49), annotations]);
      setAnnotations(next);
      return history.slice(0, -1);
    });
  }

  function beginAnnotation(event) {
    if (!annotationMode || event.button !== 0 || (documentVersionId && !loadedAnnotationPagesRef.current.has(page))) return;
    event.preventDefault();
    const point = workspacePointerPosition(event);
    if (activeTool === "eraser") {
      const annotationId = event.target.closest?.("[data-annotation-id]")?.dataset.annotationId;
      if (annotationId) commitAnnotations((items) => items.filter((item) => item.id !== annotationId));
      return;
    }
    if (activeTool === "text") {
      setTextEditor({ ...point, value: "" });
      return;
    }
    const next = activeTool === "shapes"
      ? { id: uuid(), page, type: "shape", color: activeColor, width: brushSize * 2, start: point, end: point }
      : { id: uuid(), page, type: activeTool, color: activeColor, width: activeTool === "highlighter" ? brushSize * 6 : brushSize * 2, points: [{ ...point, timestamp: Date.now() }] };
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Pointer capture is optional for synthetic events. */ }
    setDraftAnnotation(next);
  }

  function moveAnnotation(event) {
    if (!draftAnnotation) return;
    event.preventDefault();
    const point = workspacePointerPosition(event);
    setDraftAnnotation((draft) => draft?.type === "shape" ? { ...draft, end: point } : { ...draft, points: [...draft.points, { ...point, timestamp: Date.now() }] });
  }

  function finishAnnotation(event) {
    if (!draftAnnotation) return;
    event.preventDefault();
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const completed = draftAnnotation;
    setDraftAnnotation(null);
    const meaningful = completed.type === "shape" ? Math.abs(completed.end.x - completed.start.x) > 3 || Math.abs(completed.end.y - completed.start.y) > 3 : completed.points.length > 1;
    if (meaningful) commitAnnotations((items) => [...items, completed]);
  }

  function saveTextAnnotation(event) {
    event.preventDefault();
    const value = textEditor?.value.trim();
    if (value) commitAnnotations((items) => [...items, { id: uuid(), page, type: "text", x: textEditor.x, y: textEditor.y, text: value, color: activeColor, width: brushSize }]);
    setTextEditor(null);
  }

  function addImage(event) {
    const file = event.target.files?.[0];
    if (!file || !file.type.startsWith("image/")) return;
    commitAnnotations((items) => [...items, { id: uuid(), page, type: "image", src: URL.createObjectURL(file), x: 350, y: 300, width: 300, height: 220 }]);
    event.target.value = "";
    setAnnotationSync("Image added to this open session");
  }

  function beginPan(event) {
    if (event.button !== 0 || !stageRef.current) return;
    panRef.current = { x: event.clientX, y: event.clientY, left: stageRef.current.scrollLeft, top: stageRef.current.scrollTop };
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Drag remains available while the pointer is over the stage. */ }
    stageRef.current.classList.add("is-panning");
  }

  function movePan(event) {
    if (!panRef.current || !stageRef.current) return;
    stageRef.current.scrollLeft = panRef.current.left - (event.clientX - panRef.current.x);
    stageRef.current.scrollTop = panRef.current.top - (event.clientY - panRef.current.y);
  }

  function finishPan(event) {
    if (!panRef.current) return;
    panRef.current = null;
    stageRef.current?.classList.remove("is-panning");
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement === viewerRef.current) await document.exitFullscreen();
      else if (viewerRef.current?.requestFullscreen) {
        onSidebarOpenChange?.(false);
        await viewerRef.current.requestFullscreen();
      }
    } catch {
      setAnnotationSync("Fullscreen is unavailable in this browser");
    }
  }

  function runSearch(event) {
    event.preventDefault();
    const value = searchQuery.trim();
    if (!value) return;
    setSearchTerm(value);
    setSearchOpen(false);
  }

  const viewerFragment = `page=${page}&view=FitH&toolbar=0&navpanes=0&scrollbar=0${searchTerm ? `&search=${encodeURIComponent(searchTerm)}` : ""}`;

  return (
    <section className={`lockin-reference-viewer workspace-v2-reader${isFullscreen ? " is-document-fullscreen" : ""}`} ref={viewerRef} aria-label="Study document">
      <header className="lockin-reference-toolbar">
        <div className="lockin-reference-file"><FileText size={25} fill="currentColor" strokeWidth={1.6} /><span>{displayTitle}</span></div>
        <div className="lockin-reference-page-controls" aria-label="Document page controls"><LockInWorkspaceIconButton label="Previous page" onClick={() => changePage(page - 1)} disabled={page <= 1}><ChevronLeft size={19} /></LockInWorkspaceIconButton><span className="lockin-reference-page"><strong>{page}</strong> / {maximumPage}</span><LockInWorkspaceIconButton label="Next page" onClick={() => changePage(page + 1)} disabled={page >= maximumPage}><ChevronRight size={19} /></LockInWorkspaceIconButton></div>
        <div className="lockin-reference-view-controls"><div className="workspace-v2-control-group" aria-label="Zoom controls"><LockInWorkspaceIconButton label="Zoom out" onClick={() => changeZoom(zoom - 0.1)}><Minus size={18} /></LockInWorkspaceIconButton><span><strong>{Math.round(zoom * 100)}%</strong></span><LockInWorkspaceIconButton label="Zoom in" onClick={() => changeZoom(zoom + 0.1)}><Plus size={18} /></LockInWorkspaceIconButton></div><button className={`lockin-reference-fit${annotationSync !== "Saved" ? " is-attention" : ""}`} type="button" onClick={() => setAnnotationRetry((value) => value + 1)} aria-live="polite" title="Select to retry annotation sync">{combinedSync}</button><LockInWorkspaceIconButton label="Search document" active={searchOpen} onClick={() => setSearchOpen((value) => !value)}><Search size={18} /></LockInWorkspaceIconButton><LockInWorkspaceIconButton label={bookmarked ? "Remove page bookmark" : "Bookmark page"} active={bookmarked} onClick={() => setBookmarked((value) => !value)}><Bookmark size={18} fill={bookmarked ? "currentColor" : "none"} /></LockInWorkspaceIconButton><LockInWorkspaceIconButton label="Show document only" onClick={toggleFullscreen}><Maximize2 size={18} /></LockInWorkspaceIconButton><LockInWorkspaceIconButton label={sidebarOpen ? "Hide team sidebar" : "Show team sidebar"} active={sidebarOpen} onClick={() => onSidebarOpenChange?.(!sidebarOpen)}><PanelRightOpen size={19} /></LockInWorkspaceIconButton><LockInWorkspaceIconButton className="lockin-reference-more" label="Open session controls" onClick={onMore}><MoreHorizontal size={19} /></LockInWorkspaceIconButton></div>
      </header>
      {searchOpen && <form className="lockin-workspace-search" onSubmit={runSearch}><Search size={17} /><input autoFocus aria-label="Search this document" placeholder="Search this document..." value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} /><button type="submit">Find</button><button type="button" onClick={() => setSearchOpen(false)} aria-label="Close search"><X size={17} /></button></form>}
      <nav className="workspace-v2-toolbar lockin-workspace-tools" aria-label="Document tools">
        <div className="workspace-v2-tool-list">{LOCK_IN_VIEWER_TOOLS.map(([value, label, ToolIcon]) => <LockInWorkspaceIconButton key={value} label={label} active={activeTool === value} onClick={() => selectTool(value)}><ToolIcon size={19} /></LockInWorkspaceIconButton>)}</div>
        <input ref={imageInputRef} className="workspace-v2-file-input" type="file" accept="image/*" onChange={addImage} tabIndex="-1" aria-hidden="true" />
        <div className="workspace-v2-colors" aria-label="Annotation colors">{WORKSPACE_COLORS.map((color) => <button key={color} className={activeColor === color ? "is-active" : ""} type="button" style={{ background: color }} onClick={() => setActiveColor(color)} aria-label={`Use ${color} annotation color`} />)}</div>
        <label className="workspace-v2-line-width" title={`Brush size ${brushSize}`}><span className="workspace-v2-visually-hidden">Brush size</span><input type="range" min="2" max="10" step="1" value={brushSize} onChange={(event) => setBrushSize(Number(event.target.value))} /></label>
        <div className="workspace-v2-history"><LockInWorkspaceIconButton label="Undo annotation" onClick={undoTool} disabled={!undoHistory.length}><Undo2 size={18} /></LockInWorkspaceIconButton><LockInWorkspaceIconButton label="Redo annotation" onClick={redoTool} disabled={!redoHistory.length}><Redo2 size={18} /></LockInWorkspaceIconButton>{isFullscreen && <LockInWorkspaceIconButton label="Exit document-only view" onClick={toggleFullscreen}><Minimize2 size={18} /></LockInWorkspaceIconButton>}</div>
      </nav>
      <div className={`workspace-v2-document-stage lockin-workspace-stage is-tool-${activeTool}`} ref={stageRef}>
        <article className="workspace-v2-document lockin-workspace-document" style={{ "--workspace-document-width": `${Math.round(690 * zoom)}px`, "--workspace-document-max-width": zoom <= 1.3 ? "100%" : "none" }}>
          {pdfUrl ? <iframe key={`${pdfUrl}-${page}-${searchTerm}`} className="lockin-reference-pdf" title={displayTitle} src={`${pdfUrl}#${viewerFragment}`} /> : <div className="lockin-reference-empty-document"><FileText size={38} /><h2>Independent session</h2><p>Select a real study material in the preparation screen to read it here.</p></div>}
          {pdfUrl && activeTool === "hand" && <div className="lockin-workspace-pan-layer" aria-label="Pan document" onPointerDown={beginPan} onPointerMove={movePan} onPointerUp={finishPan} onPointerCancel={finishPan} />}
          <svg className={`workspace-v2-annotation-layer${annotationMode ? " is-interactive" : ""}`} viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-label="Document annotations" onPointerDown={beginAnnotation} onPointerMove={moveAnnotation} onPointerUp={finishAnnotation} onPointerCancel={finishAnnotation}>{currentAnnotations.map((annotation) => <LockInWorkspaceAnnotation key={annotation.id} annotation={annotation} />)}{draftAnnotation && <LockInWorkspaceAnnotation annotation={draftAnnotation} draft />}</svg>
          {textEditor && <form className="workspace-v2-text-editor" style={{ left: `${textEditor.x / 10}%`, top: `${textEditor.y / 10}%` }} onSubmit={saveTextAnnotation}><input autoFocus value={textEditor.value} maxLength="120" aria-label="Annotation text" placeholder="Type text" onChange={(event) => setTextEditor((current) => ({ ...current, value: event.target.value }))} /><button type="submit">Add</button><button type="button" onClick={() => setTextEditor(null)} aria-label="Cancel text annotation"><X size={15} /></button></form>}
        </article>
      </div>
      <div className="workspace-v2-page-progress lockin-workspace-page-progress" aria-label={`Page ${page} of ${maximumPage}`}><div><span style={{ width: `${pagePercent}%` }} /><i style={{ left: `${pagePercent}%` }} /></div><strong>{page} / {maximumPage}</strong></div>
      <button className={`workspace-v2-mobile-panel lockin-workspace-sidebar-trigger${sidebarOpen ? " is-hidden" : ""}`} type="button" onClick={() => onSidebarOpenChange?.(true)} aria-label="Open Lock In sidebar"><PanelRightOpen size={20} /><span>Team</span></button>
      {isFullscreen && sidebarOpen && <button className="lockin-workspace-sidebar-backdrop" type="button" onClick={() => onSidebarOpenChange?.(false)} aria-label="Dismiss Lock In sidebar" />}
      {isFullscreen && sidebarOpen && <div className="lockin-workspace-fullscreen-sidebar">{sidebarContent}</div>}
      {isFullscreen && fullscreenTools}
    </section>
  );
}

function initials(value) {
  return String(value || "?").split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

function teamMemberStatus(status) {
  if (status === "active") return "Focused";
  if (status === "paused") return "Paused";
  if (status === "on_break") return "On break";
  return "Offline";
}

const TEAM_MEMBERS = [];

function UnusedReferenceTeamPanel({ team }) {
  const teamName = team?.name;
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState([
    { id: "seed-1", person: "Yousef", initials: "YU", tone: "gold", time: "8:30 PM", body: "Can anyone explain the mandibular foramen again?" },
    { id: "seed-2", person: "Sara", initials: "SA", tone: "violet", body: "It transmits the inferior alveolar nerve and vessels.", mine: true },
    { id: "seed-3", person: "Omar", initials: "OM", tone: "slate", time: "8:32 PM", body: "Thanks! 🙏" }
  ]);

  function sendMessage(event) {
    event.preventDefault();
    const trimmed = message.trim();
    if (!trimmed) return;
    setMessages((current) => [...current, { id: `local-${Date.now()}`, person: "You", initials: "YO", tone: "teal", body: trimmed, mine: true }]);
    setMessage("");
  }

  return (
    <aside className="lockin-reference-side" aria-label="Study team and chat">
      <h2 className="lockin-reference-side-title">{teamName || "Your Team"} <span><Users size={15} /> 4</span></h2>
      <div className="lockin-reference-team-list">{TEAM_MEMBERS.map((member) => <article className="lockin-reference-member" key={member.name} style={{ "--member-color": member.color }}><ReferenceAvatar initials={member.initials} tone={member.tone} /><div className="lockin-reference-member-copy"><strong>{member.name}</strong><div className="lockin-reference-member-status"><i />{member.status}</div><ReferenceProgress value={member.progress} indicatorClassName="" /></div><div className="lockin-reference-member-percent">{member.crown ? <Crown className="lockin-reference-crown" size={20} fill="currentColor" /> : `${member.progress}%`}</div></article>)}</div>
      <section className="lockin-reference-chat" aria-labelledby="team-chat-title"><h3 id="team-chat-title" className="lockin-reference-chat-heading">Team Chat</h3><div className="lockin-reference-messages" aria-live="polite">{messages.map((item) => <div key={item.id} className={`lockin-reference-message${item.mine ? " lockin-reference-message--mine" : ""}`}>{!item.mine && <ReferenceAvatar initials={item.initials} tone={item.tone} className="li-h-11 li-w-11" />}<div><div className="lockin-reference-message-meta"><strong>{item.person}</strong>{item.time && <span>{item.time}</span>}</div><div className="lockin-reference-bubble">{item.body}</div></div></div>)}</div><form className="lockin-reference-chat-form" onSubmit={sendMessage}><input value={message} onChange={(event) => setMessage(event.target.value)} maxLength="500" placeholder="Type a message..." aria-label="Team chat message" /><button className="lockin-reference-send" type="submit" aria-label="Send message"><Send size={20} /></button></form></section>
    </aside>
  );
}

function LiveTeamPanel({ team, currentUserId, onClose }) {
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState([]);
  const [chatState, setChatState] = useState("");

  const loadMessages = useCallback(async () => {
    if (!team?.id) return;
    try {
      const payload = await focusApi.getLockInTeamMessages(team.id);
      setMessages(Array.isArray(payload.messages) ? payload.messages : []);
      setChatState("");
    } catch (error) { setChatState(error.message || "Chat could not be loaded."); }
  }, [team?.id]);

  useEffect(() => {
    if (!team?.id) return undefined;
    void loadMessages();
    const timer = window.setInterval(() => { void loadMessages(); }, 15000);
    return () => window.clearInterval(timer);
  }, [loadMessages, team?.id]);

  async function sendMessage(event) {
    event.preventDefault();
    const trimmed = message.trim();
    if (!team?.id || !trimmed || chatState === "sending") return;
    setChatState("sending");
    try {
      const payload = await focusApi.sendLockInTeamMessage(team.id, trimmed);
      setMessages(Array.isArray(payload.messages) ? payload.messages : []);
      setMessage("");
      setChatState("");
    } catch (error) { setChatState(error.message || "Message could not be sent."); }
  }

  if (!team) return <aside className="lockin-reference-side lockin-reference-personal" aria-label="Personal session">{onClose && <button className="lockin-reference-side-close" type="button" onClick={onClose} aria-label="Close Lock In sidebar"><X size={18} /></button>}<h2 className="lockin-reference-side-title">Personal focus</h2><p>This is a private session. Create a team to study and chat with others.</p></aside>;

  return <aside className="lockin-reference-side" aria-label="Study team and chat">{onClose && <button className="lockin-reference-side-close" type="button" onClick={onClose} aria-label="Close Lock In sidebar"><X size={18} /></button>}<h2 className="lockin-reference-side-title">{team.name} <span><Users size={15} /> {team.member_count}</span></h2><p className="lockin-reference-invite">Invite code: <strong>{team.invite_code}</strong></p><div className="lockin-reference-team-list">{(team.members || []).map((member) => <article className="lockin-reference-member" key={member.user_id} style={{ "--member-color": member.status === "active" ? "#50d9be" : "#9ca9be" }}><ReferenceAvatar initials={initials(member.name)} tone={member.status === "active" ? "teal" : "slate"} /><div className="lockin-reference-member-copy"><strong>{member.name}</strong><div className="lockin-reference-member-status"><i />{teamMemberStatus(member.status)}</div>{member.progress != null && <ReferenceProgress value={member.progress} indicatorClassName="" />}</div><div className="lockin-reference-member-percent">{member.progress != null ? `${member.progress}%` : ""}</div></article>)}</div><section className="lockin-reference-chat" aria-labelledby="team-chat-title"><h3 id="team-chat-title" className="lockin-reference-chat-heading">Team Chat</h3><div className="lockin-reference-messages" aria-live="polite">{messages.length ? messages.map((item) => <div key={item.id} className={`lockin-reference-message${item.author_id === currentUserId ? " lockin-reference-message--mine" : ""}`}>{item.author_id !== currentUserId && <ReferenceAvatar initials={initials(item.author_name)} tone="slate" className="li-h-11 li-w-11" />}<div><div className="lockin-reference-message-meta"><strong>{item.author_id === currentUserId ? "You" : item.author_name}</strong><span>{new Date(item.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span></div><div className="lockin-reference-bubble">{item.body}</div></div></div>) : <p className="lockin-reference-chat-empty">No messages yet. Say hello to your team.</p>}</div><form className="lockin-reference-chat-form" onSubmit={sendMessage}><input value={message} onChange={(event) => setMessage(event.target.value)} maxLength="1000" placeholder="Type a message..." aria-label="Team chat message" /><button className="lockin-reference-send" type="submit" disabled={!message.trim() || chatState === "sending"} aria-label="Send message"><Send size={20} /></button></form>{chatState && chatState !== "sending" && <p className="lockin-reference-chat-error" role="alert">{chatState}</p>}</section></aside>;
}

function ReferenceSessionTools({ open, session, material, tasks, noteBody, noteSync, taskDraft, busy, onClose, onAction, onNoteChange, onRetryNote, onTaskDraftChange, onAddTask, onToggleTask, onAbandon }) {
  if (!open) return null;
  const primaryAction = session.status === "active" ? "pause" : session.status === "paused" ? "resume" : "end-break";
  const primaryLabel = session.status === "active" ? "Pause" : session.status === "paused" ? "Resume" : "Resume focus";
  return (
    <section className="lockin-reference-utility" aria-label="Session controls">
      <h2>Session controls</h2><p>{session.goal || material?.title || "Your session is securely synced."}</p>
      <div className="lockin-reference-utility-actions"><button className="lockin-reference-utility-action" type="button" disabled={Boolean(busy)} onClick={() => onAction(primaryAction)}>{busy === primaryAction ? "Saving…" : primaryLabel}</button>{session.status === "active" && session.break_duration_seconds && <button className="lockin-reference-utility-action" type="button" disabled={Boolean(busy)} onClick={() => onAction("start-break")}>Start break</button>}<button className="lockin-reference-utility-action" type="button" disabled={Boolean(busy)} onClick={() => onAction("complete")}>{busy === "complete" ? "Saving…" : "Complete session"}</button><button className="lockin-reference-utility-action lockin-reference-utility-action--danger" type="button" disabled={Boolean(busy)} onClick={onAbandon}>Abandon</button><button className="lockin-reference-utility-action" type="button" onClick={onClose}>Close</button></div>
      {material?.view_url && <a className="lockin-reference-utility-action li-inline-flex li-items-center li-mt-2" href={material.view_url} target="_blank" rel="noreferrer">Open secure material</a>}
      <textarea className="lockin-reference-utility-note" value={noteBody} onChange={(event) => onNoteChange(event.target.value)} maxLength="10000" placeholder="Write a session note…" aria-label="Session notes" />
      <div className="lockin-reference-note-status"><span role="status">{noteSync}</span>{noteSync !== "Saved" && <button type="button" onClick={onRetryNote}>Retry</button>}</div>
      <div className="lockin-reference-tasks"><strong>Session tasks</strong>{tasks?.map((task) => <button className={`lockin-reference-task${task.completed_at ? " lockin-reference-task--complete" : ""}`} key={task.id} type="button" disabled={Boolean(busy)} onClick={() => onToggleTask(task.id)}><MessageSquare size={15} />{task.title}</button>)}<form className="lockin-reference-add-task" onSubmit={onAddTask}><input value={taskDraft} onChange={(event) => onTaskDraftChange(event.target.value)} maxLength="280" placeholder="Add a task" aria-label="Add a session task" /><button type="submit" disabled={!taskDraft.trim() || Boolean(busy)} aria-label="Add task"><Plus size={16} /></button></form></div>
    </section>
  );
}

function ReferenceActiveSession({ payload, currentUserId, error, busy, noteBody, noteSync, taskDraft, onAction, onExit, onWorkspaceChange, workspaceSync, onNoteChange, onRetryNote, onTaskDraftChange, onAddTask, onToggleTask, onAbandon }) {
  const [toolsOpen, setToolsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(() => window.matchMedia?.("(min-width: 1051px)").matches ?? true);
  const [documentOnly, setDocumentOnly] = useState(false);
  const { session, material, tasks } = payload;
  const handleSidebarOpenChange = useCallback((open) => {
    setSidebarOpen(open);
    if (open) setToolsOpen(false);
  }, []);
  const handleFullscreenChange = useCallback((active) => {
    setDocumentOnly(active);
    if (active) setToolsOpen(false);
  }, []);
  const openSessionTools = useCallback(() => {
    setSidebarOpen(false);
    setToolsOpen(true);
  }, []);
  const sessionTools = <ReferenceSessionTools open={toolsOpen} session={session} material={material} tasks={tasks} noteBody={noteBody} noteSync={noteSync} taskDraft={taskDraft} busy={busy} onClose={() => setToolsOpen(false)} onAction={onAction} onNoteChange={onNoteChange} onRetryNote={onRetryNote} onTaskDraftChange={onTaskDraftChange} onAddTask={onAddTask} onToggleTask={onToggleTask} onAbandon={onAbandon} />;
  return (
    <main className="lock-in-screen lockin-reference" aria-labelledby="lock-in-active-title">
      <div className="lockin-reference-inner">
        <header className="lockin-reference-top"><div className="lockin-reference-brand"><button className="lockin-reference-back" type="button" onClick={onExit} aria-label="Exit Lock In Mode"><ArrowLeft size={27} /></button><div className="lockin-reference-brand-copy"><h1 id="lock-in-active-title" className="lockin-reference-brand-title">Lock In Mode <LockKeyhole size={20} /></h1><p>Focus. Collaborate. Conquer.</p></div></div><ReferenceStatStrip payload={payload} material={material} tasks={tasks} busy={busy} onSessionAction={onAction} /></header>
        <section className={`lockin-reference-workspace${sidebarOpen && !documentOnly ? "" : " is-side-closed"}`}>
          <div className="li-relative">
            <ReferencePdfViewer material={material} session={session} onMore={() => { setSidebarOpen(false); setToolsOpen((value) => !value); }} onNotes={openSessionTools} onWorkspaceChange={onWorkspaceChange} workspaceSync={workspaceSync} sidebarOpen={sidebarOpen} onSidebarOpenChange={handleSidebarOpenChange} onFullscreenChange={handleFullscreenChange} sidebarContent={documentOnly ? <LiveTeamPanel team={payload.team} currentUserId={currentUserId} onClose={() => setSidebarOpen(false)} /> : null} fullscreenTools={documentOnly ? sessionTools : null} />
            {!documentOnly && sessionTools}
            {error && <p className="lockin-reference-error" role="alert">{error}</p>}
          </div>
          {!documentOnly && sidebarOpen && <button className="lockin-reference-side-backdrop" type="button" onClick={() => setSidebarOpen(false)} aria-label="Dismiss Lock In sidebar" />}
          {!documentOnly && sidebarOpen && <LiveTeamPanel team={payload.team} currentUserId={currentUserId} onClose={() => setSidebarOpen(false)} />}
        </section>
      </div>
    </main>
  );
}

function ExitDialog({ open, busy, onStay, onPauseExit, onComplete, onAbandon }) {
  const dialogRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === "Escape" && !busy) onStay();
    };
    document.addEventListener("keydown", handleKeyDown);
    window.setTimeout(() => dialogRef.current?.focus(), 0);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [busy, onStay, open]);

  if (!open) return null;
  return (
    <div className="confirm-backdrop" role="presentation">
      <div ref={dialogRef} className="confirm-dialog lock-in-exit-dialog" role="dialog" aria-modal="true" aria-labelledby="lock-in-exit-title" aria-describedby="lock-in-exit-description" tabIndex="-1">
        <div className="confirm-icon"><Icon name="help" size={24} /></div>
        <h3 id="lock-in-exit-title">Leave Lock In Mode?</h3>
        <p id="lock-in-exit-description">Your session is persisted. Choose how it should continue before you leave this focused screen.</p>
        <div className="confirm-actions lock-in-exit-actions">
          <button className="btn btn-soft" type="button" disabled={busy} onClick={onStay}>Stay in Lock In Mode</button>
          <button className="btn btn-soft" type="button" disabled={busy} onClick={onPauseExit}>Pause and exit</button>
          <button className="btn btn-primary" type="button" disabled={busy} onClick={onComplete}>Complete session</button>
          <button className="btn btn-danger" type="button" disabled={busy} onClick={onAbandon}>Abandon session</button>
        </div>
      </div>
    </div>
  );
}

function Setup({ bootstrap, preselectedDocumentVersionId, onStart, onExit, starting, error }) {
  const materials = Array.isArray(bootstrap?.materials) ? bootstrap.materials : [];
  const selectedFromRoute = materials.some((item) => item.document_version_id === preselectedDocumentVersionId)
    ? preselectedDocumentVersionId : "";
  const [materialId, setMaterialId] = useState(selectedFromRoute);
  const [sessionType, setSessionType] = useState(selectedFromRoute ? "material" : "timed");
  const [duration, setDuration] = useState("25");
  const [customDuration, setCustomDuration] = useState(25);
  const [breakDuration, setBreakDuration] = useState("5");
  const [goal, setGoal] = useState("");
  const [topic, setTopic] = useState("");
  const [note, setNote] = useState("");
  const [task, setTask] = useState("");

  const minutes = duration === "custom" ? Number(customDuration) : Number(duration);
  const needsMaterial = sessionType === "material";
  const canStart = !starting && (!needsMaterial || Boolean(materialId)) && (sessionType === "open_ended" || (Number.isInteger(minutes) && minutes >= 1));

  function submit(event) {
    event.preventDefault();
    if (!canStart) return;
    onStart({
      documentVersionId: materialId || null,
      sessionType,
      plannedDurationSeconds: sessionType === "open_ended" ? null : minutes * 60,
      breakDurationSeconds: breakDuration === "none" ? null : Number(breakDuration) * 60,
      goal,
      topic,
      note,
      tasks: task.trim() ? [{ client_task_id: uuid(), title: task.trim() }] : []
    });
  }

  return (
    <main className="lock-in-screen lock-in-setup" aria-labelledby="lock-in-setup-title">
      <header className="lock-in-header"><button className="brand lock-in-brand-button" type="button" onClick={onExit} aria-label="Leave Lock In setup"><span className="brand-mark"><Icon name="lock" size={18} /></span><strong>lock-in</strong></button><span className="pill">Focus mode</span></header>
      <section className="lock-in-setup-card panel">
        <div><p className="eyebrow">Prepare your session</p><h1 id="lock-in-setup-title">Lock In Mode</h1><p className="muted">Set a focused session using your real study materials and server-saved goals.</p></div>
        {bootstrap?.active_session && <ResumeCard payload={bootstrap.active_session} />}
        <form className="lock-in-form" onSubmit={submit}>
          <label className="field"><span>Session type</span><select value={sessionType} onChange={(event) => setSessionType(event.target.value)}><option value="timed">Timed session</option><option value="open_ended">Open-ended session</option><option value="material">Material-based session</option><option value="task">Task-based session</option></select></label>
          <label className="field"><span>Study material {needsMaterial ? "(required)" : "(optional)"}</span><select value={materialId} onChange={(event) => setMaterialId(event.target.value)}><option value="">No material selected</option>{materials.map((item) => <option key={item.document_version_id} value={item.document_version_id}>{item.title}</option>)}</select>{!materials.length && <small>No accessible PDF materials are currently available from Django.</small>}</label>
          {sessionType !== "open_ended" && <div className="lock-in-form-row"><label className="field"><span>Session duration</span><select value={duration} onChange={(event) => setDuration(event.target.value)}>{DURATIONS.map((value) => <option key={value} value={value}>{value} minutes</option>)}<option value="custom">Custom duration</option></select></label>{duration === "custom" && <label className="field"><span>Custom minutes</span><input type="number" min="1" max="480" value={customDuration} onChange={(event) => setCustomDuration(event.target.value)} /></label>}</div>}
          <label className="field"><span>Optional break</span><select value={breakDuration} onChange={(event) => setBreakDuration(event.target.value)}><option value="none">No planned break</option><option value="5">5 minutes</option><option value="10">10 minutes</option><option value="15">15 minutes</option></select></label>
          <label className="field"><span>Study goal</span><input value={goal} maxLength="280" onChange={(event) => setGoal(event.target.value)} placeholder="e.g. Understand local anaesthesia" /></label>
          <label className="field"><span>Chapter or topic</span><input value={topic} maxLength="280" onChange={(event) => setTopic(event.target.value)} placeholder="Optional topic" /></label>
          <label className="field"><span>First session task</span><input value={task} maxLength="280" onChange={(event) => setTask(event.target.value)} placeholder="Optional: read a chapter" /></label>
          <label className="field"><span>Intention or notes</span><textarea value={note} maxLength="10000" onChange={(event) => setNote(event.target.value)} placeholder="What matters for this session?" /></label>
          {error && <p className="inline-error" role="alert">{error}</p>}
          <button className="btn btn-primary" type="submit" disabled={!canStart}>{starting ? "Preparing session…" : "Start Lock In Mode"}</button>
        </form>
      </section>
    </main>
  );
}

const TEAM_RANKINGS = [
  ["Dental Titans", "1,250 pts", "#f3c64d"],
  ["Crown Hunters", "1,180 pts", "#e06b74"],
  ["Study Ninjas", "1,050 pts", "#7e69e8"],
  ["Tooth Geniuses", "980 pts", "#7587ee"],
  ["Pulp Fiction", "910 pts", "#a87de9"]
];

const TEAM_ACTIVITY = [
  ["Yousef", "solved 25 questions", "2m ago", "+25 pts", "teal", "target"],
  ["Sara", "achieved a 7 day streak!", "15m ago", "+50 pts", "violet", "flame"],
  ["Omar", "joined the team", "1h ago", "+0 pts", "slate", "users"],
  ["Rana", "completed the daily goal", "2h ago", "+100 pts", "gold", "check"],
  ["Hassan", "solved 40 questions", "3h ago", "+40 pts", "teal", "file"]
];

function TeamHub({ bootstrap, onPrepare, onResume, onExit }) {
  const activeSession = bootstrap?.active_session;
  const activeTeamName = activeSession?.session?.team_name || "Oral Anatomy Squad";

  return (
    <main className="lock-in-screen lockin-team-hub" aria-labelledby="lock-in-team-title">
      <div className="lockin-team-hub-inner">
        <header className="lockin-team-topbar">
          <button className="lockin-team-back" type="button" onClick={onExit} aria-label="Leave Lock In"><ArrowLeft size={25} /></button>
          <section className="lockin-team-identity"><div className="lockin-team-mark"><ShieldCheck size={28} /></div><div><h1 id="lock-in-team-title">{activeTeamName}</h1><div className="lockin-team-members"><span className="lockin-team-avatar-stack"><ReferenceAvatar initials="YO" tone="teal" /><ReferenceAvatar initials="YU" tone="gold" /><ReferenceAvatar initials="SA" tone="violet" /><ReferenceAvatar initials="OM" tone="slate" /></span><span>4 members</span></div></div></section>
          <section className="lockin-team-metric"><span>Team streak</span><strong><Flame size={28} fill="currentColor" /> 12 <small>days</small></strong><p>Keep it going!</p></section>
          <section className="lockin-team-metric"><span>Weekly progress</span><strong>76%</strong><ReferenceProgress value={76} indicatorClassName="li-bg-gradient-to-r li-from-[#f3b55e] li-via-[#8b6df0] li-to-[#a766df]" label="Weekly team progress" /><p>760 / 1000 points</p></section>
          <section className="lockin-team-metric lockin-team-rank"><span><Trophy size={16} fill="currentColor" /> Team rank</span><strong>#7 <small>Global</small></strong><p>Top 1% of all teams <TrendingUp size={19} /></p></section>
          <button className="lockin-team-cta" type="button" onClick={() => onPrepare("personal")}><Zap size={28} fill="currentColor" /><span><strong>Lock In Together</strong><small>Start a focused session</small></span></button>
        </header>
        <section className="lockin-team-dashboard">
          <article className="lockin-team-panel lockin-team-rankings"><h2>Team Rankings</h2><div className="lockin-team-tabs" role="tablist" aria-label="Team ranking scope"><button type="button" role="tab" aria-selected="true">Global</button><button type="button" role="tab" aria-selected="false">Friends</button><button type="button" role="tab" aria-selected="false">This Week</button></div><ol>{TEAM_RANKINGS.map(([name, points, color], index) => <li key={name} className={index === 3 ? "is-current" : ""}><strong className="lockin-team-place">{index + 1}</strong><span className="lockin-team-rank-icon" style={{ color }}><Medal size={24} fill="currentColor" /></span><span>{name}</span><small>{points}</small>{index < 3 && <Flame size={16} fill="currentColor" />}</li>)}</ol><footer className="lockin-team-next-reward"><div className="lockin-team-reward-icon"><Gift size={28} /></div><div><strong>Next Rank Reward</strong><span>Reach Top 5 to unlock</span><ReferenceProgress value={72} indicatorClassName="li-bg-gradient-to-r li-from-[#f0ba45] li-to-[#8559e6]" label="Progress to next team rank" /><small>140 more points to go</small></div></footer></article>
          <article className="lockin-team-panel lockin-team-activity"><header><h2>Activity Feed</h2><button type="button">View All</button></header><div>{TEAM_ACTIVITY.map(([name, action, ago, points, tone, icon]) => <div className="lockin-team-activity-row" key={`${name}-${ago}`}><span className={`lockin-team-activity-icon lockin-team-activity-icon--${tone}`}><Icon name={icon} size={21} /></span><ReferenceAvatar initials={name.slice(0, 2).toUpperCase()} tone={tone} /><p><strong>{name}</strong>{action}<small>{ago}</small></p><em>{points}</em></div>)}</div></article>
          <aside className="lockin-team-aside"><article className="lockin-team-panel lockin-my-teams"><h2>My Teams <span><Users size={16} /> 3</span></h2><div className="lockin-my-team-current"><div className="lockin-team-mark"><ShieldCheck size={24} /></div><div><strong>{activeTeamName}</strong><p>{activeSession ? `Active · ${activeSession.session.status.replace("_", " ")}` : "Ready for your next session"}</p><ReferenceProgress value={76} indicatorClassName="li-bg-gradient-to-r li-from-[#f3b55e] li-via-[#8b6df0] li-to-[#a766df]" label="Current team progress" /></div></div>{activeSession && <button className="lockin-team-resume" type="button" onClick={onResume}>Resume active session <ArrowUpRight size={17} /></button>}<button className="lockin-team-create" type="button" onClick={() => onPrepare("team")}><UserPlus size={19} /> Create Team</button><button className="lockin-team-secondary-action" type="button" onClick={() => onPrepare("personal")}><Users size={18} /> Lock In Together</button></article><article className="lockin-team-panel lockin-team-reward-card"><header><h2>Daily Reward</h2><Gift size={19} /></header><p>Study daily to keep your streak and unlock your next reward.</p><div className="lockin-team-reward-track"><span>✓</span><span>✓</span><span>✓</span><span>✓</span><i /></div><small>Day 4</small></article><article className="lockin-team-panel lockin-team-tip"><TrendingUp size={49} /><div><h2>Pro Tip</h2><p>Consistency beats intensity. A focused session is enough to move your team forward.</p></div></article></aside>
        </section>
      </div>
    </main>
  );
}

function LiveTeamHub({ bootstrap, onPrepare, onResume, onExit, onRefresh }) {
  const teams = Array.isArray(bootstrap?.teams) ? bootstrap.teams : [];
  const rankings = Array.isArray(bootstrap?.team_rankings) ? bootstrap.team_rankings : [];
  const activeSession = bootstrap?.active_session;
  const currentTeam = activeSession?.team || teams[0] || null;
  const [inviteCode, setInviteCode] = useState("");
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState("");
  const rank = currentTeam ? rankings.findIndex((team) => team.id === currentTeam.id) + 1 : 0;

  async function joinTeam(event) {
    event.preventDefault();
    if (!inviteCode.trim() || joining) return;
    setJoining(true);
    setJoinError("");
    try {
      await focusApi.joinLockInTeam(inviteCode.trim());
      setInviteCode("");
      await onRefresh();
    } catch (error) { setJoinError(error.message || "Team could not be joined."); }
    finally { setJoining(false); }
  }

  return <main className="lock-in-screen lockin-team-hub" aria-labelledby="lock-in-team-title"><div className="lockin-team-hub-inner"><header className="lockin-team-topbar"><button className="lockin-team-back" type="button" onClick={onExit} aria-label="Leave Lock In"><ArrowLeft size={25} /></button><section className="lockin-team-identity"><div className="lockin-team-mark"><ShieldCheck size={28} /></div><div><h1 id="lock-in-team-title">{currentTeam?.name || "Study together"}</h1><div className="lockin-team-members">{currentTeam ? <><span className="lockin-team-avatar-stack">{currentTeam.members.slice(0, 4).map((member) => <ReferenceAvatar key={member.user_id} initials={initials(member.name)} tone={member.status === "active" ? "teal" : "slate"} />)}</span><span>{currentTeam.member_count} member{currentTeam.member_count === 1 ? "" : "s"}</span></> : <span>Create or join a real study team</span>}</div></div></section><section className="lockin-team-metric"><span>Weekly focus</span><strong>{formatDuration(currentTeam?.weekly_active_seconds || 0)}</strong><p>{currentTeam?.weekly_completed_sessions || 0} completed sessions</p></section><section className="lockin-team-metric"><span>Active members</span><strong>{currentTeam?.members.filter((member) => member.status === "active").length || 0}</strong><p>Currently focused</p></section><section className="lockin-team-metric lockin-team-rank"><span><Trophy size={16} fill="currentColor" /> Team rank</span><strong>{rank ? `#${rank}` : "—"}</strong><p>{rank ? "Based on weekly focus" : "Create a team to rank"}</p></section><button className="lockin-team-cta" type="button" onClick={() => onPrepare("personal")}><Zap size={28} fill="currentColor" /><span><strong>Lock In Together</strong><small>Start a focused session</small></span></button></header><section className="lockin-team-dashboard"><article className="lockin-team-panel lockin-team-rankings"><h2>Team Rankings</h2>{rankings.length ? <ol>{rankings.map((team, index) => <li key={team.id} className={team.id === currentTeam?.id ? "is-current" : ""}><strong className="lockin-team-place">{index + 1}</strong><span className="lockin-team-rank-icon"><Medal size={24} fill="currentColor" /></span><span>{team.name}</span><small>{formatDuration(team.weekly_active_seconds)}</small></li>)}</ol> : <p className="lockin-team-empty">No completed team sessions yet.</p>}</article><article className="lockin-team-panel lockin-team-activity"><header><h2>Team activity</h2>{currentTeam && <span>{currentTeam.member_count} members</span>}</header>{currentTeam ? <div>{currentTeam.members.map((member) => <div className="lockin-team-activity-row" key={member.user_id}><ReferenceAvatar initials={initials(member.name)} tone={member.status === "active" ? "teal" : "slate"} /><p><strong>{member.name}</strong>{teamMemberStatus(member.status)}<small>{member.active_seconds ? formatDuration(member.active_seconds) : "No active session"}</small></p><em>{member.progress != null ? `${member.progress}%` : ""}</em></div>)}</div> : <p className="lockin-team-empty">Create a team and share its invite code to see live members here.</p>}</article><aside className="lockin-team-aside"><article className="lockin-team-panel lockin-my-teams"><h2>My Teams <span><Users size={16} /> {teams.length}</span></h2>{teams.length ? teams.map((team) => <div className="lockin-my-team-current" key={team.id}><div className="lockin-team-mark"><ShieldCheck size={24} /></div><div><strong>{team.name}</strong><p>{team.member_count} members · {formatDuration(team.weekly_active_seconds)} this week</p><ReferenceProgress value={team.members.some((member) => member.status === "active") ? 100 : 0} indicatorClassName="li-bg-gradient-to-r li-from-[#f3b55e] li-via-[#8b6df0] li-to-[#a766df]" label={`${team.name} live focus activity`} /></div></div>) : <p className="lockin-team-empty">You have not created or joined a team yet.</p>}{activeSession && <button className="lockin-team-resume" type="button" onClick={onResume}>Resume active session <ArrowUpRight size={17} /></button>}<button className="lockin-team-create" type="button" onClick={() => onPrepare("team")}><UserPlus size={19} /> Create Team</button><button className="lockin-team-secondary-action" type="button" onClick={() => onPrepare("personal")}><Users size={18} /> Lock In Together</button></article><article className="lockin-team-panel lockin-team-join"><h2>Join with Code</h2><form onSubmit={joinTeam}><input value={inviteCode} onChange={(event) => setInviteCode(event.target.value.toUpperCase())} maxLength="12" placeholder="TEAM CODE" aria-label="Team invite code" /><button type="submit" disabled={!inviteCode.trim() || joining}>{joining ? "Joining..." : "Join team"}</button></form>{joinError && <p role="alert">{joinError}</p>}</article></aside></section></div></main>;
}

function ReferenceSetup({ bootstrap, mode, preselectedDocumentVersionId, onStart, onBack, starting, error }) {
  const materials = Array.isArray(bootstrap?.materials) ? bootstrap.materials : [];
  const selectedFromRoute = materials.some((item) => item.document_version_id === preselectedDocumentVersionId) ? preselectedDocumentVersionId : "";
  const [materialId, setMaterialId] = useState(selectedFromRoute);
  const [duration, setDuration] = useState("25");
  const [teamName, setTeamName] = useState("");
  const isTeam = mode === "team";
  const canStart = !starting && (!isTeam || Boolean(teamName.trim()));

  function submit(event) {
    event.preventDefault();
    if (!canStart) return;
    onStart({ documentVersionId: materialId || null, sessionType: materialId ? "material" : "timed", plannedDurationSeconds: Number(duration) * 60, breakDurationSeconds: null, teamName: isTeam ? teamName.trim() : "", goal: "", topic: "", note: "", tasks: [] });
  }

  return (
    <main className="lock-in-screen lockin-setup-reference" aria-labelledby="lock-in-setup-title">
      <section className="lockin-setup-shell"><header><button className="lockin-setup-back" type="button" onClick={onBack} aria-label="Back to Lock In"><ArrowLeft size={22} /></button><div><span>Prepare your session</span><h1 id="lock-in-setup-title">{isTeam ? "Create your study team" : "Lock In Together"}</h1></div></header>{bootstrap?.active_session && <ResumeCard payload={bootstrap.active_session} />}<form className="lock-in-form" onSubmit={submit}><p className="lockin-setup-intro">{isTeam ? "Name the team, choose the material, then enter the focused workspace together." : "Choose a material and duration. Your session will be saved securely."}</p>{isTeam && <label className="field lockin-setup-team-field"><span>Team name</span><input value={teamName} maxLength="80" onChange={(event) => setTeamName(event.target.value)} placeholder="e.g. Oral Anatomy Squad" autoFocus required /></label>}<label className="field"><span>Study material</span><select value={materialId} onChange={(event) => setMaterialId(event.target.value)}><option value="">Independent study</option>{materials.map((item) => <option key={item.document_version_id} value={item.document_version_id}>{item.title}</option>)}</select>{!materials.length && <small>No accessible PDF materials are currently available from Django.</small>}</label><fieldset className="lockin-duration-picker"><legend>Session duration</legend><div>{DURATIONS.map((value) => <button className={duration === String(value) ? "active" : ""} type="button" key={value} aria-pressed={duration === String(value)} onClick={() => setDuration(String(value))}>{value}<small>min</small></button>)}</div></fieldset>{error && <p className="inline-error" role="alert">{error}</p>}<button className="lockin-setup-start" type="submit" disabled={!canStart}>{starting ? "Preparing…" : "Start Lock In Mode"}<ArrowUpRight size={19} /></button></form></section>
    </main>
  );
}

function ResumeCard({ payload }) {
  const navigate = useNavigate();
  const session = payload.session;
  return <aside className="lock-in-resume-card"><div><strong>Unfinished session found</strong><p>{payload.material?.title || session.goal || "Your server-saved Focus session"} · {session.status.replace("_", " ")}</p></div><button className="btn btn-soft" type="button" onClick={() => navigate(`/lock-in/${session.id}`, { replace: true })}>Resume session</button></aside>;
}

function Summary({ payload, onReturn }) {
  const { session, material, note, tasks, timing, daily_summary: daily } = payload;
  const completeTasks = (tasks || []).filter((task) => task.completed_at).length;
  return <main className="lock-in-screen lock-in-summary" aria-labelledby="lock-in-summary-title"><section className="panel lock-in-summary-card"><p className="eyebrow">{session.status === "completed" ? "Session complete" : "Session abandoned"}</p><h1 id="lock-in-summary-title">{session.status === "completed" ? "Your session is saved" : "Your elapsed focus time is saved"}</h1><div className="lock-in-summary-grid"><div><span>Active focus</span><strong>{formatDuration(timing.active_elapsed_seconds)}</strong></div><div><span>Break time</span><strong>{formatDuration(timing.break_elapsed_seconds)}</strong></div><div><span>Material</span><strong>{material?.title || "Independent study"}</strong></div><div><span>Tasks complete</span><strong>{completeTasks}/{tasks?.length || 0}</strong></div><div><span>Today’s completed time</span><strong>{formatDuration(daily?.completed_active_seconds || 0)}</strong></div><div><span>Sessions today</span><strong>{daily?.completed_sessions || 0}</strong></div></div>{note?.body && <div className="lock-in-summary-note"><span>Session notes</span><p>{note.body}</p></div>}<button className="btn btn-primary" type="button" onClick={onReturn}>Return to where you were</button></section></main>;
}

export default function LockInMode({ user }) {
  const { sessionId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [state, setState] = useState({ loading: true, error: "", bootstrap: null, payload: null });
  const [starting, setStarting] = useState(false);
  const [busy, setBusy] = useState("");
  const [exitOpen, setExitOpen] = useState(false);
  const [abandonOpen, setAbandonOpen] = useState(false);
  const [noteBody, setNoteBody] = useState("");
  const [noteSync, setNoteSync] = useState("Saved");
  const [noteRetryNonce, setNoteRetryNonce] = useState(0);
  const [workspaceSync, setWorkspaceSync] = useState("Saved");
  const [taskDraft, setTaskDraft] = useState("");
  const [setupMode, setSetupMode] = useState(() => location.state?.preselectedDocumentVersionId ? "personal" : "");
  const returnStateRef = useRef(readReturnState(user, { route: location.state?.returnTo || "/dashboard", scrollY: location.state?.scrollY || 0 }));
  const leaveRef = useRef(false);
  const workspaceSaveTimerRef = useRef(null);

  const replacePayload = useCallback((payload) => {
    setState((current) => ({ ...current, payload, error: "", loading: false }));
    if (typeof payload?.note?.body === "string") setNoteBody(payload.note.body);
  }, []);

  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: "" }));
    try {
      if (sessionId) {
        replacePayload(await focusApi.getLockInSession(sessionId));
      } else {
        const bootstrap = await focusApi.getLockIn();
        setState({ loading: false, error: "", bootstrap, payload: null });
      }
    } catch (error) {
      setState((current) => ({ ...current, loading: false, error: error.message || "Lock In Mode could not be opened." }));
    }
  }, [replacePayload, sessionId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const session = state.payload?.session;
    if (!session || !isUnfinished(state.payload)) return undefined;
    const handleBeforeUnload = (event) => { event.preventDefault(); event.returnValue = ""; };
    const handleVisibility = () => { if (!document.hidden) void focusApi.getLockInSession(session.id).then(replacePayload).catch(() => {}); };
    const handlePopState = () => {
      if (leaveRef.current) return;
      setExitOpen(true);
      window.setTimeout(() => navigate(`/lock-in/${session.id}`, { replace: true }), 0);
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("popstate", handlePopState);
    };
  }, [navigate, replacePayload, state.payload]);

  useEffect(() => {
    if (!state.payload?.session || !isUnfinished(state.payload)) return undefined;
    if (noteBody === (state.payload.note?.body || "")) return undefined;
    setNoteSync(navigator.onLine === false ? "Offline — changes kept here" : "Saving…");
    const timeout = window.setTimeout(async () => {
      if (navigator.onLine === false) return;
      try {
        const payload = await focusApi.updateLockInNote(state.payload.session.id, { body: noteBody, expectedRevision: state.payload.note?.revision || null });
        replacePayload(payload);
        setNoteSync("Saved");
      } catch (error) { setNoteSync(error.message || "Sync failed — retry when connected."); }
    }, 700);
    return () => window.clearTimeout(timeout);
  }, [noteBody, noteRetryNonce, replacePayload, state.payload]);

  useEffect(() => () => {
    if (workspaceSaveTimerRef.current) window.clearTimeout(workspaceSaveTimerRef.current);
  }, []);

  const queueWorkspaceChange = useCallback((next) => {
    const session = state.payload?.session;
    const workspace = session?.workspace;
    if (!session || !workspace) return;
    const draft = {
      expectedRevision: workspace.revision,
      currentPage: Number(next.currentPage) || workspace.current_page,
      pageCount: Number(next.pageCount) || workspace.page_count || null,
      zoom: Number(next.zoom) || Number(workspace.zoom) || 1,
      sidebar: next.sidebar || workspace.sidebar || "closed",
      activeTool: next.activeTool ?? workspace.active_tool ?? "",
      layout: next.layout || workspace.layout || {},
      openTabs: next.openTabs || workspace.open_tabs || []
    };
    setState((current) => ({ ...current, payload: { ...current.payload, session: { ...current.payload.session, workspace: { ...workspace, current_page: draft.currentPage, page_count: draft.pageCount, zoom: draft.zoom, sidebar: draft.sidebar, active_tool: draft.activeTool, layout: draft.layout, open_tabs: draft.openTabs } } } }));
    setWorkspaceSync(navigator.onLine === false ? "Offline" : "Saving...");
    if (workspaceSaveTimerRef.current) window.clearTimeout(workspaceSaveTimerRef.current);
    workspaceSaveTimerRef.current = window.setTimeout(async () => {
      if (navigator.onLine === false) return;
      try {
        const saved = await focusApi.updateWorkspace(session.id, draft);
        setState((current) => ({ ...current, payload: { ...current.payload, session: { ...current.payload.session, workspace: saved } } }));
        setWorkspaceSync("Saved");
      } catch (error) { setWorkspaceSync(error.message || "Workspace sync failed"); }
    }, 550);
  }, [state.payload]);

  const returnToSource = useCallback(() => {
    leaveRef.current = true;
    const target = readReturnState(user, returnStateRef.current);
    navigate(target.route || "/dashboard", { replace: true });
    window.setTimeout(() => window.scrollTo(0, Number(target.scrollY) || 0), 0);
  }, [navigate, user]);

  async function startSession(input) {
    setStarting(true);
    writeReturnState(user, returnStateRef.current);
    try {
      let request = input;
      if (input.teamName) {
        const created = await focusApi.createLockInTeam(input.teamName);
        request = { ...input, teamId: created.team?.id || null, teamName: "" };
      }
      const payload = await focusApi.startLockIn({ ...request, clientInstanceId: uuid() });
      replacePayload(payload);
      navigate(`/lock-in/${payloadSessionId(payload)}`, { replace: true });
    } catch (error) {
      setState((current) => ({ ...current, error: error.message || "The session could not start." }));
    } finally { setStarting(false); }
  }

  async function action(name, { exitAfter = false } = {}) {
    const session = state.payload?.session;
    if (!session || busy) return;
    setBusy(name);
    try {
      const payload = await focusApi.lockInAction(session.id, name);
      replacePayload(payload);
      if (name === "complete") notifyProgressionUpdated();
      if (exitAfter) returnToSource();
    } catch (error) { setState((current) => ({ ...current, error: error.message || "The session could not be updated." })); }
    finally { setBusy(""); setExitOpen(false); setAbandonOpen(false); }
  }

  async function addTask(event) {
    event.preventDefault();
    const session = state.payload?.session;
    if (!session || !taskDraft.trim() || busy) return;
    setBusy("task");
    try { replacePayload(await focusApi.addLockInTask(session.id, { clientTaskId: uuid(), title: taskDraft.trim() })); setTaskDraft(""); }
    catch (error) { setState((current) => ({ ...current, error: error.message || "The task could not be saved." })); }
    finally { setBusy(""); }
  }

  async function toggleTask(taskId) {
    const session = state.payload?.session;
    if (!session || busy) return;
    setBusy(`task-${taskId}`);
    try { replacePayload(await focusApi.toggleLockInTask(session.id, taskId)); }
    catch (error) { setState((current) => ({ ...current, error: error.message || "The task could not be updated." })); }
    finally { setBusy(""); }
  }

  if (state.loading) return <main className="lock-in-screen"><LoadingPanel /></main>;
  if (state.error && !state.bootstrap && !state.payload) return <main className="lock-in-screen"><ErrorPanel message={state.error} onRetry={load} /></main>;
  if (!state.payload && !setupMode) return <LiveTeamHub bootstrap={state.bootstrap} onPrepare={setSetupMode} onResume={() => navigate(`/lock-in/${payloadSessionId(state.bootstrap?.active_session)}`, { replace: true })} onExit={returnToSource} onRefresh={load} />;
  if (!state.payload) return <ReferenceSetup bootstrap={state.bootstrap} mode={setupMode} preselectedDocumentVersionId={location.state?.preselectedDocumentVersionId} onStart={startSession} onBack={() => setSetupMode("")} starting={starting} error={state.error} />;
  if (!isUnfinished(state.payload)) return <Summary payload={state.payload} onReturn={returnToSource} />;

  const { session, material, tasks, timing, daily_summary: daily } = state.payload;
  const sessionStatus = session.status === "on_break" ? "On break" : session.status === "paused" ? "Paused" : "Active";
  return (
    <>
      <ReferenceActiveSession payload={state.payload} currentUserId={user?.id} error={state.error} busy={busy} noteBody={noteBody} noteSync={navigator.onLine === false ? "Offline — changes kept on this device" : noteSync} taskDraft={taskDraft} onAction={action} onExit={() => setExitOpen(true)} onWorkspaceChange={queueWorkspaceChange} workspaceSync={workspaceSync} onNoteChange={setNoteBody} onRetryNote={() => setNoteRetryNonce((value) => value + 1)} onTaskDraftChange={setTaskDraft} onAddTask={addTask} onToggleTask={toggleTask} onAbandon={() => setAbandonOpen(true)} />
      <ExitDialog open={exitOpen} busy={Boolean(busy)} onStay={() => setExitOpen(false)} onPauseExit={() => session.status === "active" ? action("pause", { exitAfter: true }) : returnToSource()} onComplete={() => action("complete", { exitAfter: true })} onAbandon={() => { setExitOpen(false); setAbandonOpen(true); }} />
      <ConfirmDialog open={abandonOpen} title="Abandon this session?" message="Your notes, tasks, and elapsed active focus time will still be saved, but this session will not count as completed." confirmLabel={busy === "abandon" ? "Abandoning…" : "Abandon session"} onCancel={() => setAbandonOpen(false)} onConfirm={() => action("abandon")} />
    </>
  );

  return (
    <main className="lock-in-screen lock-in-active" aria-labelledby="lock-in-active-title">
      <header className="lock-in-header"><div className="brand"><span className="brand-mark"><Icon name="lock" size={18} /></span><strong>lock-in</strong></div><div className="lock-in-header-actions"><span className={`pill lock-in-status ${session.status}`}>{sessionStatus}</span><button className="btn btn-soft" type="button" onClick={() => setExitOpen(true)}><Icon name="x" size={16} /> Exit</button></div></header>
      <section className="lock-in-session-grid">
        <article className="panel lock-in-session-main"><p className="eyebrow">{material?.title ? "Studying material" : "Independent study"}</p><h1 id="lock-in-active-title">{session.goal || material?.title || "Stay with the work"}</h1><p className="muted">{[material?.title, session.topic].filter(Boolean).join(" · ") || "Your session is safely stored in Lock In."}</p><SessionTimer payload={state.payload} /><div className="lock-in-controls">{session.status === "active" && <><button className="btn btn-primary" type="button" disabled={Boolean(busy)} onClick={() => action("pause")}>{busy === "pause" ? "Pausing…" : "Pause"}</button>{session.break_duration_seconds && <button className="btn btn-soft" type="button" disabled={Boolean(busy)} onClick={() => action("start-break")}>Start break</button>}</>}{session.status === "paused" && <button className="btn btn-primary" type="button" disabled={Boolean(busy)} onClick={() => action("resume")}>{busy === "resume" ? "Resuming…" : "Resume"}</button>}{session.status === "on_break" && <button className="btn btn-primary" type="button" disabled={Boolean(busy)} onClick={() => action("end-break")}>{busy === "end-break" ? "Resuming…" : "Resume focus"}</button>}<button className="btn btn-soft" type="button" disabled={Boolean(busy)} onClick={() => action("complete")}>{busy === "complete" ? "Completing…" : "Complete session"}</button><button className="btn btn-danger" type="button" disabled={Boolean(busy)} onClick={() => setAbandonOpen(true)}>Abandon</button></div>{state.error && <p className="inline-error" role="alert">{state.error}</p>}<p className="save-hint" role="status">{navigator.onLine === false ? "Offline — session controls need a connection." : noteSync}</p></article>
        <aside className="lock-in-side-stack"><article className="panel lock-in-info-card"><div className="panel-title"><div><p className="eyebrow">Session details</p><h2>{material?.title || "Study session"}</h2></div><Icon name="book-open" size={18} /></div>{material?.view_url && <a className="btn btn-soft" href={material.view_url} target="_blank" rel="noreferrer"><Icon name="eye" size={16} /> Open secure material</a>}<dl><div><dt>Active focus</dt><dd>{formatDuration(timing.active_elapsed_seconds)}</dd></div><div><dt>Today complete</dt><dd>{formatDuration(daily?.completed_active_seconds || 0)}</dd></div><div><dt>Sessions today</dt><dd>{daily?.completed_sessions || 0}</dd></div>{session.workspace?.current_page && <div><dt>Saved page</dt><dd>{session.workspace.current_page}</dd></div>}</dl></article><article className="panel lock-in-notes-card"><div className="panel-title"><div><p className="eyebrow">Session notes</p><h2>Keep your thought</h2></div><Icon name="pencil" size={18} /></div><textarea value={noteBody} onChange={(event) => setNoteBody(event.target.value)} placeholder="Write a session note…" aria-label="Session notes" /> <div className="lock-in-note-status"><span role="status">{noteSync}</span>{noteSync !== "Saved" && <button className="text-link" type="button" onClick={() => setNoteRetryNonce((value) => value + 1)}>Retry</button>}</div></article><article className="panel lock-in-tasks-card"><div className="panel-title"><div><p className="eyebrow">Session tasks</p><h2>What matters now</h2></div><Icon name="check" size={18} /></div><div className="lock-in-task-list">{tasks?.map((task) => <button className={task.completed_at ? "completed" : ""} type="button" key={task.id} disabled={Boolean(busy)} onClick={() => toggleTask(task.id)}><Icon name="check" size={16} /><span>{task.title}</span></button>) || <p className="muted">No tasks added.</p>}</div><form className="lock-in-add-task" onSubmit={addTask}><input value={taskDraft} maxLength="280" onChange={(event) => setTaskDraft(event.target.value)} placeholder="Add a task" aria-label="Add a session task" /><button className="icon-btn" type="submit" disabled={!taskDraft.trim() || Boolean(busy)} aria-label="Add task"><Icon name="plus" /></button></form></article></aside>
      </section>
      <ExitDialog open={exitOpen} busy={Boolean(busy)} onStay={() => setExitOpen(false)} onPauseExit={() => session.status === "active" ? action("pause", { exitAfter: true }) : returnToSource()} onComplete={() => action("complete", { exitAfter: true })} onAbandon={() => { setExitOpen(false); setAbandonOpen(true); }} />
      <ConfirmDialog open={abandonOpen} title="Abandon this session?" message="Your notes, tasks, and elapsed active focus time will still be saved, but this session will not count as completed." confirmLabel={busy === "abandon" ? "Abandoning…" : "Abandon session"} onCancel={() => setAbandonOpen(false)} onConfirm={() => action("abandon")} />
    </main>
  );
}
