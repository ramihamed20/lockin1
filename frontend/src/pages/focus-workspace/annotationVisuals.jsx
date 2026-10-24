/** How each annotation is drawn on a page, the drag preview, and a page's whole layer. */
import { inkSvgMaskBounds } from "../../workspace/ink/inkSvgMaskBounds.js";
import { forwardRef, memo, useImperativeHandle, useState } from "react";
import { layoutNoteCard } from "../../workspace/catalog/noteCardLayout.js";
import { eraserSpaceScale, strokeRenderGeometry } from "../../workspace/ink/strokeModel.js";

export const WorkspaceAnnotation = memo(
/** @param {{ annotation: any, draft?: boolean, interactionOnly?: boolean, groupedHighlighter?: boolean, pageAspect?: number, revealed?: boolean }} props */
function WorkspaceAnnotation({ annotation, draft = false, interactionOnly = false, groupedHighlighter = false, pageAspect = 1, revealed = false }) {
  const common = { "data-annotation-id": annotation.id, "data-annotation-type": annotation.type };
  if (["pen", "pencil", "highlighter"].includes(annotation.type)) {
    const geometry = strokeRenderGeometry(annotation, pageAspect);
    if (interactionOnly && annotation.type === "pen") {
      if (geometry.kind === "dot") return <circle {...common} className="workspace-v2-annotation-hit" cx={geometry.x} cy={geometry.y} r={Math.max(geometry.radius, 8)} fill={annotation.color} opacity="0" />;
      return <path {...common} className="workspace-v2-annotation-hit" d={geometry.path} fill={geometry.kind === "outline" ? annotation.color : "none"} stroke={geometry.kind === "centerline" ? annotation.color : "none"} strokeWidth={Math.max(geometry.width || 0, 12)} opacity="0" />;
    }
    const opacity = groupedHighlighter ? 1 : draft ? Math.min(geometry.opacity, annotation.type === "pen" ? 1 : .68) : geometry.opacity;
    let mark = null;
    if (geometry.kind === "dot") mark = <ellipse {...common} cx={geometry.x} cy={geometry.y} rx={geometry.radiusX ?? geometry.radius} ry={geometry.radiusY ?? geometry.radius} fill={annotation.color} opacity={opacity} />;
    if (geometry.kind === "centerline") mark = <path {...common} d={geometry.path} fill="none" stroke={annotation.color} strokeWidth={geometry.width} strokeLinecap="round" strokeLinejoin="round" opacity={opacity} />;
    if (geometry.kind === "outline") mark = <path {...common} d={geometry.path} fill={annotation.color} opacity={opacity} />;
    if (!annotation.erasures?.length) return mark;
    const maskId = `workspace-erase-${String(annotation.id).replace(/[^a-zA-Z0-9_-]/g, "_")}`;
    // Erasure radii are in eraser space (1/1000 of the page's longer side), so
    // the swept area is drawn as a true circle on this non-square page.
    const scale = eraserSpaceScale(pageAspect);
    return <g><defs><mask id={maskId} {...inkSvgMaskBounds(annotation)} maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse">
      <rect x="0" y="0" width="1000" height="1000" fill="white" />
      <g transform={`scale(${1 / scale.x} ${1 / scale.y})`}>
        {annotation.erasures.map((erasure, index) => erasure.points.length === 1
          ? <circle key={index} cx={erasure.points[0].x * scale.x} cy={erasure.points[0].y * scale.y} r={erasure.radius} fill="black" />
          : <path key={index} d={erasure.points.map((point, pointIndex) => `${pointIndex ? "L" : "M"}${point.x * scale.x} ${point.y * scale.y}`).join(" ")} fill="none" stroke="black" strokeWidth={erasure.radius * 2} strokeLinecap="round" strokeLinejoin="round" />)}
      </g>
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
  if (annotation.type === "cover") {
    // Hidden, the cover is a solid box; revealed, only its outline stays so the
    // student can see what was hidden and hide it again with another tap.
    const radius = Math.min(10, annotation.width / 4, annotation.height / 4);
    return <g {...common} className={`workspace-cover${revealed ? " is-revealed" : ""}`} opacity={draft ? 0.68 : 1}>
      <rect x={annotation.x} y={annotation.y} width={annotation.width} height={annotation.height} rx={radius} fill={annotation.color} stroke={annotation.color} strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
    </g>;
  }
  if (annotation.type === "card") {
    const card = layoutNoteCard(annotation, pageAspect);
    const { x, y, width } = annotation;
    const height = card.height;
    const clipId = `workspace-card-${String(annotation.id).replace(/[^a-zA-Z0-9_-]/g, "_")}`;
    return <g {...commonWithOpacity} className="workspace-note-card"><g transform={`translate(${x} ${y}) scale(1 ${card.scaleY}) translate(${-x} ${-y})`}>
      <clipPath id={clipId}><rect x={x} y={y} width={width} height={height} rx={card.radius} /></clipPath>
      <rect x={x} y={y + 5} width={width} height={height} rx={card.radius} fill="#0f172a" opacity=".12" />
      <rect className="workspace-note-card-paper" x={x} y={y} width={width} height={height} rx={card.radius} fill={card.style.paper} />
      <rect x={x} y={y} width={width} height={card.band} fill={card.style.accent} clipPath={`url(#${clipId})`} />
      {card.rules.map((ruleY) => <line key={ruleY} x1={x + card.pad} x2={x + width - card.pad} y1={ruleY} y2={ruleY} stroke={card.style.rule} strokeWidth="1.5" />)}
      <rect x={x + .75} y={y + .75} width={width - 1.5} height={height - 1.5} rx={card.radius} fill="none" stroke="#0f172a" strokeOpacity=".1" strokeWidth="1.5" />
      {card.lines.map((line, index) => <text key={index} x={line.x} y={line.y} fill={line.color} fontSize={line.size} fontWeight={line.weight} direction={card.rtl ? "rtl" : "ltr"}>{line.text}</text>)}
    </g></g>;
  }
  return null;
});

export const NO_REVEALED_COVERS = new Set();
// Covers are drawn in this slate blue: distinct from the gold the app keeps for
// the one focal action, and dark enough that nothing shows through.
export const COVER_COLOR = "#5f6fd8";

/**
 * The mark being dragged out (a shape). It owns its state, so a drag repaints
 * this one element rather than the whole workspace on every pointer move. A
 * layer that mounts mid-drag (the page under the pen just became current)
 * starts from `latest`, the draft as last set.
 */
export const DraftAnnotationLayer = memo(forwardRef(/** @param {{ latest: { current: any }, pageAspect?: number }} props */ function DraftAnnotationLayer({ latest, pageAspect = 1 }, ref) {
  const [annotation, setAnnotation] = useState(() => latest.current);
  useImperativeHandle(ref, () => ({ set: setAnnotation }), []);
  return annotation && annotation.type !== "lasso" ? <WorkspaceAnnotation annotation={annotation} draft pageAspect={pageAspect} /> : null;
}));

export const AnnotationVisuals = memo(
/** @param {{ annotations: any[], hiddenIds?: Set<string>, prefix?: string, includeHitTargets?: boolean, pageAspect?: number, revealedIds?: Set<string> }} props */
function AnnotationVisuals({ annotations, hiddenIds = new Set(), prefix = "annotation", includeHitTargets = false, pageAspect = 1, revealedIds = NO_REVEALED_COVERS }) {
  const visible = (annotations || []).filter((annotation) => !hiddenIds.has(annotation.id)).sort((a, b) => (a.zOrder || 0) - (b.zOrder || 0));
  const highlightGroups = new Map();
  for (const annotation of visible) if (annotation.type === "highlighter") {
    const key = `${annotation.color}|${annotation.opacity ?? .34}`;
    if (!highlightGroups.has(key)) highlightGroups.set(key, []);
    highlightGroups.get(key).push(annotation);
  }
  return <>
    {[...highlightGroups].map(([key, items]) => <g key={`${prefix}-highlight-${key}`} className="workspace-v2-highlighter-group" opacity={items[0].opacity ?? .34} style={{ mixBlendMode: "multiply" }}>
      {items.map((annotation) => <WorkspaceAnnotation key={`${prefix}-${annotation.id}`} annotation={annotation} groupedHighlighter pageAspect={pageAspect} />)}
    </g>)}
    {visible.filter((annotation) => annotation.type !== "highlighter").map((annotation) => <WorkspaceAnnotation key={`${prefix}-${annotation.id}`} annotation={annotation} pageAspect={pageAspect} revealed={annotation.type === "cover" && revealedIds.has(annotation.id)} />)}
    {includeHitTargets && (annotations || []).filter((annotation) => annotation.type === "pen").map((annotation) => <WorkspaceAnnotation key={`${prefix}-hit-${annotation.id}`} annotation={annotation} interactionOnly pageAspect={pageAspect} />)}
  </>;
});
