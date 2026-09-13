import { useCallback, useEffect, useMemo, useState } from "react";
import { Brain, CheckCircle2, CircleAlert, Trophy } from "lucide-react";
import { focusApi } from "../../api/focus.js";
import { LoadingPanel } from "../ui/index.jsx";
import { ConfirmDialog } from "../shared/ConfirmDialog.jsx";

const LABELS = { easy: "Easy", medium: "Medium", hard: "Hard" };

function DifficultyCard({ item, busy, onStart }) {
  const run = item.progress;
  const ready = item.status === "ready";
  const progress = run ? `${run.completed_parts.length} / ${item.number_of_parts} Parts` : item.completed ? "Completed" : "Not started";
  return <article className={`active-study-player__difficulty is-${ready ? "ready" : "unavailable"}`}>
    <div><h3>{LABELS[item.difficulty]}</h3><p>{progress}</p></div>
    <span className={`pill ${ready ? "status-published" : "status-draft"}`}>{ready ? (run ? "Resume" : item.completed ? "Completed" : "Ready") : item.status.replaceAll("_", " ")}</span>
    <button className="btn btn-soft compact" type="button" disabled={!ready || busy} onClick={() => onStart(item.difficulty)}>{run ? "Resume" : item.completed ? "Study again" : "Start"}</button>
  </article>;
}

function QuestionRunner({ session, onUpdated }) {
  const [payload, setPayload] = useState(null);
  const [selected, setSelected] = useState({});
  const [feedback, setFeedback] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  useEffect(() => {
    let alive = true;
    setPayload(null); setSelected({}); setFeedback({}); setResult(null); setError("");
    focusApi.getManagedActiveStudyQuestions(session.id).then((next) => {
      if (!alive) return;
      setPayload(next);
      const existing = {};
      for (const question of /** @type {any[]} */ (next.questions || [])) if (question.answered) existing[question.position] = question.answered;
      setSelected(existing);
    }).catch((reason) => alive && setError(reason.message || "Questions could not be loaded."));
    return () => { alive = false; };
  }, [session.id]);

  async function check(question) {
    const answer = selected[question.position];
    if (!answer || busy || !payload) return;
    setBusy(true); setError("");
    try {
      const response = await focusApi.answerManagedActiveStudyQuestion(session.id, { attemptId: payload.attempt_id, position: question.position, selectedAnswer: answer });
      setFeedback((current) => ({ ...current, [question.position]: response }));
    } catch (reason) { setError(reason.message || "The answer could not be saved."); }
    finally { setBusy(false); }
  }

  const readyToSubmit = payload && Object.keys(feedback).length === payload.questions.length;
  async function submit() {
    if (!payload || busy) return;
    setBusy(true); setError("");
    try {
      const response = await focusApi.submitManagedActiveStudy(session.id, payload.attempt_id);
      setResult(response.result); onUpdated(response.run);
    } catch (reason) { setError(reason.message || "The result could not be saved."); }
    finally { setBusy(false); }
  }
  if (error && !payload) return <p className="inline-error" role="alert">{error}</p>;
  if (!payload) return <LoadingPanel />;
  if (result) return <ResultPanel run={session} result={result} onUpdated={onUpdated} />;
  return <section className="active-study-player__questions" aria-label={payload.kind === "final" ? "Final exam" : "Checkpoint"}>
    <header><div><p>{payload.kind === "final" ? "Final Exam" : `Checkpoint · Part ${session.current_part}`}</p><h2>{payload.questions.length} questions</h2></div><span>{Object.keys(feedback).length} / {payload.questions.length} checked</span></header>
    {payload.questions.map((question) => <article className="active-study-player__question" key={question.position}>
      <span>Question {question.position}</span><h3>{question.question}</h3>
      <div role="radiogroup" aria-label={`Answers for question ${question.position}`} className="active-study-player__options">
        {Object.entries(/** @type {Record<string, string>} */ (question.options)).map(([key, value]) => <button type="button" key={key} role="radio" aria-checked={selected[question.position] === key} className={selected[question.position] === key ? "is-selected" : ""} disabled={Boolean(feedback[question.position])} onClick={() => setSelected((current) => ({ ...current, [question.position]: key }))}><b>{key}</b>{value}</button>)}
      </div>
      {!feedback[question.position] ? <button type="button" className="btn btn-soft compact" disabled={!selected[question.position] || busy} onClick={() => check(question)}>Check answer</button> : <div className={`active-study-player__feedback is-${feedback[question.position].correct ? "correct" : "incorrect"}`} role="status"><strong>{feedback[question.position].correct ? "Correct" : `Incorrect · Correct answer: ${feedback[question.position].correct_answer}`}</strong><p>{feedback[question.position].explanation}</p></div>}
    </article>)}
    {error && <p className="inline-error" role="alert">{error}</p>}
    <button type="button" className="btn btn-primary" disabled={!readyToSubmit || busy} onClick={submit}>{busy ? "Saving…" : "Submit result"}</button>
  </section>;
}

