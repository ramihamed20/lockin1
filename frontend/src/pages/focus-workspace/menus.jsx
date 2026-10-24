import { DocumentSearchPanel } from "../../workspace/catalog/DocumentSearchPanel.jsx";
import { Bookmark, Brain, Download, Eye, EyeOff, FileText, Hand, Image as ImageIcon, Info, MessageSquare, NotebookPen, Plus, Search, Settings, Shapes, Share2, Trash2, Type, Users, X, Youtube, ZoomIn } from "lucide-react";
import { requestFocusVideo } from "../../workspace/catalog/focusVideo.js";
import { requestSheetPicker } from "../../workspace/catalog/WorkspaceTabBar.jsx";
import { NOTE_CARD_KINDS } from "../../workspace/catalog/noteCardLayout.js";
import { PAGE_BACKGROUND_CHOICES } from "./constants.js";

/**
 * Search in the document.
 */
export function SearchMenu({ closeSurfaceAndRestoreFocus, coveredMatchIds, documentSearch, hideSearchMatches, openSurface, popover, showSearchMatch, t, workspaceReady }) {
  return <>
    {workspaceReady && popover("search").shown && <section {...popover("search").props} id="workspace-search-popover" className="workspace-v2-action-popover is-more is-search" role="dialog" aria-label={t("focus.searchDocument")} onPointerDown={(event) => event.stopPropagation()}>
      <DocumentSearchPanel search={documentSearch} coveredIds={coveredMatchIds} open={openSurface === "search"} onShowMatch={showSearchMatch} onHideMatches={hideSearchMatches} onClose={() => closeSurfaceAndRestoreFocus('[data-workspace-surface="more"]')} />
    </section>}
  </>;
}

/**
 * Export (or Share): the original PDF, every page with marks, this page, a range, or an image.
 */
export function ExportMenu({ accessiblePageCount, exportBusy, exportForShare, exportRangeEnd, exportRangeStart, exportStudyDocument, popover, setExportRangeEnd, setExportRangeStart, setOpenSurface, studyMode, t, workspaceReady }) {
  return <>
    {workspaceReady && popover("export").shown && <section {...popover("export").props} className="workspace-v2-action-popover is-more" role="dialog" aria-label={t("focus.exportWorkspace")} onPointerDown={(event) => event.stopPropagation()}>
      <header><strong>{exportForShare ? t("focus.share") : t("focus.export")}</strong><button type="button" aria-label={t("focus.closeExportMenu")} onClick={() => setOpenSurface("more")}><X size={17} /></button></header>
      <div className="workspace-v3-menu-list">
        <button type="button" onClick={() => exportStudyDocument("original", { share: exportForShare })} disabled={exportBusy || studyMode === "active"}><Download size={18} /><span><strong>{t("focus.originalPDF")}</strong></span></button>
        <button type="button" onClick={() => exportStudyDocument("annotated", { share: exportForShare })} disabled={exportBusy}><FileText size={18} /><span><strong>{t("focus.pdfWithAnnotations")}</strong></span></button>
        <button type="button" onClick={() => exportStudyDocument("current", { share: exportForShare })} disabled={exportBusy}><FileText size={18} /><span><strong>{t("focus.currentPage")}</strong></span></button>
        <div className="workspace-v6-export-range"><label>{t("focus.from")} <input type="number" min="1" max={accessiblePageCount} value={exportRangeStart} onChange={(event) => setExportRangeStart(Number(event.target.value) || 1)} /></label><label>{t("focus.to")} <input type="number" min={exportRangeStart} max={accessiblePageCount} value={exportRangeEnd} onChange={(event) => setExportRangeEnd(Number(event.target.value) || 1)} /></label><button type="button" onClick={() => exportStudyDocument("range", { share: exportForShare })} disabled={exportBusy || exportRangeEnd < exportRangeStart || exportRangeStart < 1 || exportRangeEnd > accessiblePageCount}>{t("focus.exportPageRange")}</button></div>
        <button type="button" onClick={() => exportStudyDocument("png", { share: exportForShare })} disabled={exportBusy}><ImageIcon size={18} /><span><strong>{t("focus.imagePNG")}</strong></span></button>
      </div>
    </section>}
  </>;
}

/**
 * The More menu: the sheet, study, notes, new tabs, search, sharing, bookmarks and settings.
 */
