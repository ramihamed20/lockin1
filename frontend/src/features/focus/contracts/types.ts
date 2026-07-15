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

export type NormalizedPoint = Readonly<{
  x: number;
  y: number;
}>;

export type PointerSample = NormalizedPoint &
  Readonly<{
    pointer: FocusPointerKind;
    pressure: number;
    tiltX: number;
    tiltY: number;
    timestamp: number;
  }>;

export type AnnotationBounds = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
}>;

export type AnnotationPayload =
  | Readonly<{ kind: "stroke"; samples: readonly PointerSample[] }>
  | Readonly<{ kind: "shape"; start: NormalizedPoint; end: NormalizedPoint }>
  | Readonly<{ kind: "text"; value: string }>
  | Readonly<{ kind: "sticky-note"; value: string }>;

export type FocusAnnotation = Readonly<{
  id: string;
  userId: string;
  documentId: string;
  documentVersionId: string;
  pageNumber: number;
  bounds: AnnotationBounds;
  tool: FocusToolId;
  color: string;
  thickness: number;
  opacity: number;
  createdAt: string;
  updatedAt: string;
  revision: number;
  payload: AnnotationPayload;
}>;

export type FocusWorkspaceState = Readonly<{
  documentId: string;
  documentVersionId: string;
  currentPage: number;
  zoom: number;
  sidebar: "closed" | "thumbnails";
  activeTool: FocusToolId | null;
  fullScreen: boolean;
}>;

export type FocusSessionContext = Readonly<{
  type: "independent" | "study" | "quiz";
  id: string | null;
}>;
