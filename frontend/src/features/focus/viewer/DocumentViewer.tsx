import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import type { FocusAnnotation, FocusToolId } from "../contracts/types";
import type { FocusDocumentRenderer } from "../contracts/ports";
import { VirtualPdfPage } from "./VirtualPdfPage";

type Props = {
  renderer: FocusDocumentRenderer;
  pageCount: number;
  currentPage: number;
  zoom: number;
  activeTool: FocusToolId | null;
  color: string;
  thickness: number;
  annotations: readonly FocusAnnotation[];
  pageLabel: string;
  viewerLabel: string;
  newStickyNoteLabel: string;
  newTextNoteLabel: string;
  onPage: (page: number) => void;
  onZoom: (zoom: number) => void;
  onCreate: (annotation: FocusAnnotation) => void;
  onRemove: (id: string) => void;
};

function distance(points: readonly PointerEvent[]): number {
  if (points.length < 2) return 0;
  const first = points[0]!;
  const second = points[1]!;
  return Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY);
}

export function DocumentViewer(props: Props) {
  const { onPage } = props;
  const viewerRef = useRef<HTMLDivElement>(null);
  const touches = useRef(new Map<number, PointerEvent>());
  const [fitScale, setFitScale] = useState(1);
  const pinch = useRef<{ distance: number; zoom: number } | null>(null);
  const lastTap = useRef(0);
  const visiblePage = useCallback((page: number) => onPage(page), [onPage]);

  useEffect(() => {
    const element = viewerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => { if (entry) setFitScale(Math.max(0.5, Math.min(1.25, (entry.contentRect.width - 48) / 612))); });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  function pointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType !== "touch") return;
    touches.current.set(event.pointerId, event.nativeEvent);
    if (touches.current.size === 2) pinch.current = { distance: distance([...touches.current.values()]), zoom: props.zoom };
  }

  function pointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType !== "touch" || !touches.current.has(event.pointerId)) return;
    touches.current.set(event.pointerId, event.nativeEvent);
    if (pinch.current && touches.current.size === 2) {
      event.preventDefault();
      const next = pinch.current.zoom * distance([...touches.current.values()]) / pinch.current.distance;
      props.onZoom(Math.max(0.5, Math.min(4, next)));
    }
  }

  function pointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType !== "touch") return;
    touches.current.delete(event.pointerId);
    if (touches.current.size < 2) pinch.current = null;
    const now = performance.now();
    if (now - lastTap.current < 300) props.onZoom(props.zoom < 1.6 ? 2 : 1);
    lastTap.current = now;
  }

  return (
    <div ref={viewerRef} className="focus-document-viewer" role="region" aria-label={props.viewerLabel} tabIndex={0} data-tool-active={props.activeTool ? "true" : "false"} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} onWheel={(event) => { if (event.ctrlKey) { event.preventDefault(); props.onZoom(Math.max(0.5, Math.min(4, props.zoom + (event.deltaY < 0 ? 0.1 : -0.1)))); } }}>
      <div className="focus-document-stack">
        {Array.from({ length: props.pageCount }, (_, index) => index + 1).map((page) => (
          <VirtualPdfPage key={page} pageNumber={page} renderer={props.renderer} zoom={props.zoom * fitScale} activeTool={props.activeTool} color={props.color} thickness={props.thickness} annotations={props.annotations.filter((annotation) => annotation.pageNumber === page)} pageLabel={props.pageLabel} newStickyNoteLabel={props.newStickyNoteLabel} newTextNoteLabel={props.newTextNoteLabel} onVisible={visiblePage} onCreate={props.onCreate} onRemove={props.onRemove} />
        ))}
      </div>
      <span className="focus-page-indicator" aria-hidden="true">{props.currentPage} / {props.pageCount}</span>
    </div>
  );
}
