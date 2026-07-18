export type FocusPointerKind = "pen" | "touch" | "mouse" | "unknown";

export type FocusToolId =
  | "pen"
  | "pencil"
  | "highlighter"
  | "eraser"
  | "line"
  | "arrow"
  | "rectangle"
  | "circle"
  | "text"
  | "sticky-note";

export type PersistedFocusToolId = Exclude<FocusToolId, "eraser">;
export type FocusSidebar = "closed" | "thumbnails" | "notes";
export type FocusSaveState = "saved" | "saving" | "local" | "offline" | "conflict" | "failed";

export type NormalizedPoint = Readonly<{ x: number; y: number }>;
export type PointerSample = NormalizedPoint & Readonly<{
  pointer: FocusPointerKind;
  pressure: number;
  tiltX: number;
  tiltY: number;
  timestamp: number;
}>;
export type AnnotationBounds = Readonly<{ x: number; y: number; width: number; height: number }>;
export type AnnotationPayload =
  | Readonly<{ kind: "stroke"; samples: readonly PointerSample[] }>
  | Readonly<{ kind: "shape"; start: NormalizedPoint; end: NormalizedPoint }>
  | Readonly<{ kind: "text"; value: string }>
  | Readonly<{ kind: "sticky-note"; value: string }>;

export type FocusAnnotation = Readonly<{
  id: string;
  pageNumber: number;
  tool: PersistedFocusToolId;
  layerKey: string;
  bounds: AnnotationBounds;
  payload: AnnotationPayload;
  color: string;
  thickness: number;
  opacity: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
}>;

export type FocusDocument = Readonly<{
  documentId: string;
  documentVersionId: string;
  fileId: string;
  title: string;
  language: string;
  viewUrl: string;
  sizeBytes: number;
  checksumSha256: string;
  pageCount: number | null;
}>;

export type FocusWorkspaceState = Readonly<{
  sessionId: string;
  documentId: string;
  documentVersionId: string;
  fileId: string;
  currentPage: number;
  pageCount: number | null;
  zoom: number;
  sidebar: FocusSidebar;
  activeTool: FocusToolId | null;
  layout: Readonly<Record<string, unknown>>;
  openTabs: readonly string[];
  revision: number;
  updatedAt: string;
}>;

export type FocusSession = Readonly<{
  id: string;
  contextType: string;
  contextId: string | null;
  status: "active" | "paused" | "completed" | "abandoned";
  startedAt: string;
  lastActivityAt: string;
  endedAt: string | null;
  activeDurationSeconds: number;
  revision: number;
  workspace: FocusWorkspaceState | null;
}>;

export type FocusRecoveryRecord = Readonly<{
  schemaVersion: 1;
  accountId: string;
  documentVersionId: string;
  clientInstanceId: string;
  workspace: FocusWorkspaceState;
  annotations: readonly FocusAnnotation[];
  pendingUpserts: readonly FocusAnnotation[];
  pendingDeletes: readonly string[];
  collectionRevision: number;
  savedLocallyAt: string;
}>;

export type FocusExtensionSlot =
  | "toolbar.after"
  | "sidebar.panel"
  | "document.context-menu"
  | "session.summary";

export interface FocusExtension {
  id: string;
  slot: FocusExtensionSlot;
  label: string;
}
