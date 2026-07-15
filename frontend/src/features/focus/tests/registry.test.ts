import { describe, expect, it } from "vitest";

import { createDefaultFocusToolRegistry, FocusToolRegistry } from "../tools/registry";

describe("FocusToolRegistry", () => {
  it("exposes the planned Phase 2 tool contracts", () => {
    const registry = createDefaultFocusToolRegistry();

    expect(registry.list().map((tool) => tool.id)).toEqual([
      "pen",
      "pencil",
      "highlighter",
      "eraser",
      "line",
      "arrow",
      "rectangle",
      "circle",
      "text",
      "sticky-note"
    ]);
    expect(registry.get("pen").supportsPressure).toBe(true);
    expect(registry.get("highlighter").defaultOpacity).toBeLessThan(1);
  });

  it("rejects duplicate tool identifiers", () => {
    const registry = new FocusToolRegistry();
    const tool = {
      id: "pen" as const,
      label: "Pen",
      category: "writing" as const,
      supportsPressure: true,
      supportsTilt: true,
      defaultThickness: 2,
      defaultOpacity: 1
    };

    registry.register(tool);

    expect(() => registry.register(tool)).toThrow(/already registered/i);
  });
});
