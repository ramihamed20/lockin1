import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useI18n } from "../../components/I18nProvider.jsx";
import { ConfirmDialog } from "../../components/shared/ConfirmDialog.jsx";
import { useKnowledgeWorkspace } from "./useKnowledgeWorkspace.js";
import { addMapNode } from "./model.js";
import { downloadKnowledge, printNotebook } from "./export.js";
import "./knowledge.css";

const SummaryEditor = lazy(() => import("./SummaryEditor.jsx"));
const MapEditor = lazy(() => import("./MapEditor.jsx"));
const ExplainEditor = lazy(() => import("./ExplainEditor.jsx"));

export default function KnowledgeWorkspace({ userId, documentId, title, page, pageLimit, visible, onClose, onRead, onSaveState, navigation }) {
  const { t, locale } = useI18n();
  const workspace = useKnowledgeWorkspace(userId, documentId);
  useEffect(() => { onSaveState(workspace.status); }, [onSaveState, workspace.status]);
  const flags = workspace.bootstrap?.tools || {};
  const requestedTool = workspace.ui?.tool || "summary";
  const tool = requestedTool === "knowledge" || flags[requestedTool] ? requestedTool : ["summary", "map", "explain"].find((key) => flags[key]) || "knowledge";
  const setTool = (value) => workspace.editUI({ tool: value });
  const activeIds = workspace.ui?.activeIds || {};
  const setActiveIds = (updater) => workspace.editUI({ activeIds: updater(activeIds) });
  const explanationDrafts = workspace.ui?.explanationDrafts || {};
  const conceptId = workspace.ui?.explainState?.conceptIds || [];
  const setConceptId = (ids) => workspace.editUI({ explainState: { ...(workspace.ui?.explainState || {}), conceptIds: Array.isArray(ids) ? ids : ids ? [ids] : [] } });
  const handledNavigation = useRef("");
  useEffect(() => {
    if (!navigation || handledNavigation.current === navigation.requestId || workspace.loading || !workspace.bootstrap) return;
    handledNavigation.current = navigation.requestId;
    if (navigation.tool === "summary" || navigation.tool === "map" || navigation.tool === "explain" && !navigation.question_id) {
      if (!{ summary: flags.summary, map: flags.map, explain: flags.explain }[navigation.tool]) { setMessage("knowledge.lockedSource"); return; }
      workspace.editUI({ tool: navigation.tool });
      return;
    }
    const question = workspace.bootstrap.questions?.find((item) => item.id === navigation.question_id);
    if (!question || !flags.explain || question.page_end > pageLimit) { setMessage("knowledge.mcq_unprepared"); return; }
    workspace.editUI({ tool: "explain", explainState: { ...(workspace.ui?.explainState || {}), selected: question.id, difficulty: question.difficulty, conceptIds: question.concept_ids || [question.concept_id] } });
  }, [navigation, workspace, flags.summary, flags.map, flags.explain, pageLimit]);
  /** @typedef {{text: string, conceptIds?: string[], source?: {source_version_id?: string, source_file_id?: string, page_start?: number}}} FeedbackInsert */
  const [insert, setInsert] = useState(/** @type {FeedbackInsert | null} */ (null));
  const [mapFocus, setMapFocus] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [discarding, setDiscarding] = useState(false);
  const [message, setMessage] = useState("");
  const [exporting, setExporting] = useState(false);
  const [mobile, setMobile] = useState(() => window.matchMedia("(max-width: 999px)").matches);
  const panel = useRef(null);
  const keyHandler = useRef(null);
  const wasVisible = useRef(false);
  useEffect(() => {
    const element = panel.current;
    const handle = (event) => keyHandler.current?.(event);
    element?.addEventListener("keydown", handle);
    return () => element?.removeEventListener("keydown", handle);
  }, []);
  const history = useRef(new Map());
  const redo = useRef(new Map());
  const source = workspace.bootstrap?.source;
  const concepts = (workspace.bootstrap?.concepts || []).filter((item) => item.page_end <= pageLimit);
  const current = workspace.records.filter((record) => record.kind === tool && !record.deleted);
  const record = current.find((item) => item.id === activeIds[tool]) || current[0];
  const loadDocument = workspace.loadDocument;
  useEffect(() => {
    if (record && !record.content) void loadDocument(record.id, record.revision);
  }, [record, loadDocument]);
  const stale = record && source && (record.document_id !== source.document_id
    || record.source_version_id !== source.source_version_id || record.source_file_id !== source.source_file_id);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 999px)");
    const change = () => setMobile(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    const body = panel.current?.closest(".workspace-v2")?.querySelector(".workspace-v2-body");
    if (body) body.inert = visible && mobile;
    if (visible && !wasVisible.current) panel.current?.querySelector("h2")?.focus();
    wasVisible.current = visible;
    return () => { if (body) body.inert = false; };
  }, [mobile, visible]);
  function close() {
    const body = panel.current?.closest(".workspace-v2")?.querySelector(".workspace-v2-body");
    if (body) body.inert = false;
    onClose();
    panel.current?.closest(".workspace-v2")?.querySelector("[data-workspace-surface=\"study\"]")?.focus();
  }
  async function exportWork(pdf) {
    const popup = pdf ? window.open("", "_blank", "popup") : null;
    if (pdf && !popup) { setMessage("knowledge.printBlocked"); return; }
    if (popup) popup.opener = null;
    setExporting(true);
    try {
      const records = await workspace.exportRecords(workspace.records);
      if (pdf) printNotebook(records, title, popup, { university: t("focus.universityEdition"), lockin: t("focus.lockinEdition"), version: t("knowledge.version") });
      else downloadKnowledge(records, { source, ui: workspace.ui, attempts: workspace.attempts });
    } catch { popup?.close(); setMessage("knowledge.exportFailed"); }
    finally { setExporting(false); }
  }
  function edit(next) {
    const previous = workspace.records.find((item) => item.id === next.id);
    if (previous) history.current.set(next.id, [...(history.current.get(next.id) || []).slice(-9), previous]);
    redo.current.delete(next.id);
    workspace.edit(next);
  }
  function step(back) {
    if (!record) return;
    const from = back ? history : redo, to = back ? redo : history;
    const stack = from.current.get(record.id) || [];
    const previous = stack[stack.length - 1];
    if (!previous) return;
    from.current.set(record.id, stack.slice(0, -1));
    to.current.set(record.id, [...(to.current.get(record.id) || []).slice(-9), record]);
    workspace.edit({ ...previous, revision: record.revision });
  }
  function create(kind = tool, sourcePage = page) {
    const created = workspace.create(kind, sourcePage);
    if (created) setActiveIds((old) => ({ ...old, [kind]: created.id }));
    return created;
  }
  async function openConceptDocument(item, concept) {
    try {
      let target = item;
      if (!target.content) [target] = await workspace.exportRecords([target]);
      target = workspace.latestRecord(target.id)?.content ? workspace.latestRecord(target.id) : target;
      setTool(target.kind); setActiveIds((old) => ({ ...old, [target.kind]: target.id }));
      if (target.kind === "map") {
        const node = target.content.nodes.find((candidate) => candidate.concept_id === concept.id);
        if (node) {
          workspace.editUI({ mapSelections: { ...(workspace.ui?.mapSelections || {}), [target.id]: [node.id] } });
          setMapFocus({ documentId: target.id, nodeId: node.id, requestId: globalThis.crypto.randomUUID() });
        }
      }
    } catch { setMessage("knowledge.load_error"); }
  }
  async function toMap(text) {
    if (!flags.map || stale) { setMessage("knowledge.staleSource"); return; }
    try {
      let target = workspace.records.find((item) => item.id === activeIds.map && !item.deleted);
      if (target && (target.source_version_id !== source.source_version_id || target.source_file_id !== source.source_file_id || target.document_id !== source.document_id)) target = null;
      if (target && !target.content) [target] = await workspace.exportRecords([target]);
      if (target && workspace.latestRecord(target.id)?.content) target = workspace.latestRecord(target.id);
      if (!target) target = create("map", record.page_start);
      if (!target || target.content.nodes.length >= 300) return;
      const linked = record.content.concept_ids || [];
      const next = { ...target, page_end: Math.max(target.page_end, record.page_end), content: addMapNode(target.content, text, linked.length === 1 ? linked[0] : "") };
      edit(next); setActiveIds((old) => ({ ...old, map: target.id })); setTool("map");
    } catch { setMessage("knowledge.load_error"); }
  }
  async function saveFeedback() {
    if (!insert) return;
    if ((insert.source?.source_version_id && insert.source.source_version_id !== source.source_version_id)
      || (insert.source?.source_file_id && insert.source.source_file_id !== source.source_file_id)) {
      setMessage("knowledge.staleSource"); setInsert(null); return;
    }
    try {
      let target = workspace.records.find((item) => item.id === activeIds.summary && !item.deleted);
      if (target && (target.source_version_id !== source.source_version_id || target.source_file_id !== source.source_file_id || target.document_id !== source.document_id)) target = null;
      if (target && !target.content) [target] = await workspace.exportRecords([target]);
      if (target && workspace.latestRecord(target.id)?.content) target = workspace.latestRecord(target.id);
      if (!target) target = create("summary", insert.source?.page_start || page);
      const linked = (insert.conceptIds || []).filter((id) => concepts.some((concept) => concept.id === id));
      if (target) edit({ ...target, content: { ...target.content,
        concept_ids: [...new Set([...(target.content.concept_ids || []), ...linked])],
        suggestions: [...(target.content.suggestions || []), insert.text].slice(-100),
      } });
      setInsert(null); setTool("summary");
    } catch { setMessage("knowledge.load_error"); setInsert(null); }
  }
  const read = (target) => {
    if (!target || target > pageLimit) { setMessage("knowledge.lockedSource"); return; }
    onRead(target);
    if (mobile) close();
  };
  function keyDown(event) {
    if (event.target.closest?.(".confirm-backdrop")) return;
    if (event.key === "Escape") { event.stopPropagation(); close(); return; }
    if (record && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z" && !["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName)) { event.preventDefault(); event.stopPropagation(); step(!event.shiftKey); return; }
    if (mobile && event.key === "Tab") {
      const focusable = [...panel.current.querySelectorAll("button, input, select, textarea, a[href], [tabindex='0']")].filter((element) => !element.disabled && element.getClientRects().length);
      if (event.shiftKey && (document.activeElement === focusable[0] || document.activeElement === panel.current.querySelector("h2"))) { event.preventDefault(); focusable[focusable.length - 1]?.focus(); }
      else if (!event.shiftKey && document.activeElement === focusable[focusable.length - 1]) { event.preventDefault(); focusable[0]?.focus(); }
    }
  }
  keyHandler.current = keyDown;
  return <div className="knowledge-panel" ref={panel} hidden={!visible} role="dialog" tabIndex={-1} aria-modal={mobile ? "true" : undefined} aria-label={t("knowledge.tools")}>
    <header className="knowledge-panel-header"><div><h2 tabIndex={-1}>{t("knowledge.tools")}</h2><p dir="auto">{title} · {t("knowledge.page", { page })}</p></div><button type="button" onClick={close}>{t("common.close")}</button></header>
    {visible && (workspace.loading ? <p role="status">{t("common.loading")}</p> : !workspace.bootstrap?.enabled ? <p role="status">{t(workspace.error ? "knowledge.load_error" : "knowledge.disabled")}{workspace.error && <button type="button" onClick={workspace.refresh}>{t("common.tryAgain")}</button>}</p> : <>
      <nav className="knowledge-nav" aria-label={t("knowledge.tools")}>
        {["summary", "map", "explain", "knowledge"].filter((key) => key === "knowledge" || flags[key]).map((key) => <button key={key} type="button" aria-pressed={tool === key} onClick={() => { setTool(key); setConceptId(""); }}>{t(`knowledge.${key}`)}</button>)}
      </nav>
      <div className="knowledge-save" role="status">{t(`knowledge.status_${workspace.status}`)}<button type="button" onClick={() => { void workspace.sync(); }}>{t("knowledge.sync")}</button></div>
      {workspace.error && <p role="alert">{t(`knowledge.${workspace.error}`)} {workspace.error === "load_error" && <button type="button" onClick={workspace.refresh}>{t("common.tryAgain")}</button>}</p>}
      {workspace.status === "unsaved" && <div className="knowledge-toolbar"><button type="button" onClick={() => downloadKnowledge(workspace.records.filter((item) => item.content), { source, ui: workspace.ui, attempts: workspace.attempts })}>{t("knowledge.exportUnsaved")}</button><button type="button" onClick={() => setDiscarding(true)}>{t("knowledge.discardUnsaved")}</button></div>}
      {message && <p role="status">{t(message)}</p>}
      {(tool === "summary" || tool === "map") && <>
        {current.length === 0 ? <div className="knowledge-start"><p className="knowledge-empty">{t("knowledge.emptyNotebook")}</p><button type="button" className="knowledge-start-button" disabled={workspace.status === "unsaved"} onClick={() => create()}>{t(tool === "map" ? "knowledge.startMap" : "knowledge.startSummary")}</button></div> : <div className="knowledge-toolbar">{current.length > 1 && <label>{t("knowledge.notebook")}<select value={record?.id || ""} onChange={(event) => setActiveIds((old) => ({ ...old, [tool]: event.target.value }))}><option value="" disabled>{t("knowledge.chooseDocument")}</option>{current.map((item) => <option value={item.id} key={item.id}>{item.title || t(`knowledge.${item.kind}`)} · {item.page_start}–{item.page_end}</option>)}</select></label>}<button type="button" disabled={workspace.status === "unsaved"} onClick={() => create()}>{t("knowledge.newDocument")}</button></div>}
        {record && !record.content ? <p role="status">{t("common.loading")}</p> : record ? <>
          {(workspace.status === "conflict" || workspace.error === "local_conflict") && !stale && <button type="button" onClick={async () => { try { const copy = await workspace.saveCopy(record, t("knowledge.copyTitle", { title: record.title || t(`knowledge.${record.kind}`) })); setActiveIds((old) => ({ ...old, [record.kind]: copy.id })); } catch { setMessage("knowledge.exportFailed"); } }}>{t("knowledge.keepBoth")}</button>}
          {stale && <p className="knowledge-warning" role="status">{t("knowledge.staleSource")}</p>}
          <label>{t("knowledge.title")}<input dir="auto" value={record.title} maxLength={220} onChange={(event) => edit({ ...record, title: event.target.value })} /></label>
          <div className="knowledge-toolbar"><button type="button" disabled={!history.current.get(record.id)?.length} onClick={() => step(true)}>{t("knowledge.undo")}</button><button type="button" onClick={() => downloadKnowledge([record])}>{t("knowledge.exportCurrent")}</button><button type="button" disabled={!redo.current.get(record.id)?.length} onClick={() => step(false)}>{t("knowledge.redo")}</button><button type="button" disabled={stale} onClick={() => read(record.page_start)}>{t("knowledge.readSource")}</button></div>
          <details className="knowledge-document-options"><summary>{t("knowledge.documentOptions")}</summary>
          <div className="knowledge-toolbar">
            <label>{t("knowledge.fromPage")}<input type="number" min="1" max="10000" value={record.page_start} onChange={(event) => { const value = Math.max(1, Number(event.target.value)); edit({ ...record, page_start: value, page_end: Math.max(value, record.page_end) }); }} /></label>
            <label>{t("knowledge.toPage")}<input type="number" min={record.page_start} max="10000" value={record.page_end} onChange={(event) => edit({ ...record, page_end: Math.max(record.page_start, Number(event.target.value)) })} /></label>
            <button type="button" disabled={stale} onClick={() => read(record.page_start)}>{t("knowledge.readSource")}</button>
          </div>
          <div className="knowledge-toolbar"><button type="button" onClick={() => setDeleting(record)}>{t("common.delete")}</button><button type="button" disabled={exporting} onClick={() => { void exportWork(false); }}>{t("knowledge.exportData")}</button>{tool === "summary" && <button type="button" disabled={exporting} onClick={() => { void exportWork(true); }}>{t("knowledge.exportPdf")}</button>}</div>
          </details>
          <Suspense fallback={<p role="status">{t("common.loading")}</p>}>
            {tool === "summary" ? <SummaryEditor key={record.id} record={record} t={t} locale={locale} onChange={edit} onMap={toMap} /> : <MapEditor key={record.id} record={record} t={t} onChange={edit} focusNode={mapFocus?.documentId === record.id ? mapFocus : null} onFocused={() => setMapFocus(null)} selection={workspace.ui?.mapSelections?.[record.id] || []} onSelection={(ids) => workspace.editUI({ mapSelections: { ...(workspace.ui?.mapSelections || {}), [record.id]: ids } })} concepts={stale ? [] : concepts} questions={stale ? [] : (workspace.bootstrap.questions || []).filter((question) => question.page_end <= pageLimit)} onRead={stale ? () => setMessage("knowledge.staleSource") : read} onExplain={(id) => { setConceptId(id); setTool("explain"); }} />}
          </Suspense>
          {concepts.length > 0 && !stale && <details><summary>{t("knowledge.linkConcept")}</summary>{concepts.map((concept) => <label className="knowledge-concept-check" key={concept.id}><input type="checkbox" checked={(record.content.concept_ids || []).includes(concept.id)} onChange={(event) => edit({ ...record, content: { ...record.content, concept_ids: event.target.checked ? [...(record.content.concept_ids || []), concept.id] : record.content.concept_ids.filter((id) => id !== concept.id) } })} />{concept.title}</label>)}</details>}
        </> : null}
      </>}
      {tool === "explain" && <Suspense fallback={<p role="status">{t("common.loading")}</p>}><ExplainEditor uiState={workspace.ui?.explainState || {}} onState={(patch) => workspace.editUI({ explainState: { ...(workspace.ui?.explainState || {}), ...patch } })} questions={(workspace.bootstrap.questions || []).filter((question) => question.page_end <= pageLimit)} attempts={workspace.attempts} drafts={explanationDrafts} onDraft={(id, text) => workspace.editUI({ explanationDrafts: { ...explanationDrafts, [id]: text } })} onSubmit={workspace.submit} onSummary={setInsert} conceptId={conceptId} page={page} locale={locale} t={t} /></Suspense>}
      {tool === "knowledge" && <KnowledgeView concepts={concepts} records={workspace.records} questions={workspace.bootstrap.questions} t={t} onRead={read} onDocument={openConceptDocument} onExplain={(id) => { setConceptId(id); setTool("explain"); }} />}
      <ConfirmDialog confirmVariant="primary" open={Boolean(insert)} title={t("knowledge.addSummary")} message={t("knowledge.insertConfirm")} confirmLabel={t("knowledge.addSummary")} onCancel={() => setInsert(null)} onConfirm={saveFeedback} />
      <ConfirmDialog open={discarding} title={t("knowledge.discardUnsaved")} message={t("knowledge.discardConfirm")} confirmLabel={t("knowledge.discardUnsaved")} onCancel={() => setDiscarding(false)} onConfirm={async () => { await workspace.discardUnsaved(); setDiscarding(false); }} />
      <ConfirmDialog open={Boolean(deleting)} title={t("common.delete")} message={t("knowledge.deleteConfirm")} confirmLabel={t("common.delete")} onCancel={() => setDeleting(null)} onConfirm={() => { edit({ ...deleting, deleted: true }); setDeleting(null); }} />
    </>)}
  </div>;
}

