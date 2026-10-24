/**
 * One layout for a note card, shared by the page (SVG) and export (canvas) so
 * a card looks the same in both. Units are page units, like the card itself.
 *
 * The first line of the text is the card's title; the rest is its body. Text
 * that starts in Arabic reads right to left.
 *
 * Page units are not square (a y unit is `pageAspect` times an x unit on an
 * A4 page), so a card is laid out in x units and drawn through
 * `scale(1, 1 / pageAspect)` about its corner; its stored height stays in page
 * units.
 */

export const NOTE_CARD_STYLES = Object.freeze({
  note: Object.freeze({ paper: "#f4f7ff", accent: "#4f6df5", rule: null }),
  lined: Object.freeze({ paper: "#ffffff", accent: "#64748b", rule: "#dbe4f0" }),
  revision: Object.freeze({ paper: "#fff3f5", accent: "#e0466a", rule: null }),
  // Kept so older sticky notes still draw; new cards no longer offer it.
  sticky: Object.freeze({ paper: "#fff7c2", accent: "#e0a800", rule: null })
});

export const NOTE_CARD_KINDS = ["note", "lined", "revision"];

const PAD = 22;
const BAND = 10;
const TITLE_SIZE = 22;
const BODY_SIZE = 19;
const TITLE_LEAD = 30;
const BODY_LEAD = 28;
// Average glyph width as a share of the font size; good enough to wrap without
// measuring, and the same on the page and in export.
const GLYPH = .52;

export const NOTE_CARD_WIDTH = 360;
const MIN_HEIGHT = 150;
const MAX_HEIGHT = 520;

const RTL = /^[^A-Za-z]*[֐-ࣿיִ-﷿ﹰ-ﻼ]/;

function wrap(paragraph, perLine) {
  const lines = [];
  for (const word of paragraph.split(/\s+/).filter(Boolean)) {
    const last = lines.length - 1;
    if (last >= 0 && `${lines[last]} ${word}`.length <= perLine) lines[last] += ` ${word}`;
    else {
      // A single word longer than the card is cut rather than overflowing it.
      for (let index = 0; index < word.length; index += perLine) lines.push(word.slice(index, index + perLine));
    }
  }
  return lines;
}

function wrapText(text, size, width) {
  const perLine = Math.max(8, Math.floor((width - PAD * 2) / (size * GLYPH)));
  return String(text || "").split("\n").flatMap((paragraph) => paragraph.trim() ? wrap(paragraph, perLine) : [""]);
}

function splitTitle(text) {
  const [first = "", ...rest] = String(text || "").trim().split("\n");
  return { title: first.trim(), body: rest.join("\n").trim() };
}

/** The height, in page units, a card needs for its text. */
export function noteCardHeight(text, width = NOTE_CARD_WIDTH, pageAspect = 1) {
  return Math.round(noteCardLayoutHeight(text, width) / Math.max(.2, pageAspect));
}

function noteCardLayoutHeight(text, width) {
  const { title, body } = splitTitle(text);
  const titleLines = wrapText(title, TITLE_SIZE, width).length;
  const bodyLines = body ? wrapText(body, BODY_SIZE, width).length : 0;
  const content = BAND + PAD + titleLines * TITLE_LEAD + (bodyLines ? 10 + bodyLines * BODY_LEAD : 0) + PAD;
  return Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, content));
}

/**
 * Positions every line of a card. Lines that do not fit are dropped and the
 * last visible one ends in an ellipsis.
 */
export function layoutNoteCard(item, pageAspect = 1) {
  const aspect = Math.max(.2, Number(pageAspect) || 1);
  const card = { ...item, height: item.height * aspect };
  const style = NOTE_CARD_STYLES[card.cardKind] || NOTE_CARD_STYLES.note;
  const { title, body } = splitTitle(card.text);
  const rtl = RTL.test(title || body);
  const x = rtl ? card.x + card.width - PAD : card.x + PAD;
  const bottom = card.y + card.height - PAD + 6;
  const lines = [];
  let y = card.y + BAND + PAD + TITLE_SIZE * .8;
  for (const text of wrapText(title, TITLE_SIZE, card.width)) {
    lines.push({ text, x, y, size: TITLE_SIZE, weight: 700, color: "#152238" });
    y += TITLE_LEAD;
  }
  const bodyTop = y + 10 - TITLE_LEAD + BODY_LEAD;
  y = bodyTop;
  if (body) {
    for (const text of wrapText(body, BODY_SIZE, card.width)) {
      lines.push({ text, x, y, size: BODY_SIZE, weight: 400, color: "#33415c" });
      y += BODY_LEAD;
    }
  }
  const visible = lines.filter((line) => line.y <= bottom);
  if (visible.length < lines.length && visible.length) {
    const last = visible[visible.length - 1];
    visible[visible.length - 1] = { ...last, text: `${last.text.replace(/\s*\S{0,3}$/, "")}…` };
  }
  const rules = style.rule
    ? Array.from({ length: Math.max(0, Math.floor((card.y + card.height - PAD - bodyTop) / BODY_LEAD) + 1) }, (_, index) => bodyTop + 7 + index * BODY_LEAD)
    : [];
  return { style, rtl, lines: visible, rules, band: BAND, pad: PAD, radius: 18, height: card.height, scaleY: 1 / aspect };
}
