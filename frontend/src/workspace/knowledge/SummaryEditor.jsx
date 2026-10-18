import { lazy, Suspense, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";
import { useDictation } from "./useDictation.js";
import { formatNotebookText, insertNotebookStarter, notebookWordCount } from "./model.js";

const DrawingPad = lazy(() => import("./DrawingPad.jsx"));

/** One microphone button; the language and the privacy note stay out of the way until needed. */
export function DictationControl({ onText, t, locale }) {
  const [language, setLanguage] = useState(locale);
  const voice = useDictation(onText, language);
  if (!voice.supported) return null;
  const listening = voice.status === "listening";
  const notice = voice.status === "permission" ? "knowledge.voicePermission" : voice.status === "error" ? "knowledge.voiceError" : listening ? "knowledge.voicePrivacy" : "";
  return <div className="knowledge-voice">
    <div className="knowledge-voice-row">
      <button type="button" className="knowledge-voice-button" aria-pressed={listening} onClick={voice.toggle}>{listening ? <Square size={16} aria-hidden="true" /> : <Mic size={16} aria-hidden="true" />}{t(listening ? "knowledge.stopDictation" : "knowledge.dictate")}</button>
      <label className="knowledge-voice-language"><span className="knowledge-visually-hidden">{t("knowledge.voiceLanguage")}</span><select value={language} onChange={(event) => setLanguage(event.target.value)} disabled={listening}><option value="en">English</option><option value="ar">العربية</option></select></label>
    </div>
    {notice && <p role="status" className="knowledge-voice-note">{t(notice)}</p>}
  </div>;
}

const FORMATS = [["heading", "H"], ["bullet", "•"], ["numbered", "1."], ["bold", "B"], ["italic", "I"]];
const STARTERS = ["mainIdea", "keyTerms", "examTip"];

export default function SummaryEditor({ record, onChange, onMap, t, locale, page = 1 }) {
  const input = useRef(null);
  const [mode, setMode] = useState("text");
  const change = (content) => onChange({ ...record, content: { ...record.content, ...content } });
  const text = record.content.text || "";
  function format(type) {
    const editor = input.current;
    change({ text: formatNotebookText(text, editor.selectionStart, editor.selectionEnd, type) });
    editor.focus();
  }
  function start(heading) {
    const next = insertNotebookStarter(text, heading);
    change({ text: next });
    // The cursor waits on the empty line under the new heading.
    requestAnimationFrame(() => { const editor = input.current; if (editor) { editor.focus(); editor.setSelectionRange(next.length, next.length); } });
  }
  const words = notebookWordCount(text);
  return <div className="knowledge-summary">
    <div className="knowledge-segmented" role="group" aria-label={t("knowledge.writeOrDraw")}>
      <button type="button" aria-pressed={mode === "text"} onClick={() => setMode("text")}>{t("knowledge.type")}</button>
      <button type="button" aria-pressed={mode === "draw"} onClick={() => setMode("draw")}>{t("knowledge.draw")}</button>
    </div>
    {mode === "text" ? <>
      <label className="knowledge-field" htmlFor={`summary-${record.id}`}>{t("knowledge.yourWords")}</label>
      <div className="knowledge-editor">
        <div className="knowledge-format-bar" role="toolbar" aria-label={t("knowledge.formatting")}>
          {FORMATS.map(([type, glyph]) => <button key={type} type="button" className={`is-${type}`} aria-label={t(`knowledge.${type}`)} title={t(`knowledge.${type}`)} onMouseDown={(event) => event.preventDefault()} onClick={() => format(type)}>{glyph}</button>)}
        </div>
        <textarea id={`summary-${record.id}`} ref={input} rows={10} maxLength={100000} dir="auto" value={text} onChange={(event) => change({ text: event.target.value })} placeholder={t("knowledge.summaryPrompt")} />
      </div>
      {!text.trim() && <div className="knowledge-starters">
        <span>{t("knowledge.startWith")}</span>
        {STARTERS.map((key) => <button key={key} type="button" onClick={() => start(t(`knowledge.starter_${key}`))}>{t(`knowledge.starter_${key}`)}</button>)}
        <button type="button" onClick={() => start(t("knowledge.starter_page", { page }))}>{t("knowledge.starter_page", { page })}</button>
      </div>}
      <div className="knowledge-editor-foot">
        <span className="knowledge-word-count" aria-live="polite">{t("knowledge.words", { count: words })}</span>
        <button type="button" onClick={() => { const element = input.current; onMap(element.value.slice(element.selectionStart, element.selectionEnd) || element.value.slice(0, 2000)); }} disabled={!text.trim()}>{t("knowledge.addMap")}</button>
      </div>
      <DictationControl locale={locale} t={t} onText={(spoken) => change({ text: [record.content.text, spoken].filter(Boolean).join("\n") })} />
    </> : <>
      <label className="knowledge-paper-choice">{t("knowledge.paper")}<select value={record.content.paper} onChange={(event) => change({ paper: event.target.value })}>{["ruled", "blank", "grid", "dotted"].map((paper) => <option key={paper} value={paper}>{t(`knowledge.${paper}`)}</option>)}</select></label>
      <Suspense fallback={<p role="status">{t("common.loading")}</p>}><DrawingPad strokes={record.content.strokes || []} paper={record.content.paper} t={t} onChange={(strokes) => change({ strokes })} /></Suspense>
    </>}
    {record.content.suggestions?.length > 0 && <section className="knowledge-feedback"><h3>{t("knowledge.savedFeedback")}</h3>{record.content.suggestions.map((item, index) => <p dir="auto" key={index}>{item}</p>)}</section>}
  </div>;
}
