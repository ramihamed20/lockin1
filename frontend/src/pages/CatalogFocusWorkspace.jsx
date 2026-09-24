import { memo, startTransition, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
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
  MoreHorizontal,
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
  Search,
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
  Type,
  ClipboardPaste,
  Download,
  Upload,
  Lock,
  Unlock,
  Layers3,
  FileText,
  StickyNote,
  Share2,
  Camera,
  EyeOff,
  List,
  Group,
  Ungroup
} from "lucide-react";
import { focusApi } from "../api/focus.js";
import { progressApi } from "../api/progress.js";
import { generateIdempotencyKey } from "../api/pagination.js";
import { rememberLastOpenedCatalogSheet, resolveSheetEdition, withEditionPdfUrl } from "../lib/materialCatalog.js";
import { useCatalogMaterials } from "../hooks/useCatalogMaterials.js";
import { useCatalogDocument } from "../hooks/useCatalogDocument.js";
import { useReadingSession } from "../hooks/useReadingSession.js";
import { subscribeConnection } from "../lib/connectionState.js";
import { createCatalogServerSync } from "../workspace/catalog/catalogServerSync.js";
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
import { WORKSPACE_PAGE_BACKGROUNDS, composeWorkspacePages, createVirtualPageId, insertVirtualPage, isVirtualPageKey, removeVirtualPage, sanitizeVirtualPages } from "../workspace/catalog/virtualPages.js";
import { canvasesToPdf, downloadWorkspaceBlob, renderWorkspacePage } from "../workspace/catalog/workspaceExport.js";
import { loadPdfLibrary } from "../workspace/catalog/pdfJsAdapter.js";
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
import { EmptyState, ErrorPanel, LoadingPanel, Page } from "../components/ui/index.jsx";
import { useI18n } from "../components/I18nProvider.jsx";
import "./catalog-focus-workspace.css";

const PAGE_COUNT = 342;
const PAGE_WIDTH = 690;
const PAGE_SPACE = 1000;
const MIN_FOCUS_ZOOM = WORKSPACE_ZOOM.minimum;
const MAX_FOCUS_ZOOM = WORKSPACE_ZOOM.catalogMaximum;
const AUTOSAVE_IDLE_MS = 750;
// The server mirror trails the local save, so a burst of strokes or a scroll
// becomes one request rather than many.
const SERVER_SYNC_DELAY_MS = 1_500;
const COLORS = ["#2196f3", "#ff6472", "#ffe455", "#8b5cf6", "#f2b728", "#20b982", "#e65791", "#239ed1"];
const HOLD_RECOGNITION_MS = 500;
const HOLD_ENDPOINT_TOLERANCE_PX = 28;
const TOOL_MEMORY_KEY = "lock-in.catalog-workspace.tool-memory.v2";
const RECENT_COLORS_KEY = "lock-in.catalog-workspace.recent-colors.v1";
const FAVORITE_COLORS_KEY = "lock-in.catalog-workspace.favorite-colors.v1";
const PEN_PRESETS_KEY = "lock-in.catalog-workspace.pen-presets.v1";
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
  ["text", "Text", Type],
  ["note", "Notes", MessageSquare]
];

/** @type {Array<[string, string, import("lucide-react").LucideIcon, string]>} */
const PRIMARY_WRITE_TOOLS = [
  ["pen", "Pen", PenLine, ""],
  ["hand", "Hand", Hand, ""],
  ["highlighter", "Highlight", Highlighter, "is-phone-secondary"],
  ["eraser", "Eraser", Eraser, "is-phone-secondary"],
  ["select", "Lasso", MousePointer2, "is-phone-secondary"],
  ["shapes", "Shapes", Shapes, "is-tablet-secondary"]
];

const DRAWING_TOOLS = new Set(["pen", "pencil", "highlighter", "eraser", "shapes", "select"]);
const CONFIGURABLE_TOOLS = new Set(["pen", "pencil", "highlighter", "eraser", "select", "shapes"]);
/** @type {Array<[string, string, import("lucide-react").LucideIcon]>} */
const PEN_PROFILE_OPTIONS = [
  [PEN_PROFILE.BALL, "Ball Pen", PenLine],
  [PEN_PROFILE.FOUNTAIN, "Fountain Pen", Feather],
  [PEN_PROFILE.BRUSH, "Brush Pen", Brush]
];
const SHAPE_OPTIONS = [
  ["line", "Line", Minus],
  ["arrow", "Arrow", ArrowRight],
  ["rectangle", "Rectangle", RectangleHorizontal],
  ["square", "Square", Square],
  ["rounded", "Rounded", RectangleHorizontal],
  ["polygon", "Polygon", Shapes],
  ["ellipse", "Ellipse", Circle],
  ["circle", "Circle", Circle],
  ["triangle", "Triangle", Triangle]
];
const LASSO_MODE_OPTIONS = [
  ["freeform", "Freeform lasso", MousePointer2],
  ["rectangle", "Rectangle lasso", Square]
];
/** @type {Array<[number, string]>} */
const STROKE_FEEL_OPTIONS = [[.25, "Natural"], [.5, "Balanced"], [.8, "Smooth"]];
const QUICK_THICKNESSES = [2, 4, 8];

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

function WorkspaceIconButton({ label, caption = null, active = false, children, className = "", ...props }) {
  return <button className={`workspace-v2-icon-button${active ? " is-active" : ""}${className ? ` ${className}` : ""}`} type="button" aria-label={label} title={label} {...props}>
    {children}{caption && <span className="workspace-v2-tool-caption" aria-hidden="true">{caption}</span>}
  </button>;
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
    ><OptionIcon size={17} /><span className="workspace-v5-choice-label">{optionLabel.replace(/ (Eraser|lasso)$/i, "")}</span></button>)}
  </div>;
}

function PenProfilePicker({ value, onChange, color }) {
  return <div className="workspace-v4-pen-profiles" role="group" aria-label="Pen type">
    {PEN_PROFILE_OPTIONS.map(([optionValue, optionLabel, OptionIcon]) => <button key={optionValue} type="button" className={value === optionValue ? "is-active" : ""} aria-label={optionLabel} aria-pressed={value === optionValue} onClick={() => onChange(optionValue)}>
      <span className={`workspace-v4-nib is-${optionValue}`} style={cssVars({ "--workspace-tool-color": color })}><OptionIcon size={15} /><i /></span><strong>{optionLabel.replace(" Pen", "")}</strong>
    </button>)}
  </div>;
}

function QuickSizes({ values, value, onChange, label = "Thickness" }) {
  return <div className="workspace-v4-quick-sizes" role="group" aria-label={`Quick ${label.toLowerCase()}`}>
    {values.map((size) => <button key={size} type="button" className={value === size ? "is-active" : ""} aria-label={`Set ${label.toLowerCase()} to ${size}`} aria-pressed={value === size} onClick={() => onChange(size)}><span style={cssVars({ "--workspace-quick-size": `${Math.max(2, size)}px` })} />{size}</button>)}
  </div>;
}

function StrokeFeelPicker({ value, onChange }) {
  const selected = STROKE_FEEL_OPTIONS.reduce((best, option) => Math.abs(option[0] - value) < Math.abs(best[0] - value) ? option : best, STROKE_FEEL_OPTIONS[0]);
  return <div className="workspace-v4-stroke-feel" role="group" aria-label="Stroke feel">
    {STROKE_FEEL_OPTIONS.map(([amount, label]) => <button key={label} type="button" className={selected[1] === label ? "is-active" : ""} aria-pressed={selected[1] === label} onClick={() => onChange(amount)}>{label}</button>)}
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
/** @param {{ annotation: any, draft?: boolean, interactionOnly?: boolean, groupedHighlighter?: boolean }} props */
function WorkspaceAnnotation({ annotation, draft = false, interactionOnly = false, groupedHighlighter = false }) {
  const common = { "data-annotation-id": annotation.id, "data-annotation-type": annotation.type };
  if (["pen", "pencil", "highlighter"].includes(annotation.type)) {
    const geometry = strokeRenderGeometry(annotation);
    if (interactionOnly && annotation.type === "pen") {
      if (geometry.kind === "dot") return <circle {...common} className="workspace-v2-annotation-hit" cx={geometry.x} cy={geometry.y} r={Math.max(geometry.radius, 8)} fill={annotation.color} opacity="0" />;
      return <path {...common} className="workspace-v2-annotation-hit" d={geometry.path} fill={geometry.kind === "outline" ? annotation.color : "none"} stroke={geometry.kind === "centerline" ? annotation.color : "none"} strokeWidth={Math.max(geometry.width || 0, 12)} opacity="0" />;
    }
    const opacity = groupedHighlighter ? 1 : draft ? Math.min(geometry.opacity, annotation.type === "pen" ? 1 : .68) : geometry.opacity;
    let mark = null;
    if (geometry.kind === "dot") mark = <circle {...common} cx={geometry.x} cy={geometry.y} r={geometry.radius} fill={annotation.color} opacity={opacity} />;
    if (geometry.kind === "centerline") mark = <path {...common} d={geometry.path} fill="none" stroke={annotation.color} strokeWidth={geometry.width} strokeLinecap="round" strokeLinejoin="round" opacity={opacity} />;
    if (geometry.kind === "outline") mark = <path {...common} d={geometry.path} fill={annotation.color} opacity={opacity} />;
    if (!annotation.erasures?.length) return mark;
    const maskId = `workspace-erase-${String(annotation.id).replace(/[^a-zA-Z0-9_-]/g, "_")}`;
    return <g><defs><mask id={maskId} x="0" y="0" width="1000" height="1000" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse">
      <rect x="0" y="0" width="1000" height="1000" fill="white" />
      {annotation.erasures.map((erasure, index) => erasure.points.length === 1
        ? <circle key={index} cx={erasure.points[0].x} cy={erasure.points[0].y} r={erasure.radius} fill="black" />
        : <path key={index} d={erasure.points.map((point, pointIndex) => `${pointIndex ? "L" : "M"}${point.x} ${point.y}`).join(" ")} fill="none" stroke="black" strokeWidth={erasure.radius * 2} strokeLinecap="round" strokeLinejoin="round" />)}
    </mask></defs><g mask={`url(#${maskId})`}>{mark}</g></g>;
  }
  const commonWithOpacity = { ...common, "data-annotation-shape": annotation.type === "shape" ? annotation.shape : undefined, opacity: draft ? 0.68 : annotation.opacity ?? 1 };
  if (annotation.type === "shape") {
    const x = Math.min(annotation.start.x, annotation.end.x);
    const y = Math.min(annotation.start.y, annotation.end.y);
    const width = Math.abs(annotation.end.x - annotation.start.x);
    const height = Math.abs(annotation.end.y - annotation.start.y);
    const fill = annotation.fill ? (annotation.fillColor || annotation.color) : "none";
    const dash = annotation.dashed ? "18 11" : undefined;
    if (["line", "arrow"].includes(annotation.shape)) {
      const dx = annotation.end.x - annotation.start.x;
      const dy = annotation.end.y - annotation.start.y;
      const length = Math.max(1, Math.hypot(dx, dy));
      const head = Math.min(34, Math.max(12, annotation.width * 5));
      const normalX = -dy / length;
      const normalY = dx / length;
      const baseX = annotation.end.x - (dx / length) * head;
      const baseY = annotation.end.y - (dy / length) * head;
      return <g {...commonWithOpacity} fill="none" stroke={annotation.color} strokeWidth={annotation.width} strokeDasharray={dash} strokeLinecap="round" strokeLinejoin="round">
        <line x1={annotation.start.x} y1={annotation.start.y} x2={annotation.end.x} y2={annotation.end.y} />
        {annotation.shape === "arrow" && <polyline points={`${baseX + normalX * head * .45},${baseY + normalY * head * .45} ${annotation.end.x},${annotation.end.y} ${baseX - normalX * head * .45},${baseY - normalY * head * .45}`} />}
      </g>;
    }
    if (["circle", "ellipse"].includes(annotation.shape)) return <ellipse {...commonWithOpacity} cx={x + width / 2} cy={y + height / 2} rx={width / 2} ry={height / 2} fill={fill} stroke={annotation.color} strokeWidth={annotation.width} strokeDasharray={dash} />;
    if (annotation.shape === "triangle" || annotation.shape === "polygon") {
      const points = annotation.shape === "triangle"
        ? `${x + width / 2},${y} ${x + width},${y + height} ${x},${y + height}`
        : Array.from({ length: 6 }, (_, index) => `${x + width / 2 + Math.cos(index * Math.PI / 3) * width / 2},${y + height / 2 + Math.sin(index * Math.PI / 3) * height / 2}`).join(" ");
      return <polygon {...commonWithOpacity} points={points} fill={fill} stroke={annotation.color} strokeWidth={annotation.width} strokeDasharray={dash} strokeLinejoin="round" />;
    }
    return <rect {...commonWithOpacity} x={x} y={y} width={width} height={height} rx={annotation.shape === "rounded" ? "28" : "6"} fill={fill} stroke={annotation.color} strokeWidth={annotation.width} strokeDasharray={dash} />;
  }
  if (annotation.type === "text") {
    const textAnchor = annotation.align === "center" ? "middle" : annotation.align === "right" ? "end" : "start";
    const fontSize = Math.max(18, annotation.width * 5);
    return <text {...commonWithOpacity} x={annotation.x} y={annotation.y} fill={annotation.color} fontSize={fontSize} fontWeight={annotation.bold ? 700 : 400} fontFamily="system-ui, sans-serif" textAnchor={textAnchor}>{String(annotation.text).split("\n").map((line, index) => <tspan key={index} x={annotation.x} dy={index ? fontSize * 1.3 : 0}>{line || " "}</tspan>)}</text>;
  }
  if (annotation.type === "image") return <image {...commonWithOpacity} href={annotation.src} x={annotation.x} y={annotation.y} width={annotation.width} height={annotation.height} preserveAspectRatio="xMidYMid meet" />;
  if (annotation.type === "card") {
    const colors = { sticky: "#fff3a8", note: "#edf2ff", lined: "#ffffff", revision: "#ffe8ed" };
    const header = { sticky: "Sticky Note", note: "Note Card", lined: "Lined Card", revision: "Revision Card" }[annotation.cardKind] || "Note Card";
    const words = String(annotation.text || "").split(/\s+/);
    const lines = [];
    for (const word of words) {
      const last = lines.length - 1;
      if (last >= 0 && `${lines[last]} ${word}`.length <= Math.max(14, Math.floor(annotation.width / 11))) lines[last] += ` ${word}`;
      else lines.push(word);
    }
    return <g {...commonWithOpacity}>
      <rect x={annotation.x} y={annotation.y} width={annotation.width} height={annotation.height} rx="16" fill={colors[annotation.cardKind] || colors.note} stroke="#b8c4d6" strokeWidth="2" />
      <text x={annotation.x + 18} y={annotation.y + 34} fill="#1d3152" fontSize="21" fontWeight="700">{header}</text>
      {annotation.cardKind === "lined" && Array.from({ length: Math.floor((annotation.height - 65) / 35) }, (_, index) => <line key={index} x1={annotation.x + 14} x2={annotation.x + annotation.width - 14} y1={annotation.y + 70 + index * 35} y2={annotation.y + 70 + index * 35} stroke="#bed4ed" strokeWidth="1.5" />)}
      <text x={annotation.x + 18} y={annotation.y + 70} fill="#26344e" fontSize="20">{lines.slice(0, Math.floor((annotation.height - 64) / 28)).map((line, index) => <tspan key={index} x={annotation.x + 18} dy={index ? 28 : 0}>{line}</tspan>)}</text>
    </g>;
  }
  return null;
});

const AnnotationVisuals = memo(
/** @param {{ annotations: any[], hiddenIds?: Set<string>, prefix?: string, includeHitTargets?: boolean }} props */
function AnnotationVisuals({ annotations, hiddenIds = new Set(), prefix = "annotation", includeHitTargets = false }) {
  const visible = (annotations || []).filter((annotation) => !hiddenIds.has(annotation.id)).sort((a, b) => (a.zOrder || 0) - (b.zOrder || 0));
  const highlightGroups = new Map();
  for (const annotation of visible) if (annotation.type === "highlighter") {
    const key = `${annotation.color}|${annotation.opacity ?? .34}`;
    if (!highlightGroups.has(key)) highlightGroups.set(key, []);
    highlightGroups.get(key).push(annotation);
  }
  return <>
    {[...highlightGroups].map(([key, items]) => <g key={`${prefix}-highlight-${key}`} className="workspace-v2-highlighter-group" opacity={items[0].opacity ?? .34} style={{ mixBlendMode: "multiply" }}>
      {items.map((annotation) => <WorkspaceAnnotation key={`${prefix}-${annotation.id}`} annotation={annotation} groupedHighlighter />)}
    </g>)}
    {visible.filter((annotation) => annotation.type !== "highlighter").map((annotation) => <WorkspaceAnnotation key={`${prefix}-${annotation.id}`} annotation={annotation} />)}
    {includeHitTargets && (annotations || []).filter((annotation) => annotation.type === "pen").map((annotation) => <WorkspaceAnnotation key={`${prefix}-hit-${annotation.id}`} annotation={annotation} interactionOnly />)}
  </>;
});

function loadStoredWorkspace(owner, materialSlug, sheetSlug) {
  try {
    return parseCatalogWorkspace(window.localStorage.getItem(catalogWorkspaceStorageKey(owner, materialSlug, sheetSlug)));
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

function loadStringList(key, maximum = 8) {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) || "[]");
    return Array.isArray(parsed) ? parsed.filter((value) => typeof value === "string").slice(0, maximum) : [];
  } catch { return []; }
}

function loadPenPresets() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PEN_PRESETS_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter((preset) => preset && typeof preset === "object" && typeof preset.id === "string").slice(0, 4) : [];
  } catch { return []; }
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

function copiedAnnotations(items, page, offset) {
  const groups = new Map();
  return items.map((item) => {
    const copy = cloneAnnotation(item);
    if (copy.groupId) {
      if (!groups.has(copy.groupId)) groups.set(copy.groupId, generateIdempotencyKey());
      copy.groupId = groups.get(copy.groupId);
    }
    return translateAnnotation({ ...copy, id: generateIdempotencyKey(), page, locked: false }, offset, offset);
  });
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
  ["easy", "questions.difficulty.easy", "materials.activeDifficulty.easy"],
  ["medium", "questions.difficulty.medium", "materials.activeDifficulty.medium"],
  ["hard", "questions.difficulty.hard", "materials.activeDifficulty.hard"]
];

