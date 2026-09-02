import { memo, startTransition, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowRight,
  ArrowLeft,
  BookOpen,
  Bookmark,
  Brain,
  Brush,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  Copy,
  Eraser,
  Eye,
  Feather,
  Hash,
  Hand,
  Highlighter,
  Image as ImageIcon,
  MessageSquare,
  MoveHorizontal,
  Maximize2,
  Minimize2,
  Minus,
  MousePointer2,
  Pencil,
  PenLine,
  Plus,
  Redo2,
  RotateCcw,
  RotateCw,
  Scissors,
  Settings,
  Shapes,
  Square,
  RectangleHorizontal,
  Triangle,
  Trash2,
  Sparkles,
  Star,
  Undo2,
  X,
  Zap,
  ZoomIn,
  Power,
  Trophy,
  ClipboardPaste,
  Download,
  Upload
} from "lucide-react";
import { focusApi } from "../api/focus.js";
import { progressApi } from "../api/progress.js";
import { generateIdempotencyKey } from "../api/pagination.js";
import { getCatalogSheet, rememberLastOpenedCatalogSheet } from "../lib/materialCatalog.js";
import { cssVars } from "../lib/utils.js";
import { subscribeViewport } from "../lib/viewport.js";
import { usePageTitle } from "../hooks/usePageTitle.js";
import {
  continuousPinchScale,
  constrainPinchTranslation,
  documentAnchorFromClient,
  fitWidthZoom,
  livePinchTransform,
  midpoint,
  pagePointFromClient,
  pointerDistance,
  scrollForDocumentAnchor,
  visibleDocumentScrollBounds,
  zoomScrollForAnchor
} from "../workspace/document/coordinateTransforms.js";
import {
  addSpringImpulse,
  advanceSpring,
  elasticScrollPosition,
  elasticZoomScale,
  resistedDistance,
  unresistedDistance
} from "../workspace/input/elasticGesture.js";
import {
  DRAWING_INPUT,
  GESTURE_DIRECTION,
  INTERACTION_STATE,
  classifyGestureDirection,
  interactionStateForDirection,
  isTypingTarget,
  lockedGestureDelta,
  lockedGestureVelocity,
  pointerCanDraw,
  pointerSnapshot,
  suspiciousPalmContact
} from "../workspace/input/gestureStateMachine.js";
import {
  advanceMomentumFrame,
  appendRecentPointerSamples,
  estimateReleaseScrollVelocity,
  momentumConfig,
  momentumVelocityForIntent
} from "../workspace/input/scrollMomentum.js";
import {
  ERASER_MODE,
  PEN_PROFILE,
  pageRadiusForScreenRadius,
  samplesFromPointerEvent,
  strokeEraseCoverage,
  strokeRenderGeometry
} from "../workspace/ink/strokeModel.js";
import { createInkInputController } from "../workspace/ink/inkInputController.js";
import { createEraserSession } from "../workspace/ink/eraserSession.js";
import {
  analyzeClosedGesture,
  analyzeScribbleGesture,
  gestureBounds,
  recognizeHeldStroke,
  recognizedShapeAnnotation,
  rectangleLassoPolygon
} from "../workspace/ink/inkGestureRecognition.js";
import {
  annotationBounds,
  annotationIntersectsPolygon,
  applyAnnotationCommand,
  catalogWorkspaceStorageKey,
  createAnnotationSpatialIndex,
  parseCatalogWorkspace,
  queryAnnotationSpatialIndexBounds,
  resizeAnnotation,
  rotateAnnotation,
  selectionBounds,
  serializeCatalogWorkspace,
  translateAnnotation
} from "../workspace/catalog/catalogWorkspaceState.js";
import { A4_PAGE_WIDTH, ContinuousA4Pdf } from "../workspace/catalog/ContinuousA4Pdf.jsx";
import { LiveAnnotationCanvas } from "../workspace/ink/LiveAnnotationCanvas.jsx";
import { createWorkspacePerformanceMonitor } from "../workspace/catalog/workspacePerformance.js";
import { addSavedColor, normalizeSavedPalette, normalizeToolColor, removeSavedColor } from "../workspace/catalog/toolPalette.js";
import { WORKSPACE_GESTURE, WORKSPACE_ZOOM } from "../workspace/config.js";
import { createAnnotationStore } from "../workspace/storage/annotationStore.js";
import {
  buildExportPayload,
  changedPages,
  createAnnotationRevisionIndex,
  exportFileName,
  groupAnnotationsByPage,
  mergeRestoredAnnotations,
  mergeRestoredNotes,
  ownerStorageKey,
  pageSignatures,
  parseImportPayload
} from "../workspace/storage/workspaceSnapshot.js";
import "./catalog-focus-workspace.css";

const PAGE_COUNT = 342;
const PAGE_WIDTH = 690;
const PAGE_SPACE = 1000;
const MIN_FOCUS_ZOOM = WORKSPACE_ZOOM.minimum;
const MAX_FOCUS_ZOOM = WORKSPACE_ZOOM.catalogMaximum;
const AUTOSAVE_IDLE_MS = 750;
const COLORS = ["#8b5cf6", "#f2b728", "#20b982", "#e65791", "#239ed1"];
const HOLD_RECOGNITION_MS = 420;
const HOLD_ENDPOINT_TOLERANCE_PX = 6;
const TOOL_MEMORY_KEY = "lock-in.catalog-workspace.tool-memory.v2";
const RECENT_COLORS_KEY = "lock-in.catalog-workspace.recent-colors.v1";
const WORKSPACE_SETTINGS_KEY = "lock-in.catalog-workspace.settings.v1";
const MAX_PALETTE_COLORS = 10;
const ZOOM_OVERSHOOT_RATIO = .22;
const NO_ANNOTATIONS = Object.freeze([]);
const ZOOM_SETTLE_MS = 220;
const SPRING_DEADLINE_MS = 900;
const STATUS_MESSAGE_MS = 6_000;

/** @type {Array<[string, string, import("lucide-react").LucideIcon]>} */
const TOOL_ITEMS = [
  ["hand", "Pan", Hand],
  ["pen", "Pen", PenLine],
  ["pencil", "Pencil", Pencil],
  ["highlighter", "Highlight", Highlighter],
  ["eraser", "Eraser", Eraser],
  ["select", "Lasso", MousePointer2],
  ["shapes", "Shape", Shapes],
  ["image", "Image", ImageIcon],
  ["note", "Notes", MessageSquare]
];

const DRAWING_TOOLS = new Set(["pen", "pencil", "highlighter", "eraser", "shapes", "select"]);
const CONFIGURABLE_TOOLS = new Set(["pen", "pencil", "highlighter", "eraser", "select", "shapes"]);
const PEN_PROFILE_OPTIONS = [
  [PEN_PROFILE.BALL, "Ball Pen", PenLine],
  [PEN_PROFILE.FOUNTAIN, "Fountain Pen", Feather],
  [PEN_PROFILE.BRUSH, "Brush Pen", Brush]
];
const ERASER_MODE_OPTIONS = [
  [ERASER_MODE.PRECISION, "Precision Eraser", Eraser],
  [ERASER_MODE.SEGMENT, "Segment Eraser", Scissors],
  [ERASER_MODE.STROKE, "Stroke Eraser", Trash2]
];
const SHAPE_OPTIONS = [
  ["line", "Line", Minus],
  ["arrow", "Arrow", ArrowRight],
  ["rectangle", "Rectangle", RectangleHorizontal],
  ["square", "Square", Square],
  ["ellipse", "Ellipse", Circle],
  ["circle", "Circle", Circle],
  ["triangle", "Triangle", Triangle]
];
const LASSO_MODE_OPTIONS = [
  ["freeform", "Freeform lasso", MousePointer2],
  ["rectangle", "Rectangle lasso", Square]
];

const SUBJECT_COPY = {
  conservative: ["Adhesive Dentistry", "Preserving sound tooth structure is the central principle of conservative treatment."],
  microbiology: ["Bacterial Cell Structure", "Microbial structure determines how organisms grow, spread, and respond to treatment."],
  pharmacy: ["Drug Absorption", "Absorption controls how quickly and how much of a medicine reaches systemic circulation."],
  "general-pathology": ["Acute Inflammation", "Acute inflammation is an early protective response to tissue injury and infection."],
  "oral-histology": ["Enamel Structure", "Enamel is a highly mineralized tissue organized to withstand functional dental forces."],
  "fixed-prosthodontic": ["Crown Preparation", "A successful preparation balances retention, resistance, and preservation of tooth structure."],
  "removeable-prosthodontic": ["Denture Support", "Support distributes functional forces across the available oral tissues."]
};

const STAGE_CONTROL_SELECTOR = "button, a[href], input, select, textarea, [role='button'], [role='switch'], [role='radio'], [role='tab']";

function isUnfinished(payload) {
  return ["active", "paused", "on_break"].includes(payload?.session?.status);
}

/** Controls painted over the document still need their normal activation. */
function isStageControl(target) {
  return Boolean(target?.closest?.(STAGE_CONTROL_SELECTOR));
}

function WorkspaceIconButton({ label, active = false, children, className = "", ...props }) {
  return <button className={`workspace-v2-icon-button${active ? " is-active" : ""}${className ? ` ${className}` : ""}`} type="button" aria-label={label} title={label} {...props}>{children}</button>;
}

function ToolRange({ label, value, displayValue = value, min, max, step, onChange, preview = "stroke", color = "#8b5cf6" }) {
  const ratio = Math.min(1, Math.max(0, (value - min) / Math.max(step, max - min)));
  const previewSize = preview === "opacity" ? 16 : preview === "eraser" ? Math.round(5 + ratio * 13) : Math.round(2 + ratio * 10);
  return (
    <label className={`workspace-v2-tool-range is-${preview}`} aria-label={label} style={cssVars({ "--workspace-range-progress": `${ratio * 100}%` })}>
      <span className="workspace-v2-range-heading"><span>{label}</span><output aria-label={`Current ${label.toLowerCase()}`}>{displayValue}</output></span>
      <span className="workspace-v2-range-control">
        <span className="workspace-v2-range-preview" aria-hidden="true" style={cssVars({ "--workspace-range-size": `${previewSize}px`, "--workspace-range-color": color, "--workspace-range-opacity": preview === "opacity" ? value : 1 })} />
        <input type="range" min={min} max={max} step={step} value={value} aria-label={label} onChange={(event) => onChange(Number(event.target.value))} />
      </span>
    </label>
  );
}

function IconChoiceGroup({ label, value, options, onChange }) {
  return <div className="workspace-v2-icon-choices" role="group" aria-label={label}>
    {options.map(([optionValue, optionLabel, OptionIcon]) => <button
      key={optionValue}
      type="button"
      className={value === optionValue ? "is-active" : ""}
      aria-label={optionLabel}
      title={optionLabel}
      aria-pressed={value === optionValue}
      onClick={() => onChange(optionValue)}
    ><OptionIcon size={17} /></button>)}
  </div>;
}

function SettingsToggle({ icon: ToggleIcon, label, description, checked, onChange }) {
  return <button type="button" className="workspace-v2-settings-toggle" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}>
    <ToggleIcon size={17} aria-hidden="true" />
    <span><strong>{label}</strong><small>{description}</small></span>
    <span className="workspace-v2-switch-track" aria-hidden="true"><span /></span>
  </button>;
}

const WorkspaceAnnotation = memo(
/** @param {{ annotation: any, draft?: boolean, interactionOnly?: boolean }} props */
function WorkspaceAnnotation({ annotation, draft = false, interactionOnly = false }) {
  const common = { "data-annotation-id": annotation.id, "data-annotation-type": annotation.type };
  if (["pen", "pencil", "highlighter"].includes(annotation.type)) {
    const geometry = strokeRenderGeometry(annotation);
    if (interactionOnly && annotation.type === "pen") {
      if (geometry.kind === "dot") return <circle {...common} className="workspace-v2-annotation-hit" cx={geometry.x} cy={geometry.y} r={Math.max(geometry.radius, 8)} fill={annotation.color} opacity="0" />;
      return <path {...common} className="workspace-v2-annotation-hit" d={geometry.path} fill={geometry.kind === "outline" ? annotation.color : "none"} stroke={geometry.kind === "centerline" ? annotation.color : "none"} strokeWidth={Math.max(geometry.width || 0, 12)} opacity="0" />;
    }
    const opacity = draft ? Math.min(geometry.opacity, annotation.type === "pen" ? 1 : .68) : geometry.opacity;
    if (geometry.kind === "dot") return <circle {...common} cx={geometry.x} cy={geometry.y} r={geometry.radius} fill={annotation.color} opacity={opacity} />;
    if (geometry.kind === "centerline") return <path {...common} d={geometry.path} fill="none" stroke={annotation.color} strokeWidth={geometry.width} strokeLinecap="round" strokeLinejoin="round" opacity={opacity} />;
    if (geometry.kind === "outline") return <path {...common} d={geometry.path} fill={annotation.color} opacity={opacity} />;
    return null;
  }
  const commonWithOpacity = { ...common, "data-annotation-shape": annotation.type === "shape" ? annotation.shape : undefined, opacity: draft ? 0.68 : annotation.opacity ?? 1 };
  if (annotation.type === "shape") {
    const x = Math.min(annotation.start.x, annotation.end.x);
    const y = Math.min(annotation.start.y, annotation.end.y);
    const width = Math.abs(annotation.end.x - annotation.start.x);
    const height = Math.abs(annotation.end.y - annotation.start.y);
    if (["line", "arrow"].includes(annotation.shape)) {
      const dx = annotation.end.x - annotation.start.x;
      const dy = annotation.end.y - annotation.start.y;
      const length = Math.max(1, Math.hypot(dx, dy));
      const head = Math.min(34, Math.max(12, annotation.width * 5));
      const normalX = -dy / length;
      const normalY = dx / length;
      const baseX = annotation.end.x - (dx / length) * head;
      const baseY = annotation.end.y - (dy / length) * head;
      return <g {...commonWithOpacity} fill="none" stroke={annotation.color} strokeWidth={annotation.width} strokeLinecap="round" strokeLinejoin="round">
        <line x1={annotation.start.x} y1={annotation.start.y} x2={annotation.end.x} y2={annotation.end.y} />
        {annotation.shape === "arrow" && <polyline points={`${baseX + normalX * head * .45},${baseY + normalY * head * .45} ${annotation.end.x},${annotation.end.y} ${baseX - normalX * head * .45},${baseY - normalY * head * .45}`} />}
      </g>;
    }
    if (["circle", "ellipse"].includes(annotation.shape)) return <ellipse {...commonWithOpacity} cx={x + width / 2} cy={y + height / 2} rx={width / 2} ry={height / 2} fill="none" stroke={annotation.color} strokeWidth={annotation.width} />;
    if (annotation.shape === "triangle") return <polygon {...commonWithOpacity} points={`${x + width / 2},${y} ${x + width},${y + height} ${x},${y + height}`} fill="none" stroke={annotation.color} strokeWidth={annotation.width} strokeLinejoin="round" />;
    return <rect {...commonWithOpacity} x={x} y={y} width={width} height={height} rx="6" fill="none" stroke={annotation.color} strokeWidth={annotation.width} />;
  }
  if (annotation.type === "text") {
    const textAnchor = annotation.align === "center" ? "middle" : annotation.align === "right" ? "end" : "start";
    return <text {...commonWithOpacity} x={annotation.x} y={annotation.y} fill={annotation.color} fontSize={Math.max(18, annotation.width * 5)} fontFamily="system-ui, sans-serif" textAnchor={textAnchor}>{annotation.text}</text>;
  }
  if (annotation.type === "image") return <image {...commonWithOpacity} href={annotation.src} x={annotation.x} y={annotation.y} width={annotation.width} height={annotation.height} preserveAspectRatio="xMidYMid meet" />;
  return null;
});

const AnnotationVisuals = memo(
/** @param {{ annotations: any[], hiddenIds?: Set<string>, prefix?: string, includeHitTargets?: boolean }} props */
function AnnotationVisuals({ annotations, hiddenIds = new Set(), prefix = "annotation", includeHitTargets = false }) {
  return <>
    {(annotations || []).filter((annotation) => !hiddenIds.has(annotation.id)).map((annotation) => <WorkspaceAnnotation key={`${prefix}-${annotation.id}`} annotation={annotation} />)}
    {includeHitTargets && (annotations || []).filter((annotation) => annotation.type === "pen").map((annotation) => <WorkspaceAnnotation key={`${prefix}-hit-${annotation.id}`} annotation={annotation} interactionOnly />)}
  </>;
});

function loadStoredWorkspace(materialSlug, sheetSlug) {
  try {
    return parseCatalogWorkspace(window.localStorage.getItem(catalogWorkspaceStorageKey(materialSlug, sheetSlug)));
  } catch {
    return null;
  }
}

function loadToolMemory() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(TOOL_MEMORY_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function loadRecentColors() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(RECENT_COLORS_KEY) || "[]");
    return addSavedColor(parsed, null, MAX_PALETTE_COLORS, COLORS);
  } catch {
    return [];
  }
}