export function MoreMenu({ openZoomWindow, activeVirtualPageId, allCoversRevealed, annotationsHidden, bookmarkBusy, bookmarked, chooseWritingTool, closeSurfaceAndRestoreFocus, coverIds, deleteBlankPage, documentSearch, exportBusy, openNewWhiteboard, page, personal, popover, searchDocumentProxy, selectTool, setActiveTool, setAnnotationsHidden, setExportForShare, setExportRangeEnd, setExportRangeStart, setMarksOpen, setOpenSurface, setSelectedIds, shareDocumentId, sheet, sheetEdition, singleTab, studyInProgress, studyRangeLabel, summaryMode, t, toggleAllCovers, toggleBookmark, whiteboard, workspaceReady }) {
  return <>
    {workspaceReady && popover("more").shown && <section {...popover("more").props} id="workspace-more-popover" className="workspace-v2-action-popover is-more" role="dialog" aria-label={t("focus.moreWorkspaceActions")} onPointerDown={(event) => event.stopPropagation()}>
      <header><strong>{t("focus.workspace")}</strong><button type="button" aria-label={t("focus.closeWorkspaceActions")} onClick={() => closeSurfaceAndRestoreFocus('[data-workspace-surface="more"]')}><X size={17} /></button></header>
      <div className="workspace-v3-menu-list">
        {/* Shown only where the toolbar hides the tab row or these buttons
            for room (see "Toolbar layout" in focus-workspace-glass.css). */}
        {singleTab && <div className="workspace-v3-menu-document is-single-tab-entry" dir="auto">
          {whiteboard ? <NotebookPen size={18} aria-hidden="true" /> : <FileText size={18} aria-hidden="true" />}
          <span><strong>{sheet.title}</strong><small>{whiteboard ? t("workspaceTabs.whiteboardStoredHere") : personal ? t("personalSheets.readerLabel") : summaryMode ? t("materials.sheetSummary") : sheetEdition?.edition === "lockin" ? t("focus.lockinEdition") : t("focus.universityEdition")}</small></span>
        </div>}
        {!whiteboard && !personal && <button type="button" className="is-narrow-entry" data-workspace-action="study" onClick={() => setOpenSurface("study")}><Brain size={18} /><span><strong>{t("focus.study")}</strong><small>{studyInProgress ? studyRangeLabel : t("focus.studyModeHint")}</small></span></button>}
        {/* Notes is a surface of its own, so opening More has already closed it:
            this row only ever opens it. */}
        <button type="button" className="is-notes-entry" data-workspace-action="notes" onClick={() => selectTool("note")}><MessageSquare size={18} /><span><strong>{t("focus.openNotes")}</strong></span></button>
        {singleTab && <>
          <button type="button" className="is-single-tab-entry" data-workspace-action="new-whiteboard" onClick={() => { setOpenSurface(null); openNewWhiteboard(); }}><NotebookPen size={18} /><span><strong>{t("workspaceTabs.whiteboard")}</strong><small>{t("workspaceTabs.whiteboardHint")}</small></span></button>
          <button type="button" className="is-single-tab-entry" data-workspace-action="open-sheet" onClick={() => { setOpenSurface(null); requestSheetPicker(); }}><FileText size={18} /><span><strong>{t("workspaceTabs.openSheet")}</strong><small>{t("workspaceTabs.openSheetHint")}</small></span></button>
          <button type="button" className="is-single-tab-entry" data-workspace-action="video" onClick={() => { setOpenSurface(null); requestFocusVideo(); }}><Youtube size={18} /><span><strong>{t("focusVideo.menu")}</strong><small>{t("focusVideo.menuHint")}</small></span></button>
        </>}
        <hr className="workspace-v9-menu-separator is-compact-separator" />
        {sheet.pdfUrl && <button type="button" data-workspace-action="search" onClick={() => setOpenSurface("search")} disabled={!searchDocumentProxy}><Search size={18} /><span><strong>{t("focus.searchDocument")}</strong>{documentSearch.matches.length > 0 && <small dir="auto">{documentSearch.query}</small>}</span></button>}
        <button type="button" data-workspace-action="zoom-window" onClick={openZoomWindow}><ZoomIn size={18} /><span><strong>{t("focus.zoomWindow")}</strong><small>{t("focus.zoomWindowHint")}</small></span></button>
        <button type="button" className="is-phone-entry" onClick={() => chooseWritingTool("hand")}><Hand size={18} /><span><strong>{t("focus.tool.hand")}</strong></span></button>
        <button type="button" className="is-compact-entry" onClick={() => chooseWritingTool("shapes")}><Shapes size={18} /><span><strong>{t("focus.shapes")}</strong></span></button>
        <button type="button" className="is-phone-entry" data-workspace-action="add" onClick={() => setOpenSurface("add")}><Plus size={18} /><span><strong>{t("focus.addToPage")}</strong></span></button>
        <hr className="workspace-v9-menu-separator" />
        {shareDocumentId && <button type="button" data-workspace-action="marks" onClick={() => { setOpenSurface(null); setMarksOpen(true); }}><Users size={18} /><span><strong>{t("marks.menu")}</strong><small>{t("marks.menuHint")}</small></span></button>}
        <button type="button" onClick={() => { setExportRangeStart(page); setExportRangeEnd(page); setExportForShare(true); setOpenSurface("export"); }} disabled={exportBusy}><Share2 size={18} /><span><strong>{t("focus.share")}</strong></span></button>
        <button type="button" data-drill="" onClick={() => { setExportRangeStart(page); setExportRangeEnd(page); setExportForShare(false); setOpenSurface("export"); }}><FileText size={18} /><span><strong>{t("focus.export")}</strong></span></button>
        <hr className="workspace-v9-menu-separator" />
        {!personal && <button type="button" aria-pressed={bookmarked} onClick={toggleBookmark} disabled={bookmarkBusy}><Bookmark size={18} fill={bookmarked ? "currentColor" : "none"} /><span><strong>{bookmarked ? t("focus.removeFromBookmarks") : t("focus.saveToBookmarks")}</strong></span></button>}
        {coverIds.length > 0 && <button type="button" onClick={toggleAllCovers}>{allCoversRevealed ? <EyeOff size={18} /> : <Eye size={18} />}<span><strong>{allCoversRevealed ? t("focus.hideAllCovers") : t("focus.revealAllCovers")}</strong><small>{t("focus.hiddenOnPage")}: {coverIds.length}</small></span></button>}
        <button type="button" onClick={() => { setAnnotationsHidden((value) => !value); setSelectedIds([]); setActiveTool("hand"); }} aria-pressed={annotationsHidden}>{annotationsHidden ? <Eye size={18} /> : <EyeOff size={18} />}<span><strong>{annotationsHidden ? t("focus.showAnnotations") : t("focus.hideAnnotations")}</strong></span></button>
        <hr className="workspace-v9-menu-separator" />
        {activeVirtualPageId !== null && <button type="button" onClick={() => deleteBlankPage()}><Trash2 size={18} /><span><strong>{t("focus.deleteBlankPage")}</strong></span></button>}
        <button type="button" data-drill="" aria-label={t("focus.workspaceSettings")} aria-controls="workspace-settings-popover" onClick={() => setOpenSurface("settings")}><Settings size={18} /><span><strong>{t("focus.settings")}</strong></span></button>
      </div>
    </section>}
  </>;
}

