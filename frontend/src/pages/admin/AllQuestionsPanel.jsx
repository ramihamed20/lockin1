import { useEffect, useRef, useState } from "react";
import { adminControlApi } from "../../api/adminControl.js";
import { useI18n } from "../../components/I18nProvider.jsx";
import { allQuestionsValidationToken, downloadAllQuestionsPrompt, readAllQuestionsFile } from "../../lib/allQuestionsImport.js";
import { AllQuestionsPreview } from "./AllQuestionsPreview.jsx";
import { LoadingPanel } from "../../components/ui/index.jsx";
import { useAsyncData, useDebouncedValue } from "../../hooks/useAsyncData.js";
import { allQuestionsTotals, buildAllQuestionsPrompt, existingQuestionSets, normalizeSheetQuestionCount, parseAllQuestionsJson } from "../../lib/allQuestionsPrompt.js";
import { copyTextToClipboard } from "../../lib/clipboard.js";
import { Icon } from "../../lib/icons.jsx";
import { ExclusionField } from "./ExclusionField.jsx";

const EDITIONS = [
  ["university", "University Sheet"],
  ["lockin", "Lockin Sheet"]
];

// Hundreds of errors are possible on a broken paste; the first ones are actionable.
const SHOWN_ERRORS = 50;

/** A typed excluded-page count, or null while the box is blank or invalid (keep the saved one). */
function pageCount(value) {
  const raw = String(value ?? "").trim();
  if (raw === "") return null;
  const number = Number(raw);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function Mark({ ok }) {
  return <><Icon name={ok ? "check" : "alert-triangle"} size={14} /><span className="visually-hidden">{ok ? "Complete" : "Needs fixing"}</span></>;
}

function ValidationSummary({ body }) {
  const { t } = useI18n();
  const summary = body.summary;
  const hidden = Math.max(0, (body.error_count || 0) - SHOWN_ERRORS);
  return <>
    <div className="admin-all-questions-summary">
      {summary.difficulties.map((row) => <div key={row.difficulty} className={row.ok ? "is-ok" : "is-error"}>
        <h5><Mark ok={row.ok} />{row.label}</h5>
        <details open={!row.ok}><summary>{t("allQuestions.readyGroups")}</summary><ul>
          {row.parts.map((part) => <li key={part.part} className={part.ok ? "is-ok" : "is-error"}><Mark ok={part.ok} />{row.question_format === "pages" ? "Page" : "Part"} {part.part} — {part.received}/{part.expected}<small>Pages {part.start_page}–{part.end_page}</small></li>)}
          <li className={row.final_exam.ok ? "is-ok" : "is-error"}><Mark ok={row.final_exam.ok} />Final Exam — {row.final_exam.received}/{row.final_exam.expected}</li>
        </ul></details>
        <p>{row.question_format === "pages" ? "Pages" : "Parts"}: {row.part_questions_received} Questions · Final: {row.final_exam.received} Questions</p>
      </div>)}
      <div className={summary.sheet_questions.ok ? "is-ok" : "is-error"}>
        <h5><Mark ok={summary.sheet_questions.ok} />Normal Questions</h5>
        <p>{summary.sheet_questions.received}/{summary.sheet_questions.expected} Questions</p>
      </div>
    </div>
    <p className="admin-all-questions-total"><strong>Total: {summary.total_received} / {summary.total_expected} Questions</strong></p>
    {!body.valid && <ol className="admin-all-questions-errors">
      {body.errors.slice(0, SHOWN_ERRORS).map((item, index) => <li key={`${item.path}-${index}`}><strong>{item.section}</strong><span>{item.message}</span><code>{item.path}</code></li>)}
    </ol>}
    {!body.valid && hidden > 0 && <p className="admin-all-questions-more">…and {hidden} more. Fix these and validate again.</p>}
  </>;
}

/**
 * All Questions: one prompt and one JSON for every question bank of a sheet.
 *
 * An orchestration screen only. The plan comes from the backend's Active Study
 * planner for the chosen edition and exclusions; validation and the atomic
 * save are the backend's, which writes through the existing Active Study and
 * Question import paths. The JSON box is uncontrolled so a paste of several
 * hundred questions is not re-rendered on every keystroke.
 */
export function AllQuestionsPanel({ sheet, canManageQuestions = true, onSaved = () => {} }) {
  const { t } = useI18n();
  const [examStyle, setExamStyle] = useState("");
  const [loadedFile, setLoadedFile] = useState("");
  const fileRead = useRef(0);
  useEffect(() => () => { fileRead.current += 1; }, [sheet.id]);
  const editionRows = Array.isArray(sheet.editions) ? sheet.editions : [];
  const [edition, setEdition] = useState("university");
  // null until the edition's saved exclusions load; then what the admin types.
  const [exclusions, setExclusions] = useState(null);
  const [count, setCount] = useState(canManageQuestions ? "30" : "0");
  const [publish, setPublish] = useState(true);
  const [textVersion, setTextVersion] = useState(0);
  const [result, setResult] = useState(null);
  const [pending, setPending] = useState("");
  const [error, setError] = useState(null);
  const [message, setMessage] = useState("");
  const [showPrompt, setShowPrompt] = useState(false);
  const textRef = useRef(null);
  const promptRef = useRef(null);

  const typed = JSON.stringify({ start: exclusions ? pageCount(exclusions.start) : null, end: exclusions ? pageCount(exclusions.end) : null });
  const requested = useDebouncedValue(typed, 250);
  const context = useAsyncData(() => {
    const { start, end } = JSON.parse(requested);
    return adminControlApi.allQuestionsContext(sheet.id, edition, { excluded_start_pages: start, excluded_end_pages: end });
  }, [sheet.id, edition, requested], { keepPreviousData: true });
  // Never show one edition's plan under the other's name while it reloads.
  const ctx = context.data?.edition === edition ? context.data : null;
  const settled = Boolean(ctx) && requested === typed && !context.loading && !context.refreshing && !context.error;

  useEffect(() => {
    if (ctx && exclusions === null) setExclusions({ start: ctx.excluded_start_pages, end: ctx.excluded_end_pages });
  }, [ctx, exclusions]);
  useEffect(() => { if (showPrompt && promptRef.current) { promptRef.current.focus(); promptRef.current.select(); } }, [showPrompt]);

  const maxCount = ctx?.sheet_questions?.max_count ?? 200;
  const normal = canManageQuestions ? normalizeSheetQuestionCount(count, maxCount) : 0;
  const totals = ctx ? allQuestionsTotals(ctx, normal) : null;
  const existing = ctx ? existingQuestionSets(ctx) : { replaced: [], normalExisting: 0, normalAllQuestions: 0, normalOther: 0 };
  let prompt = ""; let promptError = "";
  if (ctx) { try { prompt = buildAllQuestionsPrompt(ctx, normal, { examStyle }); } catch (buildError) { promptError = buildError instanceof Error ? buildError.message : "The All Questions plan is invalid."; } }
  // Everything a validation result depends on; any change requires validating again.
  const token = allQuestionsValidationToken(ctx, textVersion, normal);
  const pageBank = Boolean(ctx?.difficulties?.every((row) => row.question_format === "pages"));
  const body = result?.body || null;
  const stale = Boolean(result) && result.token !== token;

  function changeEdition(next) {
    setEdition(next); setExclusions(null); setResult(null); setError(null); setMessage("");
  }
  function changeExclusion(key, value) { setExclusions((current) => ({ ...current, [key]: value })); }
  function boundaries() { return { excluded_start_pages: ctx.excluded_start_pages, excluded_end_pages: ctx.excluded_end_pages }; }

  async function copy() {
    if (!prompt || !settled) return;
    const copied = await copyTextToClipboard(prompt);
    setError(null);
    setMessage(copied ? "All Questions prompt copied. Send it to the AI together with the sheet PDF." : "Your browser blocked the clipboard. The prompt is selected below — press Ctrl+C.");
    if (!copied) setShowPrompt(true);
  }


  async function uploadFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const currentRead = ++fileRead.current;
    setPending("file"); setError(null); setMessage("");
    try {
      const text = await readAllQuestionsFile(file);
      parseAllQuestionsJson(text);
      if (currentRead !== fileRead.current) return;
      if (textRef.current) textRef.current.value = text;
      setTextVersion((value) => value + 1);
      setResult(null); setLoadedFile(file.name);
      setMessage(t("allQuestions.loaded", { name: file.name }));
    } catch (error) {
      if (currentRead === fileRead.current) setError(error instanceof Error ? error : new Error(t("allQuestions.fileError")));
    } finally { if (currentRead === fileRead.current) setPending(""); }
  }

  async function validate() {
    if (!ctx || !settled) return;
    setError(null); setMessage(""); setResult(null);
    let payload;
    try { payload = parseAllQuestionsJson(textRef.current?.value); } catch (parseError) { setError(parseError); return; }
    setPending("validate");
    try {
      const validated = await adminControlApi.validateAllQuestions(sheet.id, { payload, sheet_question_count: normal, ...boundaries() }, edition);
      setResult({ token, body: validated, payload });
    } catch (requestError) {
      if (requestError?.payload?.summary) setResult({ token, body: requestError.payload, payload: null });
      else setError(requestError);
    } finally { setPending(""); }
  }

  async function save() {
    if (!ctx || !settled || !body?.valid || stale || !result.payload) return;
    setPending("save"); setError(null); setMessage("");
    try {
      const saved = await adminControlApi.saveAllQuestions(sheet.id, {
        payload: result.payload,
        sheet_question_count: normal,
        ...boundaries(),
        settings_revision: ctx.settings_revision,
        expected_revisions: Object.fromEntries(ctx.difficulties.map((row) => [row.difficulty, row.existing.revision])),
        publish_sheet_questions: publish
      }, edition);
      // A second click must not import the Normal Questions twice.
      setResult(null);
      setMessage(`All Questions saved: ${saved.summary.total_received} questions distributed to Easy, Medium and Hard${normal ? " and Normal Questions" : ""}.${saved.replaced_sheet_question_count ? ` ${saved.replaced_sheet_question_count} earlier All Questions Normal Questions were replaced.` : ""}${saved.boundaries_updated ? " This edition's excluded pages were updated too." : ""}`);
      context.reload();
      onSaved();
    } catch (requestError) {
      if (requestError?.payload?.summary) setResult({ token, body: requestError.payload, payload: null });
      else setError(requestError);
    } finally { setPending(""); }
  }

  return <section className="admin-all-questions" aria-labelledby={`all-questions-${sheet.id}`}>
    <div className="admin-form-heading"><div><h3 id={`all-questions-${sheet.id}`}>All Questions</h3><p>One prompt and one JSON for all three difficulties, their final exams and Normal Questions.</p></div></div>

    <ol className="admin-all-questions-workflow" aria-label={t("allQuestions.workflow")}>{["stepPrompt", "stepImport", "stepSave"].map((step, index) => <li key={step} aria-current={(body ? 2 : textVersion ? 1 : 0) === index ? "step" : undefined}><b aria-hidden="true">{index + 1}</b><span>{t(`allQuestions.${step}`)}</span></li>)}</ol>
    <div className="admin-form-grid">
      <label className="field"><span>Edition</span><select value={edition} disabled={Boolean(pending) || context.loading} onChange={(event) => changeEdition(event.target.value)}>{EDITIONS.map(([key, label]) => {
        const available = key === "university" || (!pageBank && Boolean(editionRows.find((row) => row.edition === key)?.available));
        return <option key={key} value={key} disabled={!available}>{available ? label : `${label} (${key === "lockin" && pageBank ? "shared questions" : "not added"})`}</option>;
      })}</select></label>
      {exclusions && <>
        <ExclusionField key={`${edition}-start`} label="First pages to exclude" value={exclusions.start} onChange={(value) => changeExclusion("start", value)} />
        <ExclusionField key={`${edition}-end`} label="Last pages to exclude" value={exclusions.end} onChange={(value) => changeExclusion("end", value)} />
      </>}
    </div>

    {context.error && <p className="form-alert error" role="alert">{context.error}</p>}
    {!ctx && !context.error && <LoadingPanel />}
    {ctx && <>
      <p className="admin-active-study-summary"><strong>Effective pages {ctx.effective_start_page}–{ctx.effective_end_page}</strong><span>{ctx.total_pdf_pages} PDF pages</span><span>{ctx.excluded_start_pages} excluded at the start · {ctx.excluded_end_pages} at the end</span>{!settled && <span>Updating…</span>}</p>
      {ctx.exclusions_changed && <p className="form-alert">Saving will also set this edition&apos;s Active Study exclusions to {ctx.excluded_start_pages} first / {ctx.excluded_end_pages} last page(s) (saved: {ctx.saved_excluded_start_pages} / {ctx.saved_excluded_end_pages}).</p>}
      {ctx.shared_question_bank && <p className="form-alert">The prompt uses the Lockin Sheet&apos;s page ranges. Active Study questions are one bank shared with the University Sheet, so saving here replaces them for both editions.</p>}
      {!ctx.active_study_enabled && <p className="form-alert">Active Study is off for this edition. Questions are saved, but students see them only once Active Study is enabled.</p>}

      {pageBank && <p className="form-alert">{t("allQuestions.pageBankHint")} {t("allQuestions.sharedHint")}</p>}
      <h4 className="admin-all-questions-heading">Active Study</h4>
      <ul className="admin-all-questions-plan">{totals.difficulties.map((row) => <li key={row.difficulty}><strong>{row.label}</strong><span>{row.parts} {row.questionFormat === "pages" ? "pages" : "parts"} · {row.partQuestions} questions</span><span>Final Exam: {row.finalExam}</span></li>)}</ul>

      <h4 className="admin-all-questions-heading">Normal Questions</h4>
      <div className="admin-manage-row">
        <label className="field compact-field"><span>Number of Questions</span><input type="number" inputMode="numeric" min="0" max={maxCount} step="1" value={canManageQuestions ? count : 0} disabled={!canManageQuestions} onChange={(event) => setCount(event.target.value)} /></label>
        <label className="check-row"><input type="checkbox" checked={publish} disabled={!normal} onChange={(event) => setPublish(event.target.checked)} /> Publish Normal Questions to students</label>
      </div>
      {!canManageQuestions && <small className="admin-active-study-copy-status">Adding Normal Questions requires the Manage assessments permission.</small>}

      <details className="admin-all-questions-style"><summary>{t("allQuestions.style")}</summary><label className="field"><span>{t("allQuestions.styleHint")}</span><textarea maxLength={6000} rows={4} value={examStyle} onChange={(event) => setExamStyle(event.target.value)} /></label></details>
      <p className="admin-all-questions-total"><strong>Total: {totals.total} Questions</strong></p>
      <div className="admin-active-study-content-actions">
        <button className="btn btn-primary compact" type="button" disabled={!settled || !prompt} onClick={copy}><Icon name="sparkles" size={16} />Copy All Questions Prompt</button>
        <button className="btn btn-soft compact" type="button" disabled={!settled || !prompt} onClick={() => downloadAllQuestionsPrompt(prompt, sheet.id)}>{t("allQuestions.download")}</button>
        {Boolean(prompt) && <button className="btn btn-soft compact" type="button" onClick={() => setShowPrompt((value) => !value)}>{showPrompt ? "Hide prompt" : "Show prompt"}</button>}
      </div>
      {promptError && <small className="form-alert error">{promptError}</small>}
      {showPrompt && prompt && <label className="field admin-active-study-copy-fallback"><span>All Questions prompt</span><textarea ref={promptRef} readOnly value={prompt} onFocus={(event) => event.target.select()} /></label>}
    </>}

    <div className="admin-all-questions-paste">
      <label className="field admin-all-questions-file"><span>{t(pending === "file" ? "allQuestions.reading" : "allQuestions.upload")}</span><input type="file" accept=".json,.txt,application/json,text/plain" disabled={Boolean(pending)} onChange={uploadFile} /><small>{t("allQuestions.uploadHint")}</small>{loadedFile && <small dir="auto">{loadedFile}</small>}</label>
      <label className="field admin-json-field"><span>Paste All Questions JSON</span><textarea ref={textRef} readOnly={Boolean(pending)} spellCheck="false" autoComplete="off" autoCapitalize="off" autoCorrect="off" defaultValue="" placeholder='{ "active_study": { "easy": …, "medium": …, "hard": … }, "sheet_questions": { "questions": [] } }' onInput={() => { setTextVersion((value) => value + 1); setLoadedFile(""); }} /></label>
      <div className="admin-active-study-content-actions"><button className="btn btn-primary compact" type="button" disabled={!settled || Boolean(pending)} onClick={validate}>{pending === "validate" ? "Validating…" : "Validate"}</button></div>
    </div>

    {message && <p className="form-alert success" role="status">{message}</p>}
    {error && <p className="form-alert error" role="alert">{error.message || "Something went wrong. Try again."}</p>}

    {body && <section className="admin-all-questions-result" aria-label="All Questions validation">
      <p className={`form-alert ${body.valid ? "success" : "error"}`} role={body.valid ? "status" : "alert"}>{body.valid ? `Valid — ${body.summary.total_received} questions ready to save.` : `${body.error_count} problem${body.error_count === 1 ? "" : "s"} found. Nothing has been saved.`}</p>
      <ValidationSummary body={body} />
      {stale && <p className="form-alert">The JSON or the choices above changed. Validate again before saving.</p>}
      {body.valid && !stale && <>
        <AllQuestionsPreview key={token} payload={result.payload} />
        {existing.replaced.length > 0 && <div className="form-alert" role="note"><strong>Existing question sets found:</strong><ul>{existing.replaced.map((item) => <li key={item.key}>{item.label} — {item.count} questions</li>)}</ul><span>Saving will replace these question sets.</span></div>}
        {normal > 0 && (existing.normalAllQuestions > 0 || existing.normalOther > 0) && <div className="form-alert" role="note"><strong>Normal Questions</strong><ul>
          {existing.normalAllQuestions > 0 && <li>Existing All Questions batch: {existing.normalAllQuestions} questions</li>}
          <li>Will be replaced with: {normal} questions</li>
          {existing.normalOther > 0 && <li>{existing.normalOther} other Normal Questions (manual imports) stay unchanged</li>}
        </ul>{existing.normalAllQuestions > 0 && <span>The replaced questions are archived, as Archive selected does; past attempts keep them.</span>}</div>}
        <button className="btn btn-primary" type="button" disabled={!settled || Boolean(pending)} onClick={save}>{pending === "save" ? "Saving…" : "Save All Questions"}</button>
      </>}
    </section>}
  </section>;
}
