import { BookOpen, Bookmark, Circle, Download, Eraser, Eye, FileText, Hash, Image as ImageIcon, PenLine, Power, Ruler, Sparkles, Trash2, Upload, X, ZoomIn } from "lucide-react";
import { DRAWING_INPUT } from "../../workspace/input/gestureStateMachine.js";
import { PAGE_BACKGROUND_CHOICES, SETTINGS_SECTIONS } from "./constants.js";
import { SettingsToggle } from "./controls.jsx";
import { moveWithinRadioGroup } from "./studyDialogs.jsx";

/**
 * Workspace settings: drawing, canvas, view and other sections.
 */
export function SettingsPopover({ activeVirtualPage, activeVirtualPageId, addBlankPage, annotationsHidden, applyRestoredBackup, autoImproveHandwriting, backupBusy, backupInputRef, changeDrawingInput, changeVirtualPageBackground, circleToErase, clearPageAnnotations, closeSurfaceAndRestoreFocus, deleteBlankPage, drawAndHold, drawingInput, exportBusy, exportStudyDocument, exportWorkspaceBackup, includeWorkspacePages, keepScreenAwake, page, pageAnnotations, pdfDocumentReady, pendingImport, popover, readWorkspaceBackup, rememberLastPosition, rememberZoomLevel, saveErrorReason, saveState, scribbleToErase, setActiveTool, setAnnotationsHidden, setAutoImproveHandwriting, setCircleToErase, setDrawAndHold, setIncludeWorkspacePages, setKeepScreenAwake, setPendingImport, setRememberLastPosition, setRememberZoomLevel, setScribbleToErase, setSelectedIds, setSettingsTab, setShowPageNumber, settingsTab, sheet, showPageNumber, t, wakeLockSupported, workspaceReady }) {
  return <>
    {workspaceReady && popover("settings").shown && <section {...popover("settings").props} id="workspace-settings-popover" className="workspace-v2-settings-popover workspace-v8-settings" role="dialog" aria-label={t("focus.workspaceSettings")} onPointerDown={(event) => event.stopPropagation()}>
      <header className="workspace-v8-settings-head"><strong>{t("focus.settings")}</strong><button type="button" aria-label={t("focus.closeWorkspaceSettings")} onClick={() => closeSurfaceAndRestoreFocus('[data-workspace-surface="more"]')}><X size={17} /></button></header>
      <div className="workspace-v8-settings-tabs" role="tablist" aria-label={t("focus.settingsSections")}>
        {SETTINGS_SECTIONS.map(({ id, label }) => <button key={id} id={`workspace-settings-tab-${id}`} type="button" role="tab" aria-selected={settingsTab === id} aria-controls="workspace-settings-panel" tabIndex={settingsTab === id ? 0 : -1} onClick={() => setSettingsTab(id)} onKeyDown={(event) => {
          const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
          if (!step) return;
          event.preventDefault();
          const direction = window.getComputedStyle(event.currentTarget).direction === "rtl" ? -step : step;
          const index = SETTINGS_SECTIONS.findIndex((section) => section.id === settingsTab);
          const next = SETTINGS_SECTIONS[(index + direction + SETTINGS_SECTIONS.length) % SETTINGS_SECTIONS.length];
          setSettingsTab(next.id);
          window.requestAnimationFrame(() => document.getElementById(`workspace-settings-tab-${next.id}`)?.focus());
        }}>{t(label)}</button>)}
      </div>
      <div id="workspace-settings-panel" className="workspace-v2-settings-content workspace-v8-settings-panel" role="tabpanel" aria-labelledby={`workspace-settings-tab-${settingsTab}`}>
        {settingsTab === "drawing" && <>
          <div className="workspace-v8-settings-group">
            <SettingsToggle icon={PenLine} label={t("focus.applePencilMode")} description={t("focus.onlyThePencilDrawsFingers")} checked={drawingInput === DRAWING_INPUT.STYLUS_ONLY} onChange={(enabled) => changeDrawingInput(enabled ? DRAWING_INPUT.STYLUS_ONLY : DRAWING_INPUT.STYLUS_AND_FINGER)} />
          </div>
          <div className="workspace-v8-settings-group">
            <SettingsToggle icon={Sparkles} label={t("focus.improveNewHandwriting")} description={t("focus.smoothNewPenAndPencil")} checked={autoImproveHandwriting} onChange={setAutoImproveHandwriting} />
            <SettingsToggle icon={Ruler} label={t("focus.straightLinesShapes")} description={t("focus.snapNearStraightLinesAnd")} checked={drawAndHold} onChange={setDrawAndHold} />
            <SettingsToggle icon={Eraser} label={t("focus.scribbleToErase")} description={t("focus.scratchAcrossYourOwnInk")} checked={scribbleToErase} onChange={setScribbleToErase} />
            <SettingsToggle icon={Circle} label={t("focus.circleToErase")} description={t("focus.circleHandwritingAndHoldTo")} checked={circleToErase} onChange={setCircleToErase} />
          </div>
        </>}
        {settingsTab === "canvas" && <>
          {activeVirtualPageId !== null
            ? <div className="workspace-v8-settings-group">
              <p className="workspace-v8-settings-label">{t("focus.thisPageSBackground")}</p>
              <div className="workspace-v8-segmented" role="radiogroup" aria-label={t("focus.pageBackground")}>
                {PAGE_BACKGROUND_CHOICES.map(([background, labelKey]) => <button key={background} type="button" role="radio" aria-checked={activeVirtualPage?.background === background} tabIndex={activeVirtualPage?.background === background ? 0 : -1} onKeyDown={moveWithinRadioGroup} onClick={() => changeVirtualPageBackground(background)}><span className={`workspace-v6-page-pattern is-${background}`} aria-hidden="true" />{t(labelKey)}</button>)}
              </div>
            </div>
            : <div className="workspace-v8-settings-group">
              <p className="workspace-v8-settings-label">{t("focus.addPageAfterPage", { page })}</p>
              <div className="workspace-v8-segmented" role="group" aria-label={t("focus.addAPage")}>
                {PAGE_BACKGROUND_CHOICES.map(([background, labelKey]) => <button key={background} type="button" aria-label={t("focus.addBackgroundPage", { background: t(labelKey).toLowerCase() })} disabled={!sheet.pdfUrl || !pdfDocumentReady} onClick={() => addBlankPage(background)}><span className={`workspace-v6-page-pattern is-${background}`} aria-hidden="true" />{t(labelKey)}</button>)}
              </div>
            </div>}
          <div className="workspace-v8-settings-group">
            <SettingsToggle icon={Eye} label={t("focus.showAnnotations")} description={t("focus.turnOffToSeeOnly")} checked={!annotationsHidden} onChange={(shown) => { setAnnotationsHidden(!shown); setSelectedIds([]); if (!shown) setActiveTool("hand"); }} />
          </div>
          <div className="workspace-v8-settings-group">
            <button type="button" className="workspace-v2-settings-action is-danger" onClick={clearPageAnnotations} disabled={!pageAnnotations.some((item) => !item.locked)}><Trash2 size={18} /><span><strong>{activeVirtualPageId === null ? t("focus.clearInkOnPdfPage", { page }) : t("focus.clearInkThisPage")}</strong><small>{t("focus.removesUnlockedMarksUndoRestores")}</small></span></button>
            {activeVirtualPageId !== null && <button type="button" className="workspace-v2-settings-action is-danger" onClick={() => deleteBlankPage()}><Trash2 size={18} /><span><strong>{t("focus.deleteThisAddedPage")}</strong><small>{t("focus.removesThePageAndIts")}</small></span></button>}
          </div>
        </>}
        {settingsTab === "view" && <>
          <div className="workspace-v8-settings-group">
            <SettingsToggle icon={ZoomIn} label={t("focus.rememberZoomLevel")} description={t("focus.reopenThisSheetAtYour")} checked={rememberZoomLevel} onChange={setRememberZoomLevel} />
            <SettingsToggle icon={Hash} label={t("focus.showPageNumber")} description={t("focus.keepThePageCounterIn")} checked={showPageNumber} onChange={setShowPageNumber} />
            <SettingsToggle icon={Bookmark} label={t("focus.resumeActiveStudyWhereI")} description={t("focus.reopenAnActiveStudyPart")} checked={rememberLastPosition} onChange={setRememberLastPosition} />
            {wakeLockSupported && <SettingsToggle icon={Power} label={t("focus.keepScreenAwake")} description={t("focus.stopTheScreenFromSleeping")} checked={keepScreenAwake} onChange={setKeepScreenAwake} />}
          </div>
        </>}
        {settingsTab === "other" && <>
          <div className="workspace-v8-settings-group">
            <button type="button" className="workspace-v2-settings-action" onClick={() => exportStudyDocument("annotated")} disabled={exportBusy}><FileText size={18} /><span><strong>{t("focus.exportAsPDF")}</strong><small>{t("focus.yourPagesWithEveryMark")}</small></span></button>
            <button type="button" className="workspace-v2-settings-action" onClick={() => exportStudyDocument("png")} disabled={exportBusy}><ImageIcon size={18} /><span><strong>{t("focus.exportThisPageAsAn")}</strong><small>{t("focus.pngOfThePageYou")}</small></span></button>
            <SettingsToggle icon={BookOpen} label={t("focus.includeAddedPages")} description={t("focus.putPagesYouAddedInto")} checked={includeWorkspacePages} onChange={setIncludeWorkspacePages} />
          </div>
          <div className="workspace-v8-settings-group">
            {saveState === "error" && <p className="workspace-v2-settings-note" role="alert">{saveErrorReason || t("focus.marksNotSaved")}</p>}
            <button type="button" className="workspace-v2-settings-action" onClick={exportWorkspaceBackup} disabled={backupBusy}><Download size={18} /><span><strong>{t("focus.exportWorkspaceBackup")}</strong><small>{t("focus.saveEditableMarksAndNotes")}</small></span></button>
            <button type="button" className="workspace-v2-settings-action" onClick={() => backupInputRef.current?.click()} disabled={backupBusy}><Upload size={18} /><span><strong>{t("focus.restoreABackup")}</strong><small>{t("focus.addAnythingMissingWithoutReplacing")}</small></span></button>
            {pendingImport && <div className="workspace-v2-settings-confirm" role="group" aria-label={t("focus.confirmRestoreFromAnotherSheet")}><p>{t("focus.restoreMarksFrom", { count: pendingImport.annotations.length, sheet: pendingImport.sheetTitle || pendingImport.sheetSlug })}</p><div><button type="button" onClick={() => applyRestoredBackup(pendingImport)}>{t("focus.restoreAnyway")}</button><button type="button" onClick={() => setPendingImport(null)}>{t("focus.cancel")}</button></div></div>}
          </div>
        </>}
        <input ref={backupInputRef} className="workspace-v2-file-input" type="file" accept="application/json,.json" onChange={readWorkspaceBackup} tabIndex={-1} aria-hidden="true" />
      </div>
    </section>}
  </>;
}
