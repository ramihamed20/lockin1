import { Check, Circle, Hash, Minus, PaintBucket, Plus, Ruler, Shapes, Sparkles, Star, Trash2 } from "lucide-react";
import { ERASER_MODE } from "../../workspace/ink/strokeModel.js";
import { ERASER_MODE_OPTIONS, LASSO_MODE_OPTIONS, MAX_PALETTE_COLORS, SHAPE_FILL_COLORS, SHAPE_OPTIONS, THICKNESS_STEP, TOOL_PANEL_COPY, formatThickness, roundThickness } from "./constants.js";
import { IconChoiceGroup, PenProfilePicker, SettingsToggle, ToolRange } from "./controls.jsx";
import { TRANSIENT_INK_KIND } from "../../workspace/ink/transientInk.js";
import { ToolPreview } from "../../workspace/catalog/ToolPreview.jsx";
import { cssVars } from "../../lib/utils.js";

/**
 * The active tool's options: pen type, thickness, opacity, colours and the tool's switches.
 */
export function ToolOptionsPanel({ favoritesStrip, activeColor, activePenOption, activeTool, activeToolLabel, activeToolOpacity, brushSize, changePenProfile, chooseAnnotationColor, circleToErase, clearPageAnnotations, commitCustomColor, customColorDraft, customColorEditorOpen, customColorSet, deleteCustomColor, displayedToolOptions, drawAndHold, eraserMode, eraserSize, favoriteColors, inkToolActive, lassoMode, pageAnnotations, paletteColors, penProfile, recentColors, selectedAnnotations, setBrushSize, setCircleToErase, setCustomColorDraft, setCustomColorEditorOpen, setDrawAndHold, setEraserMode, setEraserSize, setLassoMode, setShapeAngle, setShapeDashed, setShapeFill, setShapeFillColor, setShapeSnapGrid, setShapeStyle, shapeAngle, shapeDashed, shapeFill, shapeFillColor, shapeSnapGrid, shapeStyle, showColorPalette, t, toggleFavoriteColor, toolOptionsOpen, toolOptionsRef, updateActiveToolOpacity, workspaceReady }) {
  return <>
    {workspaceReady && displayedToolOptions && <div ref={toolOptionsRef} id={`workspace-${displayedToolOptions}-options`} className={`workspace-v2-tool-options${toolOptionsOpen ? "" : " is-exiting"}`} data-workspace-tool={toolOptionsOpen ? displayedToolOptions : undefined} role="dialog" aria-label={t("focus.toolOptions", { tool: activeToolLabel })} aria-hidden={!toolOptionsOpen} inert={toolOptionsOpen ? undefined : ""} onPointerDown={(event) => event.stopPropagation()}>
      <div className="workspace-v2-tool-options-title">
        <span><strong>{TOOL_PANEL_COPY[activeTool] ? t(TOOL_PANEL_COPY[activeTool][0]) : activeToolLabel}{activeTool === "pen" && activePenOption && <em> · {t(activePenOption[3])}</em>}</strong><small className={activeTool === "pen" && penProfile === TRANSIENT_INK_KIND.POINTER ? "is-shown" : undefined}>{activeTool === "pen" && penProfile === TRANSIENT_INK_KIND.POINTER ? t(activePenOption[1]) : TOOL_PANEL_COPY[activeTool] ? t(TOOL_PANEL_COPY[activeTool][1]) : ""}</small></span>
        <span className="workspace-v7-preview-well"><ToolPreview tool={activeTool} color={activeColor} size={activeTool === "eraser" ? eraserSize : brushSize} opacity={activeToolOpacity} shape={shapeStyle} fill={shapeFill ? shapeFillColor : null} dashed={shapeDashed} lassoMode={lassoMode} penProfile={penProfile} /></span>
      </div>
      <div className="workspace-v7-panel-body">
        {["pen", "highlighter"].includes(activeTool) && favoritesStrip}
        {activeTool === "pen" && <section className="workspace-v5-inspector-section"><PenProfilePicker value={penProfile} onChange={changePenProfile} color={activeColor} /></section>}
        {activeTool === "shapes" && <section className="workspace-v5-inspector-section"><IconChoiceGroup label={t("focus.shapeType")} value={shapeStyle} options={SHAPE_OPTIONS} onChange={setShapeStyle} /></section>}
    
        {activeTool === "eraser" && <section className="workspace-v5-inspector-section"><h3>{t("focus.eraseMode")}</h3><IconChoiceGroup label={t("focus.eraserMode")} value={eraserMode} options={ERASER_MODE_OPTIONS} onChange={setEraserMode} /><p>{eraserMode === ERASER_MODE.STROKE ? t("focus.eraserHintStroke") : eraserMode === ERASER_MODE.OBJECT ? t("focus.eraserHintObject") : t("focus.eraserHintPixel")}</p></section>}
        {activeTool === "eraser" && <section className="workspace-v5-inspector-section workspace-v7-adjust"><ToolRange label={t("focus.eraserSize")} value={eraserSize} displayValue={`${eraserSize}px`} min={6} max={48} step={2} preview="eraser" onChange={setEraserSize} /></section>}
        {activeTool === "eraser" && <section className="workspace-v5-inspector-section workspace-v7-rows"><button type="button" className="workspace-v2-settings-action is-danger" onClick={clearPageAnnotations} disabled={!pageAnnotations.some((item) => !item.locked)}><Trash2 size={18} /><span><strong>{t("focus.clearPageHandwriting")}</strong><small>{t("focus.removeUnlockedMarksOnThis")}</small></span></button></section>}
    
        {activeTool === "select" && <section className="workspace-v5-inspector-section"><IconChoiceGroup label={t("focus.lassoMode")} value={lassoMode} options={LASSO_MODE_OPTIONS} onChange={setLassoMode} /></section>}
        {activeTool === "select" && !selectedAnnotations.length && <p className="workspace-v9-panel-hint">{t("focus.drawAroundMarksToSelect")}</p>}
        {inkToolActive && <section className="workspace-v5-inspector-section workspace-v7-adjust">
          <ToolRange label={activeTool === "shapes" ? t("focus.borderWidth") : t("focus.thickness")} value={brushSize} displayValue={formatThickness(brushSize)} min={1} max={12} step={THICKNESS_STEP} keyStep={.5} onChange={(size) => setBrushSize(roundThickness(size))} color={activeColor} />
          <ToolRange label={t("focus.opacity")} value={activeToolOpacity} displayValue={`${Math.round(activeToolOpacity * 100)}%`} min={activeTool === "highlighter" ? .1 : .2} max={1} step={.01} preview="opacity" color={activeColor} onChange={updateActiveToolOpacity} />
        </section>}
    
        {showColorPalette && <section className="workspace-v5-inspector-section"><h3>{activeTool === "select" ? t("focus.selectedMarkColor") : activeTool === "shapes" ? t("focus.strokeColor") : t("focus.colors")}</h3>
          <div className="workspace-v2-colors" aria-label={activeTool === "select" ? t("focus.selectionColors") : t("focus.annotationColors")}>
            {paletteColors.map((color) => <span key={color} className={`workspace-v2-color-item${customColorSet.has(color) ? " is-custom" : ""}`}>
              <button type="button" className={`workspace-v2-color-swatch${activeColor === color ? " is-active" : ""}`} aria-label={t("focus.useColor", { color })} title={color} aria-pressed={activeColor === color} style={cssVars({ "--workspace-tool-color": color })} onClick={() => chooseAnnotationColor(color)} />
              {customColorSet.has(color) && <button type="button" className="workspace-v2-color-delete" aria-label={t("focus.deleteColor", { color })} title={t("focus.deleteColor", { color })} onClick={() => deleteCustomColor(color)}><Minus size={11} /></button>}
            </span>)}
            {paletteColors.length < MAX_PALETTE_COLORS && <button type="button" className={`workspace-v2-custom-color${customColorEditorOpen ? " is-active" : ""}`} aria-label={t("focus.addColor")} title={t("focus.addColor")} aria-expanded={customColorEditorOpen} onClick={() => { setCustomColorDraft(activeColor); setCustomColorEditorOpen((current) => !current); }}><Plus size={15} /><span>{t("focus.add")}</span></button>}
            <button type="button" className={`workspace-v4-favorite-color${favoriteColors.includes(activeColor) ? " is-active" : ""}`} aria-label={favoriteColors.includes(activeColor) ? t("focus.removeFavoriteColor") : t("focus.favoriteCurrentColor")} aria-pressed={favoriteColors.includes(activeColor)} onClick={toggleFavoriteColor}><Star size={15} fill={favoriteColors.includes(activeColor) ? "currentColor" : "none"} /></button>
            {customColorEditorOpen && <div className="workspace-v2-custom-color-editor" role="group" aria-label={t("focus.customColorEditor")}>
              <input type="color" aria-label={t("focus.chooseCustomColor")} value={customColorDraft} onChange={(event) => setCustomColorDraft(event.target.value)} />
              <button type="button" aria-label={t("focus.saveCustomColor")} title={t("focus.saveColor")} onClick={commitCustomColor}><Check size={16} /></button>
            </div>}
          </div>
        </section>}
        {["pen", "highlighter"].includes(activeTool) && recentColors.length > 0 && <section className="workspace-v5-inspector-section"><h3>{t("focus.recentColors")}</h3><div className="workspace-v6-color-strip">{recentColors.slice(0, 8).map((color) => <button key={color} type="button" aria-label={t("focus.useRecentColor", { color })} className={activeColor === color ? "is-active" : ""} style={cssVars({ "--workspace-tool-color": color })} onClick={() => chooseAnnotationColor(color)} />)}</div></section>}
        {["pen", "highlighter"].includes(activeTool) && favoriteColors.length > 0 && <section className="workspace-v5-inspector-section"><h3>{t("focus.favorites")}</h3><div className="workspace-v6-color-strip">{favoriteColors.map((color) => <button key={color} type="button" aria-label={t("focus.useFavoriteColor", { color })} className={activeColor === color ? "is-active" : ""} style={cssVars({ "--workspace-tool-color": color })} onClick={() => chooseAnnotationColor(color)} />)}</div></section>}
    
        {activeTool === "highlighter" && <section className="workspace-v5-inspector-section workspace-v7-rows"><SettingsToggle icon={Minus} label={t("focus.straightLinesShapes")} description={t("focus.aNearStraightHighlightBecomes")} checked={drawAndHold} onChange={setDrawAndHold} /></section>}
    
        {activeTool === "shapes" && <section className="workspace-v5-inspector-section workspace-v7-rows"><h3>{t("focus.style")}</h3>
          <SettingsToggle icon={PaintBucket} label={t("focus.fillShape")} description={t("focus.useASolidColorInside")} checked={shapeFill} onChange={setShapeFill} />
          {shapeFill && <div className="workspace-v7-fill-colors" role="group" aria-label={t("focus.fillColors")}>
            {SHAPE_FILL_COLORS.map((color) => <button key={color} type="button" className={shapeFillColor === color ? "is-active" : ""} aria-label={t("focus.fillWith", { color })} aria-pressed={shapeFillColor === color} style={cssVars({ "--workspace-tool-color": color })} onClick={() => setShapeFillColor(color)} />)}
            <label className="workspace-v7-fill-custom"><span className="workspace-v2-visually-hidden">{t("focus.customFillColor")}</span><input type="color" value={shapeFillColor} onChange={(event) => setShapeFillColor(event.target.value)} /></label>
          </div>}
          <SettingsToggle icon={Minus} label={t("focus.dashedLine")} description={t("focus.drawBordersAndLinesAs")} checked={shapeDashed} onChange={setShapeDashed} />
          <SettingsToggle icon={Sparkles} label={t("focus.straightLinesShapes")} description={t("focus.straightenLinesAndCleanUp")} checked={drawAndHold} onChange={setDrawAndHold} />
          <SettingsToggle icon={Hash} label={t("focus.snapToGrid")} description={t("focus.alignEndpointsToA25")} checked={shapeSnapGrid} onChange={setShapeSnapGrid} />
          <SettingsToggle icon={Ruler} label={t("focus.straightenLine")} description={t("focus.snapLineAndArrowAngles")} checked={shapeAngle > 0} onChange={(enabled) => setShapeAngle(enabled ? 15 : 0)} />
          {shapeAngle > 0 && <label className="workspace-v7-select-row">{t("focus.angleSteps")} <select value={shapeAngle} onChange={(event) => setShapeAngle(Number(event.target.value))}><option value="15">15°</option><option value="30">30°</option><option value="45">45°</option><option value="90">90°</option></select></label>}
        </section>}
    
        {activeTool === "pen" && <section className="workspace-v5-inspector-section workspace-v7-rows workspace-v4-pen-gestures" aria-label={t("focus.penGestures")}><SettingsToggle icon={Shapes} label={t("focus.straightLinesShapes")} description={t("focus.refineLinesAndShapesWhen")} checked={drawAndHold} onChange={setDrawAndHold} /><SettingsToggle icon={Circle} label={t("focus.circleErase")} description={t("focus.circleMarksAndHoldTo")} checked={circleToErase} onChange={setCircleToErase} /></section>}
      </div>
    </div>}
  </>;
}