function ResultPanel({ run, result, onUpdated }) {
  const isFinal = run.stage === "final" || run.stage === "final_result";
  const passed = result.passed;
  async function action(action) {
    const response = await focusApi.managedActiveStudyAction(run.id, action);
    onUpdated(response.run);
  }
  return <section className={`active-study-player__result is-${passed ? "passed" : "failed"}`}><span>{passed ? <CheckCircle2 size={28} /> : <CircleAlert size={28} />}</span><p>{isFinal ? "Final Exam" : "Checkpoint"}</p><h2>{result.score} / {result.total}</h2><strong>{passed ? (isFinal ? "Difficulty Completed" : "Checkpoint Passed") : (isFinal ? "Final Exam Not Passed" : "Checkpoint not passed")}</strong>
    {result.xp_awarded > 0 && <small>+{result.xp_awarded} XP</small>}
    {!isFinal && passed && <button className="btn btn-primary" type="button" onClick={() => onUpdated(null)}>Continue</button>}
    {!isFinal && !passed && <div className="active-study-player__actions"><button className="btn btn-soft" type="button" onClick={() => action("study-again")}>Study this part again</button><button className="btn btn-primary" type="button" onClick={() => action("continue")}>Continue anyway</button></div>}
    {isFinal && !passed && <button className="btn btn-primary" type="button" onClick={() => action("retry-final")}>Retry Final Exam</button>}
  </section>;
}

export function ActiveStudyPlayer({ sheetId, viewUrl }) {
  const [availability, setAvailability] = useState(null);
  const [session, setSession] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [abandonOpen, setAbandonOpen] = useState(false);
  const selected = useMemo(() => session || availability?.difficulties?.find((item) => item.progress)?.progress || null, [availability, session]);
  const reload = useCallback(() => focusApi.getManagedActiveStudyAvailability(sheetId).then(setAvailability).catch((reason) => setError(reason.message || "Active Study could not be loaded.")), [sheetId]);
  useEffect(() => { reload(); }, [reload]);
  async function start(difficulty) { setBusy(true); setError(""); try { const response = await focusApi.startManagedActiveStudy({ sheetId, difficulty }); setSession(response.run); await reload(); } catch (reason) { setError(reason.message || "Active Study could not be started."); } finally { setBusy(false); } }
  async function completeReading() { if (!selected) return; setBusy(true); try { const response = await focusApi.managedActiveStudyAction(selected.id, "complete-reading"); setSession(response.run); } catch (reason) { setError(reason.message || "The checkpoint could not be opened."); } finally { setBusy(false); } }
  async function abandon() { if (!selected || busy) return; setBusy(true); setError(""); try { await focusApi.managedActiveStudyAction(selected.id, "abandon"); setSession(null); setAbandonOpen(false); await reload(); } catch (reason) { setError(reason.message || "The Active Study run could not be abandoned."); } finally { setBusy(false); } }
  function updateRun(run) { setSession(run); reload(); }
  if (!availability && !error) return <LoadingPanel />;
  if (!availability?.enabled) return null;
  return <section className="panel active-study-player" aria-labelledby="active-study-heading"><header><span className="active-study-player__icon"><Brain size={22} /></span><div><p>Active Study</p><h2 id="active-study-heading">Learn in focused parts</h2></div></header>
    {error && <p className="inline-error" role="alert">{error}</p>}
    {!selected ? <div className="active-study-player__difficulty-list">{availability.difficulties.map((item) => <DifficultyCard item={item} busy={busy} onStart={start} key={item.difficulty} />)}</div> : <><ActiveStudySession run={selected} viewUrl={viewUrl} busy={busy} onCompleteReading={completeReading} onUpdated={updateRun} onExit={() => setSession(null)} />{selected.status === "active" && <button type="button" className="btn btn-outline compact" disabled={busy} onClick={() => setAbandonOpen(true)}>Abandon and restart</button>}</>}
    <ConfirmDialog open={abandonOpen} title="Abandon this Active Study run?" message="Your attempts and progress will be retained. You can start a fresh run after the sheet plan is ready." confirmLabel={busy ? "Abandoning…" : "Abandon run"} onCancel={() => setAbandonOpen(false)} onConfirm={abandon} />
  </section>;
}

function ActiveStudySession({ run, viewUrl, busy, onCompleteReading, onUpdated, onExit }) {
  if (run.status === "completed") return <div className="active-study-player__completed"><Trophy size={28} /><h3>{LABELS[run.difficulty]} completed</h3><button type="button" className="btn btn-soft compact" onClick={onExit}>View difficulties</button></div>;
  if (run.stage === "checkpoint" || run.stage === "final") return <QuestionRunner session={run} onUpdated={onUpdated} />;
  if (run.stage === "checkpoint_result" || run.stage === "final_result") return <ResultPanel run={run} result={{ score: run.last_score, total: run.stage === "final_result" ? 50 : 15, passed: run.last_outcome === "passed", xp_awarded: run.xp_awarded }} onUpdated={onUpdated} />;
  const range = run.current_page_range;
  return <div className="active-study-player__reading"><div><p>{LABELS[run.difficulty]} Active Study</p><h3>Part {run.current_part} of {run.number_of_parts}</h3><strong>Pages {range?.start_page}–{range?.end_page}</strong></div>{viewUrl && <iframe title={`Study pages ${range?.start_page} to ${range?.end_page}`} src={`${viewUrl}#page=${range?.start_page}`} /> }<p>Study this part in the existing secure PDF viewer, then open its checkpoint.</p><div className="active-study-player__actions"><button type="button" className="btn btn-soft" onClick={onExit}>Back to difficulties</button><button type="button" className="btn btn-primary" disabled={busy} onClick={onCompleteReading}>{busy ? "Preparing…" : "Start checkpoint"}</button></div></div>;
}
