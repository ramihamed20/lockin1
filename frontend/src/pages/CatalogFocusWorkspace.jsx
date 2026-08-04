import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Bookmark,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Copy,
  Eraser,
  FileText,
  Hand,
  Highlighter,
  Image as ImageIcon,
  Maximize2,
  MessageSquare,
  Minimize2,
  Minus,
  MoreHorizontal,
  MousePointer2,
  PanelRightOpen,
  Pause,
  PenLine,
  Play,
  Plus,
  Redo2,
  Search,
  Shapes,
  Sparkles,
  Star,
  Type,
  Undo2,
  X,
  Zap
} from "lucide-react";
import { focusApi } from "../api/focus.js";
import { generateIdempotencyKey } from "../api/pagination.js";
import { getCatalogSheet } from "../lib/materialCatalog.js";
import { formatDuration } from "../lib/utils.js";
import { usePageTitle } from "../hooks/usePageTitle.js";
import "./catalog-focus-workspace.css";

const PAGE_COUNT = 342;
const FOCUS_SECONDS = 25 * 60;
const COLORS = ["#8b5cf6", "#f7ce49", "#45d3a2", "#f27ca8", "#58b9ec"];

const TOOL_ITEMS = [
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

const SUBJECT_COPY = {
  conservative: ["Adhesive Dentistry", "Preserving sound tooth structure is the central principle of conservative treatment."],
  microbiology: ["Bacterial Cell Structure", "Microbial structure determines how organisms grow, spread, and respond to treatment."],
  pharmacy: ["Drug Absorption", "Absorption controls how quickly and how much of a medicine reaches systemic circulation."],
  "general-pathology": ["Acute Inflammation", "Acute inflammation is an early protective response to tissue injury and infection."],
  "oral-histology": ["Enamel Structure", "Enamel is a highly mineralized tissue organized to withstand functional dental forces."],
  "fixed-prosthodontic": ["Crown Preparation", "A successful preparation balances retention, resistance, and preservation of tooth structure."],
  "removeable-prosthodontic": ["Denture Support", "Support distributes functional forces across the available oral tissues."],
};

function isUnfinished(payload) {
  return ["active", "paused", "on_break"].includes(payload?.session?.status);
}

function useFocusTiming(payload) {
  const [tick, setTick] = useState(() => Date.now());
  const status = payload?.session?.status;
  const running = status === "active" || status === "on_break";

  useEffect(() => {
    if (!running) return undefined;
    setTick(Date.now());
    const timer = window.setInterval(() => setTick(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running, payload?.session?.id, status]);

  const serverNow = new Date(payload?.timing?.server_now || tick).getTime();
  const liveDelta = running && Number.isFinite(serverNow) ? Math.max(0, Math.floor((tick - serverNow) / 1000)) : 0;
  const elapsed = Number(payload?.timing?.active_elapsed_seconds || 0) + (status === "active" ? liveDelta : 0);
  const planned = Number(payload?.session?.planned_duration_seconds || FOCUS_SECONDS);
  return { elapsed, remaining: Math.max(0, planned - elapsed), status };
}

function WorkspaceIconButton({ label, active = false, children, className = "", ...props }) {
  return <button className={`workspace-v2-icon-button${active ? " is-active" : ""}${className ? ` ${className}` : ""}`} type="button" aria-label={label} title={label} {...props}>{children}</button>;
}

function pointerPosition(event) {
  const bounds = event.currentTarget.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(1000, ((event.clientX - bounds.left) / bounds.width) * 1000)),
    y: Math.max(0, Math.min(1000, ((event.clientY - bounds.top) / bounds.height) * 1000))
  };
}

function strokePath(points = []) {
  return points.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ");
}

function WorkspaceAnnotation({ annotation, draft = false }) {
  const common = { "data-annotation-id": annotation.id, opacity: draft ? .72 : 1 };
  if (annotation.type === "pen" || annotation.type === "highlighter") {
    return <path {...common} d={strokePath(annotation.points)} fill="none" stroke={annotation.color} strokeWidth={annotation.width} strokeLinecap="round" strokeLinejoin="round" opacity={annotation.type === "highlighter" ? .34 : common.opacity} />;
  }
  if (annotation.type === "shape") {
    const x = Math.min(annotation.start.x, annotation.end.x);
    const y = Math.min(annotation.start.y, annotation.end.y);
    const width = Math.abs(annotation.end.x - annotation.start.x);
    const height = Math.abs(annotation.end.y - annotation.start.y);
    return <rect {...common} x={x} y={y} width={width} height={height} rx="6" fill="none" stroke={annotation.color} strokeWidth={annotation.width} />;
  }
  if (annotation.type === "text") {
    return <text {...common} x={annotation.x} y={annotation.y} fill={annotation.color} fontSize={Math.max(18, annotation.width * 5)} fontFamily="system-ui, sans-serif">{annotation.text}</text>;
  }
  if (annotation.type === "image") {
    return <image {...common} href={annotation.src} x={annotation.x} y={annotation.y} width={annotation.width} height={annotation.height} preserveAspectRatio="xMidYMid meet" />;
  }
  return null;
}

export default function CatalogFocusWorkspace() {
  const { materialSlug, sheetSlug } = useParams();
  const navigate = useNavigate();
  const rootRef = useRef(null);
  const readerRef = useRef(null);
  const stageRef = useRef(null);
  const imageInputRef = useRef(null);
  const noteRef = useRef(null);
  const sideTriggerRef = useRef(null);
  const sideCloseRef = useRef(null);
  const panRef = useRef(null);
  const { material, sheet } = getCatalogSheet(materialSlug, sheetSlug);
  const [page, setPage] = useState(52);
  const [zoom, setZoom] = useState(1.3);
  const [activeTool, setActiveTool] = useState("hand");
  const [activeColor, setActiveColor] = useState(COLORS[0]);
  const [bookmarked, setBookmarked] = useState(false);
  const [sideTab, setSideTab] = useState("notes");
  const [sideOpen, setSideOpen] = useState(() => window.matchMedia?.("(min-width: 821px)").matches ?? true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [brushSize, setBrushSize] = useState(4);
  const [annotations, setAnnotations] = useState([]);
  const [draftAnnotation, setDraftAnnotation] = useState(null);
  const [undoHistory, setUndoHistory] = useState([]);
  const [redoHistory, setRedoHistory] = useState([]);
  const [textEditor, setTextEditor] = useState(null);
  const [isDocumentFullscreen, setIsDocumentFullscreen] = useState(false);
  const [focusPayload, setFocusPayload] = useState(null);
  const [focusBusy, setFocusBusy] = useState(false);
  const [focusMessage, setFocusMessage] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [noteBusy, setNoteBusy] = useState(false);
  const timing = useFocusTiming(focusPayload);
  const [topicTitle, topicSummary] = SUBJECT_COPY[materialSlug] || [material?.title || "Study material", sheet?.summary || "Focused study workspace."];
  const sheetRoute = `/materials/catalog/${materialSlug}/sheets/${sheetSlug}`;
  const progress = Math.round((page / PAGE_COUNT) * 100);
  const highlights = useMemo(() => annotations.filter((item) => item.type === "highlighter"), [annotations]);
  const highlighterCount = highlights.length;
  const annotationMode = ["pen", "highlighter", "eraser", "shapes", "text"].includes(activeTool);
  const searchableText = `${topicTitle} ${topicSummary} core anatomical and clinical relationship Key Features structure clinical function examination points active recall revision practical sequence clinical note`.toLowerCase();

  usePageTitle(sheet ? `${sheet.title} · Workspace` : "Focus Workspace");

  useEffect(() => {
    let active = true;
    focusApi.getLockIn().then((bootstrap) => {
      if (!active) return;
      const unfinished = bootstrap?.active_session;
      setFocusPayload(isUnfinished(unfinished) ? unfinished : null);
      setNoteDraft(isUnfinished(unfinished) ? unfinished.note?.body || "" : "");
    }).catch((error) => {
      if (active) setFocusMessage(error.message || "Focus status could not be loaded.");
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const sessionId = focusPayload?.session?.id;
    if (!sessionId || !isUnfinished(focusPayload)) return undefined;
    const refresh = () => {
      if (!document.hidden) focusApi.getLockInSession(sessionId).then(setFocusPayload).catch(() => {});
    };
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, [focusPayload]);

  useEffect(() => {
    const syncFullscreenState = () => {
      const fullscreen = document.fullscreenElement === rootRef.current;
      setIsDocumentFullscreen(fullscreen);
      if (!fullscreen && window.matchMedia?.("(min-width: 821px)").matches) setSideOpen(true);
    };
    document.addEventListener("fullscreenchange", syncFullscreenState);
    return () => document.removeEventListener("fullscreenchange", syncFullscreenState);
  }, []);

  useEffect(() => {
    if (!sideOpen) return undefined;
    sideCloseRef.current?.focus();
    const closeOnEscape = (event) => {
      if (event.key === "Escape") {
        setSideOpen(false);
        sideTriggerRef.current?.focus();
      }
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [sideOpen]);

  function selectTool(nextTool) {
    if (nextTool === "note") {
      setSideTab("notes");
      setSideOpen(true);
      window.setTimeout(() => noteRef.current?.focus(), 0);
      return;
    }
    if (nextTool === "image") {
      imageInputRef.current?.click();
      return;
    }
    if (nextTool === activeTool) return;
    setActiveTool(nextTool);
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
    if (!annotationMode || event.button !== 0) return;
    event.preventDefault();
    const point = pointerPosition(event);
    if (activeTool === "eraser") {
      const annotationId = event.target.closest?.("[data-annotation-id]")?.dataset.annotationId;
      if (annotationId) commitAnnotations((items) => items.filter((item) => item.id !== annotationId));
      else setFocusMessage("Tap a drawing, highlight, shape, text, or image to erase it.");
      return;
    }
    if (activeTool === "text") {
      setTextEditor({ ...point, value: "" });
      return;
    }
    const id = generateIdempotencyKey();
    const next = activeTool === "shapes"
      ? { id, type: "shape", color: activeColor, width: brushSize * 2, start: point, end: point }
      : { id, type: activeTool, color: activeColor, width: (activeTool === "highlighter" ? brushSize * 6 : brushSize * 2), points: [point] };
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Some assistive and synthetic pointer events do not expose pointer capture. */ }
    setDraftAnnotation(next);
  }

  function moveAnnotation(event) {
    if (!draftAnnotation) return;
    event.preventDefault();
    const point = pointerPosition(event);
    setDraftAnnotation((draft) => draft?.type === "shape" ? { ...draft, end: point } : { ...draft, points: [...draft.points, point] });
  }

  function finishAnnotation(event) {
    if (!draftAnnotation) return;
    event.preventDefault();
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const completed = draftAnnotation;
    setDraftAnnotation(null);
    const meaningful = completed.type === "shape"
      ? Math.abs(completed.end.x - completed.start.x) > 3 || Math.abs(completed.end.y - completed.start.y) > 3
      : completed.points.length > 1;
    if (meaningful) commitAnnotations((items) => [...items, completed]);
  }

  function saveTextAnnotation(event) {
    event.preventDefault();
    const value = textEditor?.value.trim();
    if (value) commitAnnotations((items) => [...items, { id: generateIdempotencyKey(), type: "text", x: textEditor.x, y: textEditor.y, text: value, color: activeColor, width: brushSize }]);
    setTextEditor(null);
  }

  function addImage(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setFocusMessage("Choose an image file to add it to the sheet.");
      return;
    }
    const src = URL.createObjectURL(file);
    commitAnnotations((items) => [...items, { id: generateIdempotencyKey(), type: "image", src, x: 350, y: 300, width: 300, height: 220 }]);
    event.target.value = "";
    setFocusMessage("Image added. Use Eraser to remove it or Undo to revert.");
  }

  function beginPan(event) {
    if (activeTool !== "hand" || event.button !== 0) return;
    panRef.current = { x: event.clientX, y: event.clientY, left: event.currentTarget.scrollLeft, top: event.currentTarget.scrollTop };
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* The drag still works while the pointer remains over the reader. */ }
    event.currentTarget.classList.add("is-panning");
  }

  function movePan(event) {
    if (!panRef.current) return;
    event.currentTarget.scrollLeft = panRef.current.left - (event.clientX - panRef.current.x);
    event.currentTarget.scrollTop = panRef.current.top - (event.clientY - panRef.current.y);
  }

  function finishPan(event) {
    if (!panRef.current) return;
    panRef.current = null;
    event.currentTarget.classList.remove("is-panning");
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  async function startFocus() {
    const payload = await focusApi.startLockIn({
      documentVersionId: null,
      clientInstanceId: generateIdempotencyKey(),
      sessionType: "timed",
      plannedDurationSeconds: FOCUS_SECONDS,
      breakDurationSeconds: null,
      goal: "",
      topic: sheet.title,
      note: noteDraft,
      tasks: []
    });
    setFocusPayload(payload);
    return payload;
  }

  async function toggleFocus() {
    if (focusBusy) return;
    setFocusBusy(true);
    setFocusMessage("");
    try {
      if (!focusPayload) {
        await startFocus();
        setFocusMessage("Focus session started and saved by Django.");
      } else {
        const action = timing.status === "active" ? "pause" : timing.status === "paused" ? "resume" : "end-break";
        const payload = await focusApi.lockInAction(focusPayload.session.id, action);
        setFocusPayload(payload);
        setFocusMessage(action === "pause" ? "Focus paused." : "Focus resumed.");
      }
    } catch (error) {
      setFocusMessage(error.message || "Focus could not be updated.");
    } finally {
      setFocusBusy(false);
    }
  }

  async function saveNote() {
    if (!focusPayload?.session?.id || noteBusy) {
      setFocusMessage("Start Focus before saving a session note.");
      return;
    }
    setNoteBusy(true);
    try {
      const updated = await focusApi.updateLockInNote(focusPayload.session.id, {
        body: noteDraft,
        expectedRevision: focusPayload.note?.revision || null
      });
      setFocusPayload(updated);
      setFocusMessage("Note saved to the current session.");
    } catch (error) {
      setFocusMessage(error.message || "The note could not be saved.");
    } finally {
      setNoteBusy(false);
    }
  }

  async function toggleDocumentFullscreen() {
    try {
      if (isDocumentFullscreen && !document.fullscreenElement) {
        setIsDocumentFullscreen(false);
        if (window.matchMedia?.("(min-width: 821px)").matches) setSideOpen(true);
      } else if (document.fullscreenElement === rootRef.current) {
        await document.exitFullscreen();
      } else {
        setSideOpen(false);
        if (rootRef.current?.requestFullscreen) await rootRef.current.requestFullscreen();
        else setIsDocumentFullscreen(true);
      }
    } catch {
      setFocusMessage("Fullscreen is not available in this browser.");
    }
  }

  function runSearch(event) {
    event.preventDefault();
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      setFocusMessage("Type a word or phrase to search this sheet.");
      return;
    }
    setFocusMessage(searchableText.includes(query) ? `Found “${searchQuery.trim()}” on page ${page}.` : `No result for “${searchQuery.trim()}” on this page.`);
  }

  if (!material || !sheet) {
    return <main className="workspace-v2 workspace-v2-missing"><h1>Workspace unavailable</h1><button type="button" onClick={() => navigate("/materials")}>Back to materials</button></main>;
  }

  return (
    <main className={`workspace-v2${isDocumentFullscreen ? " is-document-fullscreen" : ""}`} ref={rootRef} aria-label={`${sheet.title} Focus Workspace`}>
      <header className="workspace-v2-header">
        <div className="workspace-v2-file">
          <WorkspaceIconButton label="Back to sheet" onClick={() => navigate(sheetRoute)}><ArrowLeft size={19} /></WorkspaceIconButton>
          <FileText size={20} />
          <strong>{sheet.title}.pdf</strong>
          <WorkspaceIconButton label={bookmarked ? "Remove bookmark" : "Bookmark document"} active={bookmarked} onClick={() => setBookmarked((value) => !value)}><Star size={16} fill={bookmarked ? "currentColor" : "none"} /></WorkspaceIconButton>
        </div>

        <div className="workspace-v2-document-controls">
          <div className="workspace-v2-control-group" aria-label="Page navigation">
            <WorkspaceIconButton label="Previous page" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft size={18} /></WorkspaceIconButton>
            <span><strong>{page}</strong> / {PAGE_COUNT}</span>
            <WorkspaceIconButton label="Next page" disabled={page >= PAGE_COUNT} onClick={() => setPage((value) => Math.min(PAGE_COUNT, value + 1))}><ChevronRight size={18} /></WorkspaceIconButton>
          </div>
          <div className="workspace-v2-control-group" aria-label="Zoom controls">
            <WorkspaceIconButton label="Zoom out" onClick={() => setZoom((value) => Math.max(.8, Number((value - .1).toFixed(1))))}><Minus size={17} /></WorkspaceIconButton>
            <span><strong>{Math.round(zoom * 100)}%</strong></span>
            <WorkspaceIconButton label="Zoom in" onClick={() => setZoom((value) => Math.min(1.8, Number((value + .1).toFixed(1))))}><Plus size={17} /></WorkspaceIconButton>
          </div>
          <WorkspaceIconButton label="Show document only" onClick={toggleDocumentFullscreen}><Maximize2 size={18} /></WorkspaceIconButton>
          <WorkspaceIconButton label="Search document" active={searchOpen} onClick={() => setSearchOpen((value) => !value)}><Search size={19} /></WorkspaceIconButton>
          <WorkspaceIconButton label={bookmarked ? "Remove bookmark" : "Bookmark page"} active={bookmarked} onClick={() => setBookmarked((value) => !value)}><Bookmark size={19} fill={bookmarked ? "currentColor" : "none"} /></WorkspaceIconButton>
          <WorkspaceIconButton label="Open workspace panel" onClick={() => setSideOpen(true)}><MoreHorizontal size={20} /></WorkspaceIconButton>
        </div>

        <div className="workspace-v2-focus-status" role="status">
          <span className={`workspace-v2-focus-ring ${timing.status === "active" ? "is-running" : ""}`}><Zap size={17} fill="currentColor" /></span>
          <div><span>Focus</span><strong>{formatDuration(focusPayload ? timing.remaining : FOCUS_SECONDS)}</strong></div>
          <button type="button" aria-label={timing.status === "active" ? "Pause focus" : "Start or resume focus"} onClick={toggleFocus} disabled={focusBusy}>{timing.status === "active" ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}</button>
        </div>
      </header>

      {searchOpen && <form className="workspace-v2-search" onSubmit={runSearch}><Search size={17} /><input autoFocus aria-label="Search this document" placeholder="Search this document…" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} /><button type="submit">Find</button><button type="button" onClick={() => setSearchOpen(false)} aria-label="Close search"><X size={17} /></button></form>}

      <div className={`workspace-v2-body${sideOpen ? " has-side" : ""}`}>
        <section className={`workspace-v2-reader${isDocumentFullscreen ? " is-document-fullscreen" : ""}`} ref={readerRef} aria-label="Document reader">
          <nav className="workspace-v2-toolbar" aria-label="Document tools">
            <div className="workspace-v2-tool-list">
              {TOOL_ITEMS.map(([id, label, ToolIcon]) => <WorkspaceIconButton key={id} label={label} active={activeTool === id} onClick={() => selectTool(id)}><ToolIcon size={19} /></WorkspaceIconButton>)}
            </div>
            <input ref={imageInputRef} className="workspace-v2-file-input" type="file" accept="image/*" onChange={addImage} tabIndex="-1" aria-hidden="true" />
            <div className="workspace-v2-colors" aria-label="Annotation colors">
              {COLORS.map((color) => <button key={color} type="button" aria-label={`Use ${color}`} aria-pressed={activeColor === color} className={activeColor === color ? "is-active" : ""} style={{ backgroundColor: color }} onClick={() => setActiveColor(color)} />)}
            </div>
            <label className="workspace-v2-line-width" title={`Brush size ${brushSize}`}><span className="workspace-v2-visually-hidden">Brush size</span><input type="range" min="2" max="10" step="1" value={brushSize} onChange={(event) => setBrushSize(Number(event.target.value))} /></label>
            <div className="workspace-v2-history">
              <WorkspaceIconButton label="Undo" disabled={!undoHistory.length} onClick={undoTool}><Undo2 size={18} /></WorkspaceIconButton>
              <WorkspaceIconButton label="Redo" disabled={!redoHistory.length} onClick={redoTool}><Redo2 size={18} /></WorkspaceIconButton>
              <WorkspaceIconButton label="Exit document-only view" className="workspace-v2-fullscreen-exit" onClick={toggleDocumentFullscreen}><Minimize2 size={18} /></WorkspaceIconButton>
            </div>
          </nav>

          <div className={`workspace-v2-document-stage is-tool-${activeTool}`} ref={stageRef} onPointerDown={beginPan} onPointerMove={movePan} onPointerUp={finishPan} onPointerCancel={finishPan}>
            <article className="workspace-v2-document" style={{ "--workspace-document-width": `${Math.round(690 * zoom)}px`, "--workspace-document-max-width": zoom <= 1.3 ? "100%" : "none" }}>
              <svg className={`workspace-v2-annotation-layer${annotationMode ? " is-interactive" : ""}`} viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-label="Document annotations" onPointerDown={beginAnnotation} onPointerMove={moveAnnotation} onPointerUp={finishAnnotation} onPointerCancel={finishAnnotation}>
                {annotations.map((annotation) => <WorkspaceAnnotation key={annotation.id} annotation={annotation} />)}
                {draftAnnotation && <WorkspaceAnnotation annotation={draftAnnotation} draft />}
              </svg>
              {textEditor && <form className="workspace-v2-text-editor" style={{ left: `${textEditor.x / 10}%`, top: `${textEditor.y / 10}%` }} onSubmit={saveTextAnnotation}><input autoFocus value={textEditor.value} maxLength="120" aria-label="Annotation text" placeholder="Type text" onChange={(event) => setTextEditor((current) => ({ ...current, value: event.target.value }))} /><button type="submit">Add</button><button type="button" onClick={() => setTextEditor(null)} aria-label="Cancel text annotation"><X size={15} /></button></form>}
              <h1>{topicTitle}</h1>
              <p className="workspace-v2-lead">{topicSummary} It helps connect foundational knowledge with confident clinical decisions.</p>
              <div className="workspace-v2-selection-actions" aria-label="Selected text actions">
                <button type="button" disabled title="AI tools are coming later"><Sparkles size={16} />Explain</button>
                <button type="button" onClick={() => navigate("/questions")}><Copy size={16} />Create Flashcard</button>
                <button type="button" disabled title="AI tools are coming later"><CircleHelp size={16} />Generate MCQs</button>
                <button type="button" onClick={() => selectTool("note")}><MessageSquare size={16} />Add Note</button>
                <button type="button" onClick={() => navigate("/review")}><Bookmark size={16} />Save to Review</button>
              </div>
              <div className="workspace-v2-document-grid">
                <div>
                  <p>Understanding the <mark>core anatomical and clinical relationship</mark> improves recognition, recall, and application during assessment.</p>
                  <h2>Key Features</h2>
                  <ul>
                    <li>Connects structure with clinical function</li>
                    <li>Highlights the essential examination points</li>
                    <li>Supports active recall and revision</li>
                    <li>Organizes the topic into a practical sequence</li>
                  </ul>
                </div>
                <figure className="workspace-v2-figure">
                  <div><Sparkles size={34} /><strong>{material.title}</strong><span>Focused visual reference</span></div>
                  <figcaption>Figure {sheet.number}.1 · Core concept overview</figcaption>
                </figure>
              </div>
              <aside className="workspace-v2-clinical-note">
                <span><Zap size={23} /></span>
                <div><strong>Clinical Note</strong><p>Use the selected tools to highlight, annotate, and connect this concept to the current study session.</p></div>
              </aside>
            </article>
          </div>

          <div className="workspace-v2-page-progress" aria-label={`Page ${page} of ${PAGE_COUNT}`}>
            <div><span style={{ width: `${Math.max(2, (page / PAGE_COUNT) * 100)}%` }} /><i style={{ left: `${Math.max(2, (page / PAGE_COUNT) * 100)}%` }} /></div><strong>{page} / {PAGE_COUNT}</strong>
          </div>
        </section>

        {sideOpen && <button className="workspace-v2-side-backdrop" type="button" onClick={() => setSideOpen(false)} aria-label="Close workspace panel" />}
        <aside className={`workspace-v2-side${sideOpen ? " is-open" : ""}`} aria-label="Workspace notes and actions" aria-hidden={!sideOpen} inert={sideOpen ? undefined : ""}>
          <button ref={sideCloseRef} className="workspace-v2-side-close" type="button" onClick={() => { setSideOpen(false); sideTriggerRef.current?.focus(); }} aria-label="Close workspace panel"><X size={18} /></button>
          <div className="workspace-v2-tabs" role="tablist" aria-label="Workspace panels">
            <button type="button" role="tab" aria-selected={sideTab === "notes"} className={sideTab === "notes" ? "is-active" : ""} onClick={() => setSideTab("notes")}>Notes</button>
            <button type="button" role="tab" aria-selected={sideTab === "highlights"} className={sideTab === "highlights" ? "is-active" : ""} onClick={() => setSideTab("highlights")}>Highlights <span>{highlighterCount}</span></button>
            <button type="button" role="tab" aria-selected="false" disabled title="AI tools are coming later">AI</button>
          </div>

          <div className="workspace-v2-side-content">
            {sideTab === "notes" && <section className="workspace-v2-note-list" aria-label="Session notes">
              {focusPayload?.note?.body && <article><header><strong>Page {page}</strong><span>Saved</span></header><p>{focusPayload.note.body}</p><div><span>{material.title}</span><span>Session note</span></div></article>}
              <label className="workspace-v2-note-editor"><span>{focusPayload ? "Session note" : "Start Focus to save a note"}</span><textarea ref={noteRef} value={noteDraft} onChange={(event) => setNoteDraft(event.target.value)} maxLength="10000" placeholder="Write a note for this study session…" /><button type="button" onClick={saveNote} disabled={!focusPayload || noteBusy || noteDraft === (focusPayload?.note?.body || "")}>{noteBusy ? "Saving…" : "Save note"}</button></label>
            </section>}
            {sideTab === "highlights" && <section className="workspace-v2-highlight-list" aria-label="Document highlights">{highlights.length ? highlights.map((highlight, index) => <article key={highlight.id}><strong>Page {page}</strong><p>Highlight {index + 1}</p><span style={{ backgroundColor: highlight.color }} /></article>) : <p className="workspace-v2-empty-panel">Choose the Highlight tool and drag across the sheet to add your first highlight.</p>}</section>}
          </div>

          <section className="workspace-v2-quick-actions" aria-labelledby="workspace-quick-actions">
            <h2 id="workspace-quick-actions">Quick Actions</h2>
            <p id="workspace-quick-actions-status">Temporarily unavailable</p>
            <button type="button" disabled aria-describedby="workspace-quick-actions-status"><Sparkles size={17} />Generate Summary</button>
            <button type="button" disabled aria-describedby="workspace-quick-actions-status"><Copy size={17} />Create Flashcards</button>
            <button type="button" disabled aria-describedby="workspace-quick-actions-status"><CircleHelp size={17} />Generate Practice Questions</button>
            <button type="button" disabled aria-describedby="workspace-quick-actions-status"><Zap size={17} fill="currentColor" />Add to Lock In Session</button>
          </section>

          <section className="workspace-v2-progress" aria-label="Document progress">
            <header><span>Document Progress</span><strong>{progress}%</strong></header>
            <div className="workspace-v2-progress-line"><span style={{ width: `${progress}%` }} /></div>
            <dl><div><dt>Read</dt><dd>{page} pages</dd></div><div><dt>Highlights</dt><dd>{highlighterCount}</dd></div><div><dt>Notes</dt><dd>{focusPayload?.note?.body ? 1 : 0}</dd></div></dl>
          </section>
          {focusMessage && <p className="workspace-v2-status" role="status">{focusMessage}</p>}
        </aside>
      </div>
      <button ref={sideTriggerRef} className={`workspace-v2-mobile-panel${sideOpen ? " is-hidden" : ""}`} type="button" onClick={() => setSideOpen(true)} aria-label="Open notes and workspace actions"><PanelRightOpen size={20} /><span>Notes</span></button>
    </main>
  );
}
