import { canvasesToPdf, EXPORT_SCALE, renderWorkspacePage } from "../catalog/workspaceExport.js";

/** Summary colours: an accent for headings and a soft tint for panels. */
export const SUMMARY_COLORS = {
  blue: { accent: "#2f6fdb", soft: "#eaf1fd", ink: "#1b3f80" },
  green: { accent: "#1f9d74", soft: "#e5f6ef", ink: "#0f5a42" },
  amber: { accent: "#d68a00", soft: "#fdf3e1", ink: "#7a4d00" }
};

const WIDTH = 595 * EXPORT_SCALE;
const HEIGHT = 842 * EXPORT_SCALE;
const MARGIN = 48 * EXPORT_SCALE;
const FONT = "system-ui, -apple-system, 'Segoe UI', Tahoma, Arial, sans-serif";
const RTL = /[֐-ࣿ]/;

export const isRtlText = (text) => RTL.test(String(text || ""));

/** Pages written in a keyboard summary, in sheet order. */
export function writtenTextPages(summary) {
  return Object.entries(summary?.pages || {})
    .map(([page, text]) => ({ page: Number(page), text: String(text || "").trim() }))
    .filter((item) => Number.isInteger(item.page) && item.text)
    .sort((a, b) => a.page - b.page);
}

function blankCanvas() {
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const context = canvas.getContext("2d", { alpha: false });
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, WIDTH, HEIGHT);
  return { canvas, context };
}

/** Splits text into lines that fit `width`, keeping the student's own line breaks. */
export function wrapLines(context, text, width) {
  const lines = [];
  for (const paragraph of String(text).split("\n")) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) { lines.push(""); continue; }
    let line = "";
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (line && context.measureText(next).width > width) { lines.push(line); line = word; }
      else line = next;
    }
    lines.push(line);
  }
  return lines;
}

function drawFooter(context, palette, text, number) {
  context.fillStyle = palette.accent;
  context.fillRect(0, HEIGHT - 6 * EXPORT_SCALE, WIDTH, 6 * EXPORT_SCALE);
  context.fillStyle = "#8a8f98";
  context.font = `${10 * EXPORT_SCALE}px ${FONT}`;
  context.textAlign = "center";
  context.direction = isRtlText(text) ? "rtl" : "ltr";
  context.fillText(`${text} · ${number}`, WIDTH / 2, HEIGHT - 18 * EXPORT_SCALE);
}

function drawCover(summary, sheetTitle, labels, palette) {
  const { canvas, context } = blankCanvas();
  context.fillStyle = palette.soft;
  context.fillRect(0, 0, WIDTH, HEIGHT * .42);
  context.fillStyle = palette.accent;
  context.fillRect(0, HEIGHT * .42 - 8 * EXPORT_SCALE, WIDTH, 8 * EXPORT_SCALE);
  const rtl = isRtlText(summary.title) || isRtlText(sheetTitle);
  context.direction = rtl ? "rtl" : "ltr";
  context.textAlign = rtl ? "right" : "left";
  const x = rtl ? WIDTH - MARGIN : MARGIN;
  context.fillStyle = palette.ink;
  context.font = `600 ${13 * EXPORT_SCALE}px ${FONT}`;
  context.fillText(labels.kicker, x, HEIGHT * .2);
  context.fillStyle = "#14161a";
  context.font = `700 ${30 * EXPORT_SCALE}px ${FONT}`;
  let y = HEIGHT * .2 + 44 * EXPORT_SCALE;
  for (const line of wrapLines(context, summary.title, WIDTH - MARGIN * 2).slice(0, 3)) { context.fillText(line, x, y); y += 38 * EXPORT_SCALE; }
  context.fillStyle = "#4a4f58";
  context.font = `${14 * EXPORT_SCALE}px ${FONT}`;
  for (const line of wrapLines(context, sheetTitle, WIDTH - MARGIN * 2).slice(0, 2)) { context.fillText(line, x, y); y += 20 * EXPORT_SCALE; }
  context.font = `${12 * EXPORT_SCALE}px ${FONT}`;
  context.fillStyle = "#6b7079";
  context.fillText(labels.details, x, HEIGHT * .42 + 40 * EXPORT_SCALE);
  return canvas;
}

