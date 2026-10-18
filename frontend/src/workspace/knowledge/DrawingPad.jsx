import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { samplesFromPointerEvent, strokeCenterlinePath } from "../ink/strokeModel.js";
import { newId } from "./model.js";

export default function DrawingPad({ strokes, paper, onChange, t }) {
  const svg = useRef(null);
  const draft = useRef(null);
  const frame = useRef(0);
  const [live, setLive] = useState(null);
  const [tool, setTool] = useState("pen");
  const [color, setColor] = useState("#403544");
  const [width, setWidth] = useState(3);
  const [zoom, setZoom] = useState(1);
  const [finger, setFinger] = useState(false);
  const [selected, setSelected] = useState("");
  const [shape, setShape] = useState("rectangle");
  const [limited, setLimited] = useState(false);
  const pointCount = useMemo(() => strokes.reduce((sum, stroke) => sum + stroke.points.length, 0), [strokes]);
  const strokesRef = useRef(strokes);
  strokesRef.current = strokes;
  const changeRef = useRef(onChange);
  changeRef.current = onChange;
  useEffect(() => () => {
    cancelAnimationFrame(frame.current);
    if (draft.current?.points.length && strokesRef.current.length < 500) {
      const { pointerId: _pointerId, ...stroke } = draft.current;
      draft.current = null;
      changeRef.current([...strokesRef.current, stroke]);
    }
  }, []);
  const point = (x, y) => {
    const rect = svg.current.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1000, (x - rect.left) * 1000 / rect.width)),
      y: Math.max(0, Math.min(1400, (y - rect.top) * 1400 / rect.height)) };
  };
  function begin(event) {
    if (draft.current || event.button !== 0 || (event.pointerType === "touch" && !finger)) return;
    if (tool !== "select" && tool !== "eraser" && (strokes.length >= 500 || pointCount >= 100000)) { setLimited(true); return; }
    if (tool === "select") return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    if (tool === "eraser") {
      const id = event.target.dataset.stroke;
      if (id) onChange(strokes.filter((stroke) => stroke.id !== id));
      return;
    }
    draft.current = { id: newId(), color, width, tool, pointerId: event.pointerId, points: [] };
    move(event);
  }
  function move(event) {
    if (!draft.current || draft.current.pointerId !== event.pointerId) return;
    const samples = samplesFromPointerEvent(event.nativeEvent || event, point);
    const remaining = Math.max(0, Math.min(10000 - draft.current.points.length, 100000 - pointCount - draft.current.points.length));
    draft.current.points.push(...samples.slice(0, remaining).map((sample) => [sample.x, sample.y, sample.p ?? .5]));
    if (samples.length > remaining) setLimited(true);
    if (!frame.current) frame.current = requestAnimationFrame(() => {
      frame.current = 0; setLive(draft.current ? { ...draft.current } : null);
    });
  }
  function finish(event) {
    if (!draft.current || draft.current.pointerId !== event.pointerId) return;
    move(event);
    const { pointerId: _pointerId, ...stroke } = draft.current;
    draft.current = null;
    cancelAnimationFrame(frame.current); frame.current = 0; setLive(null);
    if (strokes.length < 500) onChange([...strokes, stroke]);
  }
  function moveSelected(dx, dy) {
    const stroke = strokes.find((item) => item.id === selected);
    if (!stroke) return;
    const xs = stroke.points.map((point) => point[0]), ys = stroke.points.map((point) => point[1]);
    const x = Math.max(-Math.min(...xs), Math.min(1000 - Math.max(...xs), dx));
    const y = Math.max(-Math.min(...ys), Math.min(1400 - Math.max(...ys), dy));
    onChange(strokes.map((item) => item.id === selected ? { ...item, points: item.points.map(([px, py, p]) => [px + x, py + y, p]) } : item));
  }
  function addShape() {
    let points;
    if (shape === "circle") points = Array.from({ length: 65 }, (_, index) => {
      const angle = index / 64 * Math.PI * 2;
      return [500 + Math.cos(angle) * 150, 500 + Math.sin(angle) * 100, .5];
    });
    else if (shape === "arrow") points = [[300, 500, .5], [650, 500, .5], [580, 460, .5], [650, 500, .5], [580, 540, .5]];
    else points = [[300, 400, .5], [650, 400, .5], [650, 650, .5], [300, 650, .5], [300, 400, .5]];
    if (strokes.length < 500 && pointCount + points.length <= 100000) onChange([...strokes, { id: newId(), points, tool: "pen", color, width }]);
    else setLimited(true);
  }
  const cached = useMemo(() => strokes.map((stroke) => ({ stroke,
    path: strokeCenterlinePath(stroke.points.map(([x, y]) => ({ x, y }))),
    lineWidth: stroke.width * (stroke.tool === "pen" ? .7 + stroke.points.reduce((sum, point) => sum + point[2], 0) / stroke.points.length : 1),
  })), [strokes]);
  const render = useCallback((stroke, temporary = false, path = null, lineWidth = null) => <path key={stroke.id} data-stroke={stroke.id}
    d={path || strokeCenterlinePath(stroke.points.map(([x, y]) => ({ x, y })))}
    fill="none" stroke={stroke.color} strokeWidth={lineWidth || stroke.width * (stroke.tool === "pen" ? .7 + stroke.points.reduce((sum, p) => sum + p[2], 0) / stroke.points.length : 1)}
    strokeLinecap="round" strokeLinejoin="round" opacity={stroke.tool === "highlighter" ? .35 : 1}
    className={selected === stroke.id ? "knowledge-stroke-selected" : ""}
    onClick={temporary ? undefined : () => { if (tool === "select") setSelected(stroke.id); }} />, [selected, tool]);
  const persisted = useMemo(() => cached.map((item) => render(item.stroke, false, item.path, item.lineWidth)), [cached, render]);
  return <section className="knowledge-drawing" aria-label={t("knowledge.drawing")}>
    <div className="knowledge-toolbar">
      {["pen", "highlighter", "eraser", "select"].map((item) => <button type="button" key={item} aria-pressed={tool === item} onClick={() => setTool(item)}>{t(`knowledge.${item}`)}</button>)}
      <label>{t("knowledge.color")}<input type="color" value={color} onChange={(event) => setColor(event.target.value)} /></label>
      <label>{t("knowledge.width")}<input type="range" min="1" max="24" value={width} onChange={(event) => setWidth(Number(event.target.value))} /></label>
      <label>{t("knowledge.zoom")}<input type="range" min="1" max="2" step=".1" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /></label>
      <label>{t("knowledge.shape")}<select value={shape} onChange={(event) => setShape(event.target.value)}>{["rectangle", "circle", "arrow"].map((item) => <option key={item} value={item}>{t(`knowledge.${item}`)}</option>)}</select></label><button type="button" onClick={addShape} disabled={strokes.length >= 500}>{t("knowledge.addShape")}</button>
      <label><input type="checkbox" checked={finger} onChange={(event) => setFinger(event.target.checked)} />{t("knowledge.finger")}</label>
      {tool === "select" && <label>{t("knowledge.select")}<select value={selected} onChange={(event) => setSelected(event.target.value)}><option value="">{t("knowledge.unlinked")}</option>{strokes.map((stroke, index) => <option key={stroke.id} value={stroke.id}>{index + 1}</option>)}</select></label>}
      {selected && <>{[[-10, 0, "←"], [10, 0, "→"], [0, -10, "↑"], [0, 10, "↓"]].map(([dx, dy, arrow]) => <button type="button" key={arrow} aria-label={t("knowledge.moveStroke", { direction: arrow })} onClick={() => moveSelected(dx, dy)}>{arrow}</button>)}<button type="button" onClick={() => { onChange(strokes.filter((stroke) => stroke.id !== selected)); setSelected(""); }}>{t("common.delete")}</button></>}
    </div>
    <div className={`knowledge-paper-scroll is-${paper}`}>
      <svg ref={svg} viewBox="0 0 1000 1400" style={{ width: `${zoom * 100}%`, touchAction: finger && tool !== "select" ? "none" : "pan-x pan-y" }}
        role="img" aria-label={t("knowledge.drawing")} onPointerDown={begin} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish}>
        <title>{t("knowledge.drawing")}</title>
        {persisted}
        {live && render(live, true)}
      </svg>
    </div>
    {limited && <p role="status">{t("knowledge.inkLimit")}</p>}
    <p className="knowledge-hint">{t("knowledge.inkHint")}</p>
  </section>;
}
