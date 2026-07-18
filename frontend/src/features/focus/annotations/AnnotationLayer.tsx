import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import type { FocusAnnotation, FocusPointerKind, FocusToolId, NormalizedPoint, PersistedFocusToolId, PointerSample } from "../contracts/types";

type Props = {
  pageNumber: number;
  annotations: readonly FocusAnnotation[];
  activeTool: FocusToolId | null;
  color: string;
  thickness: number;
  newStickyNoteLabel: string;
  newTextNoteLabel: string;
  onCreate: (annotation: FocusAnnotation) => void;
  onRemove: (id: string) => void;
};

type Draft = { id: string; tool: PersistedFocusToolId; start: NormalizedPoint; samples: PointerSample[] };

function pointerKind(value: string): FocusPointerKind {
  return value === "pen" || value === "touch" || value === "mouse" ? value : "unknown";
}

function normalized(event: ReactPointerEvent<SVGSVGElement>): NormalizedPoint {
  const rect = event.currentTarget.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
    y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))
  };
}

function sample(event: ReactPointerEvent<SVGSVGElement>): PointerSample {
  const point = normalized(event);
  const pointer = pointerKind(event.pointerType);
  return { ...point, pointer, pressure: pointer === "mouse" && event.pressure === 0 ? 0.5 : event.pressure, tiltX: pointer === "pen" ? event.tiltX : 0, tiltY: pointer === "pen" ? event.tiltY : 0, timestamp: Date.now() };
}

function bounds(start: NormalizedPoint, end: NormalizedPoint) {
  return { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) };
}

function annotationElement(annotation: FocusAnnotation, pageNumber: number) {
  const strokeWidth = annotation.thickness / 800;
  const common = { stroke: annotation.color, strokeWidth, opacity: annotation.opacity, fill: "none", vectorEffect: "non-scaling-stroke" as const };
  if (annotation.payload.kind === "stroke") {
    const points = annotation.payload.samples.map((point) => `${point.x},${point.y}`).join(" ");
    return <polyline {...common} points={points} strokeLinecap="round" strokeLinejoin="round" />;
  }
  if (annotation.payload.kind === "shape") {
    const { start, end } = annotation.payload;
    if (annotation.tool === "rectangle") return <rect {...common} x={Math.min(start.x, end.x)} y={Math.min(start.y, end.y)} width={Math.abs(end.x - start.x)} height={Math.abs(end.y - start.y)} />;
    if (annotation.tool === "circle") return <ellipse {...common} cx={(start.x + end.x) / 2} cy={(start.y + end.y) / 2} rx={Math.abs(end.x - start.x) / 2} ry={Math.abs(end.y - start.y) / 2} />;
    return <line {...common} x1={start.x} y1={start.y} x2={end.x} y2={end.y} markerEnd={annotation.tool === "arrow" ? `url(#arrow-${pageNumber})` : undefined} />;
  }
  if (annotation.payload.kind === "sticky-note") return <g><rect x={annotation.bounds.x} y={annotation.bounds.y} width="0.045" height="0.045" rx="0.006" fill={annotation.color} opacity={annotation.opacity} /><text x={annotation.bounds.x + 0.022} y={annotation.bounds.y + 0.03} textAnchor="middle" fontSize="0.025" fill="#16140f">N</text></g>;
  return <text x={annotation.bounds.x} y={annotation.bounds.y + 0.025} fontSize="0.024" fill={annotation.color} opacity={annotation.opacity}>{annotation.payload.value.slice(0, 48)}</text>;
}

export function AnnotationLayer(props: Props) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const pointerId = useRef<number | null>(null);

  function begin(event: ReactPointerEvent<SVGSVGElement>) {
    if (!props.activeTool || event.pointerType === "touch") return;
    event.preventDefault();
    const target = event.target as SVGElement;
    if (props.activeTool === "eraser") {
      const id = target.closest<SVGElement>("[data-annotation-id]")?.dataset.annotationId;
      if (id) props.onRemove(id);
      return;
    }
    const point = normalized(event);
    if (props.activeTool === "text" || props.activeTool === "sticky-note") {
      const now = new Date().toISOString();
      props.onCreate({
        id: crypto.randomUUID(), pageNumber: props.pageNumber, tool: props.activeTool, layerKey: "personal",
        bounds: { x: point.x, y: point.y, width: props.activeTool === "sticky-note" ? 0.045 : 0.2, height: 0.045 },
        payload: { kind: props.activeTool, value: props.activeTool === "sticky-note" ? props.newStickyNoteLabel : props.newTextNoteLabel },
        color: props.color, thickness: props.thickness, opacity: 1, revision: 0, createdAt: now, updatedAt: now
      });
      return;
    }
    pointerId.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDraft({ id: crypto.randomUUID(), tool: props.activeTool, start: point, samples: [sample(event)] });
  }

  function move(event: ReactPointerEvent<SVGSVGElement>) {
    if (!draft || pointerId.current !== event.pointerId) return;
    event.preventDefault();
    if (draft.tool === "pen" || draft.tool === "pencil" || draft.tool === "highlighter") {
      setDraft({ ...draft, samples: [...draft.samples.slice(-2047), sample(event)] });
    } else {
      setDraft({ ...draft, samples: [draft.samples[0]!, sample(event)] });
    }
  }

  function finish(event: ReactPointerEvent<SVGSVGElement>) {
    if (!draft || pointerId.current !== event.pointerId) return;
    event.preventDefault();
    const end = normalized(event);
    const samples: PointerSample[] = draft.samples.length > 1 ? draft.samples : [draft.samples[0]!, sample(event)];
    const payload = draft.tool === "pen" || draft.tool === "pencil" || draft.tool === "highlighter"
      ? { kind: "stroke" as const, samples }
      : { kind: "shape" as const, start: draft.start, end };
    const now = new Date().toISOString();
    props.onCreate({
      id: draft.id, pageNumber: props.pageNumber, tool: draft.tool, layerKey: "personal",
      bounds: bounds(draft.start, end), payload, color: props.color, thickness: props.thickness,
      opacity: draft.tool === "highlighter" ? 0.35 : draft.tool === "pencil" ? 0.75 : 1,
      revision: 0, createdAt: now, updatedAt: now
    });
    pointerId.current = null;
    setDraft(null);
  }

  return (
    <svg className="focus-annotation-layer" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true" data-drawing={props.activeTool ? "enabled" : "disabled"} onPointerDown={begin} onPointerMove={move} onPointerUp={finish} onPointerCancel={() => { pointerId.current = null; setDraft(null); }}>
      <defs><marker id={`arrow-${props.pageNumber}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" /></marker></defs>
      {props.annotations.map((annotation) => <g key={annotation.id} data-annotation-id={annotation.id}>{annotationElement(annotation, props.pageNumber)}</g>)}
      {draft ? <line x1={draft.start.x} y1={draft.start.y} x2={draft.samples.at(-1)?.x ?? draft.start.x} y2={draft.samples.at(-1)?.y ?? draft.start.y} stroke={props.color} strokeWidth={props.thickness / 800} opacity="0.7" /> : null}
    </svg>
  );
}
