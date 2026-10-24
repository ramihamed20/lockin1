/** Constants shared by the Focus workspace page and its parts. */
import { ArrowRight, Brush, Circle, Eraser, Feather, Hand, Highlighter, Image as ImageIcon, MessageSquare, Minus, MousePointer2, Pencil, PenLine, PenTool, Shapes, Square, RectangleHorizontal, Triangle, Sparkles, Type } from "lucide-react";
import { ERASER_MODE, PEN_PROFILE } from "../../workspace/ink/strokeModel.js";
import { TRANSIENT_INK_KIND } from "../../workspace/ink/transientInk.js";
import { WORKSPACE_ZOOM } from "../../workspace/config.js";

export const PAGE_COUNT = 342;
export const PAGE_WIDTH = 690;
export const PAGE_SPACE = 1000;
export const MIN_FOCUS_ZOOM = WORKSPACE_ZOOM.minimum;
export const MAX_FOCUS_ZOOM = WORKSPACE_ZOOM.catalogMaximum;
export const AUTOSAVE_IDLE_MS = 750;
// The server mirror trails the local save, so a burst of strokes or a scroll
// becomes one request rather than many.
export const SERVER_SYNC_DELAY_MS = 1_500;
// Deep, saturated inks that stay readable on white paper and under the night
// theme; amber doubles as the classic highlighter.
export const COLORS = ["#2563eb", "#e5383b", "#f5b700", "#16a34a", "#7c3aed", "#1e2a44", "#f97316", "#db2777"];
export const HOLD_RECOGNITION_MS = 500;
export const HOLD_ENDPOINT_TOLERANCE_PX = 28;
export const TOOL_MEMORY_KEY = "lock-in.catalog-workspace.tool-memory.v2";
export const RECENT_COLORS_KEY = "lock-in.catalog-workspace.recent-colors.v1";
export const FAVORITE_COLORS_KEY = "lock-in.catalog-workspace.favorite-colors.v1";
export const WORKSPACE_SETTINGS_KEY = "lock-in.catalog-workspace.settings.v1";
export const FINGER_SCROLL_HINT_KEY = "lock-in.catalog-workspace.finger-scroll-hint.v1";
export const MAX_PALETTE_COLORS = 10;
export const ZOOM_OVERSHOOT_RATIO = .22;
export const NO_ANNOTATIONS = Object.freeze([]);
export const ZOOM_SETTLE_MS = 220;
export const SPRING_DEADLINE_MS = 900;
export const STATUS_MESSAGE_MS = 6_000;

/** @type {Array<[string, string, import("lucide-react").LucideIcon]>} */
export const TOOL_ITEMS = [
  ["hand", "focus.tool.pan", Hand],
  ["pen", "focus.tool.pen", PenLine],
  ["pencil", "focus.pencil", Pencil],
  ["highlighter", "focus.highlight", Highlighter],
  ["eraser", "focus.eraser", Eraser],
  ["select", "focus.lasso", MousePointer2],
  ["shapes", "focus.tool.shape", Shapes],
  ["image", "focus.image", ImageIcon],
  ["text", "focus.text", Type],
  ["note", "focus.notes", MessageSquare]
];

/** @type {Array<[string, string, import("lucide-react").LucideIcon, string]>} */
// Study order, not alphabetical: the three writing tools first, so a phone
// that can show only four keeps Pen, Highlight, Eraser and Lasso on screen;
// Hand and Shapes follow and stay in the More menu as well.
export const PRIMARY_WRITE_TOOLS = [
  ["pen", "focus.tool.pen", PenLine, ""],
  ["highlighter", "focus.highlight", Highlighter, ""],
  ["eraser", "focus.eraser", Eraser, ""],
  ["select", "focus.lasso", MousePointer2, ""],
  ["hand", "focus.tool.hand", Hand, ""],
  ["shapes", "focus.shapes", Shapes, "is-tablet-secondary"]
];
// Tools that draw with a colour and a width; their button carries a swatch of both.
export const SWATCH_TOOLS = new Set(["pen", "pencil", "highlighter", "shapes"]);

