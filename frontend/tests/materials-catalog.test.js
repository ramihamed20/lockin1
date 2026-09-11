import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { COHORT_CATALOGS, getCatalogMaterial, getCatalogSheet, getCohortMaterials, getCohortQuestionCategories, getLastOpenedCatalogSheet, getRecentOpenedCatalogSheets, rememberLastOpenedCatalogSheet } from "../src/lib/materialCatalog.js";
import { canAccessRoute } from "../src/lib/authz.js";

const humanMedicine60 = { cohort: { code: "60", program: { code: "human-medicine" } } };
const dentistryTripoli = { cohort: { code: "year-2", program: { code: "dentistry-tripoli" } } };

test("Human Medicine 60 studies its own four subjects", () => {
  assert.deepEqual(getCohortMaterials(humanMedicine60).map((material) => material.title), [
    "Anatomy 1",
    "Physiology 1",
    "Histology 1",
    "Biochemistry 1"
  ]);
  assert.equal(getCatalogMaterial("human-medicine-60-anatomy-1")?.title, "Anatomy 1");
  const student = { id: "student", roles: ["student"] };
  assert.equal(canAccessRoute(student, "/materials/catalog/human-medicine-60-anatomy-1"), true);
});

test("Dentistry cohorts keep their own subjects and never see another intake's", () => {
  assert.deepEqual(getCohortMaterials(dentistryTripoli).map((material) => material.slug), [
    "dentistry-tripoli-year-2-conservative",
    "dentistry-tripoli-year-2-microbiology",
    "dentistry-tripoli-year-2-pharmacy",
    "dentistry-tripoli-year-2-general-pathology",
    "dentistry-tripoli-year-2-oral-histology",
    "dentistry-tripoli-year-2-fixed-prosthodontic",
    "dentistry-tripoli-year-2-removable-prosthodontic"
  ]);
  assert.deepEqual(getCohortMaterials({ cohort: { code: "61", program: { code: "human-medicine" } } }).map((material) => material.title), [
    "Intro Histology", "Intro Anatomy", "English", "IT"
  ]);
  assert.deepEqual(getCohortMaterials(null), []);
});

test("every requested Catalog branch is configured and founders can browse all of them", () => {
  const firstYear = ["Dental Anatomy", "Dental Material", "General Histology", "General Anatomy", "Physiology", "Biochemistry"];
  const secondYear = ["Conservative", "Microbiology", "Pharmacy", "General Pathology", "Oral Histology", "Fixed Prosthodontic", "Removable Prosthodontic"];
  for (const college of ["tripoli", "benghazi", "zawiya"]) {
    assert.deepEqual(
      getCohortMaterials({ cohort: { code: "year-1", program: { code: `dentistry-${college}` } } }).map((item) => item.title),
      firstYear
    );
    assert.deepEqual(
      getCohortMaterials({ cohort: { code: "year-2", program: { code: `dentistry-${college}` } } }).map((item) => item.title),
      secondYear
    );
  }
  const founder = { roles: ["administrator"], cohort: { code: "60", program: { code: "human-medicine" } } };
  assert.equal(getCohortMaterials(founder).length, 47);
  assert.ok(getCohortMaterials(founder).some((item) => item.slug === "dentistry-zawiya-year-2-removable-prosthodontic"));
});

test("the Catalog is the only exposed materials management route", async () => {
  const [app, apiUrls, educationAdmin] = await Promise.all([
    readFile(new URL("../src/App.jsx", import.meta.url), "utf8"),
    readFile(new URL("../../backend/platform_core/api/urls.py", import.meta.url), "utf8"),
    readFile(new URL("../../backend/apps/education/admin.py", import.meta.url), "utf8")
  ]);
  assert.match(app, /<Route path="\/creator\/\*" element=\{<Navigate to="\/operations\/admin\/content" replace \/>\} \/>/);
  assert.doesNotMatch(app, /CreatorEducation|CreatorContent|CreatorQuestions|CreatorQuizzes/);
  assert.doesNotMatch(apiUrls, /apps\.education\.urls/);
  assert.doesNotMatch(educationAdmin, /EducationNodeAdmin|CreatorScopeAdmin|content_nodes/);
});