/**
 * Study: switch between Normal Study and Active Study.
 */
export function StudyMenu({ activeStudy, closeSurfaceAndRestoreFocus, knowledgeNavigation, knowledgeOpen, openStudyTool, personal, popover, setMarksOpen, setModeDialogOpen, setOpenSurface, setSummaryDialogOpen, shareDocumentId, sheetSummaries, studyMode, studyTools, summariesEnabled, t, whiteboard, workspaceReady }) {
  return <>
    {workspaceReady && !whiteboard && !personal && popover("study").shown && <section {...popover("study").props} id="workspace-study-popover" className="workspace-v2-action-popover is-more is-study" role="dialog" aria-label={t("focus.study")} onPointerDown={(event) => event.stopPropagation()}>
      <header><strong>{t("focus.study")}</strong><button type="button" aria-label={t("focus.closeStudyMenu")} onClick={() => closeSurfaceAndRestoreFocus('[data-workspace-surface="study"]')}><X size={17} /></button></header>
      <div className="workspace-v3-menu-list">
        <button type="button" data-study-action="mode" onClick={() => { setOpenSurface(null); setModeDialogOpen(true); }}><Brain size={18} /><span><strong>{t(studyMode === "active" ? "focus.studyModeActive" : "focus.studyModeNormal")}</strong><small>{studyMode === "active" && activeStudy ? t("activeStudy.pageRange", { start: activeStudy.current_page_range?.start_page, end: activeStudy.current_page_range?.end_page }) : t("focus.studyModeHint")}</small></span></button>
        {summariesEnabled && <hr className="workspace-v9-menu-separator" />}
        {summariesEnabled && <button type="button" data-study-action="my-summary" onClick={() => { setOpenSurface(null); setSummaryDialogOpen(true); void sheetSummaries.reload(); }}><FileText size={18} /><span><strong>{t("summary.title")}</strong><small>{sheetSummaries.summaries.length ? sheetSummaries.summaries.map((item) => item.title).join(" · ") : t("summary.menuHint")}</small></span></button>}
        {studyTools.length > 0 && <hr className="workspace-v9-menu-separator" />}
        {studyTools.map(([tool, Icon]) => <button key={tool} type="button" data-study-tool={tool} aria-pressed={knowledgeOpen && knowledgeNavigation?.tool === tool} onClick={() => openStudyTool(tool)}><Icon size={18} /><span><strong>{t(`knowledge.${tool}`)}</strong></span></button>)}
        {shareDocumentId && <hr className="workspace-v9-menu-separator" />}
        {shareDocumentId && <button type="button" data-study-action="marks" onClick={() => { setOpenSurface(null); setMarksOpen(true); }}><Users size={18} /><span><strong>{t("marks.menu")}</strong><small>{t("marks.menuHint")}</small></span></button>}
      </div>
    </section>}
  </>;
}

