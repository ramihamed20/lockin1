import { useState } from "react";
import { Link } from "react-router-dom";
import { adminControlApi } from "../../api/adminControl.js";
import { managementApi } from "../../api/management.js";
import { useAsyncData } from "../../hooks/useAsyncData.js";
import { hasOperationalCapability } from "../../lib/authz.js";
import { copyTextToClipboard } from "../../lib/clipboard.js";
import { Icon } from "../../lib/icons.jsx";
import { buildAllQuestionsPrompt, existingQuestionSets, parseAllQuestionsJson } from "../../lib/allQuestionsPrompt.js";
import { downloadAllQuestionsPrompt, readAllQuestionsFile } from "../../lib/allQuestionsImport.js";
import { automationAgentInstructions, draftSheetPayload, validateAutomationFiles } from "../../lib/adminAutomation.js";
import { ErrorPanel, LoadingPanel } from "../../components/ui/index.jsx";
import "./admin-automation.css";

function pathLabel(item) {
  return [item.college_title, item.specialty_title, item.academic_year_title, item.title].filter(Boolean).join(" / ");
}

function PipelineRow({ item, canQuestions, normalCount, referenceNotes, onPatch }) {
  const [pending, setPending] = useState("");
  async function prepare() {
    if (!item.sheetId || pending) return;
    setPending("prepare");
    try {
      const context = await adminControlApi.allQuestionsContext(item.sheetId, "university");
      const prompt = buildAllQuestionsPrompt(context, normalCount, { examStyle: referenceNotes });
      downloadAllQuestionsPrompt(automationAgentInstructions({
        prompt,
        sheetTitle: item.title,
        sheetId: item.sheetId,
        referenceNotes
      }), item.sheetId);
      onPatch(item.id, { message: "Task downloaded. Open it with the original PDF in Antigravity; no AI execution was started." });
    } catch (error) {
      onPatch(item.id, { error: error.message || "Failed to prepare task." });
    } finally {
      setPending("");
    }
  }

  async function copyExportCommand() {
    if (!item.sheetId) return;
    const command = "cd /home/lockin/lockin1/backend && python manage.py export_lockin_ai_task --sheet-id " + item.sheetId + " --output-dir /home/lockin/ai-tasks";
    const copied = await copyTextToClipboard(command);
    onPatch(item.id, { message: copied ? "Read-only VPS export command copied. Run it yourself from SSH after deploying the reviewed branch." : "Clipboard blocked. Open the sheet to copy its UUID and run the export manually." });
  }

  async function validate(file) {
    if (!file || !canQuestions || !item.sheetId || pending) return;
    setPending("validate");
    onPatch(item.id, { error: "", validation: null, payload: null, validatedNormalCount: null });
    try {
      const payload = parseAllQuestionsJson(await readAllQuestionsFile(file));
      const context = await adminControlApi.allQuestionsContext(item.sheetId, "university");
      const existing = existingQuestionSets(context);
      if (existing.replaced.length || existing.normalAllQuestions || existing.normalOther) {
        throw new Error("This sheet already has questions. Open its normal All Questions editor to review replacements safely.");
      }
      const body = {
        payload,
        sheet_question_count: normalCount,
        excluded_start_pages: context.excluded_start_pages,
        excluded_end_pages: context.excluded_end_pages
      };
      const validation = await adminControlApi.validateAllQuestions(item.sheetId, body, "university");
      if (!validation.valid) throw new Error("The JSON failed the Lock-in validation rules.");
      onPatch(item.id, { payload, context, validation, validatedNormalCount: normalCount, message: "Validated against Lock-in. Confirm import to save Normal Questions as drafts." });
    } catch (error) {
      const first = error?.payload?.errors?.[0];
      onPatch(item.id, { error: first?.message || error?.message || "Invalid question JSON." });
    } finally {
      setPending("");
    }
  }

  async function save() {
    if (!item.validation?.valid || !item.context || !item.payload || pending || item.validatedNormalCount !== normalCount) return;
    setPending("save");
    try {
      const ctx = item.context;
      await adminControlApi.saveAllQuestions(item.sheetId, {
        payload: item.payload,
        sheet_question_count: item.validatedNormalCount,
        excluded_start_pages: ctx.excluded_start_pages,
        excluded_end_pages: ctx.excluded_end_pages,
        settings_revision: ctx.settings_revision,
        expected_revisions: Object.fromEntries(ctx.difficulties.map((row) => [row.difficulty, row.existing.revision])),
        publish_sheet_questions: false
      }, "university");
      onPatch(item.id, { status: "imported", payload: null, context: null, validation: null, message: "Questions saved. Normal Questions are drafts; review before publication." });
    } catch (error) {
      onPatch(item.id, { error: error?.message || "Could not save questions. Revalidate the current revision." });
    } finally {
      setPending("");
    }
  }

  return <li className="admin2-pipeline-item">
    <div className="admin2-row-head"><div><strong>{item.title}</strong><small>{item.fileName}</small></div><span className={"admin2-state is-" + item.status}>{item.status}</span></div>
    {item.sheetId && <div className="admin2-pipeline-actions">
      <button type="button" className="btn btn-soft compact" disabled={Boolean(pending)} onClick={prepare}><Icon name="file" size={15} />{pending === "prepare" ? "Preparing…" : "Download AI task"}</button>
      <button type="button" className="btn btn-soft compact" disabled={Boolean(pending)} onClick={copyExportCommand}>Copy VPS PDF export</button>
      {canQuestions && item.status !== "imported" && <label className="admin2-json-file btn btn-soft compact">
        <Icon name="file-question" size={15}/>{pending === "validate" ? "Validating…" : "Validate returned JSON"}
        <input type="file" accept=".json,.txt,application/json,text/plain" disabled={Boolean(pending)} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; void validate(file); }}/>
      </label>}
      {item.validation?.valid && <button className="btn btn-primary compact" type="button" disabled={Boolean(pending) || item.validatedNormalCount !== normalCount} onClick={save}>{item.validatedNormalCount !== normalCount ? "Revalidate after count change" : "Confirm draft import"}</button>}
      <Link className="btn btn-soft compact" to={"/operations/admin/content?subject=" + encodeURIComponent(item.subjectId) + "&sheet=" + encodeURIComponent(item.sheetId)}>Open sheet</Link>
    </div>}
    {item.validation?.valid && <div className="admin2-safe-note">All Questions validated ({item.validation?.summary?.total_received ?? "?"} questions). Saving may update Active Study banks. This new draft sheet must be reviewed before student visibility.</div>}
    {item.message && <small role="status" className="admin2-ok">{item.message}</small>}
    {item.error && <small role="alert" className="admin2-error">{item.error}</small>}
  </li>;
}

