import type { FocusAnnotation, FocusSidebar as SidebarMode } from "../contracts/types";

type Props = {
  mode: SidebarMode;
  pageCount: number;
  currentPage: number;
  annotations: readonly FocusAnnotation[];
  labels: Record<string, string>;
  onPage: (page: number) => void;
  onUpdateNote: (annotation: FocusAnnotation, value: string) => void;
  onClose: () => void;
};

export function FocusSidebar(props: Props) {
  if (props.mode === "closed") return null;
  const notes = props.annotations.filter((annotation) => annotation.payload.kind === "sticky-note" || annotation.payload.kind === "text");
  return (
    <aside className="focus-sidebar" aria-label={props.mode === "notes" ? props.labels.notes : props.labels.thumbnails}>
      <header><h2>{props.mode === "notes" ? props.labels.notes : props.labels.thumbnails}</h2><button type="button" onClick={props.onClose} aria-label={props.labels.closePanel}>×</button></header>
      {props.mode === "thumbnails" ? (
        <ol className="focus-page-list">
          {Array.from({ length: props.pageCount }, (_, index) => index + 1).map((page) => (
            <li key={page}><button type="button" aria-current={page === props.currentPage ? "page" : undefined} onClick={() => props.onPage(page)}><span className="focus-page-preview" aria-hidden="true">{page}</span><span>{props.labels.page} {page}</span></button></li>
          ))}
        </ol>
      ) : notes.length ? (
        <ul className="focus-note-list">
          {notes.map((annotation) => (
            <li key={annotation.id}>
              <label><span>{props.labels.page} {annotation.pageNumber}</span><textarea dir="auto" rows={4} maxLength={4000} defaultValue={annotation.payload.kind === "stroke" || annotation.payload.kind === "shape" ? "" : annotation.payload.value} onBlur={(event) => props.onUpdateNote(annotation, event.target.value)} /></label>
            </li>
          ))}
        </ul>
      ) : <p className="focus-sidebar__empty">{props.labels.noNotes}</p>}
    </aside>
  );
}