function loadWorkspaceSettings() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(WORKSPACE_SETTINGS_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function selectionContains(point, bounds) {
  return Boolean(bounds && point.x >= bounds.x && point.x <= bounds.x + bounds.width && point.y >= bounds.y && point.y <= bounds.y + bounds.height);
}

function cloneAnnotation(annotation) {
  return JSON.parse(JSON.stringify(annotation));
}

function useDialogFocus(onEscape = null) {
  const dialogRef = useRef(null);
  const escapeRef = useRef(onEscape);
  escapeRef.current = onEscape;
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    const previousFocus = document.activeElement;
    const backdrop = dialog.parentElement;
    const workspace = dialog.closest(".workspace-v2");
    const hiddenSiblings = [];
    workspace?.querySelectorAll(":scope > *").forEach((element) => {
      if (element === backdrop) return;
      const htmlElement = /** @type {HTMLElement} */ (element);
      hiddenSiblings.push({ element: htmlElement, ariaHidden: htmlElement.getAttribute("aria-hidden"), inert: htmlElement.inert });
      htmlElement.setAttribute("aria-hidden", "true");
      htmlElement.inert = true;
    });
    const focusableSelector = "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex='-1'])";
    const focusFirst = () => {
      const first = dialog.querySelector(focusableSelector);
      if (first instanceof HTMLElement) first.focus();
      else dialog.focus();
    };
    const frame = requestAnimationFrame(focusFirst);
    const handleKeyDown = (event) => {
      if (event.key === "Escape" && escapeRef.current) {
        event.preventDefault();
        escapeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...dialog.querySelectorAll(focusableSelector)].filter((element) => !element.hidden && element.getClientRects().length);
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    dialog.addEventListener("keydown", handleKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      dialog.removeEventListener("keydown", handleKeyDown);
      hiddenSiblings.forEach(({ element, ariaHidden, inert }) => {
        if (ariaHidden === null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", ariaHidden);
        element.inert = inert;
      });
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);
  return dialogRef;
}

const ACTIVE_DIFFICULTIES = [
  ["easy", "Easy", "3 choices · 100 XP"],
  ["medium", "Medium", "4 choices · 150 XP"],
  ["hard", "Hard", "5 choices · 200 XP"]
];

function StudyModeDialog({ difficulty, setDifficulty, activeAvailable, busy, error, onNormal, onActive }) {
  const dialogRef = useDialogFocus();
  return (
    <div className="workspace-v2-mode-backdrop">
      <section ref={dialogRef} className="workspace-v2-mode-dialog" role="dialog" aria-modal="true" aria-labelledby="study-mode-title" aria-describedby="study-mode-hint" tabIndex={-1}>
        <h1 id="study-mode-title">Choose study mode</h1>
        <p id="study-mode-hint" dir="auto">You can switch modes later.</p>
        <div className="workspace-v2-mode-grid">
          <button type="button" className="workspace-v2-mode-card" onClick={onNormal} disabled={busy}>
            <span className="workspace-v2-mode-icon"><BookOpen size={20} /></span>
            <span className="workspace-v2-mode-copy"><strong>Normal Study</strong><small>Read every page freely</small></span>
            <ChevronRight className="workspace-v2-mode-chevron" size={18} aria-hidden="true" />
          </button>
          <div className="workspace-v2-mode-card is-active-study">
            <div className="workspace-v2-mode-heading">
              <span className="workspace-v2-mode-icon"><Brain size={20} /></span>
              <span className="workspace-v2-mode-copy"><strong>Active Study</strong><small>3 pages, then a checkpoint</small></span>
            </div>
            <div className="workspace-v2-difficulty" role="radiogroup" aria-label="Active Study difficulty">
              {ACTIVE_DIFFICULTIES.map(([id, label, detail]) => <button key={id} type="button" role="radio" aria-label={`${label}: ${detail}`} title={detail} aria-checked={difficulty === id} className={difficulty === id ? "is-selected" : ""} onClick={() => setDifficulty(id)}>{label}</button>)}
            </div>
            <button type="button" className="workspace-v2-active-start" onClick={onActive} disabled={busy || !activeAvailable}>{busy ? "Starting…" : activeAvailable ? "Start Active" : "Published PDFs only"}<ChevronRight size={16} /></button>
          </div>
        </div>
        {error && <p className="workspace-v2-mode-error" role="alert">{error}</p>}
      </section>
    </div>
  );
}

function ActiveStudyQuiz({ quiz, answers, setAnswers, result, busy, onSubmit, onDismiss, onRetake, onContinue }) {
  const [index, setIndex] = useState(0);
  const dialogRef = useDialogFocus(onDismiss);
  const question = quiz.questions[index];
  const answered = Object.keys(answers).length;
  const isFinal = Boolean(quiz.run?.final_ready);
  if (result) {
    const passed = result.outcome === "passed";
    const advisory = result.outcome === "advisory";
    return <div className="workspace-v2-quiz-backdrop"><section ref={dialogRef} className={`workspace-v2-quiz-result is-${result.outcome}`} role="dialog" aria-modal="true" aria-labelledby="active-result-title" tabIndex={-1}>
      <span className="workspace-v2-result-icon">{passed ? <Trophy size={30} /> : advisory ? <Sparkles size={30} /> : <RotateCcw size={30} />}</span>
      <p>{isFinal ? "Final assessment" : "Checkpoint result"}</p>
      <h2 id="active-result-title">{result.score} / {result.total}</h2>
      <strong>{passed ? (isFinal ? "Sheet completed" : "Next pages unlocked") : advisory ? "You can continue, but a retake is recommended" : "Review these pages before trying again"}</strong>
      {result.xp_awarded > 0 && <span className="workspace-v2-xp-award">+{result.xp_awarded} XP</span>}
      <div className="workspace-v2-result-actions">
        {passed && <button type="button" className="is-primary" onClick={onDismiss}>{isFinal ? "Finish" : "Continue studying"}</button>}
        {advisory && <button type="button" className="is-primary" onClick={onContinue} disabled={busy}>Continue anyway</button>}
        {!passed && <button type="button" onClick={onRetake} disabled={busy}><RotateCcw size={16} />Retake test</button>}
        {!passed && <button type="button" onClick={onDismiss}>Return to pages</button>}
      </div>
    </section></div>;
  }
  return (
    <div className="workspace-v2-quiz-backdrop">
      <section ref={dialogRef} className="workspace-v2-quiz-dialog" role="dialog" aria-modal="true" aria-labelledby="active-question-title" tabIndex={-1}>
        <header><div><span>{isFinal ? "Final assessment" : `Pages ${Math.max(1, quiz.run.unlocked_pages - 2)}–${quiz.run.unlocked_pages}`}</span><strong>{answered} of {quiz.questions.length} answered</strong></div><button type="button" onClick={onDismiss} aria-label="Close test"><X size={19} /></button></header>
        <div className="workspace-v2-quiz-progress"><span style={{ width: `${((index + 1) / quiz.questions.length) * 100}%` }} /></div>
        <main>
          <span className="workspace-v2-question-number">Question {index + 1} of {quiz.questions.length} · Source page {question.page}</span>
          <h2 id="active-question-title">{question.prompt}</h2>
          <div className="workspace-v2-answer-list" role="radiogroup" aria-label={`Answers for question ${index + 1}`}>
            {question.options.map((option, optionIndex) => <button key={option.id} type="button" role="radio" aria-checked={answers[question.id] === option.id} className={answers[question.id] === option.id ? "is-selected" : ""} onClick={() => setAnswers((current) => ({ ...current, [question.id]: option.id }))}><span>{String.fromCharCode(65 + optionIndex)}</span>{option.text}{answers[question.id] === option.id && <CheckCircle2 size={18} />}</button>)}
          </div>
        </main>
        <footer>
          <button type="button" onClick={() => setIndex((value) => Math.max(0, value - 1))} disabled={index === 0}><ChevronLeft size={17} />Previous</button>
          {index < quiz.questions.length - 1 ? <button type="button" className="is-primary" onClick={() => setIndex((value) => value + 1)} disabled={!answers[question.id]}>Next<ChevronRight size={17} /></button> : <button type="button" className="is-primary" onClick={onSubmit} disabled={busy || answered !== quiz.questions.length}>{busy ? "Checking…" : "Submit test"}</button>}
        </footer>
      </section>
    </div>
  );
}

export default function CatalogFocusWorkspace({ user = null }) {
  const { materialSlug, sheetSlug } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const rootRef = useRef(null);
  const readerRef = useRef(null);
  const toolbarRef = useRef(null);
  const toolRailRef = useRef(null);
  const stageRef = useRef(null);
  const documentRef = useRef(null);
  const imageInputRef = useRef(null);
  const noteRef = useRef(null);
  const sideCloseRef = useRef(null);
  const annotationsRef = useRef([]);
  const performanceMonitorRef = useRef(createWorkspacePerformanceMonitor());
  const annotationSpatialIndexRef = useRef(null);
  const notesRef = useRef([]);
  const draftRef = useRef(null);
  const drawingScrollLockRef = useRef({ active: false, pointerId: null, left: 0, top: 0 });
  const liveStrokeCanvasRef = useRef(null);
  const inkInputControllerRef = useRef(null);
  const eraserSessionRef = useRef(null);
  const stylusHoverRef = useRef(null);
  const selectionClipboardRef = useRef([]);
  const toolMemoryRef = useRef(loadToolMemory());
  const activeToolRef = useRef("hand");
  const saveTimerRef = useRef(null);
  const saveIdleRef = useRef(null);
  const viewSaveTimerRef = useRef(null);
  const wakeLockRef = useRef(null);
  const transformRef = useRef(null);
  const previousToolRef = useRef("hand");
  const zoomRef = useRef(1);
  const pendingPinchCommitRef = useRef(null);
  const initialPageViewRef = useRef("");
  const wheelZoomEndTimerRef = useRef(null);
  const wheelHandlerRef = useRef(null);
  const cancelInteractionRef = useRef(null);
  const jumpToPageRef = useRef(null);
  const inkHandoffRef = useRef(null);
  const pageGeometryCacheRef = useRef({ page: null, bounds: null });
  const storageModeRef = useRef("indexeddb");
  const rememberLastPositionRef = useRef(true);
  const rememberZoomLevelRef = useRef(true);
  const persistWorkspaceRef = useRef(null);
  const openDocumentRef = useRef(null);
  const annotationStoreRef = useRef(null);
  const revisionIndexRef = useRef(null);
  const savedPageSignaturesRef = useRef(new Map());
  const hydratedRef = useRef(false);
  const backupInputRef = useRef(null);
  if (annotationStoreRef.current === null) annotationStoreRef.current = createAnnotationStore();
  if (revisionIndexRef.current === null) revisionIndexRef.current = createAnnotationRevisionIndex();
  const pageRef = useRef(1);
  const spacePanRef = useRef(false);
  if (inkInputControllerRef.current === null) inkInputControllerRef.current = createInkInputController();
  if (eraserSessionRef.current === null) eraserSessionRef.current = createEraserSession({ idFactory: generateIdempotencyKey });
  /** @type {import("react").MutableRefObject<any>} */
  const gestureRef = useRef({
    mode: INTERACTION_STATE.IDLE,
    touches: new Map(),
    penPointers: new Map(),
    rejectedTouches: new Set(),
    lastPenAt: 0,
    lastPenPosition: null,
    drawingPointerId: null,
    drawingPointerType: null,
    pan: null,
    momentum: null,
    momentumRafId: null,
    panRafId: null,
    springRafId: null,
    spring: null,
    liveStrokeRafId: null,
    transformRafId: null,
    scrollActivityActive: false,
    pinch: null,
    pinchSequence: 0,
    pinchRafId: null,
    zoomSettleRafId: null,
    zoomSettleComplete: null,
    lastTap: null,
    eraserPreviewRafId: null,
    hoverRafId: null,
    hoverPoint: null,
    predictedStrokePoints: [],
    holdTimerId: null,
    holdAnchorPoint: null,
    holdRawStroke: null,
    holdRecognition: null,
    smartSelectionActivated: false
  });

  const { material, sheet } = getCatalogSheet(materialSlug, sheetSlug);
  const inkDebugEnabled = import.meta.env.DEV && searchParams.get("inkDebug") === "1";

  useEffect(() => {
    rememberLastOpenedCatalogSheet(materialSlug, sheetSlug);
  }, [materialSlug, sheetSlug]);

  // Annotations now live in IndexedDB and load asynchronously, so nothing is
  // persisted until the stored document has been read back. Saving before
  // hydration would overwrite a real sheet with an empty one.
  const [restored, setRestored] = useState(null);
  const [pdfDocumentReady, setPdfDocumentReady] = useState(false);
  const ownerKey = useMemo(() => ownerStorageKey(user), [user]);
  const storedWorkspaceSettings = useMemo(loadWorkspaceSettings, []);
  const storedCircleErase = storedWorkspaceSettings.circleToErase ?? storedWorkspaceSettings.circleToLasso;
  const initialRememberLastPosition = storedWorkspaceSettings.rememberLastPosition !== false;
  const initialRememberZoomLevel = storedWorkspaceSettings.rememberZoomLevel !== false;
  const configuredPageCount = sheet?.pageCount || (sheet?.pdfUrl ? 1 : PAGE_COUNT);
  const bookmarkedPage = Number.parseInt(searchParams.get("page") || "", 10);
  const [pageCount, setPageCount] = useState(configuredPageCount);
  const [page, setPage] = useState(() => Math.min(configuredPageCount, bookmarkedPage > 0 ? bookmarkedPage : (sheet?.pdfUrl ? 1 : 52)));
  const [zoom, setZoom] = useState(() => {
    if (!sheet?.pdfUrl) return 1.3;
    const fitZoom = fitWidthZoom(window.innerWidth, A4_PAGE_WIDTH, window.innerWidth < 1200 ? 16 : 360);
    return Math.min(MAX_FOCUS_ZOOM, Math.max(MIN_FOCUS_ZOOM, fitZoom));
  });
  const [activeTool, setActiveTool] = useState("hand");
  const [activeColor, setActiveColor] = useState(COLORS[0]);
  const [bookmarked, setBookmarked] = useState(false);
  const [bookmarkBusy, setBookmarkBusy] = useState(false);
  const [sideTab, setSideTab] = useState("notes");
  const [openSurface, setOpenSurface] = useState(null);
  const [brushSize, setBrushSize] = useState(4);
  const [brushOpacity, setBrushOpacity] = useState(1);
  const [pencilOpacity, setPencilOpacity] = useState(.78);
  const [highlighterOpacity, setHighlighterOpacity] = useState(.34);
  const [penProfile, setPenProfile] = useState(() => String(PEN_PROFILE.BALL));
  const [pressureSensitivity, setPressureSensitivity] = useState(.55);
  const [strokeSmoothing, setStrokeSmoothing] = useState(.5);
  const [eraserMode, setEraserMode] = useState(() => String(ERASER_MODE.PRECISION));
  const [shapeStyle, setShapeStyle] = useState("rectangle");
  const [lassoMode, setLassoMode] = useState("freeform");
  const [scribbleToErase, setScribbleToErase] = useState(storedWorkspaceSettings.scribbleToErase !== false);
  const [drawAndHold, setDrawAndHold] = useState(storedWorkspaceSettings.drawAndHold !== false);
  const [circleToErase, setCircleToErase] = useState(storedCircleErase !== false);
  const [recentColors, setRecentColors] = useState(loadRecentColors);
  const [customColorDraft, setCustomColorDraft] = useState(COLORS[0]);
  const [customColorEditorOpen, setCustomColorEditorOpen] = useState(false);
  const [rememberLastPosition, setRememberLastPosition] = useState(initialRememberLastPosition);
  const [rememberZoomLevel, setRememberZoomLevel] = useState(initialRememberZoomLevel);
  const [showPageNumber, setShowPageNumber] = useState(storedWorkspaceSettings.showPageNumber !== false);
  const [keepScreenAwake, setKeepScreenAwake] = useState(storedWorkspaceSettings.keepScreenAwake === true);
  const [drawingInput, setDrawingInput] = useState(() => {
    try { return window.localStorage.getItem("lock-in.catalog-workspace.drawing-input") === DRAWING_INPUT.STYLUS_AND_FINGER ? DRAWING_INPUT.STYLUS_AND_FINGER : DRAWING_INPUT.STYLUS_ONLY; }
    catch { return DRAWING_INPUT.STYLUS_ONLY; }
  });
  const [annotations, setAnnotations] = useState([]);
  const [notes, setNotes] = useState([]);
  const [backupBusy, setBackupBusy] = useState(false);
  const [pendingImport, setPendingImport] = useState(null);
  const [draftAnnotation, setDraftAnnotation] = useState(null);
  const toolOptionsOpen = openSurface?.startsWith("tool:") ? openSurface.slice(5) : null;
  const sideOpen = openSurface === "notes";
  const settingsOpen = openSurface === "settings";
  const wakeLockSupported = typeof navigator !== "undefined" && "wakeLock" in navigator;

  const minimumPdfZoom = useCallback(() => {
    if (!sheet?.pdfUrl) return MIN_FOCUS_ZOOM;
    const stage = stageRef.current;
    return Math.min(MAX_FOCUS_ZOOM, Math.max(MIN_FOCUS_ZOOM, fitWidthZoom(
      stage?.clientWidth || window.innerWidth,
      A4_PAGE_WIDTH,
      0
    )));
  }, [sheet?.pdfUrl]);

  const clampReaderZoom = useCallback((value) => {
    const minimum = sheet?.pdfUrl ? minimumPdfZoom() : MIN_FOCUS_ZOOM;
    return Math.min(MAX_FOCUS_ZOOM, Math.max(minimum, Number.isFinite(Number(value)) ? Number(value) : 1));
  }, [minimumPdfZoom, sheet?.pdfUrl]);

  /**
   * A stored zoom is an absolute page scale, so replaying it on a device with a
   * different width would reproduce the old page width rather than the reading
   * size the student chose. Restore the magnification relative to fit-to-width
   * instead. Views saved before the basis was recorded reopen fitted.
   */
  const zoomFromStoredView = useCallback((view) => {
    const fitZoom = minimumPdfZoom();
    const storedZoom = Number(view?.zoom);
    if (!Number.isFinite(storedZoom)) return fitZoom;
    const storedBasis = Number(view?.zoomFitBasis);
    const magnification = Number.isFinite(storedBasis) && storedBasis > 0 ? storedZoom / storedBasis : 1;
    return clampReaderZoom(fitZoom * magnification);
  }, [clampReaderZoom, minimumPdfZoom]);
  const [undoHistory, setUndoHistory] = useState([]);
  const [redoHistory, setRedoHistory] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [isDocumentFullscreen, setIsDocumentFullscreen] = useState(false);
  const [saveState, setSaveState] = useState("idle");
  const [saveErrorReason, setSaveErrorReason] = useState("");
  const [pageJumpDraft, setPageJumpDraft] = useState("1");
  const [focusPayload, setFocusPayload] = useState(null);
  const [focusMessage, setFocusMessage] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [noteBusy, setNoteBusy] = useState(false);
  const [studyMode, setStudyMode] = useState(null);
  const [modeDialogOpen, setModeDialogOpen] = useState(true);
  const [activeDifficulty, setActiveDifficulty] = useState("medium");
  const [activeStudy, setActiveStudy] = useState(null);
  const [activeStudyBusy, setActiveStudyBusy] = useState(false);
  const [activeStudyError, setActiveStudyError] = useState("");
  const [activeQuiz, setActiveQuiz] = useState(null);
  const [activeAnswers, setActiveAnswers] = useState({});
  const [activeResult, setActiveResult] = useState(null);
  const viewPositionRef = useRef({ left: 0, top: 0, pageOffset: 0 });

  const [topicTitle, topicSummary] = SUBJECT_COPY[materialSlug] || [material?.title || "Study material", sheet?.summary || "Focused study workspace."];
  const sheetRoute = `/materials/catalog/${materialSlug}/sheets/${sheetSlug}`;
  const accessiblePageCount = activeStudy?.status === "active" ? Math.min(pageCount, activeStudy.unlocked_pages) : pageCount;
  const activeCheckpointReady = studyMode === "active" && activeStudy?.status === "active" && page >= activeStudy.unlocked_pages;
  const pageAnnotations = useMemo(() => annotations.filter((item) => item.page === page), [annotations, page]);
  const annotationsByPage = useMemo(() => {
    const groups = new Map();
    for (const annotation of annotations) {
      const items = groups.get(annotation.page) || [];
      items.push(annotation);
      groups.set(annotation.page, items);
    }
    return groups;
  }, [annotations]);
  const annotationSpatialIndex = useMemo(() => createAnnotationSpatialIndex(annotations), [annotations]);
  const selectedAnnotations = useMemo(() => pageAnnotations.filter((item) => selectedIds.includes(item.id)), [pageAnnotations, selectedIds]);
  const selectedBounds = useMemo(() => selectionBounds(selectedAnnotations), [selectedAnnotations]);
  const highlights = useMemo(() => annotations
    .filter((item) => item.type === "highlighter")
    .map((item, index) => ({ item, index, bounds: annotationBounds(item) }))
    .sort((first, second) => first.item.page - second.item.page || (first.bounds?.y || 0) - (second.bounds?.y || 0) || first.index - second.index)
    .map(({ item }) => item), [annotations]);
  const annotationLayerClass = `workspace-v2-annotation-layer${activeTool !== "hand" ? " is-interactive" : ""}${DRAWING_TOOLS.has(activeTool) ? " is-touch-drawing" : ""}`;
  const sortedNotes = useMemo(() => [...notes].sort((first, second) => first.page - second.page || first.createdAt.localeCompare(second.createdAt)), [notes]);

  usePageTitle(sheet ? `${sheet.title} · Workspace` : "Focus Workspace");

  const updateAnnotations = useCallback((updater) => {
    setAnnotations((current) => {
      const next = typeof updater === "function" ? updater(current) : updater;
      annotationsRef.current = next;
      return next;
    });
  }, []);

  useEffect(() => {
    annotationsRef.current = annotations;
    performanceMonitorRef.current.annotationSnapshot(annotations);
  }, [annotations]);
  useEffect(() => {
    if ([INTERACTION_STATE.DRAWING, INTERACTION_STATE.ERASING, INTERACTION_STATE.SELECTING].includes(gestureRef.current.mode)) {
      performanceMonitorRef.current.increment("reactRendersDuringGesture");
    }
  });
  // Safe-area insets and the coarse-pointer control sizes both change the
  // toolbar height, so the surfaces that hang below it cannot assume a fixed
  // value. Publish the measured height instead of guessing it in the
  // stylesheet.
  useEffect(() => {
    const toolbar = toolbarRef.current;
    const root = rootRef.current;
    if (!toolbar || !root) return undefined;
    const publish = () => {
      const height = Math.round(toolbar.getBoundingClientRect().height);
      if (height > 0) root.style.setProperty("--workspace-toolbar-height", `${height}px`);
    };
    publish();
    const observer = new window.ResizeObserver(publish);
    observer.observe(toolbar);
    window.addEventListener("resize", publish, { passive: true });
    window.addEventListener("orientationchange", publish);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", publish);
      window.removeEventListener("orientationchange", publish);
    };
  }, []);
  // The tool rail never wraps, so on a phone part of it is always off screen.
  // Publish how much track is hidden on each physical side and the stylesheet
  // fades that edge - the only honest way to say "there is more this way"
  // without a scrollbar. Measuring in physical pixels keeps it correct in
  // Arabic, where a scroller counts its offset backwards.
  useEffect(() => {
    const rail = toolRailRef.current;
    if (!rail) return undefined;
    const publish = () => {
      const hidden = Math.max(0, rail.scrollWidth - rail.clientWidth);
      const rtl = window.getComputedStyle(rail).direction === "rtl";
      const left = Math.min(hidden, Math.max(0, rtl ? hidden + rail.scrollLeft : rail.scrollLeft));
      rail.style.setProperty("--workspace-fade-left", `${Math.min(18, left)}px`);
      rail.style.setProperty("--workspace-fade-right", `${Math.min(18, hidden - left)}px`);
    };
    publish();
    rail.addEventListener("scroll", publish, { passive: true });
    const observer = new window.ResizeObserver(publish);
    observer.observe(rail);
    for (const child of rail.children) observer.observe(child);
    return () => {
      rail.removeEventListener("scroll", publish);
      observer.disconnect();
    };
  }, []);
  // Choosing a tool with the keyboard, or restoring the last one on open, can
  // land on a button parked outside the visible track. Bring it back rather
  // than leaving the workspace claiming a tool the student cannot see.
  useEffect(() => {
    const rail = toolRailRef.current;
    const button = rail?.querySelector(`[data-workspace-tool="${activeTool}"]`);
    if (!rail || !button) return;
    const track = rail.getBoundingClientRect();
    const target = button.getBoundingClientRect();
    const margin = 8;
    const delta = target.left < track.left + margin
      ? target.left - track.left - margin
      : target.right > track.right - margin ? target.right - track.right + margin : 0;
    if (!delta) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    rail.scrollBy({ left: delta, behavior: still ? "auto" : "smooth" });
  }, [activeTool]);
  /**
   * Keyboard-aware layout for the note editor.
   *
   * The reader's frame is the PDF's coordinate space: every pan offset and the
   * fit-to-width zoom basis are measured from it. A virtual keyboard that
   * shortens that frame therefore re-lays-out the document under the student's
   * finger and moves the page they were reading. Whether the keyboard shortens
   * it is a per-browser decision - an iOS Safari tab resizes only the visual
   * viewport, an installed iOS app and some Android configurations resize the
   * layout viewport and with it `dvh` - so the frame is pinned to its
   * keyboard-free height for the duration of the keyboard session rather than
   * trusting any one of those behaviours.
   *
   * What the keyboard does move is the notes drawer, which rides above it on
   * the published inset. The document itself never scrolls in this view, so if
   * a browser scrolls the root to reveal the field, that invariant is restored:
   * the field is already visible inside the lifted drawer.
   *
   * Whether the keyboard is up, and how much it covers, is measured once for
   * the whole application by the viewport sync layer. What is local to the
   * workspace is what that answer means here: pinning the reader's frame.
   */
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    let restingHeight = 0;
    let wasOpen = false;
    // The drawer is capped above the keyboard, so bringing the field into view
    // is a scroll of the drawer's own list - never of the document or the PDF.
    const revealFocusedNoteField = () => {
      const field = document.activeElement;
      const scroller = field?.closest?.(".workspace-v2-side-content");
      if (!scroller) return;
      const track = scroller.getBoundingClientRect();
      const target = field.getBoundingClientRect();
      const overflow = target.bottom - track.bottom + 12;
      if (overflow > 0) scroller.scrollTop += overflow;
    };
    // The frame the reader is restored to has to be the current one: a rotation
    // or a collapsing browser toolbar changes it while nobody is typing. It is
    // therefore tracked from the frame itself, and only while it is free to
    // follow the viewport.
    const recordRestingHeight = () => {
      if (wasOpen) return;
      restingHeight = Math.round(root.getBoundingClientRect().height);
    };
    const frameObserver = typeof window.ResizeObserver === "function" ? new window.ResizeObserver(recordRestingHeight) : null;
    frameObserver?.observe(root);
    const unsubscribe = subscribeViewport(({ keyboardOpen, keyboardInset }) => {
      if (keyboardOpen) {
        root.style.setProperty("--workspace-keyboard-inset", `${keyboardInset}px`);
        if (restingHeight) root.style.height = `${restingHeight}px`;
        root.dataset.keyboard = "open";
        const scroller = document.scrollingElement;
        if (scroller && scroller.scrollTop !== 0) scroller.scrollTop = 0;
        if (!wasOpen) revealFocusedNoteField();
      } else {
        // Recorded only while the keyboard is down, so the frame the reader is
        // restored to is always the one it had before typing started.
        root.style.removeProperty("height");
        wasOpen = false;
        recordRestingHeight();
        root.style.removeProperty("--workspace-keyboard-inset");
        delete root.dataset.keyboard;
      }
      wasOpen = keyboardOpen;
    });
    return () => {
      unsubscribe();
      frameObserver?.disconnect();
      root.style.removeProperty("--workspace-keyboard-inset");
      root.style.removeProperty("height");
      delete root.dataset.keyboard;
    };
  }, []);
  useEffect(() => { annotationSpatialIndexRef.current = annotationSpatialIndex; }, [annotationSpatialIndex]);
  useEffect(() => { notesRef.current = notes; }, [notes]);
  useEffect(() => { activeToolRef.current = activeTool; }, [activeTool]);
  useEffect(() => { rememberLastPositionRef.current = rememberLastPosition; }, [rememberLastPosition]);
  useEffect(() => { rememberZoomLevelRef.current = rememberZoomLevel; }, [rememberZoomLevel]);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => {
    pageRef.current = page;
    // Scrolling changes the current page continuously. Rewriting the field
    // while the navigator is open would erase what the reader is typing.
    if (openSurface !== "pages") setPageJumpDraft(String(page));
  }, [openSurface, page]);
  useEffect(() => {
    try { window.localStorage.setItem(RECENT_COLORS_KEY, JSON.stringify(recentColors)); } catch { /* Recent colors are an optional local preference. */ }
  }, [recentColors]);
  useEffect(() => {
    if (!["pen", "pencil", "highlighter", "eraser", "shapes"].includes(activeTool)) return;
    const key = activeTool === "pen" ? `pen:${penProfile}` : activeTool;
    toolMemoryRef.current[key] = {
      color: activeColor,
      size: brushSize,
      opacity: activeTool === "highlighter" ? highlighterOpacity : activeTool === "pencil" ? pencilOpacity : brushOpacity,
      pressureSensitivity,
      smoothing: strokeSmoothing,
      eraserMode,
      shapeStyle
    };
    if (activeTool === "pen") toolMemoryRef.current.lastPenProfile = penProfile;
    try { window.localStorage.setItem(TOOL_MEMORY_KEY, JSON.stringify(toolMemoryRef.current)); } catch { /* Tool memory is a best-effort local preference. */ }
  }, [activeColor, activeTool, brushOpacity, brushSize, eraserMode, highlighterOpacity, penProfile, pencilOpacity, pressureSensitivity, shapeStyle, strokeSmoothing]);
  useEffect(() => {
    try { window.localStorage.setItem(WORKSPACE_SETTINGS_KEY, JSON.stringify({ scribbleToErase, drawAndHold, circleToErase, rememberLastPosition, rememberZoomLevel, showPageNumber, keepScreenAwake })); } catch { /* Workspace preferences remain available in memory. */ }
  }, [circleToErase, drawAndHold, keepScreenAwake, rememberLastPosition, rememberZoomLevel, scribbleToErase, showPageNumber]);
  useEffect(() => () => {
    const gesture = gestureRef.current;
    if (gesture.pinchRafId !== null) cancelAnimationFrame(gesture.pinchRafId);
    if (gesture.momentumRafId !== null) cancelAnimationFrame(gesture.momentumRafId);
    if (gesture.panRafId !== null) cancelAnimationFrame(gesture.panRafId);
    if (gesture.springRafId !== null) cancelAnimationFrame(gesture.springRafId);
    if (gesture.liveStrokeRafId !== null) cancelAnimationFrame(gesture.liveStrokeRafId);
    if (gesture.transformRafId !== null) cancelAnimationFrame(gesture.transformRafId);
    if (gesture.eraserPreviewRafId !== null) cancelAnimationFrame(gesture.eraserPreviewRafId);
    if (gesture.hoverRafId !== null) cancelAnimationFrame(gesture.hoverRafId);
    if (gesture.zoomSettleRafId !== null) cancelAnimationFrame(gesture.zoomSettleRafId);
    if (gesture.holdTimerId !== null) window.clearTimeout(gesture.holdTimerId);
    if (wheelZoomEndTimerRef.current) window.clearTimeout(wheelZoomEndTimerRef.current);
    if (viewSaveTimerRef.current) window.clearTimeout(viewSaveTimerRef.current);
    if (saveIdleRef.current !== null && window.cancelIdleCallback) window.cancelIdleCallback(saveIdleRef.current);
    wakeLockRef.current?.release?.().catch(() => {});
  }, []);
  useEffect(() => {
    const resetInterruptedInteraction = (event) => {
      if (event.type === "visibilitychange" && !document.hidden) return;
      // Leaving the window swallows the Space keyup, so the hold-to-pan
      // modifier has to release itself rather than stranding the Pan tool.
      if (spacePanRef.current) {
        spacePanRef.current = false;
        setActiveTool(previousToolRef.current);
      }
      cancelInteractionRef.current?.({ pointerId: null, pointerType: "system", type: event.type });
    };
    window.addEventListener("blur", resetInterruptedInteraction);
    window.addEventListener("orientationchange", resetInterruptedInteraction);
    window.addEventListener("pagehide", resetInterruptedInteraction);
    document.addEventListener("visibilitychange", resetInterruptedInteraction);
    return () => {
      window.removeEventListener("blur", resetInterruptedInteraction);
      window.removeEventListener("orientationchange", resetInterruptedInteraction);
      window.removeEventListener("pagehide", resetInterruptedInteraction);
      document.removeEventListener("visibilitychange", resetInterruptedInteraction);
    };
  }, []);
  useEffect(() => {
    if (!openSurface || openSurface === "notes") return undefined;
    const dismissPopover = (event) => {
      if (event.target.closest?.(".workspace-v2-toolbar, .workspace-v2-tool-options, .workspace-v2-settings-popover, .workspace-v2-page-dock")) return;
      setOpenSurface(null);
    };
    // The tool options carry no close button: the tool that opened them is the
    // toggle. Escape is the other half of that contract for a keyboard, and it
    // hands focus back to the control that owns the panel.
    const dismissOnEscape = (event) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      const owner = openSurface.startsWith("tool:")
        ? `[data-workspace-tool="${openSurface.slice(5)}"]`
        : openSurface === "pages"
          ? ".workspace-v2-page-number"
          : '[aria-controls="workspace-settings-popover"]';
      setOpenSurface(null);
      rootRef.current?.querySelector(owner)?.focus();
    };
    document.addEventListener("pointerdown", dismissPopover);
    document.addEventListener("keydown", dismissOnEscape);
    return () => {
      document.removeEventListener("pointerdown", dismissPopover);
      document.removeEventListener("keydown", dismissOnEscape);
    };
  }, [openSurface]);
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    const handleNativeWheel = (event) => wheelHandlerRef.current?.(event);
    // The document owns touch navigation. Safari must never promote the first
    // contact to native scrolling because that cancels the pointer stream when
    // the second finger arrives and fragments one pinch into many sessions.
    function preserveWorkspaceTouch(event) {
      // Cancelling touchstart also cancels the compatibility click, so toolbars
      // and buttons rendered inside the document opt out. touchmove stays
      // cancelled for every target: a drag that begins on a control must not
      // hand the gesture back to native scrolling half way through.
      if (event.type === "touchstart" && isStageControl(event.target)) return;
      event.preventDefault();
    }
    function resetEndedTouchSession(event) {
      if (event.touches?.length) return;
      const gesture = gestureRef.current;
      const activeTouchSession = gesture.pan
        || gesture.pinch?.active
        || (gesture.drawingPointerId !== null && gesture.drawingPointerType === "touch");
      if (activeTouchSession) {
        cancelInteractionRef.current?.({ pointerId: null, pointerType: "touch", type: event.type });
        return;
      }
      gesture.touches.clear();
      gesture.rejectedTouches.clear();
    }
    function preserveDrawingPosition() {
      const lock = drawingScrollLockRef.current;
      if (!lock.active) return;
      if (stage.scrollLeft !== lock.left) stage.scrollLeft = lock.left;
      if (stage.scrollTop !== lock.top) stage.scrollTop = lock.top;
    }
    stage.addEventListener("wheel", handleNativeWheel, { passive: false });
    stage.addEventListener("touchstart", preserveWorkspaceTouch, { passive: false });
    stage.addEventListener("touchmove", preserveWorkspaceTouch, { passive: false });
    stage.addEventListener("touchend", resetEndedTouchSession, { passive: true });
    stage.addEventListener("touchcancel", resetEndedTouchSession, { passive: true });
    stage.addEventListener("scroll", preserveDrawingPosition, { passive: true });
    return () => {
      stage.removeEventListener("wheel", handleNativeWheel);
      stage.removeEventListener("touchstart", preserveWorkspaceTouch);
      stage.removeEventListener("touchmove", preserveWorkspaceTouch);
      stage.removeEventListener("touchend", resetEndedTouchSession);
      stage.removeEventListener("touchcancel", resetEndedTouchSession);
      stage.removeEventListener("scroll", preserveDrawingPosition);
    };
  }, []);
  useLayoutEffect(() => {
    const pending = pendingPinchCommitRef.current;
    const root = documentRef.current;
    const stage = stageRef.current;
    if (!pending || !root || !stage || Math.abs(pending.finalZoom - zoom) > .001) return;
    root.style.transform = "";
    const documentElement = root.querySelector(".workspace-v2-a4-document") || root;
    const documentBounds = documentElement.getBoundingClientRect();
    if (documentBounds.width > 0 && documentBounds.height > 0) {
      const next = scrollForDocumentAnchor({
        // React's final zoom geometry may already have forced the browser to
        // clamp scrollTop (especially near the last page while zooming out).
        // Reconcile from that actual post-layout position, never the stale
        // gesture-start scroll position.
        currentScrollLeft: stage.scrollLeft,
        currentScrollTop: stage.scrollTop,
        documentLeft: documentBounds.left,
        documentTop: documentBounds.top,
        documentAnchorX: pending.documentAnchorX,
        documentAnchorY: pending.documentAnchorY,
        scale: zoom,
        focalClientX: pending.currentFocalX,
        focalClientY: pending.currentFocalY
      });
      const bounds = readerScrollBounds({ preserveCurrent: false });
      stage.scrollLeft = Math.min(bounds.maxScrollLeft, Math.max(bounds.minScrollLeft, next.scrollLeft));
      if (pending.constrainToBounds) {
        stage.scrollTop = Math.min(bounds.maxScrollTop, Math.max(bounds.minScrollTop, next.scrollTop));
      } else {
        stage.scrollTop = next.scrollTop;
      }
    }
    pendingPinchCommitRef.current = null;
    root.classList.remove("is-live-pinching", "is-zoom-settling");
    root.dispatchEvent(new window.CustomEvent("workspace:livezoomcommit", { detail: { zoom, pinchId: pending.pinchId } }));
    const gesture = gestureRef.current;
    const springStarted = startPanSpringBack(pending.elasticX, pending.constrainToBounds ? pending.elasticY : 0);
    if (!springStarted && gesture.mode === INTERACTION_STATE.SETTLING && gesture.touches.size === 0) gesture.mode = INTERACTION_STATE.IDLE;
    root.dispatchEvent(new window.CustomEvent("workspace:zoomgeometrysettled", { detail: { zoom, pinchId: pending.pinchId } }));
  // The commit must run exactly once for the newly mounted zoom geometry;
  // gesture helpers intentionally read the latest mutable refs in that frame.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom]);
  useEffect(() => {
    setPageCount(configuredPageCount);
    setPage((current) => Math.min(configuredPageCount, Math.max(1, current)));
  }, [configuredPageCount, materialSlug, sheetSlug]);

  useEffect(() => {
    if (!sheet?.pdfUrl || !stageRef.current) return undefined;
    const stage = stageRef.current;
    const keepPdfFitted = () => {
      const minimum = minimumPdfZoom();
      if (zoomRef.current >= minimum) return;
      zoomRef.current = minimum;
      setZoom(minimum);
    };
    keepPdfFitted();
    const observer = new window.ResizeObserver(keepPdfFitted);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [materialSlug, minimumPdfZoom, sheet?.pdfUrl, sheetSlug]);

  const resetInitialPdfPosition = useCallback(() => {
    const viewKey = `${materialSlug}/${sheetSlug}`;
    // Positioning has to wait for the stored view, otherwise the reader is
    // parked on page one before their saved position has even loaded.
    if (!hydratedRef.current || initialPageViewRef.current === viewKey) return;
    const stage = stageRef.current;
    if (!stage?.querySelector(`[data-pdf-page="${page}"]`)) return;
    const storedView = restored?.view;
    const fitZoom = minimumPdfZoom();
    const initialZoom = rememberZoomLevel ? zoomFromStoredView(storedView) : fitZoom;
    zoomRef.current = initialZoom;
    setZoom(initialZoom);
    const positionInitialPage = () => {
      const initialPage = stage.querySelector(`[data-pdf-page="${page}"]`);
      if (!initialPage) return;
      const stageBounds = stage.getBoundingClientRect();
      const pageBounds = initialPage.getBoundingClientRect();
      const paddingTop = Number.parseFloat(window.getComputedStyle(stage).paddingTop) || 0;
      const restoreSavedPosition = rememberLastPosition && !(bookmarkedPage > 0) && storedView?.page === page;
      const savedOffset = Math.min(1, Math.max(0, Number(storedView?.pageOffset) || 0));
      const targetTop = restoreSavedPosition
        ? stage.scrollTop + pageBounds.top - stageBounds.top + pageBounds.height * savedOffset
        : stage.scrollTop + pageBounds.top - stageBounds.top - paddingTop;
      const desiredLeft = restoreSavedPosition && rememberZoomLevel
        ? Number(storedView?.scrollLeft) || 0
        : stage.scrollLeft + pageBounds.left - stageBounds.left - Math.max(0, (stage.clientWidth - pageBounds.width) / 2);
      // A right-to-left reader scrolls from 0 down to negative, so an offset
      // saved in the other direction is out of range and would park the page
      // outside the viewport. Clamp to the range this direction actually has.
      const overflowX = Math.max(0, stage.scrollWidth - stage.clientWidth);
      const rightToLeft = window.getComputedStyle(stage).direction === "rtl";
      const left = Math.min(rightToLeft ? 0 : overflowX, Math.max(rightToLeft ? -overflowX : 0, desiredLeft));
      stage.scrollTo({
        left,
        top: Math.max(0, targetTop),
        behavior: "auto"
      });
      viewPositionRef.current = { left: stage.scrollLeft, top: stage.scrollTop, pageOffset: savedOffset };
      initialPageViewRef.current = viewKey;
    };
    requestAnimationFrame(() => requestAnimationFrame(positionInitialPage));
  }, [bookmarkedPage, materialSlug, minimumPdfZoom, page, rememberLastPosition, rememberZoomLevel, restored, sheetSlug, zoomFromStoredView]);

  const markPdfDocumentReady = useCallback(() => setPdfDocumentReady(true), []);

  useEffect(() => {
    if (!pdfDocumentReady || !restored) return;
    resetInitialPdfPosition();
  }, [pdfDocumentReady, resetInitialPdfPosition, restored]);

  useEffect(() => {
    setPdfDocumentReady(false);
    initialPageViewRef.current = "";
  }, [materialSlug, sheetSlug]);

  const syncPdfPageCount = useCallback((count) => {
    if (!Number.isFinite(count) || count < 1) return;
    setPageCount(count);
    setPage((current) => Math.min(count, current));
  }, []);

  const recordPdfPageRender = useCallback((duration) => {
    performanceMonitorRef.current.record("pdfRender", duration);
  }, []);

  const recordCommand = useCallback((command) => {
    setUndoHistory((history) => [...history.slice(-79), command]);
    setRedoHistory([]);
  }, []);

  const runCommand = useCallback((command) => {
    updateAnnotations((current) => applyAnnotationCommand(current, command, "redo"));
    recordCommand(command);
  }, [recordCommand, updateAnnotations]);

  const undoTool = useCallback(() => {
    setUndoHistory((history) => {
      if (!history.length) return history;
      const command = history[history.length - 1];
      updateAnnotations((current) => applyAnnotationCommand(current, command, "undo"));
      setRedoHistory((items) => [...items.slice(-79), command]);
      setSelectedIds([]);
      return history.slice(0, -1);
    });
  }, [updateAnnotations]);

  const redoTool = useCallback(() => {
    setRedoHistory((history) => {
      if (!history.length) return history;
      const command = history[history.length - 1];
      updateAnnotations((current) => applyAnnotationCommand(current, command, "redo"));
      setUndoHistory((items) => [...items.slice(-79), command]);
      setSelectedIds([]);
      return history.slice(0, -1);
    });
  }, [updateAnnotations]);

  /**
   * Writes only the pages whose ink actually changed. Every edit path produces
   * new annotation objects, so identity signatures detect an erase or a
   * transform that keeps an id, without serializing anything.
   */
  const persistWorkspace = useCallback(async (target = null) => {
    if (!hydratedRef.current) return;
    const document = target || { owner: ownerKey, materialSlug, sheetSlug };
    const view = {
      page: pageRef.current,
      zoom: zoomRef.current,
      zoomFitBasis: minimumPdfZoom(),
      scrollLeft: viewPositionRef.current.left,
      scrollTop: viewPositionRef.current.top,
      pageOffset: viewPositionRef.current.pageOffset
    };
    const grouped = groupAnnotationsByPage(annotationsRef.current);
    const signatures = performanceMonitorRef.current.measure("annotationSave", () => pageSignatures(grouped, revisionIndexRef.current));
    const { changed, removed } = changedPages(savedPageSignaturesRef.current, signatures);
    if (storageModeRef.current === "local") {
      try {
        window.localStorage.setItem(
          catalogWorkspaceStorageKey(document.materialSlug, document.sheetSlug),
          serializeCatalogWorkspace({ annotations: annotationsRef.current, notes: notesRef.current, ...view })
        );
        savedPageSignaturesRef.current = signatures;
        setSaveState("saved");
        setSaveErrorReason("");
      } catch {
        setSaveState("error");
        setSaveErrorReason("This device is out of space for saved marks.");
      }
      return;
    }
    const pages = new Map();
    for (const pageNumber of changed) pages.set(pageNumber, grouped.get(pageNumber) || []);
    try {
      await annotationStoreRef.current.writeDocument({
        owner: document.owner,
        materialSlug: document.materialSlug,
        sheetSlug: document.sheetSlug,
        view,
        notes: notesRef.current,
        pages,
        removedPages: removed
      });
      savedPageSignaturesRef.current = signatures;
      setSaveState("saved");
      setSaveErrorReason("");
    } catch (error) {
      // The signatures are deliberately not advanced, so the next save retries
      // exactly the pages that failed.
      setSaveState("error");
      setSaveErrorReason(error?.message || "Marks could not be saved on this device.");
    }
  }, [materialSlug, minimumPdfZoom, ownerKey, sheetSlug]);

  persistWorkspaceRef.current = persistWorkspace;

  useEffect(() => {
    let active = true;
    // Switching sheet or account keeps this component mounted, so the sheet
    // being left has to be written before its state is replaced.
    const previous = openDocumentRef.current;
    if (hydratedRef.current && previous && (previous.materialSlug !== materialSlug || previous.sheetSlug !== sheetSlug || previous.owner !== ownerKey)) {
      persistWorkspaceRef.current?.(previous);
    }
    hydratedRef.current = false;
    savedPageSignaturesRef.current = new Map();
    setRestored(null);
    setSaveState("idle");
    setSaveErrorReason("");
    const legacyKey = catalogWorkspaceStorageKey(materialSlug, sheetSlug);
    const store = annotationStoreRef.current;

    async function hydrate() {
      let snapshot = null;
      try {
        await store.open();
        await store.migrateLegacyDocument({
          owner: ownerKey,
          materialSlug,
          sheetSlug,
          legacyKey,
          parse: parseCatalogWorkspace
        });
        snapshot = await store.readDocument({ owner: ownerKey, materialSlug, sheetSlug });
        storageModeRef.current = "indexeddb";
      } catch {
        // Private browsing modes can refuse IndexedDB entirely. The workspace
        // stays usable on the previous localStorage path rather than losing
        // persistence altogether.
        storageModeRef.current = "local";
        const legacy = loadStoredWorkspace(materialSlug, sheetSlug);
        snapshot = legacy ? { view: legacy, notes: legacy.notes, annotations: legacy.annotations } : null;
      }
      if (!active) return;
      const restoredAnnotations = snapshot?.annotations || [];
      const restoredNotes = snapshot?.notes || [];
      annotationsRef.current = restoredAnnotations;
      notesRef.current = restoredNotes;
      savedPageSignaturesRef.current = pageSignatures(groupAnnotationsByPage(restoredAnnotations), revisionIndexRef.current);
      setAnnotations(restoredAnnotations);
      setNotes(restoredNotes);
      const view = snapshot?.view;
      if (view) {
        viewPositionRef.current = { left: view.scrollLeft, top: view.scrollTop, pageOffset: view.pageOffset };
        if (rememberLastPositionRef.current && !(bookmarkedPage > 0)) setPage(Math.max(1, view.page));
        if (rememberZoomLevelRef.current && Number.isFinite(view.zoom)) {
          const nextZoom = zoomFromStoredView(view);
          zoomRef.current = nextZoom;
          setZoom(nextZoom);
        }
      }
      hydratedRef.current = true;
      openDocumentRef.current = { owner: ownerKey, materialSlug, sheetSlug };
      setRestored(snapshot || {});
      setSaveState(snapshot ? "saved" : "idle");
    }

    hydrate();
    return () => { active = false; };
  // `clampReaderZoom` and the remember-* refs are read once per document load.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookmarkedPage, materialSlug, ownerKey, sheetSlug]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    const rememberView = () => {
      const stageBounds = stage.getBoundingClientRect();
      const currentPage = stage.querySelector(`[data-pdf-page="${page}"]`);
      const pageBounds = currentPage?.getBoundingClientRect();
      const pageOffset = pageBounds?.height
        ? Math.min(1, Math.max(0, (stageBounds.top - pageBounds.top) / pageBounds.height))
        : 0;
      viewPositionRef.current = { left: stage.scrollLeft, top: stage.scrollTop, pageOffset };
      if (viewSaveTimerRef.current) window.clearTimeout(viewSaveTimerRef.current);
      viewSaveTimerRef.current = window.setTimeout(() => { persistWorkspace(); }, 500);
    };
    stage.addEventListener("scroll", rememberView, { passive: true });
    return () => {
      stage.removeEventListener("scroll", rememberView);
      if (viewSaveTimerRef.current) window.clearTimeout(viewSaveTimerRef.current);
      viewSaveTimerRef.current = null;
    };
  }, [page, persistWorkspace]);

  useEffect(() => {
    if (!restored) return undefined;
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      setSaveState((current) => current === "error" ? current : "saving");
      const persistWhenIdle = () => {
        saveIdleRef.current = null;
        persistWorkspace();
      };
      if (window.requestIdleCallback) saveIdleRef.current = window.requestIdleCallback(persistWhenIdle, { timeout: 1_000 });
      else saveIdleRef.current = window.setTimeout(persistWhenIdle, 0);
    }, AUTOSAVE_IDLE_MS);
    return () => {
      window.clearTimeout(saveTimerRef.current);
      if (saveIdleRef.current !== null && window.cancelIdleCallback) window.cancelIdleCallback(saveIdleRef.current);
      else if (saveIdleRef.current !== null) window.clearTimeout(saveIdleRef.current);
      saveIdleRef.current = null;
    };
  }, [annotations, notes, page, persistWorkspace, restored, zoom]);

  useEffect(() => {
    // `pagehide` is unreliable on mobile, and a debounced save that is still
    // waiting when the tab is hidden would never run at all.
    const saveBeforeLeave = () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
      persistWorkspace();
    };
    const saveWhenHidden = () => {
      if (window.document.visibilityState === "hidden") saveBeforeLeave();
    };
    window.addEventListener("pagehide", saveBeforeLeave);
    window.document.addEventListener("visibilitychange", saveWhenHidden);
    return () => {
      window.removeEventListener("pagehide", saveBeforeLeave);
      window.document.removeEventListener("visibilitychange", saveWhenHidden);
    };
  }, [persistWorkspace]);

  // Leaving the workspace cancels the debounce timer, so the last edits are
  // written on the way out instead of being dropped with it.
  useEffect(() => () => { persistWorkspaceRef.current?.(); }, []);

  useEffect(() => {
    let active = true;
    focusApi.getLockIn().then((bootstrap) => {
      if (!active) return;
      const unfinished = /** @type {any} */ (bootstrap?.active_session);
      setFocusPayload(isUnfinished(unfinished) ? unfinished : null);
      setNoteDraft("");
    }).catch((error) => { if (active) setFocusMessage(error.message || "Focus status could not be loaded."); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    setBookmarked(false);
    progressApi.getCatalogBookmark(materialSlug, sheetSlug)
      .then(() => { if (active) setBookmarked(true); })
      .catch((error) => {
        if (active && error?.status !== 404) setFocusMessage(error.message || "Bookmark status could not be loaded.");
      });
    return () => { active = false; };
  }, [materialSlug, sheetSlug]);

  useEffect(() => {
    const sessionId = focusPayload?.session?.id;
    if (!sessionId || !isUnfinished(focusPayload)) return undefined;
    const refresh = () => { if (!document.hidden) focusApi.getLockInSession(sessionId).then(setFocusPayload).catch(() => {}); };
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, [focusPayload]);

  useEffect(() => {
    const syncFullscreenState = () => {
      const fullscreen = document.fullscreenElement === rootRef.current;
      setIsDocumentFullscreen(fullscreen);
    };
    document.addEventListener("fullscreenchange", syncFullscreenState);
    return () => document.removeEventListener("fullscreenchange", syncFullscreenState);
  }, []);

  useEffect(() => {
    if (!keepScreenAwake || !wakeLockSupported) {
      wakeLockRef.current?.release?.().catch(() => {});
      wakeLockRef.current = null;
      return undefined;
    }
    let disposed = false;
    const acquireWakeLock = async () => {
      if (document.visibilityState !== "visible" || wakeLockRef.current) return;
      try {
        const lock = await navigator.wakeLock.request("screen");
        if (disposed) await lock.release();
        else {
          wakeLockRef.current = lock;
          lock.addEventListener?.("release", () => { if (wakeLockRef.current === lock) wakeLockRef.current = null; });
        }
      } catch (error) {
        if (!disposed) {
          setKeepScreenAwake(false);
          setFocusMessage(error?.message || "Screen wake lock is unavailable.");
        }
      }
    };
    const handleVisibility = () => { if (document.visibilityState === "visible") acquireWakeLock(); };
    acquireWakeLock();
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", handleVisibility);
      wakeLockRef.current?.release?.().catch(() => {});
      wakeLockRef.current = null;
    };
  }, [keepScreenAwake, wakeLockSupported]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (isTypingTarget(event.target)) return;
      const commandKey = event.ctrlKey || event.metaKey;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redoTool(); else undoTool();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c" && selectedAnnotations.length) {
        event.preventDefault();
        selectionClipboardRef.current = selectedAnnotations.map(cloneAnnotation);
        setFocusMessage(`${selectedAnnotations.length} annotation${selectedAnnotations.length === 1 ? "" : "s"} copied.`);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "x" && selectedAnnotations.length) {
        event.preventDefault();
        selectionClipboardRef.current = selectedAnnotations.map(cloneAnnotation);
        runCommand({ type: "remove", items: selectedAnnotations });
        setSelectedIds([]);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v" && selectionClipboardRef.current.length) {
        event.preventDefault();
        const copies = selectionClipboardRef.current.map((item) => translateAnnotation({ ...cloneAnnotation(item), id: generateIdempotencyKey(), page }, 24, 24));
        runCommand({ type: "add", items: copies });
        setSelectedIds(copies.map((item) => item.id));
        return;
      }
      // Space is the hold-to-pan modifier, but it is also how a keyboard user
      // activates the focused toolbar button. The focused control wins.
      if (event.code === "Space" && !event.repeat && !commandKey && !event.altKey && !isStageControl(event.target)) {
        event.preventDefault();
        spacePanRef.current = true;
        previousToolRef.current = activeToolRef.current;
        setActiveTool("hand");
        setOpenSurface(null);
        return;
      }
      if (event.repeat || event.altKey) return;
      // Single-letter shortcuts must never fire for browser and OS commands
      // such as Ctrl+S, Ctrl+P, or Cmd+L.
      if (!commandKey) {
        const shortcuts = { p: "pen", b: "pencil", h: "highlighter", e: "eraser", l: "select", s: "shapes" };
        const shortcutTool = shortcuts[event.key.toLowerCase()];
        if (shortcutTool) {
          event.preventDefault();
          setActiveTool(shortcutTool);
          setOpenSurface(null);
        }
        // Page keys move the reader itself. Changing only the page number left
        // the indicator, the note editor, and the ink layer on a page that was
        // never brought into view. Composite widgets keep their own arrow
        // semantics.
        const inCompositeWidget = Boolean(event.target?.closest?.("[role='tablist'], [role='radiogroup'], [role='group']"));
        const pageStep = event.key === "ArrowLeft" || event.key === "PageUp"
          ? -1
          : event.key === "ArrowRight" || event.key === "PageDown"
            ? 1
            : 0;
        if (pageStep && !inCompositeWidget) {
          event.preventDefault();
          jumpToPageRef.current?.(pageRef.current + pageStep);
        }
        if (event.key === "Home" && !inCompositeWidget) {
          event.preventDefault();
          jumpToPageRef.current?.(1);
        }
        if (event.key === "End" && !inCompositeWidget) {
          event.preventDefault();
          jumpToPageRef.current?.(accessiblePageCount);
        }
      }
      if ((event.key === "Delete" || event.key === "Backspace") && selectedAnnotations.length) runCommand({ type: "remove", items: selectedAnnotations });
    };
    const handleKeyUp = (event) => {
      if (event.code !== "Space" || !spacePanRef.current) return;
      spacePanRef.current = false;
      setActiveTool(previousToolRef.current);
      setOpenSurface(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => { window.removeEventListener("keydown", handleKeyDown); window.removeEventListener("keyup", handleKeyUp); };
  }, [accessiblePageCount, page, redoTool, runCommand, selectedAnnotations, undoTool]);

  useEffect(() => {
    setSelectedIds([]);
  }, [page]);

  // The live canvas keeps the finished stroke until React has painted the same
  // stroke as SVG, so a heavy page hands over without a visible gap.
  useEffect(() => {
    const handoff = inkHandoffRef.current;
    if (!handoff) return undefined;
    if (annotations.some((annotation) => annotation.id === handoff.id)) {
      inkHandoffRef.current = null;
      liveStrokeCanvasRef.current?.clear();
      return undefined;
    }
    // The stroke never arrived (undo, or a gesture claimed it). Do not strand
    // pixels the workspace can no longer account for.
    const timer = window.setTimeout(() => {
      inkHandoffRef.current = null;
      liveStrokeCanvasRef.current?.clear();
    }, 1_200);
    return () => window.clearTimeout(timer);
  }, [annotations]);

  // Workspace messages describe something that just happened. Leaving them on
  // screen makes a stale sentence look like the current state of the document.
  useEffect(() => {
    if (!focusMessage) return undefined;
    const timer = window.setTimeout(() => setFocusMessage(""), STATUS_MESSAGE_MS);
    return () => window.clearTimeout(timer);
  }, [focusMessage]);

  /**
   * Page geometry for the sheet currently being annotated. Every coalesced
   * pointer sample used to run its own `querySelector` plus
   * `getBoundingClientRect`; the stage scroll position is pinned for the whole
   * stroke, so measuring once per gesture is both cheaper and more consistent.
   */
  function pageBoundsFor(annotationPage) {
    const cache = pageGeometryCacheRef.current;
    if (cache.page === annotationPage && cache.bounds) return cache.bounds;
    const pageElement = stageRef.current?.querySelector(`[data-pdf-page="${annotationPage}"]`) || documentRef.current;
    const bounds = pageElement?.getBoundingClientRect() || stageRef.current?.getBoundingClientRect() || null;
    if (bounds && drawingScrollLockRef.current.active) pageGeometryCacheRef.current = { page: annotationPage, bounds };
    return bounds;
  }

  function invalidatePageGeometry() {
    pageGeometryCacheRef.current = { page: null, bounds: null };
  }

  function documentPoint(clientX, clientY, fixedPage) {
    if (fixedPage) {
      const bounds = pageBoundsFor(fixedPage);
      if (!bounds) return { x: 0, y: 0, page: fixedPage };
      return { ...pagePointFromClient(clientX, clientY, bounds, PAGE_SPACE, PAGE_SPACE), page: fixedPage };
    }
    const pageElement = /** @type {HTMLElement|null} */ (document.elementFromPoint(clientX, clientY)?.closest?.("[data-pdf-page]") || null);
    const bounds = pageElement?.getBoundingClientRect() || documentRef.current?.getBoundingClientRect() || stageRef.current?.getBoundingClientRect();
    if (!bounds) return { x: 0, y: 0, page };
    return { ...pagePointFromClient(clientX, clientY, bounds, PAGE_SPACE, PAGE_SPACE), page: Number(pageElement?.dataset.pdfPage) || page };
  }

  function pageUnitsPerCssPixel(annotationPage) {
    return PAGE_SPACE / Math.max(1, pageBoundsFor(annotationPage)?.width || PAGE_SPACE);
  }

  function pagePointScreenDistance(first, second, annotationPage) {
    const bounds = pageBoundsFor(annotationPage);
    const scaleX = Math.max(1, bounds?.width || PAGE_SPACE) / PAGE_SPACE;
    const scaleY = Math.max(1, bounds?.height || PAGE_SPACE) / PAGE_SPACE;
    return Math.hypot((second.x - first.x) * scaleX, (second.y - first.y) * scaleY);
  }

  function hideStylusHover() {
    const gesture = gestureRef.current;
    if (gesture.hoverRafId !== null) cancelAnimationFrame(gesture.hoverRafId);
    gesture.hoverRafId = null;
    if (stylusHoverRef.current) stylusHoverRef.current.style.opacity = "0";
  }

  function renderStylusHover(point) {
    const preview = stylusHoverRef.current;
    if (!preview || !point) return;
    const hoverPage = documentPoint(point.x, point.y).page;
    const pageWidth = Math.max(1, pageBoundsFor(hoverPage)?.width || PAGE_SPACE);
    const size = activeToolRef.current === "eraser"
      ? (5 + brushSize * 1.45) * 2
      : Math.max(5, (brushSize * 2 * pageWidth) / PAGE_SPACE);
    preview.dataset.tool = activeToolRef.current;
    preview.style.width = `${size}px`;
    preview.style.height = `${size}px`;
    preview.style.transform = `translate3d(${point.x - size / 2}px, ${point.y - size / 2}px, 0)`;
    preview.style.opacity = "1";
  }

  function updateStylusHover(event) {
    const preview = stylusHoverRef.current;
    if (!preview || event.pointerType !== "pen" || event.buttons || Number(event.pressure) > 0 || !DRAWING_TOOLS.has(activeToolRef.current)) {
      hideStylusHover();
      return;
    }
    // Hover moves arrive as fast as the stylus reports them. One measured paint
    // per frame is enough, and it keeps hit-testing off the pointer path.
    const gesture = gestureRef.current;
    gesture.hoverPoint = { x: event.clientX, y: event.clientY };
    if (gesture.hoverRafId !== null) return;
    gesture.hoverRafId = requestAnimationFrame(() => {
      gesture.hoverRafId = null;
      renderStylusHover(gestureRef.current.hoverPoint);
    });
  }

  function eventSamples(event, fixedPage) {
    const nativeEvent = event.nativeEvent || event;
    return samplesFromPointerEvent(nativeEvent, (clientX, clientY) => documentPoint(clientX, clientY, fixedPage));
  }

  function isLiveStroke(annotation) {
    return ["pen", "pencil", "highlighter"].includes(annotation?.type);
  }

  function scheduleLiveStrokeDraw() {
    const gesture = gestureRef.current;
    if (gesture.liveStrokeRafId !== null) return;
    gesture.liveStrokeRafId = requestAnimationFrame(() => {
      gesture.liveStrokeRafId = null;
      const draft = draftRef.current;
      if (draft?.type === "lasso" && liveStrokeCanvasRef.current?.pageNumber === draft.page) {
        performanceMonitorRef.current.measure("drawingFrame", () => liveStrokeCanvasRef.current.drawLasso(draft.points));
        performanceMonitorRef.current.increment("liveCanvasRedraws");
      } else if (isLiveStroke(draft) && liveStrokeCanvasRef.current?.pageNumber === draft.page) {
        const predicted = gesture.predictedStrokePoints;
        const diagnostics = inkDebugEnabled ? inkInputControllerRef.current.getDiagnostics() : null;
        // Predicted samples stay separate from the committed buffer so the
        // renderer knows which geometry it is allowed to append rather than
        // repaint.
        const renderMetrics = performanceMonitorRef.current.measure("drawingFrame", () => liveStrokeCanvasRef.current.draw(draft, diagnostics, predicted));
        if (renderMetrics && renderMetrics.geometryTime >= 0) performanceMonitorRef.current.record("geometryTime", renderMetrics.geometryTime);
        const sampleTime = Number(draft.points?.at(-1)?.t);
        const latency = Number.isFinite(sampleTime) ? window.performance.now() - sampleTime : -1;
        if (latency >= 0 && latency < 10_000) performanceMonitorRef.current.record("pointerToPaint", latency);
        performanceMonitorRef.current.increment("liveCanvasRedraws");
        if (inkDebugEnabled) window.__lockInInkDiagnostics = diagnostics;
      }
    });
  }

  function setDraft(next) {
    draftRef.current = next;
    if (isLiveStroke(next) || next?.type === "lasso") {
      // The live canvas owns freehand and lasso frames; React only sees
      // committed strokes or the completed lasso selection.
      setDraftAnnotation(null);
      scheduleLiveStrokeDraw();
      return;
    }
    setDraftAnnotation(next);
  }

  /**
   * @param {{ keepCanvas?: boolean }} [options] `keepCanvas` hands the painted
   * stroke over to React instead of wiping it. React commits the SVG one frame
   * or more later, and on a page that already holds hundreds of strokes that
   * gap is long enough to see the ink blink out and back.
   */
  function clearDraft({ keepCanvas = false } = {}) {
    const gesture = gestureRef.current;
    if (gesture.holdTimerId !== null) window.clearTimeout(gesture.holdTimerId);
    gesture.holdTimerId = null;
    gesture.holdAnchorPoint = null;
    draftRef.current = null;
    gesture.predictedStrokePoints = [];
    inkInputControllerRef.current.reset();
    if (gesture.liveStrokeRafId !== null) cancelAnimationFrame(gesture.liveStrokeRafId);
    gesture.liveStrokeRafId = null;
    if (!keepCanvas) {
      inkHandoffRef.current = null;
      liveStrokeCanvasRef.current?.clear();
    }
    setDraftAnnotation(null);
  }

  function lassoSelectionIds(polygon, annotationPage) {
    const bounds = gestureBounds(polygon);
    if (!bounds || polygon.length < 3) return [];
    return queryAnnotationSpatialIndexBounds(annotationSpatialIndexRef.current, annotationPage, bounds)
      .filter((annotation) => annotationIntersectsPolygon(annotation, polygon))
      .map((annotation) => annotation.id);
  }

  function scheduleHoldRecognition() {
    const gesture = gestureRef.current;
    const draft = draftRef.current;
    const supportsHold = ["pen", "pencil", "highlighter"].includes(activeToolRef.current);
    if (!supportsHold || !isLiveStroke(draft) || (!drawAndHold && !(circleToErase && draft.type !== "highlighter"))) return;
    const endpoint = draft.points?.at(-1);
    if (!endpoint) return;
    if (gesture.holdTimerId !== null && gesture.holdAnchorPoint && pagePointScreenDistance(endpoint, gesture.holdAnchorPoint, draft.page) <= HOLD_ENDPOINT_TOLERANCE_PX) return;
    if (gesture.holdTimerId !== null) window.clearTimeout(gesture.holdTimerId);
    gesture.holdTimerId = null;
    gesture.holdAnchorPoint = { x: endpoint.x, y: endpoint.y };
    const draftId = draft.id;
    gesture.holdTimerId = window.setTimeout(() => {
      gesture.holdTimerId = null;
      const current = draftRef.current;
      if (!current || current.id !== draftId || current.points?.length < 5 || gestureRef.current.mode !== INTERACTION_STATE.DRAWING) return;
      const currentEndpoint = current.points.at(-1);
      if (pagePointScreenDistance(currentEndpoint, gesture.holdAnchorPoint, current.page) > HOLD_ENDPOINT_TOLERANCE_PX) return;
      const rawStroke = cloneAnnotation(current);
      const unitsPerCssPixel = pageUnitsPerCssPixel(current.page);
      const closed = circleToErase && current.type !== "highlighter"
        ? analyzeClosedGesture(current.points, { unitsPerCssPixel })
        : null;
      if (closed?.recognized) {
        const ids = lassoSelectionIds(current.points, current.page);
        if (ids.length) {
          const targetIds = new Set(ids);
          const targets = annotationsRef.current.filter((item) => targetIds.has(item.id));
          runCommand({ type: "remove", items: targets });
          gesture.holdRecognition = { kind: "circle-erase", confidence: closed.confidence };
          gesture.smartSelectionActivated = true;
          clearDraft();
          setFocusMessage(`${targets.length} annotation${targets.length === 1 ? "" : "s"} erased.`);
          return;
        }
      }
      if (!drawAndHold) return;
      const recognition = recognizeHeldStroke(current.points, { unitsPerCssPixel });
      if (!recognition) return;
      if (current.type === "highlighter" && recognition.kind !== "line") return;
      const shape = current.type === "highlighter"
        ? { ...current, points: [{ ...current.points[0], ...recognition.start }, { ...currentEndpoint, ...recognition.end }] }
        : recognizedShapeAnnotation(current, recognition);
      if (!shape) return;
      gesture.holdRawStroke = rawStroke;
      gesture.holdRecognition = recognition;
      liveStrokeCanvasRef.current?.clear();
      setDraft(shape);
    }, HOLD_RECOGNITION_MS);
  }

  function scribbleEraseTargets(stroke) {
    if (!scribbleToErase || stroke?.type !== "pen") return [];
    const analysis = analyzeScribbleGesture(stroke.points);
    if (!analysis.recognized || !analysis.bounds) return [];
    const radius = Math.max(5, stroke.width * 1.25);
    const candidates = queryAnnotationSpatialIndexBounds(annotationSpatialIndexRef.current, stroke.page, {
      x: analysis.bounds.x - radius,
      y: analysis.bounds.y - radius,
      width: analysis.bounds.width + radius * 2,
      height: analysis.bounds.height + radius * 2
    });
    return candidates.filter((annotation) => {
      if (!["pen", "pencil", "highlighter"].includes(annotation.type)) return false;
      const coverage = strokeEraseCoverage(annotation, stroke.points, radius);
      return coverage.coverage >= .12 || coverage.intersectionRuns >= 2;
    });
  }

  function setAnnotationPreviewVisibility(annotationId, visible) {
    const escapedId = globalThis.CSS?.escape
      ? globalThis.CSS.escape(String(annotationId))
      : String(annotationId).replace(/["\\]/g, "\\$&");
    stageRef.current?.querySelectorAll(`[data-annotation-id="${escapedId}"]`).forEach((element) => {
      element.style.visibility = visible ? "" : "hidden";
    });
  }

  function eraserRadiusForPage(annotationPage) {
    const pageElement = stageRef.current?.querySelector(`[data-pdf-page="${annotationPage}"]`) || documentRef.current;
    const renderedWidth = Math.max(1, pageElement?.getBoundingClientRect().width || 1000);
    const screenRadius = 5 + brushSize * 1.45;
    return pageRadiusForScreenRadius(screenRadius, renderedWidth, PAGE_SPACE);
  }

  function scheduleEraserPreview() {
    const gesture = gestureRef.current;
    if (gesture.eraserPreviewRafId !== null) return;
    gesture.eraserPreviewRafId = requestAnimationFrame(() => {
      gesture.eraserPreviewRafId = null;
      const preview = eraserSessionRef.current.getPreview().annotations;
      performanceMonitorRef.current.measure("eraserFrame", () => {
        liveStrokeCanvasRef.current?.drawAnnotations(preview);
      });
      performanceMonitorRef.current.increment("liveCanvasRedraws");
    });
  }

  function eraseAtPoint(point, annotationPage = page) {
    const radius = eraserRadiusForPage(annotationPage);
    const previous = eraserSessionRef.current.getLastPoint() || point;
    const padding = radius + 8;
    const candidates = queryAnnotationSpatialIndexBounds(annotationSpatialIndexRef.current, annotationPage, {
      x: Math.min(previous.x, point.x) - padding,
      y: Math.min(previous.y, point.y) - padding,
      width: Math.abs(point.x - previous.x) + padding * 2,
      height: Math.abs(point.y - previous.y) + padding * 2
    });
    const result = eraserSessionRef.current.append(point, { annotationPage, candidates, radius, mode: eraserMode });
    for (const annotationId of result.newlyChangedIds) setAnnotationPreviewVisibility(annotationId, false);
    performanceMonitorRef.current.recordValue?.("eraserCandidates", candidates.length);
    if (result.changed) scheduleEraserPreview();
  }

  function clearEraserPreview({ restoreOriginals = true } = {}) {
    const gesture = gestureRef.current;
    if (gesture.eraserPreviewRafId !== null) cancelAnimationFrame(gesture.eraserPreviewRafId);
    gesture.eraserPreviewRafId = null;
    const hiddenIds = eraserSessionRef.current.getHiddenIds();
    if (restoreOriginals) for (const annotationId of hiddenIds) setAnnotationPreviewVisibility(annotationId, true);
    eraserSessionRef.current.cancel();
    liveStrokeCanvasRef.current?.clear();
  }

  function commitEraserGesture() {
    const hiddenIds = eraserSessionRef.current.getHiddenIds();
    if (!hiddenIds.length) {
      clearEraserPreview();
      return;
    }
    for (const annotationId of hiddenIds) setAnnotationPreviewVisibility(annotationId, true);
    const { command, replacements } = eraserSessionRef.current.finish();
    if (!command) return;
    updateAnnotations((current) => applyAnnotationCommand(current, command, "redo"));
    recordCommand(command);
    setSelectedIds((current) => current.flatMap((id) => replacements.has(id) ? replacements.get(id).map((fragment) => fragment.id) : [id]));
    if (gestureRef.current.eraserPreviewRafId !== null) cancelAnimationFrame(gestureRef.current.eraserPreviewRafId);
    gestureRef.current.eraserPreviewRafId = null;
    liveStrokeCanvasRef.current?.clear();
  }

  function applyObjectTransformPreview(after) {
    const replacements = new Map((after || []).map((item) => [item.id, item]));
    updateAnnotations((items) => items.map((item) => replacements.get(item.id) || item));
  }

  function scheduleObjectTransformPreview() {
    const gesture = gestureRef.current;
    if (gesture.transformRafId !== null) return;
    gesture.transformRafId = requestAnimationFrame(() => {
      gesture.transformRafId = null;
      if (gestureRef.current.mode === INTERACTION_STATE.OBJECT_TRANSFORMING && transformRef.current?.after) {
        applyObjectTransformPreview(transformRef.current.after);
      }
    });
  }

  function lockStageForDrawing(pointerId) {
    const stage = stageRef.current;
    if (!stage) return;
    invalidatePageGeometry();
    drawingScrollLockRef.current = {
      active: true,
      pointerId,
      left: stage.scrollLeft,
      top: stage.scrollTop
    };
    stage.classList.add("is-writing-locked");
  }

  function restoreLockedStagePosition() {
    const stage = stageRef.current;
    const lock = drawingScrollLockRef.current;
    if (!stage || !lock.active) return;
    if (stage.scrollLeft !== lock.left) stage.scrollLeft = lock.left;
    if (stage.scrollTop !== lock.top) stage.scrollTop = lock.top;
  }

  function unlockStageForDrawing(pointerId = null) {
    const lock = drawingScrollLockRef.current;
    if (pointerId !== null && lock.pointerId !== pointerId) return;
    drawingScrollLockRef.current = { active: false, pointerId: null, left: 0, top: 0 };
    invalidatePageGeometry();
    stageRef.current?.classList.remove("is-writing-locked");
  }

  function commitInterruptedLiveStroke(event) {
    const gesture = gestureRef.current;
    const draft = draftRef.current;
    const interruptedActivePointer = gesture.drawingPointerId !== null
      && (event.pointerId == null || gesture.drawingPointerId === event.pointerId);
    if (!interruptedActivePointer) return;
    if (gesture.holdRecognition && gesture.holdRawStroke && draft?.type === "shape") {
      runCommand({ type: "replace", before: [gesture.holdRawStroke], after: [draft] });
      return;
    }
    if (!isLiveStroke(draft) || draft.points?.length < 2) return;
    runCommand({
      type: "add",
      items: [{ ...draft, points: [...draft.points] }]
    });
  }

  function beginAnnotation(event) {
    const gesture = gestureRef.current;
    const point = documentPoint(event.clientX, event.clientY);
    const annotationPage = point.page;
    gesture.drawingPointerId = event.pointerId;
    gesture.drawingPointerType = event.pointerType;
    gesture.annotationPage = annotationPage;
    gesture.predictedStrokePoints = [];
    gesture.holdRawStroke = null;
    gesture.holdRecognition = null;
    gesture.holdAnchorPoint = null;
    gesture.smartSelectionActivated = false;
    lockStageForDrawing(event.pointerId);
    if (annotationPage !== page) setPage(annotationPage);
    if (activeTool === "select") {
      const resizeHandle = event.target?.dataset?.resizeHandle;
      if (selectedBounds && (resizeHandle || selectionContains(point, selectedBounds))) {
        const before = selectedAnnotations.map(cloneAnnotation);
        transformRef.current = { kind: resizeHandle ? "resize" : "move", handle: resizeHandle, start: point, before, bounds: { ...selectedBounds } };
        gesture.mode = INTERACTION_STATE.OBJECT_TRANSFORMING;
      } else {
        setSelectedIds([]);
        setDraft({ id: generateIdempotencyKey(), page: annotationPage, type: "lasso", mode: lassoMode, start: point, end: point, points: [point] });
        gesture.mode = INTERACTION_STATE.SELECTING;
      }
      return;
    }
    if (activeTool === "eraser") {
      gesture.mode = INTERACTION_STATE.ERASING;
      clearEraserPreview();
      eraserSessionRef.current.begin(point, annotationPage);
      eraseAtPoint(point, annotationPage);
      return;
    }
    const id = generateIdempotencyKey();
    if (activeTool === "shapes") {
      setDraft({ id, page: annotationPage, type: "shape", shape: shapeStyle, color: activeColor, width: brushSize * 2, opacity: brushOpacity, start: point, end: point });
    } else {
      const nativeEvent = event.nativeEvent || event;
      const input = inkInputControllerRef.current.begin(nativeEvent, {
        page: annotationPage,
        pageUnitsPerCssPixel: pageUnitsPerCssPixel(annotationPage),
        mapClientPoint: (clientX, clientY, fixedPage) => documentPoint(clientX, clientY, fixedPage),
        debug: inkDebugEnabled,
        captured: false
      });
      const points = input.points;
      const profile = activeTool === "pen" ? penProfile : activeTool === "pencil" ? PEN_PROFILE.PENCIL : PEN_PROFILE.HIGHLIGHTER;
      setDraft({
        id,
        page: annotationPage,
        type: activeTool,
        profile,
        color: activeColor,
        width: activeTool === "highlighter" ? brushSize * 7 : brushSize * 2,
        opacity: activeTool === "pen" ? brushOpacity : activeTool === "highlighter" ? highlighterOpacity : pencilOpacity,
        pressureSensitivity,
        smoothing: strokeSmoothing,
        createdAt: new Date().toISOString(),
        points
      });
    }
    gesture.mode = INTERACTION_STATE.DRAWING;
    if (["pen", "pencil", "highlighter"].includes(activeTool)) scheduleHoldRecognition();
  }

  function pointerEventSamples(event) {
    const nativeEvent = event.nativeEvent || event;
    const coalesced = typeof nativeEvent.getCoalescedEvents === "function" ? nativeEvent.getCoalescedEvents() : [];
    const source = coalesced.length ? [...coalesced] : [nativeEvent];
    const last = source[source.length - 1];
    if (last !== nativeEvent && (last.clientX !== nativeEvent.clientX || last.clientY !== nativeEvent.clientY || last.timeStamp !== nativeEvent.timeStamp)) source.push(nativeEvent);
    return source.map((sample) => ({ x: sample.clientX, y: sample.clientY, time: sample.timeStamp }));
  }

  function debugGesture(phase, event, detail = {}) {
    if (!import.meta.env.DEV) return;
    const gesture = gestureRef.current;
    const stage = stageRef.current;
    const snapshot = {
      phase,
      pointerType: event?.pointerType || "unknown",
      pointerCount: gesture.touches.size,
      deltaX: detail.deltaX ?? 0,
      deltaY: detail.deltaY ?? 0,
      state: gesture.mode,
      scrollTop: stage?.scrollTop ?? 0,
      scrollLeft: stage?.scrollLeft ?? 0,
      scale: zoomRef.current,
      panX: gesture.pan?.elasticX ?? 0,
      panY: gesture.pan?.elasticY ?? 0,
      direction: gesture.pan?.direction || null,
      prevented: Boolean(detail.prevented)
    };
    window.__lockInFocusGesture = snapshot;
  }

  function startScrollActivity() {
    const gesture = gestureRef.current;
    if (gesture.scrollActivityActive) return;
    gesture.scrollActivityActive = true;
    documentRef.current?.dispatchEvent(new window.CustomEvent("workspace:scrollactivitystart"));
  }

  function endScrollActivity() {
    const gesture = gestureRef.current;
    if (!gesture.scrollActivityActive) return;
    gesture.scrollActivityActive = false;
    documentRef.current?.dispatchEvent(new window.CustomEvent("workspace:scrollactivityend"));
  }

  function prefersReducedMotion() {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  }

  function springLimits() {
    const stage = stageRef.current;
    return {
      x: Math.min(68, Math.max(28, (stage?.clientWidth || window.innerWidth) * .09)),
      y: Math.min(68, Math.max(28, (stage?.clientHeight || window.innerHeight) * .075)),
      velocity: 1_050
    };
  }

  function ensureSpringSystem() {
    const gesture = gestureRef.current;
    if (!gesture.spring) {
      gesture.spring = {
        pan: { x: 0, y: 0, velocityX: 0, velocityY: 0, active: false },
        paused: false,
        startedAt: window.performance.now(),
        lastTime: window.performance.now()
      };
    }
    return gesture.spring;
  }

  function hasActiveSpring(system = gestureRef.current.spring) {
    return Boolean(system?.pan?.active);
  }

  function renderSpringTransform() {
    const root = documentRef.current;
    const system = gestureRef.current.spring;
    if (!root || !system) return;
    const pan = system.pan || { x: 0, y: 0 };
    if (import.meta.env.DEV) {
      window.__lockInFocusElastic = {
        panX: pan.x,
        panY: pan.y,
        velocityX: pan.velocityX,
        velocityY: pan.velocityY,
        paused: system.paused,
        rafActive: gestureRef.current.springRafId !== null
      };
    }
    if (pan.active || Math.abs(pan.x) > .01 || Math.abs(pan.y) > .01) {
      root.style.transform = `translate3d(${pan.x.toFixed(2)}px, ${pan.y.toFixed(2)}px, 0)`;
      return;
    }
    root.style.transform = "";
  }

  function scheduleSpringFrame() {
    const gesture = gestureRef.current;
    const system = gesture.spring;
    if (!system || system.paused || gesture.springRafId !== null) return;
    gesture.springRafId = requestAnimationFrame((now) => {
      gesture.springRafId = null;
      const current = gestureRef.current;
      const active = current.spring;
      if (!active || active.paused) return;
      const elapsed = now - active.lastTime;
      active.lastTime = now;
      let panSettled = true;
      if (active.pan.active) {
        const nextX = advanceSpring({ value: active.pan.x, velocity: active.pan.velocityX }, elapsed);
        const nextY = advanceSpring({ value: active.pan.y, velocity: active.pan.velocityY }, elapsed);
        active.pan.x = nextX.value;
        active.pan.y = nextY.value;
        active.pan.velocityX = nextX.velocity;
        active.pan.velocityY = nextY.velocity;
        // The document must never stay outside its committed geometry. If the
        // device cannot deliver enough frames to finish the spring, it snaps
        // home rather than leaving the page permanently offset.
        panSettled = (nextX.settled && nextY.settled) || now - active.startedAt >= SPRING_DEADLINE_MS;
        if (panSettled) {
          active.pan.x = 0;
          active.pan.y = 0;
          active.pan.velocityX = 0;
          active.pan.velocityY = 0;
          active.pan.active = false;
        }
      }
      renderSpringTransform();
      if (!hasActiveSpring(active)) {
        current.spring = null;
        const root = documentRef.current;
        root?.classList.remove("is-live-panning", "is-springing-back");
        renderSpringTransform();
        if (current.mode === INTERACTION_STATE.SPRING_BACK) current.mode = INTERACTION_STATE.IDLE;
        endScrollActivity();
        return;
      }
      if (panSettled && current.mode === INTERACTION_STATE.SPRING_BACK) current.mode = INTERACTION_STATE.IDLE;
      scheduleSpringFrame();
    });
  }

  /** Pauses, rather than resets, a physical spring when a new gesture lands. */
  function stopSpringBack({ discard = false } = {}) {
    const gesture = gestureRef.current;
    const system = gesture.spring;
    if (gesture.springRafId !== null) cancelAnimationFrame(gesture.springRafId);
    gesture.springRafId = null;
    if (!system) return;
    if (!discard) {
      system.paused = true;
      system.lastTime = window.performance.now();
      return;
    }
    gesture.spring = null;
    const root = documentRef.current;
    root?.classList.remove("is-springing-back", "is-live-panning");
    if (root) root.style.transform = "";
    if (gesture.mode === INTERACTION_STATE.SPRING_BACK) gesture.mode = INTERACTION_STATE.IDLE;
  }

  function startPanSpringBack(offsetX, offsetY, releaseVelocity = { x: 0, y: 0 }) {
    const gesture = gestureRef.current;
    const root = documentRef.current;
    if (!root || (Math.abs(offsetX) < .1 && Math.abs(offsetY) < .1)) {
      endScrollActivity();
      return false;
    }
    if (prefersReducedMotion()) {
      stopSpringBack({ discard: true });
      endScrollActivity();
      return false;
    }
    const limits = springLimits();
    const system = ensureSpringSystem();
    const nextX = addSpringImpulse(system.pan, { position: offsetX, impulse: -Number(releaseVelocity.x || 0) * 180, maxPosition: limits.x, maxVelocity: limits.velocity });
    const nextY = addSpringImpulse(system.pan, { position: offsetY, impulse: -Number(releaseVelocity.y || 0) * 180, maxPosition: limits.y, maxVelocity: limits.velocity });
    system.pan = { x: nextX.value, y: nextY.value, velocityX: nextX.velocity, velocityY: nextY.velocity, active: true };
    system.paused = false;
    system.startedAt = window.performance.now();
    system.lastTime = system.startedAt;
    gesture.mode = INTERACTION_STATE.SPRING_BACK;
    root.classList.add("is-live-panning", "is-springing-back");
    renderSpringTransform();
    scheduleSpringFrame();
    return true;
  }

  function applyPanPosition(pan) {
    const stage = stageRef.current;
    const root = documentRef.current;
    if (!stage || !root || !pan) return;
    const latest = pan.samples[pan.samples.length - 1];
    if (!latest) return;
    // Scroll coordinates run opposite to visible content motion. This is the
    // single intentional inversion; elastic display offsets are inverted back
    // below so the PDF remains attached to the finger at a boundary.
    const delta = lockedGestureDelta(pan.direction, latest.x - pan.x, latest.y - pan.y);
    let elasticX = 0;
    let elasticY = 0;
    const movesHorizontally = pan.direction === GESTURE_DIRECTION.HORIZONTAL || pan.direction === GESTURE_DIRECTION.FREE;
    const movesVertically = pan.direction === GESTURE_DIRECTION.VERTICAL || pan.direction === GESTURE_DIRECTION.FREE;
    const hasHorizontalRange = pan.bounds.maxScrollLeft - pan.bounds.minScrollLeft > .5;
    if (movesHorizontally && hasHorizontalRange) {
      const rawLeft = pan.left - delta.x + (delta.x ? pan.baseVirtualX : 0);
      const left = elasticScrollPosition(rawLeft, pan.bounds.minScrollLeft, pan.bounds.maxScrollLeft, pan.limits.x);
      stage.scrollLeft = left.legal;
      elasticX = delta.x ? -left.overshoot : 0;
    }
    if (movesVertically) {
      const rawTop = pan.top - delta.y + (delta.y ? pan.baseVirtualY : 0);
      const top = elasticScrollPosition(rawTop, pan.bounds.minScrollTop, pan.bounds.maxScrollTop, pan.limits.y);
      stage.scrollTop = top.legal;
      elasticY = delta.y ? -top.overshoot : 0;
    }
    // Free pan applies both components of the physical finger vector. Bounds
    // constrain each axis independently, so reaching one edge never kills the
    // remaining movement on the other axis.
    pan.elasticX = elasticX;
    pan.elasticY = elasticY;
    const system = ensureSpringSystem();
    system.pan.x = pan.elasticX;
    system.pan.y = pan.elasticY;
    system.pan.active = Math.abs(pan.elasticX) > .01 || Math.abs(pan.elasticY) > .01;
    system.paused = true;
    // Normal scrolling already moves on the browser's optimized scroll layer.
    // Promoting the entire multi-page PDF to a transformed GPU layer here (even
    // with translate3d(0, 0, 0)) is particularly expensive on iPad. Only use a
    // document transform while displaying the small elastic edge overshoot.
    if (system.pan.active) {
      root.classList.add("is-live-panning");
      root.style.transform = `translate3d(${pan.elasticX.toFixed(2)}px, ${pan.elasticY.toFixed(2)}px, 0)`;
    } else {
      root.classList.remove("is-live-panning");
      root.style.transform = "";
    }
  }

  function readerScrollBounds({ preserveCurrent = true } = {}) {
    const stage = stageRef.current;
    const root = documentRef.current;
    const fullBounds = {
      minScrollLeft: 0,
      maxScrollLeft: Math.max(0, (stage?.scrollWidth || 0) - (stage?.clientWidth || 0)),
      minScrollTop: 0,
      maxScrollTop: Math.max(0, (stage?.scrollHeight || 0) - (stage?.clientHeight || 0))
    };
    if (!sheet?.pdfUrl || !stage || !root) return fullBounds;
    const stageRect = stage.getBoundingClientRect();
    const rootRect = root.getBoundingClientRect();
    return visibleDocumentScrollBounds({
      contentStartX: rootRect.left - stageRect.left + stage.scrollLeft,
      contentStartY: rootRect.top - stageRect.top + stage.scrollTop,
      contentWidth: root.offsetWidth,
      contentHeight: root.offsetHeight,
      viewportWidth: stage.clientWidth,
      viewportHeight: stage.clientHeight,
      scrollWidth: stage.scrollWidth,
      scrollHeight: stage.scrollHeight,
      currentScrollLeft: stage.scrollLeft,
      currentScrollTop: stage.scrollTop,
      horizontalEdgeReveal: WORKSPACE_GESTURE.horizontalEdgeReveal,
      verticalEdgeReveal: WORKSPACE_GESTURE.verticalEdgeReveal,
      preserveCurrent
    });
  }

  function schedulePanFrame() {
    const gesture = gestureRef.current;
    if (gesture.panRafId !== null) return;
    gesture.panRafId = requestAnimationFrame(() => {
      gesture.panRafId = null;
      const current = gestureRef.current;
      if ([INTERACTION_STATE.VERTICAL_SCROLL, INTERACTION_STATE.HORIZONTAL_PAN, INTERACTION_STATE.FREE_PAN].includes(current.mode)) {
        applyPanPosition(current.pan);
      }
    });
  }

  function stopScrollMomentum({ endActivity = true } = {}) {
    const gesture = gestureRef.current;
    const wasActive = Boolean(gesture.momentum);
    if (gesture.momentumRafId !== null) cancelAnimationFrame(gesture.momentumRafId);
    gesture.momentumRafId = null;
    gesture.momentum = null;
    if (gesture.mode === INTERACTION_STATE.MOMENTUM) gesture.mode = INTERACTION_STATE.IDLE;
    if (wasActive) documentRef.current?.dispatchEvent(new window.CustomEvent("workspace:scrollmomentumend"));
    if (endActivity) endScrollActivity();
  }

  function startScrollMomentum(measuredVelocity) {
    const stage = stageRef.current;
    const gesture = gestureRef.current;
    if (!stage) return false;
    const config = momentumConfig({
      viewportWidth: stage.clientWidth,
      reducedMotion: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    });
    const velocity = momentumVelocityForIntent(measuredVelocity, config);
    const bounds = readerScrollBounds();
    const velocityX = bounds.maxScrollLeft > bounds.minScrollLeft ? velocity.x : 0;
    const velocityY = bounds.maxScrollTop > bounds.minScrollTop ? velocity.y : 0;
    if (Math.hypot(velocityX, velocityY) < config.stopVelocity) {
      endScrollActivity();
      return false;
    }
    stopScrollMomentum({ endActivity: false });
    const momentum = {
      config,
      bounds,
      velocityX,
      velocityY,
      scrollLeft: stage.scrollLeft,
      scrollTop: stage.scrollTop,
      lastTime: window.performance.now()
    };
    gesture.mode = INTERACTION_STATE.MOMENTUM;
    gesture.momentum = momentum;
    documentRef.current?.dispatchEvent(new window.CustomEvent("workspace:scrollmomentumstart", { detail: { speed: velocity.speed, band: velocity.band } }));
    const advance = (now) => {
      const currentGesture = gestureRef.current;
      if (currentGesture.momentum !== momentum || currentGesture.mode !== INTERACTION_STATE.MOMENTUM) return;
      currentGesture.momentumRafId = null;
      const next = advanceMomentumFrame(momentum, now - momentum.lastTime, momentum.config, momentum.bounds);
      momentum.lastTime = now;
      momentum.velocityX = next.velocityX;
      momentum.velocityY = next.velocityY;
      momentum.scrollLeft = next.scrollLeft;
      momentum.scrollTop = next.scrollTop;
      stage.scrollLeft = next.scrollLeft;
      stage.scrollTop = next.scrollTop;
      if (next.unclampedLeft !== next.scrollLeft || next.unclampedTop !== next.scrollTop) {
        const speedFactor = Math.min(1.25, 1 + Math.hypot(momentum.velocityX, momentum.velocityY) / 14);
        const horizontalLimit = Math.min(60, Math.max(24, stage.clientWidth * .08)) * speedFactor;
        const verticalLimit = Math.min(60, Math.max(24, stage.clientHeight * .07)) * speedFactor;
        const edgeX = -elasticScrollPosition(next.unclampedLeft, momentum.bounds.minScrollLeft, momentum.bounds.maxScrollLeft, horizontalLimit).overshoot;
        const edgeY = -elasticScrollPosition(next.unclampedTop, momentum.bounds.minScrollTop, momentum.bounds.maxScrollTop, verticalLimit).overshoot;
        stopScrollMomentum({ endActivity: false });
        startPanSpringBack(edgeX, edgeY);
        return;
      }
      if (!next.active) {
        stopScrollMomentum();
        return;
      }
      currentGesture.momentumRafId = requestAnimationFrame(advance);
    };
    gesture.momentumRafId = requestAnimationFrame(advance);
    return true;
  }

  /** @param {any} event @param {string} direction */
  function beginPan(event, direction = GESTURE_DIRECTION.FREE) {
    const stage = stageRef.current;
    if (!stage) return;
    stopSpringBack({ discard: true });
    stopScrollMomentum();
    const clientX = event.clientX ?? event.currentX;
    const clientY = event.clientY ?? event.currentY;
    const gesture = gestureRef.current;
    const limits = springLimits();
    const system = ensureSpringSystem();
    const initialElasticX = system.pan.x;
    const initialElasticY = system.pan.y;
    gesture.mode = interactionStateForDirection(direction);
    gesture.pan = {
      pointerId: event.pointerId,
      x: clientX,
      y: clientY,
      left: stage.scrollLeft,
      top: stage.scrollTop,
      direction,
      bounds: readerScrollBounds(),
      limits,
      // Store the inverse rubber-band value once, so an in-flight spring is
      // part of the new drag's origin instead of being cleared first.
      baseVirtualX: -unresistedDistance(initialElasticX, limits.x),
      baseVirtualY: -unresistedDistance(initialElasticY, limits.y),
      elasticX: initialElasticX,
      elasticY: initialElasticY,
      samples: [{ x: clientX, y: clientY, time: event.timeStamp }]
    };
    if (direction !== GESTURE_DIRECTION.PENDING) startScrollActivity();
  }

  function startLivePinch(points) {
    const gesture = gestureRef.current;
    const root = documentRef.current;
    const stage = stageRef.current;
    if (!root || !stage) return false;
    if (gesture.mode === INTERACTION_STATE.PINCHING && gesture.pinch?.active) return true;
    cancelZoomSettle();
    // Suspend PDF.js work before ending a one-finger pan so the renderer never
    // observes an unsuspended gap while the gesture changes from one to two pointers.
    root.dispatchEvent(new window.CustomEvent("workspace:livezoomstart"));
    stopSpringBack({ discard: true });
    stopScrollMomentum();
    endScrollActivity();
    if (gesture.panRafId !== null) cancelAnimationFrame(gesture.panRafId);
    gesture.panRafId = null;
    if (gesture.pinchRafId !== null) cancelAnimationFrame(gesture.pinchRafId);
    gesture.pinchRafId = null;
    const center = midpoint(points[0], points[1]);
    const startZoom = zoomRef.current;
    const rootBounds = root.getBoundingClientRect();
    const documentElement = root.querySelector(".workspace-v2-a4-document") || root;
    const documentBounds = documentElement.getBoundingClientRect();
    const documentAnchor = documentAnchorFromClient(center.x, center.y, documentBounds, startZoom);
    const initialDistance = pointerDistance(points[0], points[1]) || 1;
    gesture.mode = INTERACTION_STATE.PINCHING;
    gesture.pan = null;
    const pinchId = ++gesture.pinchSequence;
    gesture.pinch = {
      id: pinchId,
      active: true,
      initialScale: startZoom,
      currentScale: startZoom,
      displayScale: startZoom,
      initialFingerDistance: initialDistance,
      currentFingerDistance: initialDistance,
      initialFocalX: center.x,
      initialFocalY: center.y,
      currentFocalX: center.x,
      currentFocalY: center.y,
      documentAnchorX: documentAnchor.x,
      documentAnchorY: documentAnchor.y,
      startingScrollLeft: stage.scrollLeft,
      startingScrollTop: stage.scrollTop,
      initialDocumentLeft: rootBounds.left,
      initialDocumentTop: rootBounds.top,
      initialDocumentWidth: rootBounds.width,
      initialDocumentHeight: rootBounds.height,
      viewportLeft: stage.getBoundingClientRect().left,
      viewportTop: stage.getBoundingClientRect().top,
      viewportWidth: stage.clientWidth,
      viewportHeight: stage.clientHeight,
      elasticX: 0,
      elasticY: 0,
      visualOriginX: center.x - rootBounds.left,
      visualOriginY: center.y - rootBounds.top
    };
    root.classList.remove("is-zoom-settling");
    root.classList.remove("is-live-panning");
    root.classList.add("is-live-pinching");
    root.style.transform = "translate3d(0, 0, 0) scale(1)";
    return true;
  }

  function applyLivePinchFrame(pinchId, frameId) {
    const gesture = gestureRef.current;
    if (gesture.pinchRafId !== frameId) return;
    gesture.pinchRafId = null;
    const pinch = gesture.pinch;
    const root = documentRef.current;
    if (!pinch?.active || pinch.id !== pinchId || gesture.mode !== INTERACTION_STATE.PINCHING || !root) return;
    renderLivePinchTransform(pinch);
  }

  function renderLivePinchTransform(pinch) {
    const root = documentRef.current;
    if (!pinch || !root) return;
    // The compositor follows the resisted display scale so a pinch past a zoom
    // limit still tracks the fingers; only `currentScale` may be committed.
    const displayScale = Number.isFinite(pinch.displayScale) ? pinch.displayScale : pinch.currentScale;
    const { ratio, translateX, translateY } = livePinchTransform({
      originX: pinch.visualOriginX,
      originY: pinch.visualOriginY,
      startCenter: { x: pinch.initialFocalX, y: pinch.initialFocalY },
      currentCenter: { x: pinch.currentFocalX, y: pinch.currentFocalY },
      fromScale: pinch.initialScale,
      toScale: displayScale
    });
    const constrained = constrainPinchTranslation({
      translateX,
      translateY,
      ratio,
      contentLeft: pinch.initialDocumentLeft,
      contentTop: pinch.initialDocumentTop,
      contentWidth: pinch.initialDocumentWidth,
      contentHeight: pinch.initialDocumentHeight,
      viewportLeft: pinch.viewportLeft,
      viewportTop: pinch.viewportTop,
      viewportWidth: pinch.viewportWidth,
      viewportHeight: pinch.viewportHeight,
      horizontalEdgeReveal: WORKSPACE_GESTURE.horizontalEdgeReveal,
      verticalEdgeReveal: WORKSPACE_GESTURE.verticalEdgeReveal
    });
    // X always obeys the physical PDF edges. Y remains focal-exact while
    // zooming in and is constrained only while zooming out or two-finger panning.
    pinch.elasticX = resistedDistance(constrained.overflowX, WORKSPACE_GESTURE.pinchElasticLimit);
    if (displayScale <= pinch.initialScale + Number.EPSILON) {
      pinch.elasticY = resistedDistance(constrained.overflowY, WORKSPACE_GESTURE.pinchElasticLimit);
      root.style.transform = `translate3d(${constrained.translateX + pinch.elasticX}px, ${constrained.translateY + pinch.elasticY}px, 0) scale(${ratio})`;
      return;
    }
    pinch.elasticY = 0;
    root.style.transform = `translate3d(${constrained.translateX + pinch.elasticX}px, ${translateY}px, 0) scale(${ratio})`;
  }

  function scheduleLivePinchFrame() {
    const gesture = gestureRef.current;
    const pinchId = gesture.pinch?.id;
    if (gesture.pinchRafId !== null || !pinchId) return;
    let frameId = null;
    frameId = requestAnimationFrame(() => applyLivePinchFrame(pinchId, frameId));
    gesture.pinchRafId = frameId;
  }

  function clearLivePinchTransform() {
    const gesture = gestureRef.current;
    if (gesture.pinch) gesture.pinch.active = false;
    if (gesture.pinchRafId !== null) cancelAnimationFrame(gesture.pinchRafId);
    gesture.pinchRafId = null;
    const root = documentRef.current;
    if (root) {
      root.dispatchEvent(new window.CustomEvent("workspace:livezoomcancel"));
      root.style.transform = "";
      root.classList.remove("is-live-pinching");
      root.classList.remove("is-zoom-settling");
    }
  }

  function commitPinchLegal(pinch, finalZoom) {
    const gesture = gestureRef.current;
    gesture.mode = INTERACTION_STATE.SETTLING;
    gesture.pan = null;
    if (Math.abs(finalZoom - pinch.initialScale) <= Number.EPSILON) {
      const root = documentRef.current;
      const stage = stageRef.current;
      if (root && stage) {
        root.style.transform = "";
        const documentElement = root.querySelector(".workspace-v2-a4-document") || root;
        const documentBounds = documentElement.getBoundingClientRect();
        const next = scrollForDocumentAnchor({
          currentScrollLeft: stage.scrollLeft,
          currentScrollTop: stage.scrollTop,
          documentLeft: documentBounds.left,
          documentTop: documentBounds.top,
          documentAnchorX: pinch.documentAnchorX,
          documentAnchorY: pinch.documentAnchorY,
          scale: finalZoom,
          focalClientX: pinch.currentFocalX,
          focalClientY: pinch.currentFocalY
        });
        const constrainToBounds = finalZoom <= pinch.initialScale + Number.EPSILON;
        const bounds = readerScrollBounds({ preserveCurrent: false });
        stage.scrollLeft = Math.min(bounds.maxScrollLeft, Math.max(bounds.minScrollLeft, next.scrollLeft));
        if (constrainToBounds) {
          stage.scrollTop = Math.min(bounds.maxScrollTop, Math.max(bounds.minScrollTop, next.scrollTop));
        } else {
          stage.scrollTop = next.scrollTop;
        }
        root.classList.remove("is-live-pinching", "is-zoom-settling");
      }
      root?.dispatchEvent(new window.CustomEvent("workspace:livezoomcommit", { detail: { zoom: finalZoom, pinchId: pinch.id } }));
      root?.dispatchEvent(new window.CustomEvent("workspace:zoomgeometrysettled", { detail: { zoom: finalZoom, pinchId: pinch.id } }));
      gesture.pinch = null;
      const springStarted = startPanSpringBack(pinch.elasticX, finalZoom <= pinch.initialScale + Number.EPSILON ? pinch.elasticY : 0);
      if (!springStarted && gesture.touches.size === 0) gesture.mode = INTERACTION_STATE.IDLE;
      return;
    }
    documentRef.current?.classList.add("is-zoom-settling");
    pendingPinchCommitRef.current = {
      pinchId: pinch.id,
      finalZoom,
      currentFocalX: pinch.currentFocalX,
      currentFocalY: pinch.currentFocalY,
      documentAnchorX: pinch.documentAnchorX,
      documentAnchorY: pinch.documentAnchorY,
      startingScrollLeft: pinch.startingScrollLeft,
      startingScrollTop: pinch.startingScrollTop,
      constrainToBounds: finalZoom <= pinch.initialScale + Number.EPSILON,
      elasticX: pinch.elasticX,
      elasticY: pinch.elasticY
    };
    zoomRef.current = finalZoom;
    gesture.pinch = null;
    // Keep the last compositor transform visible while React prepares the new
    // document geometry. A transition lets React yield between chunks instead
    // of blocking the release frame with the entire Workspace render.
    startTransition(() => setZoom(finalZoom));
  }

  /**
   * Ends an in-flight rubber-band zoom animation. Interrupting always finishes
   * the pending commit so committed zoom, `zoomRef`, and the visible transform
   * can never disagree when the next gesture reads them.
   */
  function cancelZoomSettle() {
    const gesture = gestureRef.current;
    if (gesture.zoomSettleRafId !== null) cancelAnimationFrame(gesture.zoomSettleRafId);
    gesture.zoomSettleRafId = null;
    const complete = gesture.zoomSettleComplete;
    gesture.zoomSettleComplete = null;
    complete?.();
  }

  /** Animates a pinch that overshot a zoom limit back to the legal scale. */
  function settleZoomOvershoot(pinch, finalZoom, commit) {
    const gesture = gestureRef.current;
    const from = Number.isFinite(pinch.displayScale) ? pinch.displayScale : finalZoom;
    if (Math.abs(from - finalZoom) < .002 || prefersReducedMotion() || !documentRef.current) {
      pinch.displayScale = finalZoom;
      commit();
      return;
    }
    gesture.mode = INTERACTION_STATE.SETTLING;
    const started = window.performance.now();
    const finish = () => {
      pinch.displayScale = finalZoom;
      renderLivePinchTransform(pinch);
      commit();
    };
    gesture.zoomSettleComplete = finish;
    const step = (now) => {
      const current = gestureRef.current;
      current.zoomSettleRafId = null;
      if (current.zoomSettleComplete !== finish) return;
      const progress = Math.min(1, (now - started) / ZOOM_SETTLE_MS);
      pinch.displayScale = from + (finalZoom - from) * (1 - (1 - progress) ** 3);
      renderLivePinchTransform(pinch);
      if (progress < 1) {
        current.zoomSettleRafId = requestAnimationFrame(step);
        return;
      }
      current.zoomSettleComplete = null;
      finish();
    };
    gesture.zoomSettleRafId = requestAnimationFrame(step);
  }

  function commitLivePinch() {
    const gesture = gestureRef.current;
    const pinch = gesture.pinch;
    if (!pinch?.active) return;
    pinch.active = false;
    if (gesture.pinchRafId !== null) {
      cancelAnimationFrame(gesture.pinchRafId);
      gesture.pinchRafId = null;
    }
    // Paint the most recent raw pointer sample before reconciling compositor
    // geometry with layout. The committed scale is the exact distance ratio;
    // only a rubber-band overshoot is eased, and never past a legal value.
    renderLivePinchTransform(pinch);
    const finalZoom = pinch.currentScale;
    gesture.pinch = null;
    const stage = stageRef.current;
    for (const touch of gesture.touches.values()) {
      try { if (stage?.hasPointerCapture?.(touch.pointerId)) stage.releasePointerCapture(touch.pointerId); } catch { /* Releasing an already-ended pointer is harmless. */ }
    }
    gesture.touches.clear();
    settleZoomOvershoot(pinch, finalZoom, () => commitPinchLegal(pinch, finalZoom));
  }

  function beginWorkspacePointer(event) {
    if (isTypingTarget(event.target) || isStageControl(event.target) || event.button > 0) return;
    const gesture = gestureRef.current;
    stopSpringBack({ discard: true });
    stopScrollMomentum();
    if (event.pointerType === "pen") {
      hideStylusHover();
      gesture.penPointers.set(event.pointerId, pointerSnapshot(event));
      gesture.lastPenAt = Date.now();
      gesture.lastPenPosition = { x: event.clientX, y: event.clientY };
    }
    if (event.pointerType === "touch") {
      if (suspiciousPalmContact({ event, activePenCount: gesture.penPointers.size, lastPenAt: gesture.lastPenAt, lastPenPosition: gesture.lastPenPosition, activeTouchCount: gesture.touches.size })) {
        gesture.rejectedTouches.add(event.pointerId);
        event.preventDefault();
        return;
      }
      gesture.touches.set(event.pointerId, pointerSnapshot(event));
      if (gesture.touches.size === 2) {
        if (gesture.mode === INTERACTION_STATE.PINCHING && gesture.pinch?.active) return;
        if (gesture.drawingPointerType === "pen") commitInterruptedLiveStroke({ pointerId: null });
        clearDraft();
        unlockStageForDrawing(gesture.drawingPointerId);
        gesture.drawingPointerId = null;
        gesture.drawingPointerType = null;
        for (const touch of gesture.touches.values()) {
          try { event.currentTarget.setPointerCapture(touch.pointerId); } catch { /* Capture only begins for the custom two-finger gesture. */ }
        }
        const points = [...gesture.touches.values()];
        startLivePinch(points);
        event.preventDefault();
        debugGesture("pinch-start", event, { prevented: true });
        return;
      }
      if (gesture.touches.size > 2) return;
      if (gesture.drawingPointerType === "pen") {
        try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Capture is progressive enhancement. */ }
        event.preventDefault();
        return;
      }
      const canTouchDraw = pointerCanDraw(event.pointerType, drawingInput);
      if (activeTool === "hand" || !canTouchDraw) {
        // One-finger navigation and two-finger pinch share the same pointer
        // stream, so the second contact upgrades one continuous session instead
        // of forcing the browser to cancel native scrolling and start again.
        beginPan(event, GESTURE_DIRECTION.PENDING);
        try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Pointer capture is progressive enhancement. */ }
        event.preventDefault();
        debugGesture("touch-pan-start", event, { prevented: true });
        return;
      }
    }
    // A second stylus, or a mouse arriving mid-stroke, must not take over the
    // active drawing session: the stroke in progress would be discarded.
    if (gesture.drawingPointerId !== null && gesture.drawingPointerId !== event.pointerId) {
      event.preventDefault();
      return;
    }
    const canDraw = pointerCanDraw(event.pointerType, drawingInput);
    if (activeTool === "hand" || !canDraw) beginPan(event, GESTURE_DIRECTION.PENDING);
    else if (DRAWING_TOOLS.has(activeTool)) beginAnnotation(event);
    let captured = false;
    try { event.currentTarget.setPointerCapture(event.pointerId); captured = true; } catch { /* Pointer capture is progressive enhancement. */ }
    if (gesture.drawingPointerId === event.pointerId) inkInputControllerRef.current.setCapture(captured);
    event.preventDefault();
  }

  function moveWorkspacePointer(event) {
    const gesture = gestureRef.current;
    if (event.pointerType === "pen") updateStylusHover(event);
    if (gesture.drawingPointerId === event.pointerId) {
      event.preventDefault();
      restoreLockedStagePosition();
    }
    if (event.pointerType === "pen") {
      gesture.lastPenAt = Date.now();
      gesture.lastPenPosition = { x: event.clientX, y: event.clientY };
    }
    if (event.pointerType === "touch" && gesture.touches.has(event.pointerId)) {
      const touch = gesture.touches.get(event.pointerId);
      touch.currentX = event.clientX;
      touch.currentY = event.clientY;
    }
    if (gesture.mode === INTERACTION_STATE.PINCHING && gesture.pinch && gesture.touches.size === 2) {
      event.preventDefault();
      const points = [...gesture.touches.values()];
      const focal = midpoint(points[0], points[1]);
      const distance = pointerDistance(points[0], points[1]);
      gesture.pinch.currentFocalX = focal.x;
      gesture.pinch.currentFocalY = focal.y;
      gesture.pinch.currentFingerDistance = distance;
      const rawScale = continuousPinchScale({
        initialScale: gesture.pinch.initialScale,
        initialDistance: gesture.pinch.initialFingerDistance,
        currentDistance: distance,
        minimum: MIN_FOCUS_ZOOM * .2,
        maximum: MAX_FOCUS_ZOOM * 4
      });
      const elasticZoom = elasticZoomScale(rawScale, minimumPdfZoom(), MAX_FOCUS_ZOOM, ZOOM_OVERSHOOT_RATIO);
      gesture.pinch.currentScale = elasticZoom.legal;
      gesture.pinch.displayScale = elasticZoom.display;
      scheduleLivePinchFrame();
      return;
    }
    if ((gesture.mode === INTERACTION_STATE.SETTLING || gesture.mode === INTERACTION_STATE.SPRING_BACK) && event.pointerType === "touch") {
      event.preventDefault();
      return;
    }
    if (gesture.mode === INTERACTION_STATE.PENDING_DIRECTION && gesture.pan?.pointerId === event.pointerId) {
      event.preventDefault();
      const pan = gesture.pan;
      appendRecentPointerSamples(pan.samples, pointerEventSamples(event));
      const direction = classifyGestureDirection(event.clientX - pan.x, event.clientY - pan.y, {
        allowFreePan: true
      });
      if (direction === GESTURE_DIRECTION.PENDING) return;
      pan.direction = direction;
      gesture.mode = interactionStateForDirection(direction);
      startScrollActivity();
      applyPanPosition(pan);
      debugGesture("pan-intent", event, {
        deltaX: event.clientX - pan.x,
        deltaY: event.clientY - pan.y,
        prevented: true
      });
      return;
    }
    if ([INTERACTION_STATE.VERTICAL_SCROLL, INTERACTION_STATE.HORIZONTAL_PAN, INTERACTION_STATE.FREE_PAN].includes(gesture.mode)
      && gesture.pan?.pointerId === event.pointerId) {
      event.preventDefault();
      appendRecentPointerSamples(gesture.pan.samples, pointerEventSamples(event));
      schedulePanFrame();
      return;
    }
    if (gesture.drawingPointerId !== event.pointerId) return;
    event.preventDefault();
    if (gesture.mode === INTERACTION_STATE.ERASING) {
      for (const sample of eventSamples(event, gesture.annotationPage)) eraseAtPoint(sample, gesture.annotationPage);
      return;
    }
    const point = documentPoint(event.clientX, event.clientY, gesture.annotationPage);
    if (gesture.mode === INTERACTION_STATE.OBJECT_TRANSFORMING && transformRef.current) {
      const transform = transformRef.current;
      let after;
      if (transform.kind === "move") {
        after = transform.before.map((item) => translateAnnotation(item, point.x - transform.start.x, point.y - transform.start.y));
      } else {
        const nextBounds = { ...transform.bounds };
        if (transform.handle.includes("left")) { nextBounds.x = Math.min(point.x, transform.bounds.x + transform.bounds.width - 12); nextBounds.width = transform.bounds.x + transform.bounds.width - nextBounds.x; }
        else nextBounds.width = Math.max(12, point.x - transform.bounds.x);
        if (transform.handle.includes("top")) { nextBounds.y = Math.min(point.y, transform.bounds.y + transform.bounds.height - 12); nextBounds.height = transform.bounds.y + transform.bounds.height - nextBounds.y; }
        else nextBounds.height = Math.max(12, point.y - transform.bounds.y);
        after = transform.before.map((item) => resizeAnnotation(item, transform.bounds, nextBounds));
      }
      transform.after = after;
      scheduleObjectTransformPreview();
      return;
    }
    const draft = draftRef.current;
    if (!draft) return;
    if (draft.type === "shape") {
      if (["circle", "square"].includes(draft.shape)) {
        const dx = point.x - draft.start.x;
        const dy = point.y - draft.start.y;
        const size = Math.max(Math.abs(dx), Math.abs(dy));
        setDraft({ ...draft, end: { ...point, x: draft.start.x + Math.sign(dx || 1) * size, y: draft.start.y + Math.sign(dy || 1) * size } });
      } else setDraft({ ...draft, end: point });
    }
    else if (draft.type === "lasso") {
      if (gesture.smartSelectionActivated) return;
      if (draft.mode === "rectangle") setDraft({ ...draft, end: point, points: rectangleLassoPolygon(draft.start, point) });
      else setDraft({ ...draft, end: point, points: [...draft.points, point] });
    }
    else {
      if (gesture.holdRecognition?.kind === "line" && draft.type === "highlighter") {
        const start = draft.points[0];
        setDraft({ ...draft, points: [start, { ...draft.points.at(-1), ...point }] });
        scheduleLiveStrokeDraw();
        return;
      }
      // The controller owns the mutable gesture-local buffer; React only sees
      // the finished annotation command.
      const nativeEvent = event.nativeEvent || event;
      if (inkInputControllerRef.current.hasActivePointer(event.pointerId)) {
        inkInputControllerRef.current.append(nativeEvent);
        gesture.predictedStrokePoints = inkInputControllerRef.current.predicted(nativeEvent);
      } else {
        draft.points.push(...eventSamples(event, gesture.annotationPage));
        gesture.predictedStrokePoints = [];
      }
      scheduleLiveStrokeDraw();
      if (["pen", "pencil", "highlighter"].includes(activeToolRef.current)) scheduleHoldRecognition();
    }
  }

  function finishWorkspacePointer(event) {
    const gesture = gestureRef.current;
    let suppressMomentum = false;
    if (event.pointerType === "touch") {
      if (gesture.rejectedTouches.delete(event.pointerId)) return;
      gesture.touches.delete(event.pointerId);
      try { if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* Pointer capture is progressive enhancement. */ }
      if (gesture.mode === INTERACTION_STATE.PINCHING) {
        commitLivePinch();
        event.preventDefault();
        return;
      }
      if (gesture.mode === INTERACTION_STATE.SETTLING) {
        gesture.pan = null;
        if (gesture.touches.size === 0 && !pendingPinchCommitRef.current) gesture.mode = INTERACTION_STATE.IDLE;
        event.preventDefault();
        return;
      }
      if (gesture.pan?.pointerId === event.pointerId && activeToolRef.current === "hand" && gesture.touches.size === 0) {
        const isTap = Math.hypot(event.clientX - gesture.pan.x, event.clientY - gesture.pan.y) < 14;
        const previousTap = gesture.lastTap;
        if (isTap && previousTap && event.timeStamp - previousTap.time < WORKSPACE_GESTURE.doubleTapDelayMs && Math.hypot(event.clientX - previousTap.x, event.clientY - previousTap.y) < WORKSPACE_GESTURE.doubleTapDistance) {
          gesture.lastTap = null;
          suppressMomentum = true;
          smartZoom({ clientX: event.clientX, clientY: event.clientY });
          event.preventDefault();
        } else if (isTap) gesture.lastTap = { x: event.clientX, y: event.clientY, time: event.timeStamp };
      }
    }
    if (event.pointerType === "pen") {
      gesture.penPointers.delete(event.pointerId);
      gesture.lastPenAt = Date.now();
    }
    if (event.pointerType === "mouse" && gesture.pan?.pointerId === event.pointerId && activeToolRef.current === "hand") {
      const isClick = Math.hypot(event.clientX - gesture.pan.x, event.clientY - gesture.pan.y) < 8;
      const previousClick = gesture.lastTap;
      if (isClick && previousClick && event.timeStamp - previousClick.time < 310 && Math.hypot(event.clientX - previousClick.x, event.clientY - previousClick.y) < 20) {
        gesture.lastTap = null;
        smartZoom({ clientX: event.clientX, clientY: event.clientY });
      } else if (isClick) gesture.lastTap = { x: event.clientX, y: event.clientY, time: event.timeStamp };
    }
    if (gesture.pan?.pointerId === event.pointerId) {
      const completedPan = gesture.pan;
      const pendingDirection = completedPan.direction === GESTURE_DIRECTION.PENDING;
      const lastSample = completedPan.samples[completedPan.samples.length - 1];
      if (!lastSample || Math.hypot(event.clientX - lastSample.x, event.clientY - lastSample.y) > .5) {
        appendRecentPointerSamples(completedPan.samples, [{ x: event.clientX, y: event.clientY, time: event.timeStamp }]);
      }
      if (gesture.panRafId !== null) cancelAnimationFrame(gesture.panRafId);
      gesture.panRafId = null;
      if (!pendingDirection) applyPanPosition(completedPan);
      gesture.pan = null;
      gesture.mode = INTERACTION_STATE.IDLE;
      const hasElasticOffset = !pendingDirection && (Math.abs(completedPan.elasticX) > .1 || Math.abs(completedPan.elasticY) > .1);
      const releaseVelocity = pendingDirection
        ? { x: 0, y: 0, speed: 0 }
        : lockedGestureVelocity(completedPan.direction, estimateReleaseScrollVelocity(completedPan.samples, event.timeStamp));
      if (hasElasticOffset) startPanSpringBack(completedPan.elasticX, completedPan.elasticY, releaseVelocity);
      else {
        documentRef.current?.classList.remove("is-live-panning");
        if (documentRef.current) documentRef.current.style.transform = "";
        const momentumStarted = event.pointerType === "touch" && !suppressMomentum && startScrollMomentum(releaseVelocity);
        if (!momentumStarted) endScrollActivity();
      }
      if (event.pointerType === "touch") event.preventDefault();
    }
    if (gesture.drawingPointerId !== event.pointerId) return;
    const activeDraft = draftRef.current;
    if (isLiveStroke(activeDraft) && !gesture.holdRecognition && inkInputControllerRef.current.hasActivePointer(event.pointerId)) {
      inkInputControllerRef.current.finish(event.nativeEvent || event);
      gesture.predictedStrokePoints = [];
      if (gesture.liveStrokeRafId !== null) cancelAnimationFrame(gesture.liveStrokeRafId);
      gesture.liveStrokeRafId = null;
      if (liveStrokeCanvasRef.current?.pageNumber === activeDraft.page) {
        const metrics = performanceMonitorRef.current.measure("drawingFrame", () => liveStrokeCanvasRef.current.draw(activeDraft, inkDebugEnabled ? inkInputControllerRef.current.getDiagnostics() : null));
        if (metrics?.geometryTime >= 0) performanceMonitorRef.current.record("geometryTime", metrics.geometryTime);
      }
    } else if (gesture.holdRecognition) inkInputControllerRef.current.cancel("held-shape");
    if (gesture.holdTimerId !== null) window.clearTimeout(gesture.holdTimerId);
    gesture.holdTimerId = null;
    const draft = draftRef.current;
    if (gesture.mode === INTERACTION_STATE.ERASING) commitEraserGesture();
    if (gesture.mode === INTERACTION_STATE.OBJECT_TRANSFORMING && transformRef.current?.after) {
      if (gesture.transformRafId !== null) cancelAnimationFrame(gesture.transformRafId);
      gesture.transformRafId = null;
      applyObjectTransformPreview(transformRef.current.after);
      recordCommand({ type: "update", before: transformRef.current.before, after: transformRef.current.after });
    }
    let handedOffInk = null;
    if (draft?.type === "lasso") {
      const polygon = draft.points;
      const ids = polygon.length >= 3 ? lassoSelectionIds(polygon, draft.page) : [];
      setSelectedIds(ids);
    } else if (draft) {
      const meaningful = draft.type === "shape"
        ? Math.abs(draft.end.x - draft.start.x) > 4 || Math.abs(draft.end.y - draft.start.y) > 4
        : isLiveStroke(draft) ? draft.points?.length > 0 : draft.points?.length > 1;
      if (meaningful) {
        const committed = isLiveStroke(draft) ? { ...draft, points: [...draft.points] } : draft;
        if (gesture.holdRecognition && gesture.holdRawStroke && draft.type === "shape") {
          runCommand({ type: "replace", before: [gesture.holdRawStroke], after: [committed] });
        } else {
          const scribbled = isLiveStroke(committed) ? scribbleEraseTargets(draft) : [];
          if (scribbled.length) runCommand({ type: "remove", items: scribbled });
          else {
            runCommand({ type: "add", items: [committed] });
            if (isLiveStroke(committed)) handedOffInk = committed.id;
          }
        }
      }
    }
    if (handedOffInk) inkHandoffRef.current = { id: handedOffInk, page: draft.page };
    clearDraft({ keepCanvas: Boolean(handedOffInk) });
    gesture.holdRawStroke = null;
    gesture.holdRecognition = null;
    gesture.holdAnchorPoint = null;
    gesture.smartSelectionActivated = false;
    transformRef.current = null;
    unlockStageForDrawing(event.pointerId);
    gesture.drawingPointerId = null;
    gesture.drawingPointerType = null;
    gesture.mode = INTERACTION_STATE.IDLE;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function cancelWorkspacePointer(event) {
    const gesture = gestureRef.current;
    if (event.pointerType === "touch" && gesture.rejectedTouches.delete(event.pointerId)) {
      debugGesture("rejected-touch-cancel", event);
      return;
    }
    stopScrollMomentum();
    endScrollActivity();
    stopSpringBack({ discard: true });
    if (gesture.panRafId !== null) cancelAnimationFrame(gesture.panRafId);
    gesture.panRafId = null;
    const root = documentRef.current;
    if ([INTERACTION_STATE.PENDING_DIRECTION, INTERACTION_STATE.VERTICAL_SCROLL, INTERACTION_STATE.HORIZONTAL_PAN, INTERACTION_STATE.FREE_PAN].includes(gesture.mode)) {
      root?.classList.remove("is-live-panning");
      if (root) root.style.transform = "";
    }
    if (gesture.mode === INTERACTION_STATE.PINCHING) {
      pendingPinchCommitRef.current = null;
      clearLivePinchTransform();
    }
    if (gesture.zoomSettleRafId !== null) cancelAnimationFrame(gesture.zoomSettleRafId);
    gesture.zoomSettleRafId = null;
    gesture.zoomSettleComplete = null;
    gesture.touches.clear();
    gesture.penPointers.delete(event.pointerId);
    gesture.rejectedTouches.delete(event.pointerId);
    if (isLiveStroke(draftRef.current) && inkInputControllerRef.current.hasActivePointer(event.pointerId)) {
      inkInputControllerRef.current.finish(event.nativeEvent || event, "pointercancel");
      gesture.predictedStrokePoints = [];
    } else inkInputControllerRef.current.cancel("pointercancel");
    if (gesture.mode === INTERACTION_STATE.OBJECT_TRANSFORMING && transformRef.current?.before) {
      if (gesture.transformRafId !== null) cancelAnimationFrame(gesture.transformRafId);
      gesture.transformRafId = null;
      const replacements = new Map(transformRef.current.before.map((item) => [item.id, item]));
      updateAnnotations((items) => items.map((item) => replacements.get(item.id) || item));
    }
    clearEraserPreview();
    commitInterruptedLiveStroke(event);
    clearDraft();
    gesture.holdRawStroke = null;
    gesture.holdRecognition = null;
    gesture.holdAnchorPoint = null;
    gesture.smartSelectionActivated = false;
    transformRef.current = null;
    unlockStageForDrawing(event.pointerId ?? null);
    gesture.mode = INTERACTION_STATE.IDLE;
    gesture.drawingPointerId = null;
    gesture.drawingPointerType = null;
    gesture.pan = null;
    gesture.pinch = null;
    gesture.lastTap = null;
    debugGesture("pointer-cancel", event);
  }

  function lostWorkspacePointer(event) {
    const gesture = gestureRef.current;
    if (gesture.drawingPointerId !== event.pointerId) return;
    if (isLiveStroke(draftRef.current) && inkInputControllerRef.current.hasActivePointer(event.pointerId)) {
      inkInputControllerRef.current.lostCapture(event.nativeEvent || event);
      gesture.predictedStrokePoints = [];
    }
    cancelWorkspacePointer(event);
  }
  cancelInteractionRef.current = cancelWorkspacePointer;

  function zoomTo(nextZoom, clientX, clientY) {
    stopScrollMomentum();
    cancelZoomSettle();
    const gesture = gestureRef.current;
    if (wheelZoomEndTimerRef.current) {
      window.clearTimeout(wheelZoomEndTimerRef.current);
      wheelZoomEndTimerRef.current = null;
    }
    if (gesture.pinch?.source === "wheel") {
      clearLivePinchTransform();
      gesture.pinch = null;
      gesture.mode = INTERACTION_STATE.IDLE;
    }
    const stage = stageRef.current;
    if (!stage) return;
    const bounds = stage.getBoundingClientRect();
    const x = clientX ?? bounds.left + bounds.width / 2;
    const y = clientY ?? bounds.top + bounds.height / 2;
    const anchored = zoomScrollForAnchor({ scrollLeft: stage.scrollLeft, scrollTop: stage.scrollTop, viewportLeft: bounds.left, viewportTop: bounds.top, clientX: x, clientY: y, fromScale: zoomRef.current, toScale: clampReaderZoom(nextZoom) });
    zoomRef.current = anchored.zoom;
    setZoom(anchored.zoom);
    requestAnimationFrame(() => { stage.scrollLeft = anchored.scrollLeft; stage.scrollTop = anchored.scrollTop; });
  }

  function smartZoom(event) {
    if (activeTool !== "hand") return;
    const next = zoomRef.current < 1.75 ? 2 : fitWidthZoom(stageRef.current.clientWidth, sheet?.pdfUrl ? A4_PAGE_WIDTH : PAGE_WIDTH, 0);
    zoomTo(next, event.clientX, event.clientY);
  }

  function jumpToPagePosition(nextPage, point = null) {
    stopScrollMomentum();
    const targetPage = Math.min(accessiblePageCount, Math.max(1, Number(nextPage) || 1));
    setPage(targetPage);
    const stage = stageRef.current;
    const target = sheet?.pdfUrl ? stage?.querySelector(`[data-pdf-page="${targetPage}"]`) : documentRef.current;
    if (!stage || !target) return;
    const stageBounds = stage.getBoundingClientRect();
    const targetBounds = target.getBoundingClientRect();
    const targetTop = targetBounds.top - stageBounds.top + stage.scrollTop;
    const targetLeft = targetBounds.left - stageBounds.left + stage.scrollLeft;
    const top = point
      ? targetTop + (Math.min(1000, Math.max(0, point.y)) / 1000) * targetBounds.height - stage.clientHeight * 0.32
      : targetTop;
    const left = point
      ? targetLeft + (Math.min(1000, Math.max(0, point.x)) / 1000) * targetBounds.width - stage.clientWidth * 0.5
      : stage.scrollLeft;
    stage.scrollTo({
      top: Math.max(0, top),
      left: Math.max(0, left),
      behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"
    });
    if (window.matchMedia?.("(max-width: 820px)").matches) setOpenSurface(null);
  }

  function openNote(note) {
    setSelectedIds([]);
    jumpToPagePosition(note.page);
    setFocusMessage(`Opened note from page ${note.page}.`);
  }

  function openHighlight(highlight) {
    const bounds = annotationBounds(highlight);
    setActiveTool("select");
    setOpenSurface(null);
    setSelectedIds([highlight.id]);
    jumpToPagePosition(highlight.page, bounds ? { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 } : null);
    setFocusMessage(`Opened highlight on page ${highlight.page}.`);
  }

  function handleWheel(event) {
    if (!event.ctrlKey) {
      const stage = stageRef.current;
      if (!stage || !sheet?.pdfUrl) return;
      event.preventDefault();
      stopScrollMomentum({ endActivity: false });
      const bounds = readerScrollBounds();
      const multiplier = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? Math.max(1, stage.clientHeight) : 1;
      // A trackpad reports its horizontal component in deltaX and a mouse wheel
      // reports Shift-scroll in deltaY. Both have to reach a zoomed page or the
      // document simply cannot be moved sideways with a pointing device.
      const shiftPansHorizontally = event.shiftKey && !event.deltaX;
      const horizontalDelta = (shiftPansHorizontally ? event.deltaY : event.deltaX) * multiplier;
      const verticalDelta = (shiftPansHorizontally ? 0 : event.deltaY) * multiplier;
      if (horizontalDelta) stage.scrollLeft = Math.min(bounds.maxScrollLeft, Math.max(bounds.minScrollLeft, stage.scrollLeft + horizontalDelta));
      if (verticalDelta) stage.scrollTop = Math.min(bounds.maxScrollTop, Math.max(bounds.minScrollTop, stage.scrollTop + verticalDelta));
      return;
    }
    event.preventDefault();
    const gesture = gestureRef.current;
    if (gesture.touches.size >= 2) return;
    if (!gesture.pinch || gesture.pinch.source !== "wheel") {
      const halfSpan = 48;
      const started = startLivePinch([
        { currentX: event.clientX - halfSpan, currentY: event.clientY },
        { currentX: event.clientX + halfSpan, currentY: event.clientY }
      ]);
      if (!started) return;
      gesture.pinch.source = "wheel";
    }
    gesture.pinch.currentFocalX = event.clientX;
    gesture.pinch.currentFocalY = event.clientY;
    gesture.pinch.currentScale = clampReaderZoom(
      gesture.pinch.currentScale * Math.exp(-event.deltaY * WORKSPACE_ZOOM.wheelSensitivity)
    );
    gesture.pinch.displayScale = gesture.pinch.currentScale;
    scheduleLivePinchFrame();
    if (wheelZoomEndTimerRef.current) window.clearTimeout(wheelZoomEndTimerRef.current);
    wheelZoomEndTimerRef.current = window.setTimeout(() => {
      wheelZoomEndTimerRef.current = null;
      if (gestureRef.current.pinch?.source !== "wheel") return;
      commitLivePinch();
    }, WORKSPACE_ZOOM.wheelSettleMs);
  }
  wheelHandlerRef.current = handleWheel;
  jumpToPageRef.current = jumpToPagePosition;

  function selectTool(nextTool) {
    if (nextTool === "note") {
      const openingNotes = openSurface !== "notes";
      setSideTab("notes");
      setOpenSurface(openingNotes ? "notes" : null);
      if (openingNotes) window.setTimeout(() => noteRef.current?.focus(), 0);
      return;
    }
    if (nextTool === "image") {
      setOpenSurface(null);
      imageInputRef.current?.click();
      return;
    }
    if (nextTool === activeTool) {
      if (CONFIGURABLE_TOOLS.has(nextTool)) {
        setOpenSurface((current) => current === `tool:${nextTool}` ? null : `tool:${nextTool}`);
        setCustomColorEditorOpen(false);
      }
      return;
    }
    const rememberedProfile = nextTool === "pen" ? String(toolMemoryRef.current.lastPenProfile || PEN_PROFILE.BALL) : penProfile;
    const remembered = toolMemoryRef.current[nextTool === "pen" ? `pen:${rememberedProfile}` : nextTool];
    if (nextTool === "pen") setPenProfile(rememberedProfile);
    if (remembered) {
      setActiveColor(remembered.color || COLORS[0]);
      setBrushSize(Number(remembered.size) || 4);
      setPressureSensitivity(Number.isFinite(Number(remembered.pressureSensitivity)) ? Number(remembered.pressureSensitivity) : .55);
      setStrokeSmoothing(Number.isFinite(Number(remembered.smoothing)) ? Number(remembered.smoothing) : .5);
      if (nextTool === "highlighter") setHighlighterOpacity(Number(remembered.opacity) || .34);
      else if (nextTool === "pencil") setPencilOpacity(Number(remembered.opacity) || .78);
      else setBrushOpacity(Number(remembered.opacity) || 1);
      if (nextTool === "eraser" && remembered.eraserMode) setEraserMode(remembered.eraserMode);
      if (nextTool === "shapes" && remembered.shapeStyle) setShapeStyle(remembered.shapeStyle);
    }
    setActiveTool(nextTool);
    setOpenSurface(null);
    setCustomColorEditorOpen(false);
    if (nextTool !== "select") setSelectedIds([]);
  }

  function changePenProfile(nextProfile) {
    const remembered = toolMemoryRef.current[`pen:${nextProfile}`];
    setPenProfile(nextProfile);
    if (!remembered) {
      setBrushSize(nextProfile === PEN_PROFILE.BRUSH ? 5 : 4);
      setPressureSensitivity(nextProfile === PEN_PROFILE.BALL ? .35 : nextProfile === PEN_PROFILE.FOUNTAIN ? .6 : .82);
      setStrokeSmoothing(nextProfile === PEN_PROFILE.BALL ? .42 : nextProfile === PEN_PROFILE.FOUNTAIN ? .56 : .62);
      return;
    }
    setActiveColor(remembered.color || activeColor);
    setBrushSize(Number(remembered.size) || 4);
    setPressureSensitivity(Number.isFinite(Number(remembered.pressureSensitivity)) ? Number(remembered.pressureSensitivity) : .55);
    setStrokeSmoothing(Number.isFinite(Number(remembered.smoothing)) ? Number(remembered.smoothing) : .5);
  }

  function chooseAnnotationColor(color) {
    const normalized = normalizeToolColor(color) || activeColor;
    updateSelectionColor(normalized);
  }

  function commitCustomColor() {
    const normalized = normalizeToolColor(customColorDraft);
    if (!normalized) return;
    if (!paletteColors.includes(normalized) && paletteColors.length >= MAX_PALETTE_COLORS) return;
    setRecentColors((items) => addSavedColor(items, normalized, MAX_PALETTE_COLORS, COLORS));
    updateSelectionColor(normalized);
    setCustomColorEditorOpen(false);
  }

  function deleteCustomColor(color) {
    const normalized = normalizeToolColor(color);
    if (!normalized) return;
    const nextColors = removeSavedColor(recentColors, normalized, MAX_PALETTE_COLORS, COLORS);
    setRecentColors(nextColors);
    if (activeColor === normalized) setActiveColor(normalizeSavedPalette([...COLORS, ...nextColors], MAX_PALETTE_COLORS)[0] || COLORS[0]);
    if (customColorDraft === normalized) setCustomColorDraft(COLORS[0]);
  }

  function changeDrawingInput(value) {
    setDrawingInput(value);
    try { window.localStorage.setItem("lock-in.catalog-workspace.drawing-input", value); } catch { /* This non-sensitive preference can remain in memory. */ }
  }

  function addImage(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !file.type.startsWith("image/")) { setFocusMessage("Choose a PNG, JPEG, WebP, or GIF image."); return; }
    if (file.size > 2_000_000) { setFocusMessage("Use an image smaller than 2 MB so the local workspace stays responsive."); return; }
    const reader = new window.FileReader();
    reader.onload = () => {
      runCommand({ type: "add", items: [{ id: generateIdempotencyKey(), page, type: "image", src: String(reader.result), x: 350, y: 300, width: 300, height: 220, opacity: 1, color: activeColor }] });
      setFocusMessage("Image added and queued for local autosave.");
    };
    reader.onerror = () => setFocusMessage("The selected image could not be read.");
    reader.readAsDataURL(file);
  }

  function duplicateSelection() {
    if (!selectedAnnotations.length) return;
    const copies = selectedAnnotations.map((item) => translateAnnotation({ ...cloneAnnotation(item), id: generateIdempotencyKey() }, 20, 20));
    runCommand({ type: "add", items: copies });
    setSelectedIds(copies.map((item) => item.id));
  }

  function copySelection() {
    if (!selectedAnnotations.length) return;
    selectionClipboardRef.current = selectedAnnotations.map(cloneAnnotation);
    setFocusMessage(`${selectedAnnotations.length} annotation${selectedAnnotations.length === 1 ? "" : "s"} copied.`);
  }

  function cutSelection() {
    if (!selectedAnnotations.length) return;
    selectionClipboardRef.current = selectedAnnotations.map(cloneAnnotation);
    runCommand({ type: "remove", items: selectedAnnotations });
    setSelectedIds([]);
    setFocusMessage(`${selectedAnnotations.length} annotation${selectedAnnotations.length === 1 ? "" : "s"} cut.`);
  }

  function pasteSelection() {
    if (!selectionClipboardRef.current.length) return;
    const copies = selectionClipboardRef.current.map((item) => translateAnnotation({ ...cloneAnnotation(item), id: generateIdempotencyKey(), page }, 24, 24));
    runCommand({ type: "add", items: copies });
    setSelectedIds(copies.map((item) => item.id));
  }

  function rotateSelection() {
    if (!selectedAnnotations.length || !selectedBounds) return;
    const after = selectedAnnotations.map((item) => rotateAnnotation(item, selectedBounds));
    runCommand({ type: "update", before: selectedAnnotations, after });
  }

  function updateSelectionColor(color) {
    setActiveColor(color);
    if (!selectedAnnotations.length || activeTool !== "select") return;
    const after = selectedAnnotations.map((item) => ({ ...item, color }));
    runCommand({ type: "update", before: selectedAnnotations, after });
  }

  function chooseNormalStudy() {
    setStudyMode("normal");
    setModeDialogOpen(false);
    setActiveStudyError("");
  }

  async function chooseActiveStudy() {
    if (activeStudyBusy || !sheet?.isTestSheet) return;
    setActiveStudyBusy(true);
    setActiveStudyError("");
    try {
      const payload = await focusApi.startActiveStudy({ materialSlug, sheetSlug, difficulty: activeDifficulty, pageCount });
      const run = /** @type {any} */ (payload.run);
      setActiveStudy(run);
      setActiveDifficulty(run.difficulty);
      setStudyMode("active");
      setModeDialogOpen(false);
      setPage(1);
      requestAnimationFrame(() => jumpToPagePosition(1));
      setFocusMessage(payload.resumed ? "Active Study resumed." : "Active Study started. Pages 1–3 are unlocked.");
    } catch (error) {
      setActiveStudyError(error.message || "Active Study could not be started.");
    } finally {
      setActiveStudyBusy(false);
    }
  }

  async function openActiveQuiz() {
    if (!activeStudy || activeStudyBusy || page < activeStudy.unlocked_pages) return;
    setActiveStudyBusy(true);
    setActiveStudyError("");
    try {
      const payload = await focusApi.getActiveStudyQuiz(activeStudy.id);
      setActiveStudy(payload.run);
      setActiveQuiz(payload);
      setActiveAnswers({});
      setActiveResult(null);
    } catch (error) {
      setFocusMessage(error.message || "The Active Study test could not be loaded.");
    } finally {
      setActiveStudyBusy(false);
    }
  }

  async function submitActiveQuiz() {
    if (!activeStudy || activeStudyBusy) return;
    setActiveStudyBusy(true);
    try {
      const payload = await focusApi.submitActiveStudyQuiz(activeStudy.id, activeAnswers);
      setActiveStudy(payload.run);
      setActiveResult(payload.result);
    } catch (error) {
      setFocusMessage(error.message || "The Active Study test could not be submitted.");
    } finally {
      setActiveStudyBusy(false);
    }
  }

  async function continueActiveStudyAnyway() {
    if (!activeStudy || activeStudyBusy) return;
    setActiveStudyBusy(true);
    try {
      const payload = await focusApi.continueActiveStudy(activeStudy.id);
      const run = /** @type {any} */ (payload.run);
      setActiveStudy(run);
      setActiveQuiz(null);
      setActiveResult(null);
      setActiveAnswers({});
      setFocusMessage(`Pages 1–${run.unlocked_pages} are now unlocked. A retake is still recommended.`);
    } catch (error) {
      setFocusMessage(error.message || "The next pages could not be unlocked.");
    } finally {
      setActiveStudyBusy(false);
    }
  }

  async function retakeActiveQuiz() {
    setActiveQuiz(null);
    setActiveResult(null);
    setActiveAnswers({});
    await openActiveQuiz();
  }

  function dismissActiveQuiz() {
    setActiveQuiz(null);
    setActiveResult(null);
    setActiveAnswers({});
  }

  async function saveNote() {
    const body = noteDraft.trim();
    if (!body || noteBusy) return;
    const savedPage = page;
    const timestamp = new Date().toISOString();
    const localNote = { id: generateIdempotencyKey(), page: savedPage, body, createdAt: timestamp, updatedAt: timestamp };
    setNotes((current) => [...current, localNote]);
    setNoteDraft("");
    setFocusMessage(`Note saved to page ${savedPage}.`);
    if (!focusPayload?.session?.id) return;
    setNoteBusy(true);
    try {
      const updated = await focusApi.updateLockInNote(focusPayload.session.id, { body, expectedRevision: focusPayload.note?.revision || null });
      setFocusPayload(updated);
      setFocusMessage(`Note saved to page ${savedPage} and the current Focus session.`);
    } catch (error) { setFocusMessage(`Note saved to page ${savedPage} on this device. ${error.message || "Focus session sync failed."}`); }
    finally { setNoteBusy(false); }
  }

  async function toggleBookmark() {
    if (bookmarkBusy) return;
    const nextBookmarked = !bookmarked;
    setBookmarked(nextBookmarked);
    setBookmarkBusy(true);
    setFocusMessage("");
    try {
      if (nextBookmarked) {
        await progressApi.createCatalogBookmark({
          materialSlug,
          materialTitle: material.title,
          sheetSlug,
          sheetTitle: sheet.title,
          position: { page, zoom: Number(zoom.toFixed(3)) }
        });
        setFocusMessage("Sheet saved to Bookmarks.");
      } else {
        await progressApi.removeCatalogBookmark(materialSlug, sheetSlug);
        setFocusMessage("Sheet removed from Bookmarks.");
      }
    } catch (error) {
      setBookmarked(!nextBookmarked);
      setFocusMessage(error.message || "Bookmark could not be updated.");
    } finally {
      setBookmarkBusy(false);
    }
  }

  async function toggleDocumentFullscreen() {
    setOpenSurface(null);
    try {
      if (isDocumentFullscreen && !document.fullscreenElement) setIsDocumentFullscreen(false);
      else if (document.fullscreenElement === rootRef.current) await document.exitFullscreen();
      else if (rootRef.current?.requestFullscreen) await rootRef.current.requestFullscreen();
      else setIsDocumentFullscreen(true);
    } catch { setFocusMessage("Fullscreen is not available in this browser."); }
  }

  function commitPageJump() {
    const target = Number.parseInt(pageJumpDraft, 10);
    if (!Number.isFinite(target)) {
      setPageJumpDraft(String(page));
      return;
    }
    const clamped = Math.min(accessiblePageCount, Math.max(1, target));
    setPageJumpDraft(String(clamped));
    if (clamped !== page) jumpToPagePosition(clamped);
  }

  function zoomByStep(factor) {
    const stage = stageRef.current;
    if (!stage) return;
    const bounds = stage.getBoundingClientRect();
    zoomTo(zoomRef.current * factor, bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
  }

  function exportWorkspaceBackup() {
    const payload = buildExportPayload({
      materialSlug,
      sheetSlug,
      materialTitle: material?.title || "",
      sheetTitle: sheet?.title || "",
      annotations: annotationsRef.current,
      notes: notesRef.current,
      view: {
        page: pageRef.current,
        zoom: zoomRef.current,
        scrollLeft: viewPositionRef.current.left,
        scrollTop: viewPositionRef.current.top,
        pageOffset: viewPositionRef.current.pageOffset
      }
    });
    if (!payload.annotations.length && !payload.notes.length) {
      setFocusMessage("There is nothing to back up on this sheet yet.");
      return;
    }
    const blob = new window.Blob([JSON.stringify(payload)], { type: "application/json" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = exportFileName({ materialSlug, sheetSlug, savedAt: payload.savedAt });
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => window.URL.revokeObjectURL(url), 0);
    setFocusMessage(`Backed up ${payload.annotations.length} mark${payload.annotations.length === 1 ? "" : "s"} and ${payload.notes.length} note${payload.notes.length === 1 ? "" : "s"}.`);
  }

  /** Restore only ever adds. Existing ids are left exactly as they are. */
  function applyRestoredBackup(payload) {
    const { merged: mergedAnnotations, added, skipped } = mergeRestoredAnnotations(annotationsRef.current, payload.annotations);
    const { merged: mergedNotes, added: addedNotes } = mergeRestoredNotes(notesRef.current, payload.notes);
    if (addedNotes) {
      notesRef.current = mergedNotes;
      setNotes(mergedNotes);
    }
    if (added) {
      const additions = mergedAnnotations.slice(annotationsRef.current.length);
      runCommand({ type: "add", items: additions });
    }
    setPendingImport(null);
    if (!added && !addedNotes) setFocusMessage("Everything in that backup is already on this sheet.");
    else setFocusMessage(`Restored ${added} mark${added === 1 ? "" : "s"} and ${addedNotes} note${addedNotes === 1 ? "" : "s"}.${skipped ? ` ${skipped} already present.` : ""}`);
  }

  async function readWorkspaceBackup(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBackupBusy(true);
    setPendingImport(null);
    try {
      const text = await file.text();
      const result = parseImportPayload(text, { materialSlug, sheetSlug });
      if (!result.ok) {
        setFocusMessage(result.reason);
        return;
      }
      if (!result.matchesDocument) {
        // A backup from another sheet is never merged silently.
        setPendingImport(result.payload);
        setFocusMessage("That backup belongs to a different sheet.");
        return;
      }
      applyRestoredBackup(result.payload);
    } catch {
      setFocusMessage("That backup could not be read.");
    } finally {
      setBackupBusy(false);
    }
  }

  function clearPageAnnotations() {
    const items = annotationsRef.current.filter((item) => item.page === page);
    if (!items.length) return;
    runCommand({ type: "remove", items });
    setSelectedIds([]);
    setFocusMessage(`${items.length} mark${items.length === 1 ? "" : "s"} cleared from page ${page}. Undo restores them.`);
  }

  function fitPdfWidth() {
    const stage = stageRef.current;
    if (!stage) return;
    const bounds = stage.getBoundingClientRect();
    zoomTo(minimumPdfZoom(), bounds.left + bounds.width / 2, bounds.top + Math.min(bounds.height / 2, 180));
    setFocusMessage("PDF fitted to width.");
  }

  if (!material || !sheet) return <main className="workspace-v2 workspace-v2-missing"><h1>Workspace unavailable</h1><button type="button" onClick={() => navigate("/materials")}>Back to materials</button></main>;

  const saveLabel = saveState === "saving" ? "Saving…" : saveState === "error" ? "Local save unavailable" : "Saved on this device";
  const activeToolLabel = TOOL_ITEMS.find(([id]) => id === activeTool)?.[1] || "Tool";
  const customColors = addSavedColor(recentColors, null, MAX_PALETTE_COLORS, COLORS);
  const customColorSet = new Set(customColors);
  const paletteColors = normalizeSavedPalette([...COLORS, ...customColors], MAX_PALETTE_COLORS);
  const activeToolOpacity = activeTool === "highlighter" ? highlighterOpacity : activeTool === "pencil" ? pencilOpacity : brushOpacity;
  const inkToolActive = ["pen", "pencil", "highlighter", "shapes"].includes(activeTool);
  // The lasso only offers colours while they have something to recolour.
  const showColorPalette = inkToolActive || (activeTool === "select" && selectedAnnotations.length > 0);
  const pageNavigatorOpen = openSurface === "pages";

  function updateActiveToolOpacity(value) {
    const rounded = Math.round(value * 100) / 100;
    if (activeTool === "highlighter") setHighlighterOpacity(rounded);
    else if (activeTool === "pencil") setPencilOpacity(rounded);
    else setBrushOpacity(rounded);
  }

  function renderSelectionMenu() {
    if (!selectedBounds) return null;
    const stopPointer = (event) => event.stopPropagation();
    return <div className="workspace-v2-selection-menu" style={{ left: `${(selectedBounds.x + selectedBounds.width / 2) / 10}%`, top: `${Math.max(1, selectedBounds.y / 10)}%` }}>
      <button type="button" onPointerDown={stopPointer} onClick={copySelection}><Copy size={15} />Copy</button>
      <button type="button" onPointerDown={stopPointer} onClick={cutSelection}><Scissors size={15} />Cut</button>
      <button type="button" onPointerDown={stopPointer} onClick={pasteSelection} disabled={!selectionClipboardRef.current.length}><ClipboardPaste size={15} />Paste</button>
      <button type="button" onPointerDown={stopPointer} onClick={duplicateSelection}><Copy size={15} />Duplicate</button>
      <button type="button" onPointerDown={stopPointer} onClick={rotateSelection}><RotateCw size={15} />Rotate</button>
      <button type="button" className="is-danger" onPointerDown={stopPointer} onClick={() => { runCommand({ type: "remove", items: selectedAnnotations }); setSelectedIds([]); }}><Eraser size={15} />Delete</button>
    </div>;
  }

  function renderPdfPageOverlay(pageNumber) {
    const annotationsOnPage = annotationsByPage.get(pageNumber) || NO_ANNOTATIONS;
    const pageIsCurrent = pageNumber === page;
    const handleRadius = 11 * pageUnitsPerCssPixel(pageNumber);
    return <>
      <svg className={annotationLayerClass} viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-label={`Annotations for PDF page ${pageNumber}`}>
        <AnnotationVisuals annotations={annotationsOnPage} prefix={`page-${pageNumber}`} includeHitTargets={activeTool === "select"} />
        {pageIsCurrent && draftAnnotation && draftAnnotation.type !== "lasso" && <WorkspaceAnnotation annotation={draftAnnotation} draft />}
        {pageIsCurrent && selectedBounds && <g className="workspace-v2-selection-box">
          <rect x={selectedBounds.x} y={selectedBounds.y} width={selectedBounds.width} height={selectedBounds.height} />
          {[["top-left", selectedBounds.x, selectedBounds.y], ["top-right", selectedBounds.x + selectedBounds.width, selectedBounds.y], ["bottom-left", selectedBounds.x, selectedBounds.y + selectedBounds.height], ["bottom-right", selectedBounds.x + selectedBounds.width, selectedBounds.y + selectedBounds.height]].map(([handle, x, y]) => <circle key={handle} data-resize-handle={handle} cx={x} cy={y} r={handleRadius} />)}
        </g>}
      </svg>
      {pageIsCurrent && <LiveAnnotationCanvas ref={liveStrokeCanvasRef} pageNumber={pageNumber} />}
      {pageIsCurrent && renderSelectionMenu()}
    </>;
  }

  return (
    <main className={`workspace-v2${isDocumentFullscreen ? " is-document-fullscreen" : ""}`} ref={rootRef} aria-label={`${sheet.title} Focus Workspace`}>
      <div className={`workspace-v2-body${sideOpen ? " has-side" : ""}`}>
        <section ref={readerRef} className={`workspace-v2-reader${isDocumentFullscreen ? " is-document-fullscreen" : ""}`} aria-label="Document reader">
          <nav className="workspace-v2-toolbar" aria-label="Document tools" ref={toolbarRef}>
            <div className="workspace-v2-control-group is-exit">
              <WorkspaceIconButton label="Exit Workspace" onClick={() => navigate(sheetRoute)}><ArrowLeft size={19} /></WorkspaceIconButton>
            </div>
            <div className="workspace-v2-toolbar-scroll" ref={toolRailRef}>
              <div className="workspace-v2-tool-list">
                {TOOL_ITEMS.map(([id, label, ToolIcon]) => {
                  const configurable = CONFIGURABLE_TOOLS.has(id);
                  const expanded = id === "note" ? sideOpen : activeTool === id && toolOptionsOpen === id;
                  return <WorkspaceIconButton
                    key={id}
                    label={id === "note" && sideOpen ? "Close notes" : configurable && activeTool === id ? `${label}. Tap again for options` : label}
                    active={activeTool === id || (id === "note" && sideOpen)}
                    aria-pressed={id === "note" ? sideOpen : activeTool === id}
                    aria-expanded={configurable || id === "note" ? expanded : undefined}
                    aria-controls={id === "note" ? "workspace-notes-panel" : configurable ? `workspace-${id}-options` : undefined}
                    data-workspace-tool={id}
                    onClick={() => selectTool(id)}
                  ><ToolIcon size={19} /></WorkspaceIconButton>;
                })}
              </div>
              <span className="workspace-v2-toolbar-divider" aria-hidden="true" />
              <div className="workspace-v2-history" aria-label="Edit history">
                <WorkspaceIconButton label="Undo (Ctrl+Z)" disabled={!undoHistory.length} onClick={undoTool}><Undo2 size={18} /></WorkspaceIconButton>
                <WorkspaceIconButton label="Redo (Ctrl+Shift+Z)" disabled={!redoHistory.length} onClick={redoTool}><Redo2 size={18} /></WorkspaceIconButton>
              </div>
              <button type="button" className={`workspace-v2-study-mode-button is-${studyMode || "choose"}`} onClick={() => { setOpenSurface(null); setModeDialogOpen(true); }} aria-label={studyMode === "active" && activeStudy ? `Active Study: pages 1 to ${activeStudy.unlocked_pages} unlocked` : "Choose study mode"} title={studyMode === "active" && activeStudy ? `Active Study · pages 1–${activeStudy.unlocked_pages} unlocked` : "Choose study mode"}><Brain size={18} /></button>
            </div>
            <input ref={imageInputRef} className="workspace-v2-file-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={addImage} tabIndex={-1} aria-hidden="true" />
            <div className="workspace-v2-toolbar-actions" aria-label="Workspace controls">
              <WorkspaceIconButton label={bookmarked ? "Remove from Bookmarks" : "Save to Bookmarks"} active={bookmarked} aria-pressed={bookmarked} disabled={bookmarkBusy} onClick={toggleBookmark}><Star size={17} fill={bookmarked ? "currentColor" : "none"} /></WorkspaceIconButton>
              <WorkspaceIconButton label="Workspace settings" active={settingsOpen} aria-pressed={settingsOpen} aria-expanded={settingsOpen} aria-controls="workspace-settings-popover" onClick={() => setOpenSurface((current) => current === "settings" ? null : "settings")}><Settings size={18} /></WorkspaceIconButton>
            </div>
          </nav>

          {toolOptionsOpen && <div id={`workspace-${toolOptionsOpen}-options`} className="workspace-v2-tool-options" role="toolbar" aria-label={`${activeToolLabel} options`} onPointerDown={(event) => event.stopPropagation()}>
            <div className="workspace-v2-tool-options-title"><strong>{activeToolLabel}</strong><span>options</span></div>
            {activeTool === "pen" && <IconChoiceGroup label="Pen type" value={penProfile} options={PEN_PROFILE_OPTIONS} onChange={changePenProfile} />}
            {activeTool === "eraser" && <IconChoiceGroup label="Eraser mode" value={eraserMode} options={ERASER_MODE_OPTIONS} onChange={setEraserMode} />}
            {activeTool === "select" && <IconChoiceGroup label="Lasso mode" value={lassoMode} options={LASSO_MODE_OPTIONS} onChange={setLassoMode} />}
            {activeTool === "shapes" && <IconChoiceGroup label="Shape type" value={shapeStyle} options={SHAPE_OPTIONS} onChange={setShapeStyle} />}
            {showColorPalette && <>
              <div className="workspace-v2-colors" aria-label={activeTool === "select" ? "Selection colors" : "Annotation colors"}>
                {paletteColors.map((color) => <span key={color} className={`workspace-v2-color-item${customColorSet.has(color) ? " is-custom" : ""}`}>
                  <button type="button" className={`workspace-v2-color-swatch${activeColor === color ? " is-active" : ""}`} aria-label={`Use ${color}`} title={color} aria-pressed={activeColor === color} style={cssVars({ "--workspace-tool-color": color })} onClick={() => chooseAnnotationColor(color)} />
                  {customColorSet.has(color) && <button type="button" className="workspace-v2-color-delete" aria-label={`Delete ${color}`} title={`Delete ${color}`} onClick={() => deleteCustomColor(color)}><Minus size={11} /></button>}
                </span>)}
                {paletteColors.length < MAX_PALETTE_COLORS && <button type="button" className={`workspace-v2-custom-color${customColorEditorOpen ? " is-active" : ""}`} aria-label="Add Color" title="Add Color" aria-expanded={customColorEditorOpen} onClick={() => { setCustomColorDraft(activeColor); setCustomColorEditorOpen((current) => !current); }}><Plus size={15} /><span>Add</span></button>}
                {customColorEditorOpen && <div className="workspace-v2-custom-color-editor" role="group" aria-label="Custom color editor">
                  <input type="color" aria-label="Choose custom color" value={customColorDraft} onChange={(event) => setCustomColorDraft(event.target.value)} />
                  <button type="button" aria-label="Save custom color" title="Save color" onClick={commitCustomColor}><Check size={16} /></button>
                </div>}
              </div>
            </>}
            <div className="workspace-v2-tool-settings" aria-label={`${activeToolLabel} controls`}>
              {inkToolActive && <ToolRange label={activeTool === "shapes" ? "Border width" : "Thickness"} value={brushSize} min={1} max={12} step={1} onChange={setBrushSize} color={activeColor} />}
              {activeTool === "eraser" && <ToolRange label="Eraser size" value={brushSize} min={1} max={20} step={1} onChange={setBrushSize} preview="eraser" />}
              {inkToolActive && <ToolRange
                label="Opacity"
                value={activeToolOpacity}
                displayValue={`${Math.round(activeToolOpacity * 100)}%`}
                min={activeTool === "highlighter" ? .1 : .2}
                max={activeTool === "highlighter" ? .6 : 1}
                step={.05}
                preview="opacity"
                color={activeColor}
                onChange={updateActiveToolOpacity}
              />}
            </div>
          </div>}

          {settingsOpen && <section id="workspace-settings-popover" className="workspace-v2-settings-popover" role="dialog" aria-label="Workspace settings" onPointerDown={(event) => event.stopPropagation()}>
            <header><span><Settings size={17} />Workspace settings</span><button type="button" aria-label="Close workspace settings" onClick={() => setOpenSurface(null)}><X size={17} /></button></header>
            <div className="workspace-v2-settings-content">
              <section aria-labelledby="workspace-drawing-settings"><h2 id="workspace-drawing-settings">Drawing</h2>
                <SettingsToggle icon={Eraser} label="Scribble erase" description="Scratch over ink to remove it" checked={scribbleToErase} onChange={setScribbleToErase} />
                <SettingsToggle icon={Shapes} label="Hold to shape" description="Hold a stroke to straighten it" checked={drawAndHold} onChange={setDrawAndHold} />
                <SettingsToggle icon={Circle} label="Circle erase" description="Circle ink and hold to erase it" checked={circleToErase} onChange={setCircleToErase} />
                <button type="button" className="workspace-v2-settings-action" onClick={clearPageAnnotations} disabled={!pageAnnotations.length}><Trash2 size={17} /><span><strong>Clear ink on page {page}</strong><small>{pageAnnotations.length ? `Removes ${pageAnnotations.length} mark${pageAnnotations.length === 1 ? "" : "s"}. Undo restores them.` : "This page has no marks yet"}</small></span></button>
                <SettingsToggle icon={PenLine} label="Apple Pencil mode" description="Pencil draws while fingers navigate" checked={drawingInput === DRAWING_INPUT.STYLUS_ONLY} onChange={(enabled) => changeDrawingInput(enabled ? DRAWING_INPUT.STYLUS_ONLY : DRAWING_INPUT.STYLUS_AND_FINGER)} />
                <ToolRange label="Pressure sensitivity" value={pressureSensitivity} displayValue={`${Math.round(pressureSensitivity * 100)}%`} min={0} max={1} step={.05} onChange={setPressureSensitivity} color={activeColor} />
                <ToolRange label="Stroke smoothing" value={strokeSmoothing} displayValue={`${Math.round(strokeSmoothing * 100)}%`} min={0} max={1} step={.05} onChange={setStrokeSmoothing} color={activeColor} />
              </section>
              {sheet.pdfUrl && <section aria-labelledby="workspace-pdf-settings"><h2 id="workspace-pdf-settings">PDF</h2>
                <SettingsToggle icon={Bookmark} label="Remember last position" description="Restore the last page and scroll position" checked={rememberLastPosition} onChange={setRememberLastPosition} />
                <SettingsToggle icon={ZoomIn} label="Remember zoom level" description="Restore this sheet at the same zoom" checked={rememberZoomLevel} onChange={setRememberZoomLevel} />
                <button type="button" className="workspace-v2-settings-action" onClick={fitPdfWidth}><MoveHorizontal size={17} /><span><strong>Fit Width</strong><small>Fill the reader without side gaps</small></span></button>
                <SettingsToggle icon={Eye} label="Show page number" description="Display the current page over the PDF" checked={showPageNumber} onChange={setShowPageNumber} />
                {wakeLockSupported && <SettingsToggle icon={Power} label="Keep screen awake" description="Prevent sleep while this workspace is open" checked={keepScreenAwake} onChange={setKeepScreenAwake} />}
              </section>}
              <section aria-labelledby="workspace-backup-settings"><h2 id="workspace-backup-settings">Backup</h2>
                {saveState === "error" && <p className="workspace-v2-settings-note" role="alert">{saveErrorReason || "Marks could not be saved on this device."}</p>}
                <button type="button" className="workspace-v2-settings-action" onClick={exportWorkspaceBackup} disabled={backupBusy}><Download size={17} /><span><strong>Export marks and notes</strong><small>Save this sheet&rsquo;s work as a file you keep</small></span></button>
                <button type="button" className="workspace-v2-settings-action" onClick={() => backupInputRef.current?.click()} disabled={backupBusy}><Upload size={17} /><span><strong>Restore from a backup</strong><small>Adds anything missing and never replaces existing marks</small></span></button>
                {pendingImport && <div className="workspace-v2-settings-confirm" role="group" aria-label="Confirm restore from another sheet">
                  <p>That backup was made on <strong>{pendingImport.sheetTitle || pendingImport.sheetSlug}</strong>. Restoring copies its {pendingImport.annotations.length} mark{pendingImport.annotations.length === 1 ? "" : "s"} onto this sheet.</p>
                  <div>
                    <button type="button" onClick={() => applyRestoredBackup(pendingImport)}>Restore anyway</button>
                    <button type="button" onClick={() => setPendingImport(null)}>Cancel</button>
                  </div>
                </div>}
                <input ref={backupInputRef} className="workspace-v2-file-input" type="file" accept="application/json,.json" onChange={readWorkspaceBackup} tabIndex={-1} aria-hidden="true" />
              </section>
              <section aria-labelledby="workspace-general-settings"><h2 id="workspace-general-settings">Workspace</h2>
                <button type="button" className="workspace-v2-settings-action" onClick={toggleDocumentFullscreen}>{isDocumentFullscreen ? <Minimize2 size={17} /> : <Maximize2 size={17} />}<span><strong>{isDocumentFullscreen ? "Exit fullscreen" : "Enter fullscreen"}</strong><small>Use the full display for the PDF</small></span></button>
              </section>
            </div>
          </section>}

          <div
            className={`workspace-v2-document-stage is-tool-${activeTool}`}
            ref={stageRef}
            onPointerDown={beginWorkspacePointer}
            onPointerMove={moveWorkspacePointer}
            onPointerUp={finishWorkspacePointer}
            onPointerCancel={cancelWorkspacePointer}
            onLostPointerCapture={lostWorkspacePointer}
            onPointerLeave={hideStylusHover}
          >
            {sheet.pdfUrl ? <ContinuousA4Pdf pdfUrl={sheet.pdfUrl} pageCount={pageCount} visiblePageCount={accessiblePageCount} zoom={zoom} stageRef={stageRef} documentRootRef={documentRef} onPageCount={syncPdfPageCount} onDocumentReady={markPdfDocumentReady} onCurrentPageChange={setPage} renderPageOverlay={renderPdfPageOverlay} onPdfPageRendered={recordPdfPageRender} /> : <article ref={documentRef} className="workspace-v2-document" onDoubleClick={smartZoom} style={cssVars({ "--workspace-document-width": `${PAGE_WIDTH * zoom}px`, "--workspace-document-min-height": `${760 * zoom}px`, "--workspace-document-max-width": "none" })}>
              <svg className={annotationLayerClass} viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-label="Document annotations">
                <AnnotationVisuals annotations={pageAnnotations} prefix={`document-${page}`} includeHitTargets={activeTool === "select"} />
                {draftAnnotation && draftAnnotation.type !== "lasso" && <WorkspaceAnnotation annotation={draftAnnotation} draft />}
                {selectedBounds && <g className="workspace-v2-selection-box">
                  <rect x={selectedBounds.x} y={selectedBounds.y} width={selectedBounds.width} height={selectedBounds.height} />
                  {[["top-left", selectedBounds.x, selectedBounds.y], ["top-right", selectedBounds.x + selectedBounds.width, selectedBounds.y], ["bottom-left", selectedBounds.x, selectedBounds.y + selectedBounds.height], ["bottom-right", selectedBounds.x + selectedBounds.width, selectedBounds.y + selectedBounds.height]].map(([handle, x, y]) => <circle key={handle} data-resize-handle={handle} cx={x} cy={y} r={11 * pageUnitsPerCssPixel(page)} />)}
                </g>}
              </svg>
              <LiveAnnotationCanvas ref={liveStrokeCanvasRef} pageNumber={page} />
              {renderSelectionMenu()}
              <h1>{topicTitle}</h1>
              <p className="workspace-v2-lead">{topicSummary} It helps connect foundational knowledge with confident clinical decisions.</p>
              <div className="workspace-v2-selection-actions" aria-label="Selected text actions">
                <button type="button" onClick={() => navigate("/questions")}><Copy size={16} />Create Flashcard</button>
                <button type="button" onClick={() => selectTool("note")}><MessageSquare size={16} />Add Note</button>
                <button type="button" onClick={() => navigate("/review")}><Bookmark size={16} />Save to Review</button>
              </div>
              <div className="workspace-v2-document-grid">
                <div><p>Understanding the <mark>core anatomical and clinical relationship</mark> improves recognition, recall, and application during assessment.</p><h2>Key Features</h2><ul><li>Connects structure with clinical function</li><li>Highlights the essential examination points</li><li>Supports active recall and revision</li><li>Organizes the topic into a practical sequence</li></ul></div>
                <figure className="workspace-v2-figure"><div><Sparkles size={34} /><strong>{material.title}</strong><span>Focused visual reference</span></div><figcaption>Figure {sheet.number}.1 · Core concept overview</figcaption></figure>
              </div>
              <aside className="workspace-v2-clinical-note"><span><Zap size={23} /></span><div><strong>Clinical Note</strong><p>Use the selected tools to highlight, annotate, and connect this concept to the current study session.</p></div></aside>
            </article>}
            <span ref={stylusHoverRef} className="workspace-v2-stylus-hover" aria-hidden="true" />
          </div>
          {showPageNumber && <div className={`workspace-v2-page-dock${pageNavigatorOpen ? " is-open" : ""}`}>
            {pageNavigatorOpen && <div id="workspace-page-navigator" className="workspace-v2-page-navigator" role="group" aria-label="Page and zoom" onPointerDown={(event) => event.stopPropagation()}>
              <div className="workspace-v2-page-jump">
                <button type="button" aria-label="Previous page" title="Previous page" disabled={page <= 1} onClick={() => jumpToPagePosition(page - 1)}><ChevronLeft size={16} /></button>
                <label className="workspace-v2-page-input"><span className="workspace-v2-visually-hidden">Go to page</span><input type="number" inputMode="numeric" min={1} max={accessiblePageCount} value={pageJumpDraft} onChange={(event) => setPageJumpDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); commitPageJump(); } }} onBlur={commitPageJump} /></label>
                <span className="workspace-v2-page-total">/ {accessiblePageCount}</span>
                <button type="button" aria-label="Next page" title="Next page" disabled={page >= accessiblePageCount} onClick={() => jumpToPagePosition(page + 1)}><ChevronRight size={16} /></button>
              </div>
              <div className="workspace-v2-zoom-control" role="group" aria-label="Zoom">
                <button type="button" aria-label="Zoom out" title="Zoom out" disabled={zoom <= clampReaderZoom(MIN_FOCUS_ZOOM) + .001} onClick={() => zoomByStep(1 / 1.25)}><Minus size={16} /></button>
                <output aria-label={`Current zoom ${Math.round(zoom * 100)} percent`}>{Math.round(zoom * 100)}%</output>
                <button type="button" aria-label="Zoom in" title="Zoom in" disabled={zoom >= MAX_FOCUS_ZOOM - .001} onClick={() => zoomByStep(1.25)}><Plus size={16} /></button>
                {sheet.pdfUrl && <button type="button" className="workspace-v2-fit-width" aria-label="Fit width" title="Fit width" onClick={fitPdfWidth}><MoveHorizontal size={16} /></button>}
              </div>
            </div>}
            <button
              type="button"
              className="workspace-v2-page-number"
              aria-label={`Page ${page} of ${accessiblePageCount}`}
              title="Page and zoom"
              aria-expanded={pageNavigatorOpen}
              aria-controls="workspace-page-navigator"
              onClick={() => setOpenSurface((current) => current === "pages" ? null : "pages")}
            ><Hash size={12} aria-hidden="true" /><strong>{page}</strong><span>/ {accessiblePageCount}</span></button>
          </div>}
          {saveState === "error" && <p className="workspace-v2-save-warning" role="alert"><Zap size={14} aria-hidden="true" />This device cannot store more workspace data. Recent marks may be lost when you leave.</p>}
          {focusMessage && !sideOpen && <p className="workspace-v2-toast" aria-hidden="true">{focusMessage}</p>}
        </section>

        {sideOpen && <button className="workspace-v2-side-backdrop" type="button" onClick={() => setOpenSurface(null)} aria-label="Close workspace panel" />}
        <aside id="workspace-notes-panel" className={`workspace-v2-side${sideOpen ? " is-open" : ""}`} aria-label="Workspace notes and actions" aria-hidden={!sideOpen} inert={sideOpen ? undefined : ""}>
          <button ref={sideCloseRef} className="workspace-v2-side-close" type="button" onClick={() => { setOpenSurface(null); rootRef.current?.querySelector('[data-workspace-tool="note"]')?.focus(); }} aria-label="Close workspace panel"><X size={18} /></button>
          <div className="workspace-v2-tabs" role="tablist" aria-label="Workspace panels">
            <button type="button" id="workspace-notes-tab" role="tab" aria-selected={sideTab === "notes"} aria-controls="workspace-notes-tabpanel" tabIndex={sideTab === "notes" ? 0 : -1} className={sideTab === "notes" ? "is-active" : ""} onClick={() => setSideTab("notes")}>Notes</button>
            <button type="button" id="workspace-highlights-tab" role="tab" aria-selected={sideTab === "highlights"} aria-controls="workspace-highlights-tabpanel" tabIndex={sideTab === "highlights" ? 0 : -1} className={sideTab === "highlights" ? "is-active" : ""} onClick={() => setSideTab("highlights")}>Highlights <span>{highlights.length}</span></button>
          </div>
          <div className="workspace-v2-side-content">
            {sideTab === "notes" && <section id="workspace-notes-tabpanel" role="tabpanel" aria-labelledby="workspace-notes-tab" tabIndex={0} className="workspace-v2-note-list">
              {sortedNotes.map((note) => <button key={note.id} type="button" className="workspace-v2-note-card" onClick={() => openNote(note)} aria-label={`Open note from page ${note.page}`}>
                <span className="workspace-v2-card-meta"><strong>Page {note.page}</strong><span>{new Date(note.createdAt).toLocaleDateString()}</span></span>
                <span className="workspace-v2-card-copy">{note.body}</span>
                <span className="workspace-v2-card-tags"><span>{material.title}</span><span>Page note</span></span>
              </button>)}
              {!sortedNotes.length && <p className="workspace-v2-empty-panel">Notes saved on any page will appear here in page order.</p>}
              <label className="workspace-v2-note-editor"><span>Note for page {page}</span><textarea ref={noteRef} value={noteDraft} onChange={(event) => setNoteDraft(event.target.value)} maxLength={10000} placeholder={`Write a note for page ${page}…`} /><button type="button" onClick={saveNote} disabled={noteBusy || !noteDraft.trim()}>{noteBusy ? "Saving…" : `Save to page ${page}`}</button></label>
            </section>}
            {sideTab === "highlights" && <section id="workspace-highlights-tabpanel" role="tabpanel" aria-labelledby="workspace-highlights-tab" tabIndex={0} className="workspace-v2-highlight-list">{highlights.length ? highlights.map((highlight, index) => <button key={highlight.id} type="button" className="workspace-v2-highlight-card" onClick={() => openHighlight(highlight)} aria-label={`Open highlight ${index + 1} on page ${highlight.page}`}><span className="workspace-v2-highlight-color" style={{ backgroundColor: highlight.color }} /><strong>Page {highlight.page}</strong><span>Highlight {index + 1}</span><small>Open highlight</small></button>) : <p className="workspace-v2-empty-panel">Choose the Highlight tool and drag across the sheet to add your first highlight.</p>}</section>}
          </div>
          {focusMessage && <p className="workspace-v2-status" role="status">{focusMessage}</p>}
        </aside>
      </div>
      <span className="workspace-v2-visually-hidden" role="status" aria-live="polite">{saveLabel}{focusMessage ? ` · ${focusMessage}` : ""}</span>
      {studyMode === "active" && activeStudy?.status === "active" && <div className="workspace-v2-checkpoint-dock" role="status" aria-live="polite">
        <button type="button" className={`workspace-v2-checkpoint-button${activeCheckpointReady ? " is-ready" : ""}`} onClick={openActiveQuiz} disabled={activeStudyBusy || !activeCheckpointReady} aria-label={activeCheckpointReady ? activeStudy.final_ready ? "Open final test" : "Open checkpoint" : `Reach page ${activeStudy.unlocked_pages} to unlock the checkpoint`}>{activeStudy.final_ready ? <><Trophy size={20} /><span className="workspace-v2-checkpoint-copy">Final test · 50</span></> : activeCheckpointReady ? <><CheckCircle2 size={20} /><span className="workspace-v2-checkpoint-copy">Checkpoint · 10</span></> : <><CheckCircle2 size={20} /><span className="workspace-v2-checkpoint-copy">Reach page {activeStudy.unlocked_pages}</span></>}</button>
      </div>}
      {modeDialogOpen && <StudyModeDialog difficulty={activeDifficulty} setDifficulty={setActiveDifficulty} activeAvailable={Boolean(sheet.isTestSheet)} busy={activeStudyBusy} error={activeStudyError} onNormal={chooseNormalStudy} onActive={chooseActiveStudy} />}
      {activeQuiz && activeStudy && <ActiveStudyQuiz quiz={activeQuiz} answers={activeAnswers} setAnswers={setActiveAnswers} result={activeResult} busy={activeStudyBusy} onSubmit={submitActiveQuiz} onDismiss={dismissActiveQuiz} onRetake={retakeActiveQuiz} onContinue={continueActiveStudyAnyway} />}
    </main>
  );
}