/**
 * Admin 2.0 uses the real Django upload, sheet and All Questions endpoints.
 * This is an operator-directed pipeline, NOT a hidden Antigravity CLI wrapper.
 */
export default function AdminAutomationHub({ operationsSession }) {
  const canManage = hasOperationalCapability(operationsSession, "content.manage");
  const canQuestions = hasOperationalCapability(operationsSession, "assessments.manage");
  const subjectsData = useAsyncData(() => adminControlApi.contentSubjects({}), []);
  const [query, setQuery] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [rows, setRows] = useState([]);
  const [pending, setPending] = useState(false);
  const [globalError, setGlobalError] = useState("");
  const [normal, setNormal] = useState("30");
  const [referenceNotes, setReferenceNotes] = useState("");
  const [reloadDrafts, setReloadDrafts] = useState(0);
  const drafts = useAsyncData(() => subjectId ? adminControlApi.subjectSheets(subjectId, { status: "draft" }) : Promise.resolve({ results: [] }), [subjectId, reloadDrafts]);
  const subjects = subjectsData.data?.results || [];
  const matches = subjects.filter((entry) => pathLabel(entry).toLowerCase().includes(query.toLowerCase())).slice(0, 250);
  const selected = subjects.find((entry) => entry.id === subjectId);
  const normalCount = Math.min(200, Math.max(0, Number.parseInt(normal || "0", 10) || 0));

  function patch(id, change) {
    setRows((current) => current.map((item) => item.id === id ? { ...item, ...change } : item));
  }

  function onFiles(event) {
    setGlobalError("");
    try {
      const files = validateAutomationFiles(event.target.files);
      setRows(files.map((file, index) => ({
        id: index + 1,
        file,
        fileName: file.name,
        title: file.name.replace(/\.pdf$/i, "").replace(/_/g, " ").trim().slice(0, 220) || "Untitled sheet",
        status: "queued",
        subjectId,
        sheetId: "",
        error: "",
        message: "",
        payload: null,
        validation: null,
        validatedNormalCount: null
      })));
    } catch (error) {
      setGlobalError(error.message || "Files could not be selected.");
    }
    event.target.value = "";
  }

  async function uploadDrafts() {
    if (!canManage || !subjectId || pending || !rows.length) return;
    setPending(true); setGlobalError("");
    for (const item of rows) {
      if (item.sheetId) continue;
      patch(item.id, { status: "uploading", error: "", message: "" });
      try {
        const file = await managementApi.uploadFile({ kind: "pdf", file: item.file });
        const sheet = await adminControlApi.createSheet(subjectId, draftSheetPayload({
          filename: item.fileName,
          fileId: file.id
        }));
        patch(item.id, { status: "draft", sheetId: sheet.id, message: "PDF uploaded and sheet created as draft." });
      } catch (error) {
        patch(item.id, { status: "error", error: error.message || "Could not upload this PDF." });
      }
    }
    setPending(false);
    setReloadDrafts((number) => number + 1);
  }

  return <div className="admin2-automation">
    <section className="admin2-banner">
      <div><p className="admin2-kicker">ADMIN 2.0 / CONTENT PIPELINE</p><h2>Sheet-to-questions workspace</h2><p>Upload drafts in batches, prepare a Lock-in-compliant AI task, validate the returned JSON and import it without publishing Normal Questions.</p></div>
      <div className="admin2-banner-links"><Link to="/operations/admin/content" className="btn btn-soft compact">Content library</Link><Link to="/operations/admin/questions" className="btn btn-soft compact">Question bank</Link></div>
    </section>
    <div className="admin2-workflow">
      <section className="admin2-work-card">
        <h3>1. Choose the exact academic location</h3>
        <p>Subjects are loaded from the same Catalog used by the existing admin panel.</p>
        {subjectsData.loading && <LoadingPanel />}
        {subjectsData.error && <ErrorPanel message={subjectsData.errorDetails || subjectsData.error} onRetry={subjectsData.reload}/>}
        <label className="field"><span>Find a subject</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Pathology / Year 2 / Tripoli"/></label>
        <label className="field"><span>Destination</span><select value={subjectId} onChange={(event) => { setSubjectId(event.target.value); setRows([]); }}>
          <option value="">Choose existing subject</option>{matches.map((subject) => <option key={subject.id} value={subject.id}>{pathLabel(subject)}</option>)}
        </select></label>
        {selected && <small className="admin2-safe-note">Destination: {pathLabel(selected)}. Never inferred from a filename.</small>}
        <h3>2. Upload one or more lecture PDFs</h3>
        <label className="field"><span>PDF files (20 at a time, up to 50 MB each)</span><input type="file" accept=".pdf,application/pdf" multiple disabled={!canManage || pending || !subjectId} onChange={onFiles}/></label>
        <p className="admin2-safe-note">Every file is created as <strong>Draft</strong>. Students are not notified and downloads are disabled.</p>
        <button className="btn btn-primary" type="button" disabled={!canManage || !subjectId || pending || !rows.some((row) => !row.sheetId)} onClick={uploadDrafts}>{pending ? "Uploading sequentially…" : "Upload drafts"}</button>
        {!canManage && <small>You need Content Manage permission to upload.</small>}
        {globalError && <p className="admin2-error" role="alert">{globalError}</p>}
      </section>
      <section className="admin2-work-card">
        <h3>3. Prepare question generation</h3>
        <p>The instruction file is generated from Lock-in’s current All Questions plan, rather than a guessed schema.</p>
        <label className="field"><span>Normal Questions (0–200)</span><input type="number" min="0" max="200" value={normal} onChange={(event) => setNormal(event.target.value)}/></label>
        <label className="field"><span>Previous years’ question style (optional)</span>
          <textarea value={referenceNotes} maxLength={6000} rows={6} onChange={(event) => setReferenceNotes(event.target.value)} placeholder="Paste representative questions or exam style here. Use the original lecture for factual answers."/>
        </label>
        <div className="admin2-safe-note">Run the downloaded task yourself inside Antigravity with the actual PDF and any reference files. This application does not invoke agy, use paid AI APIs, or pretend that a model is running on the VPS.</div>
        <h3>4. Validate and import results</h3>
        <p>After Antigravity returns JSON, validate it against the existing backend. Import is a separate, explicit action; Normal Questions remain drafts.</p>
      </section>
    </div>
    <section className="admin2-work-card">
      <h3>Current upload batch</h3>
      {rows.length ? <ul className="admin2-pipeline">{rows.map((item) => <PipelineRow key={item.id} item={item} canQuestions={canQuestions} normalCount={normalCount} referenceNotes={referenceNotes} onPatch={patch}/>)}</ul> : <p>No files in this session. Select a subject and upload PDFs to start.</p>}
    </section>
    {subjectId && <section className="admin2-work-card">
      <h3>Drafts already on this subject</h3>
      <p>These records come from Django, so existing content is never duplicated or guessed.</p>
      {drafts.loading ? <LoadingPanel/> : drafts.error ? <ErrorPanel message={drafts.errorDetails || drafts.error} onRetry={drafts.reload}/> :
        (drafts.data?.results || []).length ? <ul className="admin2-drafts">{drafts.data.results.slice(0, 30).map((sheet) => <li key={sheet.id}><span>{sheet.title}</span><Link to={"/operations/admin/content?subject=" + encodeURIComponent(subjectId) + "&sheet=" + encodeURIComponent(sheet.id)}>Open sheet</Link></li>)}</ul> : <p>No draft sheets for this subject.</p>}
    </section>}
  </div>;
}
