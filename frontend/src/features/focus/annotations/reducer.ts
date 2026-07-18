import type { FocusAnnotation } from "../contracts/types";

export type AnnotationState = Readonly<{
  items: Readonly<Record<string, FocusAnnotation>>;
  pendingUpserts: Readonly<Record<string, FocusAnnotation>>;
  pendingDeletes: readonly string[];
  undo: readonly AnnotationCommand[];
  redo: readonly AnnotationCommand[];
}>;

type AnnotationCommand = Readonly<{ before: FocusAnnotation | null; after: FocusAnnotation | null }>;
export type AnnotationAction =
  | { type: "hydrate"; annotations: readonly FocusAnnotation[]; pendingUpserts?: readonly FocusAnnotation[]; pendingDeletes?: readonly string[] }
  | { type: "merge"; annotations: readonly FocusAnnotation[] }
  | { type: "upsert"; annotation: FocusAnnotation }
  | { type: "remove"; id: string }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "synced"; annotations: readonly FocusAnnotation[]; deletedIds: readonly string[]; sentUpserts: readonly FocusAnnotation[]; sentDeletedIds: readonly string[] };

export const emptyAnnotationState: AnnotationState = { items: {}, pendingUpserts: {}, pendingDeletes: [], undo: [], redo: [] };

function applyCommand(state: AnnotationState, command: AnnotationCommand): AnnotationState {
  const items = { ...state.items };
  const pendingUpserts = { ...state.pendingUpserts };
  let pendingDeletes = state.pendingDeletes.filter((id) => id !== command.before?.id && id !== command.after?.id);
  if (command.after) {
    items[command.after.id] = command.after;
    pendingUpserts[command.after.id] = command.after;
  } else if (command.before) {
    delete items[command.before.id];
    delete pendingUpserts[command.before.id];
    pendingDeletes = [...pendingDeletes, command.before.id];
  }
  return { ...state, items, pendingUpserts, pendingDeletes };
}

export function annotationReducer(state: AnnotationState, action: AnnotationAction): AnnotationState {
  if (action.type === "hydrate") {
    const items = Object.fromEntries(action.annotations.map((item) => [item.id, item]));
    const pendingUpserts = Object.fromEntries((action.pendingUpserts ?? []).map((item) => [item.id, item]));
    (action.pendingUpserts ?? []).forEach((item) => { items[item.id] = item; });
    (action.pendingDeletes ?? []).forEach((id) => { delete items[id]; });
    return { items, pendingUpserts, pendingDeletes: action.pendingDeletes ?? [], undo: [], redo: [] };
  }
  if (action.type === "merge") {
    const items = { ...state.items };
    action.annotations.forEach((item) => {
      if (!state.pendingUpserts[item.id] && !state.pendingDeletes.includes(item.id)) items[item.id] = item;
    });
    return { ...state, items };
  }
  if (action.type === "upsert") {
    const before = state.items[action.annotation.id] ?? null;
    const command = { before, after: action.annotation };
    return { ...applyCommand(state, command), undo: [...state.undo, command], redo: [] };
  }
  if (action.type === "remove") {
    const before = state.items[action.id];
    if (!before) return state;
    const command = { before, after: null };
    return { ...applyCommand(state, command), undo: [...state.undo, command], redo: [] };
  }
  if (action.type === "undo") {
    const command = state.undo.at(-1);
    if (!command) return state;
    const inverse = { before: command.after, after: command.before };
    return { ...applyCommand(state, inverse), undo: state.undo.slice(0, -1), redo: [...state.redo, command] };
  }
  if (action.type === "redo") {
    const command = state.redo.at(-1);
    if (!command) return state;
    return { ...applyCommand(state, command), undo: [...state.undo, command], redo: state.redo.slice(0, -1) };
  }
  const items = { ...state.items };
  const pendingUpserts = { ...state.pendingUpserts };
  const sentById = Object.fromEntries(action.sentUpserts.map((item) => [item.id, item]));
  action.annotations.forEach((item) => {
    if (pendingUpserts[item.id]?.updatedAt === sentById[item.id]?.updatedAt) {
      items[item.id] = item;
      delete pendingUpserts[item.id];
    }
  });
  const sentDeletes = new Set(action.sentDeletedIds);
  const pendingDeletes = state.pendingDeletes.filter((id) => !sentDeletes.has(id));
  action.deletedIds.forEach((id) => { if (!pendingUpserts[id] && !pendingDeletes.includes(id)) delete items[id]; });
  return { ...state, items, pendingUpserts, pendingDeletes };
}
