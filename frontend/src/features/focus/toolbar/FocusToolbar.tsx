import { createDefaultFocusToolRegistry } from "../tools/registry";
import type { FocusToolId } from "../contracts/types";

type Props = {
  activeTool: FocusToolId | null;
  color: string;
  thickness: number;
  canUndo: boolean;
  canRedo: boolean;
  labels: Record<string, string>;
  onTool: (tool: FocusToolId | null) => void;
  onColor: (color: string) => void;
  onThickness: (thickness: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  onClearPage: () => void;
};

const registry = createDefaultFocusToolRegistry();
const visibleTools: readonly FocusToolId[] = ["pen", "pencil", "highlighter", "eraser", "line", "arrow", "rectangle", "circle", "text", "sticky-note"];

function ToolGlyph({ tool }: { tool: FocusToolId }) {
  const glyphs: Record<FocusToolId, string> = { pen: "✎", pencil: "╱", highlighter: "▰", eraser: "◇", line: "╱", arrow: "→", rectangle: "□", circle: "○", text: "T", "sticky-note": "▤" };
  return <span aria-hidden="true">{glyphs[tool]}</span>;
}

export function FocusToolbar(props: Props) {
  return (
    <div className="focus-toolbar" role="toolbar" aria-label={props.labels.focusTools}>
      <div className="focus-toolbar__tools">
        <button type="button" className="focus-tool" aria-pressed={props.activeTool === null} onClick={() => props.onTool(null)} title={props.labels.pan}>
          <span aria-hidden="true">☝</span><span>{props.labels.pan}</span>
        </button>
        {visibleTools.map((id) => {
          const definition = registry.get(id);
          return (
            <button key={id} type="button" className="focus-tool" aria-pressed={props.activeTool === id} onClick={() => props.onTool(id)} title={props.labels[id] ?? definition.label}>
              <ToolGlyph tool={id} /><span>{props.labels[id] ?? definition.label}</span>
            </button>
          );
        })}
      </div>
      <div className="focus-toolbar__settings">
        <label className="focus-color"><span>{props.labels.color}</span><input type="color" value={props.color} onChange={(event) => props.onColor(event.target.value)} /></label>
        <label className="focus-thickness"><span>{props.labels.thickness}</span><input type="range" min="1" max="24" step="0.5" value={props.thickness} onChange={(event) => props.onThickness(Number(event.target.value))} /></label>
        <button type="button" className="focus-icon-button" disabled={!props.canUndo} onClick={props.onUndo} aria-label={props.labels.undo} title={`${props.labels.undo} (Ctrl+Z)`}>↶</button>
        <button type="button" className="focus-icon-button" disabled={!props.canRedo} onClick={props.onRedo} aria-label={props.labels.redo} title={`${props.labels.redo} (Ctrl+Shift+Z)`}>↷</button>
        <button type="button" className="focus-icon-button focus-icon-button--danger" onClick={props.onClearPage} aria-label={props.labels.clearPage} title={props.labels.clearPage}>⌫</button>
      </div>
    </div>
  );
}
