import { Plus, Check, X, Pencil, GitBranch, Link2, Trash2, Maximize2, MoreHorizontal } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { arrangeMap, copyMapSelection, pasteMapSelection, removeMapNodes } from "./model.js";

import { addIdea, linkIdeas, curvedConnection, fitIdeas } from "./mapActions.js";

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
  const [draft, setDraft] = useState("");
  const [composer, setComposer] = useState(!map.nodes.length);
  const [branch, setBranch] = useState("");
  const [connecting, setConnecting] = useState("");
  const [editing, setEditing] = useState(false);
  const [multiSelect, setMultiSelect] = useState(false);
  const options = useRef(null);
  useEffect(() => {
    function dismiss(event) {
      if (!options.current?.open) return;
      if (event.type === "keydown" && event.key !== "Escape") return;
      if (event.type === "pointerdown" && options.current.contains(event.target)) return;
      if (event.type === "keydown") { event.preventDefault(); event.stopPropagation(); }
      options.current.open = false;
      if (event.type === "keydown") options.current.querySelector("summary")?.focus();
    }
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", dismiss, true);
    return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("keydown", dismiss, true); };
  }, []);
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
  const pendingScroll = useRef(null);
  useLayoutEffect(() => { if (pendingScroll.current && surface.current) { surface.current.scrollTo(pendingScroll.current.x, pendingScroll.current.y); pendingScroll.current = null; } }, [map]);
  const viewport = map.viewport || { x: 0, y: 0, zoom: 1 };
  const commit = (content) => onChange({ ...record, content });
  const selected = map.nodes.find((node) => node.id === selection[0]);
  const updateNode = (patch) => commit({ ...map, nodes: map.nodes.map((node) => selection.includes(node.id) ? { ...node, ...patch } : node) });
  const width = Math.max(1200, ...map.nodes.map((node) => node.x + node.width + 100));
  const height = Math.max(900, ...map.nodes.map((node) => node.y + node.height + 100));
  function begin(event, node) {
    if (event.button !== 0 || recall || connecting) return;
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
  function finish(event, cancelled = false) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    drag.current = null;
    for (const id of current.ids) {
      const element = surface.current.querySelector(`[data-node="${id}"]`);
      if (element) element.style.translate = "";
    }
    if (!cancelled && (current.dx || current.dy)) commit({ ...map, nodes: map.nodes.map((node) => current.ids.includes(node.id)
      ? { ...node, x: Math.max(0, Math.min(9000, node.x + current.dx)), y: Math.max(0, Math.min(9000, node.y + current.dy)) } : node) });
  }
  function connect(ids = selection) {
    if (ids.length !== 2) return;
    const next = linkIdeas(map, ids[0], ids[1], relationship, edgeStyle);
    if (next !== map) commit(next);
    setRelationship(""); setConnecting(""); setMultiSelect(false);
  }
  function createIdea(event) {
    event.preventDefault();
    const center = surface.current ? (surface.current.clientWidth / viewport.zoom - 190) / 2 : 60;
    const next = addIdea(map, draft, branch, center);
    if (next === map) return;
    const node = next.nodes.at(-1);
    pendingScroll.current = { x: Math.max(0, (node.x + node.width / 2) * viewport.zoom - surface.current.clientWidth / 2), y: Math.max(0, (node.y + node.height / 2) * viewport.zoom - surface.current.clientHeight / 2) };
    commit(next); setSelection([node.id]); setDraft(""); setBranch(""); setComposer(false); setEditing(false);
  }
  function fit() {
    if (!surface.current) return;
    const next = fitIdeas(map.nodes, surface.current.clientWidth, surface.current.clientHeight);
    pendingScroll.current = next; commit({ ...map, viewport: next });
  }
  const byId = new Map(map.nodes.map((node) => [node.id, node]));
  const hidden = (id) => recall && !revealed && (!selection.length || selection.includes(id));
  return <section className="knowledge-map">
    <div className="map-simple-actions">
      <button type="button" className="map-primary" aria-label={t("knowledge.addNode")} title={t("knowledge.addNode")} disabled={recall || map.nodes.length >= 300} onClick={() => { setComposer(!composer); setBranch(""); setConnecting(""); }}><Plus size={20} /></button>
      <button type="button" aria-label={t("knowledge.fitMap")} title={t("knowledge.fitMap")} disabled={!map.nodes.length} onClick={fit}><Maximize2 size={20} /></button>
      {recall && <button type="button" onClick={() => setRevealed(!revealed)}>{t(revealed ? "knowledge.hide" : "knowledge.reveal")}</button>}
    </div>
    {composer && !recall && <form className="map-composer" onSubmit={createIdea}>
      <label><span className="knowledge-visually-hidden">{t("knowledge.newIdea")}</span><input dir="auto" value={draft} onChange={event => setDraft(event.target.value)} maxLength={2000} placeholder={t("knowledge.newIdea")} /></label>
      <button type="submit" className="map-primary" disabled={!draft.trim()} aria-label={t(branch ? "knowledge.addBranch" : "knowledge.addNode")}><Check size={20} /></button>
      <button type="button" aria-label={t("common.cancel")} onClick={() => { setComposer(false); setBranch(""); }}><X size={20} /></button>
    </form>}
    {selected && !recall && <div className="map-context">
      {editing && <label><span className="knowledge-visually-hidden">{t("knowledge.nodeText")}</span><input dir="auto" value={selected.text} maxLength={2000} onChange={event => updateNode({ text: event.target.value })} /></label>}
      <div className="map-context-buttons">
        <button type="button" aria-label={t("knowledge.editIdea")} aria-pressed={editing} onClick={() => setEditing(!editing)}><Pencil size={18} /></button>
        <button type="button" aria-label={t("knowledge.addBranch")} disabled={map.nodes.length >= 300 || map.edges.length >= 600} onClick={() => { setBranch(selected.id); setComposer(true); setConnecting(""); }}><GitBranch size={18} /></button>
        <button type="button" aria-label={t("knowledge.linkIdea")} aria-pressed={Boolean(connecting)} disabled={map.nodes.length < 2 || map.edges.length >= 600} onClick={() => { setConnecting(connecting ? "" : selected.id); setComposer(false); }}><Link2 size={18} /></button>
        <button type="button" aria-label={t("common.delete")} className="knowledge-danger" onClick={() => { commit(removeMapNodes(map, selection)); setSelection([]); setEditing(false); setConnecting(""); }}><Trash2 size={18} /></button>
      </div>
    </div>}
    {connecting && !recall && <label><span className="knowledge-visually-hidden">{t("knowledge.relationship")}</span><input placeholder={t("knowledge.relationship")} value={relationship} onChange={event => setRelationship(event.target.value)} maxLength={500} /></label>}
    <p className="knowledge-visually-hidden" role="status">{t(connecting ? "knowledge.tapToConnect" : "knowledge.mapHint")}</p>
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
            {map.edges.map((edge) => {
              const from = byId.get(edge.from), to = byId.get(edge.to);
              if (!from || !to) return null;
              const line = curvedConnection(from, to);
              const label = recall && !revealed ? "…" : edge.label;
              return <g key={edge.id} className={`map-connection${selection.includes(edge.from) || selection.includes(edge.to) ? " is-active" : ""}`}><path data-edge={edge.id} d={line.path} fill="none" stroke="currentColor" strokeWidth="1.6" strokeDasharray={edge.style === "dashed" ? "5 5" : undefined} /><circle cx={line.to.x} cy={line.to.y} r="3" fill="currentColor" />{label && <text x={line.label.x} y={line.label.y - 8} textAnchor="middle">{label}</text>}</g>;

            })}
          </svg>
          {map.nodes.map((node) => <button type="button" data-node={node.id} key={node.id} dir="auto"
            className={`knowledge-map-node is-${node.shape}${selection.includes(node.id) ? " is-selected" : ""}`}
            style={nodePositionStyle(node)}
            aria-label={hidden(node.id) ? t("knowledge.hiddenConcept") : node.text || t("knowledge.newConcept")} aria-pressed={selection.includes(node.id)}
            onPointerDown={(event) => begin(event, node)} onPointerMove={move} onPointerUp={finish} onPointerCancel={(event) => finish(event, true)}
            onClick={(event) => { if (connecting && !recall) { if (node.id !== connecting) { connect([connecting, node.id]); setSelection([node.id]); } } else if (event.detail === 0) setSelection(event.shiftKey || multiSelect ? [...new Set([...selection, node.id])] : [node.id]); }}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c") { event.preventDefault(); setClipboard(copyMapSelection(map, selection)); return; }
              if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v" && clipboard.nodes.length && !recall && map.nodes.length + clipboard.nodes.length <= 300 && map.edges.length + clipboard.edges.length <= 600) { event.preventDefault(); commit(pasteMapSelection(map, clipboard)); return; }
              const delta = { ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowUp: [0, -10], ArrowDown: [0, 10] }[event.key];
              if (delta && !recall) {
                event.preventDefault();
                commit({ ...map, nodes: map.nodes.map((item) => item.id === node.id ? { ...item, x: Math.max(0, Math.min(9000, item.x + delta[0])), y: Math.max(0, Math.min(9000, item.y + delta[1])) } : item) });
              }
            }}><span className="map-dot" aria-hidden="true" /><span>{hidden(node.id) ? "…" : node.text || t("knowledge.newConcept")}</span></button>)}
        </div>
      </div>
    </div>
    <details ref={options} className="map-options"><summary aria-label={t("knowledge.mapOptions")} title={t("knowledge.mapOptions")}><MoreHorizontal size={20} /></summary><div className="map-options-body">
      <div className="knowledge-toolbar">
      <button type="button" disabled={!selection.length || recall} onClick={() => commit(removeMapNodes(map, selection))}>{t("common.delete")}</button>
      <button type="button" disabled={!selection.length} onClick={() => setClipboard(copyMapSelection(map, selection))}>{t("knowledge.copy")}</button>
      <button type="button" disabled={!clipboard.nodes.length || recall || map.nodes.length + clipboard.nodes.length > 300 || map.edges.length + clipboard.edges.length > 600} onClick={() => commit(pasteMapSelection(map, clipboard))}>{t("knowledge.paste")}</button>
      <label className="knowledge-concept-check"><input type="checkbox" checked={multiSelect} onChange={(event) => setMultiSelect(event.target.checked)} />{t("knowledge.multiSelect")}</label>
      <button type="button" disabled={recall} onClick={() => commit(arrangeMap(map))}>{t("knowledge.arrange")}</button>
      <button type="button" aria-pressed={recall} onClick={() => { setRecall(!recall); setRevealed(false); }}>{t("knowledge.recall")}</button>
      <label>{t("knowledge.zoom")}<input type="range" min=".25" max="2" step=".05" value={viewport.zoom} onChange={(event) => commit({ ...map, viewport: { ...viewport, zoom: Number(event.target.value) } })} /></label>
      </div>
      <details><summary>{t("knowledge.appearanceMenu")}</summary>
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
      </details>
    {selection.length === 2 && !recall && <div className="knowledge-toolbar">
      <label>{t("knowledge.relationship")}<input value={relationship} maxLength={500} onChange={(event) => setRelationship(event.target.value)} /></label>
      <label>{t("knowledge.lineStyle")}<select value={edgeStyle} onChange={(event) => setEdgeStyle(event.target.value)}><option value="solid">{t("knowledge.solid")}</option><option value="dashed">{t("knowledge.dashed")}</option></select></label>
      <button type="button" onClick={() => connect()}>{t("knowledge.connect")}</button>
    </div>}
    <details><summary>{t("knowledge.relationships")} · {map.edges.length}</summary><ul className="knowledge-edge-list">{map.edges.map((edge) => <li key={edge.id}><span dir="auto">{recall && !revealed ? t("knowledge.hiddenConcept") : `${byId.get(edge.from)?.text} → ${byId.get(edge.to)?.text}: ${edge.label}`}</span>{!recall && byId.get(edge.from)?.concept_id && byId.get(edge.to)?.concept_id && questions.some((question) => [byId.get(edge.from).concept_id, byId.get(edge.to).concept_id].every((id) => (question.concept_ids || [question.concept_id]).includes(id))) && <button type="button" onClick={() => onExplain([byId.get(edge.from).concept_id, byId.get(edge.to).concept_id])}>{t("knowledge.explainRelationship")}</button>}{!recall && <button type="button" aria-label={t("knowledge.deleteRelationship")} onClick={() => commit({ ...map, edges: map.edges.filter((item) => item.id !== edge.id) })}>{t("common.delete")}</button>}</li>)}</ul></details>
      </div></details>
  </section>;
}