function StudyModeDialog({ difficulty, setDifficulty, activeAvailable, busy, error, onNormal, onActive, activeOnly = false }) {
  const { t } = useI18n();
  const dialogRef = useDialogFocus();
  return (
    <div className="workspace-v2-mode-backdrop">
      <section ref={dialogRef} className="workspace-v2-mode-dialog" role="dialog" aria-modal="true" aria-labelledby="study-mode-title" aria-describedby="study-mode-hint" tabIndex={-1}>
        <h1 id="study-mode-title">{t(activeOnly ? "materials.startActiveStudy" : "materials.chooseStudyMode")}</h1>
        <p id="study-mode-hint" dir="auto">{t(activeOnly ? "materials.chooseDifficulty" : "materials.switchModesLater")}</p>
        <div className="workspace-v2-mode-grid">
          {!activeOnly && <button type="button" className="workspace-v2-mode-card" onClick={onNormal} disabled={busy}>
            <span className="workspace-v2-mode-icon"><BookOpen size={20} /></span>
            <span className="workspace-v2-mode-copy"><strong>{t("materials.normalStudy")}</strong><small>{t("materials.readSheetDescription")}</small></span>
            <ChevronRight className="workspace-v2-mode-chevron" size={18} aria-hidden="true" />
          </button>}
          <div className="workspace-v2-mode-card is-active-study">
            <div className="workspace-v2-mode-heading">
              <span className="workspace-v2-mode-icon"><Brain size={20} /></span>
              <span className="workspace-v2-mode-copy"><strong>{t("materials.activeStudy")}</strong><small>{t("materials.activeStudyDescription")}</small></span>
            </div>
            <div className="workspace-v2-difficulty" role="radiogroup" aria-label="Active Study difficulty">
              {ACTIVE_DIFFICULTIES.map(([id, labelKey, detailKey]) => <button key={id} type="button" role="radio" aria-label={`${t(labelKey)}: ${t(detailKey)}`} title={t(detailKey)} aria-checked={difficulty === id} className={difficulty === id ? "is-selected" : ""} onClick={() => setDifficulty(id)}>{t(labelKey)}</button>)}
            </div>
            <button type="button" className="workspace-v2-active-start" onClick={onActive} disabled={busy || !activeAvailable}>{t(busy ? "materials.activeStudyStarting" : activeAvailable ? "materials.startActiveStudy" : "materials.activeStudyUnavailable")}<ChevronRight size={16} /></button>
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
  const isFinal = quiz.kind === "final";
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
        {!passed && <button type="button" onClick={onRetake} disabled={busy}><RotateCcw size={16} />{isFinal ? "Retry final exam" : "Study this part again"}</button>}
        {!passed && <button type="button" onClick={onDismiss}>Return to pages</button>}
      </div>
    </section></div>;
  }
  return (
    <div className="workspace-v2-quiz-backdrop">
      <section ref={dialogRef} className="workspace-v2-quiz-dialog" role="dialog" aria-modal="true" aria-labelledby="active-question-title" tabIndex={-1}>
        <header><div><span>{isFinal ? "Final assessment" : `Pages ${quiz.run.current_page_range.start_page}–${quiz.run.current_page_range.end_page}`}</span><strong>{answered} of {quiz.questions.length} answered</strong></div><button type="button" onClick={onDismiss} aria-label="Close test"><X size={19} /></button></header>
        <div className="workspace-v2-quiz-progress"><span style={{ width: `${((index + 1) / quiz.questions.length) * 100}%` }} /></div>
        <main>
          <span className="workspace-v2-question-number">Question {index + 1} of {quiz.questions.length}</span>
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

/**
 * The workspace mounts a large annotation and PDF stack, so the sheet is
 * resolved before it renders rather than through an early return inside it.
 */
/**
 * The one catalog reader.
 *
 * `variant` picks which of the sheet's PDFs it opens -- the edition's study
 * PDF, or that edition's Sheet Summary. Controls, theme, zoom, navigation and
 * file delivery are the same either way, because they are the same reader.
 */
export default function CatalogFocusWorkspace({ user = null, variant = "study" }) {
  const { materialSlug, sheetSlug } = useParams();
  const location = useLocation();
  const { t } = useI18n();
  const { materials, loading: materialsLoading, error: materialsError, reload: reloadMaterials } = useCatalogMaterials(user);
  const material = materials.find((item) => item.slug === materialSlug) || null;
  // The address names one edition of the sheet; `view` carries that
  // edition's page count, summary and Active Study in the sheet's own shape.
  const { view: sheet, edition, missingEdition } = resolveSheetEdition(material, sheetSlug);
  // The server document behind the sheet: its protected PDF, and the ids its
  // reader state and annotations sync under. A fixture sheet that carries its
  // own pdfUrl opens without it and simply stays local.
  const summaryMode = variant === "summary";
  // A summary resolves through the same endpoint as the study PDF, so it is
  // delivered, cached and synced by the same code -- only the file differs.
  const catalogDocument = useCatalogDocument(
    sheet ? materialSlug : "",
    sheet ? sheetSlug : "",
    summaryMode ? "summary" : "",
    user?.id || ""
  );
  const viewUrl = catalogDocument.document?.viewUrl || "";
  const resolvedMaterials = useMemo(() => (viewUrl && sheet && !sheet.pdfUrl
    ? withEditionPdfUrl(materials, {
      materialSlug,
      slug: sheetSlug,
      pdfUrl: viewUrl,
      pageCount: summaryMode ? edition?.summaryPdf?.pageCount : undefined,
      hasActiveStudy: summaryMode ? false : undefined
    })
    : materials), [edition, materialSlug, materials, sheet, sheetSlug, summaryMode, viewUrl]);
  const documentScope = useMemo(
    () => ({ edition: edition?.edition || "university", view: summaryMode ? "summary" : "study" }),
    [edition, summaryMode]
  );
  const title = summaryMode ? t("materials.sheetSummary") : t("materials.coreCatalogTitle");
  if (materialsLoading) return <Page title={title}><LoadingPanel variant="document" /></Page>;
  if (materialsError) return <Page title={t("materials.sheetNotFoundTitle")}><ErrorPanel message={materialsError} onRetry={reloadMaterials} /></Page>;
  if (!material || !sheet) {
    // A named-but-unpublished edition says so, rather than being reported as a
    // missing sheet or quietly opening the edition that does exist.
    if (missingEdition) return <Page title={t("materials.sheetNotFoundTitle")}><ErrorPanel message={t("materials.editionUnavailable")} /></Page>;
    return <Page title={t("materials.sheetNotFoundTitle")}><EmptyState icon="study" title={t("materials.noSheetsTitle")} text={t("materials.noSheetsText")} /></Page>;
  }
  // The workspace sizes itself from the PDF when it first mounts, so it waits
  // for the document rather than mounting without one.
  if (!sheet.pdfUrl && catalogDocument.loading) return <Page title={title}><LoadingPanel /></Page>;
  if (!sheet.pdfUrl && !catalogDocument.document) {
    if (summaryMode) {
      return <Page title={title}><ErrorPanel message={t(sheet.summaryStatus === "processing" ? "materials.summaryProcessing" : "materials.summaryUnavailable")} onRetry={catalogDocument.reload} /></Page>;
    }
    return <Page title={sheet.title}><ErrorPanel message={catalogDocument.error || t("materials.sheetNotFoundText")} onRetry={catalogDocument.reload} /></Page>;
  }
  // Last guard before the reader: a catalog sheet without its own PDF must
  // never reach the view, whose no-PDF branch renders a placeholder document.
  const readable = resolveSheetEdition(
    resolvedMaterials.find((item) => item.slug === materialSlug) || null,
    sheetSlug
  ).view;
  if (!readable?.pdfUrl) {
    return <Page title={sheet.title}><ErrorPanel message={t("materials.editionUnavailable")} onRetry={summaryMode ? undefined : catalogDocument.reload} /></Page>;
  }
  const preferredMode = location.state?.studyMode === "normal" || location.state?.studyMode === "active" ? location.state.studyMode : "";
  return <CatalogFocusWorkspaceView user={user} materials={resolvedMaterials} catalogDocument={catalogDocument.document} documentScope={documentScope} onDocumentChanged={catalogDocument.reload} summaryMode={summaryMode} preferredMode={preferredMode} />;
}

function CatalogFocusWorkspaceView({ user = null, materials = [], catalogDocument = null, documentScope = null, onDocumentChanged = () => {}, summaryMode = false, preferredMode = "" }) {
  const { materialSlug, sheetSlug } = useParams();
  // A Sheet Summary is a different document from the sheet it belongs to, and
  // the local cache is keyed by slug, so it needs a key of its own or the two
  // sets of marks would be cached over each other on this device.
  const storageSlug = summaryMode ? `${sheetSlug}--summary` : sheetSlug;
  // Reading a sheet is what the streak is meant to count, so the sitting is
  // reported. A Sheet Summary is a reference lookup rather than a study
  // sitting, and a fixture sheet has no server document to report against.
  useReadingSession(catalogDocument?.versionId || "", { enabled: !summaryMode });
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const rootRef = useRef(null);
  const readerRef = useRef(null);
  const toolbarRef = useRef(null);
  const toolRailRef = useRef(null);
  const toolOptionsRef = useRef(null);
  const stageRef = useRef(null);
  const documentRef = useRef(null);
  const imageInputRef = useRef(null);
  const noteRef = useRef(null);
  const textInputRef = useRef(null);
  const sideCloseRef = useRef(null);
  const annotationsRef = useRef([]);
  const virtualPagesRef = useRef([]);
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
  const pdfZoomModeRef = useRef("fit");
  // A refit caused by the stage changing width has to land on the same reading
  // position it left. The anchor is carried the way a pinch carries one.
  const pendingFitAnchorRef = useRef(null);
  const fittedStageWidthRef = useRef(null);
  const pendingPinchCommitRef = useRef(null);
  const initialPageViewRef = useRef("");
  const wheelZoomEndTimerRef = useRef(null);
  const zoomHudTimerRef = useRef(null);
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
  // Server mirror of the local store (see catalogServerSync.js).
  const serverSyncRef = useRef(null);
  const serverSyncTimerRef = useRef(null);
  const serverLoadStartedRef = useRef(null);
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
    holdStartedAt: null,
    holdRawStroke: null,
    holdRecognition: null,
    smartSelectionActivated: false
  });

  const material = materials.find((item) => item.slug === materialSlug) || null;
  // The address names one edition of the sheet; `view` carries that
  // edition's page count, summary and Active Study in the sheet's own shape.
  const { view: sheet, edition: sheetEdition } = resolveSheetEdition(material, sheetSlug);
  const inkDebugEnabled = import.meta.env.DEV && searchParams.get("inkDebug") === "1";

  useEffect(() => {
    // A summary is a reference read, not the sheet a student left off in.
    if (material && sheet && !summaryMode) rememberLastOpenedCatalogSheet(materialSlug, sheetSlug, { material, sheet });
  }, [material, materialSlug, sheet, sheetSlug, summaryMode]);

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
  const rememberedWritingTool = (() => {
    const remembered = String(toolMemoryRef.current.lastWritingTool || "pen");
    return DRAWING_TOOLS.has(remembered) && remembered !== "hand" ? remembered : "pen";
  })();
  const rememberedPenProfile = String(toolMemoryRef.current.lastPenProfile || PEN_PROFILE.BALL);
  const initialToolSettings = toolMemoryRef.current[
    rememberedWritingTool === "pen" ? `pen:${rememberedPenProfile}` : rememberedWritingTool
  ] || {};
  const configuredPageCount = sheet?.pageCount || (sheet?.pdfUrl ? 1 : PAGE_COUNT);
  const [pageCount, setPageCount] = useState(configuredPageCount);
  // A sheet always opens at the visual beginning.  The stored reader view is
  // still written for diagnostics/backup, but it never overrides this entry
  // position or any server-owned Active Study progress.
  const [page, setPage] = useState(1);
  const [virtualPages, setVirtualPages] = useState([]);
  const [activeVirtualPageId, setActiveVirtualPageId] = useState(null);
  const activePageKey = activeVirtualPageId ?? page;
  const [zoom, setZoom] = useState(() => {
    if (!sheet?.pdfUrl) return 1.3;
    const fitZoom = fitWidthZoom(window.innerWidth, A4_PAGE_WIDTH, window.innerWidth < 1200 ? 16 : 360);
    return Math.min(MAX_FOCUS_ZOOM, Math.max(MIN_FOCUS_ZOOM, fitZoom));
  });
  const [activeTool, setActiveTool] = useState(rememberedWritingTool);
  const [activeColor, setActiveColor] = useState(initialToolSettings.color || COLORS[0]);
  const [bookmarked, setBookmarked] = useState(false);
  const [bookmarkBusy, setBookmarkBusy] = useState(false);
  const [sideTab, setSideTab] = useState("notes");
  const [openSurface, setOpenSurface] = useState(null);
  const [brushSize, setBrushSize] = useState(() => Number(initialToolSettings.size) || 4);
  const [brushOpacity, setBrushOpacity] = useState(() => rememberedWritingTool === "pen" ? Number(initialToolSettings.opacity) || 1 : 1);
  const [pencilOpacity, setPencilOpacity] = useState(() => rememberedWritingTool === "pencil" ? Number(initialToolSettings.opacity) || .78 : .78);
  const [highlighterOpacity, setHighlighterOpacity] = useState(() => rememberedWritingTool === "highlighter" ? Number(initialToolSettings.opacity) || .34 : .34);
  const [penProfile, setPenProfile] = useState(rememberedPenProfile);
  const [pressureSensitivity, setPressureSensitivity] = useState(() => Number.isFinite(Number(initialToolSettings.pressureSensitivity)) ? Number(initialToolSettings.pressureSensitivity) : .55);
  const [strokeSmoothing, setStrokeSmoothing] = useState(() => Number.isFinite(Number(initialToolSettings.smoothing)) ? Number(initialToolSettings.smoothing) : .5);
  const [autoImproveHandwriting, setAutoImproveHandwriting] = useState(storedWorkspaceSettings.autoImproveHandwriting === true);
  const [shapeStyle, setShapeStyle] = useState(() => String(initialToolSettings.shapeStyle || "rectangle"));
  const [shapeFill, setShapeFill] = useState(storedWorkspaceSettings.shapeFill === true);
  const [shapeFillColor, setShapeFillColor] = useState(storedWorkspaceSettings.shapeFillColor || "#dceeff");
  const [shapeDashed, setShapeDashed] = useState(storedWorkspaceSettings.shapeDashed === true);
  const [shapeSnapGrid, setShapeSnapGrid] = useState(storedWorkspaceSettings.shapeSnapGrid === true);
  const [shapeAngle, setShapeAngle] = useState(Number(storedWorkspaceSettings.shapeAngle) || 0);
  const [lassoMode, setLassoMode] = useState("freeform");
  const [scribbleToErase, setScribbleToErase] = useState(storedWorkspaceSettings.scribbleToErase !== false);
  const [drawAndHold, setDrawAndHold] = useState(storedWorkspaceSettings.drawAndHold !== false);
  const [eraserSize, setEraserSize] = useState(() => Math.max(6, Math.min(48, Number(storedWorkspaceSettings.eraserSize) || 8)));
  const [circleToErase, setCircleToErase] = useState(storedCircleErase === true);
  const [recentColors, setRecentColors] = useState(loadRecentColors);
  const [favoriteColors, setFavoriteColors] = useState(() => loadStringList(FAVORITE_COLORS_KEY, 5));
  const [penPresets, setPenPresets] = useState(loadPenPresets);
  const [customColorDraft, setCustomColorDraft] = useState(COLORS[0]);
  const [customColorEditorOpen, setCustomColorEditorOpen] = useState(false);
  const [rememberLastPosition, setRememberLastPosition] = useState(initialRememberLastPosition);
  const [rememberZoomLevel, setRememberZoomLevel] = useState(initialRememberZoomLevel);
  const [showPageNumber, setShowPageNumber] = useState(storedWorkspaceSettings.showPageNumber !== false);
  const [keepScreenAwake, setKeepScreenAwake] = useState(storedWorkspaceSettings.keepScreenAwake === true);
  const [zoomHud, setZoomHud] = useState({ visible: false, label: "" });
  const [drawingInput, setDrawingInput] = useState(() => {
    try { return window.localStorage.getItem("lock-in.catalog-workspace.drawing-input") === DRAWING_INPUT.STYLUS_AND_FINGER ? DRAWING_INPUT.STYLUS_AND_FINGER : DRAWING_INPUT.STYLUS_ONLY; }
    catch { return DRAWING_INPUT.STYLUS_ONLY; }
  });
  const [annotations, setAnnotations] = useState([]);
  const [notes, setNotes] = useState([]);
  const [annotationsHidden, setAnnotationsHidden] = useState(false);
  const [cardKind, setCardKind] = useState("sticky");
  const [cardDraft, setCardDraft] = useState("");
  const [editingCardId, setEditingCardId] = useState(null);
  const [clipSelecting, setClipSelecting] = useState(false);
  const [settingsTab, setSettingsTab] = useState("writing");
  const [backupBusy, setBackupBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportRangeStart, setExportRangeStart] = useState(1);
  const [exportRangeEnd, setExportRangeEnd] = useState(1);
  const [includeWorkspacePages, setIncludeWorkspacePages] = useState(storedWorkspaceSettings.includeWorkspacePages !== false);
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
  const [selectionActionsOpen, setSelectionActionsOpen] = useState(false);
  const [isDocumentFullscreen, setIsDocumentFullscreen] = useState(false);
  const [saveState, setSaveState] = useState("idle");
  const [saveErrorReason, setSaveErrorReason] = useState("");
  const [pageJumpDraft, setPageJumpDraft] = useState("1");
  const [focusPayload, setFocusPayload] = useState(null);
  const [focusMessage, setFocusMessage] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [textDraft, setTextDraft] = useState("");
  const [editingTextId, setEditingTextId] = useState(null);
  const [textFontSize, setTextFontSize] = useState(28);
  const [textAlign, setTextAlign] = useState("left");
  const [textBold, setTextBold] = useState(false);
  const [textColor, setTextColor] = useState(COLORS[0]);
  const [noteBusy, setNoteBusy] = useState(false);
  const [studyMode, setStudyMode] = useState(preferredMode === "normal" ? "normal" : null);
  // A Sheet Summary is Normal Mode only, so it opens straight into reading
  // rather than asking which study mode to use.
  const [modeDialogOpen, setModeDialogOpen] = useState(!summaryMode && preferredMode !== "normal");
  const [entryModePreference, setEntryModePreference] = useState(preferredMode);
  const [activeDifficulty, setActiveDifficulty] = useState("medium");
  const [activeStudy, setActiveStudy] = useState(null);
  const [activeStudyBusy, setActiveStudyBusy] = useState(false);
  const [activeStudyError, setActiveStudyError] = useState("");
  const [activeStudyAvailability, setActiveStudyAvailability] = useState(null);
  const [activeStudyAvailabilityLoading, setActiveStudyAvailabilityLoading] = useState(false);
  const [activeQuiz, setActiveQuiz] = useState(null);
  const [activeAnswers, setActiveAnswers] = useState({});
  const [activeResult, setActiveResult] = useState(null);
  const viewPositionRef = useRef({ left: 0, top: 0, pageOffset: 0 });

  const [topicTitle, topicSummary] = SUBJECT_COPY[materialSlug] || [material?.title || "Study material", sheet?.summary || "Focused study workspace."];
  const sheetRoute = `/materials/catalog/${materialSlug}/sheets/${sheetSlug}`;
  const activePageRange = studyMode === "active" && activeStudy?.status === "active" ? activeStudy.current_page_range : null;
  // Active Study unlocks cumulatively. Earlier pages remain available while
  // the server-owned current range continues to determine checkpoint content.
  const accessiblePageStart = 1;
  const accessiblePageCount = activePageRange?.end_page || pageCount;
  const activeStudyButtonReady = studyMode === "active"
    && activeStudy?.status === "active"
    && (activeStudy.stage === "checkpoint" || activeStudy.stage === "final" || (activeStudy.stage === "reading" && page >= accessiblePageCount));
  const selectedActiveStudyAvailability = activeStudyAvailability?.difficulties?.find((item) => item.difficulty === activeDifficulty);
  // The catalog flag is only an optimistic fallback while the mode dialog's
  // live readiness request is in flight. Starting itself remains server-owned.
  const activeStudyReady = selectedActiveStudyAvailability?.status === "ready"
    || (activeStudyAvailability === null && Boolean(sheet?.hasActiveStudy));

  useEffect(() => {
    if (summaryMode || !modeDialogOpen || !sheet?.learningObjectId) return undefined;
    let cancelled = false;
    setActiveStudyAvailabilityLoading(true);
    focusApi.getManagedActiveStudyAvailability(sheet.learningObjectId, sheetEdition?.edition)
      .then((payload) => { if (!cancelled) setActiveStudyAvailability(payload); })
      .catch(() => { if (!cancelled) setActiveStudyAvailability(null); })
      .finally(() => { if (!cancelled) setActiveStudyAvailabilityLoading(false); });
    return () => { cancelled = true; };
  }, [modeDialogOpen, sheet?.learningObjectId, sheetEdition?.edition, summaryMode]);
  const pageAnnotations = useMemo(() => annotations.filter((item) => item.page === activePageKey), [activePageKey, annotations]);
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

  usePageTitle(sheet ? `${sheet.title} · ${summaryMode ? "Sheet Summary" : "Workspace"}` : "Focus Workspace");

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
      const height = Math.round(toolbar.getBoundingClientRect().bottom - root.getBoundingClientRect().top);
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
  // Keep each inspector attached to its tool without letting it leave the
  // reader at tablet widths. The phone inspector retains its full-width sheet.
  useLayoutEffect(() => {
    if (!toolOptionsOpen) return undefined;
    const panel = toolOptionsRef.current;
    const reader = readerRef.current;
    const source = toolbarRef.current?.querySelector(`[data-workspace-tool="${toolOptionsOpen}"]`);
    if (!panel || !reader || !source) return undefined;
    panel.scrollTop = 0;
    const resetScroll = window.requestAnimationFrame(() => { panel.scrollTop = 0; });
    const position = () => {
      if (window.innerWidth <= 560 || window.innerHeight < 600) {
        panel.style.removeProperty("left");
        panel.style.removeProperty("--workspace-popover-origin");
        return;
      }
      const readerBounds = reader.getBoundingClientRect();
      const sourceBounds = source.getBoundingClientRect();
      const width = panel.getBoundingClientRect().width;
      const desired = sourceBounds.left + sourceBounds.width / 2 - readerBounds.left;
      const half = Math.min(width / 2, Math.max(0, readerBounds.width / 2 - 8));
      const center = Math.max(half + 8, Math.min(readerBounds.width - half - 8, desired));
      panel.style.left = `${center}px`;
      panel.style.setProperty("--workspace-popover-origin", `${Math.max(0, Math.min(width, desired - center + width / 2))}px`);
    };
    position();
    window.addEventListener("resize", position, { passive: true });
    return () => { window.cancelAnimationFrame(resetScroll); window.removeEventListener("resize", position); };
  }, [toolOptionsOpen]);
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
    if (openSurface === "text") window.setTimeout(() => textInputRef.current?.focus(), 0);
  }, [openSurface]);
  useEffect(() => {
    try { window.localStorage.setItem(RECENT_COLORS_KEY, JSON.stringify(recentColors)); } catch { /* Recent colors are an optional local preference. */ }
  }, [recentColors]);
  useEffect(() => {
    try { window.localStorage.setItem(FAVORITE_COLORS_KEY, JSON.stringify(favoriteColors)); } catch { /* Favorites are an optional local preference. */ }
  }, [favoriteColors]);
  useEffect(() => {
    try { window.localStorage.setItem(PEN_PRESETS_KEY, JSON.stringify(penPresets)); } catch { /* Presets remain usable in memory. */ }
  }, [penPresets]);
  useEffect(() => {
    if (!["pen", "pencil", "highlighter", "eraser", "shapes"].includes(activeTool)) return;
    const key = activeTool === "pen" ? `pen:${penProfile}` : activeTool;
    toolMemoryRef.current[key] = {
      color: activeColor,
      size: brushSize,
      opacity: activeTool === "highlighter" ? highlighterOpacity : activeTool === "pencil" ? pencilOpacity : brushOpacity,
      pressureSensitivity,
      smoothing: strokeSmoothing,
      shapeStyle
    };
    if (activeTool === "pen") toolMemoryRef.current.lastPenProfile = penProfile;
    toolMemoryRef.current.lastWritingTool = activeTool;
    try { window.localStorage.setItem(TOOL_MEMORY_KEY, JSON.stringify(toolMemoryRef.current)); } catch { /* Tool memory is a best-effort local preference. */ }
  }, [activeColor, activeTool, brushOpacity, brushSize, highlighterOpacity, penProfile, pencilOpacity, pressureSensitivity, shapeStyle, strokeSmoothing]);
  useEffect(() => {
    try { window.localStorage.setItem(WORKSPACE_SETTINGS_KEY, JSON.stringify({ autoImproveHandwriting, scribbleToErase, drawAndHold, eraserSize, circleToErase, rememberLastPosition, rememberZoomLevel, showPageNumber, keepScreenAwake, shapeFill, shapeFillColor, shapeDashed, shapeSnapGrid, shapeAngle, includeWorkspacePages })); } catch { /* Workspace preferences remain available in memory. */ }
  }, [autoImproveHandwriting, circleToErase, drawAndHold, eraserSize, keepScreenAwake, rememberLastPosition, rememberZoomLevel, scribbleToErase, showPageNumber, shapeFill, shapeFillColor, shapeDashed, shapeSnapGrid, shapeAngle, includeWorkspacePages]);
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
    if (zoomHudTimerRef.current) window.clearTimeout(zoomHudTimerRef.current);
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
      if (event.target.closest?.(".workspace-v2-toolbar, .workspace-v2-tool-options, .workspace-v2-action-popover, .workspace-v2-settings-popover, .workspace-v2-page-dock")) return;
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
          : openSurface === "add"
            ? '[data-workspace-surface="add"]'
            : openSurface === "more"
              ? '[data-workspace-surface="more"]'
              : '[aria-controls="workspace-settings-popover"]';
      setOpenSurface(null);
      const opener = rootRef.current?.querySelector(owner)
        || (openSurface.startsWith("tool:") ? rootRef.current?.querySelector('[data-workspace-surface="add"]') : null)
        || (openSurface === "settings" ? rootRef.current?.querySelector('[data-workspace-surface="more"]') : null);
      opener?.focus();
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
  useLayoutEffect(() => {
    const pending = pendingFitAnchorRef.current;
    const stage = stageRef.current;
    const root = documentRef.current;
    if (!pending || !stage || !root || Math.abs(pending.finalZoom - zoom) > .001) return;
    pendingFitAnchorRef.current = null;
    const documentElement = root.querySelector(".workspace-v2-a4-document") || root;
    const documentBounds = documentElement.getBoundingClientRect();
    if (!(documentBounds.width > 0 && documentBounds.height > 0)) return;
    const next = scrollForDocumentAnchor({
      currentScrollLeft: stage.scrollLeft,
      currentScrollTop: stage.scrollTop,
      documentLeft: documentBounds.left,
      documentTop: documentBounds.top,
      documentAnchorX: pending.documentAnchorX,
      documentAnchorY: pending.documentAnchorY,
      scale: zoom,
      focalClientX: pending.focalClientX,
      focalClientY: pending.focalClientY
    });
    const bounds = readerScrollBounds({ preserveCurrent: false });
    stage.scrollLeft = Math.min(bounds.maxScrollLeft, Math.max(bounds.minScrollLeft, next.scrollLeft));
    stage.scrollTop = Math.min(bounds.maxScrollTop, Math.max(bounds.minScrollTop, next.scrollTop));
  // The anchor belongs to the zoom geometry that just mounted, and the bounds
  // helper reads the latest mutable refs in that same frame.
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
      const nextZoom = pdfZoomModeRef.current === "fit" ? minimum : Math.max(zoomRef.current, minimum);
      const previousStageWidth = fittedStageWidthRef.current;
      const stageWidth = stage.clientWidth;
      fittedStageWidthRef.current = stageWidth;
      if (Math.abs(zoomRef.current - nextZoom) < .001) return;
      // Docking the side panel narrows the stage, and a narrower stage fits the
      // page at a smaller scale. The document shrinks around a scroll position
      // that does not move, which slides the reader forward - two pages deep
      // into a sheet, more further in. The point the stage is reading from is
      // remembered here in unscaled document space and restored once the new
      // zoom has laid out, exactly as a pinch reconciles its focal point.
      const root = documentRef.current;
      const documentElement = root?.querySelector(".workspace-v2-a4-document") || root;
      const documentBounds = documentElement?.getBoundingClientRect();
      if (previousStageWidth !== null && previousStageWidth !== stageWidth && documentBounds?.height > 0) {
        const stageBounds = stage.getBoundingClientRect();
        const currentZoom = Math.max(.001, zoomRef.current);
        pendingFitAnchorRef.current = {
          finalZoom: nextZoom,
          documentAnchorX: (stageBounds.left - documentBounds.left) / currentZoom,
          documentAnchorY: (stageBounds.top - documentBounds.top) / currentZoom,
          focalClientX: stageBounds.left,
          focalClientY: stageBounds.top
        };
      }
      zoomRef.current = nextZoom;
      setZoom(nextZoom);
    };
    keepPdfFitted();
    const observer = new window.ResizeObserver(keepPdfFitted);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [materialSlug, minimumPdfZoom, sheet?.pdfUrl, sheetSlug]);

  const resetInitialPdfPosition = useCallback(() => {
    const viewKey = `${materialSlug}/${sheetSlug}`;
    if (!hydratedRef.current || initialPageViewRef.current === viewKey) return;
    const stage = stageRef.current;
    if (!stage?.querySelector('[data-pdf-page="1"]')) return;
    const storedView = restored?.view;
    const fitZoom = minimumPdfZoom();
    const initialZoom = rememberZoomLevel ? zoomFromStoredView(storedView) : fitZoom;
    const storedBasis = Number(storedView?.zoomFitBasis);
    const storedZoom = Number(storedView?.zoom);
    pdfZoomModeRef.current = rememberZoomLevel && Number.isFinite(storedBasis) && storedBasis > 0 && Math.abs(storedZoom - storedBasis) > .001
      ? "manual"
      : "fit";
    zoomRef.current = initialZoom;
    setZoom(initialZoom);
    const positionInitialPage = () => {
      const initialPage = stage.querySelector('[data-pdf-page="1"]');
      if (!initialPage) return;
      const stageBounds = stage.getBoundingClientRect();
      const pageBounds = initialPage.getBoundingClientRect();
      const paddingTop = Number.parseFloat(window.getComputedStyle(stage).paddingTop) || 0;
      const targetTop = stage.scrollTop + pageBounds.top - stageBounds.top - paddingTop;
      const desiredLeft = stage.scrollLeft + pageBounds.left - stageBounds.left - Math.max(0, (stage.clientWidth - pageBounds.width) / 2);
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
      pageRef.current = 1;
      setPage(1);
      setPageJumpDraft("1");
      viewPositionRef.current = { left: stage.scrollLeft, top: stage.scrollTop, pageOffset: 0 };
      initialPageViewRef.current = viewKey;
    };
    requestAnimationFrame(() => requestAnimationFrame(positionInitialPage));
  }, [materialSlug, minimumPdfZoom, rememberZoomLevel, restored, sheetSlug, zoomFromStoredView]);

  const markPdfDocumentReady = useCallback(() => setPdfDocumentReady(true), []);

  const resetReaderToPageOne = useCallback(() => {
    setActiveVirtualPageId(null);
    pageRef.current = 1;
    setPage(1);
    setPageJumpDraft("1");
    const placeAtBeginning = () => {
      const stage = stageRef.current;
      const firstPage = stage?.querySelector('[data-pdf-page="1"]');
      if (!stage || !firstPage) return;
      const stageBounds = stage.getBoundingClientRect();
      const pageBounds = firstPage.getBoundingClientRect();
      const paddingTop = Number.parseFloat(window.getComputedStyle(stage).paddingTop) || 0;
      const rightToLeft = window.getComputedStyle(stage).direction === "rtl";
      const desiredLeft = pageBounds.left - stageBounds.left + stage.scrollLeft
        - Math.max(0, (stage.clientWidth - pageBounds.width) / 2);
      stage.scrollTo({
        left: rightToLeft ? 0 : Math.max(0, desiredLeft),
        top: Math.max(0, pageBounds.top - stageBounds.top + stage.scrollTop - paddingTop),
        behavior: "auto"
      });
      viewPositionRef.current = { left: stage.scrollLeft, top: stage.scrollTop, pageOffset: 0 };
    };
    requestAnimationFrame(() => requestAnimationFrame(placeAtBeginning));
  }, []);

  useEffect(() => {
    if (!pdfDocumentReady || !restored) return;
    resetInitialPdfPosition();
  }, [pdfDocumentReady, resetInitialPdfPosition, restored]);

  useEffect(() => {
    setActiveVirtualPageId(null);
    setPage(1);
    pageRef.current = 1;
    setPageJumpDraft("1");
    viewPositionRef.current = { left: 0, top: 0, pageOffset: 0 };
    setPdfDocumentReady(false);
    initialPageViewRef.current = "";
  }, [materialSlug, sheetSlug]);

  const handleCurrentWorkspacePage = useCallback((pdfPage, virtualPageId) => {
    setPage(pdfPage);
    setActiveVirtualPageId(virtualPageId);
  }, []);

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

  const applyWorkspacePageCommand = useCallback((command, direction) => {
    const pages = direction === "undo" ? command.beforePages : command.afterPages;
    const pageIds = new Set(pages.map((item) => item.id));
    const keptMarks = direction === "undo" ? command.beforeItems : command.afterItems;
    const keptNotes = direction === "undo" ? command.beforeNotes : command.afterNotes;
    const affectedMarks = new Set([...command.beforeItems, ...command.afterItems].map((item) => item.id));
    const affectedNotes = new Set([...command.beforeNotes, ...command.afterNotes].map((item) => item.id));
    virtualPagesRef.current = pages;
    setVirtualPages(pages);
    updateAnnotations((current) => [...current.filter((item) => !affectedMarks.has(item.id)), ...keptMarks]);
    notesRef.current = [...notesRef.current.filter((item) => !affectedNotes.has(item.id)), ...keptNotes];
    setNotes(notesRef.current);
    setActiveVirtualPageId((current) => current !== null && !pageIds.has(current) ? null : current);
  }, [updateAnnotations]);

  const undoTool = useCallback(() => {
    setUndoHistory((history) => {
      if (!history.length) return history;
      const command = history[history.length - 1];
      if (command.type === "workspace-page") applyWorkspacePageCommand(command, "undo");
      else updateAnnotations((current) => applyAnnotationCommand(current, command, "undo"));
      setRedoHistory((items) => [...items.slice(-79), command]);
      setSelectedIds([]);
      return history.slice(0, -1);
    });
  }, [applyWorkspacePageCommand, updateAnnotations]);

  const redoTool = useCallback(() => {
    setRedoHistory((history) => {
      if (!history.length) return history;
      const command = history[history.length - 1];
      if (command.type === "workspace-page") applyWorkspacePageCommand(command, "redo");
      else updateAnnotations((current) => applyAnnotationCommand(current, command, "redo"));
      setUndoHistory((items) => [...items.slice(-79), command]);
      setSelectedIds([]);
      return history.slice(0, -1);
    });
  }, [applyWorkspacePageCommand, updateAnnotations]);

  /**
   * Mirrors the local store to the server shortly after it settles. The device
   * store is written first and stays authoritative; a failed push is retried on
   * the next save or when the connection returns.
   */
  const scheduleServerSync = useCallback((delay = SERVER_SYNC_DELAY_MS) => {
    if (serverSyncTimerRef.current) window.clearTimeout(serverSyncTimerRef.current);
    serverSyncTimerRef.current = window.setTimeout(() => {
      serverSyncTimerRef.current = null;
      const sync = serverSyncRef.current;
      if (!sync?.isLoaded()) return;
      void sync.push({
        savedAt: new Date().toISOString(),
        view: { page: pageRef.current, zoom: zoomRef.current },
        notes: notesRef.current,
        annotations: annotationsRef.current,
        virtualPages: virtualPagesRef.current
      });
    }, delay);
  }, []);

  /**
   * Writes only the pages whose ink actually changed. Every edit path produces
   * new annotation objects, so identity signatures detect an erase or a
   * transform that keeps an id, without serializing anything.
   */
  const persistWorkspace = useCallback(async (target = null) => {
    if (!hydratedRef.current) return;
    const document = target || { owner: ownerKey, materialSlug, sheetSlug: storageSlug };
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
          catalogWorkspaceStorageKey(document.owner, document.materialSlug, document.sheetSlug),
          serializeCatalogWorkspace({ annotations: annotationsRef.current, notes: notesRef.current, virtualPages: virtualPagesRef.current, ...view })
        );
        savedPageSignaturesRef.current = signatures;
        setSaveState("saved");
        setSaveErrorReason("");
        if (!target) scheduleServerSync();
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
        virtualPages: virtualPagesRef.current,
        pages,
        removedPages: removed
      });
      savedPageSignaturesRef.current = signatures;
      setSaveState("saved");
      setSaveErrorReason("");
      // A save made for the sheet being left belongs to that sheet, not this sync.
      if (!target) scheduleServerSync();
    } catch (error) {
      // The signatures are deliberately not advanced, so the next save retries
      // exactly the pages that failed.
      setSaveState("error");
      setSaveErrorReason(error?.message || "Marks could not be saved on this device.");
    }
  }, [materialSlug, minimumPdfZoom, ownerKey, scheduleServerSync, storageSlug]);

  persistWorkspaceRef.current = persistWorkspace;

  useEffect(() => {
    let active = true;
    // Switching sheet or account keeps this component mounted, so the sheet
    // being left has to be written before its state is replaced.
    const previous = openDocumentRef.current;
    if (hydratedRef.current && previous && (previous.materialSlug !== materialSlug || previous.sheetSlug !== storageSlug || previous.owner !== ownerKey)) {
      persistWorkspaceRef.current?.(previous);
    }
    hydratedRef.current = false;
    savedPageSignaturesRef.current = new Map();
    setRestored(null);
    setSaveState("idle");
    setSaveErrorReason("");
    const legacyKey = catalogWorkspaceStorageKey(ownerKey, materialSlug, storageSlug);
    const store = annotationStoreRef.current;

    async function hydrate() {
      let snapshot = null;
      try {
        await store.open();
        await store.migrateLegacyDocument({
          owner: ownerKey,
          materialSlug,
          sheetSlug: storageSlug,
          legacyKey,
          parse: parseCatalogWorkspace
        });
        snapshot = await store.readDocument({ owner: ownerKey, materialSlug, sheetSlug: storageSlug });
        storageModeRef.current = "indexeddb";
      } catch {
        // Private browsing modes can refuse IndexedDB entirely. The workspace
        // stays usable on the previous localStorage path rather than losing
        // persistence altogether.
        storageModeRef.current = "local";
        const legacy = loadStoredWorkspace(ownerKey, materialSlug, storageSlug);
        snapshot = legacy ? { view: legacy, notes: legacy.notes, annotations: legacy.annotations, virtualPages: legacy.virtualPages } : null;
      }
      if (!active) return;
      const restoredVirtualPages = sanitizeVirtualPages(snapshot?.virtualPages);
      const virtualIds = new Set(restoredVirtualPages.map((item) => item.id));
      const restoredAnnotations = (snapshot?.annotations || []).filter((item) => !isVirtualPageKey(item.page) || virtualIds.has(item.page));
      const restoredNotes = (snapshot?.notes || []).filter((item) => !isVirtualPageKey(item.page) || virtualIds.has(item.page));
      virtualPagesRef.current = restoredVirtualPages;
      setVirtualPages(restoredVirtualPages);
      setActiveVirtualPageId(null);
      annotationsRef.current = restoredAnnotations;
      notesRef.current = restoredNotes;
      savedPageSignaturesRef.current = pageSignatures(groupAnnotationsByPage(restoredAnnotations), revisionIndexRef.current);
      setAnnotations(restoredAnnotations);
      setNotes(restoredNotes);
      const view = snapshot?.view;
      if (view) {
        viewPositionRef.current = { left: view.scrollLeft, top: view.scrollTop, pageOffset: view.pageOffset };
        if (rememberZoomLevelRef.current && Number.isFinite(view.zoom)) {
          const nextZoom = zoomFromStoredView(view);
          const storedBasis = Number(view.zoomFitBasis);
          pdfZoomModeRef.current = Number.isFinite(storedBasis) && storedBasis > 0 && Math.abs(Number(view.zoom) - storedBasis) > .001
            ? "manual"
            : "fit";
          zoomRef.current = nextZoom;
          setZoom(nextZoom);
        }
      }
      hydratedRef.current = true;
      openDocumentRef.current = { owner: ownerKey, materialSlug, sheetSlug: storageSlug };
      setRestored(snapshot || {});
      setSaveState(snapshot ? "saved" : "idle");
    }

    hydrate();
    return () => { active = false; };
  // `clampReaderZoom` and the remember-* refs are read once per document load.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [materialSlug, ownerKey, storageSlug]);

  // One server mirror per document and account. A sheet without a server
  // document (a build fixture, or one the reader cannot reach) stays local.
  const catalogDocumentId = catalogDocument?.id || "";
  const catalogDocumentVersionId = catalogDocument?.versionId || "";
  // The scope travels with the sync so the server files these marks under the
  // document that was actually marked, not under the sheet's version.
  const scopeEdition = documentScope?.edition || "university";
  const scopeView = documentScope?.view || "study";
  const [serverLoadAttempt, setServerLoadAttempt] = useState(0);
  useEffect(() => {
    const sync = catalogDocumentId && catalogDocumentVersionId
      ? createCatalogServerSync({
        documentId: catalogDocumentId,
        documentVersionId: catalogDocumentVersionId,
        scope: { edition: scopeEdition, view: scopeView },
        // A Sheet Summary has no catalog document of its own, so its marks sync
        // while its notes and last page stay on the device.
        workspaceDocumentId: scopeView === "summary" ? null : catalogDocumentId,
        owner: ownerKey
      })
      : null;
    serverSyncRef.current = sync;
    serverLoadStartedRef.current = null;
    return () => {
      if (serverSyncTimerRef.current) window.clearTimeout(serverSyncTimerRef.current);
      serverSyncTimerRef.current = null;
      if (serverSyncRef.current === sync) serverSyncRef.current = null;
    };
  }, [catalogDocumentId, catalogDocumentVersionId, ownerKey, scopeEdition, scopeView]);

  // The server's copy is read once the local one is restored and the PDF has
  // reported its page count, then merged into what this device holds.
  useEffect(() => {
    const sync = serverSyncRef.current;
    if (!sync || !restored || !pdfDocumentReady || serverLoadStartedRef.current === sync) return;
    serverLoadStartedRef.current = sync;
    sync.load({ pageCount }).then(() => {
      if (serverSyncRef.current !== sync || !hydratedRef.current) return;
      const merged = sync.reconcile({ annotations: annotationsRef.current, notes: notesRef.current, virtualPages: virtualPagesRef.current });
      if (!merged.localChanged) {
        scheduleServerSync(0);
        return;
      }
      // Another device's work arrives as a change like any other: the autosave
      // writes it to this device and then pushes this device's own changes.
      updateAnnotations(merged.annotations);
      virtualPagesRef.current = merged.virtualPages;
      setVirtualPages(merged.virtualPages);
      notesRef.current = merged.notes;
      setNotes(merged.notes);
      setSelectedIds([]);
      setUndoHistory([]);
      setRedoHistory([]);
    }).catch(() => {
      // Offline, or the server is unreachable: stay local, retry on reconnect.
      if (serverLoadStartedRef.current === sync) serverLoadStartedRef.current = null;
    });
  }, [catalogDocumentId, pageCount, pdfDocumentReady, restored, scheduleServerSync, serverLoadAttempt, updateAnnotations]);

  // Work done offline is sent when the connection comes back.
  useEffect(() => subscribeConnection((connection) => {
    if (connection.status === "connected") {
      const sync = serverSyncRef.current;
      if (sync && !sync.isLoaded()) setServerLoadAttempt((attempt) => attempt + 1);
      else if (sync?.hasPending()) void sync.retry();
    }
  }), []);

  // A revision probe is cheap enough to run while the reader is open. Full
  // state is downloaded only after either durable revision changes.
  useEffect(() => {
    let disposed = false;
    let running = false;
    const refreshServerState = async () => {
      if (disposed || running || document.visibilityState === "hidden") return;
      const sync = serverSyncRef.current;
      if (!sync?.isLoaded()) return;
      running = true;
      try {
        const result = await sync.refresh({
          pageCount,
          local: { annotations: annotationsRef.current, notes: notesRef.current, virtualPages: virtualPagesRef.current }
        });
        if (disposed) return;
        if (result.documentChanged) {
          setFocusMessage("This sheet was updated. Your marks are preserved while the new PDF loads.");
          onDocumentChanged();
          return;
        }
        if (!result.changed) return;
        if (!result.localChanged) {
          // The remote revision may have advanced because an earlier response
          // was lost. Retry any pending mutation against the refreshed base.
          scheduleServerSync(0);
          return;
        }
        updateAnnotations(result.annotations);
        virtualPagesRef.current = result.virtualPages;
        setVirtualPages(result.virtualPages);
        notesRef.current = result.notes;
        setNotes(result.notes);
        setSelectedIds([]);
        setUndoHistory([]);
        setRedoHistory([]);
      } catch {
        // The local copy remains authoritative while offline; reconnect and
        // the next bounded probe will retry without losing edits.
      } finally {
        running = false;
      }
    };
    const handleVisibility = () => { if (document.visibilityState === "visible") void refreshServerState(); };
    window.addEventListener("focus", refreshServerState);
    document.addEventListener("visibilitychange", handleVisibility);
    const interval = window.setInterval(refreshServerState, 60_000);
    return () => {
      disposed = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshServerState);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [onDocumentChanged, pageCount, scheduleServerSync, updateAnnotations]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    const rememberView = () => {
      const stageBounds = stage.getBoundingClientRect();
      const currentPage = stage.querySelector(`[data-workspace-page="${activePageKey}"]`);
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
  }, [activePageKey, persistWorkspace]);

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
  }, [annotations, notes, page, persistWorkspace, restored, virtualPages, zoom]);

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
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "x" && selectedAnnotations.length && !selectedAnnotations.some((item) => item.locked)) {
        event.preventDefault();
        selectionClipboardRef.current = selectedAnnotations.map(cloneAnnotation);
        runCommand({ type: "remove", items: selectedAnnotations });
        setSelectedIds([]);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v" && selectionClipboardRef.current.length) {
        event.preventDefault();
        const copies = copiedAnnotations(selectionClipboardRef.current, activePageKey, 24);
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
      if ((event.key === "Delete" || event.key === "Backspace") && selectedAnnotations.length && !selectedAnnotations.some((item) => item.locked)) {
        runCommand({ type: "remove", items: selectedAnnotations });
        setSelectedIds([]);
      }
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
  }, [accessiblePageCount, activePageKey, page, redoTool, runCommand, selectedAnnotations, undoTool]);

  useEffect(() => {
    setSelectedIds([]);
  }, [activePageKey]);

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
    const pageElement = stageRef.current?.querySelector(`[data-workspace-page="${annotationPage}"]`) || documentRef.current;
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
    const pageElement = /** @type {HTMLElement|null} */ (document.elementFromPoint(clientX, clientY)?.closest?.("[data-workspace-page]") || null);
    const bounds = pageElement?.getBoundingClientRect() || documentRef.current?.getBoundingClientRect() || stageRef.current?.getBoundingClientRect();
    if (!bounds) return { x: 0, y: 0, page };
    return { ...pagePointFromClient(clientX, clientY, bounds, PAGE_SPACE, PAGE_SPACE), page: Number(pageElement?.dataset.workspacePage) || activePageKey };
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
      ? eraserSize
      : Math.max(5, (brushSize * 2 * pageWidth) / PAGE_SPACE);
    preview.dataset.tool = activeToolRef.current;
    preview.dataset.profile = activeToolRef.current === "pen" ? penProfile : activeToolRef.current;
    preview.style.setProperty("--workspace-hover-color", activeColor);
    preview.style.setProperty("--workspace-hover-opacity", String(activeToolRef.current === "highlighter" ? highlighterOpacity : activeToolRef.current === "pencil" ? pencilOpacity : brushOpacity));
    preview.style.setProperty("--workspace-hover-line", `${Math.max(1, Math.min(size, size * (activeToolRef.current === "highlighter" ? .72 : .28)))}px`);
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
    gesture.holdStartedAt = null;
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
    const hits = queryAnnotationSpatialIndexBounds(annotationSpatialIndexRef.current, annotationPage, bounds)
      .filter((annotation) => annotationIntersectsPolygon(annotation, polygon))
      .map((annotation) => annotation.id);
    const groups = new Set(annotationsRef.current.filter((item) => hits.includes(item.id) && item.groupId).map((item) => item.groupId));
    return [...new Set([...hits, ...annotationsRef.current.filter((item) => item.page === annotationPage && groups.has(item.groupId) && item.groupId).map((item) => item.id)])];
  }

  function applyHeldRecognition(draftId) {
    const gesture = gestureRef.current;
    const current = draftRef.current;
    if (!current || current.id !== draftId || current.points?.length < 2 || gesture.mode !== INTERACTION_STATE.DRAWING) return;
    const currentEndpoint = current.points.at(-1);
    if (!gesture.holdAnchorPoint || pagePointScreenDistance(currentEndpoint, gesture.holdAnchorPoint, current.page) > HOLD_ENDPOINT_TOLERANCE_PX) return;
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
    // Shape recognition happens when the pointer is released. The hold timer is
    // retained only for the distinct circle-to-erase gesture.
  }

  function scheduleHoldRecognition() {
    const gesture = gestureRef.current;
    const draft = draftRef.current;
    const supportsHold = ["pen", "pencil", "highlighter"].includes(activeToolRef.current);
    if (!supportsHold || !circleToErase || !isLiveStroke(draft)) return;
    const endpoint = draft.points?.at(-1);
    if (!endpoint || pagePointScreenDistance(draft.points[0], endpoint, draft.page) < 18) return;
    if (gesture.holdTimerId !== null && gesture.holdAnchorPoint && pagePointScreenDistance(endpoint, gesture.holdAnchorPoint, draft.page) <= HOLD_ENDPOINT_TOLERANCE_PX) return;
    if (gesture.holdTimerId !== null) window.clearTimeout(gesture.holdTimerId);
    gesture.holdTimerId = null;
    gesture.holdAnchorPoint = { x: endpoint.x, y: endpoint.y };
    gesture.holdStartedAt = window.performance.now();
    const draftId = draft.id;
    gesture.holdTimerId = window.setTimeout(() => {
      gesture.holdTimerId = null;
      applyHeldRecognition(draftId);
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
    const bounds = pageBoundsFor(annotationPage);
    // Page coordinates use 1000 units on both axes even though a PDF is taller
    // than it is wide. The larger dimension keeps the erased area inside the
    // visible circular tip on either axis.
    return pageRadiusForScreenRadius(eraserSize / 2, Math.max(1, bounds?.width || PAGE_SPACE, bounds?.height || PAGE_SPACE), PAGE_SPACE);
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
    const padding = radius + 2;
    const candidates = queryAnnotationSpatialIndexBounds(annotationSpatialIndexRef.current, annotationPage, {
      x: Math.min(previous.x, point.x) - padding,
      y: Math.min(previous.y, point.y) - padding,
      width: Math.abs(point.x - previous.x) + padding * 2,
      height: Math.abs(point.y - previous.y) + padding * 2
    });
    const result = eraserSessionRef.current.append(point, { annotationPage, candidates, radius, mode: ERASER_MODE.PRECISION });
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
    if (isVirtualPageKey(annotationPage)) {
      setActiveVirtualPageId(annotationPage);
      const anchor = virtualPagesRef.current.find((item) => item.id === annotationPage)?.afterPage;
      if (anchor) setPage(anchor);
    } else {
      setActiveVirtualPageId(null);
      if (annotationPage !== page) setPage(annotationPage);
    }
    if (activeTool === "select") {
      const resizeHandle = event.target?.dataset?.resizeHandle;
      if (selectedBounds && (resizeHandle || selectionContains(point, selectedBounds)) && !selectedAnnotations.some((item) => item.locked)) {
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
      setDraft({ id, page: annotationPage, type: "shape", shape: shapeStyle, color: activeColor, width: brushSize * 2, opacity: brushOpacity, start: point, end: point, fill: shapeFill, fillColor: shapeFillColor, dashed: shapeDashed });
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
        smoothing: autoImproveHandwriting && activeTool !== "highlighter" ? Math.max(.8, strokeSmoothing) : strokeSmoothing,
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
    if (sheet?.pdfUrl) pdfZoomModeRef.current = "manual";
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
      revealZoomHud(finalZoom);
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
    revealZoomHud(finalZoom);
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
        if (gesture.mode === INTERACTION_STATE.OBJECT_TRANSFORMING && transformRef.current) {
          if (gesture.transformRafId !== null) cancelAnimationFrame(gesture.transformRafId);
          gesture.transformRafId = null;
          if (transformRef.current.after) {
            applyObjectTransformPreview(transformRef.current.after);
            recordCommand({ type: "update", before: transformRef.current.before, after: transformRef.current.after });
          }
          transformRef.current = null;
        }
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
      if (activeTool !== "hand" && beginDirectObjectMove(event)) return;
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
    if (activeTool !== "hand" && event.pointerType !== "touch" && beginDirectObjectMove(event)) return;
    const canDraw = pointerCanDraw(event.pointerType, drawingInput);
    if (activeTool === "hand" || !canDraw) beginPan(event, GESTURE_DIRECTION.PENDING);
    else if (DRAWING_TOOLS.has(activeTool)) beginAnnotation(event);
    let captured = false;
    try { event.currentTarget.setPointerCapture(event.pointerId); captured = true; } catch { /* Pointer capture is progressive enhancement. */ }
    if (gesture.drawingPointerId === event.pointerId) inkInputControllerRef.current.setCapture(captured);
    event.preventDefault();
  }

  function beginDirectObjectMove(event) {
    if (annotationsHidden || (event.pointerType === "pen" && !["select", "hand"].includes(activeToolRef.current))) return false;
    const target = event.target.closest?.('[data-annotation-type="card"], [data-annotation-type="image"]');
    const id = target?.getAttribute("data-annotation-id");
    const item = annotationsRef.current.find((annotation) => annotation.id === id);
    if (!item || item.locked) return false;
    const before = annotationsRef.current.filter((annotation) => annotation.id === id || (item.groupId && annotation.groupId === item.groupId)).filter((annotation) => !annotation.locked).map(cloneAnnotation);
    const point = documentPoint(event.clientX, event.clientY, item.page);
    setSelectedIds(before.map((annotation) => annotation.id));
    transformRef.current = { kind: "move", start: point, before };
    gestureRef.current.drawingPointerId = event.pointerId;
    gestureRef.current.drawingPointerType = event.pointerType;
    gestureRef.current.annotationPage = item.page;
    gestureRef.current.mode = INTERACTION_STATE.OBJECT_TRANSFORMING;
    lockStageForDrawing(event.pointerId);
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Direct movement still works without capture. */ }
    event.preventDefault();
    return true;
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
    if (gesture.holdTimerId !== null && gesture.holdStartedAt !== null && window.performance.now() - gesture.holdStartedAt >= HOLD_RECOGNITION_MS) {
      window.clearTimeout(gesture.holdTimerId);
      gesture.holdTimerId = null;
      applyHeldRecognition(draftRef.current?.id);
    }
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
      if (clipSelecting) {
        const bounds = gestureBounds(polygon);
        if (bounds?.width > 10 && bounds?.height > 10) captureStudyClip(bounds, draft.page);
        else setFocusMessage("Select a larger area for the study clip.");
        setClipSelecting(false);
      } else {
        const ids = polygon.length >= 3 ? lassoSelectionIds(polygon, draft.page) : [];
        setSelectedIds(ids);
      }
    } else if (draft) {
      const meaningful = draft.type === "shape"
        ? Math.abs(draft.end.x - draft.start.x) > 4 || Math.abs(draft.end.y - draft.start.y) > 4
        : isLiveStroke(draft) ? draft.points?.length > 0 : draft.points?.length > 1;
      if (meaningful) {
        let committed = isLiveStroke(draft) ? { ...draft, points: [...draft.points] } : draft;
        if (committed.type === "shape" && !gesture.holdRecognition) committed = finalizeShape(committed);
        const scribbled = isLiveStroke(committed) ? scribbleEraseTargets(draft) : [];
        let recognizedShape = null;
        if (!scribbled.length && isLiveStroke(committed) && drawAndHold && !gesture.holdRecognition && committed.points.length >= 2) {
          const unitsPerCssPixel = pageUnitsPerCssPixel(committed.page);
          const recognition = recognizeHeldStroke(committed.points, { unitsPerCssPixel });
          const start = committed.points[0];
          const end = committed.points.at(-1);
          const lengthOnScreen = Math.hypot(end.x - start.x, end.y - start.y) / unitsPerCssPixel;
          const minimumConfidence = recognition?.kind === "line" ? .9 : .78;
          if (recognition && recognition.confidence >= minimumConfidence && (recognition.kind !== "line" || lengthOnScreen >= 45) && (committed.type !== "highlighter" || recognition.kind === "line")) {
            recognizedShape = recognizedShapeAnnotation(committed, recognition);
          }
        }
        if (recognizedShape) {
          runCommand({ type: "replace", before: [committed], after: [recognizedShape] });
        } else if (gesture.holdRecognition && gesture.holdRawStroke && draft.type === "shape") {
          runCommand({ type: "replace", before: [gesture.holdRawStroke], after: [committed] });
        } else if (scribbled.length) {
          runCommand({ type: "remove", items: scribbled });
        } else {
          runCommand({ type: "add", items: [committed] });
          if (isLiveStroke(committed)) handedOffInk = committed.id;
        }
      }
    }
    if (handedOffInk) inkHandoffRef.current = { id: handedOffInk, page: draft.page };
    clearDraft({ keepCanvas: Boolean(handedOffInk) });
    gesture.holdRawStroke = null;
    gesture.holdRecognition = null;
    gesture.holdAnchorPoint = null;
    gesture.holdStartedAt = null;
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

  function revealZoomHud(nextZoom, label = "") {
    if (zoomHudTimerRef.current) window.clearTimeout(zoomHudTimerRef.current);
    setZoomHud({ visible: true, label: label || `${Math.round(nextZoom * 100)}%` });
    zoomHudTimerRef.current = window.setTimeout(() => {
      zoomHudTimerRef.current = null;
      setZoomHud((current) => ({ ...current, visible: false }));
    }, 950);
  }

  function zoomTo(nextZoom, clientX, clientY, { mode = "manual", label = "" } = {}) {
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
    if (sheet?.pdfUrl) pdfZoomModeRef.current = mode;
    const bounds = stage.getBoundingClientRect();
    const x = clientX ?? bounds.left + bounds.width / 2;
    const y = clientY ?? bounds.top + bounds.height / 2;
    const anchored = zoomScrollForAnchor({ scrollLeft: stage.scrollLeft, scrollTop: stage.scrollTop, viewportLeft: bounds.left, viewportTop: bounds.top, clientX: x, clientY: y, fromScale: zoomRef.current, toScale: clampReaderZoom(nextZoom) });
    zoomRef.current = anchored.zoom;
    setZoom(anchored.zoom);
    revealZoomHud(anchored.zoom, label || (mode === "fit" ? "Fit width" : ""));
    requestAnimationFrame(() => { stage.scrollLeft = anchored.scrollLeft; stage.scrollTop = anchored.scrollTop; });
  }

  function smartZoom(event) {
    if (activeTool !== "hand") return;
    const fitted = sheet?.pdfUrl ? minimumPdfZoom() : fitWidthZoom(stageRef.current.clientWidth, PAGE_WIDTH, 0);
    const magnification = zoomRef.current / Math.max(.001, fitted);
    const next = magnification < 1.35 ? fitted * 1.75 : fitted;
    zoomTo(next, event.clientX, event.clientY, { mode: next === fitted ? "fit" : "manual", label: next === fitted ? "Fit width" : "Smart zoom" });
  }

  function jumpToPagePosition(nextPage, point = null) {
    stopScrollMomentum();
    const virtual = isVirtualPageKey(nextPage) ? virtualPagesRef.current.find((item) => item.id === nextPage) : null;
    const targetPage = virtual?.afterPage || Math.min(accessiblePageCount, Math.max(accessiblePageStart, Number(nextPage) || accessiblePageStart));
    if (virtual && (targetPage < accessiblePageStart || targetPage > accessiblePageCount)) return;
    setPage(targetPage);
    setActiveVirtualPageId(virtual?.id ?? null);
    const stage = stageRef.current;
    const target = virtual ? stage?.querySelector(`[data-workspace-page="${virtual.id}"]`) : sheet?.pdfUrl ? stage?.querySelector(`[data-pdf-page="${targetPage}"]`) : documentRef.current;
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

  function addBlankPage(background = "blank") {
    if (!sheet?.pdfUrl || !pdfDocumentReady) return;
    const selectedBackground = WORKSPACE_PAGE_BACKGROUNDS.includes(background) ? background : "blank";
    const id = createVirtualPageId(virtualPagesRef.current);
    const before = virtualPagesRef.current;
    const next = insertVirtualPage(before, page, id, activeVirtualPageId, selectedBackground);
    if (next.length === virtualPagesRef.current.length) {
      setFocusMessage("This workspace has reached its blank page limit.");
      return;
    }
    applyWorkspacePageCommand({ type: "workspace-page", beforePages: before, afterPages: next, beforeItems: [], afterItems: [], beforeNotes: [], afterNotes: [] }, "redo");
    recordCommand({ type: "workspace-page", beforePages: before, afterPages: next, beforeItems: [], afterItems: [], beforeNotes: [], afterNotes: [] });
    setActiveVirtualPageId(id);
    setSelectedIds([]);
    setOpenSurface(null);
    requestAnimationFrame(() => requestAnimationFrame(() => jumpToPagePosition(id)));
    setFocusMessage(`${selectedBackground[0].toUpperCase() + selectedBackground.slice(1)} page added after PDF page ${page}.`);
  }

  function deleteBlankPage() {
    const id = activeVirtualPageId;
    if (!isVirtualPageKey(id)) return;
    const anchor = virtualPagesRef.current.find((item) => item.id === id)?.afterPage;
    if (!anchor) return;
    const marks = annotationsRef.current.filter((item) => item.page === id);
    const pageNotes = notesRef.current.filter((item) => item.page === id);
    if ((marks.length || pageNotes.length) && !window.confirm("Delete this blank page and all of its marks and notes?")) return;
    const before = virtualPagesRef.current;
    const next = removeVirtualPage(before, id);
    const command = { type: "workspace-page", beforePages: before, afterPages: next, beforeItems: marks, afterItems: [], beforeNotes: pageNotes, afterNotes: [] };
    applyWorkspacePageCommand(command, "redo");
    recordCommand(command);
    setActiveVirtualPageId(null);
    setSelectedIds([]);
    setOpenSurface(null);
    requestAnimationFrame(() => jumpToPagePosition(anchor));
    setFocusMessage("Blank workspace page deleted.");
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
    if (annotationsHidden && ["pen", "pencil", "highlighter", "eraser", "select", "shapes"].includes(nextTool)) setAnnotationsHidden(false);
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
      if (nextTool === "shapes" && remembered.shapeStyle) setShapeStyle(remembered.shapeStyle);
    }
    setActiveTool(nextTool);
    setOpenSurface(null);
    setCustomColorEditorOpen(false);
    if (nextTool !== "select" && nextTool !== "eraser") setSelectedIds([]);
  }

  function chooseWritingTool(tool) {
    if (tool === "pen" && drawingInput !== DRAWING_INPUT.STYLUS_AND_FINGER) changeDrawingInput(DRAWING_INPUT.STYLUS_AND_FINGER);
    selectTool(tool);
  }

  function addTextAnnotation() {
    const value = textDraft.trim();
    if (!value) return;
    const existing = annotationsRef.current.find((item) => item.id === editingTextId && item.type === "text");
    const formatting = { text: value, align: textAlign, bold: textBold, color: textColor, width: textFontSize / 5 };
    if (existing) runCommand({ type: "update", before: [existing], after: [{ ...existing, ...formatting }] });
    else runCommand({ type: "add", items: [{ id: generateIdempotencyKey(), page: activePageKey, type: "text", x: textAlign === "left" ? 100 : textAlign === "right" ? 900 : 500, y: 360, opacity: 1, ...formatting }] });
    setTextDraft("");
    setEditingTextId(null);
    setOpenSurface(null);
    setFocusMessage(existing ? "Text updated." : `Text added to page ${page}.`);
  }

  function editSelectedText() {
    const item = selectedAnnotations.find((annotation) => annotation.type === "text");
    if (!item || item.locked) return;
    setEditingTextId(item.id);
    setTextDraft(item.text);
    setTextFontSize(Math.round(Math.max(18, item.width * 5)));
    setTextAlign(item.align || "left");
    setTextBold(item.bold === true);
    setTextColor(item.color || COLORS[0]);
    setOpenSurface("text");
  }

  function finalizeShape(shape) {
    const start = shapeSnapGrid
      ? { ...shape.start, x: Math.round(shape.start.x / 25) * 25, y: Math.round(shape.start.y / 25) * 25 }
      : shape.start;
    let end = shapeSnapGrid
      ? { ...shape.end, x: Math.round(shape.end.x / 25) * 25, y: Math.round(shape.end.y / 25) * 25 }
      : shape.end;
    if (["line", "arrow"].includes(shape.shape) && shapeAngle > 0) {
      const distance = Math.hypot(end.x - start.x, end.y - start.y);
      const angle = Math.atan2(end.y - start.y, end.x - start.x);
      const step = shapeAngle * Math.PI / 180;
      const snapped = Math.round(angle / step) * step;
      end = { ...end, x: Math.min(1000, Math.max(0, start.x + Math.cos(snapped) * distance)), y: Math.min(1000, Math.max(0, start.y + Math.sin(snapped) * distance)) };
    }
    if (["square", "circle"].includes(shape.shape)) {
      const side = Math.max(Math.abs(end.x - start.x), Math.abs(end.y - start.y));
      end = { ...end, x: Math.min(1000, Math.max(0, start.x + Math.sign(end.x - start.x || 1) * side)), y: Math.min(1000, Math.max(0, start.y + Math.sign(end.y - start.y || 1) * side)) };
    }
    return { ...shape, start, end };
  }

  function saveCard() {
    const text = cardDraft.trim();
    if (!text) return;
    const existing = annotationsRef.current.find((item) => item.id === editingCardId && item.type === "card");
    if (existing) runCommand({ type: "update", before: [existing], after: [{ ...existing, cardKind, text }] });
    else runCommand({ type: "add", items: [{ id: generateIdempotencyKey(), page: activePageKey, type: "card", cardKind, text, x: 325, y: 260, width: 350, height: 250, color: "#1d3152", opacity: 1 }] });
    setCardDraft("");
    setEditingCardId(null);
    setOpenSurface(null);
    setFocusMessage(existing ? "Card updated. Tap it to move it." : "Study card added. Tap and drag it to move it.");
  }

  function editSelectedCard() {
    const card = selectedAnnotations.find((item) => item.type === "card");
    if (!card) return;
    setEditingCardId(card.id);
    setCardKind(card.cardKind);
    setCardDraft(card.text);
    setOpenSurface("card");
  }

  function captureStudyClip(bounds, pageKey) {
    if (isVirtualPageKey(pageKey)) { setFocusMessage("Choose an area on an original PDF page."); return; }
    const pageElement = stageRef.current?.querySelector(`[data-workspace-page="${pageKey}"]`);
    const source = pageElement?.querySelector("canvas.workspace-v2-a4-canvas.is-visible");
    if (!source || !source.width || !source.height) { setFocusMessage("This page is still rendering. Try again when it appears."); return; }
    const crop = document.createElement("canvas");
    const x = Math.max(0, Math.floor(bounds.x / 1000 * source.width));
    const y = Math.max(0, Math.floor(bounds.y / 1000 * source.height));
    const width = Math.min(source.width - x, Math.max(1, Math.ceil(bounds.width / 1000 * source.width)));
    const height = Math.min(source.height - y, Math.max(1, Math.ceil(bounds.height / 1000 * source.height)));
    crop.width = Math.min(1100, width);
    crop.height = Math.max(1, Math.round(height * crop.width / width));
    crop.getContext("2d")?.drawImage(source, x, y, width, height, 0, 0, crop.width, crop.height);
    const src = crop.toDataURL("image/jpeg", .82);
    if (src.length > 2_800_000) { setFocusMessage("That area is too large for a saved clip."); return; }
    const placedWidth = Math.min(470, Math.max(160, bounds.width));
    const placedHeight = Math.min(470, Math.max(100, placedWidth * height / width));
    runCommand({ type: "add", items: [{ id: generateIdempotencyKey(), page: pageKey, type: "image", kind: "clip", src, x: Math.min(1000 - placedWidth, bounds.x), y: Math.min(1000 - placedHeight, bounds.y + bounds.height + 20), width: placedWidth, height: placedHeight, color: "#ffffff", opacity: 1 }] });
    setOpenSurface(null);
    setFocusMessage("Study clip added. Select it to move or resize it.");
  }

  function groupSelection() {
    if (selectedAnnotations.length < 2) return;
    const groupId = generateIdempotencyKey();
    runCommand({ type: "update", before: selectedAnnotations, after: selectedAnnotations.map((item) => ({ ...item, groupId })) });
    setFocusMessage("Selected items grouped.");
  }

  function ungroupSelection() {
    const grouped = selectedAnnotations.filter((item) => item.groupId);
    if (!grouped.length) return;
    runCommand({ type: "update", before: grouped, after: grouped.map((item) => ({ ...item, groupId: "" })) });
    setFocusMessage("Selected items ungrouped.");
  }

  function toggleSelectionLock() {
    if (!selectedAnnotations.length) return;
    const locked = !selectedAnnotations.every((item) => item.locked);
    runCommand({ type: "update", before: selectedAnnotations, after: selectedAnnotations.map((item) => ({ ...item, locked })) });
    setFocusMessage(locked ? "Selection locked." : "Selection unlocked.");
  }

  function layerSelection(direction) {
    if (!selectedAnnotations.length) return;
    const layers = annotationsRef.current.filter((item) => item.page === activePageKey).map((item) => item.zOrder || 0);
    const order = direction === "forward" ? Math.max(0, ...layers) + 1 : Math.min(0, ...layers) - 1;
    runCommand({ type: "update", before: selectedAnnotations, after: selectedAnnotations.map((item) => ({ ...item, zOrder: order })) });
  }

  function improveSelectedHandwriting() {
    const strokes = selectedAnnotations.filter((item) => ["pen", "pencil"].includes(item.type) && item.points?.length >= 3);
    if (!strokes.length) { setFocusMessage("Select handwriting to improve first."); return; }
    // Stroke points remain untouched. Rendering smooths the path, and Undo can
    // restore the previous strength without losing the student's input.
    const after = strokes.map((item) => ({ ...item, smoothing: Math.max(.8, item.smoothing || 0) }));
    runCommand({ type: "update", before: strokes, after });
    setFocusMessage(`Smoothed ${strokes.length} handwriting stroke${strokes.length === 1 ? "" : "s"}.`);
  }

  function closeSurfaceAndRestoreFocus(selector) {
    setOpenSurface(null);
    window.setTimeout(() => rootRef.current?.querySelector(selector)?.focus(), 0);
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

  function toggleFavoriteColor() {
    const normalized = normalizeToolColor(activeColor);
    if (!normalized) return;
    setFavoriteColors((items) => items.includes(normalized) ? items.filter((color) => color !== normalized) : [normalized, ...items].slice(0, 5));
  }

  function savePenPreset() {
    const preset = { id: generateIdempotencyKey(), profile: penProfile, color: activeColor, size: brushSize, opacity: brushOpacity, pressureSensitivity, smoothing: strokeSmoothing };
    setPenPresets((items) => [preset, ...items].slice(0, 4));
    setFocusMessage("Pen preset saved on this device.");
  }

  function applyPenPreset(preset) {
    setPenProfile(String(preset.profile || PEN_PROFILE.BALL));
    setActiveColor(normalizeToolColor(preset.color) || COLORS[0]);
    setBrushSize(Math.min(12, Math.max(1, Number(preset.size) || 4)));
    setBrushOpacity(Math.min(1, Math.max(.2, Number(preset.opacity) || 1)));
    setPressureSensitivity(Math.min(1, Math.max(0, Number(preset.pressureSensitivity) || .55)));
    setStrokeSmoothing(Math.min(1, Math.max(0, Number(preset.smoothing) || .5)));
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
    setFavoriteColors((items) => items.filter((item) => item !== normalized));
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
      runCommand({ type: "add", items: [{ id: generateIdempotencyKey(), page: activePageKey, type: "image", src: String(reader.result), x: 350, y: 300, width: 300, height: 220, opacity: 1, color: activeColor }] });
      setFocusMessage("Image added and queued for local autosave.");
    };
    reader.onerror = () => setFocusMessage("The selected image could not be read.");
    reader.readAsDataURL(file);
  }

  function duplicateSelection() {
    if (!selectedAnnotations.length) return;
    const copies = copiedAnnotations(selectedAnnotations, activePageKey, 20);
    runCommand({ type: "add", items: copies });
    setSelectedIds(copies.map((item) => item.id));
  }

  function copySelection() {
    if (!selectedAnnotations.length) return;
    selectionClipboardRef.current = selectedAnnotations.map(cloneAnnotation);
    setFocusMessage(`${selectedAnnotations.length} annotation${selectedAnnotations.length === 1 ? "" : "s"} copied.`);
  }

  function cutSelection() {
    if (!selectedAnnotations.length || selectedAnnotations.some((item) => item.locked)) return;
    selectionClipboardRef.current = selectedAnnotations.map(cloneAnnotation);
    runCommand({ type: "remove", items: selectedAnnotations });
    setSelectedIds([]);
    setFocusMessage(`${selectedAnnotations.length} annotation${selectedAnnotations.length === 1 ? "" : "s"} cut.`);
  }

  function pasteSelection() {
    if (!selectionClipboardRef.current.length) return;
    const copies = copiedAnnotations(selectionClipboardRef.current, activePageKey, 24);
    runCommand({ type: "add", items: copies });
    setSelectedIds(copies.map((item) => item.id));
  }

  function rotateSelection() {
    if (!selectedAnnotations.length || !selectedBounds || selectedAnnotations.some((item) => item.locked)) return;
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
    setEntryModePreference("");
    setActiveStudyError("");
  }

  async function chooseActiveStudy() {
    if (activeStudyBusy || !activeStudyReady) return;
    setActiveStudyBusy(true);
    setActiveStudyError("");
    try {
      // The selected difficulty owns its own run.  Never substitute a different
      // in-progress difficulty here: it can already be at a checkpoint and
      // would make choosing Easy / Medium / Hard appear to open a quiz.
      const payload = await focusApi.startManagedActiveStudy({ sheetId: sheet.learningObjectId, difficulty: activeDifficulty, edition: sheetEdition?.edition });
      const run = /** @type {any} */ (payload.run);
      setActiveDifficulty(run.difficulty);
      setActiveStudy(run);
      setStudyMode("active");
      setModeDialogOpen(false);
      setEntryModePreference("");
      // Difficulty selection always returns to the reader's visual beginning.
      // The run's current part/stage remains server-owned and untouched.
      setPage(1);
      pageRef.current = 1;
      setPageJumpDraft("1");
      resetReaderToPageOne();
      setFocusMessage(payload.resumed ? `Part ${run.current_part} resumed.` : `Part ${run.current_part} started.`);
    } catch (error) {
      setActiveStudyError(error.message || "Active Study could not be started.");
    } finally {
      setActiveStudyBusy(false);
    }
  }

  async function loadManagedQuestions(run) {
    const payload = await focusApi.getManagedActiveStudyQuestions(run.id);
    const existingAnswers = {};
    const questions = /** @type {any[]} */ (payload.questions).map((question) => {
      if (question.answered) existingAnswers[String(question.position)] = question.answered;
      return {
        id: String(question.position),
        position: question.position,
        prompt: question.question,
        options: Object.entries(question.options).map(([id, text]) => ({ id, text }))
      };
    });
    setActiveStudy(payload.run || run);
    setActiveQuiz({ ...payload, run: payload.run || run, questions });
    setActiveAnswers(existingAnswers);
    setActiveResult(null);
  }

  async function openActiveQuiz() {
    if (!activeStudy || activeStudyBusy || !activeStudyButtonReady) return;
    setActiveStudyBusy(true);
    setActiveStudyError("");
    try {
      const run = activeStudy.stage === "reading"
        ? (await focusApi.managedActiveStudyAction(activeStudy.id, "complete-reading")).run
        : activeStudy;
      await loadManagedQuestions(run);
    } catch (error) {
      setFocusMessage(error.message || "The Active Study test could not be loaded.");
    } finally {
      setActiveStudyBusy(false);
    }
  }

  async function submitActiveQuiz() {
    if (!activeStudy || !activeQuiz || activeStudyBusy) return;
    setActiveStudyBusy(true);
    try {
      for (const question of activeQuiz.questions) {
        await focusApi.answerManagedActiveStudyQuestion(activeStudy.id, {
          attemptId: activeQuiz.attempt_id,
          position: question.position,
          selectedAnswer: activeAnswers[question.id]
        });
      }
      const payload = await focusApi.submitManagedActiveStudy(activeStudy.id, activeQuiz.attempt_id);
      const result = /** @type {any} */ (payload.result);
      setActiveStudy(payload.run);
      setActiveResult({ ...result, outcome: result.passed ? "passed" : (activeQuiz.kind === "final" ? "failed" : "advisory") });
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
      const payload = await focusApi.managedActiveStudyAction(activeStudy.id, "continue");
      const run = /** @type {any} */ (payload.run);
      setActiveStudy(run);
      setActiveQuiz(null);
      setActiveResult(null);
      setActiveAnswers({});
      setPage(1);
      pageRef.current = 1;
      setPageJumpDraft("1");
      resetReaderToPageOne();
      setFocusMessage(`Part ${run.current_part} is now available. A retake is still recommended.`);
    } catch (error) {
      setFocusMessage(error.message || "The next pages could not be unlocked.");
    } finally {
      setActiveStudyBusy(false);
    }
  }

  async function retakeActiveQuiz() {
    if (!activeStudy || activeStudyBusy) return;
    setActiveStudyBusy(true);
    try {
      const action = activeQuiz?.kind === "final" ? "retry-final" : "study-again";
      const payload = await focusApi.managedActiveStudyAction(activeStudy.id, action);
      const run = /** @type {any} */ (payload.run);
      setActiveStudy(run);
      setActiveQuiz(null);
      setActiveResult(null);
      setActiveAnswers({});
      if (action === "retry-final") await loadManagedQuestions(run);
      else {
        setPage(1);
        pageRef.current = 1;
        setPageJumpDraft("1");
        resetReaderToPageOne();
      }
    } catch (error) {
      setFocusMessage(error.message || "The Active Study stage could not be reopened.");
    } finally {
      setActiveStudyBusy(false);
    }
  }

  async function dismissActiveQuiz() {
    const run = activeStudy;
    setActiveQuiz(null);
    setActiveResult(null);
    setActiveAnswers({});
    if (run?.stage === "reading" || run?.stage === "final") {
      setPage(1);
      pageRef.current = 1;
      setPageJumpDraft("1");
      resetReaderToPageOne();
    }
  }

  async function saveNote() {
    const body = noteDraft.trim();
    if (!body || noteBusy) return;
    const savedPage = activePageKey;
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
    const clamped = Math.min(accessiblePageCount, Math.max(accessiblePageStart, target));
    setPageJumpDraft(String(clamped));
    if (clamped !== page || activeVirtualPageId !== null) jumpToPagePosition(clamped);
  }

  function zoomByStep(factor) {
    const stage = stageRef.current;
    if (!stage) return;
    const bounds = stage.getBoundingClientRect();
    zoomTo(zoomRef.current * factor, bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
  }

  function zoomToFitMultiple(multiplier) {
    const stage = stageRef.current;
    if (!stage) return;
    const bounds = stage.getBoundingClientRect();
    zoomTo(minimumPdfZoom() * multiplier, bounds.left + bounds.width / 2, bounds.top + bounds.height / 2, { mode: multiplier === 1 ? "fit" : "manual", label: multiplier === 1 ? "Fit width" : `${multiplier}× fit` });
  }

  function exportWorkspaceBackup() {
    const payload = buildExportPayload({
      materialSlug,
      sheetSlug,
      materialTitle: material?.title || "",
      sheetTitle: sheet?.title || "",
      annotations: annotationsRef.current,
      notes: notesRef.current,
      virtualPages: virtualPagesRef.current,
      view: {
        page: pageRef.current,
        zoom: zoomRef.current,
        scrollLeft: viewPositionRef.current.left,
        scrollTop: viewPositionRef.current.top,
        pageOffset: viewPositionRef.current.pageOffset
      }
    });
    if (!payload.annotations.length && !payload.notes.length && !payload.virtualPages.length) {
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

  function applyQuickPenPreset(kind) {
    setActiveTool("pen");
    setPenProfile(kind === "bold" ? PEN_PROFILE.BRUSH : PEN_PROFILE.BALL);
    setBrushSize(kind === "underline" ? 2 : kind === "bold" ? 8 : 4);
    setBrushOpacity(1);
    setStrokeSmoothing(kind === "underline" ? .75 : .5);
    setFocusMessage(`${kind[0].toUpperCase() + kind.slice(1)} pen preset selected.`);
  }

  async function exportStudyDocument(kind, { share = false } = {}) {
    if (exportBusy || !sheet?.pdfUrl) return;
    if (kind === "original" && studyMode === "active") {
      setFocusMessage("The original PDF is available for download in Normal Study.");
      return;
    }
    setExportBusy(true);
    setFocusMessage("Preparing your export…");
    try {
      let blob;
      let extension = "pdf";
      if (kind === "original") {
        const response = await fetch(sheet.pdfUrl, { credentials: "include" });
        if (!response.ok) throw new Error("The original PDF could not be downloaded.");
        blob = await response.blob();
      } else {
        const pdfjs = await loadPdfLibrary();
        const loadingTask = pdfjs.getDocument({ url: sheet.pdfUrl });
        const pdf = await loadingTask.promise;
        try {
          const lastAllowed = Math.min(pdf.numPages, accessiblePageCount);
          const from = kind === "range" ? Math.min(lastAllowed, Math.max(1, Number(exportRangeStart) || 1)) : kind === "current" || kind === "png" ? page : 1;
          const to = kind === "range" ? Math.min(lastAllowed, Math.max(from, Number(exportRangeEnd) || from)) : kind === "current" || kind === "png" ? page : lastAllowed;
          const pages = kind === "current" || kind === "png"
            ? [{ kind: activeVirtualPageId === null ? "pdf" : "virtual", key: activeVirtualPageId ?? page, pdfPage: page }]
            : includeWorkspacePages
              ? composeWorkspacePages(Array.from({ length: to - from + 1 }, (_, index) => from + index), virtualPagesRef.current)
              : Array.from({ length: to - from + 1 }, (_, index) => ({ kind: "pdf", key: from + index, pdfPage: from + index }));
          async function* pageCanvases() {
            for (const item of pages) {
              yield await renderWorkspacePage({
                pdf: item.kind === "pdf" ? pdf : null,
                pageNumber: item.pdfPage,
                background: item.background,
                annotations: annotationsRef.current.filter((annotation) => annotation.page === item.key)
              });
            }
          }
          if (kind === "png") {
            const canvas = await pageCanvases().next();
            const currentCanvas = canvas.value;
            if (!currentCanvas) throw new Error("Image export failed.");
            blob = await new Promise((resolve, reject) => currentCanvas.toBlob((value) => value ? resolve(value) : reject(new Error("Image export failed.")), "image/png"));
            extension = "png";
          } else blob = await canvasesToPdf(pageCanvases());
        } finally {
          await loadingTask.destroy();
        }
      }
      const name = `${sheetSlug}-${kind === "original" ? "original" : kind === "png" ? `page-${page}` : kind === "current" ? `page-${page}` : kind === "range" ? `pages-${exportRangeStart}-${exportRangeEnd}` : "annotated"}.${extension}`;
      if (share && navigator.share && navigator.canShare?.({ files: [new File([blob], name, { type: blob.type })] })) {
        await navigator.share({ files: [new File([blob], name, { type: blob.type })], title: sheet.title });
        setFocusMessage("Document shared.");
      } else {
        downloadWorkspaceBlob(blob, name);
        setFocusMessage(share ? "Sharing is unavailable here, so the file was downloaded." : "Export downloaded.");
      }
      setOpenSurface(null);
    } catch (error) {
      if (error?.name !== "AbortError") setFocusMessage(error?.message || "Export could not be completed.");
    } finally {
      setExportBusy(false);
    }
  }

  /** Restore only ever adds. Existing ids are left exactly as they are. */
  function applyRestoredBackup(payload) {
    const existingIds = new Set(virtualPagesRef.current.map((item) => item.id));
    const nextVirtualPages = sanitizeVirtualPages([...virtualPagesRef.current, ...sanitizeVirtualPages(payload.virtualPages).filter((item) => !existingIds.has(item.id))]);
    const addedPages = nextVirtualPages.length - virtualPagesRef.current.length;
    if (addedPages) {
      virtualPagesRef.current = nextVirtualPages;
      setVirtualPages(nextVirtualPages);
    }
    const validPageIds = new Set(nextVirtualPages.map((item) => item.id));
    const incomingAnnotations = payload.annotations.filter((item) => !isVirtualPageKey(item.page) || validPageIds.has(item.page));
    const { merged: mergedAnnotations, added, skipped } = mergeRestoredAnnotations(annotationsRef.current, incomingAnnotations);
    const { merged: mergedNotes, added: addedNotes } = mergeRestoredNotes(notesRef.current, payload.notes.filter((item) => !isVirtualPageKey(item.page) || validPageIds.has(item.page)));
    if (addedNotes) {
      notesRef.current = mergedNotes;
      setNotes(mergedNotes);
    }
    if (added) {
      const additions = mergedAnnotations.slice(annotationsRef.current.length);
      runCommand({ type: "add", items: additions });
    }
    setPendingImport(null);
    if (!added && !addedNotes && !addedPages) setFocusMessage("Everything in that backup is already on this sheet.");
    else setFocusMessage(`Restored ${addedPages} blank page${addedPages === 1 ? "" : "s"}, ${added} mark${added === 1 ? "" : "s"}, and ${addedNotes} note${addedNotes === 1 ? "" : "s"}.${skipped ? ` ${skipped} already present.` : ""}`);
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
    const items = annotationsRef.current.filter((item) => item.page === activePageKey && !item.locked);
    if (!items.length) return;
    runCommand({ type: "remove", items });
    setSelectedIds([]);
    setOpenSurface(null);
    setFocusMessage(`${items.length} mark${items.length === 1 ? "" : "s"} cleared from ${activeVirtualPageId === null ? `PDF page ${page}` : "the blank page"}. Undo restores them.`);
  }

  function fitPdfWidth() {
    const stage = stageRef.current;
    if (!stage) return;
    const bounds = stage.getBoundingClientRect();
    zoomTo(minimumPdfZoom(), bounds.left + bounds.width / 2, bounds.top + Math.min(bounds.height / 2, 180), { mode: "fit" });
    setFocusMessage("PDF fitted to width.");
  }

  if (!material || !sheet) return <main className="workspace-v2 workspace-v2-missing"><h1>Workspace unavailable</h1><button type="button" onClick={() => navigate("/materials")}>Back to materials</button></main>;

  const saveLabel = saveState === "saving" ? "Saving…" : saveState === "error" ? "Local save unavailable" : "Saved on this device";
  const activeToolLabel = TOOL_ITEMS.find(([id]) => id === activeTool)?.[1] || "Tool";
  const customColors = addSavedColor(recentColors, null, MAX_PALETTE_COLORS, COLORS);
  const customColorSet = new Set(customColors);
  const paletteColors = normalizeSavedPalette([...favoriteColors, ...COLORS, ...customColors], MAX_PALETTE_COLORS);
  const quickColors = normalizeSavedPalette([...favoriteColors, ...recentColors, ...COLORS], 3);
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
      <button type="button" onPointerDown={stopPointer} onClick={cutSelection} disabled={selectedAnnotations.some((item) => item.locked)}><Scissors size={15} />Cut</button>
      <button type="button" onPointerDown={stopPointer} onClick={pasteSelection} disabled={!selectionClipboardRef.current.length}><ClipboardPaste size={15} />Paste</button>
      <button type="button" onPointerDown={stopPointer} onClick={duplicateSelection}><Copy size={15} />Duplicate</button>
      {selectedAnnotations.some((item) => item.type === "card") && <button type="button" onPointerDown={stopPointer} onClick={editSelectedCard}><FileText size={15} />Edit card</button>}
      {selectedAnnotations.some((item) => item.type === "text") && <button type="button" onPointerDown={stopPointer} onClick={editSelectedText} disabled={selectedAnnotations.some((item) => item.locked)}><Type size={15} />Edit text</button>}
      <button type="button" onPointerDown={stopPointer} onClick={toggleSelectionLock}>{selectedAnnotations.every((item) => item.locked) ? <Unlock size={15} /> : <Lock size={15} />}{selectedAnnotations.every((item) => item.locked) ? "Unlock" : "Lock"}</button>
      <button type="button" onPointerDown={stopPointer} onClick={() => setSelectionActionsOpen((open) => !open)} aria-expanded={selectionActionsOpen}><MoreHorizontal size={15} />Actions</button>
      {selectionActionsOpen && <>
        <button type="button" onPointerDown={stopPointer} onClick={improveSelectedHandwriting} disabled={!selectedAnnotations.some((item) => ["pen", "pencil"].includes(item.type))}><Sparkles size={15} />Improve</button>
        <button type="button" onPointerDown={stopPointer} onClick={groupSelection} disabled={selectedAnnotations.length < 2}><Group size={15} />Group</button>
        <button type="button" onPointerDown={stopPointer} onClick={ungroupSelection} disabled={!selectedAnnotations.some((item) => item.groupId)}><Ungroup size={15} />Ungroup</button>
        <button type="button" onPointerDown={stopPointer} onClick={() => layerSelection("forward")} disabled={selectedAnnotations.some((item) => item.locked)}><Layers3 size={15} />Forward</button>
        <button type="button" onPointerDown={stopPointer} onClick={() => layerSelection("backward")} disabled={selectedAnnotations.some((item) => item.locked)}><Layers3 size={15} />Backward</button>
        <button type="button" onPointerDown={stopPointer} onClick={rotateSelection} disabled={selectedAnnotations.some((item) => item.locked)}><RotateCw size={15} />Rotate</button>
        <button type="button" className="is-danger" onPointerDown={stopPointer} disabled={selectedAnnotations.some((item) => item.locked)} onClick={() => { runCommand({ type: "remove", items: selectedAnnotations }); setSelectedIds([]); }}><Eraser size={15} />Delete</button>
      </>}
    </div>;
  }

  function renderPdfPageOverlay(pageNumber) {
    const annotationsOnPage = annotationsByPage.get(pageNumber) || NO_ANNOTATIONS;
    const pageIsCurrent = pageNumber === activePageKey;
    const handleRadius = 11 * pageUnitsPerCssPixel(pageNumber);
    return <>
      <svg className={annotationLayerClass} viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-label={isVirtualPageKey(pageNumber) ? "Annotations for blank workspace page" : `Annotations for PDF page ${pageNumber}`}>
        <AnnotationVisuals annotations={annotationsHidden ? NO_ANNOTATIONS : annotationsOnPage} prefix={`page-${pageNumber}`} includeHitTargets={activeTool === "select" && !annotationsHidden} />
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
              <div className="workspace-v3-document-context" dir="auto">
                <strong>{sheet.title}</strong>
                <span>{summaryMode ? "Sheet summary" : `${sheetEdition?.edition || "University"} edition`}</span>
              </div>
            </div>
            <div className="workspace-v3-primary" ref={toolRailRef}>
              <div className="workspace-v2-tool-list" aria-label="Writing tools">
                {PRIMARY_WRITE_TOOLS.map(([id, label, ToolIcon, responsiveClass]) => {
                  const expanded = activeTool === id && toolOptionsOpen === id;
                  return <WorkspaceIconButton
                    key={id}
                    className={`workspace-v3-tool-button${id === "pen" ? " is-hero" : ""}${responsiveClass ? ` ${responsiveClass}` : ""}`}
                    label={label}
                    caption={label}
                    active={activeTool === id}
                    aria-pressed={activeTool === id}
                    aria-expanded={CONFIGURABLE_TOOLS.has(id) ? expanded : undefined}
                    aria-controls={CONFIGURABLE_TOOLS.has(id) ? `workspace-${id}-options` : undefined}
                    data-workspace-tool={id}
                    style={id === activeTool && ["pen", "highlighter"].includes(id) ? cssVars({ "--workspace-tool-color": activeColor }) : undefined}
                    onClick={() => chooseWritingTool(id)}
                  ><ToolIcon size={19} /></WorkspaceIconButton>;
                })}
                <WorkspaceIconButton label="Add" caption="Add" className="workspace-v3-tool-button" active={openSurface === "add"} aria-expanded={openSurface === "add"} aria-controls="workspace-add-popover" data-workspace-surface="add" onClick={() => setOpenSurface((current) => current === "add" ? null : "add")}><Plus size={20} /></WorkspaceIconButton>
              </div>
              <div className="workspace-v3-quick-colors" role="group" aria-label="Quick annotation colors">
                {quickColors.map((color) => <button key={color} type="button" className={`workspace-v3-quick-color${activeColor === color ? " is-active" : ""}`} aria-label={`Use ${color}`} aria-pressed={activeColor === color} title={color} disabled={!showColorPalette} style={cssVars({ "--workspace-tool-color": color })} onClick={() => chooseAnnotationColor(color)}><span /></button>)}
              </div>
              <div className="workspace-v2-history" aria-label="Edit history">
                <WorkspaceIconButton label="Undo (Ctrl+Z)" caption="Undo" className="workspace-v3-history-button" disabled={!undoHistory.length} onClick={undoTool}><Undo2 size={18} /></WorkspaceIconButton>
                <WorkspaceIconButton label="Redo (Ctrl+Shift+Z)" caption="Redo" className="workspace-v3-history-button" disabled={!redoHistory.length} onClick={redoTool}><Redo2 size={18} /></WorkspaceIconButton>
              </div>
            </div>
            <input ref={imageInputRef} className="workspace-v2-file-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={addImage} tabIndex={-1} aria-hidden="true" />
            <div className="workspace-v2-toolbar-actions" aria-label="Workspace controls">
              <WorkspaceIconButton label="Search document (coming later)" className="workspace-v3-search" disabled><Search size={18} /></WorkspaceIconButton>
              <WorkspaceIconButton label={sideOpen ? "Close notes" : "Open notes"} caption="Comments" className="workspace-v3-utility-button" active={sideOpen} aria-pressed={sideOpen} aria-expanded={sideOpen} aria-controls="workspace-notes-panel" data-workspace-tool="note" onClick={() => selectTool("note")}><MessageSquare size={18} /></WorkspaceIconButton>
              <button type="button" className={`workspace-v2-study-mode-button is-${studyMode || "choose"}${studyMode === "active" && activeStudy ? " has-progress" : ""}`} onClick={() => { setOpenSurface(null); setModeDialogOpen(true); }} aria-label={studyMode === "active" && activeStudy ? `Active Study: part ${activeStudy.current_part} of ${activeStudy.number_of_parts}` : "Choose study mode"} title={studyMode === "active" && activeStudy ? `Active Study · part ${activeStudy.current_part} of ${activeStudy.number_of_parts}` : "Choose study mode"}><Brain size={18} /><span className="workspace-v2-tool-caption" aria-hidden="true">Study</span>{studyMode === "active" && activeStudy && <span className="workspace-v2-study-mode-status"><strong>Active</strong><small>Part {activeStudy.current_part}/{activeStudy.number_of_parts}</small></span>}</button>
              <WorkspaceIconButton label="More workspace actions" caption="More" className="workspace-v3-utility-button" active={openSurface === "more" || settingsOpen} aria-expanded={openSurface === "more" || settingsOpen} aria-controls="workspace-more-popover" data-workspace-surface="more" onClick={() => setOpenSurface((current) => current === "more" ? null : "more")}><MoreHorizontal size={20} /></WorkspaceIconButton>
            </div>
          </nav>

          {openSurface === "add" && <section id="workspace-add-popover" className="workspace-v2-action-popover is-add" role="dialog" aria-label="Add to page" onPointerDown={(event) => event.stopPropagation()}>
            <header><strong>Add to page {page}</strong><button type="button" aria-label="Close Add menu" onClick={() => closeSurfaceAndRestoreFocus('[data-workspace-surface="add"]')}><X size={17} /></button></header>
            <div className="workspace-v3-menu-list workspace-v5-add-list">
              <button type="button" aria-label="Text" onClick={() => { setEditingTextId(null); setTextDraft(""); setOpenSurface("text"); }} data-workspace-tool="text"><Type size={18} /><span><strong>Add text</strong><small>Place editable text on this page</small></span></button>
              <button type="button" aria-label="Image" data-workspace-tool="image" onClick={() => selectTool("image")}><ImageIcon size={18} /><span><strong>Add image</strong><small>Insert a photo or image file</small></span></button>
              <button type="button" onClick={() => selectTool("note")}><MessageSquare size={18} /><span><strong>Open notes</strong><small>Write a note alongside this sheet</small></span></button>
              <button type="button" onClick={() => { setCardKind("sticky"); setCardDraft(""); setEditingCardId(null); setOpenSurface("card"); }}><StickyNote size={18} /><span><strong>Add sticky note</strong><small>Place a movable note on this page</small></span></button>
              <button type="button" onClick={() => { setCardKind("note"); setCardDraft(""); setEditingCardId(null); setOpenSurface("card"); }}><FileText size={18} /><span><strong>Add note card</strong><small>Choose a study card style</small></span></button>
              <button type="button" onClick={toggleBookmark} disabled={bookmarkBusy} aria-pressed={bookmarked}><Bookmark size={18} /><span><strong>{bookmarked ? "Remove bookmark" : "Bookmark page"}</strong><small>Keep PDF page {page} easy to return to</small></span></button>
              {sheet.pdfUrl && <button type="button" aria-label="Add Page" onClick={() => setOpenSurface("page-background")}><Plus size={18} /><span><strong>Add page</strong><small>Blank, ruled, grid, or dotted after PDF page {page}</small></span></button>}
              {sheet.pdfUrl && <button type="button" onClick={() => { setClipSelecting(true); setLassoMode("rectangle"); setActiveTool("select"); setSelectedIds([]); setOpenSurface(null); setFocusMessage("Drag a rectangle over the PDF to capture a study clip."); }}><Camera size={18} /><span><strong>Add study clip</strong><small>Select an area of the PDF to reuse</small></span></button>}
            </div>
          </section>}

          {openSurface === "page-background" && <section className="workspace-v2-action-popover is-add" role="dialog" aria-label="Choose workspace page background" onPointerDown={(event) => event.stopPropagation()}>
            <header><strong>Add page after PDF page {page}</strong><button type="button" aria-label="Close page backgrounds" onClick={() => setOpenSurface("add")}><X size={17} /></button></header>
            <div className="workspace-v3-menu-list">
              {[["blank", "Blank", "Plain writing page"], ["lined", "Ruled", "Lines for handwriting"], ["grid", "Grid", "Graph and diagrams"], ["dot", "Dotted", "Light dot guide"]].map(([background, label, description]) => <button key={background} type="button" onClick={() => addBlankPage(background)}><span className={`workspace-v6-page-pattern is-${background}`} aria-hidden="true" /><span><strong>{label}</strong><small>{description}</small></span></button>)}
            </div>
          </section>}

          {openSurface === "card" && <section className="workspace-v2-action-popover is-add workspace-v6-card-editor" role="dialog" aria-label={editingCardId ? "Edit study card" : "Add study card"} onPointerDown={(event) => event.stopPropagation()}>
            <header><strong>{editingCardId ? "Edit study card" : "Add study card"}</strong><button type="button" aria-label="Close card editor" onClick={() => setOpenSurface(null)}><X size={17} /></button></header>
            <div className="workspace-v6-card-kinds" role="group" aria-label="Card style">
              {[["sticky", "Sticky"], ["note", "Note"], ["lined", "Lined"], ["revision", "Revision"]].map(([kind, label]) => <button key={kind} type="button" className={cardKind === kind ? "is-active" : ""} aria-pressed={cardKind === kind} onClick={() => setCardKind(kind)}>{label}</button>)}
            </div>
            <label className="workspace-v3-text-entry"><span>Card text</span><textarea value={cardDraft} maxLength={1200} rows={5} onChange={(event) => setCardDraft(event.target.value)} /></label>
            <button type="button" className="workspace-v3-menu-primary" onClick={saveCard} disabled={!cardDraft.trim()}>{editingCardId ? "Save card" : "Add card"}</button>
          </section>}

          {openSurface === "text" && <section className="workspace-v2-action-popover is-text" role="dialog" aria-label={editingTextId ? "Edit text annotation" : "Add text annotation"} onPointerDown={(event) => event.stopPropagation()}>
            <header><strong>{editingTextId ? "Edit text" : activeVirtualPageId === null ? `Add text to PDF page ${page}` : `Add text to workspace page after PDF page ${page}`}</strong><button type="button" aria-label="Close text editor" onClick={() => closeSurfaceAndRestoreFocus('[data-workspace-surface="add"]')}><X size={17} /></button></header>
            <label className="workspace-v3-text-entry"><span>Annotation text</span><textarea ref={textInputRef} value={textDraft} maxLength={1000} rows={4} onChange={(event) => setTextDraft(event.target.value)} /></label>
            <div className="workspace-v6-text-controls">
              <label>Size <input type="number" min="18" max="64" value={textFontSize} onChange={(event) => setTextFontSize(Math.min(64, Math.max(18, Number(event.target.value) || 18)))} /></label>
              <label>Color <input type="color" value={textColor} onChange={(event) => setTextColor(event.target.value)} /></label>
              <button type="button" aria-pressed={textBold} className={textBold ? "is-active" : ""} onClick={() => setTextBold((current) => !current)}><strong>B</strong> Bold</button>
              <label>Align <select value={textAlign} onChange={(event) => setTextAlign(event.target.value)}><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></label>
            </div>
            <button type="button" className="workspace-v3-menu-primary" onClick={addTextAnnotation} disabled={!textDraft.trim()}>{editingTextId ? "Save text" : "Add text"}</button>
          </section>}

          {openSurface === "more" && <section id="workspace-more-popover" className="workspace-v2-action-popover is-more" role="dialog" aria-label="More workspace actions" onPointerDown={(event) => event.stopPropagation()}>
            <header><strong>Workspace</strong><button type="button" aria-label="Close workspace actions" onClick={() => closeSurfaceAndRestoreFocus('[data-workspace-surface="more"]')}><X size={17} /></button></header>
            <div className="workspace-v3-menu-list">
              <button type="button" onClick={() => chooseWritingTool("pencil")}><Pencil size={18} /><span><strong>Pencil</strong><small>Sketch with a textured stroke</small></span></button>
              <button type="button" className="workspace-v3-compact-only" onClick={() => chooseWritingTool("shapes")}><Shapes size={18} /><span><strong>Shapes</strong><small>Draw lines and diagrams</small></span></button>
              <button type="button" className="workspace-v3-phone-only" onClick={() => chooseWritingTool("highlighter")}><Highlighter size={18} /><span><strong>Highlight</strong><small>Mark important passages</small></span></button>
              <button type="button" className="workspace-v3-phone-only" onClick={() => chooseWritingTool("eraser")}><Eraser size={18} /><span><strong>Eraser</strong><small>Remove ink precisely</small></span></button>
              <button type="button" className="workspace-v3-phone-only" onClick={() => chooseWritingTool("select")}><MousePointer2 size={18} /><span><strong>Lasso</strong><small>Select and transform marks</small></span></button>
              <button type="button" onClick={() => exportStudyDocument("original")} disabled={exportBusy || studyMode === "active"}><Download size={18} /><span><strong>Download original</strong><small>Save the source PDF</small></span></button>
              <button type="button" onClick={() => exportStudyDocument("annotated", { share: true })} disabled={exportBusy}><Share2 size={18} /><span><strong>Share</strong><small>Share or save your annotated work</small></span></button>
              <button type="button" aria-label={bookmarked ? "Remove from Bookmarks" : "Save to Bookmarks"} aria-pressed={bookmarked} onClick={toggleBookmark} disabled={bookmarkBusy}><Bookmark size={18} fill={bookmarked ? "currentColor" : "none"} /><span><strong>{bookmarked ? "Remove bookmark" : "Bookmark page"}</strong><small>Keep page {page} easy to return to</small></span></button>
              <button type="button" onClick={() => { setAnnotationsHidden((value) => !value); setSelectedIds([]); setActiveTool("hand"); }} aria-pressed={annotationsHidden}>{annotationsHidden ? <Eye size={18} /> : <EyeOff size={18} />}<span><strong>{annotationsHidden ? "Show annotations" : "Hide annotations"}</strong><small>Temporarily clear the reading view</small></span></button>
              <button type="button" onClick={() => { setExportRangeStart(page); setExportRangeEnd(page); setOpenSurface("export"); }}><FileText size={18} /><span><strong>Export</strong><small>PDF, page range, or PNG image</small></span></button>
              <button type="button" onClick={toggleDocumentFullscreen}>{isDocumentFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}<span><strong>{isDocumentFullscreen ? "Exit full-screen writing" : "Full-screen writing mode"}</strong><small>Use the full display for the PDF</small></span></button>
              <button type="button" onClick={() => exportStudyDocument("png")} disabled={exportBusy}><Camera size={18} /><span><strong>Page snapshot</strong><small>Save this page as a PNG image</small></span></button>
              <button type="button" onClick={() => setOpenSurface("history")}><List size={18} /><span><strong>Version history</strong><small>Review recent edits in this session</small></span></button>
              {activeVirtualPageId !== null && <button type="button" onClick={deleteBlankPage}><Trash2 size={18} /><span><strong>Delete blank page</strong><small>Remove this workspace page and its marks</small></span></button>}
              <button type="button" aria-label="Workspace settings" aria-controls="workspace-settings-popover" onClick={() => setOpenSurface("settings")}><Settings size={18} /><span><strong>Settings</strong><small>Drawing, PDF, and backup preferences</small></span></button>
            </div>
          </section>}

          {openSurface === "export" && <section className="workspace-v2-action-popover is-more" role="dialog" aria-label="Export workspace" onPointerDown={(event) => event.stopPropagation()}>
            <header><strong>Export</strong><button type="button" aria-label="Close export menu" onClick={() => setOpenSurface("more")}><X size={17} /></button></header>
            <div className="workspace-v3-menu-list">
              <button type="button" onClick={() => exportStudyDocument("original")} disabled={exportBusy || studyMode === "active"}><Download size={18} /><span><strong>Original PDF</strong><small>Unmodified document</small></span></button>
              <button type="button" onClick={() => exportStudyDocument("annotated")} disabled={exportBusy}><FileText size={18} /><span><strong>PDF with annotations</strong><small>Include your marks and study objects</small></span></button>
              <button type="button" onClick={() => exportStudyDocument("current")} disabled={exportBusy}><FileText size={18} /><span><strong>Current page</strong><small>Save the page you are reading</small></span></button>
              <div className="workspace-v6-export-range"><label>From <input type="number" min="1" max={accessiblePageCount} value={exportRangeStart} onChange={(event) => setExportRangeStart(Number(event.target.value) || 1)} /></label><label>To <input type="number" min="1" max={accessiblePageCount} value={exportRangeEnd} onChange={(event) => setExportRangeEnd(Number(event.target.value) || 1)} /></label><button type="button" onClick={() => exportStudyDocument("range")} disabled={exportBusy}>Export page range</button></div>
              <button type="button" onClick={() => exportStudyDocument("png")} disabled={exportBusy}><ImageIcon size={18} /><span><strong>Image (PNG)</strong><small>Current page as an image</small></span></button>
            </div>
          </section>}

          {openSurface === "history" && <section className="workspace-v2-action-popover is-more" role="dialog" aria-label="Version history" onPointerDown={(event) => event.stopPropagation()}>
            <header><strong>Version history</strong><button type="button" aria-label="Close version history" onClick={() => setOpenSurface("more")}><X size={17} /></button></header>
            <div className="workspace-v3-menu-list workspace-v6-history"><p>Edits from this session. Use Undo to restore an earlier step.</p><strong>{undoHistory.length} edit{undoHistory.length === 1 ? "" : "s"} available</strong><button type="button" onClick={undoTool} disabled={!undoHistory.length}><Undo2 size={18} /><span><strong>Undo most recent edit</strong><small>Redo remains available in the toolbar</small></span></button></div>
          </section>}

          {toolOptionsOpen && <div ref={toolOptionsRef} id={`workspace-${toolOptionsOpen}-options`} className="workspace-v2-tool-options" data-workspace-tool={activeTool} role="dialog" aria-label={`${activeToolLabel} options`} onPointerDown={(event) => event.stopPropagation()}>
            <div className="workspace-v2-tool-options-title"><span><strong>{activeToolLabel}</strong><small>{activeTool === "highlighter" ? "Transparent marking" : activeTool === "eraser" ? "Erase only beneath the tip" : activeTool === "select" ? "Select and transform marks" : activeTool === "shapes" ? "Precise geometry" : "Draw on your workspace"}</small></span><span className={`workspace-v5-stroke-preview is-${activeTool}`} style={cssVars({ "--workspace-tool-color": activeColor, "--workspace-preview-size": `${Math.max(2, brushSize)}px`, "--workspace-preview-opacity": activeToolOpacity })} aria-hidden="true" /></div>
            {activeTool === "eraser" && <section className="workspace-v5-inspector-section"><h3>Eraser size</h3><ToolRange label="Eraser size" value={eraserSize} displayValue={`${eraserSize}px`} min={6} max={48} step={2} preview="eraser" onChange={setEraserSize} /><p>The tip removes only the area it crosses.</p></section>}
            {activeTool === "pen" && <section className="workspace-v5-inspector-section"><h3>Pen type</h3><PenProfilePicker value={penProfile} onChange={changePenProfile} color={activeColor} /></section>}
            {activeTool === "pen" && <section className="workspace-v5-inspector-section"><h3>Quick presets</h3><div className="workspace-v6-quick-presets" role="group" aria-label="Quick pen presets">{["notes", "underline", "bold"].map((kind) => <button key={kind} type="button" onClick={() => applyQuickPenPreset(kind)}><span className={`is-${kind}`} /><strong>{kind[0].toUpperCase() + kind.slice(1)}</strong></button>)}</div></section>}
            {activeTool === "select" && <section className="workspace-v5-inspector-section"><h3>Selection mode</h3><IconChoiceGroup label="Lasso mode" value={lassoMode} options={LASSO_MODE_OPTIONS} onChange={setLassoMode} /><p>Select a mark to move, resize, copy, cut, duplicate, rotate, or delete it.</p></section>}
            {activeTool === "select" && selectedAnnotations.length > 0 && <section className="workspace-v5-inspector-section"><h3>Selection actions</h3><div className="workspace-v6-inspector-actions">
              <button type="button" onClick={improveSelectedHandwriting} disabled={!selectedAnnotations.some((item) => ["pen", "pencil"].includes(item.type))}><Sparkles size={16} />Improve handwriting</button>
              <button type="button" onClick={groupSelection} disabled={selectedAnnotations.length < 2}><Group size={16} />Group</button>
              <button type="button" onClick={ungroupSelection} disabled={!selectedAnnotations.some((item) => item.groupId)}><Ungroup size={16} />Ungroup</button>
              <button type="button" onClick={toggleSelectionLock}>{selectedAnnotations.every((item) => item.locked) ? <Unlock size={16} /> : <Lock size={16} />}{selectedAnnotations.every((item) => item.locked) ? "Unlock selection" : "Lock selection"}</button>
              <button type="button" onClick={() => layerSelection("forward")} disabled={selectedAnnotations.some((item) => item.locked)}><Layers3 size={16} />Bring forward</button>
              <button type="button" onClick={() => layerSelection("backward")} disabled={selectedAnnotations.some((item) => item.locked)}><Layers3 size={16} />Send backward</button>
              <button type="button" onClick={copySelection}><Copy size={16} />Copy</button>
              <button type="button" onClick={cutSelection} disabled={selectedAnnotations.some((item) => item.locked)}><Scissors size={16} />Cut</button>
              <button type="button" onClick={duplicateSelection}><Copy size={16} />Duplicate</button>
              <button type="button" onClick={() => { runCommand({ type: "remove", items: selectedAnnotations }); setSelectedIds([]); }} disabled={selectedAnnotations.some((item) => item.locked)}><Trash2 size={16} />Delete</button>
            </div></section>}
            {activeTool === "shapes" && <section className="workspace-v5-inspector-section"><h3>Shape</h3><IconChoiceGroup label="Shape type" value={shapeStyle} options={SHAPE_OPTIONS} onChange={setShapeStyle} /></section>}
            {activeTool === "shapes" && <section className="workspace-v5-inspector-section"><h3>Shape style and precision</h3><div className="workspace-v6-shape-settings">
              <SettingsToggle icon={Shapes} label="Fill shape" description="Use a solid color inside closed shapes" checked={shapeFill} onChange={setShapeFill} />
              {shapeFill && <label>Fill color <input type="color" value={shapeFillColor} onChange={(event) => setShapeFillColor(event.target.value)} /></label>}
              <SettingsToggle icon={Minus} label="Dashed line" description="Draw borders and lines as dashes" checked={shapeDashed} onChange={setShapeDashed} />
              <SettingsToggle icon={Shapes} label="Perfect shapes on release" description="Straighten lines and clean up geometry as soon as you lift" checked={drawAndHold} onChange={setDrawAndHold} />
              <SettingsToggle icon={Minus} label="Straighten line" description="Snap line and arrow angles" checked={shapeAngle > 0} onChange={(enabled) => setShapeAngle(enabled ? 15 : 0)} />
              <label>Ruler / angle <select value={shapeAngle} onChange={(event) => setShapeAngle(Number(event.target.value))}><option value="0">Free angle</option><option value="15">15° steps</option><option value="30">30° steps</option><option value="45">45° steps</option><option value="90">90° steps</option></select></label>
              <SettingsToggle icon={Hash} label="Snap to grid" description="Align endpoints to a 25-unit grid" checked={shapeSnapGrid} onChange={setShapeSnapGrid} />
            </div></section>}
            {activeTool !== "select" && activeTool !== "eraser" && <section className="workspace-v5-inspector-section"><h3>{activeTool === "shapes" ? "Stroke width" : "Thickness"}</h3><div className="workspace-v2-tool-settings" aria-label={`${activeToolLabel} controls`}>
              {inkToolActive && <QuickSizes values={QUICK_THICKNESSES} value={brushSize} onChange={setBrushSize} label={activeTool === "shapes" ? "Border width" : "Thickness"} />}
              {inkToolActive && <ToolRange label={activeTool === "shapes" ? "Border width" : "Thickness"} value={brushSize} min={1} max={12} step={1} onChange={setBrushSize} color={activeColor} />}
              {inkToolActive && <ToolRange label="Opacity" value={activeToolOpacity} displayValue={`${Math.round(activeToolOpacity * 100)}%`} min={activeTool === "highlighter" ? .1 : .2} max={1} step={.05} preview="opacity" color={activeColor} onChange={updateActiveToolOpacity} />}
              {["pen", "pencil"].includes(activeTool) && <StrokeFeelPicker value={strokeSmoothing} onChange={setStrokeSmoothing} />}
            </div></section>}
            {showColorPalette && <section className="workspace-v5-inspector-section"><h3>{activeTool === "select" ? "Selected mark color" : "Color"}</h3>
              <div className="workspace-v2-colors" aria-label={activeTool === "select" ? "Selection colors" : "Annotation colors"}>
                {paletteColors.map((color) => <span key={color} className={`workspace-v2-color-item${customColorSet.has(color) ? " is-custom" : ""}`}>
                  <button type="button" className={`workspace-v2-color-swatch${activeColor === color ? " is-active" : ""}`} aria-label={`Use ${color}`} title={color} aria-pressed={activeColor === color} style={cssVars({ "--workspace-tool-color": color })} onClick={() => chooseAnnotationColor(color)} />
                  {customColorSet.has(color) && <button type="button" className="workspace-v2-color-delete" aria-label={`Delete ${color}`} title={`Delete ${color}`} onClick={() => deleteCustomColor(color)}><Minus size={11} /></button>}
                </span>)}
                {paletteColors.length < MAX_PALETTE_COLORS && <button type="button" className={`workspace-v2-custom-color${customColorEditorOpen ? " is-active" : ""}`} aria-label="Add Color" title="Add Color" aria-expanded={customColorEditorOpen} onClick={() => { setCustomColorDraft(activeColor); setCustomColorEditorOpen((current) => !current); }}><Plus size={15} /><span>Add</span></button>}
                <button type="button" className={`workspace-v4-favorite-color${favoriteColors.includes(activeColor) ? " is-active" : ""}`} aria-label={favoriteColors.includes(activeColor) ? "Remove current color from favorites" : "Favorite current color"} aria-pressed={favoriteColors.includes(activeColor)} onClick={toggleFavoriteColor}><Star size={15} fill={favoriteColors.includes(activeColor) ? "currentColor" : "none"} /></button>
                {customColorEditorOpen && <div className="workspace-v2-custom-color-editor" role="group" aria-label="Custom color editor">
                  <input type="color" aria-label="Choose custom color" value={customColorDraft} onChange={(event) => setCustomColorDraft(event.target.value)} />
                  <button type="button" aria-label="Save custom color" title="Save color" onClick={commitCustomColor}><Check size={16} /></button>
                </div>}
              </div>
            </section>}
            {["pen", "highlighter"].includes(activeTool) && (recentColors.length > 0 || favoriteColors.length > 0) && <section className="workspace-v5-inspector-section">{recentColors.length > 0 && <><h3>Recent colors</h3><div className="workspace-v6-color-strip">{recentColors.slice(0, 8).map((color) => <button key={color} type="button" aria-label={`Use recent ${color}`} style={{ backgroundColor: color }} onClick={() => chooseAnnotationColor(color)} />)}</div></>}{favoriteColors.length > 0 && <><h3>Favorites</h3><div className="workspace-v6-color-strip">{favoriteColors.map((color) => <button key={color} type="button" aria-label={`Use favorite ${color}`} style={{ backgroundColor: color }} onClick={() => chooseAnnotationColor(color)} />)}</div></>}</section>}
            {activeTool === "pen" && <details className="workspace-v5-advanced"><summary>Presets &amp; pen gestures</summary><div className="workspace-v4-pen-presets" aria-label="Saved pen presets">
              {penPresets.map((preset, index) => <span key={preset.id} className="workspace-v4-pen-preset"><button type="button" aria-label={`Use pen preset ${index + 1}`} title={`Preset ${index + 1}`} onClick={() => applyPenPreset(preset)} style={cssVars({ "--workspace-tool-color": preset.color, "--workspace-preset-size": `${Math.max(2, Number(preset.size) || 4)}px` })}><i /></button><button type="button" aria-label={`Delete pen preset ${index + 1}`} onClick={() => setPenPresets((items) => items.filter((item) => item.id !== preset.id))}><X size={10} /></button></span>)}
              <button type="button" className="workspace-v4-save-preset" aria-label="Save current pen preset" onClick={savePenPreset} disabled={penPresets.length >= 4}><Plus size={14} /><span>Preset</span></button>
            </div><ToolRange label="Pressure sensitivity" value={pressureSensitivity} displayValue={`${Math.round(pressureSensitivity * 100)}%`} min={0} max={1} step={.05} onChange={setPressureSensitivity} color={activeColor} /><ToolRange label="Stroke smoothing" value={strokeSmoothing} displayValue={`${Math.round(strokeSmoothing * 100)}%`} min={0} max={1} step={.05} onChange={setStrokeSmoothing} color={activeColor} /><div className="workspace-v4-pen-gestures" aria-label="Pen gestures"><SettingsToggle icon={Shapes} label="Perfect shapes on release" description="Refine lines and shapes when you lift" checked={drawAndHold} onChange={setDrawAndHold} /><SettingsToggle icon={Circle} label="Circle erase" description="Circle marks and hold to erase them" checked={circleToErase} onChange={setCircleToErase} /></div></details>}
          </div>}

          {settingsOpen && <section id="workspace-settings-popover" className="workspace-v2-settings-popover" role="dialog" aria-label="Workspace settings" onPointerDown={(event) => event.stopPropagation()}>
            <header><span><Settings size={19} />Settings</span><button type="button" aria-label="Close workspace settings" onClick={() => closeSurfaceAndRestoreFocus('[data-workspace-surface="more"]')}><X size={19} /></button></header>
            <div className="workspace-v6-settings-layout">
              <nav className="workspace-v6-settings-nav" aria-label="Settings sections">
                {[{ id: "writing", Icon: PenLine, label: "Writing", detail: "Pens and handwriting" }, { id: "gestures", Icon: Hand, label: "Gestures", detail: "Touch and shortcuts" }, { id: "workspace", Icon: BookOpen, label: "Workspace", detail: "Pages and study tools" }, { id: "export", Icon: Share2, label: "Export", detail: "Save and share" }].map(({ id, Icon, label, detail }) => <button key={id} type="button" className={settingsTab === id ? "is-active" : ""} aria-current={settingsTab === id ? "page" : undefined} onClick={() => setSettingsTab(id)}><Icon size={19} /><span><strong>{label}</strong><small>{detail}</small></span></button>)}
              </nav>
              <div className="workspace-v2-settings-content">
                {settingsTab === "writing" && <section aria-labelledby="workspace-writing-settings"><h2 id="workspace-writing-settings">Writing</h2>
                  <button type="button" className="workspace-v2-settings-action" onClick={() => { setOpenSurface("tool:pen"); setActiveTool("pen"); }}><PenLine size={18} /><span><strong>Pen presets</strong><small>Open your saved and quick pen styles</small></span></button>
                  <ToolRange label="Pressure sensitivity" value={pressureSensitivity} displayValue={`${Math.round(pressureSensitivity * 100)}%`} min={0} max={1} step={.05} onChange={setPressureSensitivity} color={activeColor} />
                  <ToolRange label="Stroke smoothing" value={strokeSmoothing} displayValue={`${Math.round(strokeSmoothing * 100)}%`} min={0} max={1} step={.05} onChange={setStrokeSmoothing} color={activeColor} />
                  <SettingsToggle icon={Sparkles} label="Improve new handwriting" description="Smooth pen and pencil strokes while keeping their original points" checked={autoImproveHandwriting} onChange={setAutoImproveHandwriting} />
                  <SettingsToggle icon={Eraser} label="Scribble to erase" description="Scratch across your own ink to remove it" checked={scribbleToErase} onChange={setScribbleToErase} />
                  <SettingsToggle icon={Shapes} label="Perfect shapes on release" description="Refine lines and shapes when you lift" checked={drawAndHold} onChange={setDrawAndHold} />
                  <button type="button" className="workspace-v2-settings-action" onClick={() => { setOpenSurface("tool:select"); setActiveTool("select"); }}><Sparkles size={18} /><span><strong>Improve handwriting</strong><small>Select pen strokes, then smooth them from Lasso</small></span></button>
                  <button type="button" className="workspace-v2-settings-action is-danger" onClick={clearPageAnnotations} disabled={!pageAnnotations.some((item) => !item.locked)}><Trash2 size={18} /><span><strong>{activeVirtualPageId === null ? `Clear ink on PDF page ${page}` : "Clear ink on workspace page"}</strong><small>Remove unlocked marks on this page; Undo restores them</small></span></button>
                </section>}
                {settingsTab === "gestures" && <section aria-labelledby="workspace-gesture-settings"><h2 id="workspace-gesture-settings">Gestures</h2>
                  <SettingsToggle icon={PenLine} label="Apple Pencil mode" description="Pencil draws while fingers navigate" checked={drawingInput === DRAWING_INPUT.STYLUS_ONLY} onChange={(enabled) => changeDrawingInput(enabled ? DRAWING_INPUT.STYLUS_ONLY : DRAWING_INPUT.STYLUS_AND_FINGER)} />
                  <SettingsToggle icon={Shapes} label="Perfect shapes on release" description="Refine lines and shapes when you lift" checked={drawAndHold} onChange={setDrawAndHold} />
                  <SettingsToggle icon={Circle} label="Circle to erase" description="Circle handwriting and hold to remove it" checked={circleToErase} onChange={setCircleToErase} />
                </section>}
                {settingsTab === "workspace" && <section aria-labelledby="workspace-page-settings"><h2 id="workspace-page-settings">Workspace</h2>
                  <button type="button" className="workspace-v2-settings-action" onClick={() => setOpenSurface("page-background")} disabled={!sheet.pdfUrl}><Plus size={18} /><span><strong>Add page</strong><small>Choose a background after this PDF page</small></span></button>
                  <button type="button" className="workspace-v2-settings-action" onClick={() => { setCardKind("note"); setOpenSurface("card"); }}><StickyNote size={18} /><span><strong>Add note card</strong><small>Create an editable study card</small></span></button>
                  <SettingsToggle icon={EyeOff} label="Hide annotations" description="Temporarily show only the source document" checked={annotationsHidden} onChange={(hidden) => { setAnnotationsHidden(hidden); setSelectedIds([]); if (hidden) setActiveTool("hand"); }} />
                  <button type="button" className="workspace-v2-settings-action" onClick={() => { setClipSelecting(true); setLassoMode("rectangle"); setActiveTool("select"); setOpenSurface(null); }}><Camera size={18} /><span><strong>Study clip behavior</strong><small>Drag a rectangle to save a reusable PDF area</small></span></button>
                  <SettingsToggle icon={Bookmark} label="Remember last position" description="Keep the last position in your backup" checked={rememberLastPosition} onChange={setRememberLastPosition} />
                  <SettingsToggle icon={ZoomIn} label="Remember zoom level" description="Restore this sheet at the same zoom" checked={rememberZoomLevel} onChange={setRememberZoomLevel} />
                  <SettingsToggle icon={Eye} label="Show page number" description="Display the current PDF page" checked={showPageNumber} onChange={setShowPageNumber} />
                  {wakeLockSupported && <SettingsToggle icon={Power} label="Keep screen awake" description="Prevent sleep during study" checked={keepScreenAwake} onChange={setKeepScreenAwake} />}
                </section>}
                {settingsTab === "export" && <section aria-labelledby="workspace-export-settings"><h2 id="workspace-export-settings">Export</h2>
                  <button type="button" className="workspace-v2-settings-action" onClick={() => exportStudyDocument("annotated")} disabled={exportBusy}><FileText size={18} /><span><strong>Export as PDF</strong><small>Include annotations on accessible pages</small></span></button>
                  <button type="button" className="workspace-v2-settings-action" onClick={() => exportStudyDocument("png")} disabled={exportBusy}><ImageIcon size={18} /><span><strong>Export as image</strong><small>Save the current page as PNG</small></span></button>
                  <button type="button" className="workspace-v2-settings-action" onClick={() => exportStudyDocument("annotated", { share: true })} disabled={exportBusy}><Share2 size={18} /><span><strong>Share destination</strong><small>Use the device share sheet when available</small></span></button>
                  <SettingsToggle icon={BookOpen} label="Include workspace pages" description="Add your inserted pages to PDF exports" checked={includeWorkspacePages} onChange={setIncludeWorkspacePages} />
                  {saveState === "error" && <p className="workspace-v2-settings-note" role="alert">{saveErrorReason || "Marks could not be saved on this device."}</p>}
                  <button type="button" className="workspace-v2-settings-action" onClick={exportWorkspaceBackup} disabled={backupBusy}><Download size={18} /><span><strong>Export workspace backup</strong><small>Save editable marks and notes as JSON</small></span></button>
                  <button type="button" className="workspace-v2-settings-action" onClick={() => backupInputRef.current?.click()} disabled={backupBusy}><Upload size={18} /><span><strong>Restore a backup</strong><small>Add anything missing without replacing current work</small></span></button>
                  {pendingImport && <div className="workspace-v2-settings-confirm" role="group" aria-label="Confirm restore from another sheet"><p>Restore {pendingImport.annotations.length} marks from {pendingImport.sheetTitle || pendingImport.sheetSlug}?</p><div><button type="button" onClick={() => applyRestoredBackup(pendingImport)}>Restore anyway</button><button type="button" onClick={() => setPendingImport(null)}>Cancel</button></div></div>}
                  <input ref={backupInputRef} className="workspace-v2-file-input" type="file" accept="application/json,.json" onChange={readWorkspaceBackup} tabIndex={-1} aria-hidden="true" />
                </section>}
              </div>
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
            {sheet.pdfUrl ? <ContinuousA4Pdf pdfUrl={sheet.pdfUrl} pageCount={pageCount} visiblePageStart={accessiblePageStart} visiblePageCount={accessiblePageCount} zoom={zoom} stageRef={stageRef} documentRootRef={documentRef} onPageCount={syncPdfPageCount} onDocumentReady={markPdfDocumentReady} onCurrentPageChange={handleCurrentWorkspacePage} virtualPages={virtualPages} renderPageOverlay={renderPdfPageOverlay} onPdfPageRendered={recordPdfPageRender} /> : <article ref={documentRef} className="workspace-v2-document" onDoubleClick={smartZoom} style={cssVars({ "--workspace-document-width": `${PAGE_WIDTH * zoom}px`, "--workspace-document-min-height": `${760 * zoom}px`, "--workspace-document-max-width": "none" })}>
              <svg className={annotationLayerClass} viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-label="Document annotations">
                <AnnotationVisuals annotations={annotationsHidden ? [] : pageAnnotations} prefix={`document-${page}`} includeHitTargets={activeTool === "select" && !annotationsHidden} />
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
                <button type="button" aria-label="Previous page" title="Previous page" disabled={page <= accessiblePageStart} onClick={() => jumpToPagePosition(page - 1)}><ChevronLeft size={16} /></button>
                <label className="workspace-v2-page-input"><span className="workspace-v2-visually-hidden">Go to page</span><input type="number" inputMode="numeric" min={accessiblePageStart} max={accessiblePageCount} value={pageJumpDraft} onChange={(event) => setPageJumpDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); commitPageJump(); } }} onBlur={commitPageJump} /></label>
                <span className="workspace-v2-page-total">/ {accessiblePageCount}</span>
                <button type="button" aria-label="Next page" title="Next page" disabled={page >= accessiblePageCount} onClick={() => jumpToPagePosition(page + 1)}><ChevronRight size={16} /></button>
              </div>
              <div className="workspace-v2-page-jump" role="group" aria-label="Workspace pages">
                <button type="button" onClick={() => addBlankPage()}><Plus size={16} />Add Page</button>
                {activeVirtualPageId !== null && <button type="button" onClick={deleteBlankPage}><Trash2 size={16} />Delete blank page</button>}
              </div>
              <div className="workspace-v2-zoom-control" role="group" aria-label="Zoom">
                <button type="button" aria-label="Zoom out" title="Zoom out" disabled={zoom <= clampReaderZoom(MIN_FOCUS_ZOOM) + .001} onClick={() => zoomByStep(1 / 1.25)}><Minus size={16} /></button>
                <output aria-label={`Current zoom ${Math.round(zoom * 100)} percent`}>{Math.round(zoom * 100)}%</output>
                <button type="button" aria-label="Zoom in" title="Zoom in" disabled={zoom >= MAX_FOCUS_ZOOM - .001} onClick={() => zoomByStep(1.25)}><Plus size={16} /></button>
                {sheet.pdfUrl && <button type="button" className="workspace-v2-fit-width" aria-label="Fit width" title="Fit width" onClick={fitPdfWidth}><MoveHorizontal size={16} /></button>}
              </div>
              {sheet.pdfUrl && <div className="workspace-v4-zoom-presets" role="group" aria-label="Quick zoom presets">
                {[1, 1.25, 1.5, 2].map((multiple) => <button key={multiple} type="button" className={Math.abs(zoom / minimumPdfZoom() - multiple) < .04 ? "is-active" : ""} aria-label={multiple === 1 ? "Set zoom to fit width preset" : `Zoom to ${multiple} times fit width`} onClick={() => zoomToFitMultiple(multiple)}>{multiple === 1 ? "Fit" : `${multiple}×`}</button>)}
              </div>}
            </div>}
            <button
              type="button"
              className="workspace-v2-page-number"
              aria-label={activeVirtualPageId === null ? `PDF page ${page} of ${accessiblePageCount}` : `Blank workspace page after PDF page ${page}; PDF has ${accessiblePageCount} pages`}
              title="Page, workspace pages, and zoom"
              aria-expanded={pageNavigatorOpen}
              aria-controls="workspace-page-navigator"
              onClick={() => setOpenSurface((current) => current === "pages" ? null : "pages")}
            ><Hash size={12} aria-hidden="true" /><strong>{page}</strong><span>/ {accessiblePageCount}</span></button>
          </div>}
          {/* Laptop and desktop readers get a zoom bar that is always on screen. CSS
              shows it only for a fine pointer without a touchscreen, so phones and
              iPads keep pinch zoom and the page dock exactly as they were. */}
          {sheet.pdfUrl && <div className="workspace-v2-zoom-bar" role="group" aria-label="Zoom" onPointerDown={(event) => event.stopPropagation()}>
            <button type="button" aria-label="Zoom out" title="Zoom out" disabled={zoom <= clampReaderZoom(MIN_FOCUS_ZOOM) + .001} onClick={() => zoomByStep(1 / 1.25)}><Minus size={16} /></button>
            <output aria-label={`Current zoom ${Math.round(zoom * 100)} percent`}>{Math.round(zoom * 100)}%</output>
            <button type="button" aria-label="Zoom in" title="Zoom in" disabled={zoom >= MAX_FOCUS_ZOOM - .001} onClick={() => zoomByStep(1.25)}><Plus size={16} /></button>
            <span className="workspace-v2-zoom-bar-divider" aria-hidden="true" />
            <button type="button" className="workspace-v4-zoom-fit" aria-label="Fit width" title="Reset zoom to fit the page width" onClick={fitPdfWidth}><MoveHorizontal size={14} aria-hidden="true" /><span>Fit</span></button>
            <div className="workspace-v4-zoom-presets is-compact" role="group" aria-label="Quick zoom presets">
              {[1.25, 1.5, 2].map((multiple) => <button key={multiple} type="button" className={Math.abs(zoom / minimumPdfZoom() - multiple) < .04 ? "is-active" : ""} aria-label={`Zoom to ${multiple} times fit width`} onClick={() => zoomToFitMultiple(multiple)}>{multiple}×</button>)}
            </div>
          </div>}
          {sheet.pdfUrl && <output className={`workspace-v4-zoom-hud${zoomHud.visible ? " is-visible" : ""}`} aria-live="polite" aria-label={`Zoom ${Math.round(zoom * 100)} percent`}><strong>{Math.round(zoom * 100)}%</strong><span>{zoomHud.label && !zoomHud.label.endsWith("%") ? zoomHud.label : pdfZoomModeRef.current === "fit" ? "Fit width" : "Zoom"}</span></output>}
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
      {studyMode === "active" && activeStudy?.status === "active" && ["reading", "checkpoint", "final"].includes(activeStudy.stage) && <div className="workspace-v2-checkpoint-dock" role="status" aria-live="polite">
        <button type="button" className={`workspace-v2-checkpoint-button${activeStudyButtonReady ? " is-ready" : ""}`} onClick={openActiveQuiz} disabled={activeStudyBusy || !activeStudyButtonReady} aria-label={activeStudyButtonReady ? (activeStudy.stage === "final" ? "Open final exam" : "Open checkpoint") : `Reach page ${accessiblePageCount} to unlock the checkpoint`}>{activeStudyButtonReady ? <><CheckCircle2 size={20} /><span className="workspace-v2-checkpoint-copy">{activeStudy.stage === "final" ? "Final Exam" : "Checkpoint"}</span></> : <><CheckCircle2 size={20} /><span className="workspace-v2-checkpoint-copy">Reach page {accessiblePageCount}</span></>}</button>
      </div>}
      {modeDialogOpen && <StudyModeDialog difficulty={activeDifficulty} setDifficulty={setActiveDifficulty} activeAvailable={activeStudyReady} busy={activeStudyBusy || activeStudyAvailabilityLoading} error={activeStudyError} onNormal={chooseNormalStudy} onActive={chooseActiveStudy} activeOnly={entryModePreference === "active"} />}
      {activeQuiz && activeStudy && <ActiveStudyQuiz quiz={activeQuiz} answers={activeAnswers} setAnswers={setActiveAnswers} result={activeResult} busy={activeStudyBusy} onSubmit={submitActiveQuiz} onDismiss={dismissActiveQuiz} onRetake={retakeActiveQuiz} onContinue={continueActiveStudyAnyway} />}
    </main>
  );
}
