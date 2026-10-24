import { MAX_FOCUS_ZOOM } from "./constants.js";
import { ChevronLeft, ChevronRight, LayoutGrid, Minus, MoveHorizontal, Plus, Trash2 } from "lucide-react";

/**
 * The mouse zoom bar: zoom out, the current zoom, zoom in, fit and quick magnifications.
 */
export function ZoomBar({ fitPdfWidth, minimumAllowedZoom, minimumPdfZoom, sheet, t, workspaceReady, zoom, zoomByStep, zoomToFitMultiple }) {
  return <>
    {sheet.pdfUrl && <div className="workspace-v2-zoom-bar" inert={workspaceReady ? undefined : ""} role="group" aria-label={t("focus.zoom")} onPointerDown={(event) => event.stopPropagation()}>
      <button type="button" aria-label={t("focus.zoomOut")} title={t("focus.zoomOut")} disabled={zoom <= minimumAllowedZoom() + .001} onClick={() => zoomByStep(1 / 1.25)}><Minus size={16} /></button>
      <output aria-label={t("focus.currentZoom", { percent: Math.round(zoom * 100) })}>{Math.round(zoom * 100)}%</output>
      <button type="button" aria-label={t("focus.zoomIn")} title={t("focus.zoomIn")} disabled={zoom >= MAX_FOCUS_ZOOM - .001} onClick={() => zoomByStep(1.25)}><Plus size={16} /></button>
      <span className="workspace-v2-zoom-bar-divider" aria-hidden="true" />
      <button type="button" className="workspace-v4-zoom-fit" aria-label={t("focus.fitWidth")} title={t("focus.resetZoomToFitThe")} onClick={fitPdfWidth}><MoveHorizontal size={14} aria-hidden="true" /><span>{t("focus.fit")}</span></button>
      <div className="workspace-v4-zoom-presets is-compact" role="group" aria-label={t("focus.quickZoomPresets")}>
        {[1.25, 1.5, 2].map((multiple) => <button key={multiple} type="button" className={Math.abs(zoom / minimumPdfZoom() - multiple) < .04 ? "is-active" : ""} aria-label={t("focus.zoomToMultiple", { multiple })} onClick={() => zoomToFitMultiple(multiple)}>{multiple}×</button>)}
      </div>
    </div>}
  </>;
}

/**
 * Page and zoom navigation opened from the page indicator.
 */
export function PageNavigator({ accessiblePageCount, accessiblePageStart, activeVirtualPageId, addBlankPage, commitPageJump, deleteBlankPage, fitPdfWidth, jumpToPagePosition, minimumAllowedZoom, minimumPdfZoom, page, pageJumpDraft, pageNavigatorOpen, pageThumbsOpen, searchDocumentProxy, setPageJumpDraft, setPageThumbsOpen, sheet, t, whiteboard, zoom, zoomByStep, zoomToFitMultiple }) {
  return <>
    {pageNavigatorOpen && <div id="workspace-page-navigator" className="workspace-v2-page-navigator" role="group" aria-label={t("focus.pageAndZoom")} onPointerDown={(event) => event.stopPropagation()}>
      <div className="workspace-v2-page-jump">
        <button type="button" aria-label={t("focus.previousPage")} title={t("focus.previousPage")} disabled={page <= accessiblePageStart} onClick={() => jumpToPagePosition(page - 1)}><ChevronLeft size={16} /></button>
        <label className="workspace-v2-page-input"><span className="workspace-v2-visually-hidden">{t("focus.goToPage")}</span><input type="number" inputMode="numeric" min={accessiblePageStart} max={accessiblePageCount} value={pageJumpDraft} onChange={(event) => setPageJumpDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); commitPageJump(); } }} onBlur={commitPageJump} /></label>
        <span className="workspace-v2-page-total">/ {accessiblePageCount}</span>
        <button type="button" aria-label={t("focus.nextPage")} title={t("focus.nextPage")} disabled={page >= accessiblePageCount} onClick={() => jumpToPagePosition(page + 1)}><ChevronRight size={16} /></button>
      </div>
      {sheet.pdfUrl && !whiteboard && <button type="button" className="workspace-v2-page-thumbs-toggle" aria-expanded={pageThumbsOpen} aria-controls="workspace-page-thumbnails" disabled={!searchDocumentProxy} onClick={() => setPageThumbsOpen((open) => !open)}><LayoutGrid size={16} aria-hidden="true" />{t("focus.pageThumbnails")}</button>}
      <div className="workspace-v2-page-jump is-page-actions" role="group" aria-label={t("focus.workspacePages")}>
        <button type="button" onClick={() => addBlankPage()}><Plus size={16} />{t("focus.addPage")}</button>
        {activeVirtualPageId !== null && <button type="button" onClick={() => deleteBlankPage()}><Trash2 size={16} />{t("focus.deleteBlankPage")}</button>}
      </div>
      <div className="workspace-v2-zoom-control" role="group" aria-label={t("focus.zoom")}>
        <button type="button" aria-label={t("focus.zoomOut")} title={t("focus.zoomOut")} disabled={zoom <= minimumAllowedZoom() + .001} onClick={() => zoomByStep(1 / 1.25)}><Minus size={16} /></button>
        <output aria-label={t("focus.currentZoom", { percent: Math.round(zoom * 100) })}>{Math.round(zoom * 100)}%</output>
        <button type="button" aria-label={t("focus.zoomIn")} title={t("focus.zoomIn")} disabled={zoom >= MAX_FOCUS_ZOOM - .001} onClick={() => zoomByStep(1.25)}><Plus size={16} /></button>
        {sheet.pdfUrl && <button type="button" className="workspace-v2-fit-width" aria-label={t("focus.fitWidth")} title={t("focus.fitWidth")} onClick={fitPdfWidth}><MoveHorizontal size={16} /></button>}
      </div>
      {sheet.pdfUrl && <div className="workspace-v4-zoom-presets" role="group" aria-label={t("focus.quickZoomPresets")}>
        {[1, 1.25, 1.5, 2].map((multiple) => <button key={multiple} type="button" className={Math.abs(zoom / minimumPdfZoom() - multiple) < .04 ? "is-active" : ""} aria-label={multiple === 1 ? t("focus.setZoomFitPreset") : t("focus.zoomToMultiple", { multiple })} onClick={() => zoomToFitMultiple(multiple)}>{multiple === 1 ? t("focus.fit") : `${multiple}×`}</button>)}
      </div>}
    </div>}
  </>;
}