/**
 * Add or edit a text annotation.
 */
export function TextEditor({ activeVirtualPageId, addTextAnnotation, closeSurfaceAndRestoreFocus, editingTextId, page, popover, setTextAlign, setTextBold, setTextColor, setTextDraft, setTextFontSize, t, textAlign, textBold, textColor, textDraft, textFontSize, textInputRef, workspaceReady }) {
  return <>
    {workspaceReady && popover("text").shown && <section {...popover("text").props} className="workspace-v2-action-popover is-text" role="dialog" aria-label={editingTextId ? t("focus.editTextAnnotation") : t("focus.addTextAnnotation")} onPointerDown={(event) => event.stopPropagation()}>
      <header><strong>{editingTextId ? t("focus.editText") : activeVirtualPageId === null ? t("focus.addTextToPdfPage", { page }) : t("focus.addTextToBlankPage", { page })}</strong><button type="button" aria-label={t("focus.closeTextEditor")} onClick={() => closeSurfaceAndRestoreFocus('[data-workspace-surface="add"]')}><X size={17} /></button></header>
      <label className="workspace-v3-text-entry"><span>{t("focus.annotationText")}</span><textarea ref={textInputRef} value={textDraft} maxLength={1000} rows={4} onChange={(event) => setTextDraft(event.target.value)} /></label>
      <div className="workspace-v6-text-controls">
        <label>{t("focus.size")} <input type="number" min="18" max="64" value={textFontSize} onChange={(event) => setTextFontSize(Math.min(64, Math.max(18, Number(event.target.value) || 18)))} /></label>
        <label>{t("focus.color")} <input type="color" value={textColor} onChange={(event) => setTextColor(event.target.value)} /></label>
        <button type="button" aria-pressed={textBold} className={textBold ? "is-active" : ""} onClick={() => setTextBold((current) => !current)}><strong>B</strong> {t("focus.bold")}</button>
        <label>{t("focus.align")} <select value={textAlign} onChange={(event) => setTextAlign(event.target.value)}><option value="left">{t("focus.left")}</option><option value="center">{t("focus.center")}</option><option value="right">{t("focus.right")}</option></select></label>
      </div>
      <button type="button" className="workspace-v3-menu-primary" onClick={addTextAnnotation} disabled={!textDraft.trim()}>{editingTextId ? t("focus.saveText") : t("focus.addText")}</button>
    </section>}
  </>;
}

/**
 * Add or edit a note card.
 */
export function CardEditor({ cardDraft, cardKind, deleteEditingCard, editingCardId, popover, saveCard, setCardDraft, setCardKind, setOpenSurface, t, workspaceReady }) {
  return <>
    {workspaceReady && popover("card").shown && <section {...popover("card").props} className="workspace-v2-action-popover is-add workspace-v6-card-editor" role="dialog" aria-label={editingCardId ? t("focus.editStudyCard") : t("focus.addStudyCard")} onPointerDown={(event) => event.stopPropagation()}>
      <header><strong>{editingCardId ? t("focus.editStudyCard") : t("focus.addStudyCard")}</strong><button type="button" aria-label={t("focus.closeCardEditor")} onClick={() => setOpenSurface(null)}><X size={17} /></button></header>
      <div className="workspace-v6-card-kinds" role="group" aria-label={t("focus.cardStyle")}>
        {NOTE_CARD_KINDS.map((kind) => <button key={kind} type="button" className={cardKind === kind ? "is-active" : ""} aria-pressed={cardKind === kind} onClick={() => setCardKind(kind)}><i aria-hidden="true" className={`is-${kind}`} />{t(`focus.card.${kind}`)}</button>)}
      </div>
      <label className="workspace-v3-text-entry"><span>{t("focus.cardText")}</span><textarea dir="auto" value={cardDraft} maxLength={1200} rows={5} placeholder={t("focus.cardTextHint")} onChange={(event) => setCardDraft(event.target.value)} /></label>
      <button type="button" className="workspace-v3-menu-primary" onClick={saveCard} disabled={!cardDraft.trim()}>{editingCardId ? t("focus.saveCard") : t("focus.addCard")}</button>
      {editingCardId && <button type="button" className="workspace-v6-card-delete" onClick={deleteEditingCard}><Trash2 size={16} />{t("focus.deleteCard")}</button>}
    </section>}
  </>;
}

