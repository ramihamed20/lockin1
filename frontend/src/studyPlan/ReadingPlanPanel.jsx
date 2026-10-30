import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { studyPlanApi } from "../api/studyPlan.js";
import { useI18n } from "../components/I18nProvider.jsx";
import { ConfirmDialog } from "../components/shared/ConfirmDialog.jsx";
import { Icon } from "../lib/icons.jsx";
import { formatDate } from "../lib/i18n.js";
import { fromStamp } from "./model.js";
import LearningPreview from "./LearningPreview.jsx";
import "./connected.css";

const dateLabel = stamp => formatDate(fromStamp(stamp), { day: "numeric", month: "short" });
export default function ReadingPlanPanel({ exams, profile, disabled, onSetup, onRefresh, onApplied, onApplying, userId }) {
  const { t } = useI18n();
  const [search] = useSearchParams();
  const reportId = search.get("report") || "";
  const [examId, setExamId] = useState(exams[0]?.id || "");
  const [edition, setEdition] = useState("university");
  const [includeReviews, setIncludeReviews] = useState(true);
  const [includeActiveStudy, setIncludeActiveStudy] = useState(true);
  const [replan, setReplan] = useState(false);
  const [difficulty, setDifficulty] = useState("medium");
  const [state, setState] = useState({ status: "idle", identity: "", preview: null });
  const [applying, setApplying] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [result, setResult] = useState(null);
  const [applyError, setApplyError] = useState("");
  const [progressNotice, setProgressNotice] = useState("");
  const controller = useRef(null), intent = useRef(""), applyLock = useRef(false), alive = useRef(true);
  const identity = `${examId}:${edition}:${profile.revision}:${includeReviews}:${reportId}:${includeActiveStudy}:${replan}:${difficulty}`;
  useEffect(() => { controller.current?.abort(); setState({ status: "idle", identity: "", preview: null }); setResult(null); setApplyError(""); setConfirm(false); }, [identity, disabled]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; controller.current?.abort(); }; }, []);
  const selected = exams.find(exam => exam.id === examId);
  const preview = state.identity === identity && !disabled ? state.preview : null;
  const blocked = disabled || applying;
  async function loadPreview(event) {
    event.preventDefault();
    if (blocked) return;
    controller.current?.abort(); const request = new AbortController(); controller.current = request;
    setState({ status: "loading", identity, preview: null }); setApplyError(""); setResult(null);
    try {
      const data = await studyPlanApi.previewReading(examId, edition, { signal: request.signal, includeReviews, includeActiveStudy, replan, difficulty, ...(reportId ? { reportId } : {}) });
      if (!request.signal.aborted) { intent.current = globalThis.crypto.randomUUID(); setState(data.profile_revision !== profile.revision ? { status: "stale", identity, preview: null } : { status: "ready", identity, preview: data }); }
    } catch (error) { if (!request.signal.aborted) setState({ status: error.status === 403 ? "denied" : "error", identity, preview: null }); }
  }
  async function apply() {
    if (!preview?.apply_token || applyLock.current || blocked) return;
    applyLock.current = true; setApplying(true); setApplyError(""); onApplying?.(true);
    try {
      const saved = await studyPlanApi.applyPreview(examId, { client_request_id: intent.current, preview_token: preview.apply_token, edition, include_reviews: includeReviews, include_active_study: includeActiveStudy, replan, difficulty, ...(reportId ? { report_id: reportId } : {}) });
      if (!alive.current) return;
      setResult(saved); setConfirm(false); setState({ status: "idle", identity: "", preview: null });
      await onApplied?.(saved);
    } catch (error) {
      if (alive.current) { setApplyError(error.status === 409 ? "connected.changed" : "connected.applyError"); setConfirm(false); if (error.status === 409) setState({ status: "stale", identity, preview: null }); }
    } finally { applyLock.current = false; onApplying?.(false); if (alive.current) setApplying(false); }
  }
  return <section className="plan-exam-panel" aria-labelledby="plan-exam-title">
    <header><div><span className="plan-eyebrow">{t("plan.examPilot")}</span><h2 id="plan-exam-title"><Icon name="calendar" size={21} />{t("plan.examTitle")}</h2></div></header>
    <p className="plan-note">{t("connected.previewHint")}</p>
    {!exams.length ? <p role="status">{t("plan.examNone")}</p> : profile.mode !== "normal" ? <div className="plan-actions"><p>{t("plan.examSetup")}</p><button className="btn btn-soft" type="button" onClick={onSetup} disabled={blocked}>{t("plan.settings")}</button></div> : <>
      {reportId && <p>{t("connected.reportScope")} <Link to="/study-plan">{t("connected.allReviews")}</Link></p>}
      <form className="plan-exam-form" onSubmit={loadPreview}>
        <label>{t("plan.examChoose")}<select value={examId} disabled={blocked} onChange={event => setExamId(event.target.value)}>{exams.map(exam => <option key={exam.id} value={exam.id}>{exam.title}</option>)}</select></label>
        <label>{t("plan.examEdition")}<select value={edition} disabled={blocked} onChange={event => setEdition(event.target.value)}><option value="university">{t("plan.examUniversity")}</option><option value="lockin">{t("plan.examLockin")}</option></select></label>
        <button className="btn btn-primary" type="submit" disabled={blocked || state.status === "loading" || !selected}>{t(state.status === "loading" ? "plan.examLoading" : "connected.preview")}</button>
      </form>
      <label className="plan-connected-review"><input type="checkbox" checked={includeReviews} disabled={blocked || Boolean(reportId)} onChange={event => setIncludeReviews(event.target.checked)} />{t("connected.includeReviews")}</label>
      <label className="plan-connected-review"><input type="checkbox" checked={includeActiveStudy} disabled={blocked} onChange={event => setIncludeActiveStudy(event.target.checked)} />{t("smart.includeActive")}</label>
      {includeActiveStudy && <label>{t("smart.difficulty")}<select value={difficulty} disabled={blocked} onChange={event => setDifficulty(event.target.value)}>{["easy", "medium", "hard"].map(value => <option key={value} value={value}>{t(`smart.${value}`)}</option>)}</select></label>}
      <label className="plan-connected-review"><input type="checkbox" checked={replan} disabled={blocked} onChange={event => setReplan(event.target.checked)} />{t("smart.replan")}</label>
      {selected && <p className="plan-exam-status">{dateLabel(selected.starts_on)} · {t(selected.status === "confirmed" ? "plan.examConfirmed" : "plan.examTentative")}</p>}
      {result && <p className="plan-apply-success" role="status">{t("connected.applied", { count: result.created_count })}</p>}
      {progressNotice && <p role="status">{t(progressNotice)}</p>}
      {applyError && <p role="alert">{t(applyError)}</p>}
      {["error", "denied"].includes(state.status) && <p role="alert">{t(state.status === "denied" ? "plan.examDenied" : "plan.examError")}</p>}
      {state.status === "stale" && <div role="alert"><p>{t("connected.changed")}</p><button className="btn btn-soft" type="button" onClick={onRefresh} disabled={blocked}>{t("plan.refresh")}</button></div>}
      {preview && <><LearningPreview key={`${identity}:${preview.computed_at || "preview"}`} preview={preview} t={t} userId={userId} periodId={examId} onProgress={async result => { if (!result.pending) setState({ status: "idle", identity: "", preview: null }); setProgressNotice(result.pending ? "smart.pending" : "smart.progressSaved"); await onRefresh?.(); }} />
        {preview.apply_token && (preview.assignments.length > 0 || preview.replace_item_ids?.length > 0) && <div className="plan-apply-bar"><p>{t("connected.applyHint")}</p><button className="btn btn-primary" type="button" disabled={blocked} onClick={() => setConfirm(true)}>{t("connected.apply")}</button></div>}
      </>}
    </>}
    <ConfirmDialog open={confirm} busy={applying} confirmVariant="primary" title={t("connected.apply")} message={t("connected.applyConfirm", { count: preview?.assignments.length || 0, remaining: preview?.unscheduled.length || 0, issues: preview?.issues.length || 0 })} confirmLabel={t("connected.confirmApply")} onCancel={() => setConfirm(false)} onConfirm={() => void apply()} />
  </section>;
}
