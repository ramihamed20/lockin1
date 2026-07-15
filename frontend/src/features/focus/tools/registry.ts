import type { FocusToolId } from "../contracts/types";

export type FocusToolDefinition = Readonly<{
  id: FocusToolId;
  label: string;
  category: "writing" | "markup" | "shape" | "note" | "correction";
  supportsPressure: boolean;
  supportsTilt: boolean;
  defaultThickness: number;
  defaultOpacity: number;
}>;

export class FocusToolRegistry {
  readonly #tools = new Map<FocusToolId, FocusToolDefinition>();

  register(definition: FocusToolDefinition): void {
    if (this.#tools.has(definition.id)) {
      throw new Error(`Focus tool ${definition.id} is already registered.`);
    }
    this.#tools.set(definition.id, Object.freeze({ ...definition }));
  }

  get(id: FocusToolId): FocusToolDefinition {
    const tool = this.#tools.get(id);
    if (!tool) {
      throw new Error(`Focus tool ${id} is not registered.`);
    }
    return tool;
  }

  list(): readonly FocusToolDefinition[] {
    return Object.freeze([...this.#tools.values()]);
  }
}

const builtInTools: readonly FocusToolDefinition[] = [
  {
    id: "pen",
    label: "Pen",
    category: "writing",
    supportsPressure: true,
    supportsTilt: true,
    defaultThickness: 2.5,
    defaultOpacity: 1
  },
  {
    id: "pencil",
    label: "Pencil",
    category: "writing",
    supportsPressure: true,
    supportsTilt: true,
    defaultThickness: 1.5,
    defaultOpacity: 0.75
  },
  {
    id: "highlighter",
    label: "Highlighter",
    category: "markup",
    supportsPressure: false,
    supportsTilt: false,
    defaultThickness: 12,
    defaultOpacity: 0.35
  },
  {
    id: "eraser",
    label: "Eraser",
    category: "correction",
    supportsPressure: false,
    supportsTilt: false,
    defaultThickness: 16,
    defaultOpacity: 1
  },
  {
    id: "line",
    label: "Straight line",
    category: "shape",
    supportsPressure: false,
    supportsTilt: false,
    defaultThickness: 2.5,
    defaultOpacity: 1
  },
  {
    id: "arrow",
    label: "Arrow",
    category: "shape",
    supportsPressure: false,
    supportsTilt: false,
    defaultThickness: 2.5,
    defaultOpacity: 1
  },
  {
    id: "rectangle",
    label: "Rectangle",
    category: "shape",
    supportsPressure: false,
    supportsTilt: false,
    defaultThickness: 2.5,
    defaultOpacity: 1
  },
  {
    id: "circle",
    label: "Circle",
    category: "shape",
    supportsPressure: false,
    supportsTilt: false,
    defaultThickness: 2.5,
    defaultOpacity: 1
  },
  {
    id: "text",
    label: "Text",
    category: "note",
    supportsPressure: false,
    supportsTilt: false,
    defaultThickness: 1,
    defaultOpacity: 1
  },
  {
    id: "sticky-note",
    label: "Sticky note",
    category: "note",
    supportsPressure: false,
    supportsTilt: false,
    defaultThickness: 1,
    defaultOpacity: 1
  }
];

export function createDefaultFocusToolRegistry(): FocusToolRegistry {
  const registry = new FocusToolRegistry();
  builtInTools.forEach((tool) => registry.register(tool));
  return registry;
}