/**
 * The background of a page added to the sheet.
 */
export function PageBackgroundMenu({ addBlankPage, page, popover, setOpenSurface, t, workspaceReady }) {
  return <>
    {workspaceReady && popover("page-background").shown && <section {...popover("page-background").props} className="workspace-v2-action-popover is-add" role="dialog" aria-label={t("focus.chooseWorkspacePageBackground")} onPointerDown={(event) => event.stopPropagation()}>
      <header><strong>{t("focus.addPageAfterPdfPage", { page })}</strong><button type="button" aria-label={t("focus.closePageBackgrounds")} onClick={() => setOpenSurface("add")}><X size={17} /></button></header>
      <div className="workspace-v3-menu-list">
        {PAGE_BACKGROUND_CHOICES.map(([background, labelKey]) => <button key={background} type="button" onClick={() => addBlankPage(background)}><span className={`workspace-v6-page-pattern is-${background}`} aria-hidden="true" /><span><strong>{t(labelKey)}</strong></span></button>)}
      </div>
    </section>}
  </>;
}

/**
 * Add to page: text, image, note card, cover, and new pages.
 */
export function AddMenu({ closeSurfaceAndRestoreFocus, page, popover, selectTool, setActiveTool, setCardDraft, setCardKind, setClipSelecting, setCoverSelecting, setEditingCardId, setEditingTextId, setFocusMessage, setLassoMode, setOpenSurface, setSelectedIds, setTextDraft, sheet, studyMode, t, workspaceReady }) {
  return <>
    {workspaceReady && popover("add").shown && <section {...popover("add").props} id="workspace-add-popover" className="workspace-v2-action-popover is-add" role="dialog" aria-label={t("focus.addToPage")} onPointerDown={(event) => event.stopPropagation()}>
      <header><strong>{t("focus.addToPage")} {page}</strong><button type="button" aria-label={t("focus.closeAddMenu")} onClick={() => closeSurfaceAndRestoreFocus('[data-workspace-surface="add"]')}><X size={17} /></button></header>
      <div className="workspace-v3-menu-list workspace-v5-add-list">
        <button type="button" onClick={() => { setEditingTextId(null); setTextDraft(""); setOpenSurface("text"); }} data-workspace-tool="text"><Type size={18} /><span><strong>{t("focus.addText")}</strong></span></button>
        <button type="button" data-workspace-tool="image" onClick={() => selectTool("image")}><ImageIcon size={18} /><span><strong>{t("focus.addImage")}</strong></span></button>
        <button type="button" onClick={() => { setCardKind("note"); setCardDraft(""); setEditingCardId(null); setOpenSurface("card"); }}><FileText size={18} /><span><strong>{t("focus.addNoteCard")}</strong></span></button>
        <button type="button" data-workspace-tool="cover" onClick={() => { setCoverSelecting(true); setClipSelecting(false); setLassoMode("rectangle"); setActiveTool("select"); setSelectedIds([]); setOpenSurface(null); setFocusMessage(t("focus.dragOverWhatToHide")); }}><EyeOff size={18} /><span><strong>{t("focus.hidePartOfPage")}</strong><small>{t("focus.hidePartOfPageHint")}</small></span></button>
        {sheet.pdfUrl && <hr className="workspace-v9-menu-separator" />}
        {sheet.pdfUrl && <button type="button" data-drill="" aria-label={t("focus.addPage")} onClick={() => setOpenSurface("page-background")}><Plus size={18} /><span><strong>{t("focus.addPage2")}</strong></span></button>}
        <hr className="workspace-v9-menu-separator" />
      </div>
      {studyMode === "active" && <p className="workspace-v7-menu-note"><Info size={15} aria-hidden="true" />{t("focus.pagesYouAddBelongTo")}</p>}
    </section>}
  </>;
}
