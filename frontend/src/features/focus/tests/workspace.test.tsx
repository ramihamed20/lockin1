import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { annotationReducer, emptyAnnotationState } from "../annotations/reducer";
import type { FocusAnnotation } from "../contracts/types";
import { FocusExtensionRegistry } from "../extensions/registry";
import { FocusToolbar } from "../toolbar/FocusToolbar";

function annotation(updatedAt = "2026-07-18T10:00:00Z"): FocusAnnotation {
  return {
    id: "00000000-0000-4000-8000-000000000001", pageNumber: 1, tool: "pen", layerKey: "personal",
    bounds: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
    payload: { kind: "stroke", samples: [
      { x: 0.1, y: 0.1, pointer: "pen", pressure: 0.5, tiltX: 0, tiltY: 0, timestamp: 1 },
      { x: 0.3, y: 0.3, pointer: "pen", pressure: 0.6, tiltX: 2, tiltY: -2, timestamp: 2 }
    ] },
    color: "#f2c94c", thickness: 2.5, opacity: 1, revision: 0,
    createdAt: "2026-07-18T10:00:00Z", updatedAt
  };
}

describe("Focus workspace boundaries", () => {
  it("keeps a newer local edit when an older sync finishes", () => {
    const sent = annotation();
    const newer = annotation("2026-07-18T10:01:00Z");
    let state = annotationReducer(emptyAnnotationState, { type: "upsert", annotation: sent });
    state = annotationReducer(state, { type: "upsert", annotation: newer });
    state = annotationReducer(state, { type: "synced", annotations: [{ ...sent, revision: 1 }], deletedIds: [], sentUpserts: [sent], sentDeletedIds: [] });
    expect(state.items[sent.id]?.updatedAt).toBe(newer.updatedAt);
    expect(state.pendingUpserts[sent.id]?.updatedAt).toBe(newer.updatedAt);
  });

  it("merges remote pages without replacing pending local work", () => {
    const local = annotation("2026-07-18T10:02:00Z");
    const remoteSame = annotation("2026-07-18T10:01:00Z");
    const remoteOther = { ...annotation(), id: "00000000-0000-4000-8000-000000000002", pageNumber: 2 };
    let state = annotationReducer(emptyAnnotationState, { type: "hydrate", annotations: [], pendingUpserts: [local], pendingDeletes: [] });
    state = annotationReducer(state, { type: "merge", annotations: [remoteSame, remoteOther] });
    expect(state.items[local.id]).toEqual(local);
    expect(state.items[remoteOther.id]).toEqual(remoteOther);
    expect(annotationReducer(state, { type: "remove", id: "missing" })).toBe(state);
    expect(annotationReducer(emptyAnnotationState, { type: "undo" })).toBe(emptyAnnotationState);
    expect(annotationReducer(emptyAnnotationState, { type: "redo" })).toBe(emptyAnnotationState);
  });

  it("supports reversible deletion without losing the annotation identity", () => {
    const item = annotation();
    let state = annotationReducer(emptyAnnotationState, { type: "hydrate", annotations: [item] });
    state = annotationReducer(state, { type: "remove", id: item.id });
    expect(state.pendingDeletes).toEqual([item.id]);
    state = annotationReducer(state, { type: "undo" });
    expect(state.items[item.id]).toEqual(item);
    expect(state.pendingDeletes).toEqual([]);
    expect(state.pendingUpserts[item.id]).toEqual(item);
    state = annotationReducer(state, { type: "redo" });
    expect(state.items[item.id]).toBeUndefined();
    state = annotationReducer(state, { type: "undo" });
    expect(state.items[item.id]).toEqual(item);
    state = annotationReducer(state, { type: "synced", annotations: [], deletedIds: [item.id], sentUpserts: [], sentDeletedIds: [item.id] });
    expect(state.items[item.id]).toEqual(item);
  });

  it("keeps future integrations in explicit, duplicate-safe slots", () => {
    const registry = new FocusExtensionRegistry();
    registry.register({ id: "study.timer", slot: "toolbar.after", label: "Timer" });
    expect(registry.forSlot("toolbar.after")).toEqual([{ id: "study.timer", slot: "toolbar.after", label: "Timer" }]);
    expect(() => registry.register({ id: "study.timer", slot: "sidebar.panel", label: "Duplicate" })).toThrow(/already registered/);
    expect(() => registry.register({ id: "INVALID", slot: "sidebar.panel", label: "Invalid" })).toThrow(/stable namespaced keys/);
  });

  it("exposes the drawing tools as an accessible single-choice toolbar", () => {
    const onTool = vi.fn();
    const onColor = vi.fn();
    const onThickness = vi.fn();
    const onUndo = vi.fn();
    const onRedo = vi.fn();
    const onClearPage = vi.fn();
    const labels = Object.fromEntries(["focusTools", "pan", "pen", "pencil", "highlighter", "eraser", "line", "arrow", "rectangle", "circle", "text", "sticky-note", "color", "thickness", "undo", "redo", "clearPage"].map((key) => [key, key]));
    render(<FocusToolbar activeTool="pen" color="#f2c94c" thickness={2.5} canUndo canRedo labels={labels} onTool={onTool} onColor={onColor} onThickness={onThickness} onUndo={onUndo} onRedo={onRedo} onClearPage={onClearPage} />);
    expect(screen.getByRole("toolbar", { name: "focusTools" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "pen" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "highlighter" }));
    expect(onTool).toHaveBeenCalledWith("highlighter");
    fireEvent.change(screen.getByLabelText("color"), { target: { value: "#aabbcc" } });
    fireEvent.change(screen.getByLabelText("thickness"), { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: "undo" }));
    fireEvent.click(screen.getByRole("button", { name: "redo" }));
    fireEvent.click(screen.getByRole("button", { name: "clearPage" }));
    expect(onColor).toHaveBeenCalledWith("#aabbcc");
    expect(onThickness).toHaveBeenCalledWith(7);
    expect(onUndo).toHaveBeenCalledOnce();
    expect(onRedo).toHaveBeenCalledOnce();
    expect(onClearPage).toHaveBeenCalledOnce();
  });
});