test("Catalog subjects start empty until their own Content Panel branch publishes a sheet", () => {
  assert.equal(getCatalogMaterial("human-medicine-60-biochemistry-1")?.sheets.length, 0);
  assert.ok(COHORT_CATALOGS.flatMap((catalog) => catalog.materials).every((material) => material.sheets.length === 0));
  assert.equal(getCatalogSheet("microbiology", "sheet-1").sheet, null);
  assert.equal(getCatalogSheet("human-medicine-60-anatomy-1", "sheet-1").sheet, null);
});

test("Active Study stays closed until a sheet has questions, and Quizzes is not offered", async () => {
  // Every published sheet opens in Normal Study: hasActiveStudy is the opt-in,
  // and no sheet sets it yet.
  assert.ok(COHORT_CATALOGS.every((catalog) => catalog.materials.every((material) => material.sheets.every((sheet) => !sheet.hasActiveStudy))));
  const workspace = await readFile(new URL("../src/pages/CatalogFocusWorkspace.jsx", import.meta.url), "utf8");
  assert.match(workspace, /activeAvailable=\{Boolean\(sheet\.hasActiveStudy\)\}/);
  assert.match(workspace, /if \(activeStudyBusy \|\| !sheet\?\.hasActiveStudy\) return;/);
  assert.match(workspace, /"Questions not ready yet"/);
  assert.doesNotMatch(workspace, /isTestSheet/);

  assert.ok(COHORT_CATALOGS.every((catalog) => !catalog.questionCategories.includes("quizzes")));
  assert.deepEqual(getCohortQuestionCategories(humanMedicine60), ["practice", "years", "ai-sheet", "mix"]);
});

test("Catalog sheet prioritizes Focus Workspace and keeps only the page count", async () => {
  const [app, materials, catalogue] = await Promise.all([
    readFile(new URL("../src/App.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/Materials.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/i18n.js", import.meta.url), "utf8")
  ]);
  assert.match(app, /path="\/materials\/catalog\/:materialSlug"/);
  assert.match(app, /path="\/materials\/catalog\/:materialSlug\/sheets\/:sheetSlug"/);
  assert.match(materials, /t\("materials\.openWorkspace"\)/);
  assert.match(catalogue, /"materials\.openWorkspace": "Open Focus Workspace"/);
  assert.match(materials, /CatalogSheetCard/);
  assert.match(materials, /t\("materials\.lockInMode"\)/);
  assert.match(catalogue, /"materials\.lockInMode": "Lock In Mode"/);
  assert.match(materials, /t\("common\.soon"\)/);
  assert.match(catalogue, /"common\.soon": "Soon"/);
  assert.match(materials, /t\("materials\.pageCount", \{ count: sheet\.pageCount \}\)/);
  assert.match(catalogue, /"materials\.pageCount\.other": "\{count\} pages"/);
  assert.doesNotMatch(materials, /Sheet source|fileName.*attached|File-based actions/);
  assert.doesNotMatch(materials, /disabled aria-describedby="catalog-sheet-file-status"/);
  assert.match(materials, /sheets\/\$\{sheet\.slug\}\/workspace/);
  assert.match(materials, /returnTo: location\.pathname/);
  assert.match(materials, /rememberLastOpenedCatalogSheet\(materialSlug, sheetSlug\)/);
});

test("opened-sheet history ignores sheets that were not published by the Catalog", () => {
  const previousStorage = globalThis.localStorage;
  const data = new Map();
  globalThis.localStorage = {
    getItem: (key) => data.get(key) || null,
    setItem: (key, value) => data.set(key, value)
  };

  try {
    assert.equal(getLastOpenedCatalogSheet(), null);
    assert.deepEqual(getRecentOpenedCatalogSheets(), []);

    // A sheet that is not in the catalogue is never remembered, so Continue
    // study cannot offer a link that resolves to nothing.
    rememberLastOpenedCatalogSheet("microbiology", "sheet-1");
    assert.equal(data.get("lock-in.materials.recent-opened-sheets"), undefined);

    rememberLastOpenedCatalogSheet("human-medicine-60-biochemistry-1", "vitamin-1");
    assert.deepEqual(getRecentOpenedCatalogSheets(), []);
    assert.equal(getLastOpenedCatalogSheet(), null);

    // Entries left over from an earlier catalogue are dropped on read.
    data.set("lock-in.materials.recent-opened-sheets", JSON.stringify([
      { materialSlug: "conservative", sheetSlug: "sheet-2" },
      { materialSlug: null, sheetSlug: "sheet-1" },
      { materialSlug: "human-medicine-60-biochemistry-1", sheetSlug: "vitamin-2" }
    ]));
    assert.deepEqual(getRecentOpenedCatalogSheets(), []);
  } finally {
    globalThis.localStorage = previousStorage;
  }
});

