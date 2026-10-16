import { lazy, Suspense, useRef, useState } from "react";
import { useDictation } from "./useDictation.js";
import { formatNotebookText } from "./model.js";

const DrawingPad = lazy(() => import("./DrawingPad.jsx"));

export function DictationControl({ onText, t, locale }) {
  const [language, setLanguage] = useState(locale);
  const voice = useDictation(onText, language);
  return <div className="knowledge-voice">
    <label>{t("knowledge.voiceLanguage")}<select value={language} onChange={(event) => setLanguage(event.target.value)} disabled={voice.status === "listening"}><option value="en">English</option><option value="ar">العربية</option></select></label>
    <button type="button" disabled={!voice.supported} aria-pressed={voice.status === "listening"} onClick={voice.toggle}>{t(voice.status === "listening" ? "knowledge.stopDictation" : "knowledge.dictate")}</button>
    <p role="status">{t(!voice.supported ? "knowledge.voiceUnsupported" : voice.status === "permission" ? "knowledge.voicePermission" : voice.status === "error" ? "knowledge.voiceError" : "knowledge.voicePrivacy")}</p>
  </div>;
}

export default function SummaryEditor({ record, onChange, onMap, t, locale }) {
  const input = useRef(null);
  const [mode, setMode] = useState("text");
  const change = (content) => onChange({ ...record, content: { ...record.content, ...content } });
  function format(type) {
    const editor = input.current;
    change({ text: formatNotebookText(record.content.text || "", editor.selectionStart, editor.selectionEnd, type) });
    editor.focus();
  }
  return <>
    <div className="knowledge-toolbar">
      <button type="button" aria-pressed={mode === "text"} onClick={() => setMode("text")}>{t("knowledge.type")}</button>
      <button type="button" aria-pressed={mode === "draw"} onClick={() => setMode("draw")}>{t("knowledge.draw")}</button>
      <label>{t("knowledge.paper")}<select value={record.content.paper} onChange={(event) => change({ paper: event.target.value })}>{["ruled", "blank", "grid", "dotted"].map((paper) => <option key={paper} value={paper}>{t(`knowledge.${paper}`)}</option>)}</select></label>
    </div>
    {mode === "text" ? <>
      <div className="knowledge-toolbar">
        {["heading", "bullet", "numbered", "bold", "italic"].map((type) => <button key={type} type="button" onClick={() => format(type)}>{t(`knowledge.${type}`)}</button>)}
        <button type="button" onClick={() => { const element = input.current; onMap(element.value.slice(element.selectionStart, element.selectionEnd) || element.value.slice(0, 2000)); }} disabled={!record.content.text?.trim()}>{t("knowledge.addMap")}</button>
      </div>
      <label className="knowledge-field">{t("knowledge.yourWords")}<textarea ref={input} rows={12} maxLength={100000} dir="auto" value={record.content.text || ""} onChange={(event) => change({ text: event.target.value })} placeholder={t("knowledge.summaryPrompt")} /></label>
      <DictationControl locale={locale} t={t} onText={(text) => change({ text: [record.content.text, text].filter(Boolean).join("\n") })} />
    </> : <Suspense fallback={<p role="status">{t("common.loading")}</p>}><DrawingPad strokes={record.content.strokes || []} paper={record.content.paper} t={t} onChange={(strokes) => change({ strokes })} /></Suspense>}
    {record.content.suggestions?.length > 0 && <section className="knowledge-feedback"><h3>{t("knowledge.savedFeedback")}</h3>{record.content.suggestions.map((text, index) => <p dir="auto" key={index}>{text}</p>)}</section>}
  </>;
}
