import { useEffect, useRef, useState } from "react";

import type { FocusAnnotation, FocusToolId } from "../contracts/types";
import type { FocusDocumentRenderer } from "../contracts/ports";
import { AnnotationLayer } from "../annotations/AnnotationLayer";

type Props = {
  pageNumber: number;
  renderer: FocusDocumentRenderer;
  zoom: number;
  activeTool: FocusToolId | null;
  color: string;
  thickness: number;
  annotations: readonly FocusAnnotation[];
  pageLabel: string;
  newStickyNoteLabel: string;
  newTextNoteLabel: string;
  onVisible: (page: number) => void;
  onCreate: (annotation: FocusAnnotation) => void;
  onRemove: (id: string) => void;
};

export function VirtualPdfPage(props: Props) {
  const { onVisible, pageNumber } = props;
  const pageRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [nearViewport, setNearViewport] = useState(false);
  const [text, setText] = useState("");
  const [size, setSize] = useState({ width: 816, height: 1056 });
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const element = pageRef.current;
    if (!element) return;
    const nearObserver = new IntersectionObserver(([entry]) => {
      if (!entry) return;
      setNearViewport(entry.isIntersecting);
    }, { rootMargin: "1200px 0px", threshold: 0 });
    const currentObserver = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting && entry.intersectionRatio >= 0.5) onVisible(pageNumber);
    }, { threshold: [0.5] });
    nearObserver.observe(element);
    currentObserver.observe(element);
    return () => { nearObserver.disconnect(); currentObserver.disconnect(); };
  }, [onVisible, pageNumber]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!nearViewport || !canvas) {
      props.renderer.releasePage(props.pageNumber);
      return;
    }
    let active = true;
    setFailed(false);
    void props.renderer.renderPage(props.pageNumber, canvas, props.zoom).then((result) => {
      if (!active) return;
      setSize({ width: result.width, height: result.height });
      setText(result.text);
    }).catch((error: unknown) => {
      if (active && !(error instanceof Error && error.name === "RenderingCancelledException")) setFailed(true);
    });
    return () => { active = false; props.renderer.releasePage(props.pageNumber); };
  }, [nearViewport, props.pageNumber, props.renderer, props.zoom]);

  return (
    <article id={`focus-page-${props.pageNumber}`} ref={pageRef} className="focus-pdf-page" aria-label={`${props.pageLabel} ${props.pageNumber}`} style={{ "--focus-page-width": `${size.width}px`, "--focus-page-height": `${size.height}px` } as React.CSSProperties}>
      <div className="focus-pdf-page__surface">
        {nearViewport ? <canvas ref={canvasRef} aria-hidden="true" /> : <div className="focus-pdf-page__placeholder" aria-hidden="true" />}
        {nearViewport ? <AnnotationLayer pageNumber={props.pageNumber} annotations={props.annotations} activeTool={props.activeTool} color={props.color} thickness={props.thickness} newStickyNoteLabel={props.newStickyNoteLabel} newTextNoteLabel={props.newTextNoteLabel} onCreate={props.onCreate} onRemove={props.onRemove} /> : null}
      </div>
      <span className="sr-only">{failed ? `Document page ${props.pageNumber} could not render.` : text || `Document page ${props.pageNumber}. Text extraction is unavailable for this page.`}</span>
    </article>
  );
}
