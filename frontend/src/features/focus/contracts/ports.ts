import type {
  FocusAnnotation,
  FocusPointerKind,
  FocusSessionContext,
  FocusWorkspaceState,
  PointerSample
} from "./types";

export type AnnotationSaveResult = Readonly<{
  savedRevision: number;
  savedAt: string;
}>;

export interface AnnotationRepository {
  load(input: {
    userId: string;
    documentVersionId: string;
    pageNumbers: readonly number[];
    signal?: AbortSignal;
  }): Promise<readonly FocusAnnotation[]>;
  save(input: {
    documentVersionId: string;
    annotations: readonly FocusAnnotation[];
    expectedRevision: number;
    signal?: AbortSignal;
  }): Promise<AnnotationSaveResult>;
  remove(input: {
    documentVersionId: string;
    annotationIds: readonly string[];
    expectedRevision: number;
    signal?: AbortSignal;
  }): Promise<AnnotationSaveResult>;
}

export interface WorkspaceStateRepository {
  load(documentVersionId: string): Promise<FocusWorkspaceState | null>;
  save(state: FocusWorkspaceState): Promise<void>;
  clear(documentVersionId: string): Promise<void>;
}

export interface PdfViewportRenderer {
  mount(container: HTMLElement): Promise<void>;
  renderVisiblePages(input: { firstPage: number; lastPage: number; zoom: number }): Promise<void>;
  releaseOutsideRange(input: { firstPage: number; lastPage: number }): void;
  destroy(): Promise<void>;
}

export interface FocusGestureController {
  classifyPointer(event: PointerEvent): FocusPointerKind;
  normalizeSample(event: PointerEvent, page: DOMRect): PointerSample;
  supportsPressure(event: PointerEvent): boolean;
  supportsTilt(event: PointerEvent): boolean;
}

export interface FocusSessionGateway {
  start(input: {
    context: FocusSessionContext;
    plannedDurationSeconds: number | null;
    signal?: AbortSignal;
  }): Promise<{ sessionId: string; startedAt: string }>;
  complete(input: {
    sessionId: string;
    activeDurationSeconds: number;
    signal?: AbortSignal;
  }): Promise<{ completedAt: string }>;
}

export interface FocusKeyboardCommands {
  attach(target: HTMLElement): () => void;
}
