/**
 * The large live sample at the top of each Focus tool panel. It draws itself
 * when a panel opens (the SVG is keyed by tool, so switching tools replays
 * it) and then follows the colour, width, opacity and shape settings as they
 * change. Purely decorative: the panel's controls carry every label.
 */

const WAVE = "M14 40 C 52 6, 92 6, 124 26 S 196 50, 226 16";
const BAND = "M18 30 C 74 24, 150 34, 222 27";
const LASSO_FREEFORM = "M44 30 C 40 12, 92 6, 136 10 C 186 14, 210 24, 200 38 C 188 52, 110 54, 70 48 C 52 45, 46 40, 44 30 Z";

/** Shape outlines inside the 240 x 56 preview box. */
function shapePath(shape) {
  switch (shape) {
    case "line": return "M60 44 L180 12";
    case "arrow": return "M60 42 L178 14 M178 14 L160 12 M178 14 L168 30";
    case "square": return "M100 8 H140 V48 H100 Z";
    case "rounded": return "M80 10 H160 A10 10 0 0 1 170 20 V36 A10 10 0 0 1 160 46 H80 A10 10 0 0 1 70 36 V20 A10 10 0 0 1 80 10 Z";
    case "polygon": return "M120 6 L152 20 L148 44 L92 44 L88 20 Z";
    case "ellipse": return "M60 28 A60 20 0 1 0 180 28 A60 20 0 1 0 60 28 Z";
    case "circle": return "M100 28 A20 20 0 1 0 140 28 A20 20 0 1 0 100 28 Z";
    case "triangle": return "M120 6 L150 48 L90 48 Z";
    default: return "M70 10 H170 V46 H70 Z";
  }
}

/**
 * @param {{
 *   tool: string,
 *   color: string,
 *   size: number,
 *   opacity?: number,
 *   shape?: string,
 *   fill?: string | null,
 *   dashed?: boolean,
 *   lassoMode?: string,
 *   penProfile?: string
 * }} props
 */
export function ToolPreview({ tool, color, size, opacity = 1, shape = "rectangle", fill = null, dashed = false, lassoMode = "freeform", penProfile = "ball" }) {
  const width = Math.max(1, Number(size) || 1);
  let body;
  if (tool === "highlighter") {
    body = <path className="workspace-v7-preview-draw" pathLength={1} d={BAND} fill="none" stroke={color} strokeLinecap="round" style={{ strokeWidth: 10 + width * 1.6, opacity }} />;
  } else if (tool === "eraser") {
    body = <>
      <defs>
        <pattern id="workspace-preview-checker" width="8" height="8" patternUnits="userSpaceOnUse">
          <rect width="8" height="8" fill="rgb(255 255 255 / .05)" />
          <rect width="4" height="4" fill="rgb(255 255 255 / .12)" />
          <rect x="4" y="4" width="4" height="4" fill="rgb(255 255 255 / .12)" />
        </pattern>
        <linearGradient id="workspace-preview-smudge" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity=".95" />
          <stop offset=".7" stopColor="#fff" stopOpacity=".8" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect x="150" y="8" width="84" height="40" rx="8" fill="url(#workspace-preview-checker)" />
      <path className="workspace-v7-preview-draw" pathLength={1} d="M24 32 C 70 20, 130 18, 214 26" fill="none" stroke="url(#workspace-preview-smudge)" strokeLinecap="round" style={{ strokeWidth: Math.min(30, 6 + width * .55) }} />
    </>;
  } else if (tool === "select") {
    body = lassoMode === "rectangle"
      ? <rect className="workspace-v7-preview-ants" x="52" y="10" width="136" height="36" rx="4" fill="rgb(184 165 255 / .08)" stroke="#b8a5ff" strokeWidth="2" strokeDasharray="6 5" />
      : <path className="workspace-v7-preview-ants" d={LASSO_FREEFORM} fill="rgb(184 165 255 / .08)" stroke="#b8a5ff" strokeWidth="2" strokeDasharray="6 5" strokeLinejoin="round" />;
  } else if (tool === "shapes") {
    const closed = !["line", "arrow"].includes(shape);
    // The draw-on animation is itself a dash, so a dashed outline skips it.
    body = <path className={dashed ? undefined : "workspace-v7-preview-draw"} pathLength={1} d={shapePath(shape)} fill={closed && fill ? fill : "none"} fillOpacity={closed && fill ? .55 : 0} stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={dashed ? "0.04 0.03" : undefined} style={{ strokeWidth: Math.min(8, 1 + width * .6), opacity }} />;
  } else {
    // Pen and pencil: one confident S-curve. A brush nib reads heavier and a
    // fountain nib lighter, as the nibs themselves do on paper.
    const nib = tool === "pen" ? { brush: 1.9, fountain: .85 }[penProfile] || 1.2 : 1.1;
    body = <path className={`workspace-v7-preview-draw${tool === "pencil" ? " is-pencil" : ""}`} pathLength={1} d={WAVE} fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round" style={{ strokeWidth: Math.min(16, 1.2 + width * nib), opacity }} />;
  }
  return <svg key={tool} className={`workspace-v7-preview is-${tool}`} viewBox="0 0 240 56" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">{body}</svg>;
}
