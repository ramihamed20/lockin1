import { useId, useRef, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { comparisonDraft } from "./learningModel.js";
import { strokeCenterlinePath } from "../ink/strokeModel.js";

export function RecallPractice({ record, onChange, onClose, t }) {
  const practice = record.content.recall || { answer: "", reflection: "", revealed: false };
  const input = useRef(null);
  useEffect(() => { input.current?.focus(); }, []);
  const change = patch => onChange({ ...record, content: { ...record.content, recall: { ...practice, ...patch } } });
  return <section className="connected-practice" aria-label={t("connected.recall")}>
    <header><div><small>{t(practice.revealed ? "connected.compareStep" : "connected.recallStep")}</small><h3>{t("connected.recall")}</h3></div><button type="button" onClick={onClose}>{t("connected.back")}</button></header>
    <label className="knowledge-field">{t("connected.fromMemory")}<textarea ref={input} dir="auto" rows={6} maxLength={10000} value={practice.answer} onChange={event => change({ answer: event.target.value })} /></label>
    {!practice.revealed ? <button type="button" disabled={!practice.answer.trim()} onClick={() => change({ revealed: true })}>{t("connected.reveal")}</button> : <>
      <details open><summary>{t("connected.original")}</summary>{record.kind === "summary" ? <><p className="connected-original" dir="auto">{record.content.text}</p>{!!record.content.strokes?.length && <svg viewBox="0 0 1000 1400" role="img" aria-label={t("connected.original")}>{record.content.strokes.map(stroke => <path key={stroke.id} d={strokeCenterlinePath(stroke.points.map(([x, y]) => ({ x, y })))} fill="none" stroke={stroke.color} strokeWidth={stroke.width} strokeLinecap="round" opacity={stroke.tool === "highlighter" ? 0.35 : 1} />)}</svg>}</> : <ul>{record.content.nodes.map(node => <li key={node.id} dir="auto"><strong>{node.text}</strong><ul>{record.content.edges.filter(edge => edge.from === node.id).map(edge => <li key={edge.id}>{edge.label} → {record.content.nodes.find(other => other.id === edge.to)?.text}</li>)}</ul></li>)}</ul>}</details>
      <label className="knowledge-field">{t("connected.reflection")}<textarea dir="auto" rows={3} maxLength={10000} value={practice.reflection} onChange={event => change({ reflection: event.target.value })} /></label>
      <p className="knowledge-hint">{t("connected.selfOnly")}</p><button type="button" onClick={() => { change({ answer: "", reflection: "", revealed: false }); input.current?.focus(); }}>{t("connected.again")}</button>
    </>}
  </section>;
}

export function ConceptComparison({ concepts, onCreate, disabled, t }) {
  const id = useId();
  const [ids, setIds] = useState(["", ""]);
  const selected = ids.map(value => concepts.find(item => item.id === value)).filter(Boolean);
  const draft = comparisonDraft(selected, t);
  return concepts.length < 2 ? null : <details className="connected-practice"><summary>{t("connected.compareConcepts")}</summary><p>{t("connected.compareHint")}</p>
    {ids.map((value, index) => <div className="connected-choice" key={index}><label htmlFor={`${id}-${index}`}>{t(index ? "connected.secondConcept" : "connected.firstConcept")}</label><select id={`${id}-${index}`} value={value} onChange={event => setIds(old => old.map((current, position) => position === index ? event.target.value : current))}><option value="">{t("connected.choose")}</option>{concepts.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></div>)}
    <button type="button" disabled={!draft || disabled} onClick={() => onCreate(draft)}>{t("connected.createComparison")}</button>
  </details>;
}

export function LearningFlow({ questions, flags, page, pageLimit, onRead, onExplain, onWrite, t }) {
  const question = questions.find(item => item.page_start <= page && item.page_end >= page && item.page_end <= pageLimit);
  return <details className="connected-practice"><summary>{t("connected.next")}</summary><div className="knowledge-toolbar">
    {flags.explain && question && <button type="button" onClick={() => onExplain(question)}>{t("connected.tryExplain")}</button>}
    {flags.summary && <button type="button" onClick={onWrite}>{t("connected.write")}</button>}
    {page < pageLimit && <button type="button" onClick={() => onRead(page + 1)}>{t("connected.nextPage")}</button>}
    <Link to="/review">{t("knowledge.reviewBank")}</Link>
  </div></details>;
}
