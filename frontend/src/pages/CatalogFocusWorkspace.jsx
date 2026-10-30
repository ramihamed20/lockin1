import { currentAppLocale } from "../lib/i18n.js";
import { localSaveError } from "../lib/userErrors.js";
import { StudyDock } from "../components/lock-in/StudyDock.jsx";
import { SheetTranslationPanel } from "../workspace/catalog/SheetTranslationPanel.jsx";
import { lazy, Suspense, startTransition, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  Brain,
  CheckCircle2,


  Copy,
  Hash,

  MessageSquare,
  MoreHorizontal,

  Plus,
  Redo2,
  RotateCcw,
  RotateCw,
  Scissors,


  Trash2,
  Sparkles,
  Undo2,
  X,
  Zap,
  Type,
  ClipboardPaste,
  Download,
  Lock,
  Unlock,
  FileText,
  Share2,
  Group,
  Ungroup,
  CopyPlus,
  BringToFront,
  SendToBack,

  ExternalLink,
  Loader2,
  AlertTriangle,
  Users,
  Network,
  Lightbulb,


} from "lucide-react";
import { focusApi } from "../api/focus.js";
import { progressApi } from "../api/progress.js";
import { generateIdempotencyKey } from "../api/pagination.js";
import { rememberLastOpenedCatalogSheet, resolveSheetEdition, withEditionPdfUrl } from "../lib/materialCatalog.js";
import { useCatalogMaterials } from "../hooks/useCatalogMaterials.js";
import { useCatalogDocument } from "../hooks/useCatalogDocument.js";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { PERSONAL_MATERIAL, personalSheetsApi, personalWorkspaceApi } from "../api/personalSheets.js";
import { marksStorageSlug, snapshotFromReader } from "../workspace/catalog/annotationShare.js";
import { useMarksSet } from "../workspace/catalog/useMarksSet.js";
import { noteCardHeight, NOTE_CARD_WIDTH } from "../workspace/catalog/noteCardLayout.js";
import { AnnotationSharePanel } from "../workspace/catalog/AnnotationSharePanel.jsx";
import { usePlannedSourceNavigation } from "../workspace/knowledge/usePlannedSourceNavigation.js";
import StartRescue from "../rescue/StartRescue.jsx";
import { RESCUE_ENABLED } from "../rescue/model.js";
import { KNOWLEDGE_FIXTURE_TOOLS, STUDY_TOOLS_ENABLED, COMING_SOON_STUDY_TOOLS, availableStudyTools } from "../workspace/knowledge/model.js";
import { useMcqExplainLinks } from "../workspace/knowledge/useMcqExplainLinks.js";
import { createKnowledgeStore } from "../workspace/knowledge/storage.js";
import { knowledgeApi } from "../api/knowledge.js";
const KnowledgeWorkspace = lazy(() => import("../workspace/knowledge/KnowledgeWorkspace.jsx"));
import { MySummaryDialog, SummaryReceiveCard, SummaryTextPanel } from "../workspace/summary/MySummary.jsx";
import { useSheetSummaries } from "../workspace/summary/useSheetSummaries.js";
import { sheetSummariesApi } from "../api/sheetSummaries.js";
import { buildSummaryPdf, SUMMARY_COLORS } from "../workspace/summary/summaryPdf.js";
import { useReadingSession } from "../hooks/useReadingSession.js";
import { subscribeConnection } from "../lib/connectionState.js";
import { createCatalogServerSync } from "../workspace/catalog/catalogServerSync.js";
import { SearchHighlights, SearchNavigator, useDocumentSearch } from "../workspace/catalog/DocumentSearchPanel.jsx";
import { coverRectangle, coveredSearchMatchIds, MAX_COVERS_PER_ACTION, searchCoverEntries } from "../workspace/catalog/recallCovers.js";
import { assetPath, cssVars } from "../lib/utils.js";
import { subscribeViewport } from "../lib/viewport.js";
import { usePageTitle } from "../hooks/usePageTitle.js";
import { useWorkspacePaneActive } from "../workspace/catalog/workspacePane.js";
import {
  centeredScrollLeft,
  continuousPinchScale,
  constrainPinchTranslation,
  documentAnchorFromClient,
  fitWidthZoom,
  livePinchTransform,
  midpoint,
  pagePointFromClient,
  pointerDistance,
  scrollForDocumentAnchor,
  visibleDocumentScrollBounds,
  zoomScrollForAnchor
} from "../workspace/document/coordinateTransforms.js";
import {
  addSpringImpulse,
  advanceSpring,
  elasticScrollPosition,
  elasticZoomScale,
  resistedDistance,
  unresistedDistance
} from "../workspace/input/elasticGesture.js";
import {
  DRAWING_INPUT,
  GESTURE_DIRECTION,
  INTERACTION_STATE,
  classifyGestureDirection,
  interactionStateForDirection,
  isTypingTarget,
  lockedGestureDelta,
  lockedGestureVelocity,
  pointerCanDraw,
  defaultDrawingInput,
  pointerSnapshot,
  suspiciousPalmContact
} from "../workspace/input/gestureStateMachine.js";
import {
  advanceMomentumFrame,
  appendRecentPointerSamples,
  estimateReleaseScrollVelocity,
  momentumConfig,
  momentumVelocityForIntent
} from "../workspace/input/scrollMomentum.js";
import {
  ERASER_MODE,
  PEN_PROFILE,
  PRESSURE_SOURCE,
  eraserSpaceScale,
  pageRadiusForScreenRadius,
  samplesFromPointerEvent,
  strokeEraseCoverage
} from "../workspace/ink/strokeModel.js";
import { createInkInputController } from "../workspace/ink/inkInputController.js";
import { createEraserSession } from "../workspace/ink/eraserSession.js";
import {
  analyzeClosedGesture,
  analyzeScribbleGesture,
  gestureBounds,
  recognizeHeldStroke,
  equalSidedEnd,
  recognizedShapeAnnotation,
  rectangleLassoPolygon,
  straightenedInkStroke
} from "../workspace/ink/inkGestureRecognition.js";
import {
  annotationBounds,
  annotationIntersectsPolygon,
  applyAnnotationCommand,
  catalogWorkspaceStorageKey,
  createAnnotationSpatialIndex,
  parseCatalogWorkspace,
  queryAnnotationSpatialIndexBounds,
  resizeAnnotation,
  rotateAnnotation,
  selectionBounds,
  serializeCatalogWorkspace,
  translateAnnotation,
  withCommandPositions
} from "../workspace/catalog/catalogWorkspaceState.js";
import { COPY_OFFSET, MOVE_THRESHOLD_PX, clampSelectionDelta, contextToolbarPosition, editableTarget, expandSelectionGroups, hitTestAnnotations, isDoubleTap, reorderSelection } from "../workspace/selection/selectionController.js";
import { A4_PAGE_WIDTH, ContinuousA4Pdf } from "../workspace/catalog/ContinuousA4Pdf.jsx";
import { WORKSPACE_PAGE_BACKGROUNDS, addSummaryPages, composeWorkspacePages, createVirtualPageId, insertVirtualPage, isVirtualPageKey, removeSummaryPages, removeVirtualPage, sanitizeVirtualPages } from "../workspace/catalog/virtualPages.js";
import { canvasesToPdf, renderWorkspacePage } from "../workspace/catalog/workspaceExport.js";
import { canShareFile, createExportHandle, exportFileNameFor, formatFileSize, isAppleTouchDevice, shareExportFile, triggerDownload } from "../workspace/catalog/exportDelivery.js";
import { loadPdfLibrary } from "../workspace/catalog/pdfJsAdapter.js";
import { PageThumbnails } from "../workspace/catalog/PageThumbnails.jsx";
import { activeStudyResumePage } from "../workspace/catalog/visiblePdfPages.js";
import WorkspaceTabBar from "../workspace/catalog/WorkspaceTabBar.jsx";
import {
  closeWorkspaceTab,
  createWhiteboardId,
  forgetPersonalTabs,
  isWhiteboardId,
  nextWhiteboardNumber,
  openWorkspaceTab,
  personalTab,
  personalTabId,
  sheetTab,
  sheetTabId,
  updateWorkspaceTab,
  useWorkspaceTabs,
  whiteboardTab,
  whiteboardTabId,
  workspaceTabRoute
} from "../workspace/catalog/workspaceTabs.js";
// Served as its own file: production CSP refuses a data: URL for the PDF reader.
import whiteboardPageUrl from "../workspace/catalog/whiteboard-lined-page.pdf?url&no-inline";
import { LiveAnnotationCanvas } from "../workspace/ink/LiveAnnotationCanvas.jsx";
import { TransientInkCanvas } from "../workspace/ink/TransientInkCanvas.jsx";
import { TRANSIENT_DEFAULT_COLOR, TRANSIENT_PEN_PROFILES, createTransientInk, currentPenProfile } from "../workspace/ink/transientInk.js";
import { createWorkspacePerformanceMonitor } from "../workspace/catalog/workspacePerformance.js";
import { addSavedColor, normalizeSavedPalette, normalizeToolColor, removeSavedColor } from "../workspace/catalog/toolPalette.js";
import { WORKSPACE_GESTURE, WORKSPACE_ZOOM } from "../workspace/config.js";
import { createAnnotationStore } from "../workspace/storage/annotationStore.js";
import {
  buildExportPayload,
  changedPages,
  createAnnotationRevisionIndex,
  exportFileName,
  groupAnnotationsByPage,
  mergeRestoredAnnotations,
  mergeRestoredNotes,
  ownerStorageKey,
  pageSignatures,
  parseImportPayload
} from "../workspace/storage/workspaceSnapshot.js";
import { EmptyState, ErrorPanel, LoadingPanel, Page } from "../components/ui/index.jsx";
import { useI18n } from "../components/I18nProvider.jsx";
import { formatDate } from "../lib/i18n.js";
import { savedStudyProgress } from "../components/shared/ActiveStudyCustomization.jsx";
import { PomodoroStudy } from "../components/shared/PomodoroStudy.jsx";
import { ActiveStudyExitDialog } from "../components/shared/CheckpointExitDialog.jsx";
import { acknowledgeFocusDocument, markFocusDocumentDirty, registerOpenFocusDocument } from "../offline/focusSync.js";
import { readActiveStudyRun } from "../offline/activeStudy.js";
import { ConfirmDialog } from "../components/shared/ConfirmDialog.jsx";
import { AUTOSAVE_IDLE_MS, COLORS, CONFIGURABLE_TOOLS, DRAWING_TOOLS, ERASER_MODES, FAVORITE_COLORS_KEY, FINGER_SCROLL_HINT_KEY, FIT_READING_WIDTH, HOLD_ENDPOINT_TOLERANCE_PX, HOLD_RECOGNITION_MS, MAX_FOCUS_ZOOM, MAX_PALETTE_COLORS, MIN_FOCUS_ZOOM, NO_ANNOTATIONS, PAGE_BACKGROUND_CHOICES, PAGE_COUNT, PAGE_SPACE, PAGE_WIDTH, PEN_PROFILE_OPTIONS, POPOVER_SURFACES, PRIMARY_WRITE_TOOLS, RECENT_COLORS_KEY, SERVER_SYNC_DELAY_MS, SPRING_DEADLINE_MS, STATUS_MESSAGE_MS, SWATCH_TOOLS, TOOL_ITEMS, TOOL_MEMORY_KEY, WORKSPACE_SETTINGS_KEY, ZOOM_OVERSHOOT_RATIO, ZOOM_SETTLE_MS, isStageControl, isUnfinished } from "./focus-workspace/constants.js";
import { StudyModeDialog } from "./focus-workspace/studyDialogs.jsx";
import { ACTIVE_RESULT_STAGES, clearActiveStudyDraft, clearActiveStudyEntry, clearActiveStudyResume, readActiveStudyDraft, readActiveStudyEntry, readActiveStudyResume, writeActiveStudyEntry, writeActiveStudyResume } from "./focus-workspace/activeStudyStorage.js";
import { ActiveStudyQuiz } from "./focus-workspace/ActiveStudyQuiz.jsx";
import { cloneAnnotation, copiedAnnotations, loadRecentColors, loadStoredWorkspace, loadStringList, loadToolMemory, loadWorkspaceSettings } from "./focus-workspace/preferences.js";
import { AnnotationVisuals, COVER_COLOR, DraftAnnotationLayer } from "./focus-workspace/annotationVisuals.jsx";
import { WorkspaceIconButton } from "./focus-workspace/controls.jsx";
import { useToolRail } from "./focus-workspace/useToolRail.js";
import { PageNavigator, ZoomBar } from "./focus-workspace/pageControls.jsx";
import { SettingsPopover } from "./focus-workspace/SettingsPopover.jsx";
import { ToolOptionsPanel } from "./focus-workspace/ToolOptionsPanel.jsx";
import { AddMenu, CardEditor, ExportMenu, MoreMenu, PageBackgroundMenu, SearchMenu, StudyMenu, TextEditor } from "./focus-workspace/menus.jsx";
import { FavoritePens } from "./focus-workspace/FavoritePens.jsx";
import { FAVORITE_PEN_TOOLS, loadFavoritePens, matchingFavoritePen, normalizeFavoritePen, normalizeFavoritePens, saveFavoritePens } from "./focus-workspace/favoritePens.js";
import { ZoomWindow } from "./focus-workspace/ZoomWindow.jsx";
import { initialZoomRegion } from "./focus-workspace/zoomWindowModel.js";
import "./catalog-focus-workspace.css";
import "./focus-workspace-glass.css";
import "./focus-tool-panel-compact.css";
import "./focus-phone.css";

/**
 * The workspace mounts a large annotation and PDF stack, so the sheet is
 * resolved before it renders rather than through an early return inside it.
 */
/**
 * The one catalog reader.
 *
 * `variant` picks which of the sheet's PDFs it opens -- the edition's study
 * PDF, or that edition's Sheet Summary. Controls, theme, zoom, navigation and
 * file delivery are the same either way, because they are the same reader.
 * A whiteboard is the same reader too, over one lined page plus added pages.
 */
export default function CatalogFocusWorkspace({ user = null, variant = "study" }) {
  if (variant === "whiteboard") return <WhiteboardWorkspace user={user} />;
  if (variant === "personal") return <PersonalSheetWorkspace user={user} />;
  return <CatalogSheetWorkspace user={user} variant={variant} />;
}

const PERSONAL_SCOPE = Object.freeze({ edition: "university", view: "study" });

/**
 * A PDF the student added to one of their subjects. It opens in the same
 * reader, without Active Study or reading credit. Its marks and reader state
 * sync to the student's other devices under the sheet's own id.
 */
function PersonalSheetWorkspace({ user = null }) {
  const { materialSlug = "", sheetId = "" } = useParams();
  const { t } = useI18n();
  const [missing, setMissing] = useState(false);
  const { data, loading, error, reload } = useAsyncData((signal) => personalSheetsApi.get(sheetId, { signal }).then(
    (result) => { setMissing(false); return result; },
    (failure) => { if (failure?.status === 404) setMissing(true); throw failure; }
  ), [sheetId]);
  const sheet = data?.sheet || null;
  const subjectSlug = data?.subject?.slug || materialSlug;
  const { materials: catalogMaterials } = useCatalogMaterials(user);
  const ownerKey = useMemo(() => ownerStorageKey(user), [user]);
  // A sheet that is gone (deleted on another device) leaves no dead tab behind.
  useEffect(() => {
    if (missing) forgetPersonalTabs(ownerKey, [sheetId]);
  }, [missing, ownerKey, sheetId]);
  const materials = useMemo(() => (sheet ? [{
    slug: PERSONAL_MATERIAL,
    title: data?.subject?.title || t("personalSheets.title"),
    sheets: [{ slug: sheet.id, title: sheet.title, pdfUrl: sheet.viewUrl, pageCount: sheet.pageCount || 1, hasActiveStudy: false }]
  }] : []), [data?.subject?.title, sheet, t]);
  const syncedDocument = useMemo(() => (sheet ? { id: sheet.id, versionId: sheet.id, viewUrl: sheet.viewUrl, checksum: "" } : null), [sheet]);
  const title = t("personalSheets.readerLabel");
  if (loading) return <Page title={title}><LoadingPanel variant="document" /></Page>;
  if (error || !sheet) return <Page title={title}><ErrorPanel message={error || t("personalSheets.notFound")} onRetry={reload} /></Page>;
  if (!sheet.viewUrl) {
    return <Page title={sheet.title}><ErrorPanel message={t(sheet.status === "processing" ? "personalSheets.processing" : "personalSheets.unavailable")} onRetry={reload} /></Page>;
  }
  return <CatalogFocusWorkspaceView key={sheet.id} user={user} materials={materials} materialSlug={PERSONAL_MATERIAL} tabMaterials={catalogMaterials} sheetSlug={sheet.id} catalogDocument={syncedDocument} documentScope={PERSONAL_SCOPE} personalBackTo={`/materials/catalog/${subjectSlug}/mine`} personalSubject={subjectSlug} preferredMode="normal" />;
}

const WHITEBOARD_MATERIAL = "whiteboard";

/**
 * The reader's own lined pages. The base page is a bundled one-page PDF and
 * every page after it is an added lined page, so ink, undo, export and page
 * handling are the sheet reader's own. A whiteboard has no server document
 * yet, so it is kept in this device's store.
 */
function WhiteboardWorkspace({ user = null }) {
  const { boardId = "" } = useParams();
  const { t } = useI18n();
  const ownerKey = useMemo(() => ownerStorageKey(user), [user]);
  const [tabs] = useWorkspaceTabs(ownerKey);
  const { materials } = useCatalogMaterials(user);
  const number = tabs.tabs.find((tab) => tab.id === whiteboardTabId(boardId))?.number || nextWhiteboardNumber(tabs.tabs);
  const title = t("workspaceTabs.whiteboardNumber", { number });
  const boardMaterials = useMemo(() => [{
    slug: WHITEBOARD_MATERIAL,
    title: t("workspaceTabs.whiteboard"),
    sheets: [{ slug: boardId, title, number, pdfUrl: whiteboardPageUrl, pageCount: 1, hasActiveStudy: false }]
  }], [boardId, t, title, number]);
  if (!isWhiteboardId(boardId)) return <Page title={t("materials.sheetNotFoundTitle")}><EmptyState icon="study" title={t("materials.sheetNotFoundTitle")} text={t("materials.sheetNotFoundText")} /></Page>;
  return <CatalogFocusWorkspaceView key={boardId} user={user} materials={boardMaterials} tabMaterials={materials} materialSlug={WHITEBOARD_MATERIAL} sheetSlug={boardId} whiteboard preferredMode="normal" />;
}

function CatalogSheetWorkspace({ user = null, variant = "study" }) {
  const { materialSlug, sheetSlug } = useParams();
  const location = useLocation();
  const { t } = useI18n();
  const { materials, loading: materialsLoading, error: materialsError, reload: reloadMaterials } = useCatalogMaterials(user);
  const material = materials.find((item) => item.slug === materialSlug) || null;
  // The address names one edition of the sheet; `view` carries that
  // edition's page count, summary and Active Study in the sheet's own shape.
  const { view: sheet, edition, missingEdition } = resolveSheetEdition(material, sheetSlug);
  // The server document behind the sheet: its protected PDF, and the ids its
  // reader state and annotations sync under. A fixture sheet that carries its
  // own pdfUrl opens without it and simply stays local.
  const summaryMode = variant === "summary";
  // A summary resolves through the same endpoint as the study PDF, so it is
  // delivered, cached and synced by the same code -- only the file differs.
  const catalogDocument = useCatalogDocument(
    sheet ? materialSlug : "",
    sheet ? sheetSlug : "",
    summaryMode ? "summary" : "",
    user?.id || ""
  );
  const viewUrl = catalogDocument.document?.viewUrl || "";
  // Switching marks remounts the reader; the person already chose a mode, so it
  // reopens in Normal Study instead of asking again.
  const [marksSwitched, setMarksSwitched] = useState(false);
  const marks = useMarksSet({
    owner: ownerStorageKey(user),
    documentId: catalogDocument.document?.id || "",
    materialSlug,
    sheetSlug,
    enabled: !summaryMode
  });
  const resolvedMaterials = useMemo(() => (viewUrl && sheet && !sheet.pdfUrl
    ? withEditionPdfUrl(materials, {
      materialSlug,
      slug: sheetSlug,
      pdfUrl: viewUrl,
      pageCount: summaryMode ? edition?.summaryPdf?.pageCount : undefined,
      hasActiveStudy: summaryMode ? false : undefined
    })
    : materials), [edition, materialSlug, materials, sheet, sheetSlug, summaryMode, viewUrl]);
  const documentScope = useMemo(
    () => ({ edition: edition?.edition || "university", view: summaryMode ? "summary" : "study" }),
    [edition, summaryMode]
  );
  const title = summaryMode ? t("materials.sheetSummary") : t("materials.coreCatalogTitle");
  if (materialsLoading) return <Page title={title}><LoadingPanel variant="document" /></Page>;
  if (materialsError) return <Page title={t("materials.sheetNotFoundTitle")}><ErrorPanel message={materialsError} onRetry={reloadMaterials} /></Page>;
  if (!material || !sheet) {
    // A named-but-unpublished edition says so, rather than being reported as a
    // missing sheet or quietly opening the edition that does exist.
    if (missingEdition) return <Page title={t("materials.sheetNotFoundTitle")}><ErrorPanel message={t("materials.editionUnavailable")} /></Page>;
    return <Page title={t("materials.sheetNotFoundTitle")}><EmptyState icon="study" title={t("materials.noSheetsTitle")} text={t("materials.noSheetsText")} /></Page>;
  }
  // The workspace sizes itself from the PDF when it first mounts, so it waits
  // for the document rather than mounting without one.
  if (!sheet.pdfUrl && catalogDocument.loading) return <Page title={title}><LoadingPanel /></Page>;
  if (marks.status === "loading") return <Page title={title}><LoadingPanel variant="document" /></Page>;
  if (!sheet.pdfUrl && !catalogDocument.document) {
    if (summaryMode) {
      return <Page title={title}><ErrorPanel message={t(sheet.summaryStatus === "processing" ? "materials.summaryProcessing" : "materials.summaryUnavailable")} onRetry={catalogDocument.reload} /></Page>;
    }
    return <Page title={sheet.title}><ErrorPanel message={catalogDocument.error || t("materials.sheetNotFoundText")} onRetry={catalogDocument.reload} /></Page>;
  }
  // Last guard before the reader: a catalog sheet without its own PDF must
  // never reach the view, whose no-PDF branch renders a placeholder document.
  const readable = resolveSheetEdition(
    resolvedMaterials.find((item) => item.slug === materialSlug) || null,
    sheetSlug
  ).view;
  if (!readable?.pdfUrl) {
    return <Page title={sheet.title}><ErrorPanel message={t("materials.editionUnavailable")} onRetry={summaryMode ? undefined : catalogDocument.reload} /></Page>;
  }
  const preferredMode = marksSwitched
    ? "normal"
    : location.state?.studyMode === "normal" || location.state?.studyMode === "active" ? location.state.studyMode : "";
  const selectMarks = (marksId) => { setMarksSwitched(true); marks.select(marksId); };
  // Each document is its own reader: moving between tabs never carries one
  // sheet's study mode, Active Study run or tool state into another.
  return <CatalogFocusWorkspaceView key={`${materialSlug}/${sheetSlug}/${documentScope.view}/${catalogDocument.document?.versionId || "fixture"}/${marks.marksSet?.id || "own"}`} marksSet={marks.marksSet} onSelectMarks={selectMarks} user={user} materials={resolvedMaterials} catalogDocument={catalogDocument.document} documentScope={documentScope} onDocumentChanged={catalogDocument.reload} summaryMode={summaryMode} preferredMode={preferredMode} />;
}

function CatalogFocusWorkspaceView({ user = null, materials = [], tabMaterials = materials, materialSlug: materialSlugProp = "", sheetSlug: sheetSlugProp = "", whiteboard = false, personalBackTo = "", personalSubject = "", catalogDocument = null, documentScope = null, onDocumentChanged = () => {}, summaryMode = false, preferredMode = "", marksSet = null, onSelectMarks = /** @type {(marksId: string) => void} */ (() => {}) }) {
  // A student's own sheet: no Active Study and no reading credit.
  const personal = Boolean(personalBackTo);
  // A catalog sheet shares under its own document; a copy of someone's marks
  // shares under the catalog document it was copied from.
  const shareDocumentId = whiteboard || summaryMode || personal ? "" : (catalogDocument?.id || "");
  const [translationOpen, setTranslationOpen] = useState(false);
  const [knowledgeOpen, setKnowledgeOpen] = useState(false);
  const [knowledgeVisited, setKnowledgeVisited] = useState(false);
  const [knowledgeSaveStatus, setKnowledgeSaveStatus] = useState("");
  const [knowledgeNavigation, setKnowledgeNavigation] = useState(null);
  // The Study launcher lists only the tools the server enables for this source;
  // the flags come from the same cached bootstrap the knowledge panel reads.
  const [studyToolFlags, setStudyToolFlags] = useState(/** @type {{documentId: string, tools: Record<string, boolean>} | null} */ (null));
  const { t } = useI18n();
  // False while this reader is a tab kept open behind the one on screen.
  const paneActive = useWorkspacePaneActive();
  // Effects that report status read the current language through a ref, so a
  // language change never re-runs them (their dependencies stay as they were).
  const translateRef = useRef(t);
  translateRef.current = t;
  const params = useParams();
  const materialSlug = materialSlugProp || params.materialSlug || "";
  const sheetSlug = sheetSlugProp || params.sheetSlug || "";
  // A Sheet Summary is a different document from the sheet it belongs to, and
  // the local cache is keyed by slug, so it needs a key of its own or the two
  // sets of marks would be cached over each other on this device.
  // A copy of another student's marks is stored apart from the student's own.
  const storageSlug = summaryMode ? `${sheetSlug}--summary` : marksStorageSlug(sheetSlug, marksSet?.id);
  // Reading a sheet is what the streak is meant to count, so the sitting is
  // reported. A Sheet Summary is a reference lookup rather than a study
  // sitting, and a fixture sheet has no server document to report against.
  useReadingSession(catalogDocument?.versionId || "", { enabled: !summaryMode && !whiteboard && !personal });
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const rootRef = useRef(null);
  const readerRef = useRef(null);
  const toolbarRef = useRef(null);
  const toolRailRef = useRef(null);
  const toolListRef = useRef(null);
  const toolIndicatorRef = useRef(null);
  const toolOptionsRef = useRef(null);
  const previousToolOptionsHeightRef = useRef(null);
  const stageRef = useRef(null);
  const documentRef = useRef(null);
  const imageInputRef = useRef(null);
  const noteRef = useRef(null);
  const textInputRef = useRef(null);
  const sideCloseRef = useRef(null);
  const annotationsRef = useRef([]);
  const virtualPagesRef = useRef([]);
  const performanceMonitorRef = useRef(createWorkspacePerformanceMonitor());
  const annotationSpatialIndexRef = useRef(null);
  const notesRef = useRef([]);
  const draftRef = useRef(null);
  const drawingScrollLockRef = useRef({ active: false, pointerId: null, left: 0, top: 0 });
  const liveStrokeCanvasRef = useRef(null);
  const inkInputControllerRef = useRef(null);
  const eraserSessionRef = useRef(null);
  const stylusHoverRef = useRef(null);
  const eraserHitboxRef = useRef(null);
  const selectionClipboardRef = useRef([]);
  const toolMemoryRef = useRef(loadToolMemory());
  const activeToolRef = useRef("hand");
  const saveTimerRef = useRef(null);
  const saveIdleRef = useRef(null);
  const viewSaveTimerRef = useRef(null);
  const wakeLockRef = useRef(null);
  const transformRef = useRef(null);
  const previousToolRef = useRef("hand");
  const zoomRef = useRef(1);
  const pdfZoomModeRef = useRef("fit");
  // A refit caused by the stage changing width has to land on the same reading
  // position it left. The anchor is carried the way a pinch carries one.
  const pendingFitAnchorRef = useRef(null);
  const fittedStageWidthRef = useRef(null);
  const pendingPinchCommitRef = useRef(null);
  const initialPageViewRef = useRef("");
  const wheelZoomEndTimerRef = useRef(null);
  const zoomHudTimerRef = useRef(null);
  const wheelHandlerRef = useRef(null);
  const cancelInteractionRef = useRef(null);
  const jumpToPageRef = useRef(null);
  const inkHandoffRef = useRef(null);
  const pageGeometryCacheRef = useRef({ page: null, bounds: null });
  const storageModeRef = useRef("indexeddb");
  const rememberLastPositionRef = useRef(true);
  const activeVirtualPageIdRef = useRef(null);
  // Where the reader was when an Active Study test opened; closing the test,
  // or unlocking the next part from it, returns the reader to exactly here.
  const quizReaderAnchorRef = useRef(null);
  const rememberZoomLevelRef = useRef(true);
  const persistWorkspaceRef = useRef(null);
  const openDocumentRef = useRef(null);
  const annotationStoreRef = useRef(null);
  const revisionIndexRef = useRef(null);
  const savedPageSignaturesRef = useRef(new Map());
  const hydratedRef = useRef(false);
  // Server mirror of the local store (see catalogServerSync.js).
  const serverSyncRef = useRef(null);
  const serverSyncTimerRef = useRef(null);
  // What the shared offline queue needs to sync this document without the reader.
  const focusDescriptorRef = useRef(null);
  const pageCountRef = useRef(0);
  const serverLoadStartedRef = useRef(null);
  const backupInputRef = useRef(null);
  if (annotationStoreRef.current === null) annotationStoreRef.current = createAnnotationStore();
  if (revisionIndexRef.current === null) revisionIndexRef.current = createAnnotationRevisionIndex();
  const pageRef = useRef(1);
  const spacePanRef = useRef(false);
  if (inkInputControllerRef.current === null) inkInputControllerRef.current = createInkInputController();
  const transientInkRef = useRef(/** @type {ReturnType<typeof createTransientInk> | null} */ (null));
  if (transientInkRef.current === null) transientInkRef.current = createTransientInk();
  if (eraserSessionRef.current === null) eraserSessionRef.current = createEraserSession({ idFactory: generateIdempotencyKey });
  /** @type {import("react").MutableRefObject<any>} */
  const gestureRef = useRef({
    mode: INTERACTION_STATE.IDLE,
    touches: new Map(),
    penPointers: new Map(),
    rejectedTouches: new Set(),
    lastPenAt: 0,
    lastPenPosition: null,
    drawingPointerId: null,
    drawingPointerType: null,
    // The page a Pointer stroke is drawing on; it never becomes a draft.
    transientInkPage: null,
    pan: null,
    momentum: null,
    momentumRafId: null,
    panRafId: null,
    springRafId: null,
    spring: null,
    liveStrokeRafId: null,
    transformRafId: null,
    scrollActivityActive: false,
    pinch: null,
    pinchSequence: 0,
    pinchRafId: null,
    zoomSettleRafId: null,
    zoomSettleComplete: null,
    lastTap: null,
    eraserPreviewRafId: null,
    hoverRafId: null,
    hoverPoint: null,
    predictedStrokePoints: [],
    holdTimerId: null,
    holdAnchorPoint: null,
    holdStartedAt: null,
    holdRawStroke: null,
    holdRecognition: null,
    smartSelectionActivated: false
  });

  const material = materials.find((item) => item.slug === materialSlug) || null;
  // The address names one edition of the sheet; `view` carries that
  // edition's page count, summary and Active Study in the sheet's own shape.
  const { view: sheet, edition: sheetEdition } = resolveSheetEdition(material, sheetSlug);
  const inkDebugEnabled = import.meta.env.DEV && searchParams.get("inkDebug") === "1";

  useEffect(() => {
    // A summary is a reference read, not the sheet a student left off in.
    if (material && sheet && !summaryMode && !whiteboard && !personal) rememberLastOpenedCatalogSheet(materialSlug, sheetSlug, { material, sheet }, user?.id);
  }, [material, materialSlug, personal, sheet, sheetSlug, summaryMode, whiteboard, user?.id]);

  // Annotations now live in IndexedDB and load asynchronously, so nothing is
  // persisted until the stored document has been read back. Saving before
  // hydration would overwrite a real sheet with an empty one.
  const [restored, setRestored] = useState(null);
  const [pdfDocumentReady, setPdfDocumentReady] = useState(false);
  const ownerKey = useMemo(() => ownerStorageKey(user), [user]);
  // PDF paint can finish before IndexedDB. Editing is safe only after the
  // current account and edition have restored their saved document. A stale
  // snapshot from a previous scope must never enable the new document.
  const workspaceReady = Boolean(restored && hydratedRef.current
    && openDocumentRef.current?.owner === ownerKey
    && openDocumentRef.current?.materialSlug === materialSlug
    && openDocumentRef.current?.sheetSlug === storageSlug);
  const storedWorkspaceSettings = useMemo(loadWorkspaceSettings, []);
  const storedCircleErase = storedWorkspaceSettings.circleToErase ?? storedWorkspaceSettings.circleToLasso;
  const initialRememberLastPosition = storedWorkspaceSettings.rememberLastPosition !== false;
  const initialRememberZoomLevel = storedWorkspaceSettings.rememberZoomLevel !== false;
  const rememberedWritingTool = (() => {
    const remembered = String(toolMemoryRef.current.lastWritingTool || "pen");
    return DRAWING_TOOLS.has(remembered) && remembered !== "hand" ? remembered : "pen";
  })();
  const rememberedPenProfile = currentPenProfile(String(toolMemoryRef.current.lastPenProfile || PEN_PROFILE.BALL));
  const initialToolSettings = toolMemoryRef.current[
    rememberedWritingTool === "pen" ? `pen:${rememberedPenProfile}` : rememberedWritingTool
  ] || {};
  const configuredPageCount = sheet?.pageCount || (sheet?.pdfUrl ? 1 : PAGE_COUNT);
  const [pageCount, setPageCount] = useState(configuredPageCount);
  // A sheet always opens at the visual beginning.  The stored reader view is
  // still written for diagnostics/backup, but it never overrides this entry
  // position or any server-owned Active Study progress.
  const [page, setPage] = useState(1);
  const [virtualPages, setVirtualPages] = useState([]);
  const [activeVirtualPageId, setActiveVirtualPageId] = useState(null);
  const activePageKey = activeVirtualPageId ?? page;
  const [zoom, setZoom] = useState(() => {
    if (!sheet?.pdfUrl) return 1.3;
    const fitZoom = fitWidthZoom(window.innerWidth, A4_PAGE_WIDTH, window.innerWidth < 1200 ? 16 : 360);
    return Math.min(MAX_FOCUS_ZOOM, Math.max(MIN_FOCUS_ZOOM, fitZoom));
  });
  const [activeTool, setActiveTool] = useState(rememberedWritingTool);
  const [activeColor, setActiveColor] = useState(initialToolSettings.color || COLORS[0]);
  const [bookmarked, setBookmarked] = useState(false);
  const [bookmarkBusy, setBookmarkBusy] = useState(false);
  const [sideTab, setSideTab] = useState("notes");
  const [openSurface, setOpenSurface] = useState(null);
  const [brushSize, setBrushSize] = useState(() => Number(initialToolSettings.size) || 4);
  const [brushOpacity, setBrushOpacity] = useState(() => rememberedWritingTool === "pen" ? Number(initialToolSettings.opacity) || 1 : 1);
  const [pencilOpacity, setPencilOpacity] = useState(() => rememberedWritingTool === "pencil" ? Number(initialToolSettings.opacity) || .78 : .78);
  const [highlighterOpacity, setHighlighterOpacity] = useState(() => rememberedWritingTool === "highlighter" ? Number(initialToolSettings.opacity) || .34 : .34);
  const [penProfile, setPenProfile] = useState(rememberedPenProfile);
  const [favoritePens, setFavoritePens] = useState(loadFavoritePens);
  useEffect(() => { saveFavoritePens(favoritePens); }, [favoritePens]);
  // The Zoom Window's box on the page (null while it is closed), and its height.
  const [zoomWindow, setZoomWindow] = useState(null);
  const [zoomWindowHeight, setZoomWindowHeight] = useState(0);
  // Keep the box on screen above the window as it moves along and down the page.
  useEffect(() => {
    if (!zoomWindow || !zoomWindowHeight) return;
    const stage = stageRef.current;
    const frame = window.requestAnimationFrame(() => {
      const boxRect = stage?.querySelector(".workspace-zoom-window-box")?.getBoundingClientRect();
      const windowRect = rootRef.current?.querySelector(".workspace-zoom-window")?.getBoundingClientRect();
      if (!stage || !boxRect || !windowRect) return;
      const top = stage.getBoundingClientRect().top + 8;
      const bottom = windowRect.top - 12;
      const delta = boxRect.bottom > bottom ? boxRect.bottom - bottom : boxRect.top < top ? boxRect.top - top : 0;
      if (Math.abs(delta) < 1) return;
      const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      stage.scrollBy({ top: delta, behavior: still ? "auto" : "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [zoomWindow, zoomWindowHeight]);
  const [pressureSensitivity, setPressureSensitivity] = useState(() => Number.isFinite(Number(initialToolSettings.pressureSensitivity)) ? Number(initialToolSettings.pressureSensitivity) : .55);
  const [strokeSmoothing, setStrokeSmoothing] = useState(() => Number.isFinite(Number(initialToolSettings.smoothing)) ? Number(initialToolSettings.smoothing) : .5);
  const [autoImproveHandwriting, setAutoImproveHandwriting] = useState(storedWorkspaceSettings.autoImproveHandwriting === true);
  const [shapeStyle, setShapeStyle] = useState(() => String(initialToolSettings.shapeStyle || "rectangle"));
  const [shapeFill, setShapeFill] = useState(storedWorkspaceSettings.shapeFill === true);
  const [shapeFillColor, setShapeFillColor] = useState(storedWorkspaceSettings.shapeFillColor || "#dceeff");
  const [shapeDashed, setShapeDashed] = useState(storedWorkspaceSettings.shapeDashed === true);
  const [shapeSnapGrid, setShapeSnapGrid] = useState(storedWorkspaceSettings.shapeSnapGrid === true);
  const [shapeAngle, setShapeAngle] = useState(Number(storedWorkspaceSettings.shapeAngle) || 0);
  const [lassoMode, setLassoMode] = useState("freeform");
  const [scribbleToErase, setScribbleToErase] = useState(storedWorkspaceSettings.scribbleToErase !== false);
  const [drawAndHold, setDrawAndHold] = useState(storedWorkspaceSettings.drawAndHold !== false);
  const [eraserSize, setEraserSize] = useState(() => Math.max(6, Math.min(48, Number(storedWorkspaceSettings.eraserSize) || 8)));
  const [eraserMode, setEraserMode] = useState(() => ERASER_MODES.has(storedWorkspaceSettings.eraserMode) ? storedWorkspaceSettings.eraserMode : ERASER_MODE.PRECISION);
  const [circleToErase, setCircleToErase] = useState(storedCircleErase === true);
  const [recentColors, setRecentColors] = useState(loadRecentColors);
  const [favoriteColors, setFavoriteColors] = useState(() => loadStringList(FAVORITE_COLORS_KEY, 5));
  const [customColorDraft, setCustomColorDraft] = useState(COLORS[0]);
  const [customColorEditorOpen, setCustomColorEditorOpen] = useState(false);
  const [rememberLastPosition, setRememberLastPosition] = useState(initialRememberLastPosition);
  const [rememberZoomLevel, setRememberZoomLevel] = useState(initialRememberZoomLevel);
  const [showPageNumber, setShowPageNumber] = useState(storedWorkspaceSettings.showPageNumber !== false);
  const [keepScreenAwake, setKeepScreenAwake] = useState(storedWorkspaceSettings.keepScreenAwake === true);
  const [zoomHud, setZoomHud] = useState({ visible: false, label: "" });
  // Whether the student has chosen what draws. Until they do, the device
  // decides (see defaultDrawingInput), and a stylus seen on a phone takes over.
  const drawingInputChosenRef = useRef(false);
  const [drawingInput, setDrawingInput] = useState(() => {
    // v2 leaves out the old value, which was also written automatically when
    // users selected Pen and could make a resting finger draw after an update.
    let stored = null;
    try { stored = window.localStorage.getItem("lock-in.catalog-workspace.drawing-input.v2"); } catch { /* No stored choice. */ }
    drawingInputChosenRef.current = stored === DRAWING_INPUT.STYLUS_ONLY || stored === DRAWING_INPUT.STYLUS_AND_FINGER;
    return defaultDrawingInput({
      stored,
      coarsePointer: Boolean(window.matchMedia?.("(pointer: coarse)").matches),
      shortestScreenSide: Math.min(window.screen?.width || window.innerWidth, window.screen?.height || window.innerHeight)
    });
  });
  const [annotations, setAnnotations] = useState([]);
  const [notes, setNotes] = useState([]);
  const [annotationsHidden, setAnnotationsHidden] = useState(false);
  const [cardKind, setCardKind] = useState("note");
  const [cardDraft, setCardDraft] = useState("");
  const [editingCardId, setEditingCardId] = useState(null);
  const [clipSelecting, setClipSelecting] = useState(false);
  const [coverSelecting, setCoverSelecting] = useState(false);
  useEffect(() => {
    if (activeTool !== "select") {
      setCoverSelecting(false);
      setClipSelecting(false);
    }
  }, [activeTool]);
  // Which covers are lifted. Deliberately not saved: every visit starts with
  // the answers hidden, which is the point of hiding them.
  const [revealedCoverIds, setRevealedCoverIds] = useState(() => new Set());
  // A tab kept open behind another is left; coming back is a new visit.
  useEffect(() => {
    if (!paneActive) setRevealedCoverIds((current) => (current.size ? new Set() : current));
  }, [paneActive]);
  const [searchDocumentProxy, setSearchDocumentProxy] = useState(null);
  const [settingsTab, setSettingsTab] = useState("drawing");
  const [backupBusy, setBackupBusy] = useState(false);
  // idle | preparing | ready | failed. The finished file lives in
  // exportHandleRef so its object URL can be revoked when the sheet closes.
  const [exportState, setExportState] = useState(/** @type {{ status: string, kind?: string, share?: boolean, url?: string, name?: string, size?: number, apple?: boolean, shareable?: boolean, delivered?: boolean, shared?: boolean, shareError?: string, message?: string, done?: number, total?: number, progress?: number, note?: string }} */ ({ status: "idle" }));
  const exportBusy = exportState.status === "preparing";
  // Share opens the export choices and shares whichever one is picked, rather
  // than exporting every page before the share sheet can appear.
  const [exportForShare, setExportForShare] = useState(false);
  // The chosen pen, named under the panel title: on a phone the pen tiles are
  // icons only, and the Pointer pen's name says it clears when you lift.
  const activePenOption = PEN_PROFILE_OPTIONS.find(([value]) => value === penProfile);
  const exportHandleRef = useRef(null);
  const exportRunRef = useRef(0);
  const pdfDocumentProxyRef = useRef(null);
  const handlePdfDocumentLoaded = useCallback((documentProxy) => {
    pdfDocumentProxyRef.current = documentProxy;
    setSearchDocumentProxy(documentProxy);
  }, []);
  // Leaving the workspace abandons a running export and frees a finished one.
  useEffect(() => () => {
    exportRunRef.current += 1;
    exportHandleRef.current?.revoke();
    exportHandleRef.current = null;
  }, []);
  const [exportRangeStart, setExportRangeStart] = useState(1);
  const [exportRangeEnd, setExportRangeEnd] = useState(1);
  const [includeWorkspacePages, setIncludeWorkspacePages] = useState(storedWorkspaceSettings.includeWorkspacePages !== false);
  const [pendingImport, setPendingImport] = useState(null);
  const draftLayerRef = useRef(null);
  const draftAnnotationRef = useRef(null);
  const setDraftAnnotation = useCallback((next) => {
    draftAnnotationRef.current = next;
    draftLayerRef.current?.set(next);
  }, []);
  const toolOptionsOpen = openSurface?.startsWith("tool:") ? openSurface.slice(5) : null;
  const [lastToolOptions, setLastToolOptions] = useState(null);
  useEffect(() => {
    if (toolOptionsOpen) {
      setLastToolOptions(toolOptionsOpen);
      return undefined;
    }
    if (!lastToolOptions) return undefined;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setLastToolOptions(null);
      return undefined;
    }
    const timer = window.setTimeout(() => setLastToolOptions(null), 170);
    return () => window.clearTimeout(timer);
  }, [lastToolOptions, toolOptionsOpen]);
  const displayedToolOptions = toolOptionsOpen || lastToolOptions;
  // A toolbar popover closing back to the page plays its exit before it
  // unmounts; stepping between menus (More -> Export) swaps them at once.
  const [closingSurface, setClosingSurface] = useState(null);
  const previousSurfaceRef = useRef(openSurface);
  useEffect(() => {
    const previous = previousSurfaceRef.current;
    previousSurfaceRef.current = openSurface;
    if (!POPOVER_SURFACES.has(previous) || POPOVER_SURFACES.has(openSurface)) {
      setClosingSurface(null);
      return undefined;
    }
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return undefined;
    setClosingSurface(previous);
    const timer = window.setTimeout(() => setClosingSurface((current) => current === previous ? null : current), 170);
    return () => window.clearTimeout(timer);
  }, [openSurface]);
  /** Mount state and exit attributes for one toolbar popover. */
  const popover = (surface) => {
    const open = openSurface === surface;
    return {
      shown: open || closingSurface === surface,
      props: open ? {} : { "aria-hidden": true, inert: /** @type {""} */ (""), "data-exiting": "true" }
    };
  };
  const sideOpen = openSurface === "notes";
  const settingsOpen = openSurface === "settings";
  const wakeLockSupported = typeof navigator !== "undefined" && "wakeLock" in navigator;

  const minimumPdfZoom = useCallback(() => {
    if (!sheet?.pdfUrl) return MIN_FOCUS_ZOOM;
    const stage = stageRef.current;
    const stageWidth = stage?.clientWidth || window.innerWidth;
    // Phones and tablets (an iPad Pro in landscape too) fit the page edge to
    // edge. A wide desktop window would make that a 240% page with a third of
    // it on screen, so with a mouse "fit" is a comfortable reading width,
    // centred.
    const readingWidth = stageWidth >= 1280 && window.matchMedia?.("(pointer: fine)").matches;
    return Math.min(MAX_FOCUS_ZOOM, Math.max(MIN_FOCUS_ZOOM, fitWidthZoom(
      readingWidth ? Math.min(stageWidth, FIT_READING_WIDTH) : stageWidth,
      A4_PAGE_WIDTH,
      0
    )));
  }, [sheet?.pdfUrl]);

  // Fit width is the opening/reset scale, not the lower pinch limit. Keep a
  // half-width view available on tablets while retaining a readable floor.
  // The floor is half the stage's width even where fit is a reading width.
  const minimumAllowedZoom = useCallback(() => {
    if (!sheet?.pdfUrl) return MIN_FOCUS_ZOOM;
    const stageFit = Math.min(MAX_FOCUS_ZOOM, Math.max(MIN_FOCUS_ZOOM, fitWidthZoom(stageRef.current?.clientWidth || window.innerWidth, A4_PAGE_WIDTH, 0)));
    return Math.min(minimumPdfZoom(), Math.max(0.3, stageFit * 0.5));
  }, [minimumPdfZoom, sheet?.pdfUrl]);

  const clampReaderZoom = useCallback((value) => {
    return Math.min(MAX_FOCUS_ZOOM, Math.max(minimumAllowedZoom(), Number.isFinite(Number(value)) ? Number(value) : 1));
  }, [minimumAllowedZoom]);

  /**
   * A stored zoom is an absolute page scale, so replaying it on a device with a
   * different width would reproduce the old page width rather than the reading
   * size the student chose. Restore the magnification relative to fit-to-width
   * instead. Views saved before the basis was recorded reopen fitted.
   */
  const zoomFromStoredView = useCallback((view) => {
    const fitZoom = minimumPdfZoom();
    const storedZoom = Number(view?.zoom);
    if (!Number.isFinite(storedZoom)) return fitZoom;
    const storedBasis = Number(view?.zoomFitBasis);
    const magnification = Number.isFinite(storedBasis) && storedBasis > 0 ? storedZoom / storedBasis : 1;
    return clampReaderZoom(fitZoom * magnification);
  }, [clampReaderZoom, minimumPdfZoom]);
  const [undoHistory, setUndoHistory] = useState([]);
  const [redoHistory, setRedoHistory] = useState([]);
  const undoHistoryRef = useRef([]);
  const redoHistoryRef = useRef([]);
  const [selectedIds, setSelectedIds] = useState([]);
  // True while a selection is being dragged or resized; the context toolbar
  // steps aside so it neither lags behind the object nor covers it.
  const [selectionDragging, setSelectionDragging] = useState(false);
  const [clipboardSize, setClipboardSize] = useState(0);
  const selectionTapRef = useRef(null);
  const selectionToolbarRef = useRef(null);
  const selectionCommandsRef = useRef(/** @type {Record<string, (() => void) | undefined>} */ ({}));
  const [selectionActionsOpen, setSelectionActionsOpen] = useState(false);
  const [isDocumentFullscreen, setIsDocumentFullscreen] = useState(false);
  const [saveState, setSaveState] = useState("idle");
  const [saveErrorReason, setSaveErrorReason] = useState("");
  const [pageJumpDraft, setPageJumpDraft] = useState("1");
  const [pageThumbsOpen, setPageThumbsOpen] = useState(false);
  useEffect(() => { if (openSurface !== "pages") setPageThumbsOpen(false); }, [openSurface]);
  const [focusPayload, setFocusPayload] = useState(null);
  const [focusStatusChecked, setFocusStatusChecked] = useState(false);
  const [focusMessage, setFocusMessage] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [textDraft, setTextDraft] = useState("");
  const [editingTextId, setEditingTextId] = useState(null);
  const [textFontSize, setTextFontSize] = useState(28);
  const [textAlign, setTextAlign] = useState("left");
  const [textBold, setTextBold] = useState(false);
  const [textColor, setTextColor] = useState(COLORS[0]);
  const [noteBusy, setNoteBusy] = useState(false);
  const [studyMode, setStudyMode] = useState(preferredMode === "normal" ? "normal" : null);
  // A Sheet Summary is Normal Mode only, so it opens straight into reading
  // rather than asking which study mode to use.
  const [modeDialogOpen, setModeDialogOpen] = useState(!summaryMode && preferredMode !== "normal");
  // Sharing marks is for catalog sheets and for copies of another student's
  // marks; a PDF the student uploaded themselves has nothing to share it with.
  const [marksOpen, setMarksOpen] = useState(false);
  const [entryModePreference, setEntryModePreference] = useState(preferredMode);
  const [activeDifficulty, setActiveDifficulty] = useState(["easy", "medium", "hard"].includes(searchParams.get("studyDifficulty")) ? searchParams.get("studyDifficulty") : "medium");
  const [activeCustomization, setActiveCustomization] = useState({ studyMode: "standard", pagesPerCheckpoint: 3, questionsPerCheckpoint: 5 });
  const [deletePageConfirmOpen, setDeletePageConfirmOpen] = useState(false);
  const [activeStudy, setActiveStudy] = useState(null);
  const [activeStudyBusy, setActiveStudyBusy] = useState(false);
  const [activeExitOpen, setActiveExitOpen] = useState(false);
  const [activeStudyError, setActiveStudyError] = useState("");
  const [activeStudyAvailability, setActiveStudyAvailability] = useState(null);
  const [activeStudyAvailabilityLoading, setActiveStudyAvailabilityLoading] = useState(false);
  const [activeQuiz, setActiveQuiz] = useState(null);
  const [activeAnswers, setActiveAnswers] = useState({});
  // Answers the server already holds for the open attempt. It records each one
  // once and refuses a different choice later, so the quiz keeps them fixed.
  const [activeLocked, setActiveLocked] = useState({});
  const [activeResult, setActiveResult] = useState(null);
  const activeStudyRef = useRef(null);
  const activeQuizOpenRef = useRef(false);
  const viewPositionRef = useRef({ left: 0, top: 0, pageOffset: 0 });
  const measureViewPositionRef = useRef(null);
  const pageOffsetStaleRef = useRef(false);

  const sheetRoute = whiteboard ? "/materials" : personal ? personalBackTo : `/materials/catalog/${materialSlug}/sheets/${sheetSlug}`;
  const activePageRange = studyMode === "active" && activeStudy?.status === "active" ? activeStudy.current_page_range : null;
  // Active Study unlocks cumulatively. Earlier pages remain available while
  // the server-owned current range continues to determine checkpoint content.
  const accessiblePageStart = 1;
  const accessiblePageCount = activePageRange?.end_page || pageCount;
  const rescueSource = useMemo(() => ({
    material_slug: materialSlug, sheet_slug: sheetSlug,
    catalog_document_id: catalogDocument?.id || "",
    learning_object_version_id: catalogDocument?.versionId || "",
    managed_file_id: catalogDocument?.fileId || "",
    edition: documentScope?.edition || "university",
    title: sheet?.title || "", path: sheetRoute + "/workspace", offline: catalogDocument?.offline === true,
  }), [materialSlug, sheetSlug, catalogDocument?.id, catalogDocument?.versionId, catalogDocument?.fileId, catalogDocument?.offline, documentScope?.edition, sheet?.title, sheetRoute]);
  // Search reads only the pages the reader may show: Active Study keeps the
  // parts that are still locked out of the results as well as out of view.
  const documentSearch = useDocumentSearch(searchDocumentProxy, { firstPage: accessiblePageStart, lastPage: accessiblePageCount });
  const activeStudyButtonReady = studyMode === "active"
    && activeStudy?.status === "active"
    && (activeStudy.stage === "checkpoint" || activeStudy.stage === "final" || ACTIVE_RESULT_STAGES.has(activeStudy.stage) || (activeStudy.stage === "reading" && page >= accessiblePageCount));
  const selectedActiveStudyAvailability = activeStudyAvailability?.difficulties?.find((item) => item.difficulty === activeDifficulty);
  // The catalog flag is only an optimistic fallback while the mode dialog's
  // live readiness request is in flight. Starting itself remains server-owned.
  const activeStudyReady = selectedActiveStudyAvailability?.status === "ready"
    || (activeStudyAvailability === null && Boolean(sheet?.hasActiveStudy));
  const activeEntryKey = `${ownerKey}/${materialSlug}/${storageSlug}`;

  // The strip of open documents; the document in this reader is always one.
  const [workspaceTabs, updateWorkspaceTabs] = useWorkspaceTabs(ownerKey);
  const currentTabId = whiteboard ? whiteboardTabId(sheetSlug) : personal ? personalTabId(sheetSlug) : sheetTabId(materialSlug, sheetSlug);
  const currentTab = (title) => (whiteboard
    ? null
    : personal ? personalTab({ materialSlug: personalSubject, personalId: sheetSlug, title }) : sheetTab({ materialSlug, sheetSlug, title }));
  const showWorkspaceTabs = !summaryMode && Boolean(sheet);
  const sheetTitle = sheet?.title || "";
  useEffect(() => {
    if (!showWorkspaceTabs || !paneActive) return;
    updateWorkspaceTabs((state) => openWorkspaceTab(state, whiteboard
      ? state.tabs.find((tab) => tab.id === currentTabId) || whiteboardTab({ boardId: sheetSlug, number: nextWhiteboardNumber(state.tabs) })
      : currentTab(sheetTitle)));
  // eslint-disable-next-line react-hooks/exhaustive-deps -- currentTab only reads the values listed
  }, [currentTabId, materialSlug, paneActive, personalSubject, sheetSlug, sheetTitle, showWorkspaceTabs, updateWorkspaceTabs, whiteboard]);
  // Returning to a sheet tab skips the study mode question already answered there.
  useEffect(() => {
    if (!showWorkspaceTabs || whiteboard || personal || !studyMode) return;
    updateWorkspaceTabs((state) => updateWorkspaceTab(state, currentTabId, { mode: studyMode }));
  }, [currentTabId, personal, showWorkspaceTabs, studyMode, updateWorkspaceTabs, whiteboard]);
  const chooseActiveStudyRef = useRef(/** @type {null | ((difficulty?: string, options?: { resuming?: boolean, settings?: any, replaceExisting?: boolean }) => Promise<void>)} */ (null));
  const activeEntryCheckedRef = useRef("");

  // A sheet left with "Save" reopens in that run, once the reader has restored
  // its saved view. A run that has since finished or gone falls back to Normal.
  useEffect(() => {
    if (summaryMode || !restored || !sheet?.learningObjectId || activeEntryCheckedRef.current === activeEntryKey) return;
    const entryKey = activeEntryKey;
    activeEntryCheckedRef.current = entryKey;
    const saved = readActiveStudyEntry(entryKey);
    if (!saved) return;
    const { difficulty } = saved;
    // Only a move to another sheet abandons the check; a re-render does not.
    focusApi.getManagedActiveStudyAvailability(sheet.learningObjectId, sheetEdition?.edition)
      .then((payload) => {
        if (activeEntryCheckedRef.current !== entryKey) return;
        setActiveStudyAvailability(payload);
        const item = (/** @type {any[]} */ (payload?.difficulties) || []).find((entry) => entry.difficulty === difficulty);
        if (item?.status !== "ready" || savedStudyProgress(saved, item)?.status !== "active") {
          clearActiveStudyEntry(entryKey);
          return;
        }
        setActiveDifficulty(difficulty);
        void chooseActiveStudyRef.current?.(difficulty, { resuming: true, settings: saved });
      })
      .catch(() => undefined);
  }, [activeEntryKey, restored, sheet?.learningObjectId, sheetEdition?.edition, summaryMode]);

  useEffect(() => {
    if (!user?.id) return undefined;
    const refresh = (event) => {
      if (event.detail?.userId !== String(user.id) || event.detail.state !== "synced") return;
      const current = activeStudyRef.current;
      if (!current?.id || activeQuizOpenRef.current) return;
      void readActiveStudyRun(String(user.id), current.id).then((run) => {
        if (!run || activeStudyRef.current?.id !== current.id || activeQuizOpenRef.current) return;
        // Same part and stage keep the reader exactly where it is; only the
        // authoritative fields (XP, attempts, completion) are refreshed.
        setActiveStudy((previous) => previous?.id === current.id ? { ...run, id: previous.id } : previous);
      }).catch(() => undefined);
    };
    window.addEventListener("lock-in:offline-sync", refresh);
    return () => window.removeEventListener("lock-in:offline-sync", refresh);
  }, [user?.id]);
  useEffect(() => {
    activeStudyRef.current = activeStudy;
    activeQuizOpenRef.current = Boolean(activeQuiz);
  }, [activeStudy, activeQuiz]);

  useEffect(() => {
    if (summaryMode || !modeDialogOpen || !sheet?.learningObjectId) return undefined;
    let cancelled = false;
    setActiveStudyAvailabilityLoading(true);
    focusApi.getManagedActiveStudyAvailability(sheet.learningObjectId, sheetEdition?.edition)
      .then((payload) => {
        if (cancelled) return;
        setActiveStudyAvailability(payload);
        // A student coming back to a sheet should find the run they left
        // selected, not Medium with "Restart Medium" beneath it. With runs in
        // more than one difficulty the choice stays theirs.
        const inProgress = (/** @type {any[]} */ (payload?.difficulties) || []).filter((item) => item.progress?.status === "active");
        if (inProgress.length === 1) {
          setActiveDifficulty((current) => inProgress.some((item) => item.difficulty === current) ? current : inProgress[0].difficulty);
        }
      })
      .catch(() => { if (!cancelled) setActiveStudyAvailability(null); })
      .finally(() => { if (!cancelled) setActiveStudyAvailabilityLoading(false); });
    return () => { cancelled = true; };
  }, [modeDialogOpen, sheet?.learningObjectId, sheetEdition?.edition, summaryMode]);
  const pageAnnotations = useMemo(() => annotations.filter((item) => item.page === activePageKey), [activePageKey, annotations]);
  const annotationsByPage = useMemo(() => {
    const groups = new Map();
    for (const annotation of annotations) {
      const items = groups.get(annotation.page) || [];
      items.push(annotation);
      groups.set(annotation.page, items);
    }
    return groups;
  }, [annotations]);
  const coverIds = useMemo(() => annotations.filter((item) => item.type === "cover").map((item) => item.id), [annotations]);
  const allCoversRevealed = coverIds.length > 0 && coverIds.every((id) => revealedCoverIds.has(id));
  const coveredMatchIds = useMemo(() => coveredSearchMatchIds(documentSearch.matches, annotations), [documentSearch.matches, annotations]);
  const annotationSpatialIndex = useMemo(() => createAnnotationSpatialIndex(annotations), [annotations]);
  // A selection belongs to the page its items are on, not to whichever page
  // the reader currently counts as current while scrolling.
  const selectedAnnotations = useMemo(() => {
    const chosen = new Set(selectedIds);
    return chosen.size ? annotations.filter((item) => chosen.has(item.id)) : NO_ANNOTATIONS;
  }, [annotations, selectedIds]);
  const selectionPage = selectedAnnotations[0]?.page ?? null;
  const selectedBounds = useMemo(() => selectionBounds(selectedAnnotations), [selectedAnnotations]);
  const highlights = useMemo(() => annotations
    .filter((item) => item.type === "highlighter")
    .map((item, index) => ({ item, index, bounds: annotationBounds(item) }))
    .sort((first, second) => first.item.page - second.item.page || (first.bounds?.y || 0) - (second.bounds?.y || 0) || first.index - second.index)
    .map(({ item }) => item), [annotations]);
  const annotationLayerClass = `workspace-v2-annotation-layer${activeTool !== "hand" ? " is-interactive" : ""}${DRAWING_TOOLS.has(activeTool) ? " is-touch-drawing" : ""}`;
  const sortedNotes = useMemo(() => [...notes].sort((first, second) => first.page - second.page || first.createdAt.localeCompare(second.createdAt)), [notes]);

  usePageTitle(sheet ? `${sheet.title} · ${summaryMode ? t("materials.sheetSummary") : t("focus.workspace")}` : t("route.focus"));

  const updateAnnotations = useCallback((updater) => {
    setAnnotations((current) => {
      const next = typeof updater === "function" ? updater(current) : updater;
      annotationsRef.current = next;
      return next;
    });
  }, []);

  useEffect(() => {
    annotationsRef.current = annotations;
    performanceMonitorRef.current.annotationSnapshot(annotations);
  }, [annotations]);
  useEffect(() => {
    if ([INTERACTION_STATE.DRAWING, INTERACTION_STATE.ERASING, INTERACTION_STATE.SELECTING].includes(gestureRef.current.mode)) {
      performanceMonitorRef.current.increment("reactRendersDuringGesture");
    }
  });
  // Safe-area insets and the coarse-pointer control sizes both change the
  // toolbar height, so the surfaces that hang below it cannot assume a fixed
  // value. Publish the measured height instead of guessing it in the
  // stylesheet.
  useEffect(() => {
    const toolbar = toolbarRef.current;
    const root = rootRef.current;
    if (!toolbar || !root) return undefined;
    const publish = () => {
      const height = Math.round(toolbar.getBoundingClientRect().bottom - root.getBoundingClientRect().top);
      if (height > 0) root.style.setProperty("--workspace-toolbar-height", `${height}px`);
    };
    publish();
    const observer = new window.ResizeObserver(publish);
    observer.observe(toolbar);
    toolbar.addEventListener("animationend", publish);
    window.addEventListener("resize", publish, { passive: true });
    window.addEventListener("orientationchange", publish);
    return () => {
      observer.disconnect();
      toolbar.removeEventListener("animationend", publish);
      window.removeEventListener("resize", publish);
      window.removeEventListener("orientationchange", publish);
    };
  }, []);
  // The tool rail never wraps, so on a phone part of it is always off screen.
  useToolRail({ railRef: toolRailRef, listRef: toolListRef, indicatorRef: toolIndicatorRef, activeTool });
  // Keep each inspector attached to its tool without letting it leave the
  // reader at tablet widths. The phone inspector retains its full-width sheet.
  useLayoutEffect(() => {
    if (!toolOptionsOpen) return undefined;
    const panel = toolOptionsRef.current;
    const reader = readerRef.current;
    const source = toolbarRef.current?.querySelector(`[data-workspace-tool="${toolOptionsOpen}"]`);
    if (!panel || !reader || !source) return undefined;
    panel.scrollTop = 0;
    const resetScroll = window.requestAnimationFrame(() => { panel.scrollTop = 0; });
    const position = () => {
      if (window.innerWidth <= 560 || window.innerHeight < 600) {
        panel.style.removeProperty("left");
        // The full-width phone panel still points its caret at the tool.
        const panelBounds = panel.getBoundingClientRect();
        const sourceBounds = source.getBoundingClientRect();
        const toolCentre = sourceBounds.left + sourceBounds.width / 2 - panelBounds.left;
        panel.style.setProperty("--workspace-popover-origin", `${Math.max(18, Math.min(panelBounds.width - 18, toolCentre))}px`);
        return;
      }
      const readerBounds = reader.getBoundingClientRect();
      const sourceBounds = source.getBoundingClientRect();
      const width = panel.getBoundingClientRect().width;
      const desired = sourceBounds.left + sourceBounds.width / 2 - readerBounds.left;
      const half = Math.min(width / 2, Math.max(0, readerBounds.width / 2 - 8));
      const center = Math.max(half + 8, Math.min(readerBounds.width - half - 8, desired));
      panel.style.left = `${center}px`;
      panel.style.setProperty("--workspace-popover-origin", `${Math.max(0, Math.min(width, desired - center + width / 2))}px`);
    };
    position();
    window.addEventListener("resize", position, { passive: true });
    return () => { window.cancelAnimationFrame(resetScroll); window.removeEventListener("resize", position); };
  }, [toolOptionsOpen]);
  // The inspector stays mounted while switching writing tools. Interpolate its
  // own height after content changes; it is absolutely positioned and does not
  // resize the reader or trigger PDF canvas work during this transition.
  useLayoutEffect(() => {
    if (!toolOptionsOpen) {
      previousToolOptionsHeightRef.current = null;
      return undefined;
    }
    const panel = toolOptionsRef.current;
    if (!panel) return undefined;
    const previousHeight = previousToolOptionsHeightRef.current;
    const nextHeight = panel.offsetHeight;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const animation = previousHeight && Math.abs(previousHeight - nextHeight) > 2 && !reduceMotion
      ? panel.animate([{ height: `${previousHeight}px` }, { height: `${nextHeight}px` }], {
        duration: 230, easing: "cubic-bezier(0.22, 1, 0.36, 1)"
      })
      : null;
    return () => {
      previousToolOptionsHeightRef.current = panel.getBoundingClientRect().height;
      animation?.cancel();
    };
  }, [toolOptionsOpen]);
  /**
   * Keyboard-aware layout for the note editor.
   *
   * The reader's frame is the PDF's coordinate space: every pan offset and the
   * fit-to-width zoom basis are measured from it. A virtual keyboard that
   * shortens that frame therefore re-lays-out the document under the student's
   * finger and moves the page they were reading. Whether the keyboard shortens
   * it is a per-browser decision - an iOS Safari tab resizes only the visual
   * viewport, an installed iOS app and some Android configurations resize the
   * layout viewport and with it `dvh` - so the frame is pinned to its
   * keyboard-free height for the duration of the keyboard session rather than
   * trusting any one of those behaviours.
   *
   * What the keyboard does move is the notes drawer, which rides above it on
   * the published inset. The document itself never scrolls in this view, so if
   * a browser scrolls the root to reveal the field, that invariant is restored:
   * the field is already visible inside the lifted drawer.
   *
   * Whether the keyboard is up, and how much it covers, is measured once for
   * the whole application by the viewport sync layer. What is local to the
   * workspace is what that answer means here: pinning the reader's frame.
   */
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    let restingHeight = 0;
    let wasOpen = false;
    // The drawer is capped above the keyboard, so bringing the field into view
    // is a scroll of the drawer's own list - never of the document or the PDF.
    const revealFocusedNoteField = () => {
      const field = document.activeElement;
      const scroller = field?.closest?.(".workspace-v2-side-content");
      if (!scroller) return;
      const track = scroller.getBoundingClientRect();
      const target = field.getBoundingClientRect();
      const overflow = target.bottom - track.bottom + 12;
      if (overflow > 0) scroller.scrollTop += overflow;
    };
    // The frame the reader is restored to has to be the current one: a rotation
    // or a collapsing browser toolbar changes it while nobody is typing. It is
    // therefore tracked from the frame itself, and only while it is free to
    // follow the viewport.
    const recordRestingHeight = () => {
      if (wasOpen) return;
      restingHeight = Math.round(root.getBoundingClientRect().height);
    };
    const frameObserver = typeof window.ResizeObserver === "function" ? new window.ResizeObserver(recordRestingHeight) : null;
    frameObserver?.observe(root);
    const unsubscribe = subscribeViewport(({ keyboardOpen, keyboardInset }) => {
      if (keyboardOpen) {
        root.style.setProperty("--workspace-keyboard-inset", `${keyboardInset}px`);
        if (restingHeight) root.style.height = `${restingHeight}px`;
        root.dataset.keyboard = "open";
        const scroller = document.scrollingElement;
        if (scroller && scroller.scrollTop !== 0) scroller.scrollTop = 0;
        if (!wasOpen) revealFocusedNoteField();
      } else {
        // Recorded only while the keyboard is down, so the frame the reader is
        // restored to is always the one it had before typing started.
        root.style.removeProperty("height");
        wasOpen = false;
        recordRestingHeight();
        root.style.removeProperty("--workspace-keyboard-inset");
        delete root.dataset.keyboard;
      }
      wasOpen = keyboardOpen;
    });
    return () => {
      unsubscribe();
      frameObserver?.disconnect();
      root.style.removeProperty("--workspace-keyboard-inset");
      root.style.removeProperty("height");
      delete root.dataset.keyboard;
    };
  }, []);
  useEffect(() => { annotationSpatialIndexRef.current = annotationSpatialIndex; }, [annotationSpatialIndex]);
  useEffect(() => { notesRef.current = notes; }, [notes]);
  useEffect(() => {
    // The outline follows the pointer only while the eraser is the tool.
    if (activeTool === "eraser" && !annotationsHidden) return;
    if (eraserHitboxRef.current) eraserHitboxRef.current.style.opacity = "0";
  }, [activeTool, annotationsHidden]);
  // Pointer handlers read the tool from this snapshot, never from the render
  // closure: a stroke that starts before the (large) workspace has re-rendered
  // after a tool tap must still use the tool that was tapped. `selectTool`
  // writes it synchronously; the layout effect keeps it equal to committed state.
  const toolStateRef = useRef(null);
  useLayoutEffect(() => {
    activeToolRef.current = activeTool;
    toolStateRef.current = { activeTool, penProfile, activeColor, brushSize, brushOpacity, highlighterOpacity, pencilOpacity, pressureSensitivity, strokeSmoothing, shapeStyle };
  }, [activeColor, activeTool, brushOpacity, brushSize, highlighterOpacity, penProfile, pencilOpacity, pressureSensitivity, shapeStyle, strokeSmoothing]);
  useEffect(() => { rememberLastPositionRef.current = rememberLastPosition; }, [rememberLastPosition]);
  useEffect(() => { rememberZoomLevelRef.current = rememberZoomLevel; }, [rememberZoomLevel]);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { activeVirtualPageIdRef.current = activeVirtualPageId; }, [activeVirtualPageId]);
  useEffect(() => {
    pageRef.current = page;
    // Scrolling changes the current page continuously. Rewriting the field
    // while the navigator is open would erase what the reader is typing.
    if (openSurface !== "pages") setPageJumpDraft(String(page));
  }, [openSurface, page]);
  useEffect(() => {
    if (openSurface === "text") window.setTimeout(() => textInputRef.current?.focus(), 0);
  }, [openSurface]);
  useEffect(() => {
    try { window.localStorage.setItem(RECENT_COLORS_KEY, JSON.stringify(recentColors)); } catch { /* Recent colors are an optional local preference. */ }
  }, [recentColors]);
  useEffect(() => {
    try { window.localStorage.setItem(FAVORITE_COLORS_KEY, JSON.stringify(favoriteColors)); } catch { /* Favorites are an optional local preference. */ }
  }, [favoriteColors]);
  useEffect(() => {
    if (!["pen", "pencil", "highlighter", "eraser", "shapes"].includes(activeTool)) return;
    const key = activeTool === "pen" ? `pen:${penProfile}` : activeTool;
    toolMemoryRef.current[key] = {
      color: activeColor,
      size: brushSize,
      opacity: activeTool === "highlighter" ? highlighterOpacity : activeTool === "pencil" ? pencilOpacity : brushOpacity,
      pressureSensitivity,
      smoothing: strokeSmoothing,
      shapeStyle
    };
    if (activeTool === "pen") toolMemoryRef.current.lastPenProfile = penProfile;
    toolMemoryRef.current.lastWritingTool = activeTool;
    try { window.localStorage.setItem(TOOL_MEMORY_KEY, JSON.stringify(toolMemoryRef.current)); } catch { /* Tool memory is a best-effort local preference. */ }
  }, [activeColor, activeTool, brushOpacity, brushSize, highlighterOpacity, penProfile, pencilOpacity, pressureSensitivity, shapeStyle, strokeSmoothing]);
  useEffect(() => {
    try { window.localStorage.setItem(WORKSPACE_SETTINGS_KEY, JSON.stringify({ autoImproveHandwriting, scribbleToErase, drawAndHold, eraserSize, eraserMode, circleToErase, rememberLastPosition, rememberZoomLevel, showPageNumber, keepScreenAwake, shapeFill, shapeFillColor, shapeDashed, shapeSnapGrid, shapeAngle, includeWorkspacePages })); } catch { /* Workspace preferences remain available in memory. */ }
  }, [autoImproveHandwriting, circleToErase, drawAndHold, eraserMode, eraserSize, keepScreenAwake, rememberLastPosition, rememberZoomLevel, scribbleToErase, showPageNumber, shapeFill, shapeFillColor, shapeDashed, shapeSnapGrid, shapeAngle, includeWorkspacePages]);
  useEffect(() => () => {
    const gesture = gestureRef.current;
    if (gesture.pinchRafId !== null) cancelAnimationFrame(gesture.pinchRafId);
    if (gesture.momentumRafId !== null) cancelAnimationFrame(gesture.momentumRafId);
    if (gesture.panRafId !== null) cancelAnimationFrame(gesture.panRafId);
    if (gesture.springRafId !== null) cancelAnimationFrame(gesture.springRafId);
    if (gesture.liveStrokeRafId !== null) cancelAnimationFrame(gesture.liveStrokeRafId);
    if (gesture.transformRafId !== null) cancelAnimationFrame(gesture.transformRafId);
    if (gesture.eraserPreviewRafId !== null) cancelAnimationFrame(gesture.eraserPreviewRafId);
    if (gesture.hoverRafId !== null) cancelAnimationFrame(gesture.hoverRafId);
    if (gesture.zoomSettleRafId !== null) cancelAnimationFrame(gesture.zoomSettleRafId);
    if (gesture.holdTimerId !== null) window.clearTimeout(gesture.holdTimerId);
    if (wheelZoomEndTimerRef.current) window.clearTimeout(wheelZoomEndTimerRef.current);
    if (zoomHudTimerRef.current) window.clearTimeout(zoomHudTimerRef.current);
    if (viewSaveTimerRef.current) window.clearTimeout(viewSaveTimerRef.current);
    if (saveIdleRef.current !== null && window.cancelIdleCallback) window.cancelIdleCallback(saveIdleRef.current);
    wakeLockRef.current?.release?.().catch(() => {});
  }, []);
  useEffect(() => {
    const resetInterruptedInteraction = (event) => {
      if (event.type === "visibilitychange" && !document.hidden) return;
      // Leaving the window swallows the Space keyup, so the hold-to-pan
      // modifier has to release itself rather than stranding the Pan tool.
      if (spacePanRef.current) {
        spacePanRef.current = false;
        setActiveTool(previousToolRef.current);
      }
      cancelInteractionRef.current?.({ pointerId: null, pointerType: "system", type: event.type });
    };
    window.addEventListener("blur", resetInterruptedInteraction);
    window.addEventListener("orientationchange", resetInterruptedInteraction);
    window.addEventListener("pagehide", resetInterruptedInteraction);
    document.addEventListener("visibilitychange", resetInterruptedInteraction);
    return () => {
      window.removeEventListener("blur", resetInterruptedInteraction);
      window.removeEventListener("orientationchange", resetInterruptedInteraction);
      window.removeEventListener("pagehide", resetInterruptedInteraction);
      document.removeEventListener("visibilitychange", resetInterruptedInteraction);
    };
  }, []);
  // The notes drawer is fixed to the layout viewport, but in an iPad split view the
  // part of the page on screen can be narrower than that, leaving the drawer's
  // edge (and its slide) cut off by the window. Measure how far the visible area
  // stops short of each layout edge so the drawer can rest against what is seen.
  useEffect(() => {
    const root = rootRef.current;
    const viewport = window.visualViewport;
    if (!root || !viewport) return undefined;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const leftGap = Math.max(0, Math.round(viewport.offsetLeft));
      const rightGap = Math.max(0, Math.round(document.documentElement.clientWidth - viewport.offsetLeft - viewport.width));
      const rtl = window.getComputedStyle(root).direction === "rtl";
      root.style.setProperty("--workspace-visible-start-gap", `${rtl ? rightGap : leftGap}px`);
      root.style.setProperty("--workspace-visible-end-gap", `${rtl ? leftGap : rightGap}px`);
    };
    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(measure); };
    measure();
    viewport.addEventListener("resize", schedule, { passive: true });
    viewport.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      viewport.removeEventListener("resize", schedule);
      viewport.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [workspaceReady]);
  // Entering or leaving a split view changes the window width. The notes drawer
  // is positioned against the layout viewport, so across a width change it can
  // end up half outside the window with its close button out of reach. Close it
  // instead; the Notes button reopens it at the new size.
  useEffect(() => {
    if (!sideOpen) return undefined;
    let width = window.innerWidth;
    const closeOnWidthChange = () => {
      if (window.innerWidth === width) return;
      width = window.innerWidth;
      setOpenSurface((current) => current === "notes" ? null : current);
    };
    window.addEventListener("resize", closeOnWidthChange);
    return () => window.removeEventListener("resize", closeOnWidthChange);
  }, [sideOpen]);
  useEffect(() => {
    if (!paneActive || !openSurface || openSurface === "notes") return undefined;
    const dismissPopover = (event) => {
      if (event.target.closest?.(".workspace-v2-toolbar, .workspace-v2-tool-options, .workspace-v2-action-popover, .workspace-v2-settings-popover, .workspace-v2-page-dock")) return;
      setOpenSurface(null);
    };
    // The tool options carry no close button: the tool that opened them is the
    // toggle. Escape is the other half of that contract for a keyboard, and it
    // hands focus back to the control that owns the panel.
    const dismissOnEscape = (event) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.stopPropagation();
      const owner = openSurface.startsWith("tool:")
        ? `[data-workspace-tool="${openSurface.slice(5)}"]`
        : openSurface === "pages"
          ? ".workspace-v2-page-number"
          : openSurface === "add"
            ? '[data-workspace-surface="add"]'
            : openSurface === "study"
              ? '[data-workspace-surface="study"]'
              : openSurface === "more"
              ? '[data-workspace-surface="more"]'
              : '[aria-controls="workspace-settings-popover"]';
      setOpenSurface(null);
      const opener = rootRef.current?.querySelector(owner)
        || (openSurface.startsWith("tool:") ? rootRef.current?.querySelector('[data-workspace-surface="add"]') : null)
        || (openSurface === "settings" ? rootRef.current?.querySelector('[data-workspace-surface="more"]') : null);
      // A narrow toolbar folds Study (and the tools it scrolls away) into More;
      // focus goes back there rather than to a control that is not on screen.
      (opener?.getClientRects().length ? opener : rootRef.current?.querySelector('[data-workspace-surface="more"]'))?.focus();
    };
    document.addEventListener("pointerdown", dismissPopover);
    document.addEventListener("keydown", dismissOnEscape);
    return () => {
      document.removeEventListener("pointerdown", dismissPopover);
      document.removeEventListener("keydown", dismissOnEscape);
    };
  }, [openSurface, paneActive]);
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    const handleNativeWheel = (event) => wheelHandlerRef.current?.(event);
    // The document owns touch navigation. Safari must never promote the first
    // contact to native scrolling because that cancels the pointer stream when
    // the second finger arrives and fragments one pinch into many sessions.
    function preserveWorkspaceTouch(event) {
      // Cancelling touchstart also cancels the compatibility click, so toolbars
      // and buttons rendered inside the document opt out. touchmove stays
      // cancelled for every target: a drag that begins on a control must not
      // hand the gesture back to native scrolling half way through.
      if (event.type === "touchstart" && isStageControl(event.target)) return;
      event.preventDefault();
    }
    function resetEndedTouchSession(event) {
      if (event.touches?.length) return;
      const gesture = gestureRef.current;
      const activeTouchSession = gesture.pan
        || gesture.pinch?.active
        || (gesture.drawingPointerId !== null && gesture.drawingPointerType === "touch");
      if (activeTouchSession) {
        cancelInteractionRef.current?.({ pointerId: null, pointerType: "touch", type: event.type });
        return;
      }
      gesture.touches.clear();
      gesture.rejectedTouches.clear();
    }
    function preserveDrawingPosition() {
      const lock = drawingScrollLockRef.current;
      if (!lock.active) return;
      if (stage.scrollLeft !== lock.left) stage.scrollLeft = lock.left;
      if (stage.scrollTop !== lock.top) stage.scrollTop = lock.top;
    }
    stage.addEventListener("wheel", handleNativeWheel, { passive: false });
    stage.addEventListener("touchstart", preserveWorkspaceTouch, { passive: false });
    stage.addEventListener("touchmove", preserveWorkspaceTouch, { passive: false });
    stage.addEventListener("touchend", resetEndedTouchSession, { passive: true });
    stage.addEventListener("touchcancel", resetEndedTouchSession, { passive: true });
    stage.addEventListener("scroll", preserveDrawingPosition, { passive: true });
    return () => {
      stage.removeEventListener("wheel", handleNativeWheel);
      stage.removeEventListener("touchstart", preserveWorkspaceTouch);
      stage.removeEventListener("touchmove", preserveWorkspaceTouch);
      stage.removeEventListener("touchend", resetEndedTouchSession);
      stage.removeEventListener("touchcancel", resetEndedTouchSession);
      stage.removeEventListener("scroll", preserveDrawingPosition);
    };
  }, []);
  useLayoutEffect(() => {
    const pending = pendingPinchCommitRef.current;
    const root = documentRef.current;
    const stage = stageRef.current;
    if (!pending || !root || !stage || Math.abs(pending.finalZoom - zoom) > .001) return;
    root.style.transform = "";
    const documentElement = root.querySelector(".workspace-v2-a4-document") || root;
    const documentBounds = documentElement.getBoundingClientRect();
    if (documentBounds.width > 0 && documentBounds.height > 0) {
      const next = scrollForDocumentAnchor({
        // React's final zoom geometry may already have forced the browser to
        // clamp scrollTop (especially near the last page while zooming out).
        // Reconcile from that actual post-layout position, never the stale
        // gesture-start scroll position.
        currentScrollLeft: stage.scrollLeft,
        currentScrollTop: stage.scrollTop,
        documentLeft: documentBounds.left,
        documentTop: documentBounds.top,
        documentAnchorX: pending.documentAnchorX,
        documentAnchorY: pending.documentAnchorY,
        scale: zoom,
        focalClientX: pending.currentFocalX,
        focalClientY: pending.currentFocalY
      });
      const bounds = readerScrollBounds({ preserveCurrent: false });
      stage.scrollLeft = Math.min(bounds.maxScrollLeft, Math.max(bounds.minScrollLeft, next.scrollLeft));
      if (pending.constrainToBounds) {
        stage.scrollTop = Math.min(bounds.maxScrollTop, Math.max(bounds.minScrollTop, next.scrollTop));
      } else {
        stage.scrollTop = next.scrollTop;
      }
    }
    pendingPinchCommitRef.current = null;
    root.classList.remove("is-live-pinching", "is-zoom-settling");
    root.dispatchEvent(new window.CustomEvent("workspace:livezoomcommit", { detail: { zoom, pinchId: pending.pinchId } }));
    const gesture = gestureRef.current;
    const springStarted = startPanSpringBack(pending.elasticX, pending.constrainToBounds ? pending.elasticY : 0);
    if (!springStarted && gesture.mode === INTERACTION_STATE.SETTLING && gesture.touches.size === 0) gesture.mode = INTERACTION_STATE.IDLE;
    root.dispatchEvent(new window.CustomEvent("workspace:zoomgeometrysettled", { detail: { zoom, pinchId: pending.pinchId } }));
  // The commit must run exactly once for the newly mounted zoom geometry;
  // gesture helpers intentionally read the latest mutable refs in that frame.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom]);
  useLayoutEffect(() => {
    const pending = pendingFitAnchorRef.current;
    const stage = stageRef.current;
    const root = documentRef.current;
    if (!pending || !stage || !root || Math.abs(pending.finalZoom - zoom) > .001) return;
    pendingFitAnchorRef.current = null;
    const documentElement = root.querySelector(".workspace-v2-a4-document") || root;
    const documentBounds = documentElement.getBoundingClientRect();
    if (!(documentBounds.width > 0 && documentBounds.height > 0)) return;
    const next = scrollForDocumentAnchor({
      currentScrollLeft: stage.scrollLeft,
      currentScrollTop: stage.scrollTop,
      documentLeft: documentBounds.left,
      documentTop: documentBounds.top,
      documentAnchorX: pending.documentAnchorX,
      documentAnchorY: pending.documentAnchorY,
      scale: zoom,
      focalClientX: pending.focalClientX,
      focalClientY: pending.focalClientY
    });
    const bounds = readerScrollBounds({ preserveCurrent: false });
    stage.scrollLeft = Math.min(bounds.maxScrollLeft, Math.max(bounds.minScrollLeft, next.scrollLeft));
    stage.scrollTop = Math.min(bounds.maxScrollTop, Math.max(bounds.minScrollTop, next.scrollTop));
  // The anchor belongs to the zoom geometry that just mounted, and the bounds
  // helper reads the latest mutable refs in that same frame.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom]);

  useEffect(() => {
    setPageCount(configuredPageCount);
    setPage((current) => Math.min(configuredPageCount, Math.max(1, current)));
  }, [configuredPageCount, materialSlug, sheetSlug]);

  useEffect(() => {
    if (!sheet?.pdfUrl || !stageRef.current) return undefined;
    const stage = stageRef.current;
    const keepPdfFitted = () => {
      const stageWidth = stage.clientWidth;
      const fitZoom = minimumPdfZoom();
      const nextZoom = pdfZoomModeRef.current === "fit"
        ? fitZoom
        : clampReaderZoom(zoomRef.current);
      const previousStageWidth = fittedStageWidthRef.current;
      fittedStageWidthRef.current = stageWidth;
      if (Math.abs(zoomRef.current - nextZoom) < .001) return;
      // Docking the side panel narrows the stage, and a narrower stage fits the
      // page at a smaller scale. The document shrinks around a scroll position
      // that does not move, which slides the reader forward - two pages deep
      // into a sheet, more further in. The point the stage is reading from is
      // remembered here in unscaled document space and restored once the new
      // zoom has laid out, exactly as a pinch reconciles its focal point.
      const root = documentRef.current;
      const documentElement = root?.querySelector(".workspace-v2-a4-document") || root;
      const documentBounds = documentElement?.getBoundingClientRect();
      if (previousStageWidth !== null && previousStageWidth !== stageWidth && documentBounds?.height > 0) {
        const stageBounds = stage.getBoundingClientRect();
        const currentZoom = Math.max(.001, zoomRef.current);
        pendingFitAnchorRef.current = {
          finalZoom: nextZoom,
          documentAnchorX: (stageBounds.left - documentBounds.left) / currentZoom,
          documentAnchorY: (stageBounds.top - documentBounds.top) / currentZoom,
          focalClientX: stageBounds.left,
          focalClientY: stageBounds.top
        };
      }
      zoomRef.current = nextZoom;
      setZoom(nextZoom);
    };
    keepPdfFitted();
    const observer = new window.ResizeObserver(keepPdfFitted);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [clampReaderZoom, materialSlug, minimumPdfZoom, sheet?.pdfUrl, sheetSlug]);

  const resetInitialPdfPosition = useCallback(() => {
    const viewKey = `${materialSlug}/${sheetSlug}`;
    if (!hydratedRef.current || initialPageViewRef.current === viewKey) return;
    const stage = stageRef.current;
    if (!stage?.querySelector('[data-pdf-page="1"]')) return;
    const storedView = restored?.view;
    const fitZoom = minimumPdfZoom();
    const initialZoom = rememberZoomLevel ? zoomFromStoredView(storedView) : fitZoom;
    const storedBasis = Number(storedView?.zoomFitBasis);
    const storedZoom = Number(storedView?.zoom);
    pdfZoomModeRef.current = rememberZoomLevel && Number.isFinite(storedBasis) && storedBasis > 0 && Math.abs(storedZoom - storedBasis) > .001
      ? "manual"
      : "fit";
    zoomRef.current = initialZoom;
    setZoom(initialZoom);
    const positionInitialPage = () => {
      // A study resume or explicit navigation made while PDF.js was loading
      // owns the position. Initial placement must not overwrite that choice.
      if (pendingReaderAnchorRef.current) {
        initialPageViewRef.current = viewKey;
        return;
      }
      const initialPage = stage.querySelector('[data-pdf-page="1"]');
      if (!initialPage) return;
      const stageBounds = stage.getBoundingClientRect();
      const pageBounds = initialPage.getBoundingClientRect();
      const paddingTop = Number.parseFloat(window.getComputedStyle(stage).paddingTop) || 0;
      const targetTop = stage.scrollTop + pageBounds.top - stageBounds.top - paddingTop;
      // The stage scrolls left-to-right in every reading direction (see
      // .workspace-v2-document-stage), so one clamped range serves Arabic too.
      const left = centeredScrollLeft({ scrollLeft: stage.scrollLeft, pageLeft: pageBounds.left, viewportLeft: stageBounds.left, viewportWidth: stage.clientWidth, pageWidth: pageBounds.width, scrollWidth: stage.scrollWidth });
      stage.scrollTo({
        left,
        top: Math.max(0, targetTop),
        behavior: "auto"
      });
      pageRef.current = 1;
      setPage(1);
      setPageJumpDraft("1");
      viewPositionRef.current = { left: stage.scrollLeft, top: stage.scrollTop, pageOffset: 0 };
      initialPageViewRef.current = viewKey;
    };
    requestAnimationFrame(() => requestAnimationFrame(positionInitialPage));
  }, [materialSlug, minimumPdfZoom, rememberZoomLevel, restored, sheetSlug, zoomFromStoredView]);

  const markPdfDocumentReady = useCallback(() => setPdfDocumentReady(true), []);

  /**
   * Where the reader should settle once its target page is laid out. Unlocking
   * an Active Study part only appends pages below the reader, so the anchor
   * page is normally mounted already; a resume can target a page the PDF has
   * not laid out yet, and then the anchor waits for the document instead.
   */
  const pendingReaderAnchorRef = useRef(null);

  const applyPendingReaderAnchor = useCallback(() => {
    if (sheet?.pdfUrl && initialPageViewRef.current !== `${materialSlug}/${sheetSlug}`) return;
    const anchor = pendingReaderAnchorRef.current;
    const stage = stageRef.current;
    const target = stage?.querySelector(`[data-workspace-page="${anchor?.key}"]`);
    if (!anchor || !stage || !target) return;
    pendingReaderAnchorRef.current = null;
    const stageBounds = stage.getBoundingClientRect();
    const pageBounds = target.getBoundingClientRect();
    const pageTop = pageBounds.top - stageBounds.top + stage.scrollTop;
    const paddingTop = Number.parseFloat(window.getComputedStyle(stage).paddingTop) || 0;
    const top = anchor.pageOffset === null ? pageTop - paddingTop : pageTop + anchor.pageOffset * pageBounds.height;
    const left = anchor.left ?? centeredScrollLeft({ scrollLeft: stage.scrollLeft, pageLeft: pageBounds.left, viewportLeft: stageBounds.left, viewportWidth: stage.clientWidth, pageWidth: pageBounds.width, scrollWidth: stage.scrollWidth });
    stage.scrollTo({ left, top: Math.max(0, top), behavior: "auto" });
    viewPositionRef.current = { left: stage.scrollLeft, top: stage.scrollTop, pageOffset: Math.max(0, anchor.pageOffset || 0) };
    // The first-open placement may have reset the page since the anchor was set.
    pageRef.current = anchor.page;
    setPage(anchor.page);
    setActiveVirtualPageId(anchor.virtualPageId ?? null);
  }, [materialSlug, sheet?.pdfUrl, sheetSlug]);

  /**
   * Moves the reader to a page, or back to an anchor taken with
   * captureReaderAnchor. The page state updates at once; the scroll waits two
   * frames so pages added in the same render have their final geometry.
   */
  const placeReaderAt = useCallback((anchorOrPage) => {
    const anchor = typeof anchorOrPage === "object" && anchorOrPage
      ? anchorOrPage
      : { page: Math.max(1, Number(anchorOrPage) || 1), virtualPageId: null, pageOffset: null, left: null };
    pendingReaderAnchorRef.current = { ...anchor, key: anchor.virtualPageId ?? anchor.page };
    setActiveVirtualPageId(anchor.virtualPageId ?? null);
    pageRef.current = anchor.page;
    setPage(anchor.page);
    setPageJumpDraft(String(anchor.page));
    requestAnimationFrame(() => requestAnimationFrame(applyPendingReaderAnchor));
  }, [applyPendingReaderAnchor]);

  const resetReaderToPageOne = useCallback(() => placeReaderAt(1), [placeReaderAt]);

  /** The page on screen and how far into it the reader is, zoom-independent. */
  const captureReaderAnchor = useCallback(() => {
    const stage = stageRef.current;
    const pdfPage = pageRef.current || 1;
    const virtualPageId = activeVirtualPageIdRef.current;
    const target = stage?.querySelector(`[data-workspace-page="${virtualPageId ?? pdfPage}"]`);
    if (!stage || !target) return { page: pdfPage, virtualPageId, pageOffset: null, left: null };
    const stageBounds = stage.getBoundingClientRect();
    const pageBounds = target.getBoundingClientRect();
    return {
      page: pdfPage,
      virtualPageId,
      pageOffset: pageBounds.height ? (stageBounds.top - pageBounds.top) / pageBounds.height : 0,
      left: stage.scrollLeft
    };
  }, []);

  useEffect(() => {
    if (!pdfDocumentReady || !restored) return;
    resetInitialPdfPosition();
    // Runs after the initial placement's frames, so a resume target wins.
    if (pendingReaderAnchorRef.current) requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(applyPendingReaderAnchor)));
  }, [applyPendingReaderAnchor, pdfDocumentReady, resetInitialPdfPosition, restored]);

  useEffect(() => {
    setActiveVirtualPageId(null);
    setPage(1);
    pageRef.current = 1;
    setPageJumpDraft("1");
    viewPositionRef.current = { left: 0, top: 0, pageOffset: 0 };
    setPdfDocumentReady(false);
    initialPageViewRef.current = "";
  }, [materialSlug, sheetSlug]);

  const handleCurrentWorkspacePage = useCallback((pdfPage, virtualPageId) => {
    // The current page changes many times during one scroll. Re-rendering the
    // whole workspace for it is urgent for nothing on screen, so it must not
    // compete with the scroll frames.
    startTransition(() => {
      setPage(pdfPage);
      setActiveVirtualPageId(virtualPageId);
    });
  }, []);

  const syncPdfPageCount = useCallback((count) => {
    if (!Number.isFinite(count) || count < 1) return;
    setPageCount(count);
    setPage((current) => Math.min(count, current));
  }, []);

  const recordPdfPageRender = useCallback((duration) => {
    performanceMonitorRef.current.record("pdfRender", duration);
  }, []);

  const recordCommand = useCallback((command) => {
    const nextUndo = [...undoHistoryRef.current.slice(-79), command];
    undoHistoryRef.current = nextUndo;
    redoHistoryRef.current = [];
    setUndoHistory(nextUndo);
    setRedoHistory([]);
  }, []);

  const runCommand = useCallback((command) => {
    // Remember where removed items sat so undo restores their stacking order.
    const positioned = withCommandPositions(command, annotationsRef.current);
    updateAnnotations((current) => applyAnnotationCommand(current, positioned, "redo"));
    recordCommand(positioned);
  }, [recordCommand, updateAnnotations]);

  const applyWorkspacePageCommand = useCallback((command, direction) => {
    // My Summary pages are not part of Undo: an older page command keeps the
    // summary pages as they are now, whichever way it runs.
    const chosen = direction === "undo" ? command.beforePages : command.afterPages;
    const pages = [...chosen.filter((item) => !item.summary), ...virtualPagesRef.current.filter((item) => item.summary)];
    const pageIds = new Set(pages.map((item) => item.id));
    const keptMarks = direction === "undo" ? command.beforeItems : command.afterItems;
    const keptNotes = direction === "undo" ? command.beforeNotes : command.afterNotes;
    const affectedMarks = new Set([...command.beforeItems, ...command.afterItems].map((item) => item.id));
    const affectedNotes = new Set([...command.beforeNotes, ...command.afterNotes].map((item) => item.id));
    virtualPagesRef.current = pages;
    setVirtualPages(pages);
    updateAnnotations((current) => [...current.filter((item) => !affectedMarks.has(item.id)), ...keptMarks]);
    notesRef.current = [...notesRef.current.filter((item) => !affectedNotes.has(item.id)), ...keptNotes];
    setNotes(notesRef.current);
    setActiveVirtualPageId((current) => current !== null && !pageIds.has(current) ? null : current);
  }, [updateAnnotations]);

  const undoTool = useCallback(() => {
    const history = undoHistoryRef.current;
    if (!history.length) return;
    const command = history[history.length - 1];
    const nextUndo = history.slice(0, -1);
    const nextRedo = [...redoHistoryRef.current.slice(-79), command];
    undoHistoryRef.current = nextUndo;
    redoHistoryRef.current = nextRedo;
    setUndoHistory(nextUndo);
    setRedoHistory(nextRedo);
    if (command.type === "workspace-page") applyWorkspacePageCommand(command, "undo");
    else updateAnnotations((current) => applyAnnotationCommand(current, command, "undo"));
    setSelectedIds([]);
  }, [applyWorkspacePageCommand, updateAnnotations]);

  const redoTool = useCallback(() => {
    const history = redoHistoryRef.current;
    if (!history.length) return;
    const command = history[history.length - 1];
    const nextRedo = history.slice(0, -1);
    const nextUndo = [...undoHistoryRef.current.slice(-79), command];
    redoHistoryRef.current = nextRedo;
    undoHistoryRef.current = nextUndo;
    setRedoHistory(nextRedo);
    setUndoHistory(nextUndo);
    if (command.type === "workspace-page") applyWorkspacePageCommand(command, "redo");
    else updateAnnotations((current) => applyAnnotationCommand(current, command, "redo"));
    setSelectedIds([]);
  }, [applyWorkspacePageCommand, updateAnnotations]);

  /**
   * Mirrors the local store to the server shortly after it settles. The device
   * store is written first and stays authoritative; a failed push is retried on
   * the next save or when the connection returns.
   */
  const scheduleServerSync = useCallback((delay = SERVER_SYNC_DELAY_MS) => {
    if (serverSyncTimerRef.current) window.clearTimeout(serverSyncTimerRef.current);
    serverSyncTimerRef.current = window.setTimeout(() => {
      serverSyncTimerRef.current = null;
      const sync = serverSyncRef.current;
      if (!sync?.isLoaded()) return;
      const savedAt = new Date().toISOString();
      const descriptor = focusDescriptorRef.current;
      void sync.push({
        savedAt,
        view: { page: pageRef.current, zoom: zoomRef.current },
        notes: notesRef.current,
        annotations: annotationsRef.current,
        virtualPages: virtualPagesRef.current
      }).then((result) => {
        // The shared offline queue forgets this document only once the
        // server holds everything saved before this push.
        if (result?.status === "synced" && descriptor) void acknowledgeFocusDocument(descriptor.userId, descriptor, savedAt).catch(() => undefined);
      });
    }, delay);
  }, []);

  /** Records in the shared offline queue that this document has unsynced changes. */
  const markDocumentDirty = useCallback((target = null) => {
    const descriptor = focusDescriptorRef.current;
    if (!descriptor?.userId) return;
    if (target && (target.owner !== descriptor.owner || target.materialSlug !== descriptor.materialSlug || target.sheetSlug !== descriptor.sheetSlug)) return;
    void markFocusDocumentDirty(descriptor.userId, descriptor).catch(() => undefined);
  }, []);

  /**
   * Writes only the pages whose ink actually changed. Every edit path produces
   * new annotation objects, so identity signatures detect an erase or a
   * transform that keeps an id, without serializing anything.
   */
  const persistWorkspace = useCallback(async (target = null) => {
    if (!hydratedRef.current) return;
    const document = target || { owner: ownerKey, materialSlug, sheetSlug: storageSlug };
    measureViewPositionRef.current?.();
    const view = {
      page: pageRef.current,
      zoom: zoomRef.current,
      zoomFitBasis: minimumPdfZoom(),
      scrollLeft: viewPositionRef.current.left,
      scrollTop: viewPositionRef.current.top,
      pageOffset: viewPositionRef.current.pageOffset
    };
    const grouped = groupAnnotationsByPage(annotationsRef.current);
    const signatures = performanceMonitorRef.current.measure("annotationSave", () => pageSignatures(grouped, revisionIndexRef.current));
    const { changed, removed } = changedPages(savedPageSignaturesRef.current, signatures);
    if (storageModeRef.current === "local") {
      try {
        window.localStorage.setItem(
          catalogWorkspaceStorageKey(document.owner, document.materialSlug, document.sheetSlug),
          serializeCatalogWorkspace({ annotations: annotationsRef.current, notes: notesRef.current, virtualPages: virtualPagesRef.current, ...view })
        );
        savedPageSignaturesRef.current = signatures;
        setSaveState("saved");
        setSaveErrorReason("");
        markDocumentDirty(target);
        if (!target) scheduleServerSync();
      } catch (error) {
        setSaveState("error");
        setSaveErrorReason(localSaveError(error, currentAppLocale()));
      }
      return;
    }
    const pages = new Map();
    for (const pageNumber of changed) pages.set(pageNumber, grouped.get(pageNumber) || []);
    try {
      await annotationStoreRef.current.writeDocument({
        owner: document.owner,
        materialSlug: document.materialSlug,
        sheetSlug: document.sheetSlug,
        view,
        notes: notesRef.current,
        virtualPages: virtualPagesRef.current,
        pages,
        removedPages: removed
      });
      savedPageSignaturesRef.current = signatures;
      setSaveState("saved");
      setSaveErrorReason("");
      markDocumentDirty(target);
      // A save made for the sheet being left belongs to that sheet, not this sync.
      if (!target) scheduleServerSync();
    } catch (error) {
      // The signatures are deliberately not advanced, so the next save retries
      // exactly the pages that failed.
      setSaveState("error");
      setSaveErrorReason(localSaveError(error, currentAppLocale()));
    }
  }, [markDocumentDirty, materialSlug, minimumPdfZoom, ownerKey, scheduleServerSync, storageSlug]);

  persistWorkspaceRef.current = persistWorkspace;

  useEffect(() => {
    let active = true;
    // Switching sheet or account keeps this component mounted, so the sheet
    // being left has to be written before its state is replaced.
    const previous = openDocumentRef.current;
    if (hydratedRef.current && previous && (previous.materialSlug !== materialSlug || previous.sheetSlug !== storageSlug || previous.owner !== ownerKey)) {
      persistWorkspaceRef.current?.(previous);
    }
    hydratedRef.current = false;
    savedPageSignaturesRef.current = new Map();
    setRestored(null);
    setRevealedCoverIds(new Set());
    setCoverSelecting(false);
    setClipSelecting(false);
    documentSearch.clear();
    setSaveState("idle");
    setSaveErrorReason("");
    const legacyKey = catalogWorkspaceStorageKey(ownerKey, materialSlug, storageSlug);
    const store = annotationStoreRef.current;

    async function hydrate() {
      let snapshot = null;
      try {
        await store.open();
        if (!active) return;
        await store.migrateLegacyDocument({
          owner: ownerKey,
          materialSlug,
          sheetSlug: storageSlug,
          legacyKey,
          parse: parseCatalogWorkspace
        });
        if (!active) return;
        snapshot = await store.readDocument({ owner: ownerKey, materialSlug, sheetSlug: storageSlug });
        // A canceled scope must not change the current document's storage mode.
        if (!active) return;
        storageModeRef.current = "indexeddb";
      } catch {
        if (!active) return;
        // Private browsing modes can refuse IndexedDB entirely. The workspace
        // stays usable on the previous localStorage path rather than losing
        // persistence altogether.
        storageModeRef.current = "local";
        const legacy = loadStoredWorkspace(ownerKey, materialSlug, storageSlug);
        snapshot = legacy ? { view: legacy, notes: legacy.notes, annotations: legacy.annotations, virtualPages: legacy.virtualPages } : null;
      }
      if (!active) return;
      const restoredVirtualPages = sanitizeVirtualPages(snapshot?.virtualPages);
      const virtualIds = new Set(restoredVirtualPages.map((item) => item.id));
      const restoredAnnotations = (snapshot?.annotations || []).filter((item) => !isVirtualPageKey(item.page) || virtualIds.has(item.page));
      const restoredNotes = (snapshot?.notes || []).filter((item) => !isVirtualPageKey(item.page) || virtualIds.has(item.page));
      virtualPagesRef.current = restoredVirtualPages;
      setVirtualPages(restoredVirtualPages);
      setActiveVirtualPageId(null);
      annotationsRef.current = restoredAnnotations;
      notesRef.current = restoredNotes;
      savedPageSignaturesRef.current = pageSignatures(groupAnnotationsByPage(restoredAnnotations), revisionIndexRef.current);
      setAnnotations(restoredAnnotations);
      setNotes(restoredNotes);
      const view = snapshot?.view;
      if (view) {
        viewPositionRef.current = { left: view.scrollLeft, top: view.scrollTop, pageOffset: view.pageOffset };
        if (rememberZoomLevelRef.current && Number.isFinite(view.zoom)) {
          const nextZoom = zoomFromStoredView(view);
          const storedBasis = Number(view.zoomFitBasis);
          pdfZoomModeRef.current = Number.isFinite(storedBasis) && storedBasis > 0 && Math.abs(Number(view.zoom) - storedBasis) > .001
            ? "manual"
            : "fit";
          zoomRef.current = nextZoom;
          setZoom(nextZoom);
        }
      }
      hydratedRef.current = true;
      openDocumentRef.current = { owner: ownerKey, materialSlug, sheetSlug: storageSlug };
      setRestored(snapshot || {});
      setSaveState(snapshot ? "saved" : "idle");
    }

    hydrate();
    return () => { active = false; };
  // `clampReaderZoom` and the remember-* refs are read once per document load.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [materialSlug, ownerKey, storageSlug]);

  // One server mirror per document and account. A sheet without a server
  // document (a build fixture, or one the reader cannot reach) stays local.
  // Copied marks sync under the copy's own id, through the same routes a private
  // sheet uses; everything else about the sheet (Active Study, reading credit)
  // stays the catalog sheet's.
  const copyMarksId = marksSet?.id || "";
  const catalogDocumentId = copyMarksId || catalogDocument?.id || "";
  const catalogDocumentVersionId = copyMarksId || catalogDocument?.versionId || "";
  // The scope travels with the sync so the server files these marks under the
  // document that was actually marked, not under the sheet's version.
  const scopeEdition = copyMarksId ? "university" : documentScope?.edition || "university";
  const scopeView = copyMarksId ? "study" : documentScope?.view || "study";
  const [serverLoadAttempt, setServerLoadAttempt] = useState(0);
  useEffect(() => {
    const sync = catalogDocumentId && catalogDocumentVersionId
      ? createCatalogServerSync({
        documentId: catalogDocumentId,
        documentVersionId: catalogDocumentVersionId,
        scope: { edition: scopeEdition, view: scopeView },
        // A Sheet Summary has no catalog document of its own, so its marks sync
        // while its notes and last page stay on the device.
        workspaceDocumentId: scopeView === "summary" ? null : catalogDocumentId,
        owner: ownerKey,
        ...(personal || copyMarksId ? { catalog: personalWorkspaceApi } : {})
      })
      : null;
    serverSyncRef.current = sync;
    serverLoadStartedRef.current = null;
    const descriptor = sync && user?.id ? {
      userId: String(user.id),
      documentId: catalogDocumentId,
      documentVersionId: catalogDocumentVersionId,
      scope: { edition: scopeEdition, view: scopeView },
      workspaceDocumentId: scopeView === "summary" ? null : catalogDocumentId,
      owner: ownerKey,
      kind: personal || copyMarksId ? "personal" : "catalog",
      materialSlug,
      sheetSlug: storageSlug,
      pageCount: pageCountRef.current
    } : null;
    focusDescriptorRef.current = descriptor;
    const unregister = descriptor ? registerOpenFocusDocument(descriptor) : null;
    return () => {
      if (serverSyncTimerRef.current) window.clearTimeout(serverSyncTimerRef.current);
      serverSyncTimerRef.current = null;
      if (serverSyncRef.current === sync) serverSyncRef.current = null;
      unregister?.();
    };
  // The descriptor is rebuilt only when the synced document changes; the
  // slugs and account are part of that identity already.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogDocumentId, catalogDocumentVersionId, copyMarksId, ownerKey, scopeEdition, scopeView]);
  useEffect(() => {
    pageCountRef.current = pageCount;
    if (focusDescriptorRef.current) focusDescriptorRef.current = { ...focusDescriptorRef.current, pageCount };
  }, [pageCount]);

  // The server's copy is read once the local one is restored and the PDF has
  // reported its page count, then merged into what this device holds.
  useEffect(() => {
    const sync = serverSyncRef.current;
    if (!sync || !restored || !pdfDocumentReady || serverLoadStartedRef.current === sync) return;
    serverLoadStartedRef.current = sync;
    sync.load({ pageCount }).then(() => {
      if (serverSyncRef.current !== sync || !hydratedRef.current) return;
      const merged = sync.reconcile({ annotations: annotationsRef.current, notes: notesRef.current, virtualPages: virtualPagesRef.current });
      if (!merged.localChanged) {
        scheduleServerSync(0);
        return;
      }
      // Another device's work arrives as a change like any other: the autosave
      // writes it to this device and then pushes this device's own changes.
      updateAnnotations(merged.annotations);
      virtualPagesRef.current = merged.virtualPages;
      setVirtualPages(merged.virtualPages);
      notesRef.current = merged.notes;
      setNotes(merged.notes);
      setSelectedIds([]);
      undoHistoryRef.current = [];
      redoHistoryRef.current = [];
      setUndoHistory([]);
      setRedoHistory([]);
    }).catch(() => {
      // Offline, or the server is unreachable: stay local, retry on reconnect.
      if (serverLoadStartedRef.current === sync) serverLoadStartedRef.current = null;
    });
  }, [catalogDocumentId, pageCount, pdfDocumentReady, restored, scheduleServerSync, serverLoadAttempt, updateAnnotations]);

  // Work done offline is sent when the connection comes back.
  useEffect(() => subscribeConnection((connection) => {
    if (connection.status === "connected") {
      const sync = serverSyncRef.current;
      if (sync && !sync.isLoaded()) setServerLoadAttempt((attempt) => attempt + 1);
      else if (sync?.hasPending()) void sync.retry();
    }
  }), []);

  // A revision probe is cheap enough to run while the reader is open. Full
  // state is downloaded only after either durable revision changes.
  useEffect(() => {
    let disposed = false;
    let running = false;
    const refreshServerState = async () => {
      if (disposed || running || document.visibilityState === "hidden") return;
      const sync = serverSyncRef.current;
      if (!sync?.isLoaded()) return;
      running = true;
      try {
        const result = await sync.refresh({
          pageCount,
          getLocal: () => ({ annotations: annotationsRef.current, notes: notesRef.current, virtualPages: virtualPagesRef.current })
        });
        if (disposed || serverSyncRef.current !== sync) return;
        if (result.documentChanged) {
          setFocusMessage(translateRef.current("focus.thisSheetWasUpdatedYour"));
          onDocumentChanged();
          return;
        }
        if (!result.changed) return;
        if (!result.localChanged) {
          // The remote revision may have advanced because an earlier response
          // was lost. Retry any pending mutation against the refreshed base.
          scheduleServerSync(0);
          return;
        }
        updateAnnotations(result.annotations);
        virtualPagesRef.current = result.virtualPages;
        setVirtualPages(result.virtualPages);
        notesRef.current = result.notes;
        setNotes(result.notes);
        setSelectedIds([]);
        undoHistoryRef.current = [];
        redoHistoryRef.current = [];
        setUndoHistory([]);
        setRedoHistory([]);
      } catch {
        // The local copy remains authoritative while offline; reconnect and
        // the next bounded probe will retry without losing edits.
      } finally {
        running = false;
      }
    };
    const handleVisibility = () => { if (document.visibilityState === "visible") void refreshServerState(); };
    window.addEventListener("focus", refreshServerState);
    document.addEventListener("visibilitychange", handleVisibility);
    const interval = window.setInterval(refreshServerState, 60_000);
    return () => {
      disposed = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshServerState);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [onDocumentChanged, pageCount, scheduleServerSync, updateAnnotations]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    const measurePageOffset = () => {
      const stageBounds = stage.getBoundingClientRect();
      const currentPage = stage.querySelector(`[data-workspace-page="${activePageKey}"]`);
      const pageBounds = currentPage?.getBoundingClientRect();
      return pageBounds?.height
        ? Math.min(1, Math.max(0, (stageBounds.top - pageBounds.top) / pageBounds.height))
        : 0;
    };
    // Scroll offsets are free to read; the page offset needs two layout reads,
    // so it is measured once the scroll pauses rather than on every scroll event.
    // The stale flag outlives this effect: the current page can change after
    // the last scroll event, and the offset must be taken against the new one.
    measureViewPositionRef.current = () => {
      if (!pageOffsetStaleRef.current) return;
      pageOffsetStaleRef.current = false;
      viewPositionRef.current = { left: stage.scrollLeft, top: stage.scrollTop, pageOffset: measurePageOffset() };
    };
    const rememberView = () => {
      viewPositionRef.current = { ...viewPositionRef.current, left: stage.scrollLeft, top: stage.scrollTop };
      pageOffsetStaleRef.current = true;
      if (viewSaveTimerRef.current) window.clearTimeout(viewSaveTimerRef.current);
      viewSaveTimerRef.current = window.setTimeout(() => { persistWorkspace(); }, 500);
    };
    stage.addEventListener("scroll", rememberView, { passive: true });
    return () => {
      measureViewPositionRef.current = null;
      stage.removeEventListener("scroll", rememberView);
      if (viewSaveTimerRef.current) window.clearTimeout(viewSaveTimerRef.current);
      viewSaveTimerRef.current = null;
    };
  }, [activePageKey, persistWorkspace]);

  useEffect(() => {
    if (!workspaceReady) return undefined;
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      setSaveState((current) => current === "error" ? current : "saving");
      const persistWhenIdle = () => {
        saveIdleRef.current = null;
        persistWorkspace();
      };
      if (window.requestIdleCallback) saveIdleRef.current = window.requestIdleCallback(persistWhenIdle, { timeout: 1_000 });
      else saveIdleRef.current = window.setTimeout(persistWhenIdle, 0);
    }, AUTOSAVE_IDLE_MS);
    return () => {
      window.clearTimeout(saveTimerRef.current);
      if (saveIdleRef.current !== null && window.cancelIdleCallback) window.cancelIdleCallback(saveIdleRef.current);
      else if (saveIdleRef.current !== null) window.clearTimeout(saveIdleRef.current);
      saveIdleRef.current = null;
    };
  }, [annotations, notes, page, persistWorkspace, virtualPages, workspaceReady, zoom]);

  useEffect(() => {
    // `pagehide` is unreliable on mobile, and a debounced save that is still
    // waiting when the tab is hidden would never run at all.
    const saveBeforeLeave = () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
      persistWorkspace();
    };
    const saveWhenHidden = () => {
      if (window.document.visibilityState === "hidden") saveBeforeLeave();
    };
    window.addEventListener("pagehide", saveBeforeLeave);
    window.document.addEventListener("visibilitychange", saveWhenHidden);
    return () => {
      window.removeEventListener("pagehide", saveBeforeLeave);
      window.document.removeEventListener("visibilitychange", saveWhenHidden);
    };
  }, [persistWorkspace]);

  // Leaving the workspace cancels the debounce timer, so the last edits are
  // written on the way out instead of being dropped with it.
  useEffect(() => () => {
    const store = annotationStoreRef.current;
    // Finish the final write before releasing this reader's connection. The
    // store also drains hydration/writes already in flight before closing.
    void Promise.resolve(persistWorkspaceRef.current?.()).finally(() => store.close());
  }, []);

  useEffect(() => {
    let active = true;
    focusApi.getLockIn().then((bootstrap) => {
      if (!active) return;
      const unfinished = /** @type {any} */ (bootstrap?.active_session);
      setFocusPayload(isUnfinished(unfinished) ? unfinished : null);
      setFocusStatusChecked(true);
      setNoteDraft("");
    }).catch((error) => { if (active) { setFocusStatusChecked(error?.status === 0); setFocusMessage(error.message || translateRef.current("focus.focusStatusFailed")); } });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    setBookmarked(false);
    // Bookmarks name catalog sheets; a student's own sheet is not one.
    if (personal) return undefined;
    progressApi.getCatalogBookmark(materialSlug, sheetSlug)
      .then(() => { if (active) setBookmarked(true); })
      .catch((error) => {
        if (active && error?.status !== 404) setFocusMessage(error.message || translateRef.current("focus.bookmarkStatusFailed"));
      });
    return () => { active = false; };
  }, [materialSlug, personal, sheetSlug]);

  useEffect(() => {
    const sessionId = focusPayload?.session?.id;
    if (!sessionId || !isUnfinished(focusPayload) || focusPayload.session.experience_version === 2) return undefined;
    const refresh = () => { if (!document.hidden) focusApi.getLockInSession(sessionId).then(setFocusPayload).catch(() => {}); };
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, [focusPayload]);

  useEffect(() => {
    const syncFullscreenState = () => {
      const fullscreen = document.fullscreenElement === rootRef.current;
      setIsDocumentFullscreen(fullscreen);
    };
    document.addEventListener("fullscreenchange", syncFullscreenState);
    return () => document.removeEventListener("fullscreenchange", syncFullscreenState);
  }, []);
  // Browsers without element full screen (iPhone Safari) get the CSS mode;
  // Escape leaves it as it leaves the native one, once no panel is open.
  useEffect(() => {
    if (!isDocumentFullscreen || openSurface) return undefined;
    const leave = (event) => {
      if (event.key !== "Escape" || event.defaultPrevented || document.fullscreenElement) return;
      setIsDocumentFullscreen(false);
    };
    document.addEventListener("keydown", leave);
    return () => document.removeEventListener("keydown", leave);
  }, [isDocumentFullscreen, openSurface]);

  useEffect(() => {
    if (!keepScreenAwake || !wakeLockSupported) {
      wakeLockRef.current?.release?.().catch(() => {});
      wakeLockRef.current = null;
      return undefined;
    }
    let disposed = false;
    const acquireWakeLock = async () => {
      if (document.visibilityState !== "visible" || wakeLockRef.current) return;
      try {
        const lock = await navigator.wakeLock.request("screen");
        if (disposed) await lock.release();
        else {
          wakeLockRef.current = lock;
          lock.addEventListener?.("release", () => { if (wakeLockRef.current === lock) wakeLockRef.current = null; });
        }
      } catch (error) {
        if (!disposed) {
          setKeepScreenAwake(false);
          setFocusMessage(error?.message || translateRef.current("focus.wakeLockUnavailable"));
        }
      }
    };
    const handleVisibility = () => { if (document.visibilityState === "visible") acquireWakeLock(); };
    acquireWakeLock();
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", handleVisibility);
      wakeLockRef.current?.release?.().catch(() => {});
      wakeLockRef.current = null;
    };
  }, [keepScreenAwake, wakeLockSupported]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.target?.closest?.(".knowledge-panel")) return;
      if (isTypingTarget(event.target)) return;
      const commandKey = event.ctrlKey || event.metaKey;
      if (event.key === "Escape" && coverSelecting) {
        setCoverSelecting(false);
        setActiveTool("hand");
        setFocusMessage("");
        return;
      }
      // The canvases hold no text the browser could find, so Find opens the
      // reader's own search once the document is open.
      if (commandKey && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "f" && pdfDocumentProxyRef.current) {
        event.preventDefault();
        setOpenSurface("search");
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redoTool(); else undoTool();
        return;
      }
      const selectionCommand = commandKey ? { c: "copy", x: "cut", v: "paste", d: "duplicate" }[event.key.toLowerCase()] : null;
      if (selectionCommand && (selectionCommand === "paste" ? selectionClipboardRef.current.length : selectedAnnotations.length)) {
        event.preventDefault();
        selectionCommandsRef.current[selectionCommand]?.();
        return;
      }
      if (event.key === "Escape" && selectedAnnotations.length && !event.defaultPrevented) {
        setSelectedIds([]);
        return;
      }
      // Space is the hold-to-pan modifier, but it is also how a keyboard user
      // activates the focused toolbar button. The focused control wins.
      if (event.code === "Space" && !event.repeat && !commandKey && !event.altKey && !isStageControl(event.target)) {
        event.preventDefault();
        spacePanRef.current = true;
        previousToolRef.current = activeToolRef.current;
        setActiveTool("hand");
        setOpenSurface(null);
        return;
      }
      if (event.repeat || event.altKey) return;
      // Single-letter shortcuts must never fire for browser and OS commands
      // such as Ctrl+S, Ctrl+P, or Cmd+L.
      if (!commandKey) {
        const shortcuts = { p: "pen", b: "pencil", h: "highlighter", e: "eraser", l: "select", s: "shapes" };
        const shortcutTool = shortcuts[event.key.toLowerCase()];
        if (shortcutTool) {
          event.preventDefault();
          setActiveTool(shortcutTool);
          setOpenSurface(null);
        }
        // Page keys move the reader itself. Changing only the page number left
        // the indicator, the note editor, and the ink layer on a page that was
        // never brought into view. Composite widgets keep their own arrow
        // semantics.
        const inCompositeWidget = Boolean(event.target?.closest?.("[role='tablist'], [role='radiogroup'], [role='group']"));
        const pageStep = event.key === "ArrowLeft" || event.key === "PageUp"
          ? -1
          : event.key === "ArrowRight" || event.key === "PageDown"
            ? 1
            : 0;
        if (pageStep && !inCompositeWidget) {
          event.preventDefault();
          jumpToPageRef.current?.(pageRef.current + pageStep);
        }
        if (event.key === "Home" && !inCompositeWidget) {
          event.preventDefault();
          jumpToPageRef.current?.(1);
        }
        if (event.key === "End" && !inCompositeWidget) {
          event.preventDefault();
          jumpToPageRef.current?.(accessiblePageCount);
        }
      }
      if ((event.key === "Delete" || event.key === "Backspace") && selectedAnnotations.length && !selectedAnnotations.some((item) => item.locked)) {
        event.preventDefault();
        selectionCommandsRef.current.delete?.();
      }
    };
    const handleKeyUp = (event) => {
      if (event.code !== "Space" || !spacePanRef.current) return;
      spacePanRef.current = false;
      setActiveTool(previousToolRef.current);
      setOpenSurface(null);
    };
    if (!paneActive || !workspaceReady) return undefined;
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => { window.removeEventListener("keydown", handleKeyDown); window.removeEventListener("keyup", handleKeyUp); };
  }, [accessiblePageCount, activePageKey, coverSelecting, page, paneActive, redoTool, runCommand, selectedAnnotations, undoTool, workspaceReady]);

  // Ids that no longer exist (undone, deleted, restored over) fall out of the
  // selection; nothing else ends it behind the student's back.
  useEffect(() => {
    setSelectedIds((current) => {
      if (!current.length) return current;
      const existing = new Set(annotations.map((item) => item.id));
      return current.every((id) => existing.has(id)) ? current : current.filter((id) => existing.has(id));
    });
  }, [annotations]);

  useEffect(() => {
    if (!selectedIds.length) setSelectionActionsOpen(false);
  }, [selectedIds]);

  // The context toolbar lives in the reader, outside the zoomed document, so
  // it keeps one size at every zoom. It follows the selection's box on screen
  // through scrolling, zooming, docking panels and rotation, and prefers the
  // space above the selection.
  useLayoutEffect(() => {
    const toolbar = selectionToolbarRef.current;
    const reader = readerRef.current;
    const stage = stageRef.current;
    // While dragging, the toolbar is hidden and measuring every frame would
    // only force layout in the middle of the move.
    if (!toolbar || !reader || !selectedBounds || selectionPage === null || selectionDragging) return undefined;
    let frame = 0;
    const place = () => {
      frame = 0;
      const pageElement = stage?.querySelector(`[data-workspace-page="${selectionPage}"]`) || documentRef.current;
      if (!pageElement) return;
      const pageRect = pageElement.getBoundingClientRect();
      const readerRect = reader.getBoundingClientRect();
      const selection = {
        left: pageRect.left - readerRect.left + (selectedBounds.x / PAGE_SPACE) * pageRect.width,
        top: pageRect.top - readerRect.top + (selectedBounds.y / PAGE_SPACE) * pageRect.height,
        width: (selectedBounds.width / PAGE_SPACE) * pageRect.width,
        height: (selectedBounds.height / PAGE_SPACE) * pageRect.height
      };
      const topInset = Number.parseFloat(window.getComputedStyle(rootRef.current || reader).getPropertyValue("--workspace-toolbar-height")) || 0;
      const onScreen = selection.top + selection.height > topInset
        && selection.top < readerRect.height
        && selection.left + selection.width > 0
        && selection.left < readerRect.width;
      const position = contextToolbarPosition({
        selection,
        toolbar: { width: toolbar.offsetWidth, height: toolbar.offsetHeight },
        reader: { width: readerRect.width, height: readerRect.height },
        topInset
      });
      toolbar.style.transform = `translate3d(${position.left}px, ${position.top}px, 0)`;
      toolbar.dataset.placement = position.placement;
      toolbar.dataset.offscreen = onScreen ? "false" : "true";
      toolbar.dataset.ready = "true";
    };
    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(place); };
    place();
    stage?.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    const observer = typeof window.ResizeObserver === "function" ? new window.ResizeObserver(schedule) : null;
    observer?.observe(reader);
    observer?.observe(toolbar);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      stage?.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      observer?.disconnect();
    };
  }, [selectedBounds, selectionPage, zoom, selectionDragging, selectionActionsOpen]);

  // The live canvas keeps the finished stroke until React has painted the same
  // stroke as SVG, so a heavy page hands over without a visible gap.
  useEffect(() => {
    const handoff = inkHandoffRef.current;
    if (!handoff) return undefined;
    if (annotations.some((annotation) => annotation.id === handoff.id)) {
      inkHandoffRef.current = null;
      liveStrokeCanvasRef.current?.clear();
      return undefined;
    }
    // The stroke never arrived (undo, or a gesture claimed it). Do not strand
    // pixels the workspace can no longer account for.
    const timer = window.setTimeout(() => {
      inkHandoffRef.current = null;
      liveStrokeCanvasRef.current?.clear();
    }, 1_200);
    return () => window.clearTimeout(timer);
  }, [annotations]);

  // Workspace messages describe something that just happened. Leaving them on
  // screen makes a stale sentence look like the current state of the document.
  useEffect(() => {
    if (!focusMessage) return undefined;
    const timer = window.setTimeout(() => setFocusMessage(""), STATUS_MESSAGE_MS);
    return () => window.clearTimeout(timer);
  }, [focusMessage]);

  /**
   * Page geometry for the sheet currently being annotated. Every coalesced
   * pointer sample used to run its own `querySelector` plus
   * `getBoundingClientRect`; the stage scroll position is pinned for the whole
   * stroke, so measuring once per gesture is both cheaper and more consistent.
   */
  function pageBoundsFor(annotationPage) {
    const cache = pageGeometryCacheRef.current;
    if (cache.page === annotationPage && cache.bounds) return cache.bounds;
    const pageElement = stageRef.current?.querySelector(`[data-workspace-page="${annotationPage}"]`) || documentRef.current;
    const bounds = pageElement?.getBoundingClientRect() || stageRef.current?.getBoundingClientRect() || null;
    if (bounds && drawingScrollLockRef.current.active) pageGeometryCacheRef.current = { page: annotationPage, bounds };
    return bounds;
  }

  function invalidatePageGeometry() {
    pageGeometryCacheRef.current = { page: null, bounds: null };
  }

  function documentPoint(clientX, clientY, fixedPage) {
    if (fixedPage) {
      const bounds = pageBoundsFor(fixedPage);
      if (!bounds) return { x: 0, y: 0, page: fixedPage };
      return { ...pagePointFromClient(clientX, clientY, bounds, PAGE_SPACE, PAGE_SPACE), page: fixedPage };
    }
    const pageElement = /** @type {HTMLElement|null} */ (document.elementFromPoint(clientX, clientY)?.closest?.("[data-workspace-page]") || null);
    const bounds = pageElement?.getBoundingClientRect() || documentRef.current?.getBoundingClientRect() || stageRef.current?.getBoundingClientRect();
    if (!bounds) return { x: 0, y: 0, page };
    return { ...pagePointFromClient(clientX, clientY, bounds, PAGE_SPACE, PAGE_SPACE), page: Number(pageElement?.dataset.workspacePage) || activePageKey };
  }

  function pageUnitsPerCssPixel(annotationPage) {
    return PAGE_SPACE / Math.max(1, pageBoundsFor(annotationPage)?.width || PAGE_SPACE);
  }

  function pagePointScreenDistance(first, second, annotationPage) {
    const bounds = pageBoundsFor(annotationPage);
    const scaleX = Math.max(1, bounds?.width || PAGE_SPACE) / PAGE_SPACE;
    const scaleY = Math.max(1, bounds?.height || PAGE_SPACE) / PAGE_SPACE;
    return Math.hypot((second.x - first.x) * scaleX, (second.y - first.y) * scaleY);
  }

  function hideStylusHover() {
    const gesture = gestureRef.current;
    if (gesture.hoverRafId !== null) cancelAnimationFrame(gesture.hoverRafId);
    gesture.hoverRafId = null;
    if (stylusHoverRef.current) stylusHoverRef.current.style.opacity = "0";
  }

  function renderStylusHover(point) {
    const preview = stylusHoverRef.current;
    if (!preview || !point) return;
    const hoverPage = documentPoint(point.x, point.y).page;
    const pageWidth = Math.max(1, pageBoundsFor(hoverPage)?.width || PAGE_SPACE);
    const size = activeToolRef.current === "eraser"
      ? eraserSize
      : Math.max(5, (brushSize * 2 * pageWidth) / PAGE_SPACE);
    preview.dataset.tool = activeToolRef.current;
    preview.dataset.profile = activeToolRef.current === "pen" ? penProfile : activeToolRef.current;
    preview.style.setProperty("--workspace-hover-color", activeColor);
    preview.style.setProperty("--workspace-hover-opacity", String(activeToolRef.current === "highlighter" ? highlighterOpacity : activeToolRef.current === "pencil" ? pencilOpacity : brushOpacity));
    preview.style.setProperty("--workspace-hover-line", `${Math.max(1, Math.min(size, size * (activeToolRef.current === "highlighter" ? .72 : .28)))}px`);
    preview.style.width = `${size}px`;
    preview.style.height = `${size}px`;
    preview.style.transform = `translate3d(${point.x - size / 2}px, ${point.y - size / 2}px, 0)`;
    preview.style.opacity = "1";
  }

  function hideEraserHitbox() {
    const gesture = gestureRef.current;
    if (gesture.eraserHitboxRafId != null) cancelAnimationFrame(gesture.eraserHitboxRafId);
    gesture.eraserHitboxRafId = null;
    gesture.eraserHitboxPoint = null;
    if (eraserHitboxRef.current) eraserHitboxRef.current.style.opacity = "0";
  }

  /**
   * Draws the eraser's real reach under the pointer. Erasing measures a circle
   * of `eraserSize` CSS pixels on the rendered page at every zoom (see
   * `eraserScaleForPage`), so the outline is exactly that size on screen.
   * Mouse and stylus show it while hovering and erasing; a finger only while
   * it is actually erasing.
   */
  function updateEraserHitbox(event) {
    const hitbox = eraserHitboxRef.current;
    const gesture = gestureRef.current;
    const erasing = gesture.mode === INTERACTION_STATE.ERASING && gesture.drawingPointerId === event.pointerId;
    const hovering = (event.pointerType === "pen" || event.pointerType === "mouse") && gesture.drawingPointerId === null
      && !gesture.pan && gesture.mode !== INTERACTION_STATE.PINCHING;
    if (!hitbox || activeToolRef.current !== "eraser" || annotationsHidden || (!erasing && !hovering)) {
      hideEraserHitbox();
      return;
    }
    gesture.eraserHitboxPoint = { x: event.clientX, y: event.clientY };
    if (gesture.eraserHitboxRafId != null) return;
    gesture.eraserHitboxRafId = requestAnimationFrame(() => {
      const current = gestureRef.current;
      current.eraserHitboxRafId = null;
      const point = current.eraserHitboxPoint;
      const element = eraserHitboxRef.current;
      if (!point || !element) return;
      element.style.width = `${eraserSize}px`;
      element.style.height = `${eraserSize}px`;
      element.style.transform = `translate3d(${point.x - eraserSize / 2}px, ${point.y - eraserSize / 2}px, 0)`;
      element.style.opacity = "1";
    });
  }

  function updateStylusHover(event) {
    const preview = stylusHoverRef.current;
    // The eraser has its own outline that matches its real reach.
    if (!preview || event.pointerType !== "pen" || event.buttons || Number(event.pressure) > 0 || !DRAWING_TOOLS.has(activeToolRef.current) || activeToolRef.current === "eraser") {
      hideStylusHover();
      return;
    }
    // Hover moves arrive as fast as the stylus reports them. One measured paint
    // per frame is enough, and it keeps hit-testing off the pointer path.
    const gesture = gestureRef.current;
    gesture.hoverPoint = { x: event.clientX, y: event.clientY };
    if (gesture.hoverRafId !== null) return;
    gesture.hoverRafId = requestAnimationFrame(() => {
      gesture.hoverRafId = null;
      renderStylusHover(gestureRef.current.hoverPoint);
    });
  }

  function eventSamples(event, fixedPage) {
    const nativeEvent = event.nativeEvent || event;
    return samplesFromPointerEvent(nativeEvent, (clientX, clientY) => documentPoint(clientX, clientY, fixedPage));
  }

  function isLiveStroke(annotation) {
    return ["pen", "pencil", "highlighter"].includes(annotation?.type);
  }

  function scheduleLiveStrokeDraw() {
    const gesture = gestureRef.current;
    if (gesture.liveStrokeRafId !== null) return;
    gesture.liveStrokeRafId = requestAnimationFrame(() => {
      gesture.liveStrokeRafId = null;
      const draft = draftRef.current;
      if (draft?.type === "lasso" && liveStrokeCanvasRef.current?.pageNumber === draft.page) {
        performanceMonitorRef.current.measure("drawingFrame", () => liveStrokeCanvasRef.current.drawLasso(draft.points));
        performanceMonitorRef.current.increment("liveCanvasRedraws");
      } else if (isLiveStroke(draft) && liveStrokeCanvasRef.current?.pageNumber === draft.page) {
        const predicted = gesture.predictedStrokePoints;
        const diagnostics = inkDebugEnabled ? inkInputControllerRef.current.getDiagnostics() : null;
        // Predicted samples stay separate from the committed buffer so the
        // renderer knows which geometry it is allowed to append rather than
        // repaint.
        const renderMetrics = performanceMonitorRef.current.measure("drawingFrame", () => liveStrokeCanvasRef.current.draw(draft, diagnostics, predicted));
        if (renderMetrics && renderMetrics.geometryTime >= 0) performanceMonitorRef.current.record("geometryTime", renderMetrics.geometryTime);
        const sampleTime = Number(draft.points?.at(-1)?.t);
        const latency = Number.isFinite(sampleTime) ? window.performance.now() - sampleTime : -1;
        if (latency >= 0 && latency < 10_000) performanceMonitorRef.current.record("pointerToPaint", latency);
        performanceMonitorRef.current.increment("liveCanvasRedraws");
        if (inkDebugEnabled) window.__lockInInkDiagnostics = diagnostics;
      }
    });
  }

  function setDraft(next) {
    draftRef.current = next;
    if (isLiveStroke(next) || next?.type === "lasso") {
      // The live canvas owns freehand and lasso frames; React only sees
      // committed strokes or the completed lasso selection.
      setDraftAnnotation(null);
      scheduleLiveStrokeDraw();
      return;
    }
    setDraftAnnotation(next);
  }

  /**
   * @param {{ keepCanvas?: boolean }} [options] `keepCanvas` hands the painted
   * stroke over to React instead of wiping it. React commits the SVG one frame
   * or more later, and on a page that already holds hundreds of strokes that
   * gap is long enough to see the ink blink out and back.
   */
  function clearDraft({ keepCanvas = false } = {}) {
    const gesture = gestureRef.current;
    if (gesture.holdTimerId !== null) window.clearTimeout(gesture.holdTimerId);
    gesture.holdTimerId = null;
    gesture.holdAnchorPoint = null;
    gesture.holdStartedAt = null;
    draftRef.current = null;
    gesture.predictedStrokePoints = [];
    inkInputControllerRef.current.reset();
    if (gesture.liveStrokeRafId !== null) cancelAnimationFrame(gesture.liveStrokeRafId);
    gesture.liveStrokeRafId = null;
    if (!keepCanvas) {
      inkHandoffRef.current = null;
      liveStrokeCanvasRef.current?.clear();
    }
    setDraftAnnotation(null);
  }

  function lassoSelectionIds(polygon, annotationPage) {
    const bounds = gestureBounds(polygon);
    if (!bounds || polygon.length < 3) return [];
    const hits = queryAnnotationSpatialIndexBounds(annotationSpatialIndexRef.current, annotationPage, bounds)
      .filter((annotation) => annotationIntersectsPolygon(annotation, polygon))
      .map((annotation) => annotation.id);
    const groups = new Set(annotationsRef.current.filter((item) => hits.includes(item.id) && item.groupId).map((item) => item.groupId));
    return [...new Set([...hits, ...annotationsRef.current.filter((item) => item.page === annotationPage && groups.has(item.groupId) && item.groupId).map((item) => item.id)])];
  }

  function applyHeldRecognition(draftId) {
    const gesture = gestureRef.current;
    const current = draftRef.current;
    if (!current || current.id !== draftId || current.points?.length < 2 || gesture.mode !== INTERACTION_STATE.DRAWING) return;
    const currentEndpoint = current.points.at(-1);
    if (!gesture.holdAnchorPoint || pagePointScreenDistance(currentEndpoint, gesture.holdAnchorPoint, current.page) > HOLD_ENDPOINT_TOLERANCE_PX) return;
    const unitsPerCssPixel = pageUnitsPerCssPixel(current.page);
    const closed = circleToErase && current.type !== "highlighter"
      ? analyzeClosedGesture(current.points, { unitsPerCssPixel })
      : null;
    if (closed?.recognized) {
      const ids = lassoSelectionIds(current.points, current.page);
      if (ids.length) {
        const targetIds = new Set(ids);
        const targets = annotationsRef.current.filter((item) => targetIds.has(item.id));
        runCommand({ type: "remove", items: targets });
        gesture.holdRecognition = { kind: "circle-erase", confidence: closed.confidence };
        gesture.smartSelectionActivated = true;
        clearDraft();
        setFocusMessage(t("focus.annotationsErased", { count: targets.length }));
        return;
      }
    }
    // Shape recognition happens when the pointer is released. The hold timer is
    // retained only for the distinct circle-to-erase gesture.
  }

  function scheduleHoldRecognition() {
    const gesture = gestureRef.current;
    const draft = draftRef.current;
    const supportsHold = ["pen", "pencil", "highlighter"].includes(activeToolRef.current);
    if (!supportsHold || !circleToErase || !isLiveStroke(draft)) return;
    const endpoint = draft.points?.at(-1);
    // Returning to the start closes a circle; it must still re-arm the hold
    // once this gesture has already moved beyond the initial movement guard.
    if (!endpoint || (!gesture.holdAnchorPoint && pagePointScreenDistance(draft.points[0], endpoint, draft.page) < 18)) return;
    if (gesture.holdTimerId !== null && gesture.holdAnchorPoint && pagePointScreenDistance(endpoint, gesture.holdAnchorPoint, draft.page) <= HOLD_ENDPOINT_TOLERANCE_PX) return;
    if (gesture.holdTimerId !== null) window.clearTimeout(gesture.holdTimerId);
    gesture.holdTimerId = null;
    gesture.holdAnchorPoint = { x: endpoint.x, y: endpoint.y };
    gesture.holdStartedAt = window.performance.now();
    const draftId = draft.id;
    gesture.holdTimerId = window.setTimeout(() => {
      gesture.holdTimerId = null;
      applyHeldRecognition(draftId);
    }, HOLD_RECOGNITION_MS);
  }

  function scribbleEraseTargets(stroke) {
    if (!scribbleToErase || stroke?.type !== "pen") return [];
    const analysis = analyzeScribbleGesture(stroke.points);
    if (!analysis.recognized || !analysis.bounds) return [];
    const radius = Math.max(5, stroke.width * 1.25);
    const candidates = queryAnnotationSpatialIndexBounds(annotationSpatialIndexRef.current, stroke.page, {
      x: analysis.bounds.x - radius,
      y: analysis.bounds.y - radius,
      width: analysis.bounds.width + radius * 2,
      height: analysis.bounds.height + radius * 2
    });
    return candidates.filter((annotation) => {
      if (!["pen", "pencil", "highlighter"].includes(annotation.type)) return false;
      const coverage = strokeEraseCoverage(annotation, stroke.points, radius);
      return coverage.coverage >= .12 || coverage.intersectionRuns >= 2;
    });
  }

  /**
   * A text, image or card placed from a menu grows into place once. The class
   * is added to the rendered element directly, so nothing is stored with the
   * annotation and a later remount (scrolling, undo) does not replay it.
   */
  function revealInsertedAnnotation(annotationId) {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const escapedId = globalThis.CSS?.escape ? globalThis.CSS.escape(String(annotationId)) : String(annotationId).replace(/["\\]/g, "\\$&");
    requestAnimationFrame(() => {
      stageRef.current?.querySelectorAll(`[data-annotation-id="${escapedId}"]`).forEach((element) => {
        element.classList.add("is-inserted");
        element.addEventListener("animationend", () => element.classList.remove("is-inserted"), { once: true });
      });
    });
  }

  function setAnnotationPreviewVisibility(annotationId, visible) {
    const escapedId = globalThis.CSS?.escape
      ? globalThis.CSS.escape(String(annotationId))
      : String(annotationId).replace(/["\\]/g, "\\$&");
    stageRef.current?.querySelectorAll(`[data-annotation-id="${escapedId}"]`).forEach((element) => {
      element.style.visibility = visible ? "" : "hidden";
    });
  }

  /**
   * Maps page units into eraser space, where the tip is a true circle on the
   * rendered page. The document view without a PDF keeps plain page units.
   */
  function eraserScaleForPage(annotationPage) {
    if (!sheet?.pdfUrl) return eraserSpaceScale(1);
    const bounds = pageBoundsFor(annotationPage);
    return eraserSpaceScale(bounds?.width ? bounds.height / bounds.width : 1);
  }

  function eraserRadiusForPage(annotationPage) {
    const bounds = pageBoundsFor(annotationPage);
    // Page coordinates use 1000 units on both axes even though a PDF is taller
    // than it is wide. The larger dimension keeps the erased area inside the
    // visible circular tip on either axis.
    return pageRadiusForScreenRadius(eraserSize / 2, Math.max(1, bounds?.width || PAGE_SPACE, bounds?.height || PAGE_SPACE), PAGE_SPACE);
  }

  function scheduleEraserPreview() {
    const gesture = gestureRef.current;
    if (gesture.eraserPreviewRafId !== null) return;
    gesture.eraserPreviewRafId = requestAnimationFrame(() => {
      gesture.eraserPreviewRafId = null;
      const preview = eraserSessionRef.current.getPreview().annotations;
      performanceMonitorRef.current.measure("eraserFrame", () => {
        liveStrokeCanvasRef.current?.drawAnnotations(preview, { svgPreview: eraserMode === ERASER_MODE.PRECISION, hiddenIds: eraserSessionRef.current.getHiddenIds() });
      });
      performanceMonitorRef.current.increment("liveCanvasRedraws");
    });
  }

  function eraseAtPoint(point, annotationPage = page) {
    const radius = eraserRadiusForPage(annotationPage);
    const scale = eraserScaleForPage(annotationPage);
    const previous = eraserSessionRef.current.getLastPoint() || point;
    // The radius is in eraser space; in page units the tip reaches further
    // along the shorter page axis.
    const padding = radius / Math.min(scale.x, scale.y) + 2;
    const candidates = queryAnnotationSpatialIndexBounds(annotationSpatialIndexRef.current, annotationPage, {
      x: Math.min(previous.x, point.x) - padding,
      y: Math.min(previous.y, point.y) - padding,
      width: Math.abs(point.x - previous.x) + padding * 2,
      height: Math.abs(point.y - previous.y) + padding * 2
    });
    const result = eraserSessionRef.current.append(point, { annotationPage, candidates, radius, mode: eraserMode, scale });
    for (const annotationId of result.newlyChangedIds) setAnnotationPreviewVisibility(annotationId, false);
    performanceMonitorRef.current.recordValue?.("eraserCandidates", candidates.length);
    if (result.changed && result.previewChanged) scheduleEraserPreview();
  }

  function clearEraserPreview({ restoreOriginals = true } = {}) {
    const gesture = gestureRef.current;
    if (gesture.eraserPreviewRafId !== null) cancelAnimationFrame(gesture.eraserPreviewRafId);
    gesture.eraserPreviewRafId = null;
    const hiddenIds = eraserSessionRef.current.getHiddenIds();
    if (restoreOriginals) for (const annotationId of hiddenIds) setAnnotationPreviewVisibility(annotationId, true);
    eraserSessionRef.current.cancel();
    liveStrokeCanvasRef.current?.clear();
  }

  function commitEraserGesture() {
    const hiddenIds = eraserSessionRef.current.getHiddenIds();
    if (!hiddenIds.length) {
      clearEraserPreview();
      return;
    }
    for (const annotationId of hiddenIds) setAnnotationPreviewVisibility(annotationId, true);
    const { command: erasure, replacements } = eraserSessionRef.current.finish();
    if (!erasure) return;
    // One eraser drag is one history step, however many marks it touched.
    const command = withCommandPositions(erasure, annotationsRef.current);
    updateAnnotations((current) => applyAnnotationCommand(current, command, "redo"));
    recordCommand(command);
    setSelectedIds((current) => current.flatMap((id) => replacements.has(id) ? replacements.get(id).map((fragment) => fragment.id) : [id]));
    if (gestureRef.current.eraserPreviewRafId !== null) cancelAnimationFrame(gestureRef.current.eraserPreviewRafId);
    gestureRef.current.eraserPreviewRafId = null;
    liveStrokeCanvasRef.current?.clear();
  }

  function applyObjectTransformPreview(after) {
    const replacements = new Map((after || []).map((item) => [item.id, item]));
    updateAnnotations((items) => items.map((item) => replacements.get(item.id) || item));
  }

  function scheduleObjectTransformPreview() {
    const gesture = gestureRef.current;
    if (gesture.transformRafId !== null) return;
    gesture.transformRafId = requestAnimationFrame(() => {
      gesture.transformRafId = null;
      if (gestureRef.current.mode === INTERACTION_STATE.OBJECT_TRANSFORMING && transformRef.current?.after) {
        applyObjectTransformPreview(transformRef.current.after);
      }
    });
  }

  function lockStageForDrawing(pointerId) {
    const stage = stageRef.current;
    if (!stage) return;
    invalidatePageGeometry();
    drawingScrollLockRef.current = {
      active: true,
      pointerId,
      left: stage.scrollLeft,
      top: stage.scrollTop
    };
    stage.classList.add("is-writing-locked");
  }

  function unlockStageForDrawing(pointerId = null) {
    const lock = drawingScrollLockRef.current;
    if (pointerId !== null && lock.pointerId !== pointerId) return;
    drawingScrollLockRef.current = { active: false, pointerId: null, left: 0, top: 0 };
    invalidatePageGeometry();
    stageRef.current?.classList.remove("is-writing-locked");
  }

  function commitInterruptedLiveStroke(event) {
    const gesture = gestureRef.current;
    const draft = draftRef.current;
    const interruptedActivePointer = gesture.drawingPointerId !== null
      && (event.pointerId == null || gesture.drawingPointerId === event.pointerId);
    if (!interruptedActivePointer) return;
    if (gesture.holdRecognition && gesture.holdRawStroke && draft?.type === "shape") {
      runCommand({ type: "replace", before: [gesture.holdRawStroke], after: [draft] });
      return;
    }
    if (!isLiveStroke(draft) || draft.points?.length < 2) return;
    runCommand({
      type: "add",
      items: [{ ...draft, points: [...draft.points] }]
    });
  }

  function beginAnnotation(event) {
    if (!workspaceReady) return;
    const { activeTool, penProfile, activeColor, brushSize, brushOpacity, highlighterOpacity, pencilOpacity, pressureSensitivity, strokeSmoothing, shapeStyle } = toolStateRef.current;
    const gesture = gestureRef.current;
    const point = documentPoint(event.clientX, event.clientY);
    const annotationPage = point.page;
    gesture.drawingPointerId = event.pointerId;
    gesture.drawingPointerType = event.pointerType;
    gesture.annotationPage = annotationPage;
    gesture.predictedStrokePoints = [];
    gesture.holdRawStroke = null;
    gesture.holdRecognition = null;
    gesture.holdAnchorPoint = null;
    gesture.smartSelectionActivated = false;
    lockStageForDrawing(event.pointerId);
    activateAnnotationPage(annotationPage);
    if (activeTool === "eraser") {
      gesture.mode = INTERACTION_STATE.ERASING;
      clearEraserPreview();
      eraserSessionRef.current.begin(point, annotationPage);
      eraseAtPoint(point, annotationPage);
      return;
    }
    if (activeTool === "pen" && TRANSIENT_PEN_PROFILES.has(penProfile)) {
      // Pointer ink is shown, then fades; it never becomes a draft.
      gesture.transientInkPage = annotationPage;
      transientInkRef.current.begin({ kind: penProfile, page: annotationPage, color: activeColor, width: brushSize * 2, point });
      gesture.mode = INTERACTION_STATE.DRAWING;
      return;
    }
    const id = generateIdempotencyKey();
    if (activeTool === "shapes") {
      setDraft({ id, page: annotationPage, type: "shape", shape: shapeStyle, color: activeColor, width: brushSize * 2, opacity: brushOpacity, start: point, end: point, fill: shapeFill, fillColor: shapeFillColor, dashed: shapeDashed });
    } else {
      const nativeEvent = event.nativeEvent || event;
      const input = inkInputControllerRef.current.begin(nativeEvent, {
        page: annotationPage,
        pageUnitsPerCssPixel: pageUnitsPerCssPixel(annotationPage),
        mapClientPoint: (clientX, clientY, fixedPage) => documentPoint(clientX, clientY, fixedPage),
        debug: inkDebugEnabled,
        captured: false
      });
      const points = input.points;
      const profile = activeTool === "pen" ? penProfile : activeTool === "pencil" ? PEN_PROFILE.PENCIL : PEN_PROFILE.HIGHLIGHTER;
      setDraft({
        id,
        page: annotationPage,
        type: activeTool,
        profile,
        color: activeColor,
        width: activeTool === "highlighter" ? brushSize * 7 : brushSize * 2,
        opacity: activeTool === "pen" ? brushOpacity : activeTool === "highlighter" ? highlighterOpacity : pencilOpacity,
        pressureSensitivity,
        smoothing: autoImproveHandwriting && activeTool !== "highlighter" ? Math.max(.8, strokeSmoothing) : strokeSmoothing,
        // A finger or mouse reports no pressure; the controller simulates it from speed.
        ...(nativeEvent.pointerType === "pen" ? {} : { pressureSource: PRESSURE_SOURCE.SPEED }),
        createdAt: new Date().toISOString(),
        points
      });
      // A live highlight merges with saved ones of the same colour and opacity,
      // exactly as it will once it is saved, instead of darkening over them.
      liveStrokeCanvasRef.current?.setMergeTargets?.(activeTool === "highlighter"
        ? annotationsRef.current.filter((annotation) => annotation.type === "highlighter" && annotation.page === annotationPage
          && annotation.color === activeColor && (annotation.opacity ?? .34) === highlighterOpacity)
        : []);
    }
    gesture.mode = INTERACTION_STATE.DRAWING;
    if (["pen", "pencil", "highlighter"].includes(activeTool)) scheduleHoldRecognition();
  }

  function pointerEventSamples(event) {
    const nativeEvent = event.nativeEvent || event;
    const coalesced = typeof nativeEvent.getCoalescedEvents === "function" ? nativeEvent.getCoalescedEvents() : [];
    const source = coalesced.length ? [...coalesced] : [nativeEvent];
    const last = source[source.length - 1];
    if (last !== nativeEvent && (last.clientX !== nativeEvent.clientX || last.clientY !== nativeEvent.clientY || last.timeStamp !== nativeEvent.timeStamp)) source.push(nativeEvent);
    return source.map((sample) => ({ x: sample.clientX, y: sample.clientY, time: sample.timeStamp }));
  }

  function debugGesture(phase, event, detail = {}) {
    if (!import.meta.env.DEV) return;
    const gesture = gestureRef.current;
    const stage = stageRef.current;
    const snapshot = {
      phase,
      pointerType: event?.pointerType || "unknown",
      pointerCount: gesture.touches.size,
      deltaX: detail.deltaX ?? 0,
      deltaY: detail.deltaY ?? 0,
      state: gesture.mode,
      scrollTop: stage?.scrollTop ?? 0,
      scrollLeft: stage?.scrollLeft ?? 0,
      scale: zoomRef.current,
      panX: gesture.pan?.elasticX ?? 0,
      panY: gesture.pan?.elasticY ?? 0,
      direction: gesture.pan?.direction || null,
      prevented: Boolean(detail.prevented)
    };
    window.__lockInFocusGesture = snapshot;
  }

  function startScrollActivity() {
    const gesture = gestureRef.current;
    if (gesture.scrollActivityActive) return;
    gesture.scrollActivityActive = true;
    documentRef.current?.dispatchEvent(new window.CustomEvent("workspace:scrollactivitystart"));
  }

  function endScrollActivity() {
    const gesture = gestureRef.current;
    if (!gesture.scrollActivityActive) return;
    gesture.scrollActivityActive = false;
    documentRef.current?.dispatchEvent(new window.CustomEvent("workspace:scrollactivityend"));
  }

  function prefersReducedMotion() {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  }

  function springLimits() {
    const stage = stageRef.current;
    return {
      x: Math.min(68, Math.max(28, (stage?.clientWidth || window.innerWidth) * .09)),
      y: Math.min(68, Math.max(28, (stage?.clientHeight || window.innerHeight) * .075)),
      velocity: 1_050
    };
  }

  function ensureSpringSystem() {
    const gesture = gestureRef.current;
    if (!gesture.spring) {
      gesture.spring = {
        pan: { x: 0, y: 0, velocityX: 0, velocityY: 0, active: false },
        paused: false,
        startedAt: window.performance.now(),
        lastTime: window.performance.now()
      };
    }
    return gesture.spring;
  }

  function hasActiveSpring(system = gestureRef.current.spring) {
    return Boolean(system?.pan?.active);
  }

  function renderSpringTransform() {
    const root = documentRef.current;
    const system = gestureRef.current.spring;
    if (!root || !system) return;
    const pan = system.pan || { x: 0, y: 0 };
    if (import.meta.env.DEV) {
      window.__lockInFocusElastic = {
        panX: pan.x,
        panY: pan.y,
        velocityX: pan.velocityX,
        velocityY: pan.velocityY,
        paused: system.paused,
        rafActive: gestureRef.current.springRafId !== null
      };
    }
    if (pan.active || Math.abs(pan.x) > .01 || Math.abs(pan.y) > .01) {
      root.style.transform = `translate3d(${pan.x.toFixed(2)}px, ${pan.y.toFixed(2)}px, 0)`;
      return;
    }
    root.style.transform = "";
  }

  function scheduleSpringFrame() {
    const gesture = gestureRef.current;
    const system = gesture.spring;
    if (!system || system.paused || gesture.springRafId !== null) return;
    gesture.springRafId = requestAnimationFrame((now) => {
      gesture.springRafId = null;
      const current = gestureRef.current;
      const active = current.spring;
      if (!active || active.paused) return;
      const elapsed = now - active.lastTime;
      active.lastTime = now;
      let panSettled = true;
      if (active.pan.active) {
        const nextX = advanceSpring({ value: active.pan.x, velocity: active.pan.velocityX }, elapsed);
        const nextY = advanceSpring({ value: active.pan.y, velocity: active.pan.velocityY }, elapsed);
        active.pan.x = nextX.value;
        active.pan.y = nextY.value;
        active.pan.velocityX = nextX.velocity;
        active.pan.velocityY = nextY.velocity;
        // The document must never stay outside its committed geometry. If the
        // device cannot deliver enough frames to finish the spring, it snaps
        // home rather than leaving the page permanently offset.
        panSettled = (nextX.settled && nextY.settled) || now - active.startedAt >= SPRING_DEADLINE_MS;
        if (panSettled) {
          active.pan.x = 0;
          active.pan.y = 0;
          active.pan.velocityX = 0;
          active.pan.velocityY = 0;
          active.pan.active = false;
        }
      }
      renderSpringTransform();
      if (!hasActiveSpring(active)) {
        current.spring = null;
        const root = documentRef.current;
        root?.classList.remove("is-live-panning", "is-springing-back");
        renderSpringTransform();
        if (current.mode === INTERACTION_STATE.SPRING_BACK) current.mode = INTERACTION_STATE.IDLE;
        endScrollActivity();
        return;
      }
      if (panSettled && current.mode === INTERACTION_STATE.SPRING_BACK) current.mode = INTERACTION_STATE.IDLE;
      scheduleSpringFrame();
    });
  }

  /** Pauses, rather than resets, a physical spring when a new gesture lands. */
  function stopSpringBack({ discard = false } = {}) {
    const gesture = gestureRef.current;
    const system = gesture.spring;
    if (gesture.springRafId !== null) cancelAnimationFrame(gesture.springRafId);
    gesture.springRafId = null;
    if (!system) return;
    if (!discard) {
      system.paused = true;
      system.lastTime = window.performance.now();
      return;
    }
    gesture.spring = null;
    const root = documentRef.current;
    root?.classList.remove("is-springing-back", "is-live-panning");
    if (root) root.style.transform = "";
    if (gesture.mode === INTERACTION_STATE.SPRING_BACK) gesture.mode = INTERACTION_STATE.IDLE;
  }

  function startPanSpringBack(offsetX, offsetY, releaseVelocity = { x: 0, y: 0 }) {
    const gesture = gestureRef.current;
    const root = documentRef.current;
    if (!root || (Math.abs(offsetX) < .1 && Math.abs(offsetY) < .1)) {
      endScrollActivity();
      return false;
    }
    if (prefersReducedMotion()) {
      stopSpringBack({ discard: true });
      endScrollActivity();
      return false;
    }
    const limits = springLimits();
    const system = ensureSpringSystem();
    const nextX = addSpringImpulse(system.pan, { position: offsetX, impulse: -Number(releaseVelocity.x || 0) * 180, maxPosition: limits.x, maxVelocity: limits.velocity });
    const nextY = addSpringImpulse(system.pan, { position: offsetY, impulse: -Number(releaseVelocity.y || 0) * 180, maxPosition: limits.y, maxVelocity: limits.velocity });
    system.pan = { x: nextX.value, y: nextY.value, velocityX: nextX.velocity, velocityY: nextY.velocity, active: true };
    system.paused = false;
    system.startedAt = window.performance.now();
    system.lastTime = system.startedAt;
    gesture.mode = INTERACTION_STATE.SPRING_BACK;
    root.classList.add("is-live-panning", "is-springing-back");
    renderSpringTransform();
    scheduleSpringFrame();
    return true;
  }

  function applyPanPosition(pan) {
    const stage = stageRef.current;
    const root = documentRef.current;
    if (!stage || !root || !pan) return;
    const latest = pan.samples[pan.samples.length - 1];
    if (!latest) return;
    // Scroll coordinates run opposite to visible content motion. This is the
    // single intentional inversion; elastic display offsets are inverted back
    // below so the PDF remains attached to the finger at a boundary.
    const delta = lockedGestureDelta(pan.direction, latest.x - pan.x, latest.y - pan.y);
    let elasticX = 0;
    let elasticY = 0;
    const movesHorizontally = pan.direction === GESTURE_DIRECTION.HORIZONTAL || pan.direction === GESTURE_DIRECTION.FREE;
    const movesVertically = pan.direction === GESTURE_DIRECTION.VERTICAL || pan.direction === GESTURE_DIRECTION.FREE;
    const hasHorizontalRange = pan.bounds.maxScrollLeft - pan.bounds.minScrollLeft > .5;
    if (movesHorizontally && hasHorizontalRange) {
      const rawLeft = pan.left - delta.x + (delta.x ? pan.baseVirtualX : 0);
      const left = elasticScrollPosition(rawLeft, pan.bounds.minScrollLeft, pan.bounds.maxScrollLeft, pan.limits.x);
      stage.scrollLeft = left.legal;
      elasticX = delta.x ? -left.overshoot : 0;
    }
    if (movesVertically) {
      const rawTop = pan.top - delta.y + (delta.y ? pan.baseVirtualY : 0);
      const top = elasticScrollPosition(rawTop, pan.bounds.minScrollTop, pan.bounds.maxScrollTop, pan.limits.y);
      stage.scrollTop = top.legal;
      elasticY = delta.y ? -top.overshoot : 0;
    }
    // Free pan applies both components of the physical finger vector. Bounds
    // constrain each axis independently, so reaching one edge never kills the
    // remaining movement on the other axis.
    pan.elasticX = elasticX;
    pan.elasticY = elasticY;
    const system = ensureSpringSystem();
    system.pan.x = pan.elasticX;
    system.pan.y = pan.elasticY;
    system.pan.active = Math.abs(pan.elasticX) > .01 || Math.abs(pan.elasticY) > .01;
    system.paused = true;
    // Normal scrolling already moves on the browser's optimized scroll layer.
    // Promoting the entire multi-page PDF to a transformed GPU layer here (even
    // with translate3d(0, 0, 0)) is particularly expensive on iPad. Only use a
    // document transform while displaying the small elastic edge overshoot.
    if (system.pan.active) {
      root.classList.add("is-live-panning");
      root.style.transform = `translate3d(${pan.elasticX.toFixed(2)}px, ${pan.elasticY.toFixed(2)}px, 0)`;
    } else {
      root.classList.remove("is-live-panning");
      root.style.transform = "";
    }
  }

  function readerScrollBounds({ preserveCurrent = true } = {}) {
    const stage = stageRef.current;
    const root = documentRef.current;
    const fullBounds = {
      minScrollLeft: 0,
      maxScrollLeft: Math.max(0, (stage?.scrollWidth || 0) - (stage?.clientWidth || 0)),
      minScrollTop: 0,
      maxScrollTop: Math.max(0, (stage?.scrollHeight || 0) - (stage?.clientHeight || 0))
    };
    if (!sheet?.pdfUrl || !stage || !root) return fullBounds;
    const stageRect = stage.getBoundingClientRect();
    const rootRect = root.getBoundingClientRect();
    return visibleDocumentScrollBounds({
      contentStartX: rootRect.left - stageRect.left + stage.scrollLeft,
      contentStartY: rootRect.top - stageRect.top + stage.scrollTop,
      contentWidth: root.offsetWidth,
      contentHeight: root.offsetHeight,
      viewportWidth: stage.clientWidth,
      viewportHeight: stage.clientHeight,
      scrollWidth: stage.scrollWidth,
      scrollHeight: stage.scrollHeight,
      currentScrollLeft: stage.scrollLeft,
      currentScrollTop: stage.scrollTop,
      horizontalEdgeReveal: WORKSPACE_GESTURE.horizontalEdgeReveal,
      verticalEdgeReveal: WORKSPACE_GESTURE.verticalEdgeReveal,
      preserveCurrent
    });
  }

  function schedulePanFrame() {
    const gesture = gestureRef.current;
    if (gesture.panRafId !== null) return;
    gesture.panRafId = requestAnimationFrame(() => {
      gesture.panRafId = null;
      const current = gestureRef.current;
      if ([INTERACTION_STATE.VERTICAL_SCROLL, INTERACTION_STATE.HORIZONTAL_PAN, INTERACTION_STATE.FREE_PAN].includes(current.mode)) {
        applyPanPosition(current.pan);
      }
    });
  }

  function stopScrollMomentum({ endActivity = true } = {}) {
    const gesture = gestureRef.current;
    const wasActive = Boolean(gesture.momentum);
    if (gesture.momentumRafId !== null) cancelAnimationFrame(gesture.momentumRafId);
    gesture.momentumRafId = null;
    gesture.momentum = null;
    if (gesture.mode === INTERACTION_STATE.MOMENTUM) gesture.mode = INTERACTION_STATE.IDLE;
    if (wasActive) documentRef.current?.dispatchEvent(new window.CustomEvent("workspace:scrollmomentumend"));
    if (endActivity) endScrollActivity();
  }

  function startScrollMomentum(measuredVelocity) {
    const stage = stageRef.current;
    const gesture = gestureRef.current;
    if (!stage) return false;
    const config = momentumConfig({
      viewportWidth: stage.clientWidth,
      reducedMotion: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    });
    const velocity = momentumVelocityForIntent(measuredVelocity, config);
    const bounds = readerScrollBounds();
    const velocityX = bounds.maxScrollLeft > bounds.minScrollLeft ? velocity.x : 0;
    const velocityY = bounds.maxScrollTop > bounds.minScrollTop ? velocity.y : 0;
    if (Math.hypot(velocityX, velocityY) < config.stopVelocity) {
      endScrollActivity();
      return false;
    }
    stopScrollMomentum({ endActivity: false });
    const momentum = {
      config,
      bounds,
      velocityX,
      velocityY,
      scrollLeft: stage.scrollLeft,
      scrollTop: stage.scrollTop,
      lastTime: window.performance.now()
    };
    gesture.mode = INTERACTION_STATE.MOMENTUM;
    gesture.momentum = momentum;
    documentRef.current?.dispatchEvent(new window.CustomEvent("workspace:scrollmomentumstart", { detail: { speed: velocity.speed, band: velocity.band } }));
    const advance = (now) => {
      const currentGesture = gestureRef.current;
      if (currentGesture.momentum !== momentum || currentGesture.mode !== INTERACTION_STATE.MOMENTUM) return;
      currentGesture.momentumRafId = null;
      const next = advanceMomentumFrame(momentum, now - momentum.lastTime, momentum.config, momentum.bounds);
      momentum.lastTime = now;
      momentum.velocityX = next.velocityX;
      momentum.velocityY = next.velocityY;
      momentum.scrollLeft = next.scrollLeft;
      momentum.scrollTop = next.scrollTop;
      stage.scrollLeft = next.scrollLeft;
      stage.scrollTop = next.scrollTop;
      if (next.unclampedLeft !== next.scrollLeft || next.unclampedTop !== next.scrollTop) {
        const speedFactor = Math.min(1.25, 1 + Math.hypot(momentum.velocityX, momentum.velocityY) / 14);
        const horizontalLimit = Math.min(60, Math.max(24, stage.clientWidth * .08)) * speedFactor;
        const verticalLimit = Math.min(60, Math.max(24, stage.clientHeight * .07)) * speedFactor;
        const edgeX = -elasticScrollPosition(next.unclampedLeft, momentum.bounds.minScrollLeft, momentum.bounds.maxScrollLeft, horizontalLimit).overshoot;
        const edgeY = -elasticScrollPosition(next.unclampedTop, momentum.bounds.minScrollTop, momentum.bounds.maxScrollTop, verticalLimit).overshoot;
        stopScrollMomentum({ endActivity: false });
        startPanSpringBack(edgeX, edgeY);
        return;
      }
      if (!next.active) {
        stopScrollMomentum();
        return;
      }
      currentGesture.momentumRafId = requestAnimationFrame(advance);
    };
    gesture.momentumRafId = requestAnimationFrame(advance);
    return true;
  }

  /** @param {any} event @param {string} direction */
  function beginPan(event, direction = GESTURE_DIRECTION.FREE) {
    const stage = stageRef.current;
    if (!stage) return;
    stopSpringBack({ discard: true });
    stopScrollMomentum();
    const clientX = event.clientX ?? event.currentX;
    const clientY = event.clientY ?? event.currentY;
    const gesture = gestureRef.current;
    const limits = springLimits();
    const system = ensureSpringSystem();
    const initialElasticX = system.pan.x;
    const initialElasticY = system.pan.y;
    gesture.mode = interactionStateForDirection(direction);
    gesture.pan = {
      pointerId: event.pointerId,
      x: clientX,
      y: clientY,
      left: stage.scrollLeft,
      top: stage.scrollTop,
      direction,
      bounds: readerScrollBounds(),
      limits,
      // Store the inverse rubber-band value once, so an in-flight spring is
      // part of the new drag's origin instead of being cleared first.
      baseVirtualX: -unresistedDistance(initialElasticX, limits.x),
      baseVirtualY: -unresistedDistance(initialElasticY, limits.y),
      elasticX: initialElasticX,
      elasticY: initialElasticY,
      samples: [{ x: clientX, y: clientY, time: event.timeStamp }]
    };
    if (direction !== GESTURE_DIRECTION.PENDING) startScrollActivity();
  }

  function startLivePinch(points) {
    const gesture = gestureRef.current;
    const root = documentRef.current;
    const stage = stageRef.current;
    if (!root || !stage) return false;
    if (sheet?.pdfUrl) pdfZoomModeRef.current = "manual";
    if (gesture.mode === INTERACTION_STATE.PINCHING && gesture.pinch?.active) return true;
    cancelZoomSettle();
    // Suspend PDF.js work before ending a one-finger pan so the renderer never
    // observes an unsuspended gap while the gesture changes from one to two pointers.
    root.dispatchEvent(new window.CustomEvent("workspace:livezoomstart"));
    stopSpringBack({ discard: true });
    stopScrollMomentum();
    endScrollActivity();
    if (gesture.panRafId !== null) cancelAnimationFrame(gesture.panRafId);
    gesture.panRafId = null;
    if (gesture.pinchRafId !== null) cancelAnimationFrame(gesture.pinchRafId);
    gesture.pinchRafId = null;
    const center = midpoint(points[0], points[1]);
    const startZoom = zoomRef.current;
    const rootBounds = root.getBoundingClientRect();
    const documentElement = root.querySelector(".workspace-v2-a4-document") || root;
    const documentBounds = documentElement.getBoundingClientRect();
    const documentAnchor = documentAnchorFromClient(center.x, center.y, documentBounds, startZoom);
    const initialDistance = pointerDistance(points[0], points[1]) || 1;
    gesture.mode = INTERACTION_STATE.PINCHING;
    gesture.pan = null;
    const pinchId = ++gesture.pinchSequence;
    gesture.pinch = {
      id: pinchId,
      active: true,
      initialScale: startZoom,
      currentScale: startZoom,
      displayScale: startZoom,
      initialFingerDistance: initialDistance,
      currentFingerDistance: initialDistance,
      initialFocalX: center.x,
      initialFocalY: center.y,
      currentFocalX: center.x,
      currentFocalY: center.y,
      documentAnchorX: documentAnchor.x,
      documentAnchorY: documentAnchor.y,
      startingScrollLeft: stage.scrollLeft,
      startingScrollTop: stage.scrollTop,
      initialDocumentLeft: rootBounds.left,
      initialDocumentTop: rootBounds.top,
      initialDocumentWidth: rootBounds.width,
      initialDocumentHeight: rootBounds.height,
      viewportLeft: stage.getBoundingClientRect().left,
      viewportTop: stage.getBoundingClientRect().top,
      viewportWidth: stage.clientWidth,
      viewportHeight: stage.clientHeight,
      elasticX: 0,
      elasticY: 0,
      visualOriginX: center.x - rootBounds.left,
      visualOriginY: center.y - rootBounds.top
    };
    root.classList.remove("is-zoom-settling");
    root.classList.remove("is-live-panning");
    root.classList.add("is-live-pinching");
    root.style.transform = "translate3d(0, 0, 0) scale(1)";
    return true;
  }

  function applyLivePinchFrame(pinchId, frameId) {
    const gesture = gestureRef.current;
    if (gesture.pinchRafId !== frameId) return;
    gesture.pinchRafId = null;
    const pinch = gesture.pinch;
    const root = documentRef.current;
    if (!pinch?.active || pinch.id !== pinchId || gesture.mode !== INTERACTION_STATE.PINCHING || !root) return;
    renderLivePinchTransform(pinch);
  }

  function renderLivePinchTransform(pinch) {
    const root = documentRef.current;
    if (!pinch || !root) return;
    // The compositor follows the resisted display scale so a pinch past a zoom
    // limit still tracks the fingers; only `currentScale` may be committed.
    const displayScale = Number.isFinite(pinch.displayScale) ? pinch.displayScale : pinch.currentScale;
    const { ratio, translateX, translateY } = livePinchTransform({
      originX: pinch.visualOriginX,
      originY: pinch.visualOriginY,
      startCenter: { x: pinch.initialFocalX, y: pinch.initialFocalY },
      currentCenter: { x: pinch.currentFocalX, y: pinch.currentFocalY },
      fromScale: pinch.initialScale,
      toScale: displayScale
    });
    const constrained = constrainPinchTranslation({
      translateX,
      translateY,
      ratio,
      contentLeft: pinch.initialDocumentLeft,
      contentTop: pinch.initialDocumentTop,
      contentWidth: pinch.initialDocumentWidth,
      contentHeight: pinch.initialDocumentHeight,
      viewportLeft: pinch.viewportLeft,
      viewportTop: pinch.viewportTop,
      viewportWidth: pinch.viewportWidth,
      viewportHeight: pinch.viewportHeight,
      horizontalEdgeReveal: WORKSPACE_GESTURE.horizontalEdgeReveal,
      verticalEdgeReveal: WORKSPACE_GESTURE.verticalEdgeReveal
    });
    // X always obeys the physical PDF edges. Y remains focal-exact while
    // zooming in and is constrained only while zooming out or two-finger panning.
    pinch.elasticX = resistedDistance(constrained.overflowX, WORKSPACE_GESTURE.pinchElasticLimit);
    if (displayScale <= pinch.initialScale + Number.EPSILON) {
      pinch.elasticY = resistedDistance(constrained.overflowY, WORKSPACE_GESTURE.pinchElasticLimit);
      root.style.transform = `translate3d(${constrained.translateX + pinch.elasticX}px, ${constrained.translateY + pinch.elasticY}px, 0) scale(${ratio})`;
      return;
    }
    pinch.elasticY = 0;
    root.style.transform = `translate3d(${constrained.translateX + pinch.elasticX}px, ${translateY}px, 0) scale(${ratio})`;
  }

  function scheduleLivePinchFrame() {
    const gesture = gestureRef.current;
    const pinchId = gesture.pinch?.id;
    if (gesture.pinchRafId !== null || !pinchId) return;
    let frameId = null;
    frameId = requestAnimationFrame(() => applyLivePinchFrame(pinchId, frameId));
    gesture.pinchRafId = frameId;
  }

  function clearLivePinchTransform() {
    const gesture = gestureRef.current;
    if (gesture.pinch) gesture.pinch.active = false;
    if (gesture.pinchRafId !== null) cancelAnimationFrame(gesture.pinchRafId);
    gesture.pinchRafId = null;
    const root = documentRef.current;
    if (root) {
      root.dispatchEvent(new window.CustomEvent("workspace:livezoomcancel"));
      root.style.transform = "";
      root.classList.remove("is-live-pinching");
      root.classList.remove("is-zoom-settling");
    }
  }

  function commitPinchLegal(pinch, finalZoom) {
    const gesture = gestureRef.current;
    gesture.mode = INTERACTION_STATE.SETTLING;
    gesture.pan = null;
    if (Math.abs(finalZoom - pinch.initialScale) <= Number.EPSILON) {
      const root = documentRef.current;
      const stage = stageRef.current;
      if (root && stage) {
        root.style.transform = "";
        const documentElement = root.querySelector(".workspace-v2-a4-document") || root;
        const documentBounds = documentElement.getBoundingClientRect();
        const next = scrollForDocumentAnchor({
          currentScrollLeft: stage.scrollLeft,
          currentScrollTop: stage.scrollTop,
          documentLeft: documentBounds.left,
          documentTop: documentBounds.top,
          documentAnchorX: pinch.documentAnchorX,
          documentAnchorY: pinch.documentAnchorY,
          scale: finalZoom,
          focalClientX: pinch.currentFocalX,
          focalClientY: pinch.currentFocalY
        });
        const constrainToBounds = finalZoom <= pinch.initialScale + Number.EPSILON;
        const bounds = readerScrollBounds({ preserveCurrent: false });
        stage.scrollLeft = Math.min(bounds.maxScrollLeft, Math.max(bounds.minScrollLeft, next.scrollLeft));
        if (constrainToBounds) {
          stage.scrollTop = Math.min(bounds.maxScrollTop, Math.max(bounds.minScrollTop, next.scrollTop));
        } else {
          stage.scrollTop = next.scrollTop;
        }
        root.classList.remove("is-live-pinching", "is-zoom-settling");
      }
      root?.dispatchEvent(new window.CustomEvent("workspace:livezoomcommit", { detail: { zoom: finalZoom, pinchId: pinch.id } }));
      root?.dispatchEvent(new window.CustomEvent("workspace:zoomgeometrysettled", { detail: { zoom: finalZoom, pinchId: pinch.id } }));
      gesture.pinch = null;
      const springStarted = startPanSpringBack(pinch.elasticX, finalZoom <= pinch.initialScale + Number.EPSILON ? pinch.elasticY : 0);
      if (!springStarted && gesture.touches.size === 0) gesture.mode = INTERACTION_STATE.IDLE;
      revealZoomHud(finalZoom);
      return;
    }
    documentRef.current?.classList.add("is-zoom-settling");
    pendingPinchCommitRef.current = {
      pinchId: pinch.id,
      finalZoom,
      currentFocalX: pinch.currentFocalX,
      currentFocalY: pinch.currentFocalY,
      documentAnchorX: pinch.documentAnchorX,
      documentAnchorY: pinch.documentAnchorY,
      startingScrollLeft: pinch.startingScrollLeft,
      startingScrollTop: pinch.startingScrollTop,
      constrainToBounds: finalZoom <= pinch.initialScale + Number.EPSILON,
      elasticX: pinch.elasticX,
      elasticY: pinch.elasticY
    };
    zoomRef.current = finalZoom;
    gesture.pinch = null;
    // Keep the last compositor transform visible while React prepares the new
    // document geometry. A transition lets React yield between chunks instead
    // of blocking the release frame with the entire Workspace render.
    startTransition(() => setZoom(finalZoom));
    revealZoomHud(finalZoom);
  }

  /**
   * Ends an in-flight rubber-band zoom animation. Interrupting always finishes
   * the pending commit so committed zoom, `zoomRef`, and the visible transform
   * can never disagree when the next gesture reads them.
   */
  function cancelZoomSettle() {
    const gesture = gestureRef.current;
    if (gesture.zoomSettleRafId !== null) cancelAnimationFrame(gesture.zoomSettleRafId);
    gesture.zoomSettleRafId = null;
    const complete = gesture.zoomSettleComplete;
    gesture.zoomSettleComplete = null;
    complete?.();
  }

  /** Animates a pinch that overshot a zoom limit back to the legal scale. */
  function settleZoomOvershoot(pinch, finalZoom, commit) {
    const gesture = gestureRef.current;
    const from = Number.isFinite(pinch.displayScale) ? pinch.displayScale : finalZoom;
    if (Math.abs(from - finalZoom) < .002 || prefersReducedMotion() || !documentRef.current) {
      pinch.displayScale = finalZoom;
      commit();
      return;
    }
    gesture.mode = INTERACTION_STATE.SETTLING;
    const started = window.performance.now();
    const finish = () => {
      pinch.displayScale = finalZoom;
      renderLivePinchTransform(pinch);
      commit();
    };
    gesture.zoomSettleComplete = finish;
    const step = (now) => {
      const current = gestureRef.current;
      current.zoomSettleRafId = null;
      if (current.zoomSettleComplete !== finish) return;
      const progress = Math.min(1, (now - started) / ZOOM_SETTLE_MS);
      pinch.displayScale = from + (finalZoom - from) * (1 - (1 - progress) ** 3);
      renderLivePinchTransform(pinch);
      if (progress < 1) {
        current.zoomSettleRafId = requestAnimationFrame(step);
        return;
      }
      current.zoomSettleComplete = null;
      finish();
    };
    gesture.zoomSettleRafId = requestAnimationFrame(step);
  }

  function commitLivePinch() {
    const gesture = gestureRef.current;
    const pinch = gesture.pinch;
    if (!pinch?.active) return;
    pinch.active = false;
    if (gesture.pinchRafId !== null) {
      cancelAnimationFrame(gesture.pinchRafId);
      gesture.pinchRafId = null;
    }
    // Paint the most recent raw pointer sample before reconciling compositor
    // geometry with layout. The committed scale is the exact distance ratio;
    // only a rubber-band overshoot is eased, and never past a legal value.
    renderLivePinchTransform(pinch);
    const finalZoom = pinch.currentScale;
    gesture.pinch = null;
    const stage = stageRef.current;
    for (const touch of gesture.touches.values()) {
      try { if (stage?.hasPointerCapture?.(touch.pointerId)) stage.releasePointerCapture(touch.pointerId); } catch { /* Releasing an already-ended pointer is harmless. */ }
    }
    gesture.touches.clear();
    settleZoomOvershoot(pinch, finalZoom, () => commitPinchLegal(pinch, finalZoom));
  }

  function beginWorkspacePointer(event) {
    if (!workspaceReady) return;
    // The tapped tool, even if React has not re-rendered since the tap.
    const activeTool = activeToolRef.current;
    if (isTypingTarget(event.target) || isStageControl(event.target) || event.button > 0) return;
    const gesture = gestureRef.current;
    stopSpringBack({ discard: true });
    stopScrollMomentum();
    if (event.pointerType === "pen") {
      hideStylusHover();
      // A phone with a stylus: until the student says otherwise, the stylus
      // draws and fingers go back to scrolling, as on a tablet.
      if (!drawingInputChosenRef.current && drawingInput === DRAWING_INPUT.STYLUS_AND_FINGER) setDrawingInput(DRAWING_INPUT.STYLUS_ONLY);
      gesture.penPointers.set(event.pointerId, pointerSnapshot(event));
      gesture.lastPenAt = Date.now();
      gesture.lastPenPosition = { x: event.clientX, y: event.clientY };
    }
    if (event.pointerType === "touch") {
      if (suspiciousPalmContact({ event, activePenCount: gesture.penPointers.size, lastPenAt: gesture.lastPenAt, lastPenPosition: gesture.lastPenPosition, activeTouchCount: gesture.touches.size })) {
        gesture.rejectedTouches.add(event.pointerId);
        event.preventDefault();
        return;
      }
      gesture.touches.set(event.pointerId, pointerSnapshot(event));
      if (gesture.touches.size === 2) {
        if (gesture.mode === INTERACTION_STATE.PINCHING && gesture.pinch?.active) return;
        if (gesture.drawingPointerType === "pen") commitInterruptedLiveStroke({ pointerId: null });
        if (gesture.mode === INTERACTION_STATE.OBJECT_TRANSFORMING && transformRef.current) {
          if (gesture.transformRafId !== null) cancelAnimationFrame(gesture.transformRafId);
          gesture.transformRafId = null;
          if (transformRef.current.after) {
            applyObjectTransformPreview(transformRef.current.after);
            recordCommand({ type: "update", before: transformRef.current.before, after: transformRef.current.after });
          }
          transformRef.current = null;
        }
        clearDraft();
        if (gesture.transientInkPage != null) transientInkRef.current.end();
        gesture.transientInkPage = null;
        unlockStageForDrawing(gesture.drawingPointerId);
        gesture.drawingPointerId = null;
        gesture.drawingPointerType = null;
        for (const touch of gesture.touches.values()) {
          try { event.currentTarget.setPointerCapture(touch.pointerId); } catch { /* Capture only begins for the custom two-finger gesture. */ }
        }
        const points = [...gesture.touches.values()];
        startLivePinch(points);
        event.preventDefault();
        debugGesture("pinch-start", event, { prevented: true });
        return;
      }
      if (gesture.touches.size > 2) return;
      if (gesture.drawingPointerType === "pen") {
        try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Capture is progressive enhancement. */ }
        event.preventDefault();
        return;
      }
      if (activeTool === "select" && beginSelectionPointer(event)) return;
      if (activeTool !== "hand" && beginDirectObjectMove(event)) return;
      const canTouchDraw = pointerCanDraw(event.pointerType, drawingInput);
      if (activeTool === "hand" || !canTouchDraw || startsOutsidePages(event)) {
        // One-finger navigation and two-finger pinch share the same pointer
        // stream, so the second contact upgrades one continuous session instead
        // of forcing the browser to cancel native scrolling and start again.
        beginPan(event, GESTURE_DIRECTION.PENDING);
        try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Pointer capture is progressive enhancement. */ }
        event.preventDefault();
        debugGesture("touch-pan-start", event, { prevented: true });
        return;
      }
      // The finger writes on a phone, so scrolling moves to two fingers. Say so
      // once, at the first stroke, rather than leaving the page feel stuck.
      if (DRAWING_TOOLS.has(activeTool) && activeTool !== "select") {
        let told = true;
        try { told = window.localStorage.getItem(FINGER_SCROLL_HINT_KEY) === "1"; window.localStorage.setItem(FINGER_SCROLL_HINT_KEY, "1"); } catch { /* The hint may repeat. */ }
        if (!told) setFocusMessage(t("focus.twoFingersToScroll"));
      }
    }
    // A second stylus, or a mouse arriving mid-stroke, must not take over the
    // active drawing session: the stroke in progress would be discarded.
    if (gesture.drawingPointerId !== null && gesture.drawingPointerId !== event.pointerId) {
      event.preventDefault();
      return;
    }
    if (activeTool === "select" && event.pointerType !== "touch" && beginSelectionPointer(event)) return;
    if (activeTool !== "hand" && event.pointerType !== "touch" && beginDirectObjectMove(event)) return;
    const canDraw = pointerCanDraw(event.pointerType, drawingInput);
    // A stylus or mouse that lands beside the pages (the gutter, the gap
    // between pages, the space above the first one) has nothing to draw on:
    // treat that drag as navigation, exactly like the Pan tool.
    if (activeTool === "hand" || !canDraw || startsOutsidePages(event)) beginPan(event, GESTURE_DIRECTION.PENDING);
    else if (DRAWING_TOOLS.has(activeTool) && activeTool !== "select") beginAnnotation(event);
    let captured = false;
    try { event.currentTarget.setPointerCapture(event.pointerId); captured = true; } catch { /* Pointer capture is progressive enhancement. */ }
    if (gesture.drawingPointerId === event.pointerId) inkInputControllerRef.current.setCapture(captured);
    updateEraserHitbox(event);
    event.preventDefault();
  }

  /**
   * Whether the contact landed off every page. Only the PDF reader has page
   * boxes; the document view draws anywhere. The point is hit-tested rather
   * than trusting the event target, which is the stage itself once a pointer
   * is captured, and the whole stack is checked so a transient overlay (a
   * closing dialog, a toast) cannot hide the page underneath.
   */
  function startsOutsidePages(event) {
    if (!sheet?.pdfUrl) return false;
    const stack = document.elementsFromPoint?.(event.clientX, event.clientY) || [];
    if (!stack.length) return false;
    return !stack.some((element) => element.closest?.("[data-workspace-page]"));
  }

  /** Makes a page the one being worked on, as a stroke or a selection starting there does. */
  function activateAnnotationPage(annotationPage) {
    if (isVirtualPageKey(annotationPage)) {
      setActiveVirtualPageId(annotationPage);
      const anchor = virtualPagesRef.current.find((item) => item.id === annotationPage)?.afterPage;
      if (anchor) setPage(anchor);
    } else {
      setActiveVirtualPageId(null);
      if (annotationPage !== page) setPage(annotationPage);
    }
  }

  function pageAspectFor(annotationPage) {
    const bounds = pageBoundsFor(annotationPage);
    return bounds?.width ? bounds.height / bounds.width : 1;
  }

  /**
   * The Select tool's press, for mouse, finger and stylus alike.
   *
   * - on the corner handle: resize the selection;
   * - on an item: select it (and its group) - it may become a drag that moves it;
   * - inside the current selection: the drag moves all of it;
   * - on empty page: a lasso; except a finger that navigates in Pencil mode,
   *   which pans and only clears the selection if it was a tap.
   *
   * A press becomes a move only after it travels MOVE_THRESHOLD_PX, so a tap
   * never nudges an item, and only the Select tool reaches here, so moving an
   * item can never leave ink behind. Returns false when the press is not the
   * Select tool's to handle (the gutter beside the pages, hidden annotations).
   */
  function beginSelectionPointer(event) {
    if ((!coverSelecting && annotationsHidden) || startsOutsidePages(event)) return false;
    const gesture = gestureRef.current;
    const point = documentPoint(event.clientX, event.clientY);
    const annotationPage = point.page;
    const onPage = annotationsRef.current.filter((item) => item.page === annotationPage);
    const tolerance = (event.pointerType === "touch" ? 14 : event.pointerType === "pen" ? 8 : 5) * pageUnitsPerCssPixel(annotationPage);
    const aspect = pageAspectFor(annotationPage);
    const selected = new Set(selectedIds);
    const current = onPage.filter((item) => selected.has(item.id));
    const currentBounds = selectionBounds(current);
    const handle = current.length ? event.target?.closest?.("[data-resize-handle]")?.getAttribute("data-resize-handle") : null;
    let ids = null;
    let tapId = null;
    if (handle && !coverSelecting) ids = current.map((item) => item.id);
    else if (!coverSelecting) {
      const hit = hitTestAnnotations(onPage, point, { tolerance, aspect });
      const toleranceY = tolerance / Math.max(.01, aspect);
      const insideSelection = Boolean(currentBounds
        && point.x >= currentBounds.x - tolerance && point.x <= currentBounds.x + currentBounds.width + tolerance
        && point.y >= currentBounds.y - toleranceY && point.y <= currentBounds.y + currentBounds.height + toleranceY);
      if (hit && (event.shiftKey || event.metaKey) && current.length) {
        ids = [...new Set([...current.map((item) => item.id), ...expandSelectionGroups([hit.id], onPage)])];
      } else if (insideSelection && (!hit || selected.has(hit.id))) {
        ids = current.map((item) => item.id);
        tapId = hit?.id ?? (current.length === 1 ? current[0].id : null);
      } else if (hit) {
        ids = expandSelectionGroups([hit.id], onPage);
        tapId = hit.id;
      }
    }
    if (!ids) {
      // Hiding an area is an explicit rectangle gesture, so a finger can do it
      // even while ink remains restricted to Apple Pencil.
      if (!coverSelecting && event.pointerType === "touch" && !pointerCanDraw("touch", drawingInput)) {
        gesture.selectionTapClear = true;
        return false;
      }
      activateAnnotationPage(annotationPage);
      setSelectedIds([]);
      setDraft({ id: generateIdempotencyKey(), page: annotationPage, type: "lasso", mode: lassoMode, start: point, end: point, points: [point] });
      gesture.mode = INTERACTION_STATE.SELECTING;
    } else {
      activateAnnotationPage(annotationPage);
      setSelectedIds(ids);
      const chosen = new Set(ids);
      const items = onPage.filter((item) => chosen.has(item.id));
      transformRef.current = {
        kind: handle ? "resize" : "move",
        handle,
        start: point,
        before: items.filter((item) => !item.locked).map(cloneAnnotation),
        bounds: { ...(selectionBounds(items) || { x: point.x, y: point.y, width: 1, height: 1 }) },
        pending: true,
        startClientX: event.clientX,
        startClientY: event.clientY,
        tapId
      };
      gesture.mode = INTERACTION_STATE.OBJECT_TRANSFORMING;
    }
    gesture.drawingPointerId = event.pointerId;
    gesture.drawingPointerType = event.pointerType;
    gesture.annotationPage = annotationPage;
    lockStageForDrawing(event.pointerId);
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Selection still works without capture. */ }
    event.preventDefault();
    return true;
  }

  /** A press that never moved: remember it, and a second tap on the same text or card edits it. */
  function finishSelectionTap(event, transform) {
    const tap = { id: transform.tapId, time: event.timeStamp, x: event.clientX, y: event.clientY };
    if (tap.id && isDoubleTap(selectionTapRef.current, tap)) {
      selectionTapRef.current = null;
      const item = editableTarget(annotationsRef.current.filter((annotation) => annotation.id === tap.id));
      if (item) editAnnotation(item);
      return;
    }
    selectionTapRef.current = tap.id ? tap : null;
  }

  function beginDirectObjectMove(event) {
    if (annotationsHidden || (event.pointerType === "pen" && !["select", "hand"].includes(activeToolRef.current))) return false;
    const target = event.target.closest?.('[data-annotation-type="card"], [data-annotation-type="image"]');
    const id = target?.getAttribute("data-annotation-id");
    const item = annotationsRef.current.find((annotation) => annotation.id === id);
    if (!item || item.locked) return false;
    const before = annotationsRef.current.filter((annotation) => annotation.id === id || (item.groupId && annotation.groupId === item.groupId)).filter((annotation) => !annotation.locked).map(cloneAnnotation);
    const point = documentPoint(event.clientX, event.clientY, item.page);
    setSelectedIds(before.map((annotation) => annotation.id));
    transformRef.current = { kind: "move", start: point, before };
    gestureRef.current.drawingPointerId = event.pointerId;
    gestureRef.current.drawingPointerType = event.pointerType;
    gestureRef.current.annotationPage = item.page;
    gestureRef.current.mode = INTERACTION_STATE.OBJECT_TRANSFORMING;
    lockStageForDrawing(event.pointerId);
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Direct movement still works without capture. */ }
    event.preventDefault();
    return true;
  }

  function moveWorkspacePointer(event) {
    const gesture = gestureRef.current;
    if (event.pointerType === "pen") updateStylusHover(event);
    updateEraserHitbox(event);
    if (gesture.drawingPointerId === event.pointerId) {
      event.preventDefault();
    }
    if (event.pointerType === "pen") {
      gesture.lastPenAt = Date.now();
      gesture.lastPenPosition = { x: event.clientX, y: event.clientY };
    }
    if (event.pointerType === "touch" && gesture.touches.has(event.pointerId)) {
      const touch = gesture.touches.get(event.pointerId);
      touch.currentX = event.clientX;
      touch.currentY = event.clientY;
    }
    if (gesture.mode === INTERACTION_STATE.PINCHING && gesture.pinch && gesture.touches.size === 2) {
      event.preventDefault();
      const points = [...gesture.touches.values()];
      const focal = midpoint(points[0], points[1]);
      const distance = pointerDistance(points[0], points[1]);
      gesture.pinch.currentFocalX = focal.x;
      gesture.pinch.currentFocalY = focal.y;
      gesture.pinch.currentFingerDistance = distance;
      const rawScale = continuousPinchScale({
        initialScale: gesture.pinch.initialScale,
        initialDistance: gesture.pinch.initialFingerDistance,
        currentDistance: distance,
        minimum: MIN_FOCUS_ZOOM * .2,
        maximum: MAX_FOCUS_ZOOM * 4
      });
      const elasticZoom = elasticZoomScale(rawScale, minimumAllowedZoom(), MAX_FOCUS_ZOOM, ZOOM_OVERSHOOT_RATIO);
      gesture.pinch.currentScale = elasticZoom.legal;
      gesture.pinch.displayScale = elasticZoom.display;
      scheduleLivePinchFrame();
      return;
    }
    if ((gesture.mode === INTERACTION_STATE.SETTLING || gesture.mode === INTERACTION_STATE.SPRING_BACK) && event.pointerType === "touch") {
      event.preventDefault();
      return;
    }
    if (gesture.mode === INTERACTION_STATE.PENDING_DIRECTION && gesture.pan?.pointerId === event.pointerId) {
      event.preventDefault();
      const pan = gesture.pan;
      appendRecentPointerSamples(pan.samples, pointerEventSamples(event));
      const direction = classifyGestureDirection(event.clientX - pan.x, event.clientY - pan.y, {
        allowFreePan: true
      });
      if (direction === GESTURE_DIRECTION.PENDING) return;
      pan.direction = direction;
      gesture.mode = interactionStateForDirection(direction);
      startScrollActivity();
      applyPanPosition(pan);
      debugGesture("pan-intent", event, {
        deltaX: event.clientX - pan.x,
        deltaY: event.clientY - pan.y,
        prevented: true
      });
      return;
    }
    if ([INTERACTION_STATE.VERTICAL_SCROLL, INTERACTION_STATE.HORIZONTAL_PAN, INTERACTION_STATE.FREE_PAN].includes(gesture.mode)
      && gesture.pan?.pointerId === event.pointerId) {
      event.preventDefault();
      appendRecentPointerSamples(gesture.pan.samples, pointerEventSamples(event));
      schedulePanFrame();
      return;
    }
    if (gesture.drawingPointerId !== event.pointerId) return;
    event.preventDefault();
    if (gesture.mode === INTERACTION_STATE.ERASING) {
      for (const sample of eventSamples(event, gesture.annotationPage)) eraseAtPoint(sample, gesture.annotationPage);
      return;
    }
    const point = documentPoint(event.clientX, event.clientY, gesture.annotationPage);
    if (gesture.mode === INTERACTION_STATE.OBJECT_TRANSFORMING && transformRef.current) {
      const transform = transformRef.current;
      if (transform.pending) {
        // Until the contact travels, a press on a selection is still a tap.
        const threshold = MOVE_THRESHOLD_PX[event.pointerType] ?? 4;
        if (Math.hypot(event.clientX - transform.startClientX, event.clientY - transform.startClientY) < threshold) return;
        transform.pending = false;
      }
      if (!transform.before.length) return;
      if (!transform.dragging) {
        transform.dragging = true;
        setSelectionDragging(true);
      }
      let after;
      if (transform.kind === "move") {
        transform.moveBounds ??= selectionBounds(transform.before);
        const delta = clampSelectionDelta(transform.moveBounds, point.x - transform.start.x, point.y - transform.start.y);
        after = transform.before.map((item) => translateAnnotation(item, delta.dx, delta.dy));
      } else {
        const nextBounds = { ...transform.bounds };
        if (transform.handle.includes("left")) { nextBounds.x = Math.min(point.x, transform.bounds.x + transform.bounds.width - 12); nextBounds.width = transform.bounds.x + transform.bounds.width - nextBounds.x; }
        else nextBounds.width = Math.max(12, point.x - transform.bounds.x);
        if (transform.handle.includes("top")) { nextBounds.y = Math.min(point.y, transform.bounds.y + transform.bounds.height - 12); nextBounds.height = transform.bounds.y + transform.bounds.height - nextBounds.y; }
        else nextBounds.height = Math.max(12, point.y - transform.bounds.y);
        after = transform.before.map((item) => resizeAnnotation(item, transform.bounds, nextBounds));
      }
      transform.after = after;
      scheduleObjectTransformPreview();
      return;
    }
    if (gesture.mode === INTERACTION_STATE.DRAWING && gesture.transientInkPage != null) {
      if (gesture.drawingPointerId === event.pointerId) transientInkRef.current.extend(eventSamples(event, gesture.transientInkPage));
      return;
    }
    const draft = draftRef.current;
    if (!draft) return;
    if (draft.type === "shape") {
      if (["circle", "square"].includes(draft.shape)) setDraft({ ...draft, end: equalSidedEnd(draft.start, point, pageAspectFor(draft.page)) });
      else setDraft({ ...draft, end: point });
    }
    else if (draft.type === "lasso") {
      if (gesture.smartSelectionActivated) return;
      if (draft.mode === "rectangle") setDraft({ ...draft, end: point, points: rectangleLassoPolygon(draft.start, point) });
      else setDraft({ ...draft, end: point, points: [...draft.points, point] });
    }
    else {
      // The controller owns the mutable gesture-local buffer; React only sees
      // the finished annotation command.
      const nativeEvent = event.nativeEvent || event;
      if (inkInputControllerRef.current.hasActivePointer(event.pointerId)) {
        inkInputControllerRef.current.append(nativeEvent);
        gesture.predictedStrokePoints = inkInputControllerRef.current.predicted(nativeEvent);
      } else {
        draft.points.push(...eventSamples(event, gesture.annotationPage));
        gesture.predictedStrokePoints = [];
      }
      scheduleLiveStrokeDraw();
      if (["pen", "pencil", "highlighter"].includes(activeToolRef.current)) scheduleHoldRecognition();
    }
  }

  function finishWorkspacePointer(event) {
    const gesture = gestureRef.current;
    let suppressMomentum = false;
    if (event.pointerType === "touch") {
      if (gesture.rejectedTouches.delete(event.pointerId)) return;
      gesture.touches.delete(event.pointerId);
      try { if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* Pointer capture is progressive enhancement. */ }
      if (gesture.mode === INTERACTION_STATE.PINCHING) {
        commitLivePinch();
        event.preventDefault();
        return;
      }
      if (gesture.mode === INTERACTION_STATE.SETTLING) {
        gesture.pan = null;
        if (gesture.touches.size === 0 && !pendingPinchCommitRef.current) gesture.mode = INTERACTION_STATE.IDLE;
        event.preventDefault();
        return;
      }
      if (gesture.pan?.pointerId === event.pointerId && activeToolRef.current === "hand" && gesture.touches.size === 0) {
        const isTap = Math.hypot(event.clientX - gesture.pan.x, event.clientY - gesture.pan.y) < 14;
        const previousTap = gesture.lastTap;
        if (isTap && previousTap && event.timeStamp - previousTap.time < WORKSPACE_GESTURE.doubleTapDelayMs && Math.hypot(event.clientX - previousTap.x, event.clientY - previousTap.y) < WORKSPACE_GESTURE.doubleTapDistance) {
          gesture.lastTap = null;
          suppressMomentum = true;
          smartZoom({ clientX: event.clientX, clientY: event.clientY });
          event.preventDefault();
        } else if (isTap) gesture.lastTap = { x: event.clientX, y: event.clientY, time: event.timeStamp };
      }
    }
    if (event.pointerType === "pen") {
      gesture.penPointers.delete(event.pointerId);
      gesture.lastPenAt = Date.now();
      // A stylus navigating with the Pan tool gets the same double-tap zoom
      // as a finger.
      if (gesture.pan?.pointerId === event.pointerId && activeToolRef.current === "hand") {
        const isTap = Math.hypot(event.clientX - gesture.pan.x, event.clientY - gesture.pan.y) < 14;
        const previousTap = gesture.lastTap;
        if (isTap && previousTap && event.timeStamp - previousTap.time < WORKSPACE_GESTURE.doubleTapDelayMs && Math.hypot(event.clientX - previousTap.x, event.clientY - previousTap.y) < WORKSPACE_GESTURE.doubleTapDistance) {
          gesture.lastTap = null;
          suppressMomentum = true;
          smartZoom({ clientX: event.clientX, clientY: event.clientY });
        } else if (isTap) gesture.lastTap = { x: event.clientX, y: event.clientY, time: event.timeStamp };
      }
    }
    if (event.pointerType === "mouse" && gesture.pan?.pointerId === event.pointerId && activeToolRef.current === "hand") {
      const isClick = Math.hypot(event.clientX - gesture.pan.x, event.clientY - gesture.pan.y) < 8;
      const previousClick = gesture.lastTap;
      if (isClick && previousClick && event.timeStamp - previousClick.time < 310 && Math.hypot(event.clientX - previousClick.x, event.clientY - previousClick.y) < 20) {
        gesture.lastTap = null;
        smartZoom({ clientX: event.clientX, clientY: event.clientY });
      } else if (isClick) gesture.lastTap = { x: event.clientX, y: event.clientY, time: event.timeStamp };
    }
    if (gesture.pan?.pointerId === event.pointerId) {
      // A tap that lands on a hidden-answer cover lifts it (or puts it back),
      // whichever tool is chosen: a finger pans with every tool, so this is
      // where a tap on the page arrives. It is not also the first half of a
      // double-tap zoom.
      if (Math.hypot(event.clientX - gesture.pan.x, event.clientY - gesture.pan.y) < 10 && toggleCoversAt(event.clientX, event.clientY)) {
        gesture.lastTap = null;
        gesture.selectionTapClear = false;
      }
      // A finger that only tapped empty page with the Select tool clears the
      // selection; one that scrolled keeps it.
      if (gesture.selectionTapClear) {
        gesture.selectionTapClear = false;
        if (Math.hypot(event.clientX - gesture.pan.x, event.clientY - gesture.pan.y) < 10) setSelectedIds([]);
      }
      const completedPan = gesture.pan;
      const pendingDirection = completedPan.direction === GESTURE_DIRECTION.PENDING;
      const lastSample = completedPan.samples[completedPan.samples.length - 1];
      if (!lastSample || Math.hypot(event.clientX - lastSample.x, event.clientY - lastSample.y) > .5) {
        appendRecentPointerSamples(completedPan.samples, [{ x: event.clientX, y: event.clientY, time: event.timeStamp }]);
      }
      if (gesture.panRafId !== null) cancelAnimationFrame(gesture.panRafId);
      gesture.panRafId = null;
      if (!pendingDirection) applyPanPosition(completedPan);
      gesture.pan = null;
      gesture.mode = INTERACTION_STATE.IDLE;
      const hasElasticOffset = !pendingDirection && (Math.abs(completedPan.elasticX) > .1 || Math.abs(completedPan.elasticY) > .1);
      const releaseVelocity = pendingDirection
        ? { x: 0, y: 0, speed: 0 }
        : lockedGestureVelocity(completedPan.direction, estimateReleaseScrollVelocity(completedPan.samples, event.timeStamp));
      if (hasElasticOffset) startPanSpringBack(completedPan.elasticX, completedPan.elasticY, releaseVelocity);
      else {
        documentRef.current?.classList.remove("is-live-panning");
        if (documentRef.current) documentRef.current.style.transform = "";
        // A flick glides on whether it came from a finger or a stylus; a mouse
        // drag stops where it is released, as on a desktop.
        const momentumStarted = (event.pointerType === "touch" || event.pointerType === "pen") && !suppressMomentum && startScrollMomentum(releaseVelocity);
        if (!momentumStarted) endScrollActivity();
      }
      if (event.pointerType !== "mouse") event.preventDefault();
    }
    if (gesture.drawingPointerId !== event.pointerId) return;
    if (gesture.transientInkPage != null) {
      transientInkRef.current.end();
      gesture.transientInkPage = null;
      unlockStageForDrawing(event.pointerId);
      gesture.drawingPointerId = null;
      gesture.drawingPointerType = null;
      gesture.mode = INTERACTION_STATE.IDLE;
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      return;
    }
    if (gesture.holdTimerId !== null && gesture.holdStartedAt !== null && window.performance.now() - gesture.holdStartedAt >= HOLD_RECOGNITION_MS) {
      window.clearTimeout(gesture.holdTimerId);
      gesture.holdTimerId = null;
      applyHeldRecognition(draftRef.current?.id);
    }
    const activeDraft = draftRef.current;
    if (isLiveStroke(activeDraft) && !gesture.holdRecognition && inkInputControllerRef.current.hasActivePointer(event.pointerId)) {
      inkInputControllerRef.current.finish(event.nativeEvent || event);
      gesture.predictedStrokePoints = [];
      if (gesture.liveStrokeRafId !== null) cancelAnimationFrame(gesture.liveStrokeRafId);
      gesture.liveStrokeRafId = null;
      if (liveStrokeCanvasRef.current?.pageNumber === activeDraft.page) {
        const metrics = performanceMonitorRef.current.measure("drawingFrame", () => liveStrokeCanvasRef.current.draw(activeDraft, inkDebugEnabled ? inkInputControllerRef.current.getDiagnostics() : null));
        if (metrics?.geometryTime >= 0) performanceMonitorRef.current.record("geometryTime", metrics.geometryTime);
      }
    } else if (gesture.holdRecognition) inkInputControllerRef.current.cancel("held-shape");
    if (gesture.holdTimerId !== null) window.clearTimeout(gesture.holdTimerId);
    gesture.holdTimerId = null;
    const draft = draftRef.current;
    if (gesture.mode === INTERACTION_STATE.ERASING) commitEraserGesture();
    if (gesture.mode === INTERACTION_STATE.OBJECT_TRANSFORMING && transformRef.current?.pending) finishSelectionTap(event, transformRef.current);
    if (gesture.mode === INTERACTION_STATE.OBJECT_TRANSFORMING && transformRef.current?.after) {
      if (gesture.transformRafId !== null) cancelAnimationFrame(gesture.transformRafId);
      gesture.transformRafId = null;
      applyObjectTransformPreview(transformRef.current.after);
      recordCommand({ type: "update", before: transformRef.current.before, after: transformRef.current.after });
    }
    if (gesture.mode === INTERACTION_STATE.OBJECT_TRANSFORMING) setSelectionDragging(false);
    let handedOffInk = null;
    if (draft?.type === "lasso") {
      const polygon = draft.points;
      if (clipSelecting) {
        const bounds = gestureBounds(polygon);
        if (bounds?.width > 10 && bounds?.height > 10) captureStudyClip(bounds, draft.page);
        else setFocusMessage(t("focus.selectALargerAreaFor"));
        setClipSelecting(false);
      } else if (coverSelecting) {
        const bounds = gestureBounds(polygon);
        if (bounds?.width > 6 && bounds?.height > 6) addCovers([{ page: draft.page, kind: "area", label: "", ...bounds }]);
        else setFocusMessage(t("focus.selectALargerAreaToHide"));
        setCoverSelecting(false);
      } else {
        const ids = polygon.length >= 3 ? lassoSelectionIds(polygon, draft.page) : [];
        setSelectedIds(ids);
      }
    } else if (draft) {
      const meaningful = draft.type === "shape"
        ? Math.abs(draft.end.x - draft.start.x) > 4 || Math.abs(draft.end.y - draft.start.y) > 4
        : isLiveStroke(draft) ? draft.points?.length > 0 : draft.points?.length > 1;
      if (meaningful) {
        let committed = isLiveStroke(draft) ? { ...draft, points: [...draft.points] } : draft;
        if (committed.type === "shape" && !gesture.holdRecognition) committed = finalizeShape(committed);
        const scribbled = isLiveStroke(committed) ? scribbleEraseTargets(draft) : [];
        let recognizedShape = null;
        if (!scribbled.length && isLiveStroke(committed) && drawAndHold && !gesture.holdRecognition && committed.points.length >= 2) {
          const unitsPerCssPixel = pageUnitsPerCssPixel(committed.page);
          const bounds = pageBoundsFor(committed.page);
          const aspect = bounds?.width ? bounds.height / bounds.width : 1;
          const recognition = recognizeHeldStroke(committed.points, { unitsPerCssPixel, aspect });
          if (recognition?.kind === "line") {
            // A line stays ink of the same tool: color, width, opacity, pen
            // style and highlighter blending are unchanged, only straightened.
            recognizedShape = straightenedInkStroke(committed, recognition);
          } else if (recognition && recognition.confidence >= .78 && committed.type !== "highlighter") {
            recognizedShape = recognizedShapeAnnotation(committed, recognition, aspect);
          }
        }
        if (recognizedShape) {
          // The raw stroke was never committed, so the cleaned mark is the
          // whole gesture: one add, and one undo removes it.
          runCommand({ type: "add", items: [recognizedShape] });
        } else if (gesture.holdRecognition && gesture.holdRawStroke && draft.type === "shape") {
          runCommand({ type: "replace", before: [gesture.holdRawStroke], after: [committed] });
        } else if (scribbled.length) {
          runCommand({ type: "remove", items: scribbled });
        } else {
          runCommand({ type: "add", items: [committed] });
          if (isLiveStroke(committed)) handedOffInk = committed.id;
        }
      }
    }
    if (handedOffInk) inkHandoffRef.current = { id: handedOffInk, page: draft.page };
    clearDraft({ keepCanvas: Boolean(handedOffInk) });
    gesture.holdRawStroke = null;
    gesture.holdRecognition = null;
    gesture.holdAnchorPoint = null;
    gesture.holdStartedAt = null;
    gesture.smartSelectionActivated = false;
    transformRef.current = null;
    unlockStageForDrawing(event.pointerId);
    gesture.drawingPointerId = null;
    gesture.drawingPointerType = null;
    gesture.mode = INTERACTION_STATE.IDLE;
    if (event.pointerType === "mouse") updateEraserHitbox(event);
    else hideEraserHitbox();
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function cancelWorkspacePointer(event) {
    const gesture = gestureRef.current;
    if (event.pointerType === "touch" && gesture.rejectedTouches.delete(event.pointerId)) {
      debugGesture("rejected-touch-cancel", event);
      return;
    }
    stopScrollMomentum();
    endScrollActivity();
    stopSpringBack({ discard: true });
    if (gesture.panRafId !== null) cancelAnimationFrame(gesture.panRafId);
    gesture.panRafId = null;
    const root = documentRef.current;
    if ([INTERACTION_STATE.PENDING_DIRECTION, INTERACTION_STATE.VERTICAL_SCROLL, INTERACTION_STATE.HORIZONTAL_PAN, INTERACTION_STATE.FREE_PAN].includes(gesture.mode)) {
      root?.classList.remove("is-live-panning");
      if (root) root.style.transform = "";
    }
    if (gesture.mode === INTERACTION_STATE.PINCHING) {
      pendingPinchCommitRef.current = null;
      clearLivePinchTransform();
    }
    if (gesture.zoomSettleRafId !== null) cancelAnimationFrame(gesture.zoomSettleRafId);
    gesture.zoomSettleRafId = null;
    gesture.zoomSettleComplete = null;
    gesture.touches.clear();
    gesture.penPointers.delete(event.pointerId);
    gesture.rejectedTouches.delete(event.pointerId);
    if (isLiveStroke(draftRef.current) && inkInputControllerRef.current.hasActivePointer(event.pointerId)) {
      inkInputControllerRef.current.finish(event.nativeEvent || event, "pointercancel");
      gesture.predictedStrokePoints = [];
    } else inkInputControllerRef.current.cancel("pointercancel");
    if (gesture.mode === INTERACTION_STATE.OBJECT_TRANSFORMING && transformRef.current?.before) {
      if (gesture.transformRafId !== null) cancelAnimationFrame(gesture.transformRafId);
      gesture.transformRafId = null;
      const replacements = new Map(transformRef.current.before.map((item) => [item.id, item]));
      updateAnnotations((items) => items.map((item) => replacements.get(item.id) || item));
    }
    setSelectionDragging(false);
    gesture.selectionTapClear = false;
    clearEraserPreview();
    hideEraserHitbox();
    commitInterruptedLiveStroke(event);
    clearDraft();
    if (gesture.transientInkPage != null) transientInkRef.current.end();
    gesture.transientInkPage = null;
    gesture.holdRawStroke = null;
    gesture.holdRecognition = null;
    gesture.holdAnchorPoint = null;
    gesture.smartSelectionActivated = false;
    transformRef.current = null;
    unlockStageForDrawing(event.pointerId ?? null);
    gesture.mode = INTERACTION_STATE.IDLE;
    gesture.drawingPointerId = null;
    gesture.drawingPointerType = null;
    gesture.pan = null;
    gesture.pinch = null;
    gesture.lastTap = null;
    debugGesture("pointer-cancel", event);
  }

  function lostWorkspacePointer(event) {
    const gesture = gestureRef.current;
    if (gesture.drawingPointerId !== event.pointerId) return;
    if (isLiveStroke(draftRef.current) && inkInputControllerRef.current.hasActivePointer(event.pointerId)) {
      inkInputControllerRef.current.lostCapture(event.nativeEvent || event);
      gesture.predictedStrokePoints = [];
    }
    cancelWorkspacePointer(event);
  }
  cancelInteractionRef.current = cancelWorkspacePointer;

  function revealZoomHud(nextZoom, label = "") {
    if (zoomHudTimerRef.current) window.clearTimeout(zoomHudTimerRef.current);
    setZoomHud({ visible: true, label: label || `${Math.round(nextZoom * 100)}%` });
    zoomHudTimerRef.current = window.setTimeout(() => {
      zoomHudTimerRef.current = null;
      setZoomHud((current) => ({ ...current, visible: false }));
    }, 950);
  }

  function zoomTo(nextZoom, clientX, clientY, { mode = "manual", label = "" } = {}) {
    stopScrollMomentum();
    cancelZoomSettle();
    const gesture = gestureRef.current;
    if (wheelZoomEndTimerRef.current) {
      window.clearTimeout(wheelZoomEndTimerRef.current);
      wheelZoomEndTimerRef.current = null;
    }
    if (gesture.pinch?.source === "wheel") {
      clearLivePinchTransform();
      gesture.pinch = null;
      gesture.mode = INTERACTION_STATE.IDLE;
    }
    const stage = stageRef.current;
    if (!stage) return;
    if (sheet?.pdfUrl) pdfZoomModeRef.current = mode;
    const bounds = stage.getBoundingClientRect();
    const x = clientX ?? bounds.left + bounds.width / 2;
    const y = clientY ?? bounds.top + bounds.height / 2;
    const finalZoom = clampReaderZoom(nextZoom);
    if (Math.abs(finalZoom - zoomRef.current) < .001) {
      revealZoomHud(finalZoom, label || (mode === "fit" ? t("focus.fitWidth") : ""));
      return;
    }
    const documentElement = documentRef.current?.querySelector(".workspace-v2-a4-document");
    const documentBounds = documentElement?.getBoundingClientRect();
    if (sheet?.pdfUrl && documentBounds?.width > 0 && documentBounds.height > 0) {
      const anchor = documentAnchorFromClient(x, y, documentBounds, zoomRef.current);
      pendingFitAnchorRef.current = {
        finalZoom,
        documentAnchorX: anchor.x,
        documentAnchorY: anchor.y,
        focalClientX: x,
        focalClientY: y
      };
    } else {
      const anchored = zoomScrollForAnchor({ scrollLeft: stage.scrollLeft, scrollTop: stage.scrollTop, viewportLeft: bounds.left, viewportTop: bounds.top, clientX: x, clientY: y, fromScale: zoomRef.current, toScale: finalZoom });
      requestAnimationFrame(() => { stage.scrollLeft = anchored.scrollLeft; stage.scrollTop = anchored.scrollTop; });
    }
    zoomRef.current = finalZoom;
    setZoom(finalZoom);
    revealZoomHud(finalZoom, label || (mode === "fit" ? t("focus.fitWidth") : ""));
  }

  function smartZoom(event) {
    if (activeTool !== "hand") return;
    const fitted = sheet?.pdfUrl ? minimumPdfZoom() : fitWidthZoom(stageRef.current.clientWidth, PAGE_WIDTH, 0);
    const magnification = zoomRef.current / Math.max(.001, fitted);
    const next = magnification < 1.35 ? fitted * 1.75 : fitted;
    zoomTo(next, event.clientX, event.clientY, { mode: next === fitted ? "fit" : "manual", label: next === fitted ? t("focus.fitWidth") : t("focus.smartZoom") });
  }

  function jumpToPagePosition(nextPage, point = null) {
    stopScrollMomentum();
    const virtual = isVirtualPageKey(nextPage) ? virtualPagesRef.current.find((item) => item.id === nextPage) : null;
    const targetPage = virtual?.afterPage || Math.min(accessiblePageCount, Math.max(accessiblePageStart, Number(nextPage) || accessiblePageStart));
    if (virtual && (targetPage < accessiblePageStart || targetPage > accessiblePageCount)) return;
    if (!point && sheet?.pdfUrl && initialPageViewRef.current !== `${materialSlug}/${sheetSlug}`) {
      placeReaderAt({ page: targetPage, virtualPageId: virtual?.id ?? null, pageOffset: null, left: null });
      return;
    }
    setPage(targetPage);
    setActiveVirtualPageId(virtual?.id ?? null);
    const stage = stageRef.current;
    const target = virtual ? stage?.querySelector(`[data-workspace-page="${virtual.id}"]`) : sheet?.pdfUrl ? stage?.querySelector(`[data-pdf-page="${targetPage}"]`) : documentRef.current;
    if (!stage || !target) return;
    const stageBounds = stage.getBoundingClientRect();
    const targetBounds = target.getBoundingClientRect();
    const targetTop = targetBounds.top - stageBounds.top + stage.scrollTop;
    const targetLeft = targetBounds.left - stageBounds.left + stage.scrollLeft;
    // The toolbar floats over the top of the stage; its padding keeps a page
    // that is jumped to from starting underneath it.
    const paddingTop = Number.parseFloat(window.getComputedStyle(stage).paddingTop) || 0;
    const top = point
      ? targetTop + (Math.min(1000, Math.max(0, point.y)) / 1000) * targetBounds.height - stage.clientHeight * 0.32
      : targetTop - paddingTop;
    const left = point
      ? targetLeft + (Math.min(1000, Math.max(0, point.x)) / 1000) * targetBounds.width - stage.clientWidth * 0.5
      : stage.scrollLeft;
    stage.scrollTo({
      top: Math.max(0, top),
      left: Math.max(0, left),
      behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"
    });
    if (window.matchMedia?.("(max-width: 820px)").matches) setOpenSurface(null);
  }

  function addBlankPage(background = "blank") {
    if (!sheet?.pdfUrl || !pdfDocumentReady) return;
    const selectedBackground = WORKSPACE_PAGE_BACKGROUNDS.includes(background) ? background : "blank";
    const id = createVirtualPageId(virtualPagesRef.current);
    const before = virtualPagesRef.current;
    const next = insertVirtualPage(before, page, id, activeVirtualPageId, selectedBackground);
    if (next.length === virtualPagesRef.current.length) {
      setFocusMessage(t("focus.thisWorkspaceHasReachedIts"));
      return;
    }
    applyWorkspacePageCommand({ type: "workspace-page", beforePages: before, afterPages: next, beforeItems: [], afterItems: [], beforeNotes: [], afterNotes: [] }, "redo");
    recordCommand({ type: "workspace-page", beforePages: before, afterPages: next, beforeItems: [], afterItems: [], beforeNotes: [], afterNotes: [] });
    setActiveVirtualPageId(id);
    setSelectedIds([]);
    setOpenSurface(null);
    requestAnimationFrame(() => requestAnimationFrame(() => jumpToPagePosition(id)));
    setFocusMessage(t("focus.backgroundPageAdded", { background: t((PAGE_BACKGROUND_CHOICES.find(([id]) => id === selectedBackground) || PAGE_BACKGROUND_CHOICES[0])[1]), page }));
  }

  /** A whiteboard grows at its end: each new lined page goes after the last one. */
  function addWhiteboardPage() {
    if (!pdfDocumentReady) return;
    const before = virtualPagesRef.current;
    const id = createVirtualPageId(before);
    const next = insertVirtualPage(before, 1, id, before.length ? before[before.length - 1].id : null, "lined");
    if (next.length === before.length) {
      setFocusMessage(t("focus.thisWorkspaceHasReachedIts"));
      return;
    }
    const command = { type: "workspace-page", beforePages: before, afterPages: next, beforeItems: [], afterItems: [], beforeNotes: [], afterNotes: [] };
    applyWorkspacePageCommand(command, "redo");
    recordCommand(command);
    setActiveVirtualPageId(id);
    setSelectedIds([]);
    requestAnimationFrame(() => requestAnimationFrame(() => jumpToPagePosition(id)));
  }

  /** Changes the background of the added page being read; Undo restores it. */
  function changeVirtualPageBackground(background) {
    const id = activeVirtualPageId;
    const before = virtualPagesRef.current;
    const current = before.find((item) => item.id === id);
    if (!current || !WORKSPACE_PAGE_BACKGROUNDS.includes(background) || current.background === background) return;
    const next = before.map((item) => item.id === id ? { ...item, background } : item);
    const command = { type: "workspace-page", beforePages: before, afterPages: next, beforeItems: [], afterItems: [], beforeNotes: [], afterNotes: [] };
    applyWorkspacePageCommand(command, "redo");
    recordCommand(command);
  }

  function deleteBlankPage({ confirmed = false } = {}) {
    const id = activeVirtualPageId;
    if (!isVirtualPageKey(id)) return;
    const anchor = virtualPagesRef.current.find((item) => item.id === id)?.afterPage;
    if (!anchor) return;
    const marks = annotationsRef.current.filter((item) => item.page === id);
    const pageNotes = notesRef.current.filter((item) => item.page === id);
    if ((marks.length || pageNotes.length) && !confirmed) { setDeletePageConfirmOpen(true); return; }
    setDeletePageConfirmOpen(false);
    const before = virtualPagesRef.current;
    const next = removeVirtualPage(before, id);
    const command = { type: "workspace-page", beforePages: before, afterPages: next, beforeItems: marks, afterItems: [], beforeNotes: pageNotes, afterNotes: [] };
    applyWorkspacePageCommand(command, "redo");
    recordCommand(command);
    setActiveVirtualPageId(null);
    setSelectedIds([]);
    setOpenSurface(null);
    requestAnimationFrame(() => jumpToPagePosition(anchor));
    setFocusMessage(t("focus.blankWorkspacePageDeleted"));
  }

  function openNote(note) {
    setSelectedIds([]);
    jumpToPagePosition(note.page);
    setFocusMessage(t("focus.openedNote", { page: note.page }));
  }

  function openHighlight(highlight) {
    const bounds = annotationBounds(highlight);
    setActiveTool("select");
    setOpenSurface(null);
    setSelectedIds([highlight.id]);
    jumpToPagePosition(highlight.page, bounds ? { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 } : null);
    setFocusMessage(t("focus.openedHighlight", { page: highlight.page }));
  }

  function handleWheel(event) {
    if (!event.ctrlKey) {
      const stage = stageRef.current;
      if (!stage || !sheet?.pdfUrl) return;
      event.preventDefault();
      stopScrollMomentum({ endActivity: false });
      const bounds = readerScrollBounds();
      const multiplier = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? Math.max(1, stage.clientHeight) : 1;
      // A trackpad reports its horizontal component in deltaX and a mouse wheel
      // reports Shift-scroll in deltaY. Both have to reach a zoomed page or the
      // document simply cannot be moved sideways with a pointing device.
      const shiftPansHorizontally = event.shiftKey && !event.deltaX;
      const horizontalDelta = (shiftPansHorizontally ? event.deltaY : event.deltaX) * multiplier;
      const verticalDelta = (shiftPansHorizontally ? 0 : event.deltaY) * multiplier;
      if (horizontalDelta) stage.scrollLeft = Math.min(bounds.maxScrollLeft, Math.max(bounds.minScrollLeft, stage.scrollLeft + horizontalDelta));
      if (verticalDelta) stage.scrollTop = Math.min(bounds.maxScrollTop, Math.max(bounds.minScrollTop, stage.scrollTop + verticalDelta));
      return;
    }
    event.preventDefault();
    const gesture = gestureRef.current;
    if (gesture.touches.size >= 2) return;
    if (!gesture.pinch || gesture.pinch.source !== "wheel") {
      const halfSpan = 48;
      const started = startLivePinch([
        { currentX: event.clientX - halfSpan, currentY: event.clientY },
        { currentX: event.clientX + halfSpan, currentY: event.clientY }
      ]);
      if (!started) return;
      gesture.pinch.source = "wheel";
    }
    gesture.pinch.currentFocalX = event.clientX;
    gesture.pinch.currentFocalY = event.clientY;
    gesture.pinch.currentScale = clampReaderZoom(
      gesture.pinch.currentScale * Math.exp(-event.deltaY * WORKSPACE_ZOOM.wheelSensitivity)
    );
    gesture.pinch.displayScale = gesture.pinch.currentScale;
    scheduleLivePinchFrame();
    if (wheelZoomEndTimerRef.current) window.clearTimeout(wheelZoomEndTimerRef.current);
    wheelZoomEndTimerRef.current = window.setTimeout(() => {
      wheelZoomEndTimerRef.current = null;
      if (gestureRef.current.pinch?.source !== "wheel") return;
      commitLivePinch();
    }, WORKSPACE_ZOOM.wheelSettleMs);
  }
  wheelHandlerRef.current = handleWheel;
  jumpToPageRef.current = jumpToPagePosition;

  function selectTool(nextTool) {
    setCoverSelecting(false);
    setClipSelecting(false);
    if (annotationsHidden && ["pen", "pencil", "highlighter", "eraser", "select", "shapes"].includes(nextTool)) setAnnotationsHidden(false);
    if (nextTool === "note") {
      const openingNotes = openSurface !== "notes";
      setSideTab("notes");
      setOpenSurface(openingNotes ? "notes" : null);
      if (openingNotes) window.setTimeout(() => noteRef.current?.focus(), 0);
      return;
    }
    if (nextTool === "image") {
      setOpenSurface(null);
      imageInputRef.current?.click();
      return;
    }
    if (nextTool === activeToolRef.current) {
      if (CONFIGURABLE_TOOLS.has(nextTool)) {
        setOpenSurface((current) => current === `tool:${nextTool}` ? null : `tool:${nextTool}`);
        setCustomColorEditorOpen(false);
      }
      return;
    }
    const rememberedProfile = nextTool === "pen" ? currentPenProfile(String(toolMemoryRef.current.lastPenProfile || PEN_PROFILE.BALL)) : toolStateRef.current.penProfile;
    const remembered = toolMemoryRef.current[nextTool === "pen" ? `pen:${rememberedProfile}` : nextTool];
    const next = { ...toolStateRef.current, activeTool: nextTool, penProfile: rememberedProfile };
    if (remembered) {
      next.activeColor = remembered.color || COLORS[0];
      next.brushSize = Number(remembered.size) || 4;
      next.pressureSensitivity = Number.isFinite(Number(remembered.pressureSensitivity)) ? Number(remembered.pressureSensitivity) : .55;
      next.strokeSmoothing = Number.isFinite(Number(remembered.smoothing)) ? Number(remembered.smoothing) : .5;
      if (nextTool === "highlighter") next.highlighterOpacity = Number(remembered.opacity) || .34;
      else if (nextTool === "pencil") next.pencilOpacity = Number(remembered.opacity) || .78;
      else next.brushOpacity = Number(remembered.opacity) || 1;
      if (nextTool === "shapes" && remembered.shapeStyle) next.shapeStyle = remembered.shapeStyle;
    }
    // Takes effect for the very next pointerdown, before React re-renders.
    activeToolRef.current = nextTool;
    toolStateRef.current = next;
    if (nextTool === "pen") setPenProfile(rememberedProfile);
    if (remembered) {
      setActiveColor(remembered.color || COLORS[0]);
      setBrushSize(Number(remembered.size) || 4);
      setPressureSensitivity(Number.isFinite(Number(remembered.pressureSensitivity)) ? Number(remembered.pressureSensitivity) : .55);
      setStrokeSmoothing(Number.isFinite(Number(remembered.smoothing)) ? Number(remembered.smoothing) : .5);
      if (nextTool === "highlighter") setHighlighterOpacity(Number(remembered.opacity) || .34);
      else if (nextTool === "pencil") setPencilOpacity(Number(remembered.opacity) || .78);
      else setBrushOpacity(Number(remembered.opacity) || 1);
      if (nextTool === "shapes" && remembered.shapeStyle) setShapeStyle(remembered.shapeStyle);
    }
    setActiveTool(nextTool);
    setOpenSurface(openSurface?.startsWith("tool:") && CONFIGURABLE_TOOLS.has(nextTool) ? `tool:${nextTool}` : null);
    setCustomColorEditorOpen(false);
    if (nextTool !== "select" && nextTool !== "eraser") setSelectedIds([]);
  }

  function chooseWritingTool(tool) {
    selectTool(tool);
  }

  function addTextAnnotation() {
    const value = textDraft.trim();
    if (!value) return;
    const existing = annotationsRef.current.find((item) => item.id === editingTextId && item.type === "text");
    const formatting = { text: value, align: textAlign, bold: textBold, color: textColor, width: textFontSize / 5 };
    if (existing) runCommand({ type: "update", before: [existing], after: [{ ...existing, ...formatting }] });
    else {
      const id = generateIdempotencyKey();
      runCommand({ type: "add", items: [{ id, page: activePageKey, type: "text", x: textAlign === "left" ? 100 : textAlign === "right" ? 900 : 500, y: 360, opacity: 1, ...formatting }] });
      revealInsertedAnnotation(id);
      // New text is an object to place: it arrives selected under the Select
      // tool, ready to drag, and a double tap edits it.
      selectTool("select");
      setSelectedIds([id]);
    }
    setTextDraft("");
    setEditingTextId(null);
    setOpenSurface(null);
    setFocusMessage(existing ? t("focus.textUpdated") : t("focus.textAdded", { page }));
  }

  /** Opens the editor for a text or card; the one path taps and buttons share. */
  function editAnnotation(item) {
    if (!item || item.locked) return;
    if (item.type === "card") {
      setEditingCardId(item.id);
      setCardKind(item.cardKind);
      setCardDraft(item.text);
      setOpenSurface("card");
      return;
    }
    if (item.type !== "text") return;
    setEditingTextId(item.id);
    setTextDraft(item.text);
    setTextFontSize(Math.round(Math.max(18, item.width * 5)));
    setTextAlign(item.align || "left");
    setTextBold(item.bold === true);
    setTextColor(item.color || COLORS[0]);
    setOpenSurface("text");
  }

  function finalizeShape(shape) {
    const start = shapeSnapGrid
      ? { ...shape.start, x: Math.round(shape.start.x / 25) * 25, y: Math.round(shape.start.y / 25) * 25 }
      : shape.start;
    let end = shapeSnapGrid
      ? { ...shape.end, x: Math.round(shape.end.x / 25) * 25, y: Math.round(shape.end.y / 25) * 25 }
      : shape.end;
    if (["line", "arrow"].includes(shape.shape) && shapeAngle > 0) {
      const distance = Math.hypot(end.x - start.x, end.y - start.y);
      const angle = Math.atan2(end.y - start.y, end.x - start.x);
      const step = shapeAngle * Math.PI / 180;
      const snapped = Math.round(angle / step) * step;
      end = { ...end, x: Math.min(1000, Math.max(0, start.x + Math.cos(snapped) * distance)), y: Math.min(1000, Math.max(0, start.y + Math.sin(snapped) * distance)) };
    }
    if (["square", "circle"].includes(shape.shape)) end = equalSidedEnd(start, end, pageAspectFor(shape.page));
    return { ...shape, start, end };
  }

  function saveCard() {
    const text = cardDraft.trim();
    if (!text) return;
    const existing = annotationsRef.current.find((item) => item.id === editingCardId && item.type === "card");
    // The card grows with its text, so nothing is cut off when it is saved.
    if (existing) runCommand({ type: "update", before: [existing], after: [{ ...existing, cardKind, text, height: Math.max(existing.height, noteCardHeight(text, existing.width, pageAspectFor(existing.page))) }] });
    else {
      const id = generateIdempotencyKey();
      runCommand({ type: "add", items: [{ id, page: activePageKey, type: "card", cardKind, text, x: (1000 - NOTE_CARD_WIDTH) / 2, y: 240, width: NOTE_CARD_WIDTH, height: noteCardHeight(text, NOTE_CARD_WIDTH, pageAspectFor(activePageKey)), color: "#1d3152", opacity: 1 }] });
      revealInsertedAnnotation(id);
    }
    setCardDraft("");
    setEditingCardId(null);
    setOpenSurface(null);
    setFocusMessage(existing ? t("focus.cardUpdated") : t("focus.studyCardAdded"));
  }

  /** Removes the selection as one undoable step; undo puts it back in place. */
  function deleteSelection() {
    const items = selectedAnnotations.filter((item) => !item.locked);
    if (!items.length) return;
    runCommand({ type: "remove", items });
    setSelectedIds([]);
    setSelectionActionsOpen(false);
    setFocusMessage(items.length === 1 && items[0].type === "card" ? t("focus.noteDeletedUndoRestoresIt") : t("focus.itemsDeleted", { count: items.length }));
  }

  function deleteEditingCard() {
    const card = annotationsRef.current.find((item) => item.id === editingCardId && item.type === "card");
    setEditingCardId(null);
    setCardDraft("");
    setOpenSurface(null);
    if (!card || card.locked) return;
    runCommand({ type: "remove", items: [card] });
    setSelectedIds([]);
    setFocusMessage(t("focus.noteDeletedUndoRestoresIt"));
  }

  /**
   * Adds hide-and-reveal covers as one undoable step. Each entry is a box in
   * page space; entries that share a groupId move and delete together.
   */
  function addCovers(entries) {
    if (!entries.length) return [];
    if (entries.length > MAX_COVERS_PER_ACTION) {
      setFocusMessage(t("focus.narrowSearchForCovers"));
      return [];
    }
    const items = entries.map((entry) => {
      return {
        id: generateIdempotencyKey(),
        page: entry.page,
        type: "cover",
        kind: entry.kind,
        label: entry.label || "",
        groupId: entry.groupId || "",
        color: COVER_COLOR,
        opacity: 1,
        ...coverRectangle(entry)
      };
    });
    runCommand({ type: "add", items });
    if (annotationsHidden) setAnnotationsHidden(false);
    // Hiding is preparation for recall: return to reading, where the next tap
    // on a cover reveals it rather than selecting it.
    setSelectedIds([]);
    setActiveTool("hand");
    items.forEach((item) => revealInsertedAnnotation(item.id));
    setFocusMessage(items.length === 1 ? t("focus.coverAdded") : t("focus.coversAdded", { count: items.length }));
    return items;
  }

  function hideSearchMatches(matches, keepSearch = false) {
    const entries = searchCoverEntries(matches, annotationsRef.current, generateIdempotencyKey);
    if (!addCovers(entries).length) return;
    if (!keepSearch) documentSearch.clear();
    if (!keepSearch || window.matchMedia?.("(max-width: 820px)").matches) setOpenSurface(null);
  }

  function showSearchMatch(match) {
    const [first] = match?.rectangles || [];
    if (!first) return;
    jumpToPagePosition(match.page, { x: first.x + first.width / 2, y: first.y + first.height / 2 });
  }

  /** The covers under a point; a grouped cover lifts with its group. */
  function coverIdsAtPoint(point) {
    if (annotationsHidden || !point?.page) return [];
    const onPage = annotationsRef.current.filter((item) => item.page === point.page);
    const hit = [...onPage].reverse().find((item) => item.type === "cover"
      && point.x >= item.x && point.x <= item.x + item.width && point.y >= item.y && point.y <= item.y + item.height);
    if (!hit) return [];
    return hit.groupId ? onPage.filter((item) => item.type === "cover" && item.groupId === hit.groupId).map((item) => item.id) : [hit.id];
  }

  function toggleCoversAt(clientX, clientY) {
    const ids = coverIdsAtPoint(documentPoint(clientX, clientY));
    if (!ids.length) return false;
    setRevealedCoverIds((current) => {
      const next = new Set(current);
      const reveal = !current.has(ids[0]);
      ids.forEach((id) => (reveal ? next.add(id) : next.delete(id)));
      return next;
    });
    return true;
  }

  function toggleAllCovers() {
    setRevealedCoverIds(allCoversRevealed ? new Set() : new Set(coverIds));
  }

  function captureStudyClip(bounds, pageKey) {
    if (isVirtualPageKey(pageKey)) { setFocusMessage(t("focus.chooseAnAreaOnAn")); return; }
    const pageElement = stageRef.current?.querySelector(`[data-workspace-page="${pageKey}"]`);
    const source = pageElement?.querySelector("canvas.workspace-v2-a4-canvas.is-visible");
    if (!source || !source.width || !source.height) { setFocusMessage(t("focus.thisPageIsStillRendering")); return; }
    const crop = document.createElement("canvas");
    const x = Math.max(0, Math.floor(bounds.x / 1000 * source.width));
    const y = Math.max(0, Math.floor(bounds.y / 1000 * source.height));
    const width = Math.min(source.width - x, Math.max(1, Math.ceil(bounds.width / 1000 * source.width)));
    const height = Math.min(source.height - y, Math.max(1, Math.ceil(bounds.height / 1000 * source.height)));
    crop.width = Math.min(1100, width);
    crop.height = Math.max(1, Math.round(height * crop.width / width));
    crop.getContext("2d")?.drawImage(source, x, y, width, height, 0, 0, crop.width, crop.height);
    const src = crop.toDataURL("image/jpeg", .82);
    if (src.length > 2_800_000) { setFocusMessage(t("focus.thatAreaIsTooLarge")); return; }
    const placedWidth = Math.min(470, Math.max(160, bounds.width));
    const placedHeight = Math.min(470, Math.max(100, placedWidth * height / width));
    const clipId = generateIdempotencyKey();
    runCommand({ type: "add", items: [{ id: clipId, page: pageKey, type: "image", kind: "clip", src, x: Math.min(1000 - placedWidth, bounds.x), y: Math.min(1000 - placedHeight, bounds.y + bounds.height + 20), width: placedWidth, height: placedHeight, color: "#ffffff", opacity: 1 }] });
    revealInsertedAnnotation(clipId);
    setOpenSurface(null);
    setFocusMessage(t("focus.studyClipAddedSelectIt"));
  }

  function groupSelection() {
    if (selectedAnnotations.length < 2) return;
    const groupId = generateIdempotencyKey();
    runCommand({ type: "update", before: selectedAnnotations, after: selectedAnnotations.map((item) => ({ ...item, groupId })) });
    setFocusMessage(t("focus.selectedItemsGrouped"));
  }

  function ungroupSelection() {
    const grouped = selectedAnnotations.filter((item) => item.groupId);
    if (!grouped.length) return;
    runCommand({ type: "update", before: grouped, after: grouped.map((item) => ({ ...item, groupId: "" })) });
    setFocusMessage(t("focus.selectedItemsUngrouped"));
  }

  function toggleSelectionLock() {
    if (!selectedAnnotations.length) return;
    const locked = !selectedAnnotations.every((item) => item.locked);
    runCommand({ type: "update", before: selectedAnnotations, after: selectedAnnotations.map((item) => ({ ...item, locked })) });
    setFocusMessage(locked ? t("focus.selectionLocked") : t("focus.selectionUnlocked"));
  }

  /** One step up or down the page's painting order, as a single undoable update. */
  function layerSelection(direction) {
    if (!selectedAnnotations.length || selectionPage === null || selectedAnnotations.some((item) => item.locked)) return;
    const { before, after } = reorderSelection(annotationsRef.current.filter((item) => item.page === selectionPage), selectedIds, direction);
    if (!after.length) return;
    runCommand({ type: "update", before, after });
  }

  function improveSelectedHandwriting() {
    const strokes = selectedAnnotations.filter((item) => ["pen", "pencil"].includes(item.type) && item.points?.length >= 3);
    if (!strokes.length) { setFocusMessage(t("focus.selectHandwritingToImproveFirst")); return; }
    // Stroke points remain untouched. Rendering smooths the path, and Undo can
    // restore the previous strength without losing the student's input.
    const after = strokes.map((item) => ({ ...item, smoothing: Math.max(.8, item.smoothing || 0) }));
    runCommand({ type: "update", before: strokes, after });
    setFocusMessage(t("focus.strokesSmoothed", { count: strokes.length }));
  }

  /**
   * Settings shows every section as a card: two columns on wide screens, one
   * scrolling list on narrower ones. The nav marks the section and brings its
   * card into view.
   */
  function closeSurfaceAndRestoreFocus(selector) {
    setOpenSurface(null);
    window.setTimeout(() => rootRef.current?.querySelector(selector)?.focus(), 0);
  }

  /**
   * Takes up a favorite pen in one step, through the same path as choosing a
   * tool, so the very next stroke already uses it.
   */
  function applyFavoritePen(index) {
    const favorite = favoritePens[index];
    if (!favorite) return;
    const tool = favorite.tool;
    const profile = tool === "pen" ? favorite.profile : toolStateRef.current.penProfile;
    const next = { ...toolStateRef.current, activeTool: tool, penProfile: profile, activeColor: favorite.color, brushSize: favorite.width };
    if (tool === "highlighter") next.highlighterOpacity = favorite.opacity;
    else next.brushOpacity = favorite.opacity;
    activeToolRef.current = tool;
    toolStateRef.current = next;
    setCoverSelecting(false);
    setClipSelecting(false);
    if (annotationsHidden) setAnnotationsHidden(false);
    if (tool === "pen") setPenProfile(profile);
    setActiveColor(favorite.color);
    setBrushSize(favorite.width);
    if (tool === "highlighter") setHighlighterOpacity(favorite.opacity);
    else setBrushOpacity(favorite.opacity);
    setActiveTool(tool);
    setOpenSurface((current) => current?.startsWith("tool:") ? null : current);
    setCustomColorEditorOpen(false);
    setSelectedIds([]);
  }

  function currentFavoritePen() {
    return normalizeFavoritePen({ tool: activeTool, profile: penProfile, color: activeColor, width: brushSize, opacity: activeToolOpacity });
  }

  function saveFavoritePen() {
    const favorite = currentFavoritePen();
    if (!favorite) return;
    setFavoritePens((current) => normalizeFavoritePens([...current, favorite]));
    setFocusMessage(t("focus.favoritePenSaved"));
  }

  function replaceFavoritePen(index) {
    const favorite = currentFavoritePen();
    if (!favorite) return;
    setFavoritePens((current) => normalizeFavoritePens(current.map((item, position) => position === index ? favorite : item)));
  }

  function removeFavoritePen(index) {
    setFavoritePens((current) => current.filter((_, position) => position !== index));
  }

  function openZoomWindow() {
    setOpenSurface(null);
    if (!["pen", "highlighter"].includes(activeToolRef.current)) selectTool("pen");
    // Start at the margin, a little below the top of what is on screen.
    const stage = stageRef.current?.getBoundingClientRect();
    const point = stage ? documentPoint(stage.left + stage.width / 2, stage.top + stage.height * .18, activePageKey) : null;
    setZoomWindow(initialZoomRegion(activePageKey, point ? Math.max(0, Math.min(900, point.y)) : 80, document.documentElement.dir === "rtl"));
  }

  function commitZoomWindowStroke(stroke) {
    runCommand({ type: "add", items: [stroke] });
  }

  function changePenProfile(nextProfile) {
    const remembered = toolMemoryRef.current[`pen:${nextProfile}`];
    setPenProfile(nextProfile);
    if (!remembered) {
      if (TRANSIENT_DEFAULT_COLOR[nextProfile]) setActiveColor(TRANSIENT_DEFAULT_COLOR[nextProfile]);
      setBrushSize(nextProfile === PEN_PROFILE.BRUSH ? 5 : 4);
      setPressureSensitivity(nextProfile === PEN_PROFILE.BALL ? .35 : nextProfile === PEN_PROFILE.FOUNTAIN ? .6 : .82);
      setStrokeSmoothing(nextProfile === PEN_PROFILE.BALL ? .42 : nextProfile === PEN_PROFILE.FOUNTAIN ? .56 : .62);
      return;
    }
    setActiveColor(remembered.color || activeColor);
    setBrushSize(Number(remembered.size) || 4);
    setPressureSensitivity(Number.isFinite(Number(remembered.pressureSensitivity)) ? Number(remembered.pressureSensitivity) : .55);
    setStrokeSmoothing(Number.isFinite(Number(remembered.smoothing)) ? Number(remembered.smoothing) : .5);
  }

  function chooseAnnotationColor(color) {
    const normalized = normalizeToolColor(color) || activeColor;
    updateSelectionColor(normalized);
  }

  function toggleFavoriteColor() {
    const normalized = normalizeToolColor(activeColor);
    if (!normalized) return;
    setFavoriteColors((items) => items.includes(normalized) ? items.filter((color) => color !== normalized) : [normalized, ...items].slice(0, 5));
  }

  function commitCustomColor() {
    const normalized = normalizeToolColor(customColorDraft);
    if (!normalized) return;
    if (!paletteColors.includes(normalized) && paletteColors.length >= MAX_PALETTE_COLORS) return;
    setRecentColors((items) => addSavedColor(items, normalized, MAX_PALETTE_COLORS, COLORS));
    updateSelectionColor(normalized);
    setCustomColorEditorOpen(false);
  }

  function deleteCustomColor(color) {
    const normalized = normalizeToolColor(color);
    if (!normalized) return;
    const nextColors = removeSavedColor(recentColors, normalized, MAX_PALETTE_COLORS, COLORS);
    setRecentColors(nextColors);
    setFavoriteColors((items) => items.filter((item) => item !== normalized));
    if (activeColor === normalized) setActiveColor(normalizeSavedPalette([...COLORS, ...nextColors], MAX_PALETTE_COLORS)[0] || COLORS[0]);
    if (customColorDraft === normalized) setCustomColorDraft(COLORS[0]);
  }

  function changeDrawingInput(value) {
    drawingInputChosenRef.current = true;
    setDrawingInput(value);
    try { window.localStorage.setItem("lock-in.catalog-workspace.drawing-input.v2", value); } catch { /* This non-sensitive preference can remain in memory. */ }
  }

  function addImage(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !file.type.startsWith("image/")) { setFocusMessage(t("focus.chooseAPNGJPEGWebP")); return; }
    if (file.size > 2_000_000) { setFocusMessage(t("focus.useAnImageSmallerThan")); return; }
    const reader = new window.FileReader();
    reader.onload = () => {
      const id = generateIdempotencyKey();
      runCommand({ type: "add", items: [{ id, page: activePageKey, type: "image", src: String(reader.result), x: 350, y: 300, width: 300, height: 220, opacity: 1, color: activeColor }] });
      revealInsertedAnnotation(id);
      setFocusMessage(t("focus.imageAddedAndQueuedFor"));
    };
    reader.onerror = () => setFocusMessage(t("focus.theSelectedImageCouldNot"));
    reader.readAsDataURL(file);
  }

  function duplicateSelection() {
    const items = selectedAnnotations;
    if (!items.length) return;
    const copies = copiedAnnotations(items, selectionPage ?? activePageKey, COPY_OFFSET);
    runCommand({ type: "add", items: copies });
    setSelectedIds(copies.map((item) => item.id));
    setFocusMessage(t("focus.itemsDuplicated", { count: copies.length }));
  }

  function copySelection() {
    if (!selectedAnnotations.length) return;
    selectionClipboardRef.current = selectedAnnotations.map(cloneAnnotation);
    setClipboardSize(selectionClipboardRef.current.length);
    setFocusMessage(t("focus.itemsCopied", { count: selectedAnnotations.length }));
  }

  /** Copy, then delete as one undoable step; Undo brings the items back where they were. */
  function cutSelection() {
    if (!selectedAnnotations.length || selectedAnnotations.some((item) => item.locked)) return;
    const items = selectedAnnotations;
    selectionClipboardRef.current = items.map(cloneAnnotation);
    setClipboardSize(items.length);
    runCommand({ type: "remove", items });
    setSelectedIds([]);
    setFocusMessage(t("focus.itemsCut", { count: items.length }));
  }

  /**
   * Pastes onto the page being read, a little offset from where the items were
   * copied. The clipboard then holds the pasted copies, so pasting again steps
   * further instead of stacking copies on one spot.
   */
  function pasteSelection() {
    if (!selectionClipboardRef.current.length) return;
    const copies = copiedAnnotations(selectionClipboardRef.current, activePageKey, COPY_OFFSET);
    runCommand({ type: "add", items: copies });
    selectionClipboardRef.current = copies.map(cloneAnnotation);
    if (activeToolRef.current !== "select") selectTool("select");
    setSelectedIds(copies.map((item) => item.id));
    setFocusMessage(t("focus.itemsPasted", { count: copies.length }));
  }

  selectionCommandsRef.current = {
    copy: copySelection,
    cut: cutSelection,
    paste: pasteSelection,
    duplicate: duplicateSelection,
    delete: deleteSelection
  };

  function rotateSelection() {
    if (!selectedAnnotations.length || !selectedBounds || selectedAnnotations.some((item) => item.locked)) return;
    const after = selectedAnnotations.map((item) => rotateAnnotation(item, selectedBounds));
    runCommand({ type: "update", before: selectedAnnotations, after });
  }

  function updateSelectionColor(color) {
    setActiveColor(color);
    if (!selectedAnnotations.length || activeTool !== "select") return;
    const after = selectedAnnotations.map((item) => ({ ...item, color }));
    runCommand({ type: "update", before: selectedAnnotations, after });
  }

  chooseActiveStudyRef.current = chooseActiveStudy;

  function chooseNormalStudy() {
    clearActiveStudyEntry(activeEntryKey);
    setStudyMode("normal");
    setModeDialogOpen(false);
    setEntryModePreference("");
    setActiveStudyError("");
  }

  async function chooseActiveStudy(difficulty = activeDifficulty, { resuming = false, settings = activeCustomization, replaceExisting = false } = {}) {
    if (activeStudyBusy || (!resuming && !activeStudyReady)) return;
    setActiveStudyBusy(true);
    setActiveStudyError("");
    try {
      // The selected difficulty owns its own run.  Never substitute a different
      // in-progress difficulty here: it can already be at a checkpoint and
      // would make choosing Easy / Medium / Hard appear to open a quiz.
      const payload = await focusApi.startManagedActiveStudy({ sheetId: sheet.learningObjectId, difficulty, edition: sheetEdition?.edition, ...settings, replaceExisting });
      const run = /** @type {any} */ (payload.run);
      setActiveDifficulty(run.difficulty);
      setActiveCustomization({ studyMode: run.study_mode || "standard", pagesPerCheckpoint: run.pages_per_checkpoint || 3, questionsPerCheckpoint: run.questions_per_checkpoint || 5 });
      setActiveStudy(run);
      setStudyMode("active");
      setModeDialogOpen(false);
      setEntryModePreference("");
      // A new run begins at page one. A resumed run returns to its latest
      // unlocked part, with every earlier part still above it in the reader.
      // The run's current part/stage remains server-owned and untouched.
      const chosenResume = readActiveStudyResume(run.id);
      const savedPage = chosenResume !== undefined ? chosenResume : rememberLastPosition ? restored?.view?.page : null;
      placeReaderAt(payload.resumed
        ? activeStudyResumePage(run.current_page_range, { stage: run.stage, savedPage })
        : 1);
      setFocusMessage(run.study_mode === "custom" ? t("activeStudy.pageRange", { start: run.current_page_range?.start_page, end: run.current_page_range?.end_page }) : t(payload.resumed ? "focus.partResumed" : "focus.partStarted", { part: run.current_part }));
    } catch (error) {
      setActiveStudyError(error.message || t("focus.activeStudyStartFailed"));
    } finally {
      setActiveStudyBusy(false);
    }
  }

  async function loadManagedQuestions(run) {
    const payload = await focusApi.getManagedActiveStudyQuestions(run.id);
    const existingAnswers = {};
    const questions = /** @type {any[]} */ (payload.questions).map((question) => {
      if (question.answered) existingAnswers[String(question.position)] = question.answered;
      return {
        id: String(question.position),
        position: question.position,
        prompt: question.question,
        options: Object.entries(question.options).map(([id, text]) => ({ id, text }))
      };
    });
    // Answers the server already holds win over a local draft.
    const draft = readActiveStudyDraft(payload.attempt_id)?.answers || {};
    const positions = new Set(questions.map((question) => question.id));
    const draftAnswers = Object.fromEntries(Object.entries(draft).filter(([id, value]) => positions.has(id) && typeof value === "string"));
    setActiveStudy(payload.run || run);
    setActiveQuiz({ ...payload, run: payload.run || run, questions });
    setActiveAnswers({ ...draftAnswers, ...existingAnswers });
    setActiveLocked(existingAnswers);
    setActiveResult(null);
  }

  async function openActiveQuiz() {
    if (!activeStudy || activeStudyBusy || !activeStudyButtonReady) return;
    quizReaderAnchorRef.current = captureReaderAnchor();
    if (ACTIVE_RESULT_STAGES.has(activeStudy.stage)) {
      const kind = activeStudy.stage === "final_result" ? "final" : "checkpoint";
      const passed = activeStudy.last_outcome === "passed";
      setActiveQuiz({ attempt_id: `result:${activeStudy.id}`, kind, run: activeStudy, questions: [] });
      setActiveAnswers({});
      setActiveLocked({});
      setActiveResult({ score: activeStudy.last_score ?? 0, total: null, review: [], outcome: passed ? "passed" : kind === "final" ? "failed" : "advisory" });
      return;
    }
    setActiveStudyBusy(true);
    setActiveStudyError("");
    try {
      const run = activeStudy.stage === "reading"
        ? (await focusApi.managedActiveStudyAction(activeStudy.id, "complete-reading")).run
        : activeStudy;
      await loadManagedQuestions(run);
    } catch (error) {
      setFocusMessage(error.message || t("focus.activeTestLoadFailed"));
    } finally {
      setActiveStudyBusy(false);
    }
  }

  async function openPomodoroQuiz(choices) {
    if (!activeStudy || activeStudyBusy || activeStudy.study_mode !== "pomodoro") return;
    quizReaderAnchorRef.current = captureReaderAnchor();
    setActiveStudyBusy(true);
    setActiveStudyError("");
    try {
      const payload = await focusApi.managedActiveStudyAction(activeStudy.id, "complete-reading", choices);
      const run = /** @type {any} */ (payload.run);
      // Keep the frozen boundary even if loading the questions then loses the connection.
      setActiveStudy(run);
      await loadManagedQuestions(run);
    } finally { setActiveStudyBusy(false); }
  }

  const mcqExplain = useMcqExplainLinks(user?.id, shareDocumentId, activeQuiz?.attempt_id, Boolean(STUDY_TOOLS_ENABLED && !COMING_SOON_STUDY_TOOLS.includes("explain") && activeResult && !activeResult.pending_sync));
  function openMistakeExplain(link) {
    if (!link || link.page_end > accessiblePageCount) { setFocusMessage(t("knowledge.lockedSource")); return; }
    setActiveQuiz(null);
    setKnowledgeVisited(true); setKnowledgeOpen(true);
    setKnowledgeNavigation({ ...link, requestId: globalThis.crypto.randomUUID() });
  }
  const studyToolsAvailable = Boolean(STUDY_TOOLS_ENABLED && shareDocumentId && user?.id);
  // Loaded as soon as the reader is ready, so the launcher already lists the tools the first time it opens.
  useEffect(() => {
    if (!workspaceReady || !studyToolsAvailable || studyToolFlags?.documentId === shareDocumentId) return undefined;
    let current = true;
    createKnowledgeStore(user.id, shareDocumentId, knowledgeApi).bootstrap()
      .then((bootstrap) => { if (current) setStudyToolFlags({ documentId: shareDocumentId, tools: bootstrap?.enabled ? bootstrap.tools || {} : {} }); })
      .catch(() => {});
    return () => { current = false; };
  }, [workspaceReady, studyToolsAvailable, studyToolFlags?.documentId, shareDocumentId, user?.id]);
  const enabledStudyTools = studyToolsAvailable && studyToolFlags?.documentId === shareDocumentId ? availableStudyTools(studyToolFlags.tools) : {};
  // The knowledge panel's own summary is replaced by My Summary (below); its map and explain tools stay.
  const studyTools = /** @type {[string, typeof FileText][]} */ ([...(KNOWLEDGE_FIXTURE_TOOLS ? [["summary", FileText]] : []), ["map", Network], ["explain", Lightbulb]]).filter(([tool]) => enabledStudyTools[tool]);
  function openStudyTool(tool) {
    setOpenSurface(null);
    setKnowledgeVisited(true); setKnowledgeOpen(true);
    setKnowledgeNavigation({ requestId: globalThis.crypto.randomUUID(), tool });
  }

  /*
   * My Summary. A pen summary is one blank page after every sheet page, marked
   * with the summary's id in the workspace's own page list, so its ink syncs,
   * exports and survives reloads like any page the student adds. A keyboard
   * summary is text by sheet page, written in a side panel. Neither touches the
   * sheet's numbering, so Active Study and Pomodoro run unchanged beside it.
   */
  const summariesEnabled = Boolean(shareDocumentId && user?.id);
  const sheetSummaries = useSheetSummaries(summariesEnabled ? shareDocumentId : "");
  const [summaryDialogOpen, setSummaryDialogOpen] = useState(false);
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [summaryError, setSummaryError] = useState("");
  const [summaryPanelId, setSummaryPanelId] = useState("");
  const requestedSummaryId = searchParams.get("summary") || "";
  const openedSummaryLink = useRef("");
  const requestedSourcePage = Number(searchParams.get("sourcePage"));
  const requestedSourceVersion = searchParams.get("sourceVersion") || "";
  const openedSourcePage = useRef("");
  const [summaryPanelOpen, setSummaryPanelOpen] = useState(true);
  const [summaryReceiveDismissed, setSummaryReceiveDismissed] = useState(false);
  const shownSummaryIds = useMemo(() => new Set(sheetSummaries.summaries.filter((item) => item.visible).map((item) => item.id)), [sheetSummaries.summaries]);
  // Hidden summaries keep their pages and ink; the reader just leaves them out.
  const readerVirtualPages = useMemo(() => virtualPages.filter((item) => !item.summary || shownSummaryIds.has(item.summary)), [virtualPages, shownSummaryIds]);
  const shownKeyboardSummaries = sheetSummaries.summaries.filter((item) => item.mode === "keyboard" && item.visible);
  const shownPenSummaries = sheetSummaries.summaries.filter((item) => item.mode === "pen" && item.visible);

  // A pen summary deleted on another device leaves its pages here. Pages that
  // name a summary this tab does not know may equally belong to one another
  // device has just started, so the server is asked again first, and only
  // pages whose summary it no longer has are removed.
  const summaryIdsKey = virtualPages.filter((item) => item.summary).map((item) => item.summary).filter((id, index, all) => all.indexOf(id) === index).sort().join(",");
  const reloadSummaries = sheetSummaries.reload;
  useEffect(() => {
    if (!sheetSummaries.loaded || !workspaceReady || !summaryIdsKey) return undefined;
    const known = new Set(sheetSummaries.summaries.map((item) => item.id));
    if (summaryIdsKey.split(",").every((id) => known.has(id))) return undefined;
    let current = true;
    sheetSummariesApi.forDocument(shareDocumentId).then(({ results }) => {
      if (!current) return;
      const fresh = new Set(results.map((item) => item.id));
      const ids = new Set(virtualPagesRef.current.filter((item) => item.summary && !fresh.has(item.summary)).map((item) => item.id));
      if (ids.size) {
        const next = virtualPagesRef.current.filter((item) => !ids.has(item.id));
        virtualPagesRef.current = next;
        setVirtualPages(next);
        updateAnnotations((marks) => marks.filter((item) => !ids.has(item.page)));
      }
      void reloadSummaries();
    }).catch(() => undefined);
    return () => { current = false; };
  }, [sheetSummaries.loaded, sheetSummaries.summaries, summaryIdsKey, workspaceReady, shareDocumentId, updateAnnotations, reloadSummaries]);

  function summaryProgress(summary) {
    const total = Math.max(1, pageCount);
    if (summary.mode === "keyboard") return { done: Object.keys(sheetSummaries.withDrafts(summary).pages).length, total };
    const ids = new Set(virtualPagesRef.current.filter((item) => item.summary === summary.id).map((item) => item.id));
    return { done: new Set(annotationsRef.current.filter((item) => ids.has(item.page)).map((item) => item.page)).size, total };
  }

  function setSummaryPages(next, { removePages = null } = {}) {
    virtualPagesRef.current = next;
    setVirtualPages(next);
    if (removePages) updateAnnotations((current) => current.filter((item) => !removePages.has(item.page)));
  }

  async function createSummary(form) {
    if (summaryBusy) return;
    setSummaryBusy(true);
    setSummaryError("");
    try {
      const summary = await sheetSummaries.create(form);
      if (summary.mode === "pen") {
        setSummaryPages(addSummaryPages(virtualPagesRef.current, summary.id, pageCount));
        const first = virtualPagesRef.current.find((item) => item.summary === summary.id && item.afterPage >= Math.max(page, accessiblePageStart));
        if (first) requestAnimationFrame(() => requestAnimationFrame(() => jumpToPagePosition(first.id)));
      } else {
        setSummaryPanelId(summary.id);
        setSummaryPanelOpen(true);
      }
      setSummaryDialogOpen(false);
      setSummaryReceiveDismissed(false);
      setFocusMessage(t("summary.started", { title: summary.title }));
    } catch (error) {
      setSummaryError(error?.message || t("summary.loadFailed"));
    } finally {
      setSummaryBusy(false);
    }
  }

  async function updateSummary(summary, changes) {
    setSummaryError("");
    try {
      const saved = await sheetSummaries.update(summary.id, changes);
      // A pen summary shown again after its pages went missing gets them back.
      if (saved.mode === "pen" && saved.visible && !virtualPagesRef.current.some((item) => item.summary === saved.id)) {
        setSummaryPages(addSummaryPages(virtualPagesRef.current, saved.id, pageCount));
      }
    } catch (error) {
      setSummaryError(error?.message || t("summary.loadFailed"));
    }
  }

  async function deleteSummary(summary) {
    setSummaryBusy(true);
    setSummaryError("");
    try {
      await sheetSummaries.remove(summary.id);
      const ids = new Set(virtualPagesRef.current.filter((item) => item.summary === summary.id).map((item) => item.id));
      setSummaryPages(removeSummaryPages(virtualPagesRef.current, summary.id), { removePages: ids });
      if (ids.has(activeVirtualPageId)) setActiveVirtualPageId(null);
      if (summaryPanelId === summary.id) setSummaryPanelId("");
      setFocusMessage(t("summary.deleted"));
    } catch (error) {
      setSummaryError(error?.message || t("summary.loadFailed"));
    } finally {
      setSummaryBusy(false);
    }
  }

  function continueSummary(summary) {
    setSummaryDialogOpen(false);
    if (summary.mode === "keyboard") { setSummaryPanelId(summary.id); setSummaryPanelOpen(true); return; }
    const target = virtualPagesRef.current.find((item) => item.summary === summary.id && item.afterPage === page)
      || virtualPagesRef.current.find((item) => item.summary === summary.id && item.afterPage >= accessiblePageStart);
    if (target) jumpToPagePosition(target.id);
  }

  useEffect(() => {
    if (!requestedSummaryId) { openedSummaryLink.current = ""; return undefined; }
    if (!paneActive || !sheetSummaries.loaded || !workspaceReady) return undefined;
    const key = `${shareDocumentId}:${requestedSummaryId}`;
    if (openedSummaryLink.current === key) return undefined;
    const summary = sheetSummaries.summaries.find(item => item.id === requestedSummaryId);
    if (!summary) return undefined;
    if (!summary.visible) {
      openedSummaryLink.current = key;
      setSummaryDialogOpen(true);
      return undefined;
    }
    if (summary.mode === "pen" && !virtualPages.some(item => item.summary === summary.id)) return undefined;
    const frame = requestAnimationFrame(() => { openedSummaryLink.current = key; continueSummary(summary); });
    return () => cancelAnimationFrame(frame);
    // Open a requested summary once after its pages and saved state are ready.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedSummaryId, paneActive, sheetSummaries.loaded, sheetSummaries.summaries, workspaceReady, shareDocumentId, virtualPages]);

  useEffect(() => {
    if (!Number.isInteger(requestedSourcePage) || requestedSourcePage < 1 || !paneActive || !workspaceReady) return undefined;
    const key = `${shareDocumentId}:${requestedSourcePage}`;
    if (openedSourcePage.current === key) return undefined;
    if (requestedSourceVersion && requestedSourceVersion !== catalogDocument?.versionId) {
      openedSourcePage.current = key;
      setFocusMessage(translateRef.current("review.sourceUpdated"));
      return undefined;
    }
    if (requestedSourcePage < accessiblePageStart || requestedSourcePage > accessiblePageCount) return undefined;
    const frame = requestAnimationFrame(() => { openedSourcePage.current = key; jumpToPagePosition(requestedSourcePage); });
    return () => cancelAnimationFrame(frame);
    // Source navigation respects the reader's existing accessible page bounds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedSourcePage, requestedSourceVersion, catalogDocument?.versionId, paneActive, workspaceReady, shareDocumentId, accessiblePageStart, accessiblePageCount]);

  /** Builds the PDF, marks the summary received and hands the file over. */
  async function receiveSummary(summary) {
    if (summaryBusy) return;
    setSummaryBusy(true);
    setSummaryError("");
    try {
      await sheetSummaries.flush(summary.id);
      const current = sheetSummaries.withDrafts(sheetSummaries.summaries.find((item) => item.id === summary.id) || summary);
      const penPages = summary.mode === "pen"
        ? virtualPagesRef.current.filter((item) => item.summary === summary.id).sort((a, b) => a.afterPage - b.afterPage)
          .map((item) => ({ pdfPage: item.afterPage, background: item.background, annotations: annotationsRef.current.filter((mark) => mark.page === item.id) }))
        : [];
      const progress = summaryProgress(summary);
      const blob = await buildSummaryPdf({
        summary: current,
        sheetTitle: sheet.title,
        penPages,
        labels: {
          kicker: t("summary.pdfKicker"),
          details: t("summary.pdfDetails", { mode: t(summary.mode === "pen" ? "summary.pen" : "summary.keyboard"), count: progress.done, date: new Date().toLocaleDateString(document.documentElement.lang || undefined) }),
          page: (number) => t("summary.pdfPage", { page: number })
        }
      });
      if (summary.status !== "finished") await sheetSummaries.update(summary.id, { finished: true });
      const name = `${current.title.replace(/[\\/:*?"<>|]+/g, " ").trim() || "summary"}.pdf`;
      const handle = createExportHandle(blob, name);
      triggerDownload(handle.url, name);
      window.setTimeout(() => handle.revoke(), 60_000);
      setSummaryReceiveDismissed(true);
      setFocusMessage(t("summary.received"));
    } catch (error) {
      setSummaryError(error?.message || t("summary.loadFailed"));
      setSummaryDialogOpen(true);
    } finally {
      setSummaryBusy(false);
    }
  }

  const writingSummaries = sheetSummaries.summaries.filter((item) => item.visible && item.status !== "finished");
  const showSummaryReceive = summariesEnabled && !summaryReceiveDismissed && writingSummaries.length > 0 && page >= pageCount && pageCount > 0 && !activeQuiz;
  const activeSummaryPage = activeVirtualPageId === null ? null : readerVirtualPages.find((item) => item.id === activeVirtualPageId && item.summary);
  const jumpSummary = activeSummaryPage ? sheetSummaries.summaries.find((item) => item.id === activeSummaryPage.summary) : shownPenSummaries[0];
  const jumpTarget = activeSummaryPage
    ? activeSummaryPage.afterPage
    : jumpSummary ? readerVirtualPages.find((item) => item.summary === jumpSummary.id && item.afterPage === page)?.id : undefined;

  async function submitActiveQuiz() {
    if (!activeStudy || !activeQuiz || activeStudyBusy) return;
    setActiveStudyBusy(true);
    try {
      // One request saves and grades the whole attempt; answering each
      // question separately made a 50-question exam wait on 50 round trips.
      const held = activeQuiz.questions.map((question) => ({ position: question.position, selectedAnswer: activeAnswers[question.id] }));
      const payload = await focusApi.submitManagedActiveStudy(activeStudy.id, activeQuiz.attempt_id, held);
      const result = /** @type {any} */ (payload.result);
      const verdicts = new Map((Array.isArray(result.review) ? result.review : []).map((item) => [item.position, item]));
      const review = activeQuiz.questions.map((question) => {
        const checked = verdicts.get(question.position);
        return { position: question.position, prompt: question.prompt, correct: Boolean(checked?.correct), explanation: typeof checked?.explanation === "string" ? checked.explanation : "", ...(Number.isInteger(checked?.page) ? { page: checked.page } : {}) };
      });
      setActiveLocked(Object.fromEntries(activeQuiz.questions.map((question) => [question.id, activeAnswers[question.id]])));
      clearActiveStudyDraft(activeQuiz.attempt_id);
      setActiveStudy(payload.run);
      setActiveResult({ ...result, review, outcome: result.passed ? "passed" : (activeQuiz.kind === "final" ? "failed" : "advisory") });
      // Graded on this device while offline; the server confirms it and awards XP on reconnect.
      if (result.pending_sync) setFocusMessage(t("offline.savedForSync"));
    } catch (error) {
      setFocusMessage(error.message || t("focus.activeTestSubmitFailed"));
      // A submit that stopped part-way (a dropped connection, an answer the
      // server already holds) is resumed from the server's copy, so pressing
      // Submit again finishes the same attempt instead of being refused.
      const attemptId = activeQuiz.attempt_id;
      const payload = /** @type {any} */ (await focusApi.getManagedActiveStudyQuestions(activeStudy.id).catch(() => null));
      if (payload?.attempt_id === attemptId) {
        const held = {};
        for (const question of payload.questions || []) if (question.answered) held[String(question.position)] = question.answered;
        setActiveLocked(held);
        setActiveAnswers((current) => ({ ...current, ...held }));
      }
    } finally {
      setActiveStudyBusy(false);
    }
  }

  async function continueActiveStudyAnyway() {
    if (!activeStudy || activeStudyBusy) return;
    setActiveStudyBusy(true);
    try {
      const payload = await focusApi.managedActiveStudyAction(activeStudy.id, "continue");
      const run = /** @type {any} */ (payload.run);
      setActiveStudy(run);
      setActiveQuiz(null);
      setActiveResult(null);
      setActiveAnswers({});
      setActiveLocked({});
      // The next part is appended below; the reader stays where it was.
      returnReaderFromQuiz();
      setFocusMessage(t("focus.partAvailableRetake", { part: run.current_part }));
    } catch (error) {
      setFocusMessage(error.message || t("focus.nextPagesUnlockFailed"));
    } finally {
      setActiveStudyBusy(false);
    }
  }

  async function retakeActiveQuiz() {
    if (!activeStudy || activeStudyBusy) return;
    setActiveStudyBusy(true);
    try {
      const action = activeQuiz?.kind === "final" ? "retry-final" : "study-again";
      const payload = await focusApi.managedActiveStudyAction(activeStudy.id, action);
      const run = /** @type {any} */ (payload.run);
      setActiveStudy(run);
      setActiveQuiz(null);
      setActiveResult(null);
      setActiveAnswers({});
      setActiveLocked({});
      if (action === "retry-final") await loadManagedQuestions(run);
      else {
        // Studying the part again starts at that part, not at page one.
        quizReaderAnchorRef.current = null;
        placeReaderAt(activeStudyResumePage(run.current_page_range));
      }
    } catch (error) {
      setFocusMessage(error.message || t("focus.activeStageReopenFailed"));
    } finally {
      setActiveStudyBusy(false);
    }
  }

  /**
   * Clears only the unsubmitted attempt (its draft and its server answers);
   * completed parts and the run's position stay as they are. Restart then
   * opens a fresh attempt at question 1.
   */
  async function discardActiveAttempt({ restart }, done) {
    if (!activeStudy || !activeQuiz || activeStudyBusy) return;
    setActiveStudyBusy(true);
    try {
      clearActiveStudyDraft(activeQuiz.attempt_id);
      const payload = await focusApi.managedActiveStudyAction(activeStudy.id, "discard-attempt");
      const run = /** @type {any} */ (payload.run);
      done();
      if (restart) await loadManagedQuestions(run);
      else {
        setActiveStudy(run);
        setActiveQuiz(null);
        setActiveResult(null);
        setActiveAnswers({});
        setActiveLocked({});
      }
    } catch (error) {
      setFocusMessage(error.message || t("checkpoint.resetFailed"));
    } finally {
      setActiveStudyBusy(false);
    }
  }

  /** A weak page in a Pomodoro result opens straight in the reader instead of where the test began. */
  function openPageFromResult(target) {
    quizReaderAnchorRef.current = null;
    setActiveQuiz(null);
    setActiveResult(null);
    setActiveAnswers({});
    setActiveLocked({});
    jumpToPagePosition(target);
  }

  async function dismissActiveQuiz() {
    const run = activeStudy;
    setActiveQuiz(null);
    setActiveResult(null);
    setActiveAnswers({});
    setActiveLocked({});
    if (run?.stage === "reading" || run?.stage === "final") returnReaderFromQuiz();
  }

  /**
   * Puts the reader back where it was when the test opened. Passing a
   * checkpoint only extends the unlocked range below that point, so the
   * student continues from the end of the part they just finished.
   */
  function returnReaderFromQuiz() {
    const anchor = quizReaderAnchorRef.current;
    quizReaderAnchorRef.current = null;
    if (anchor) placeReaderAt(anchor);
  }

  /**
   * Removes one page note as a single history step. The workspace-page command
   * already restores and removes notes, so undo and redo reuse it with the
   * page list unchanged.
   */
  function deleteNote(note) {
    const target = notesRef.current.find((item) => item.id === note.id);
    if (!target) return;
    const pages = virtualPagesRef.current;
    const command = { type: "workspace-page", beforePages: pages, afterPages: pages, beforeItems: [], afterItems: [], beforeNotes: [target], afterNotes: [] };
    applyWorkspacePageCommand(command, "redo");
    recordCommand(command);
    setFocusMessage(t("focus.noteDeletedUndoRestoresIt"));
  }

  async function saveNote() {
    const body = noteDraft.trim();
    if (!body || noteBusy) return;
    const savedPage = activePageKey;
    const timestamp = new Date().toISOString();
    const localNote = { id: generateIdempotencyKey(), page: savedPage, body, createdAt: timestamp, updatedAt: timestamp };
    setNotes((current) => [...current, localNote]);
    setNoteDraft("");
    setFocusMessage(t("focus.noteSaved", { page: savedPage }));
    if (!focusPayload?.session?.id) return;
    setNoteBusy(true);
    try {
      const updated = await focusApi.updateLockInNote(focusPayload.session.id, { body, expectedRevision: focusPayload.note?.revision || null });
      setFocusPayload(updated);
      setFocusMessage(t("focus.noteSavedSession", { page: savedPage }));
    } catch (error) { setFocusMessage(t("focus.noteSavedDevice", { page: savedPage, reason: error.message || t("focus.sessionSyncFailed") })); }
    finally { setNoteBusy(false); }
  }

  async function toggleBookmark() {
    if (bookmarkBusy) return;
    const nextBookmarked = !bookmarked;
    setBookmarked(nextBookmarked);
    setBookmarkBusy(true);
    setFocusMessage("");
    try {
      if (nextBookmarked) {
        await progressApi.createCatalogBookmark({
          materialSlug,
          materialTitle: material.title,
          sheetSlug,
          sheetTitle: sheet.title,
          position: { page, zoom: Number(zoom.toFixed(3)) }
        });
        setFocusMessage(t("focus.sheetSavedToBookmarks"));
      } else {
        await progressApi.removeCatalogBookmark(materialSlug, sheetSlug);
        setFocusMessage(t("focus.sheetRemovedFromBookmarks"));
      }
    } catch (error) {
      setBookmarked(!nextBookmarked);
      setFocusMessage(error.message || t("focus.bookmarkUpdateFailed"));
    } finally {
      setBookmarkBusy(false);
    }
  }

  usePlannedSourceNavigation({ search: searchParams, source: catalogDocument, limit: accessiblePageCount,
    ready: workspaceReady && pdfDocumentReady && paneActive && (!modeDialogOpen || searchParams.get("studyActivity") === "active_study"),
    onActive: difficulty => { setActiveDifficulty(difficulty); setModeDialogOpen(true); },
    onRead: jumpToPagePosition, onUnavailable: () => setFocusMessage(t("knowledge.lockedSource")),
    onExplain: questionId => {
      if (!STUDY_TOOLS_ENABLED || COMING_SOON_STUDY_TOOLS.includes("explain")) return;
      setKnowledgeVisited(true); setKnowledgeOpen(true);
      setKnowledgeNavigation({ requestId: globalThis.crypto.randomUUID(), question_id: questionId });
    },
  });

  function commitPageJump() {
    const target = Number.parseInt(pageJumpDraft, 10);
    if (!Number.isFinite(target)) {
      setPageJumpDraft(String(page));
      return;
    }
    const clamped = Math.min(accessiblePageCount, Math.max(accessiblePageStart, target));
    setPageJumpDraft(String(clamped));
    if (clamped !== page || activeVirtualPageId !== null) jumpToPagePosition(clamped);
  }

  function zoomByStep(factor) {
    const stage = stageRef.current;
    if (!stage) return;
    const bounds = stage.getBoundingClientRect();
    zoomTo(zoomRef.current * factor, bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
  }

  function zoomToFitMultiple(multiplier) {
    const stage = stageRef.current;
    if (!stage) return;
    const bounds = stage.getBoundingClientRect();
    zoomTo(minimumPdfZoom() * multiplier, bounds.left + bounds.width / 2, bounds.top + bounds.height / 2, { mode: multiplier === 1 ? "fit" : "manual", label: multiplier === 1 ? t("focus.fitWidth") : `${multiplier}× fit` });
  }

  function exportWorkspaceBackup() {
    const payload = buildExportPayload({
      materialSlug,
      sheetSlug,
      materialTitle: material?.title || "",
      sheetTitle: sheet?.title || "",
      annotations: annotationsRef.current,
      notes: notesRef.current,
      virtualPages: virtualPagesRef.current,
      view: {
        page: pageRef.current,
        zoom: zoomRef.current,
        scrollLeft: viewPositionRef.current.left,
        scrollTop: viewPositionRef.current.top,
        pageOffset: viewPositionRef.current.pageOffset
      }
    });
    if (!payload.annotations.length && !payload.notes.length && !payload.virtualPages.length) {
      setFocusMessage(t("focus.thereIsNothingToBack"));
      return;
    }
    const blob = new window.Blob([JSON.stringify(payload)], { type: "application/json" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = exportFileName({ materialSlug, sheetSlug, savedAt: payload.savedAt });
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => window.URL.revokeObjectURL(url), 0);
    setFocusMessage(t("focus.backedUp", { marks: payload.annotations.length, notes: payload.notes.length }));
  }

  // Moving to another tab keeps an Active Study run where it is, the way
  // "Save" does on exit, so coming back resumes it at the same page.
  function holdActiveStudyPlace() {
    if (studyMode !== "active" || !activeStudy?.id || activeStudy.status !== "active") return;
    writeActiveStudyResume(activeStudy.id, pageRef.current);
    writeActiveStudyEntry(activeEntryKey, activeStudy);
  }

  function goToWorkspaceTab(tab) {
    holdActiveStudyPlace();
    navigate(workspaceTabRoute(tab), { replace: true, state: tab.mode === "normal" ? { studyMode: "normal" } : undefined });
  }

  function showWorkspaceTab(tab) {
    if (["saving", "unsaved"].includes(knowledgeSaveStatus)) { setKnowledgeOpen(true); setFocusMessage(t("knowledge.finishSave")); return; }
    updateWorkspaceTabs((state) => openWorkspaceTab(state, tab));
    goToWorkspaceTab(tab);
  }

  function openSheetTab(choice) {
    const tab = choice.kind === "personal" ? personalTab(choice) : sheetTab(choice);
    showWorkspaceTab(workspaceTabs.tabs.find((item) => item.id === tab.id) || tab);
  }

  function openNewWhiteboard() {
    showWorkspaceTab(whiteboardTab({ boardId: createWhiteboardId(), number: nextWhiteboardNumber(workspaceTabs.tabs) }));
  }

  function closeTab(tab) {
    if (tab.id === currentTabId && ["saving", "unsaved"].includes(knowledgeSaveStatus)) { setKnowledgeOpen(true); setFocusMessage(t("knowledge.finishSave")); return; }
    const { state, next } = closeWorkspaceTab(workspaceTabs, tab.id);
    updateWorkspaceTabs(() => state);
    if (tab.id !== currentTabId) return;
    if (next) goToWorkspaceTab(next);
    else navigate(sheetRoute);
  }

  // Leaving mid Active Study asks whether to keep this run's place.
  function requestWorkspaceExit() {
    if (["saving", "unsaved"].includes(knowledgeSaveStatus)) { setKnowledgeOpen(true); setFocusMessage(t("knowledge.finishSave")); return; }
    if (studyMode === "active" && activeStudy?.id && activeStudy.status === "active") {
      setActiveStudyError("");
      setActiveExitOpen(true);
      return;
    }
    navigate(sheetRoute);
  }

  async function exitActiveStudyAndSave() {
    if (activeStudyBusy || !activeStudy?.id) return;
    setActiveStudyBusy(true);
    try {
      writeActiveStudyResume(activeStudy.id, pageRef.current);
      writeActiveStudyEntry(activeEntryKey, activeStudy);
      await persistWorkspace();
    } catch {
      // The run itself is server-owned; the page choice is already stored.
    } finally {
      setActiveStudyBusy(false);
    }
    setActiveExitOpen(false);
    navigate(sheetRoute);
  }

  async function exitActiveStudyWithoutSaving() {
    if (activeStudyBusy || !activeStudy?.id) return;
    setActiveStudyBusy(true);
    try {
      const payload = await focusApi.managedActiveStudyAction(activeStudy.id, "restart");
      const fresh = /** @type {any} */ (payload.run);
      clearActiveStudyResume(activeStudy.id);
      clearActiveStudyEntry(activeEntryKey);
      if (fresh?.id) writeActiveStudyResume(fresh.id, null);
      setActiveStudyBusy(false);
      setActiveExitOpen(false);
      navigate(sheetRoute);
    } catch (error) {
      setActiveStudyBusy(false);
      setActiveExitOpen(false);
      setFocusMessage(error.message || t("activeStudy.exitSaveFailed"));
    }
  }

  async function restartActiveStudy() {
    const progress = savedStudyProgress(activeCustomization, selectedActiveStudyAvailability);
    if (!progress?.id || activeStudyBusy || !activeStudyReady) return;
    setActiveStudyBusy(true);
    setActiveStudyError("");
    try {
      const payload = await focusApi.managedActiveStudyAction(progress.id, "restart");
      const run = /** @type {any} */ (payload.run);
      setActiveStudyAvailability((current) => current ? {
        ...current,
        difficulties: current.difficulties.map((item) => item.difficulty === run.difficulty ? { ...item, [run.study_mode && run.study_mode !== "standard" ? `${run.study_mode}_progress` : "progress"]: run } : item)
      } : current);
      setActiveStudy(run);
      setActiveQuiz(null);
      setActiveResult(null);
      setActiveAnswers({});
      setActiveLocked({});
      setStudyMode("active");
      setModeDialogOpen(false);
      setEntryModePreference("");
      setPage(1);
      pageRef.current = 1;
      setPageJumpDraft("1");
      resetReaderToPageOne();
      setFocusMessage(t("materials.studyRestarted"));
    } catch (error) {
      setActiveStudyError(error.message || t("materials.studyRestartFailed"));
    } finally {
      setActiveStudyBusy(false);
    }
  }

  function releaseExportFile() {
    exportHandleRef.current?.revoke();
    exportHandleRef.current = null;
  }

  function closeExportSheet() {
    exportRunRef.current += 1;
    releaseExportFile();
    setExportState({ status: "idle" });
  }

  /**
   * Generates an export and hands it to the device. Generation and delivery
   * are separate on purpose; see exportDelivery.js for why a share sheet
   * cannot be opened at the end of a multi-second render.
   */
  async function exportStudyDocument(kind, { share = false } = {}) {
    if (exportBusy || !sheet?.pdfUrl) return;
    if (kind === "original" && studyMode === "active") {
      setFocusMessage(t("focus.theOriginalPDFIsAvailable"));
      return;
    }
    releaseExportFile();
    const run = exportRunRef.current + 1;
    exportRunRef.current = run;
    const extension = kind === "png" ? "png" : "pdf";
    setOpenSurface(null);
    setExportState({ status: "preparing", kind, share, done: 0, total: 0 });
    let ownLoadingTask = null;
    let from = page;
    let to = page;
    try {
      let pdf = pdfDocumentProxyRef.current;
      if (!pdf) {
        const pdfjs = await loadPdfLibrary();
        // A downloaded sheet is read from its stored bytes: the edge CSP
        // blocks PDF.js from fetching a blob: URL (see offline/pdfSource.js).
        const { pdfDocumentSource } = await import("../offline/pdfSource.js");
        ownLoadingTask = pdfjs.getDocument(await pdfDocumentSource(sheet.pdfUrl, assetPath));
        pdf = await ownLoadingTask.promise;
      }
      let blob;
      if (kind === "original") {
        blob = new Blob([await pdf.getData()], { type: "application/pdf" });
      } else {
        const lastAllowed = Math.min(pdf.numPages, accessiblePageCount);
        from = kind === "range" ? Math.min(lastAllowed, Math.max(1, Number(exportRangeStart) || 1)) : kind === "current" || kind === "png" ? page : 1;
        to = kind === "range" ? Math.min(lastAllowed, Math.max(from, Number(exportRangeEnd) || from)) : kind === "current" || kind === "png" ? page : lastAllowed;
        const pages = kind === "current" || kind === "png"
          ? [{ kind: activeVirtualPageId === null ? "pdf" : "virtual", key: activeVirtualPageId ?? page, pdfPage: page, background: virtualPagesRef.current.find((item) => item.id === activeVirtualPageId)?.background }]
          : includeWorkspacePages
            ? composeWorkspacePages(Array.from({ length: to - from + 1 }, (_, index) => from + index), virtualPagesRef.current.filter((item) => !item.summary || shownSummaryIds.has(item.summary)))
            : Array.from({ length: to - from + 1 }, (_, index) => ({ kind: "pdf", key: from + index, pdfPage: from + index }));
        const annotationsNow = annotationsRef.current;
        const total = pages.length;
        setExportState((current) => current.status === "preparing" ? { ...current, total } : current);
        const pageCanvases = async function* () {
          for (const item of pages) {
            if (run !== exportRunRef.current) throw Object.assign(new Error(t("focus.exportCancelled")), { name: "AbortError" });
            yield await renderWorkspacePage({
              pdf: item.kind === "pdf" ? pdf : null,
              pageNumber: item.pdfPage,
              background: item.background,
              annotations: annotationsNow.filter((annotation) => annotation.page === item.key)
            });
          }
        };
        const reportPage = (done) => setExportState((current) => current.status === "preparing" && run === exportRunRef.current ? { ...current, done } : current);
        if (kind === "png") {
          const canvas = (await pageCanvases().next()).value;
          if (!canvas) throw new Error(t("focus.imageExportFailed"));
          blob = await new Promise((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error(t("focus.imageExportFailed"))), "image/png"));
          reportPage(1);
        } else blob = await canvasesToPdf(pageCanvases(), { onPage: reportPage });
      }
      if (run !== exportRunRef.current) return;
      if (!blob?.size) throw new Error(t("focus.exportEmpty"));
      const name = exportFileNameFor({ title: sheet.title, kind, page, from, to, extension });
      const handle = createExportHandle(blob, name);
      exportHandleRef.current = handle;
      const apple = isAppleTouchDevice();
      const shareable = canShareFile(handle.file);
      // A download needs no tap of its own, so everywhere except iOS the file
      // is saved straight away. iOS waits for the student to choose.
      const delivered = !apple && !(share && shareable);
      if (delivered) triggerDownload(handle.url, name);
      setExportState({ status: "ready", kind, name, url: handle.url, size: handle.size, apple, shareable, delivered, shared: false, shareError: "" });
    } catch (error) {
      if (run !== exportRunRef.current || error?.name === "AbortError") return;
      setExportState({ status: "failed", kind, share, message: error?.message || t("focus.exportIncomplete") });
    } finally {
      if (ownLoadingTask) await ownLoadingTask.destroy().catch(() => {});
    }
  }

  async function shareReadyExport() {
    const handle = exportHandleRef.current;
    if (!handle) return;
    try {
      const outcome = await shareExportFile(handle.file, { title: sheet.title });
      setExportState((current) => current.status === "ready" ? { ...current, shared: outcome === "shared", shareError: "" } : current);
    } catch {
      setExportState((current) => current.status === "ready" ? { ...current, shareError: t("focus.sharingUnavailable") } : current);
    }
  }

  function renderExportSheet() {
    const state = exportState;
    if (state.status === "idle") return null;
    const label = state.kind === "png" ? t("focus.exportKindImage") : t("focus.exportKindPdf");
    return <section className={`workspace-v8-export-sheet is-${state.status}`} role={state.status === "failed" ? "alert" : "status"} aria-live="polite" aria-label={t("focus.export")} data-export-status={state.status} onPointerDown={(event) => event.stopPropagation()}>
      <span className="workspace-v8-export-icon" aria-hidden="true">
        {state.status === "preparing" ? <Loader2 size={18} /> : state.status === "ready" ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
      </span>
      <div className="workspace-v8-export-copy">
        {state.status === "preparing" && <>
          <strong>{t("focus.preparingExport", { kind: label })}</strong>
          <small>{state.total > 1 ? t("focus.exportPageOf", { page: Math.min(state.total, state.done + 1), total: state.total }) : t("focus.renderingPages")}</small>
          <span className="workspace-v8-export-progress" aria-hidden="true"><span style={cssVars({ "--export-progress": state.total ? `${Math.round((state.done / state.total) * 100)}%` : "8%" })} /></span>
        </>}
        {state.status === "ready" && <>
          <strong>{t("focus.exportComplete")}</strong>
          <small dir="auto">{state.name}{state.size ? ` · ${formatFileSize(state.size)}` : ""}{state.delivered ? ` · ${t("focus.exportDownloaded")}` : state.shared ? ` · ${t("focus.exportShared")}` : ""}</small>
          {state.shareError && <small className="workspace-v8-export-note" role="alert">{state.shareError}</small>}
        </>}
        {state.status === "failed" && <>
          <strong>{t("focus.exportFailed")}</strong>
          <small>{state.message}</small>
        </>}
      </div>
      <div className="workspace-v8-export-actions">
        {state.status === "preparing" && <button type="button" onClick={closeExportSheet}>{t("focus.cancel")}</button>}
        {state.status === "ready" && state.shareable && <button type="button" className={state.apple ? "is-primary" : ""} onClick={shareReadyExport}><Share2 size={16} />{state.apple ? t("focus.shareSave") : t("focus.share")}</button>}
        {state.status === "ready" && state.apple && <a href={state.url} target="_blank" rel="noreferrer"><ExternalLink size={16} />{t("focus.open")}</a>}
        {state.status === "ready" && <a href={state.url} download={state.name} className={!state.apple && !state.shareable ? "is-primary" : ""}><Download size={16} />{state.delivered ? t("focus.downloadAgain") : t("focus.download")}</a>}
        {state.status === "failed" && <button type="button" className="is-primary" onClick={() => exportStudyDocument(state.kind, { share: state.share })}><RotateCcw size={16} />{t("focus.tryAgain")}</button>}
        {state.status !== "preparing" && <button type="button" className="workspace-v8-export-close" aria-label={t("focus.closeExport")} onClick={closeExportSheet}><X size={16} /></button>}
      </div>
    </section>;
  }

  /** Restore only ever adds. Existing ids are left exactly as they are. */
  function applyRestoredBackup(payload) {
    const existingIds = new Set(virtualPagesRef.current.map((item) => item.id));
    const nextVirtualPages = sanitizeVirtualPages([...virtualPagesRef.current, ...sanitizeVirtualPages(payload.virtualPages).filter((item) => !existingIds.has(item.id))]);
    const addedPages = nextVirtualPages.length - virtualPagesRef.current.length;
    if (addedPages) {
      virtualPagesRef.current = nextVirtualPages;
      setVirtualPages(nextVirtualPages);
    }
    const validPageIds = new Set(nextVirtualPages.map((item) => item.id));
    const incomingAnnotations = payload.annotations.filter((item) => !isVirtualPageKey(item.page) || validPageIds.has(item.page));
    const { merged: mergedAnnotations, added, skipped } = mergeRestoredAnnotations(annotationsRef.current, incomingAnnotations);
    const { merged: mergedNotes, added: addedNotes } = mergeRestoredNotes(notesRef.current, payload.notes.filter((item) => !isVirtualPageKey(item.page) || validPageIds.has(item.page)));
    if (addedNotes) {
      notesRef.current = mergedNotes;
      setNotes(mergedNotes);
    }
    if (added) {
      const additions = mergedAnnotations.slice(annotationsRef.current.length);
      runCommand({ type: "add", items: additions });
    }
    setPendingImport(null);
    if (!added && !addedNotes && !addedPages) setFocusMessage(t("focus.everythingInThatBackupIs"));
    else setFocusMessage(`${t("focus.restored", { pages: addedPages, marks: added, notes: addedNotes })}${skipped ? ` ${t("focus.alreadyPresent", { count: skipped })}` : ""}`);
  }

  async function readWorkspaceBackup(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBackupBusy(true);
    setPendingImport(null);
    try {
      const text = await file.text();
      const result = parseImportPayload(text, { materialSlug, sheetSlug });
      if (!result.ok) {
        setFocusMessage(result.reason);
        return;
      }
      if (!result.matchesDocument) {
        // A backup from another sheet is never merged silently.
        setPendingImport(result.payload);
        setFocusMessage(t("focus.thatBackupBelongsToA"));
        return;
      }
      applyRestoredBackup(result.payload);
    } catch {
      setFocusMessage(t("focus.thatBackupCouldNotBe"));
    } finally {
      setBackupBusy(false);
    }
  }

  function clearPageAnnotations() {
    const items = annotationsRef.current.filter((item) => item.page === activePageKey && !item.locked);
    if (!items.length) return;
    runCommand({ type: "remove", items });
    setSelectedIds([]);
    setOpenSurface(null);
    setFocusMessage(t("focus.marksCleared", { count: items.length, place: activeVirtualPageId === null ? t("focus.pdfPageNumber", { page }) : t("focus.theBlankPage") }));
  }

  function fitPdfWidth() {
    const stage = stageRef.current;
    if (!stage) return;
    const bounds = stage.getBoundingClientRect();
    zoomTo(minimumPdfZoom(), bounds.left + bounds.width / 2, bounds.top + Math.min(bounds.height / 2, 180), { mode: "fit" });
    setFocusMessage(t("focus.pdfFittedToWidth"));
  }

  if (!material || !sheet) return <main className="workspace-v2 workspace-v2-missing"><h1>{t("focus.workspaceUnavailable")}</h1><button type="button" onClick={() => navigate("/materials")}>{t("focus.backToMaterials")}</button></main>;

  const activeVirtualPage = activeVirtualPageId === null ? null : virtualPages.find((item) => item.id === activeVirtualPageId) || null;
  const saveLabel = !workspaceReady ? t("focus.restoringSavedWork") : saveState === "saving" ? t("focus.saving") : saveState === "error" ? t("focus.localSaveUnavailable") : t("focus.savedOnDevice");
  const activeToolLabel = t(TOOL_ITEMS.find(([id]) => id === activeTool)?.[1] || "focus.tool.generic");
  const customColors = addSavedColor(recentColors, null, MAX_PALETTE_COLORS, COLORS);
  const customColorSet = new Set(customColors);
  const paletteColors = normalizeSavedPalette([...favoriteColors, ...COLORS, ...customColors], MAX_PALETTE_COLORS);
  const quickColors = normalizeSavedPalette([...favoriteColors, ...recentColors, ...COLORS], 3);
  const activeToolOpacity = activeTool === "highlighter" ? highlighterOpacity : activeTool === "pencil" ? pencilOpacity : brushOpacity;
  // What the Zoom Window writes with: the pen or highlighter in use (the
  // Pointer pen's glow does not belong in a magnified window, so it writes ink).
  const zoomWindowTool = activeTool === "highlighter" ? "highlighter" : "pen";
  const zoomWindowPen = {
    type: zoomWindowTool,
    profile: zoomWindowTool === "highlighter" ? PEN_PROFILE.HIGHLIGHTER : TRANSIENT_PEN_PROFILES.has(penProfile) ? PEN_PROFILE.BALL : penProfile,
    color: activeColor,
    width: zoomWindowTool === "highlighter" ? brushSize * 7 : brushSize * 2,
    opacity: zoomWindowTool === "highlighter" ? highlighterOpacity : brushOpacity,
    pressureSensitivity,
    smoothing: autoImproveHandwriting && zoomWindowTool !== "highlighter" ? Math.max(.8, strokeSmoothing) : strokeSmoothing
  };
  const activeFavoritePen = matchingFavoritePen(favoritePens, { tool: activeTool, profile: penProfile, color: activeColor, width: brushSize, opacity: activeToolOpacity });
  // The pen panel saves and manages favorites at every size; the tablet and
  // desktop toolbar shows the saved ones for one tap (a phone's toolbar is full).
  const favoritePensStrip = (placement) => <FavoritePens className={placement} favorites={favoritePens} activeIndex={activeFavoritePen} canSave={placement === "is-panel" && FAVORITE_PEN_TOOLS.has(activeTool)} onApply={applyFavoritePen} onSave={saveFavoritePen} onReplace={replaceFavoritePen} onRemove={removeFavoritePen} />;
  const inkToolActive = ["pen", "pencil", "highlighter", "shapes"].includes(activeTool);
  // The lasso only offers colours while they have something to recolour.
  const showColorPalette = inkToolActive || (activeTool === "select" && selectedAnnotations.length > 0);
  const pageNavigatorOpen = openSurface === "pages";
  const tabBarTabs = workspaceTabs.tabs.length ? workspaceTabs.tabs : [whiteboard ? whiteboardTab({ boardId: sheetSlug }) : currentTab(sheetTitle)];
  // Compact layouts drop the tab row while it would hold only this document;
  // the More menu then names the document and opens new tabs.
  const singleTab = showWorkspaceTabs && tabBarTabs.length === 1;
  const studyInProgress = studyMode === "active" && Boolean(activeStudy);
  const studyRangeLabel = studyInProgress ? t("activeStudy.pageRange", { start: activeStudy.current_page_range?.start_page, end: activeStudy.current_page_range?.end_page }) : "";
  // The swatch on the active tool: its ink colour, and a dot that grows with the width.
  const swatchSize = Math.round(Math.min(12, Math.max(5, 4 + brushSize * .7)));

  function updateActiveToolOpacity(value) {
    const rounded = Math.round(value * 100) / 100;
    if (activeTool === "highlighter") setHighlighterOpacity(rounded);
    else if (activeTool === "pencil") setPencilOpacity(rounded);
    else setBrushOpacity(rounded);
  }

  /**
   * The selection's outline: a quiet box a few pixels clear of the items and a
   * single corner handle for resizing. Sizes are in screen pixels converted to
   * page units, and y is corrected for the page's aspect, so the box and handle
   * look the same at every zoom and on every page shape.
   */
  function renderSelectionBox(pageKey) {
    if (!selectedBounds) return null;
    const unitsX = pageUnitsPerCssPixel(pageKey);
    const unitsY = unitsX / Math.max(.01, pageAspectFor(pageKey));
    const padX = 6 * unitsX;
    const padY = 6 * unitsY;
    const x = selectedBounds.x - padX;
    const y = selectedBounds.y - padY;
    const width = selectedBounds.width + padX * 2;
    const height = selectedBounds.height + padY * 2;
    const resizable = !selectedAnnotations.some((item) => item.locked);
    return <g className={`workspace-v2-selection-box${selectionDragging ? " is-dragging" : ""}`} data-selection-count={selectedAnnotations.length}>
      <rect x={x} y={y} width={width} height={height} />
      {resizable && !selectionDragging && <g className="workspace-v2-selection-handle">
        <ellipse className="is-hit" data-resize-handle="bottom-right" cx={x + width} cy={y + height} rx={22 * unitsX} ry={22 * unitsY} />
        <ellipse data-resize-handle="bottom-right" cx={x + width} cy={y + height} rx={7 * unitsX} ry={7 * unitsY} />
      </g>}
    </g>;
  }

  function renderSelectionToolbar() {
    if (!selectedAnnotations.length || selectionPage === null || annotationsHidden) return null;
    const locked = selectedAnnotations.some((item) => item.locked);
    const allLocked = selectedAnnotations.every((item) => item.locked);
    const editable = editableTarget(selectedAnnotations);
    const hasHandwriting = selectedAnnotations.some((item) => ["pen", "pencil"].includes(item.type));
    const keep = (event) => event.stopPropagation();
    const action = (label, Icon, onClick, { disabled = false, danger = false, text = "" } = {}) => <button type="button" className={`${danger ? "is-danger" : ""}${text ? " has-label" : ""}`.trim() || undefined} aria-label={label} title={label} disabled={disabled} onClick={onClick}><Icon size={17} aria-hidden="true" />{text && <span>{text}</span>}</button>;
    return <div
      ref={selectionToolbarRef}
      className={`workspace-v8-selection-toolbar${selectionDragging ? " is-dragging" : ""}`}
      role="toolbar"
      aria-label={`${selectedAnnotations.length} selected`}
      data-selection-toolbar=""
      onPointerDown={keep}
    >
      <div className="workspace-v8-selection-row">
        {editable && action(editable.type === "card" ? t("focus.editCard") : t("focus.editText"), editable.type === "card" ? FileText : Type, () => editAnnotation(editable), { text: t("focus.edit") })}
        {action(t("focus.cut"), Scissors, cutSelection, { disabled: locked, text: t("focus.cut") })}
        {action(t("focus.copy"), Copy, copySelection, { text: t("focus.copy") })}
        {clipboardSize > 0 && action(t("focus.paste"), ClipboardPaste, pasteSelection, { text: t("focus.paste") })}
        {action(t("focus.duplicate"), CopyPlus, duplicateSelection, { disabled: locked, text: t("focus.duplicate") })}
        {action(t("focus.delete"), Trash2, deleteSelection, { disabled: locked, danger: true, text: t("focus.delete") })}
        <button type="button" aria-label={t("focus.moreSelectionActions")} title={t("focus.more")} aria-expanded={selectionActionsOpen} className={selectionActionsOpen ? "is-open" : undefined} onClick={() => setSelectionActionsOpen((open) => !open)}><MoreHorizontal size={17} aria-hidden="true" /></button>
      </div>
      {selectionActionsOpen && <div className="workspace-v8-selection-more" role="group" aria-label={t("focus.moreSelectionActions")}>
        {action(t("focus.bringForward"), BringToFront, () => layerSelection("forward"), { disabled: locked, text: t("focus.forward") })}
        {action(t("focus.sendBackward"), SendToBack, () => layerSelection("backward"), { disabled: locked, text: t("focus.backward") })}
        {action(allLocked ? t("focus.unlock") : t("focus.lock"), allLocked ? Unlock : Lock, toggleSelectionLock, { text: allLocked ? t("focus.unlock") : t("focus.lock") })}
        {selectedAnnotations.length > 1 && action(t("focus.group"), Group, groupSelection, { text: t("focus.group") })}
        {selectedAnnotations.some((item) => item.groupId) && action(t("focus.ungroup"), Ungroup, ungroupSelection, { text: t("focus.ungroup") })}
        {action(t("focus.rotate"), RotateCw, rotateSelection, { disabled: locked, text: t("focus.rotate") })}
        {hasHandwriting && action(t("focus.improveHandwriting"), Sparkles, improveSelectedHandwriting, { text: t("focus.smooth") })}
      </div>}
    </div>;
  }

  function renderPdfPageOverlay(pageNumber, pageAspect = 1) {
    if (!workspaceReady) return null;
    const annotationsOnPage = annotationsByPage.get(pageNumber) || NO_ANNOTATIONS;
    const pageIsCurrent = pageNumber === activePageKey;
    const searchMatches = documentSearch.matchesByPage.get(pageNumber);
    // Every page overlay sits above a composited PDF canvas, so even an empty
    // one costs the compositor a page-sized layer while scrolling. Only pages
    // with marks or search matches, and the page being written on, need one.
    if (!pageIsCurrent && !annotationsOnPage.length && !searchMatches) return null;
    return <>
      {searchMatches && <SearchHighlights matches={searchMatches} activeId={documentSearch.activeMatch?.id} />}
      <svg className={annotationLayerClass} viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-label={isVirtualPageKey(pageNumber) ? t("focus.blankPageAnnotations") : t("focus.annotationsForPage", { page: pageNumber })}>
        <AnnotationVisuals annotations={annotationsHidden ? NO_ANNOTATIONS : annotationsOnPage} prefix={`page-${pageNumber}`} includeHitTargets={activeTool === "select" && !annotationsHidden} pageAspect={pageAspect} revealedIds={revealedCoverIds} />
        {pageIsCurrent && <DraftAnnotationLayer ref={draftLayerRef} latest={draftAnnotationRef} pageAspect={pageAspect} />}
        {selectionPage === pageNumber && renderSelectionBox(pageNumber)}
        {zoomWindow && zoomWindow.page === pageNumber && zoomWindowHeight > 0 && <rect className="workspace-zoom-window-box" x={zoomWindow.x} y={zoomWindow.y} width={zoomWindow.w} height={zoomWindowHeight} />}
      </svg>
      {pageIsCurrent && <LiveAnnotationCanvas ref={liveStrokeCanvasRef} pageNumber={pageNumber} pageAspect={pageAspect} />}
      {pageIsCurrent && <TransientInkCanvas store={transientInkRef.current} pageNumber={pageNumber} />}
    </>;
  }

  return (
    <main className={`workspace-v2${zoomWindow ? " has-zoom-window" : ""}${isDocumentFullscreen ? " is-document-fullscreen" : ""}${whiteboard ? " is-whiteboard" : ""}${showWorkspaceTabs ? " has-tabs" : ""}${singleTab ? " has-single-tab" : ""}`} ref={rootRef} data-knowledge-open={knowledgeOpen ? "true" : undefined} aria-busy={!workspaceReady} aria-label={t("focus.workspaceLabel", { title: sheet.title })}>
      <div className={`workspace-v2-body${sideOpen ? " has-side" : ""}`}>
        <section ref={readerRef} className={`workspace-v2-reader${isDocumentFullscreen ? " is-document-fullscreen" : ""}`} aria-label={t("focus.documentReader")}>
          <nav className="workspace-v2-toolbar" aria-label={t("focus.documentTools")} ref={toolbarRef}>
            {showWorkspaceTabs && <WorkspaceTabBar tabs={tabBarTabs} activeId={currentTabId} materials={tabMaterials} portalRef={rootRef} onSelect={showWorkspaceTab} onClose={closeTab} onNewWhiteboard={openNewWhiteboard} onOpenSheet={openSheetTab} />}
            <div className="workspace-v2-control-group is-exit">
              <WorkspaceIconButton label={t("focus.exitWorkspace")} onClick={requestWorkspaceExit}><ArrowLeft size={19} /></WorkspaceIconButton>
              <div className="workspace-v3-document-context" dir="auto">
                <strong>{sheet.title}</strong>
                <span>{whiteboard ? t("workspaceTabs.whiteboardStoredHere") : personal ? t("personalSheets.readerLabel") : summaryMode ? t("materials.sheetSummary") : sheetEdition?.edition === "lockin" ? t("focus.lockinEdition") : t("focus.universityEdition")}</span>
              </div>
            </div>
            <div className="workspace-v3-primary" ref={toolRailRef} inert={workspaceReady ? undefined : ""}>
              <div className="workspace-v2-tool-list" ref={toolListRef} aria-label={t("focus.writingTools")} data-active-tool={activeTool}>
                <span className="workspace-v2-tool-indicator" ref={toolIndicatorRef} aria-hidden="true" />
                {PRIMARY_WRITE_TOOLS.map(([id, labelKey, ToolIcon, responsiveClass]) => {
                  const label = t(labelKey);
                  const expanded = activeTool === id && toolOptionsOpen === id;
                  return <WorkspaceIconButton
                    key={id}
                    className={`workspace-v3-tool-button${id === "pen" ? " is-hero" : ""}${responsiveClass ? ` ${responsiveClass}` : ""}`}
                    label={label}
                    disabled={!workspaceReady}
                    active={activeTool === id}
                    aria-pressed={activeTool === id}
                    aria-expanded={CONFIGURABLE_TOOLS.has(id) ? expanded : undefined}
                    aria-controls={CONFIGURABLE_TOOLS.has(id) ? `workspace-${id}-options` : undefined}
                    data-workspace-tool={id}
                    style={id === activeTool && SWATCH_TOOLS.has(id) ? cssVars({ "--workspace-tool-color": activeColor, "--workspace-swatch-size": `${swatchSize}px` }) : undefined}
                    onClick={() => chooseWritingTool(id)}
                  ><ToolIcon size={19} />{id === activeTool && SWATCH_TOOLS.has(id) && <span className="workspace-v3-tool-swatch" aria-hidden="true" />}</WorkspaceIconButton>;
                })}
                <WorkspaceIconButton label={t("focus.add")} className="workspace-v3-tool-button" active={openSurface === "add"} aria-expanded={openSurface === "add"} aria-controls="workspace-add-popover" data-workspace-surface="add" onClick={() => setOpenSurface((current) => current === "add" ? null : "add")}><Plus size={20} /></WorkspaceIconButton>
              </div>
              <div className="workspace-v3-quick-colors" role="group" aria-label={t("focus.quickAnnotationColors")}>
                {quickColors.map((color) => <button key={color} type="button" className={`workspace-v3-quick-color${activeColor === color ? " is-active" : ""}`} aria-label={t("focus.useColor", { color })} aria-pressed={activeColor === color} title={color} disabled={!showColorPalette} style={cssVars({ "--workspace-tool-color": color })} onClick={() => chooseAnnotationColor(color)}><span /></button>)}
              </div>
              {workspaceReady && favoritePens.length > 0 && favoritePensStrip("is-toolbar")}
              <div className="workspace-v2-history" aria-label={t("focus.editHistory")}>
                <WorkspaceIconButton label={t("focus.undoCtrlZ")} className="workspace-v3-history-button" disabled={!undoHistory.length} onClick={undoTool}><Undo2 size={18} /></WorkspaceIconButton>
                <WorkspaceIconButton label={t("focus.redoCtrlShiftZ")} className="workspace-v3-history-button" disabled={!redoHistory.length} onClick={redoTool}><Redo2 size={18} /></WorkspaceIconButton>
              </div>
            </div>
            {/* A phone shows Undo and Redo here, pinned beside the tool rail,
                because the rail scrolls them out of reach exactly when writing
                needs them. */}
            <div className="workspace-v2-history is-docked" role="group" aria-label={t("focus.editHistory")}>
              <WorkspaceIconButton label={t("focus.undoCtrlZ")} className="workspace-v3-history-button" disabled={!undoHistory.length} onClick={undoTool}><Undo2 size={18} /></WorkspaceIconButton>
              <WorkspaceIconButton label={t("focus.redoCtrlShiftZ")} className="workspace-v3-history-button" disabled={!redoHistory.length} onClick={redoTool}><Redo2 size={18} /></WorkspaceIconButton>
            </div>
            <input ref={imageInputRef} className="workspace-v2-file-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={!workspaceReady} onChange={addImage} tabIndex={-1} aria-hidden="true" />
            <div className="workspace-v2-toolbar-actions" aria-label={t("focus.workspaceControls")}>
              {focusPayload?.session?.experience_version === 2 && <StudyDock payload={focusPayload} onChange={setFocusPayload} active={paneActive} portalRef={rootRef} />}
              {RESCUE_ENABLED && shareDocumentId && user?.id && rescueSource.managed_file_id && <StartRescue
                key={user.id + "/" + shareDocumentId}
                userId={user.id} source={rescueSource} page={page} pageLimit={accessiblePageCount}
                ready={workspaceReady && pdfDocumentReady && paneActive && !modeDialogOpen && !activeQuiz && focusStatusChecked}
                blocked={isUnfinished(focusPayload)} toolsEnabled={STUDY_TOOLS_ENABLED}
                onActivity={(activity) => {
                  if (activity.task_type !== "read" && (!STUDY_TOOLS_ENABLED || ["saving", "unsaved"].includes(knowledgeSaveStatus))) {
                    setFocusMessage(t("knowledge.finishSave")); return false;
                  }
                  if (activity.open_source && activity.page_start >= accessiblePageStart && activity.page_start <= accessiblePageCount) jumpToPagePosition(activity.page_start);
                  if (activity.task_type === "read") return true;
                  setKnowledgeVisited(true); setKnowledgeOpen(true);
                  setKnowledgeNavigation({ requestId: globalThis.crypto.randomUUID(), tool: activity.task_type, question_id: activity.question_id });
                  return true;
                }}
              />}
              <WorkspaceIconButton label={sideOpen ? t("focus.closeNotes") : t("focus.openNotes")} className="workspace-v3-utility-button is-phone-overflow" active={sideOpen} aria-pressed={sideOpen} aria-expanded={sideOpen} aria-controls="workspace-notes-panel" data-workspace-tool="note" disabled={!workspaceReady} onClick={() => selectTool("note")}><MessageSquare size={18} /></WorkspaceIconButton>
              {!whiteboard && !personal && <button type="button" className={`workspace-v2-study-mode-button is-narrow-overflow is-${studyMode || "choose"}${studyMode === "active" && activeStudy ? " has-progress" : ""}${openSurface === "study" ? " is-active" : ""}`} data-workspace-surface="study" aria-haspopup="dialog" aria-expanded={openSurface === "study"} aria-controls="workspace-study-popover" disabled={!workspaceReady} onClick={() => setOpenSurface((current) => current === "study" ? null : "study")} aria-label={studyMode === "active" && activeStudy ? t("activeStudy.pageRange", { start: activeStudy.current_page_range?.start_page, end: activeStudy.current_page_range?.end_page }) : t("focus.study")} title={studyMode === "active" && activeStudy ? t("activeStudy.pageRange", { start: activeStudy.current_page_range?.start_page, end: activeStudy.current_page_range?.end_page }) : t("focus.study")}><Brain size={18} />{!(studyMode === "active" && activeStudy) && <span className="workspace-v2-study-mode-label" aria-hidden="true">{t("focus.study")}</span>}{studyMode === "active" && activeStudy && <span className="workspace-v2-study-mode-status"><strong>{t("focus.active")}</strong><small>{t("activeStudy.pageRange", { start: activeStudy.current_page_range?.start_page, end: activeStudy.current_page_range?.end_page })}</small></span>}</button>}
              <WorkspaceIconButton label={t("focus.moreWorkspaceActions")} className={`workspace-v3-utility-button${studyInProgress ? " has-study-progress" : ""}`} active={openSurface === "more" || settingsOpen} aria-expanded={openSurface === "more" || settingsOpen} aria-controls="workspace-more-popover" data-workspace-surface="more" disabled={!workspaceReady} onClick={() => setOpenSurface((current) => current === "more" ? null : "more")}><MoreHorizontal size={20} />{studyInProgress && <span className="workspace-v3-more-badge" aria-hidden="true" />}</WorkspaceIconButton>
            </div>
          </nav>

          {marksSet && <button type="button" className="workspace-marks-chip" data-workspace-marks-chip="" onClick={() => setMarksOpen(true)}>
            <Users size={14} aria-hidden="true" />
            <span dir="auto">{marksSet.author ? t("marks.viewing", { author: marksSet.author }) : t("marks.viewingAnonymous")}</span>
          </button>}

          <AddMenu closeSurfaceAndRestoreFocus={closeSurfaceAndRestoreFocus} page={page} popover={popover} selectTool={selectTool} setActiveTool={setActiveTool} setCardDraft={setCardDraft} setCardKind={setCardKind} setClipSelecting={setClipSelecting} setCoverSelecting={setCoverSelecting} setEditingCardId={setEditingCardId} setEditingTextId={setEditingTextId} setFocusMessage={setFocusMessage} setLassoMode={setLassoMode} setOpenSurface={setOpenSurface} setSelectedIds={setSelectedIds} setTextDraft={setTextDraft} sheet={sheet} studyMode={studyMode} t={t} workspaceReady={workspaceReady} />

          <PageBackgroundMenu addBlankPage={addBlankPage} page={page} popover={popover} setOpenSurface={setOpenSurface} t={t} workspaceReady={workspaceReady} />

          <CardEditor cardDraft={cardDraft} cardKind={cardKind} deleteEditingCard={deleteEditingCard} editingCardId={editingCardId} popover={popover} saveCard={saveCard} setCardDraft={setCardDraft} setCardKind={setCardKind} setOpenSurface={setOpenSurface} t={t} workspaceReady={workspaceReady} />

          <TextEditor activeVirtualPageId={activeVirtualPageId} addTextAnnotation={addTextAnnotation} closeSurfaceAndRestoreFocus={closeSurfaceAndRestoreFocus} editingTextId={editingTextId} page={page} popover={popover} setTextAlign={setTextAlign} setTextBold={setTextBold} setTextColor={setTextColor} setTextDraft={setTextDraft} setTextFontSize={setTextFontSize} t={t} textAlign={textAlign} textBold={textBold} textColor={textColor} textDraft={textDraft} textFontSize={textFontSize} textInputRef={textInputRef} workspaceReady={workspaceReady} />

          <StudyMenu activeStudy={activeStudy} closeSurfaceAndRestoreFocus={closeSurfaceAndRestoreFocus} knowledgeNavigation={knowledgeNavigation} knowledgeOpen={knowledgeOpen} openStudyTool={openStudyTool} personal={personal} popover={popover} setMarksOpen={setMarksOpen} setModeDialogOpen={setModeDialogOpen} setOpenSurface={setOpenSurface} setSummaryDialogOpen={setSummaryDialogOpen} shareDocumentId={shareDocumentId} sheetSummaries={sheetSummaries} studyMode={studyMode} studyTools={studyTools} summariesEnabled={summariesEnabled} t={t} whiteboard={whiteboard} workspaceReady={workspaceReady} />

          <MoreMenu openTranslation={() => setTranslationOpen(true)} openZoomWindow={openZoomWindow} activeVirtualPageId={activeVirtualPageId} allCoversRevealed={allCoversRevealed} annotationsHidden={annotationsHidden} bookmarkBusy={bookmarkBusy} bookmarked={bookmarked} chooseWritingTool={chooseWritingTool} closeSurfaceAndRestoreFocus={closeSurfaceAndRestoreFocus} coverIds={coverIds} deleteBlankPage={deleteBlankPage} documentSearch={documentSearch} exportBusy={exportBusy} openNewWhiteboard={openNewWhiteboard} page={page} personal={personal} popover={popover} searchDocumentProxy={searchDocumentProxy} selectTool={selectTool} setActiveTool={setActiveTool} setAnnotationsHidden={setAnnotationsHidden} setExportForShare={setExportForShare} setExportRangeEnd={setExportRangeEnd} setExportRangeStart={setExportRangeStart} setMarksOpen={setMarksOpen} setOpenSurface={setOpenSurface} setSelectedIds={setSelectedIds} shareDocumentId={shareDocumentId} sheet={sheet} sheetEdition={sheetEdition} singleTab={singleTab} studyInProgress={studyInProgress} studyRangeLabel={studyRangeLabel} summaryMode={summaryMode} t={t} toggleAllCovers={toggleAllCovers} toggleBookmark={toggleBookmark} whiteboard={whiteboard} workspaceReady={workspaceReady} />

          <ExportMenu accessiblePageCount={accessiblePageCount} exportBusy={exportBusy} exportForShare={exportForShare} exportRangeEnd={exportRangeEnd} exportRangeStart={exportRangeStart} exportStudyDocument={exportStudyDocument} popover={popover} setExportRangeEnd={setExportRangeEnd} setExportRangeStart={setExportRangeStart} setOpenSurface={setOpenSurface} studyMode={studyMode} t={t} workspaceReady={workspaceReady} />

          <SearchMenu closeSurfaceAndRestoreFocus={closeSurfaceAndRestoreFocus} coveredMatchIds={coveredMatchIds} documentSearch={documentSearch} hideSearchMatches={hideSearchMatches} openSurface={openSurface} popover={popover} showSearchMatch={showSearchMatch} t={t} workspaceReady={workspaceReady} />
          {workspaceReady && openSurface !== "search" && <SearchNavigator search={documentSearch} onShowMatch={showSearchMatch} onOpen={() => setOpenSurface("search")} onHideMatch={() => documentSearch.activeMatch && hideSearchMatches([documentSearch.activeMatch], true)} covered={Boolean(documentSearch.activeMatch && coveredMatchIds.has(documentSearch.activeMatch.id))} />}

          <ToolOptionsPanel favoritesStrip={favoritePensStrip("is-panel")} activeColor={activeColor} activePenOption={activePenOption} activeTool={activeTool} activeToolLabel={activeToolLabel} activeToolOpacity={activeToolOpacity} brushSize={brushSize} changePenProfile={changePenProfile} chooseAnnotationColor={chooseAnnotationColor} circleToErase={circleToErase} clearPageAnnotations={clearPageAnnotations} commitCustomColor={commitCustomColor} customColorDraft={customColorDraft} customColorEditorOpen={customColorEditorOpen} customColorSet={customColorSet} deleteCustomColor={deleteCustomColor} displayedToolOptions={displayedToolOptions} drawAndHold={drawAndHold} eraserMode={eraserMode} eraserSize={eraserSize} favoriteColors={favoriteColors} inkToolActive={inkToolActive} lassoMode={lassoMode} pageAnnotations={pageAnnotations} paletteColors={paletteColors} penProfile={penProfile} recentColors={recentColors} selectedAnnotations={selectedAnnotations} setBrushSize={setBrushSize} setCircleToErase={setCircleToErase} setCustomColorDraft={setCustomColorDraft} setCustomColorEditorOpen={setCustomColorEditorOpen} setDrawAndHold={setDrawAndHold} setEraserMode={setEraserMode} setEraserSize={setEraserSize} setLassoMode={setLassoMode} setShapeAngle={setShapeAngle} setShapeDashed={setShapeDashed} setShapeFill={setShapeFill} setShapeFillColor={setShapeFillColor} setShapeSnapGrid={setShapeSnapGrid} setShapeStyle={setShapeStyle} shapeAngle={shapeAngle} shapeDashed={shapeDashed} shapeFill={shapeFill} shapeFillColor={shapeFillColor} shapeSnapGrid={shapeSnapGrid} shapeStyle={shapeStyle} showColorPalette={showColorPalette} t={t} toggleFavoriteColor={toggleFavoriteColor} toolOptionsOpen={toolOptionsOpen} toolOptionsRef={toolOptionsRef} updateActiveToolOpacity={updateActiveToolOpacity} workspaceReady={workspaceReady} />

          <SettingsPopover activeVirtualPage={activeVirtualPage} activeVirtualPageId={activeVirtualPageId} addBlankPage={addBlankPage} annotationsHidden={annotationsHidden} applyRestoredBackup={applyRestoredBackup} autoImproveHandwriting={autoImproveHandwriting} backupBusy={backupBusy} backupInputRef={backupInputRef} changeDrawingInput={changeDrawingInput} changeVirtualPageBackground={changeVirtualPageBackground} circleToErase={circleToErase} clearPageAnnotations={clearPageAnnotations} closeSurfaceAndRestoreFocus={closeSurfaceAndRestoreFocus} deleteBlankPage={deleteBlankPage} drawAndHold={drawAndHold} drawingInput={drawingInput} exportBusy={exportBusy} exportStudyDocument={exportStudyDocument} exportWorkspaceBackup={exportWorkspaceBackup} includeWorkspacePages={includeWorkspacePages} keepScreenAwake={keepScreenAwake} page={page} pageAnnotations={pageAnnotations} pdfDocumentReady={pdfDocumentReady} pendingImport={pendingImport} popover={popover} readWorkspaceBackup={readWorkspaceBackup} rememberLastPosition={rememberLastPosition} rememberZoomLevel={rememberZoomLevel} saveErrorReason={saveErrorReason} saveState={saveState} scribbleToErase={scribbleToErase} setActiveTool={setActiveTool} setAnnotationsHidden={setAnnotationsHidden} setAutoImproveHandwriting={setAutoImproveHandwriting} setCircleToErase={setCircleToErase} setDrawAndHold={setDrawAndHold} setIncludeWorkspacePages={setIncludeWorkspacePages} setKeepScreenAwake={setKeepScreenAwake} setPendingImport={setPendingImport} setRememberLastPosition={setRememberLastPosition} setRememberZoomLevel={setRememberZoomLevel} setScribbleToErase={setScribbleToErase} setSelectedIds={setSelectedIds} setSettingsTab={setSettingsTab} setShowPageNumber={setShowPageNumber} settingsTab={settingsTab} sheet={sheet} showPageNumber={showPageNumber} t={t} wakeLockSupported={wakeLockSupported} workspaceReady={workspaceReady} />

          <div
            className={`workspace-v2-document-stage is-tool-${activeTool}`}
            ref={stageRef}
            inert={workspaceReady ? undefined : ""}
            onPointerDown={beginWorkspacePointer}
            onPointerMove={moveWorkspacePointer}
            onPointerUp={finishWorkspacePointer}
            onPointerCancel={cancelWorkspacePointer}
            onLostPointerCapture={lostWorkspacePointer}
            onPointerLeave={() => { hideStylusHover(); hideEraserHitbox(); }}
          >
            {sheet.pdfUrl ? <ContinuousA4Pdf pdfUrl={sheet.pdfUrl} pageCount={pageCount} visiblePageStart={accessiblePageStart} visiblePageCount={accessiblePageCount} zoom={zoom} stageRef={stageRef} documentRootRef={documentRef} onPageCount={syncPdfPageCount} onDocumentReady={markPdfDocumentReady} onDocumentLoaded={handlePdfDocumentLoaded} onCurrentPageChange={handleCurrentWorkspacePage} virtualPages={readerVirtualPages} renderPageOverlay={renderPdfPageOverlay} onPdfPageRendered={recordPdfPageRender} documentFooter={whiteboard ? <div className="workspace-whiteboard-footer"><button type="button" onClick={addWhiteboardPage}><Plus size={18} /><span>{t("workspaceTabs.addPage")}</span></button></div> : null} /> : <article ref={documentRef} className="workspace-v2-document" onDoubleClick={smartZoom} style={cssVars({ "--workspace-document-width": `${PAGE_WIDTH * zoom}px`, "--workspace-document-min-height": `${760 * zoom}px`, "--workspace-document-max-width": "none" })}>
              <svg className={annotationLayerClass} viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-label={t("focus.documentAnnotations")}>
                <AnnotationVisuals annotations={annotationsHidden ? [] : pageAnnotations} prefix={`document-${page}`} includeHitTargets={activeTool === "select" && !annotationsHidden} revealedIds={revealedCoverIds} />
                <DraftAnnotationLayer ref={draftLayerRef} latest={draftAnnotationRef} />
                {selectionPage !== null && renderSelectionBox(page)}
              </svg>
              <LiveAnnotationCanvas ref={liveStrokeCanvasRef} pageNumber={page} />
              <TransientInkCanvas store={transientInkRef.current} pageNumber={page} />
              <p className="workspace-v2-lead">{t("materials.editionUnavailable")}</p>
            </article>}
            <span ref={stylusHoverRef} className="workspace-v2-stylus-hover" aria-hidden="true" />
            <span ref={eraserHitboxRef} className="workspace-v2-eraser-hitbox" aria-hidden="true" />
          </div>
          {!workspaceReady && <p className="workspace-v2-hydration-status" role="status">{t("focus.restoringSavedWork")}</p>}
          {showPageNumber && <div className={`workspace-v2-page-dock${pageNavigatorOpen ? " is-open" : ""}`} inert={workspaceReady ? undefined : ""}>
            {pageNavigatorOpen && pageThumbsOpen && searchDocumentProxy && <PageThumbnails
              pdf={searchDocumentProxy}
              total={Math.max(pageCount, searchDocumentProxy.numPages || 0)}
              accessibleCount={accessiblePageCount}
              currentPage={activeVirtualPageId === null ? page : 0}
              labels={{ title: t("focus.pageThumbnails"), close: t("focus.closePageThumbnails"), page: (number) => t("focus.thumbnailPage", { page: number }), locked: (number) => t("focus.thumbnailLocked", { page: number }) }}
              onJump={(target) => { jumpToPagePosition(target); setPageThumbsOpen(false); window.setTimeout(() => rootRef.current?.querySelector(".workspace-v2-page-thumbs-toggle")?.focus(), 0); }}
              onClose={() => { setPageThumbsOpen(false); window.setTimeout(() => rootRef.current?.querySelector(".workspace-v2-page-thumbs-toggle")?.focus(), 0); }}
            />}
            <PageNavigator accessiblePageCount={accessiblePageCount} accessiblePageStart={accessiblePageStart} activeVirtualPageId={activeVirtualPageId} addBlankPage={addBlankPage} commitPageJump={commitPageJump} deleteBlankPage={deleteBlankPage} fitPdfWidth={fitPdfWidth} jumpToPagePosition={jumpToPagePosition} minimumAllowedZoom={minimumAllowedZoom} minimumPdfZoom={minimumPdfZoom} page={page} pageJumpDraft={pageJumpDraft} pageNavigatorOpen={pageNavigatorOpen} pageThumbsOpen={pageThumbsOpen} searchDocumentProxy={searchDocumentProxy} setPageJumpDraft={setPageJumpDraft} setPageThumbsOpen={setPageThumbsOpen} sheet={sheet} t={t} whiteboard={whiteboard} zoom={zoom} zoomByStep={zoomByStep} zoomToFitMultiple={zoomToFitMultiple} />
            <button
              type="button"
              className="workspace-v2-page-number"
              aria-label={activeVirtualPageId === null ? t("focus.pdfPageOf", { page, total: accessiblePageCount }) : t("focus.blankPageAfter", { page, total: accessiblePageCount })}
              title={t("focus.pageWorkspacePagesAndZoom")}
              aria-expanded={pageNavigatorOpen}
              aria-controls="workspace-page-navigator"
              onClick={() => setOpenSurface((current) => current === "pages" ? null : "pages")}
            ><Hash size={12} aria-hidden="true" />{whiteboard
              // A whiteboard counts its own pages: the lined base page, then each added one.
              ? <><strong>{activeVirtualPageId === null ? 1 : Math.max(1, virtualPages.findIndex((item) => item.id === activeVirtualPageId) + 2)}</strong><span>/ {virtualPages.length + 1}</span></>
              : <><strong>{page}</strong><span>/ {accessiblePageCount}</span></>}</button>
          </div>}
          {/* Laptop and desktop readers get a zoom bar that is always on screen. CSS
              shows it only for a fine pointer without a touchscreen, so phones and
              iPads keep pinch zoom and the page dock exactly as they were. */}
          <ZoomBar fitPdfWidth={fitPdfWidth} minimumAllowedZoom={minimumAllowedZoom} minimumPdfZoom={minimumPdfZoom} sheet={sheet} t={t} workspaceReady={workspaceReady} zoom={zoom} zoomByStep={zoomByStep} zoomToFitMultiple={zoomToFitMultiple} />
          {workspaceReady && zoomWindow && <ZoomWindow region={zoomWindow} onRegionChange={setZoomWindow} pageAspect={pageAspectFor(zoomWindow.page)} annotations={annotationsHidden ? NO_ANNOTATIONS : (annotationsByPage.get(zoomWindow.page) || NO_ANNOTATIONS)} pdfDocument={searchDocumentProxy} pen={zoomWindowPen} onCommit={commitZoomWindowStroke} onClose={() => setZoomWindow(null)} onHeightChange={setZoomWindowHeight} />}
          {sheet.pdfUrl && <output className={`workspace-v4-zoom-hud${zoomHud.visible ? " is-visible" : ""}`} aria-live="polite" aria-label={t("focus.currentZoom", { percent: Math.round(zoom * 100) })}><strong>{Math.round(zoom * 100)}%</strong><span>{zoomHud.label && !zoomHud.label.endsWith("%") ? zoomHud.label : pdfZoomModeRef.current === "fit" ? t("focus.fitWidth") : t("focus.zoom")}</span></output>}
          {saveState === "error" && <p className="workspace-v2-save-warning" role="alert"><Zap size={14} aria-hidden="true" />{saveErrorReason || t("errors.localSaveFailed")}</p>}
          {focusMessage && !sideOpen && <p className="workspace-v2-toast" aria-hidden="true">{focusMessage}</p>}
          {workspaceReady && renderSelectionToolbar()}
          {workspaceReady && renderExportSheet()}
        </section>

        {sideOpen && <button className="workspace-v2-side-backdrop" type="button" onClick={() => setOpenSurface(null)} aria-label={t("focus.closeWorkspacePanel")} />}
        <aside id="workspace-notes-panel" className={`workspace-v2-side${sideOpen ? " is-open" : ""}`} aria-label={t("focus.workspaceNotesAndActions")} aria-hidden={!sideOpen || !workspaceReady} inert={sideOpen && workspaceReady ? undefined : ""}>
          <button ref={sideCloseRef} className="workspace-v2-side-close" type="button" onClick={() => {
            setOpenSurface(null);
            // A phone keeps Notes in More, so focus goes there when the button is hidden.
            const notes = rootRef.current?.querySelector('.workspace-v2-toolbar [data-workspace-tool="note"]');
            (notes?.getClientRects().length ? notes : rootRef.current?.querySelector('[data-workspace-surface="more"]'))?.focus();
          }} aria-label={t("focus.closeWorkspacePanel")}><X size={18} /></button>
          <div className="workspace-v2-tabs" role="tablist" aria-label={t("focus.workspacePanels")}>
            <button type="button" id="workspace-notes-tab" role="tab" aria-selected={sideTab === "notes"} aria-controls="workspace-notes-tabpanel" tabIndex={sideTab === "notes" ? 0 : -1} className={sideTab === "notes" ? "is-active" : ""} onClick={() => setSideTab("notes")}>{t("focus.notes")}</button>
            <button type="button" id="workspace-highlights-tab" role="tab" aria-selected={sideTab === "highlights"} aria-controls="workspace-highlights-tabpanel" tabIndex={sideTab === "highlights" ? 0 : -1} className={sideTab === "highlights" ? "is-active" : ""} onClick={() => setSideTab("highlights")}>{t("focus.highlights")} <span>{highlights.length}</span></button>
          </div>
          <div className="workspace-v2-side-content">
            {sideTab === "notes" && <section id="workspace-notes-tabpanel" role="tabpanel" aria-labelledby="workspace-notes-tab" tabIndex={0} className="workspace-v2-note-list">
              {sortedNotes.map((note) => <div key={note.id} className="workspace-v2-note-item">
                <button type="button" className="workspace-v2-note-card" onClick={() => openNote(note)} aria-label={t("focus.openNoteFromPage", { page: note.page })}>
                  <span className="workspace-v2-card-meta"><strong>{t("focus.pageNumberLabel", { page: note.page })}</strong><span>{formatDate(note.createdAt)}</span></span>
                  <span className="workspace-v2-card-copy">{note.body}</span>
                  <span className="workspace-v2-card-tags"><span>{material.title}</span><span>{t("focus.pageNote")}</span></span>
                </button>
                <button type="button" className="workspace-v2-note-delete" onClick={() => deleteNote(note)} aria-label={t("focus.deleteNoteFromPage", { page: note.page })} title={t("focus.deleteNote")}><Trash2 size={15} aria-hidden="true" /></button>
              </div>)}
              {!sortedNotes.length && <p className="workspace-v2-empty-panel">{t("focus.notesSavedOnAnyPage")}</p>}
              <label className="workspace-v2-note-editor"><span>{t("focus.noteForPage", { page })}</span><textarea ref={noteRef} value={noteDraft} onChange={(event) => setNoteDraft(event.target.value)} maxLength={10000} placeholder={t("focus.writeNoteForPage", { page })} /><button type="button" onClick={saveNote} disabled={noteBusy || !noteDraft.trim()}>{noteBusy ? t("focus.saving") : t("focus.saveToPage", { page })}</button></label>
            </section>}
            {sideTab === "highlights" && <section id="workspace-highlights-tabpanel" role="tabpanel" aria-labelledby="workspace-highlights-tab" tabIndex={0} className="workspace-v2-highlight-list">{highlights.length ? highlights.map((highlight, index) => <button key={highlight.id} type="button" className="workspace-v2-highlight-card" onClick={() => openHighlight(highlight)} aria-label={t("focus.openHighlightOnPage", { number: index + 1, page: highlight.page })}><span className="workspace-v2-highlight-color" style={{ backgroundColor: highlight.color }} /><strong>{t("focus.pageNumberLabel", { page: highlight.page })}</strong><span>{t("focus.highlight")} {index + 1}</span><small>{t("focus.openHighlight")}</small></button>) : <p className="workspace-v2-empty-panel">{t("focus.chooseTheHighlightToolAnd")}</p>}</section>}
          </div>
          {focusMessage && <p className="workspace-v2-status" role="status">{focusMessage}</p>}
        </aside>
      </div>
      <span className="workspace-v2-visually-hidden" role="status" aria-live="polite">{saveLabel}{focusMessage ? ` · ${focusMessage}` : ""}</span>
      {studyMode === "active" && activeStudy?.study_mode !== "pomodoro" && activeStudy?.status === "active" && (["reading", "checkpoint", "final"].includes(activeStudy.stage) || ACTIVE_RESULT_STAGES.has(activeStudy.stage)) && <div className="workspace-v2-checkpoint-dock" role="status" aria-live="polite">
        <button type="button" className={`workspace-v2-checkpoint-button${activeStudyButtonReady ? " is-ready" : ""}`} onClick={openActiveQuiz} disabled={activeStudyBusy || !activeStudyButtonReady} aria-label={activeStudyButtonReady ? t(activeStudy.stage.startsWith("final") ? "activeStudy.openFinal" : "activeStudy.openCheckpoint") : t("activeStudy.reachToUnlock", { page: accessiblePageCount })}>{!activeStudy.stage.startsWith("final") && activeStudy.number_of_parts > 1 && <span className="workspace-v9-step-part" aria-hidden="true">{t("activeStudy.pageRange", { start: activeStudy.current_page_range?.start_page, end: activeStudy.current_page_range?.end_page })}</span>}{activeStudyButtonReady ? <><CheckCircle2 size={20} /><span className="workspace-v2-checkpoint-copy">{t(activeStudy.stage.startsWith("final") ? "activeStudy.finalExam" : "activeStudy.checkpoint")}</span></> : <><CheckCircle2 size={20} /><span className="workspace-v2-checkpoint-copy">{t("activeStudy.reachPage", { page: accessiblePageCount })}</span></>}</button>
      </div>}
      {knowledgeVisited && shareDocumentId && user?.id && <Suspense fallback={null}><KnowledgeWorkspace key={`${user.id}/${shareDocumentId}`} userId={user.id} documentId={shareDocumentId} title={sheet.title} page={page} pageLimit={accessiblePageCount} onSaveState={setKnowledgeSaveStatus} navigation={knowledgeNavigation} visible={knowledgeOpen && paneActive} onClose={() => setKnowledgeOpen(false)} onRead={(target) => { if (target >= accessiblePageStart && target <= accessiblePageCount) jumpToPagePosition(target); }} /></Suspense>}
      {studyMode === "active" && activeStudy?.study_mode === "pomodoro" && activeStudy?.status === "active" && <PomodoroStudy key={`${user?.id}:${activeStudy.id}`} userId={user?.id || ownerKey} run={activeStudy} page={page} virtualPage={activeVirtualPageId !== null} active={paneActive && workspaceReady && !modeDialogOpen && !activeExitOpen} blocked={Boolean(activeQuiz)} deferSetup={knowledgeOpen || marksOpen || sideOpen} busy={activeStudyBusy} onStartTest={openPomodoroQuiz} onOpenTest={openActiveQuiz} onSaveClock={(clock) => focusApi.savePomodoroClock(activeStudy.id, clock)} />}
      {translationOpen && shareDocumentId && paneActive && workspaceReady && !activeQuiz && !modeDialogOpen && <SheetTranslationPanel
        documentId={shareDocumentId} page={page} onClose={() => { setTranslationOpen(false); rootRef.current?.querySelector('[data-workspace-surface="more"]')?.focus(); }} />}
      {summariesEnabled && paneActive && workspaceReady && !activeQuiz && shownKeyboardSummaries.length > 0 && <SummaryTextPanel
        summaries={shownKeyboardSummaries} activeId={summaryPanelId} onActive={setSummaryPanelId} page={page}
        open={summaryPanelOpen} onToggle={() => setSummaryPanelOpen((value) => !value)}
        pageText={sheetSummaries.pageText} onWrite={sheetSummaries.writePage} saveState={sheetSummaries.saveState} />}
      {summariesEnabled && paneActive && workspaceReady && !activeQuiz && jumpSummary && jumpTarget !== undefined && <button type="button" className="summary-jump"
        style={/** @type {any} */ ({ "--summary-accent": SUMMARY_COLORS[jumpSummary.color]?.accent })}
        onClick={() => jumpToPagePosition(jumpTarget)}>{activeSummaryPage ? <ArrowUp size={15} aria-hidden="true" /> : <ArrowDown size={15} aria-hidden="true" />}{t(activeSummaryPage ? "summary.goToSheetPage" : "summary.goToSummaryPage")}</button>}
      {showSummaryReceive && paneActive && <SummaryReceiveCard busy={summaryBusy} onReceive={() => void receiveSummary(writingSummaries[0])} onDismiss={() => setSummaryReceiveDismissed(true)} />}
      {summaryDialogOpen && <MySummaryDialog summaries={sheetSummaries.summaries} maxPerSheet={sheetSummaries.maxPerSheet} progressOf={summaryProgress} busy={summaryBusy}
        error={summaryError || (sheetSummaries.error && !sheetSummaries.loaded ? t("summary.loadFailed") : "")}
        onCreate={createSummary} onContinue={continueSummary} onUpdate={updateSummary} onDelete={deleteSummary} onReceive={receiveSummary}
        onClose={() => { setSummaryDialogOpen(false); setSummaryError(""); }} />}
      {modeDialogOpen && <StudyModeDialog customization={activeCustomization} setCustomization={setActiveCustomization} availability={selectedActiveStudyAvailability} difficulty={activeDifficulty} setDifficulty={(key) => { setActiveDifficulty(key); setActiveCustomization((current) => ({ ...current, studyMode: current.studyMode === "pomodoro" ? "pomodoro" : "standard" })); }} activeAvailable={activeStudyReady} restartProgress={savedStudyProgress(activeCustomization, selectedActiveStudyAvailability)} completed={(activeStudyAvailability?.difficulties || []).filter((item) => item.completed).map((item) => item.difficulty)} busy={activeStudyBusy || activeStudyAvailabilityLoading} checking={activeStudyAvailabilityLoading && !activeStudyBusy} error={activeStudyError} onNormal={chooseNormalStudy} onActive={(replaceExisting) => chooseActiveStudy(activeDifficulty, { replaceExisting })} onRestart={restartActiveStudy} activeOnly={entryModePreference === "active"} />}
      {shareDocumentId && <AnnotationSharePanel
        open={marksOpen}
        onClose={() => setMarksOpen(false)}
        documentId={shareDocumentId}
        basedOnId={marksSet?.shareId || ""}
        marksSet={marksSet}
        onSelectMarks={onSelectMarks}
        defaultName={user?.name || user?.full_name || ""}
        getSnapshot={() => {
          // A My Summary is the student's own: shared marks leave its pages and ink out.
          const summaryPageIds = new Set(virtualPagesRef.current.filter((item) => item.summary).map((item) => item.id));
          return snapshotFromReader({ annotations: annotationsRef.current.filter((item) => !summaryPageIds.has(item.page)), notes: notesRef.current.filter((item) => !summaryPageIds.has(item.page)), virtualPages: virtualPagesRef.current.filter((item) => !item.summary) });
        }}
        onOpenCopy={({ sheetId }) => { setMarksOpen(false); onSelectMarks(sheetId); }}
      />}
      <ConfirmDialog open={deletePageConfirmOpen} title={t("focus.deleteBlankPageConfirm")} message={t("focus.deleteBlankPageUndo")} confirmLabel={t("common.delete")} onCancel={() => setDeletePageConfirmOpen(false)} onConfirm={() => deleteBlankPage({ confirmed: true })} />
      <ActiveStudyExitDialog open={activeExitOpen} busy={activeStudyBusy} onSave={exitActiveStudyAndSave} onDiscard={exitActiveStudyWithoutSaving} onCancel={() => setActiveExitOpen(false)} />
      {activeQuiz && activeStudy && <ActiveStudyQuiz key={activeQuiz.attempt_id} quiz={activeQuiz} answers={activeAnswers} setAnswers={setActiveAnswers} locked={activeLocked} result={activeResult} explainLinks={mcqExplain.links} explainAvailability={STUDY_TOOLS_ENABLED && !COMING_SOON_STUDY_TOOLS.includes("explain") ? mcqExplain.availability : ""} onExplain={openMistakeExplain} busy={activeStudyBusy} onSubmit={submitActiveQuiz} onDismiss={dismissActiveQuiz} onRetake={retakeActiveQuiz} onContinue={continueActiveStudyAnyway} onDiscard={(done) => discardActiveAttempt({ restart: false }, done)} onRestart={(done) => discardActiveAttempt({ restart: true }, done)} onOpenPage={activeStudy.study_mode === "pomodoro" ? openPageFromResult : undefined} />}
    </main>
  );
}
