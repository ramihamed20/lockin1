import { useEffect, useRef, useState } from "react";
import { Icon } from "../../lib/icons.jsx";
import { useI18n } from "../I18nProvider.jsx";
import { newPomodoroClock, pomodoroClockKey, pomodoroClockLabel, pomodoroRemaining, reconcilePomodoroClock, tickPomodoroClock, togglePomodoroClock, validPomodoroClock } from "../../lib/pomodoroStudy.js";
import "./pomodoro-study.css";

function restoreClock(key, run) {
  try {
    const saved = JSON.parse(window.localStorage.getItem(key) || "null");
    if (validPomodoroClock(saved) && (saved.deadline === null || saved.deadline <= Date.now() + 25 * 60 * 1000)) return tickPomodoroClock(saved, Date.now());
  } catch { /* A blocked or invalid storage entry starts a fresh local timer. */ }
  return newPomodoroClock(run.current_part, Date.now());
}

function PageTestSetup({ range, endPage, busy, onStart, onClose, onReadMore }) {
  const { t } = useI18n();
  const dialogRef = useRef(null);
  const maximum = endPage === null ? 0 : Math.min(40, (endPage - range.start_page + 1) * 20);
  const [count, setCount] = useState(range.question_count ?? Math.min(15, maximum));
  const [error, setError] = useState("");
  useEffect(() => {
    const dialog = dialogRef.current;
    const previous = document.activeElement;
    dialog.showModal();
    dialog.querySelector("input, button")?.focus();
    return () => { dialog.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  const valid = Number.isInteger(count) && count >= 1 && count <= maximum;
  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    if (!maximum) { onReadMore(); return; }
    if (!valid) return;
    setError("");
    try { await onStart({ part: range.part, end_page: endPage, question_count: count }); }
    catch (error) { setError(error?.message || t("pomodoro.failed")); }
  }
  return <dialog className="pomodoro-test-dialog" ref={dialogRef} aria-labelledby="pomodoro-test-title" aria-describedby="pomodoro-test-description" onKeyDown={(event) => event.stopPropagation()} onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <form onSubmit={submit}>
      <h2 id="pomodoro-test-title">{t("pomodoro.finished")}</h2>
      <p id="pomodoro-test-description">{maximum ? t("pomodoro.pages", { start: range.start_page, end: endPage }) : t("pomodoro.noPages")}</p>
      {maximum > 0 && <>
        <label className="field"><span>{t("pomodoro.questions")}</span><input type="number" inputMode="numeric" min="1" max={maximum} step="1" value={count} disabled={busy || range.question_count != null} onChange={(event) => setCount(event.target.value === "" ? "" : Number(event.target.value))} /></label>
        <p>{t("pomodoro.limit", { max: maximum })}</p>
        <p>{t("pomodoro.distribution")}</p>
        {range.question_count != null && <p>{t("pomodoro.retry")}</p>}
      </>}
      {error && <p className="form-alert error" role="alert">{error}</p>}
      <div className="pomodoro-test-actions"><button type="button" className="btn btn-soft" onClick={onClose} disabled={busy}>{t("pomodoro.later")}</button><button type="submit" className="btn btn-primary" disabled={busy || (maximum > 0 && !valid)}>{t(maximum ? "pomodoro.takeTest" : "pomodoro.readMore")}</button></div>
    </form>
  </dialog>;
}

/** The one-second updates stay here, outside the expensive PDF workspace render. */
export function PomodoroStudy({ userId, run, page, virtualPage = false, active = true, blocked = false, deferSetup = false, busy = false, onStartTest, onOpenTest }) {
  const { t } = useI18n();
  const key = pomodoroClockKey(userId, run.id);
  const [clock, setClock] = useState(() => restoreClock(key, run));
  const [now, setNow] = useState(Date.now);
  const [setupHidden, setSetupHidden] = useState(false);
  const range = run.current_page_range;

  useEffect(() => {
    if (!active) return undefined;
    function tick() {
      const time = Date.now();
      setNow(time);
      setClock((current) => tickPomodoroClock(current, time));
    }
    tick();
    const timer = window.setInterval(tick, 1000);
    document.addEventListener("visibilitychange", tick);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", tick); };
  }, [active]);

  useEffect(() => {
    setClock((current) => reconcilePomodoroClock(current, { stage: run.stage, current_part: run.current_part }, Date.now(), blocked));
  }, [run.stage, run.current_part, blocked]);

  useEffect(() => {
    if (!active || blocked || virtualPage || run.stage !== "reading" || !range || page < range.start_page || page > range.end_page) return;
    setClock((current) => current.phase === "focus" && current.part === range.part && pomodoroRemaining(current, Date.now()) > 0 && current.endPage !== page ? { ...current, endPage: page } : current);
  }, [active, blocked, virtualPage, page, range, run.stage, clock.phase]);

  useEffect(() => {
    try { window.localStorage.setItem(key, JSON.stringify(clock)); } catch { /* Timer remains usable when storage is unavailable. */ }
  }, [key, clock]);
  useEffect(() => { if (clock.phase === "focus" || clock.phase === "break") setSetupHidden(false); }, [clock.phase, clock.part]);

  if (!active || blocked || deferSetup) return null;
  const reading = run.stage === "reading";
  const timed = reading && ["focus", "break"].includes(clock.phase);
  const endPage = range?.question_count != null ? range.end_page
    : Number.isInteger(clock.endPage) && clock.endPage >= range?.start_page && clock.endPage <= range?.end_page ? clock.endPage : null;
  const openSetup = reading && clock.phase === "ready" && !setupHidden;
  const label = !reading ? t("pomodoro.openTest") : clock.phase === "ready" ? t("pomodoro.ready") : clock.phase === "waiting" ? t("pomodoro.start") : t(clock.phase === "break" ? "pomodoro.break" : clock.deadline === null ? "pomodoro.paused" : "pomodoro.focus");
  function startFocus() { setNow(Date.now()); setClock(newPomodoroClock(run.current_part, Date.now())); setSetupHidden(false); }
  function action() {
    if (!reading) onOpenTest();
    else if (clock.phase === "ready") setSetupHidden(false);
    else if (clock.phase === "waiting") startFocus();
    else setClock((current) => togglePomodoroClock(current, Date.now()));
  }
  return <>
    <div className="pomodoro-study-clock" role="group" aria-label={t("pomodoro.timer")}>
      <div><span className="pomodoro-study-time" role="timer" aria-live="off" dir="ltr">{timed ? pomodoroClockLabel(clock, now) : "00:00"}</span><small>{label}</small></div>
      <button type="button" disabled={busy} aria-label={timed ? t(clock.deadline === null ? "pomodoro.resume" : "pomodoro.pause") : label} onClick={action}><Icon name={timed && clock.deadline !== null ? "pause" : "play"} size={18} /></button>
    </div>
    {openSetup && range && <PageTestSetup range={range} endPage={endPage} busy={busy} onStart={onStartTest} onClose={() => setSetupHidden(true)} onReadMore={startFocus} />}
  </>;
}
