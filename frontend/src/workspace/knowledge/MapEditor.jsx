import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { addMapNode, arrangeMap, connectionGeometry, copyMapSelection, newId, pasteMapSelection, removeMapNodes } from "./model.js";

/** @returns {import("react").CSSProperties & {"--node-color": string}} */
function nodePositionStyle(node) {
  return { left: node.x, top: node.y, width: node.width, height: node.height, "--node-color": node.color };
}

export default function MapEditor({ record, onChange, onExplain, onRead, concepts, questions, selection = [], onSelection, t, focusNode, onFocused }) {
  const map = record.content;
  const setSelection = onSelection;
  const [recall, setRecall] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [relationship, setRelationship] = useState("");
  const [edgeStyle, setEdgeStyle] = useState("solid");
  const [clipboard, setClipboard] = useState({ nodes: [], edges: [] });
  const [multiSelect, setMultiSelect] = useState(false);
  const drag = useRef(null);
  const surface = useRef(null);
  const scrollTimer = useRef(0);
  const mapRef = useRef(map);
  mapRef.current = map;
  const updateRef = useRef(onChange);
  updateRef.current = onChange;
  const recordRef = useRef(record);
  recordRef.current = record;
  const pendingViewport = useRef(null);
  function saveViewport() {
    if (!pendingViewport.current) return;
    const next = { ...mapRef.current, viewport: { ...mapRef.current.viewport, ...pendingViewport.current } };
    pendingViewport.current = null;
    updateRef.current({ ...recordRef.current, content: next });
  }
  const saveRef = useRef(saveViewport);
  saveRef.current = saveViewport;
  useLayoutEffect(() => {
    const viewport = mapRef.current.viewport;
    if (surface.current && viewport) surface.current.scrollTo(viewport.x, viewport.y);
  }, [record.id]);
  useLayoutEffect(() => {
    if (!focusNode || !surface.current) return;
    const node = mapRef.current.nodes.find((item) => item.id === focusNode.nodeId);
    if (node) {
      const zoom = mapRef.current.viewport?.zoom || 1;
      surface.current.scrollTo(Math.max(0, (node.x + node.width / 2) * zoom - surface.current.clientWidth / 2),
        Math.max(0, (node.y + node.height / 2) * zoom - surface.current.clientHeight / 2));
    }
    onFocused();
  }, [focusNode, onFocused]);
  useEffect(() => () => {
    clearTimeout(scrollTimer.current);
    saveRef.current();
  }, [record.id]);
  const marker = `knowledge-arrow-${record.id}`;
  const viewport = map.viewport || { x: 0, y: 0, zoom: 1 };
  const commit = (content) => onChange({ ...record, content });
  const selected = map.nodes.find((node) => node.id === selection[0]);
  const updateNode = (patch) => commit({ ...map, nodes: map.nodes.map((node) => selection.includes(node.id) ? { ...node, ...patch } : node) });
  const width = Math.max(1200, ...map.nodes.map((node) => node.x + node.width + 100));
  const height = Math.max(900, ...map.nodes.map((node) => node.y + node.height + 100));
  function begin(event, node) {
    if (event.button !== 0 || recall) return;
    const chosen = event.shiftKey || multiSelect ? [...new Set([...selection, node.id])] : selection.includes(node.id) ? selection : [node.id];
    setSelection(chosen);
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, node, pointerId: event.pointerId, ids: chosen, dx: 0, dy: 0 };
  }
  function move(event) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    current.dx = (event.clientX - current.x) / viewport.zoom;
    current.dy = (event.clientY - current.y) / viewport.zoom;
    for (const id of current.ids) {
      const element = surface.current.querySelector(`[data-node="${id}"]`);
      if (element) element.style.translate = `${current.dx}px ${current.dy}px`;
    }
  }
  function finish(event) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    drag.current = null;
    for (const id of current.ids) {
      const element = surface.current.querySelector(`[data-node="${id}"]`);
      if (element) element.style.translate = "";
    }
    if (current.dx || current.dy) commit({ ...map, nodes: map.nodes.map((node) => current.ids.includes(node.id)
      ? { ...node, x: Math.max(0, Math.min(9000, node.x + current.dx)), y: Math.max(0, Math.min(9000, node.y + current.dy)) } : node) });
  }
  function connect() {
    if (selection.length !== 2 || map.edges.length >= 600) return;
    commit({ ...map, edges: [...map.edges, { id: newId(), from: selection[0], to: selection[1], label: relationship, style: edgeStyle }] });
    setRelationship("");
  }
  const byId = new Map(map.nodes.map((node) => [node.id, node]));
  const hidden = (id) => recall && !revealed && (!selection.length || selection.includes(id));
  return <section className="knowledge-map">
    <div className="knowledge-toolbar">
      <button type="button" disabled={map.nodes.length >= 300 || recall} onClick={() => commit(addMapNode(map, t("knowledge.newConcept")))}>{t("knowledge.addNode")}</button>
      <button type="button" disabled={!selection.length || recall} onClick={() => commit(removeMapNodes(map, selection))}>{t("common.delete")}</button>
      <button type="button" disabled={!selection.length} onClick={() => setClipboard(copyMapSelection(map, selection))}>{t("knowledge.copy")}</button>
      <button type="button" disabled={!clipboard.nodes.length || recall || map.nodes.length + clipboard.nodes.length > 300 || map.edges.length + clipboard.edges.length > 600} onClick={() => commit(pasteMapSelection(map, clipboard))}>{t("knowledge.paste")}</button>
      <label className="knowledge-concept-check"><input type="checkbox" checked={multiSelect} onChange={(event) => setMultiSelect(event.target.checked)} />{t("knowledge.multiSelect")}</label>
      <button type="button" disabled={recall} onClick={() => commit(arrangeMap(map))}>{t("knowledge.arrange")}</button>
      <button type="button" aria-pressed={recall} onClick={() => { setRecall(!recall); setRevealed(false); }}>{t("knowledge.recall")}</button>
      {recall && <button type="button" onClick={() => setRevealed(!revealed)}>{t(revealed ? "knowledge.hide" : "knowledge.reveal")}</button>}
      <label>{t("knowledge.zoom")}<input type="range" min=".25" max="2" step=".05" value={viewport.zoom} onChange={(event) => commit({ ...map, viewport: { ...viewport, zoom: Number(event.target.value) } })} /></label>
    </div>
    <p className="knowledge-hint">{t(recall ? "knowledge.recallHint" : "knowledge.mapHint")}</p>
    <div className="knowledge-map-scroll" ref={surface} onScroll={(event) => {
      const scroll = event.currentTarget;
      pendingViewport.current = { x: Math.min(10000, scroll.scrollLeft), y: Math.min(10000, scroll.scrollTop) };
      clearTimeout(scrollTimer.current);
      scrollTimer.current = setTimeout(() => saveRef.current(), 180);
    }}>
      <div className="knowledge-map-size" style={{ width: width * viewport.zoom, height: height * viewport.zoom }}>
        <div className="knowledge-map-stage" style={{ width, height, transform: `scale(${viewport.zoom})` }}>
          <svg width={width} height={height} role="img" aria-label={t("knowledge.relationships")}>
            <title>{t("knowledge.relationships")}</title>
            <defs><marker id={marker} markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0,0 L0,6 L9,3 z" fill="currentColor" /></marker></defs>
            {map.edges.map((edge) => {
              const from = byId.get(edge.from), to = byId.get(edge.to);
              if (!from || !to) return null;
              const line = connectionGeometry(from, to);
              const x1 = line.from.x, y1 = line.from.y;
              const x2 = line.to.x, y2 = line.to.y;
              return <g key={edge.id}><line x1={x1} y1={y1} x2={x2} y2={y2} stroke="currentColor" strokeWidth="2" strokeDasharray={edge.style === "dashed" ? "6 5" : undefined} markerEnd={`url(#${marker})`} /><text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 8} textAnchor="middle">{recall && !revealed ? "…" : edge.label}</text></g>;
            })}
          </svg>
          {map.nodes.map((node) => <button type="button" data-node={node.id} key={node.id} dir="auto"
            className={`knowledge-map-node is-${node.shape}${selection.includes(node.id) ? " is-selected" : ""}`}
            style={nodePositionStyle(node)}
            aria-label={hidden(node.id) ? t("knowledge.hiddenConcept") : node.text || t("knowledge.newConcept")} aria-pressed={selection.includes(node.id)}
            onPointerDown={(event) => begin(event, node)} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish}
            onClick={(event) => { if (event.detail === 0) setSelection(event.shiftKey ? [...new Set([...selection, node.id])] : [node.id]); }}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c") { event.preventDefault(); setClipboard(copyMapSelection(map, selection)); return; }
              if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v" && clipboard.nodes.length && !recall && map.nodes.length + clipboard.nodes.length <= 300 && map.edges.length + clipboard.edges.length <= 600) { event.preventDefault(); commit(pasteMapSelection(map, clipboard)); return; }
              const delta = { ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowUp: [0, -10], ArrowDown: [0, 10] }[event.key];
              if (delta && !recall) {
                event.preventDefault();
                commit({ ...map, nodes: map.nodes.map((item) => item.id === node.id ? { ...item, x: Math.max(0, Math.min(9000, item.x + delta[0])), y: Math.max(0, Math.min(9000, item.y + delta[1])) } : item) });
              }
            }}>{hidden(node.id) ? "…" : node.text || t("knowledge.newConcept")}</button>)}
        </div>
      </div>
    </div>
    {selected && !recall && <div className="knowledge-node-inspector">
      <label>{t("knowledge.nodeText")}<textarea dir="auto" value={selected.text} maxLength={2000} onChange={(event) => updateNode({ text: event.target.value })} /></label>
      <div className="knowledge-toolbar">
        <label>{t("knowledge.shape")}<select value={selected.shape} onChange={(event) => updateNode({ shape: event.target.value })}>{["rectangle", "circle", "section"].map((shape) => <option key={shape} value={shape}>{t(`knowledge.${shape}`)}</option>)}</select></label>
        <label>{t("knowledge.color")}<input type="color" value={selected.color} onChange={(event) => updateNode({ color: event.target.value })} /></label>
        <label>{t("knowledge.nodeWidth")}<input type="number" min="60" max="1000" value={selected.width} onChange={(event) => updateNode({ width: Math.max(60, Math.min(1000, Number(event.target.value))) })} /></label>
        <label>{t("knowledge.nodeHeight")}<input type="number" min="40" max="1000" value={selected.height} onChange={(event) => updateNode({ height: Math.max(40, Math.min(1000, Number(event.target.value))) })} /></label>
      </div>
      <label>{t("knowledge.group")}<input value={selected.group} maxLength={80} onChange={(event) => updateNode({ group: event.target.value })} /></label>
      {selected.group && <button type="button" onClick={() => setSelection(map.nodes.filter((node) => node.group === selected.group).map((node) => node.id))}>{t("knowledge.selectGroup")}</button>}
      <label>{t("knowledge.linkConcept")}<select value={selected.concept_id || ""} onChange={(event) => updateNode({ concept_id: event.target.value })}><option value="">{t("knowledge.unlinked")}</option>{concepts.map((concept) => <option key={concept.id} value={concept.id}>{concept.title}</option>)}</select></label>
      {selected.concept_id && <div className="knowledge-toolbar">{questions.some((question) => (question.concept_ids || [question.concept_id]).includes(selected.concept_id)) && <button type="button" onClick={() => onExplain(selected.concept_id)}>{t("knowledge.explainConcept")}</button>}<button type="button" onClick={() => onRead(concepts.find((concept) => concept.id === selected.concept_id)?.page_start)}>{t("knowledge.readSource")}</button></div>}
    </div>}
    {selection.length === 2 && !recall && <div className="knowledge-toolbar">
      <label>{t("knowledge.relationship")}<input value={relationship} maxLength={500} onChange={(event) => setRelationship(event.target.value)} /></label>
      <label>{t("knowledge.lineStyle")}<select value={edgeStyle} onChange={(event) => setEdgeStyle(event.target.value)}><option value="solid">{t("knowledge.solid")}</option><option value="dashed">{t("knowledge.dashed")}</option></select></label>
      <button type="button" onClick={connect}>{t("knowledge.connect")}</button>
    </div>}
    <ul className="knowledge-edge-list">{map.edges.map((edge) => <li key={edge.id}><span dir="auto">{recall && !revealed ? t("knowledge.hiddenConcept") : `${byId.get(edge.from)?.text} → ${byId.get(edge.to)?.text}: ${edge.label}`}</span>{!recall && byId.get(edge.from)?.concept_id && byId.get(edge.to)?.concept_id && questions.some((question) => [byId.get(edge.from).concept_id, byId.get(edge.to).concept_id].every((id) => (question.concept_ids || [question.concept_id]).includes(id))) && <button type="button" onClick={() => onExplain([byId.get(edge.from).concept_id, byId.get(edge.to).concept_id])}>{t("knowledge.explainRelationship")}</button>}{!recall && <button type="button" aria-label={t("knowledge.deleteRelationship")} onClick={() => commit({ ...map, edges: map.edges.filter((item) => item.id !== edge.id) })}>{t("common.delete")}</button>}</li>)}</ul>
  </section>;
}