/** Keyboard text, flowed page after page with a coloured heading for each sheet page. */
function* textCanvases(entries, summary, labels, palette) {
  let current = blankCanvas();
  let y = MARGIN;
  let number = 2;
  const lineHeight = 17 * EXPORT_SCALE;
  const startPage = () => {
    current = blankCanvas();
    y = MARGIN;
    number += 1;
  };
  const finish = () => { drawFooter(current.context, palette, summary.title, number); return current.canvas; };
  for (const entry of entries) {
    const rtl = isRtlText(entry.text);
    const { context } = current;
    context.font = `${12.5 * EXPORT_SCALE}px ${FONT}`;
    const lines = wrapLines(context, entry.text, WIDTH - MARGIN * 2 - 28 * EXPORT_SCALE);
    // Keep each heading with at least three of its lines.
    if (y + 40 * EXPORT_SCALE + Math.min(lines.length, 3) * lineHeight > HEIGHT - MARGIN) { yield finish(); startPage(); }
    let ctx = current.context;
    const chipText = labels.page(entry.page);
    ctx.font = `700 ${11 * EXPORT_SCALE}px ${FONT}`;
    ctx.direction = isRtlText(chipText) ? "rtl" : "ltr";
    const chipWidth = ctx.measureText(chipText).width + 20 * EXPORT_SCALE;
    const chipX = rtl ? WIDTH - MARGIN - chipWidth : MARGIN;
    ctx.fillStyle = palette.accent;
    ctx.beginPath();
    ctx.roundRect(chipX, y, chipWidth, 22 * EXPORT_SCALE, 11 * EXPORT_SCALE);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.fillText(chipText, chipX + chipWidth / 2, y + 15 * EXPORT_SCALE);
    y += 34 * EXPORT_SCALE;
    let blockTop = y - 6 * EXPORT_SCALE;
    for (const [index, line] of lines.entries()) {
      if (y + lineHeight > HEIGHT - MARGIN) {
        ctx.fillStyle = palette.accent;
        ctx.fillRect(rtl ? WIDTH - MARGIN - 3 * EXPORT_SCALE : MARGIN, blockTop, 3 * EXPORT_SCALE, y - blockTop);
        yield finish(); startPage(); ctx = current.context; blockTop = y - 6 * EXPORT_SCALE;
      }
      ctx.font = `${12.5 * EXPORT_SCALE}px ${FONT}`;
      ctx.fillStyle = "#1d2027";
      ctx.direction = rtl ? "rtl" : "ltr";
      ctx.textAlign = rtl ? "right" : "left";
      ctx.fillText(line, rtl ? WIDTH - MARGIN - 14 * EXPORT_SCALE : MARGIN + 14 * EXPORT_SCALE, y + 12 * EXPORT_SCALE);
      y += lineHeight;
      if (index === lines.length - 1) {
        ctx.fillStyle = palette.accent;
        ctx.fillRect(rtl ? WIDTH - MARGIN - 3 * EXPORT_SCALE : MARGIN, blockTop, 3 * EXPORT_SCALE, y - blockTop);
      }
    }
    y += 18 * EXPORT_SCALE;
  }
  yield finish();
}

/** Pen pages: each summary page as written, framed with its sheet page number. */
async function* penCanvases(pages, summary, labels, palette) {
  let number = 1;
  for (const item of pages) {
    number += 1;
    const canvas = await renderWorkspacePage({ pdf: null, pageNumber: 0, background: item.background, annotations: item.annotations });
    const context = canvas.getContext("2d");
    const chipText = labels.page(item.pdfPage);
    context.font = `700 ${10 * EXPORT_SCALE}px ${FONT}`;
    context.direction = isRtlText(chipText) ? "rtl" : "ltr";
    const chipWidth = context.measureText(chipText).width + 16 * EXPORT_SCALE;
    context.fillStyle = palette.accent;
    context.fillRect(0, 0, canvas.width, 5 * EXPORT_SCALE);
    context.beginPath();
    context.roundRect(canvas.width - chipWidth - 12 * EXPORT_SCALE, 12 * EXPORT_SCALE, chipWidth, 20 * EXPORT_SCALE, 10 * EXPORT_SCALE);
    context.fill();
    context.fillStyle = "#ffffff";
    context.textAlign = "center";
    context.fillText(chipText, canvas.width - chipWidth / 2 - 12 * EXPORT_SCALE, 26 * EXPORT_SCALE);
    context.direction = "ltr";
    drawFooter(context, palette, summary.title, number);
    yield canvas;
  }
}

/**
 * The finished summary as one PDF.
 * @param {{ summary: any, sheetTitle: string, labels: { kicker: string, details: string, page: (n: number) => string }, penPages?: { pdfPage: number, background: string, annotations: any[] }[], skipEmpty?: boolean }} options
 */
export async function buildSummaryPdf({ summary, sheetTitle, labels, penPages = [], skipEmpty = true }) {
  const palette = SUMMARY_COLORS[summary.color] || SUMMARY_COLORS.blue;
  async function* all() {
    yield drawCover(summary, sheetTitle, labels, palette);
    if (summary.mode === "keyboard") {
      const entries = writtenTextPages(summary);
      if (entries.length) yield* textCanvases(entries, summary, labels, palette);
    } else {
      yield* penCanvases(skipEmpty ? penPages.filter((item) => item.annotations.length) : penPages, summary, labels, palette);
    }
  }
  return canvasesToPdf(all());
}