function KnowledgeView({ concepts, records, questions, t, onRead, onDocument, onExplain }) {
  return <section><h3>{t("knowledge.knowledge")}</h3><p className="knowledge-hint">{t("knowledge.evidenceHint")}</p>
    {!concepts.length && <p>{t("knowledge.noConcepts")}</p>}
    <ul className="knowledge-concept-list">{concepts.map((concept) => {
      const related = records.filter((item) => !item.deleted && ((item.content?.concept_ids || item.linked_concept_ids || []).includes(concept.id) || item.content?.nodes?.some((node) => node.concept_id === concept.id)));
      return <li key={concept.id}><strong dir="auto">{concept.title}</strong><p>{t(`knowledge.evidence_${concept.status}`)}{concept.self_reported && ` · ${t("knowledge.selfReported")}`}</p>
        {concept.status === "needs_review" && <p>{t("knowledge.reviewSuggestion")}</p>}
        <div className="knowledge-toolbar"><button type="button" onClick={() => onRead(concept.page_start)}>{t("knowledge.readSource")}</button>{related.map((item) => <button type="button" key={item.id} onClick={() => onDocument(item, concept)}>{item.title || t(`knowledge.${item.kind}`)}</button>)}{questions.some((item) => (item.concept_id === concept.id || item.concept_ids?.includes(concept.id))) && <button type="button" onClick={() => onExplain(concept.id)}>{t("knowledge.explainConcept")}</button>}</div>
      </li>;
    })}</ul>
    <Link to="/review">{t("knowledge.reviewBank")}</Link>
  </section>;
}