export const SETTINGS_SECTIONS = Object.freeze([
  { id: "drawing", label: "focus.settingsDrawing" },
  { id: "canvas", label: "focus.settingsCanvas" },
  { id: "view", label: "focus.settingsView" },
  { id: "other", label: "focus.settingsOther" }
]);
export const PAGE_BACKGROUND_CHOICES = Object.freeze([["blank", "focus.background.blank"], ["lined", "focus.background.ruled"], ["grid", "focus.background.grid"], ["dot", "focus.background.dotted"]]);
export const DRAWING_TOOLS = new Set(["pen", "pencil", "highlighter", "eraser", "shapes", "select"]);
export const POPOVER_SURFACES = new Set(["add", "page-background", "card", "text", "more", "export", "settings", "search"]);
export const CONFIGURABLE_TOOLS = new Set(["pen", "pencil", "highlighter", "eraser", "select", "shapes"]);
/** @type {Array<[string, string, import("lucide-react").LucideIcon, string]>} */
export const PEN_PROFILE_OPTIONS = [
  [PEN_PROFILE.BALL, "focus.pen.ball", PenLine, "focus.pen.ballShort"],
  [PEN_PROFILE.FOUNTAIN, "focus.pen.fountain", Feather, "focus.pen.fountainShort"],
  [PEN_PROFILE.BRUSH, "focus.pen.brush", Brush, "focus.pen.brushShort"],
  [PEN_PROFILE.CALLIGRAPHY, "focus.pen.calligraphy", PenTool, "focus.pen.calligraphyShort"],
  // Temporary glowing ink: drawn on its own canvas, never saved (see transientInk.js).
  [TRANSIENT_INK_KIND.POINTER, "focus.pen.pointer", Sparkles, "focus.pen.pointerShort"]
];
export const SHAPE_OPTIONS = [
  ["line", "focus.shape.line", Minus],
  ["arrow", "focus.shape.arrow", ArrowRight],
  ["rectangle", "focus.shape.rectangle", RectangleHorizontal],
  ["square", "focus.shape.square", Square],
  ["rounded", "focus.shape.rounded", RectangleHorizontal],
  ["polygon", "focus.shape.polygon", Shapes],
  ["ellipse", "focus.shape.ellipse", Circle],
  ["circle", "focus.shape.circle", Circle],
  ["triangle", "focus.shape.triangle", Triangle]
];
/** Pixel is the default and matches the eraser's behaviour before modes existed. */
export const ERASER_MODE_OPTIONS = [
  [ERASER_MODE.PRECISION, "focus.eraser.pixel", Eraser, "focus.eraser.pixelShort"],
  [ERASER_MODE.STROKE, "focus.eraser.stroke", PenLine, "focus.eraser.strokeShort"],
  [ERASER_MODE.OBJECT, "focus.eraser.object", Square, "focus.eraser.objectShort"]
];
export const ERASER_MODES = new Set(ERASER_MODE_OPTIONS.map(([mode]) => mode));
export const LASSO_MODE_OPTIONS = [
  ["freeform", "focus.lasso.freeform", MousePointer2, "focus.lasso.freeformShort"],
  ["rectangle", "focus.lasso.rectangle", Square, "focus.lasso.rectangleShort"]
];
/** Thickness moves continuously, in hundredths of a point, not whole steps. */
export const THICKNESS_STEP = .01;
// The widest a fitted page gets on a desktop window, in CSS pixels.
export const FIT_READING_WIDTH = 1000;
export const formatThickness = (size) => `${Number(Number(size).toFixed(2))} pt`;
// Hundredths exactly, so saved widths match what the server keeps (two decimals).
export const roundThickness = (size) => Math.round(Number(size) * 100) / 100;
export const SHAPE_FILL_COLORS = ["#dceeff", "#ffd9d9", "#d9f5df", "#fff2c2", "#ebdfff", "#ffe4cc"];
/** Panel title and one-line purpose for each configurable tool. */
export const TOOL_PANEL_COPY = {
  pen: ["focus.tool.pen", "focus.panel.pen"],
  pencil: ["focus.pencil", "focus.panel.pencil"],
  highlighter: ["focus.tool.highlighter", "focus.panel.highlighter"],
  eraser: ["focus.eraser", "focus.panel.eraser"],
  select: ["focus.lasso", "focus.panel.lasso"],
  shapes: ["focus.shapes", "focus.panel.shapes"]
};

export const STAGE_CONTROL_SELECTOR = "button, a[href], input, select, textarea, [role='button'], [role='switch'], [role='radio'], [role='tab']";

export function isUnfinished(payload) {
  return ["active", "paused", "on_break"].includes(payload?.session?.status);
}

/** Controls painted over the document still need their normal activation. */
export function isStageControl(target) {
  return Boolean(target?.closest?.(STAGE_CONTROL_SELECTOR));
}