test("Catalog Focus Workspace uses a compact contextual toolbar and persistent catalog bookmarks", async () => {
  const [app, layout, workspace, styles, continuousPdf, eraserSession] = await Promise.all([
    readFile(new URL("../src/App.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/layout/index.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/CatalogFocusWorkspace.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/catalog-focus-workspace.css", import.meta.url), "utf8"),
    readFile(new URL("../src/workspace/catalog/ContinuousA4Pdf.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/workspace/ink/eraserSession.js", import.meta.url), "utf8")
  ]);
  assert.match(app, /path="\/materials\/catalog\/:materialSlug\/sheets\/:sheetSlug\/workspace"/);
  assert.match(layout, /location\.pathname\.endsWith\("\/workspace"\)/);
  assert.match(workspace, /focusApi\.updateLockInNote/);
  assert.match(workspace, /progressApi\.getCatalogBookmark/);
  assert.match(workspace, /progressApi\.createCatalogBookmark/);
  assert.match(workspace, /progressApi\.removeCatalogBookmark/);
  assert.match(workspace, /beginAnnotation/);
  assert.match(workspace, /beginPan/);
  assert.match(workspace, /WorkspaceAnnotation/);
  assert.match(workspace, /requestFullscreen/);
  assert.match(workspace, /ref=\{readerRef\}/);
  assert.match(workspace, /CONFIGURABLE_TOOLS\.has\(nextTool\)/);
  assert.match(workspace, /current === `tool:\$\{nextTool\}` \? null : `tool:\$\{nextTool\}`/);
  assert.match(workspace, /workspace-v2-tool-options/);
  assert.match(workspace, /workspace-v2-settings-popover/);
  assert.doesNotMatch(workspace, /workspace-v2-header|workspace-v2-tool-inspector|workspace-v2-mobile-panel/);
  assert.match(workspace, /ContinuousA4Pdf/);
  assert.match(workspace, /fitWidthZoom\(\s*stage\?\.clientWidth \|\| window\.innerWidth,\s*A4_PAGE_WIDTH,\s*0/);
  assert.doesNotMatch(workspace, /fitPageZoom/);
  assert.doesNotMatch(workspace, /Open original PDF in a new tab/);
  assert.match(workspace, /jumpToPage/);
  assert.match(workspace, /is-live-pinching/);
  assert.match(workspace, /requestAnimationFrame\(\(\) => applyLivePinchFrame/);
  assert.match(workspace, /INTERACTION_STATE\.SETTLING/);
  assert.match(workspace, /const finalZoom = pinch\.currentScale/);
  assert.match(workspace, /continuousPinchScale/);
  assert.match(workspace, /documentAnchorFromClient/);
  assert.match(workspace, /scrollForDocumentAnchor/);
  assert.doesNotMatch(workspace, /softenedZoomRatio|interpolateZoom|nearestZoom|snapZoom|zoomLevels/);
  assert.doesNotMatch(workspace, /startZoomSettle|projectedScaleTarget|estimateReleaseScaleVelocity/);
  assert.match(workspace, /setZoom\(finalZoom\)/);
  assert.match(workspace, /addEventListener\("wheel", handleNativeWheel, \{ passive: false \}\)/);
  assert.doesNotMatch(workspace, /aria-label="Zoom mode"|>View<|Distraction-free mode|workspace-v2-focus-exit/);
  assert.match(workspace, /function ToolRange/);
  assert.match(workspace, /<ToolRange label=\{activeTool === "shapes" \? "Border width" : "Thickness"\}/);
  assert.match(workspace, /<ToolRange\s+label="Opacity"/);
  assert.match(workspace, /input type="range"/);
  assert.match(workspace, /function IconChoiceGroup/);
  assert.match(workspace, /PEN_PROFILE_OPTIONS.*PenLine/s);
  assert.match(workspace, /SHAPE_OPTIONS.*Triangle/s);
  assert.match(workspace, /label="Apple Pencil mode"/);
  assert.doesNotMatch(workspace, /workspace-v2-pen-toggle|workspace-v2-smart-ink-settings|ToolStepper/);
  assert.match(workspace, /DRAWING_TOOLS\.has\(activeTool\) \? " is-touch-drawing"/);
  assert.match(workspace, /drawingScrollLockRef/);
  assert.match(workspace, /function commitInterruptedLiveStroke/);
  assert.match(workspace, /notesRef\.current/);
  assert.match(workspace, /first\.page - second\.page/);
  assert.match(workspace, /function openNote/);
  assert.match(workspace, /function openHighlight/);
  assert.match(workspace, /jumpToPagePosition\(highlight\.page/);
  assert.match(workspace, /Save to page \$\{page\}/);
  assert.doesNotMatch(workspace, /data-workspace-tool="text"|renderTextEditor|textEditor/);
  assert.match(workspace, /addSavedColor\(items, normalized, MAX_PALETTE_COLORS, COLORS\)/);
  assert.match(workspace, /removeSavedColor\(recentColors, normalized, MAX_PALETTE_COLORS, COLORS\)/);
  assert.match(workspace, /paletteColors\.length < MAX_PALETTE_COLORS/);
  assert.match(workspace, /label="Remember last position"/);
  assert.match(workspace, /label="Remember zoom level"/);
  assert.match(workspace, />Fit Width</);
  assert.match(workspace, /label="Show page number"/);
  assert.match(workspace, /navigator\.wakeLock\.request\("screen"\)/);
  assert.doesNotMatch(workspace, /MoreHorizontal|Open workspace panel/);
  assert.match(workspace, /Normal Study/);
  assert.match(workspace, /Active Study/);
  assert.match(workspace, /ACTIVE_DIFFICULTIES/);
  assert.match(workspace, /focusApi\.startActiveStudy/);
  assert.match(workspace, /focusApi\.submitActiveStudyQuiz/);
  assert.match(workspace, /score >= 7|Next pages unlocked/);
  assert.match(workspace, /Checkpoint · 10/);
  assert.match(workspace, /Final test · 50/);
  assert.match(continuousPdf, /visiblePageCount/);
  assert.match(continuousPdf, /A4_PAGE_RATIO = 297 \/ 210/);
  assert.match(continuousPdf, /window\.IntersectionObserver/);
  assert.match(continuousPdf, /className="workspace-v2-a4-zoom-surface"/);
  assert.match(continuousPdf, /Math\.max\(scaledDocumentWidth, stageViewport\.width\)/);
  assert.match(continuousPdf, /Math\.max\(0, \(stageViewport\.width - scaledDocumentWidth\) \/ 2\)/);
  assert.doesNotMatch(continuousPdf, /A4_PAGE_WIDTH \* zoom \+ stageViewport\.width|stageViewport\.width \/ 2/);
  assert.match(continuousPdf, /baseDocumentHeight \* zoom \+ stageViewport\.height/);
  assert.match(continuousPdf, /className="workspace-v2-a4-live-layer"/);
  assert.match(continuousPdf, /transform: `scale\(\$\{zoom\}\)`/);
  assert.doesNotMatch(continuousPdf, /translateX\(-50%\)/);
  assert.match(continuousPdf, /width: `\$\{A4_PAGE_WIDTH\}px`,\s*height: `\$\{A4_PAGE_WIDTH \* \(pageAspectRatios/);
  assert.doesNotMatch(continuousPdf, /width: `\$\{A4_PAGE_WIDTH \* zoom\}px`,\s*height: `\$\{A4_PAGE_WIDTH \* \(pageAspectRatios/);
  assert.match(continuousPdf, /MAX_A4_CANVAS_PIXELS = WORKSPACE_RENDER\.maximumCatalogCanvasPixels/);
  assert.match(continuousPdf, /catalogCanvasPixelBudget\(window\.visualViewport\?\.width \|\| window\.innerWidth/);
  assert.match(continuousPdf, /workspace:livezoomstart/);
  assert.match(continuousPdf, /renderControllerRef/);
  assert.match(continuousPdf, /controller\.generation \+= 1/);
  assert.match(continuousPdf, /pdfRenderGenerationIsCurrent\(renderController, renderGeneration, isCancelled\(\)\)/);
  assert.match(continuousPdf, /setRenderScale\(zoom\)/);
  assert.match(continuousPdf, /renderTask\?\.cancel\(\)/);
  assert.match(continuousPdf, /renderTask\.onContinue = \(continueRendering\) =>/);
  assert.match(continuousPdf, /frameId = requestAnimationFrame\(resume\)/);
  assert.match(continuousPdf, /canvasRefs = useRef\(\[null, null\]\)/);
  assert.match(continuousPdf, /nextCanvas\.classList\.add\("is-visible"\)/);
  assert.match(continuousPdf, /previousCanvas\.classList\.remove\("is-visible"\)/);
  assert.match(continuousPdf, /retiredCanvasRafRef\.current = requestAnimationFrame/);
  assert.match(continuousPdf, /previousCanvas\.width = 0/);
  assert.match(continuousPdf, /abandonedCanvas\.width = 0/);
  assert.match(continuousPdf, /key=\{pageNumber\}/);
  assert.doesNotMatch(continuousPdf, /key=\{[^}\n]*zoom/);
  assert.match(continuousPdf, /PdfRenderQueue/);
  assert.match(continuousPdf, /SCROLL_SETTLE_MS/);
  assert.match(continuousPdf, /rootMargin: "160% 0px"/);
  assert.doesNotMatch(workspace, /button type="button" disabled aria-describedby="workspace-quick-actions-status"/);
  assert.match(styles, /inset: 0/);
  assert.match(styles, /height: var\(--app-viewport-height, 100dvh\)/);
  assert.match(continuousPdf, /window\.visualViewport/);
  assert.doesNotMatch(workspace, /--workspace-viewport-height/);
  assert.doesNotMatch(workspace, /--workspace-viewport-offset-top/);
  assert.doesNotMatch(workspace, /publishViewport/);
  assert.match(workspace, /data-workspace-tool=\{id\}/);
  assert.match(continuousPdf, /width=\{0\} height=\{0\}/);
  assert.doesNotMatch(continuousPdf, /setRenderSuspension\("scroll"/);
  assert.match(continuousPdf, /renderController\.scrolling = true/);
  assert.match(continuousPdf, /renderController\.scrolling[\s\S]*window\.setTimeout\(resume, 32\)/);
  assert.doesNotMatch(continuousPdf, /applyPreviewScale/);
  assert.match(styles, /safe-area-inset-bottom/);
  assert.match(styles, /workspace-v2-annotation-layer\.is-interactive/);
  assert.match(styles, /workspace-v2:fullscreen/);
  assert.match(styles, /workspace-v2-body\.has-side/);
  assert.match(styles, /workspace-v2-side\.is-open/);
  assert.match(styles, /workspace-v2-tool-options/);
  assert.doesNotMatch(styles, /workspace-v2-tool-inspector|workspace-v2-mobile-panel|workspace-v2-header/);
  assert.match(styles, /workspace-v2-a4-page/);
  assert.match(styles, /\.workspace-v2-document-stage \{[^}]*overflow: auto[^}]*touch-action: none/);
  assert.match(styles, /\.workspace-v2-a4-canvas\.is-visible \{ visibility: visible; opacity: 1; \}/);
  assert.match(styles, /\.workspace-v2-document-stage\.is-writing-locked \{ touch-action: none;/);
  assert.match(styles, /\.workspace-v2-annotation-layer\.is-touch-drawing \{ touch-action: none; \}/);
  assert.doesNotMatch(styles, /\.workspace-v2-annotation-layer path \{ mix-blend-mode: multiply;/);
  assert.match(styles, /data-annotation-type="pen"\] \{ mix-blend-mode: normal;/);
  assert.match(styles, /data-annotation-type="highlighter"\] \{ mix-blend-mode: multiply;/);
  assert.match(workspace, /function preserveWorkspaceTouch/);
  assert.match(workspace, /activeTool === "hand" \|\| !canTouchDraw/);
  assert.match(workspace, /beginPan\(event, GESTURE_DIRECTION\.PENDING\)/);
  assert.match(workspace, /classifyGestureDirection\(event\.clientX - pan\.x, event\.clientY - pan\.y/);
  assert.match(workspace, /allowFreePan: true/);
  assert.match(workspace, /movesHorizontally/);
  assert.match(workspace, /movesVertically/);
  assert.match(workspace, /INTERACTION_STATE\.VERTICAL_SCROLL/);
  assert.match(workspace, /INTERACTION_STATE\.HORIZONTAL_PAN/);
  assert.match(workspace, /INTERACTION_STATE\.FREE_PAN/);
  assert.match(workspace, /lockedGestureDelta\(pan\.direction/);
  assert.match(workspace, /lockedGestureVelocity\(completedPan\.direction/);
  assert.match(workspace, /gesture\.mode === INTERACTION_STATE\.PINCHING && gesture\.pinch\?\.active/);
  assert.match(workspace, /ERASER_MODE\.PRECISION/);
  assert.match(workspace, /createEraserSession/);
  assert.match(eraserSession, /eraseStrokeWithPolyline/);
  assert.match(eraserSession, /type: "replace"/);
  assert.match(workspace, /predictedStrokePoints/);
  assert.match(workspace, /stage\.scrollLeft = left\.legal/);
  assert.match(workspace, /stage\.scrollTop = top\.legal/);
  assert.match(workspace, /INTERACTION_STATE\.FREE_PAN\]\.includes\(gesture\.mode\)/);
  // Wheel and trackpad deltas both reach the reader, but only inside the same
  // bounds the touch pipeline uses, so a horizontal delta is inert at fit width.
  assert.match(workspace, /const horizontalDelta = \(shiftPansHorizontally \? event\.deltaY : event\.deltaX\) \* multiplier/);
  assert.match(workspace, /const verticalDelta = \(shiftPansHorizontally \? 0 : event\.deltaY\) \* multiplier/);
  assert.match(workspace, /if \(horizontalDelta\) stage\.scrollLeft = Math\.min\(bounds\.maxScrollLeft, Math\.max\(bounds\.minScrollLeft/);
  assert.match(workspace, /if \(verticalDelta\) stage\.scrollTop = Math\.min\(bounds\.maxScrollTop, Math\.max\(bounds\.minScrollTop/);
  assert.match(workspace, /if \(system\.pan\.active\) \{[\s\S]*root\.classList\.add\("is-live-panning"\)/);
  assert.match(workspace, /else \{[\s\S]*root\.classList\.remove\("is-live-panning"\);[\s\S]*root\.style\.transform = ""/);
  assert.match(workspace, /stage\.addEventListener\("touchmove", preserveWorkspaceTouch, \{ passive: false \}\)/);
  assert.match(workspace, /stage\.addEventListener\("touchend", resetEndedTouchSession/);
  assert.match(workspace, /stage\.addEventListener\("touchcancel", resetEndedTouchSession/);
  assert.match(styles, /@media \(max-width: 560px\)/);
  // The tool rail stays on one line at every width and scrolls sideways rather
  // than wrapping, so the tools never change position and the reader keeps its
  // height. The reader row still measures the toolbar instead of assuming one,
  // and the surfaces below it follow that measurement.
  assert.match(styles, /\.workspace-v2-reader \{[^}]*grid-template-rows: auto minmax\(0, 1fr\)/);
  assert.match(styles, /\.workspace-v2-toolbar \{[^}]*min-height: calc\(52px \+ env\(safe-area-inset-top\)\)/);
  assert.match(styles, /\.workspace-v2-tool-options \{[^}]*var\(--workspace-toolbar-height/);
  assert.doesNotMatch(styles, /display: contents/);
  assert.match(styles, /\.workspace-v2-toolbar-scroll \{[^}]*flex-wrap: nowrap/);
  assert.match(styles, /\.workspace-v2-toolbar-scroll \{[^}]*scroll-behavior: smooth/);
  assert.match(styles, /\.workspace-v2-tool-list, \.workspace-v2-colors, \.workspace-v2-history, \.workspace-v2-tool-settings \{[^}]*flex-wrap: nowrap/);
  assert.match(styles, /\.workspace-v2-toolbar-scroll \{[^}]*overflow-x: auto/);
  // The rail publishes how much track is hidden on each side so the fade is
  // correct in Arabic, and it brings a newly chosen tool back into view.
  assert.match(workspace, /rail\.style\.setProperty\("--workspace-fade-left"/);
  assert.match(workspace, /rail\.scrollBy\(\{ left: delta/);
  assert.match(styles, /\.workspace-v2-tool-options \{[^}]*position: absolute/);
  assert.match(styles, /@media \(max-width: 1199px\) \{[\s\S]*width: min\(340px/);
  assert.doesNotMatch(styles, /min-height: 100svh/);
});
