import { useEffect, useRef, useState } from "react";
import { Icon } from "../../lib/icons.jsx";
import { useI18n } from "../I18nProvider.jsx";
import { pausePomodoroAway, resumeAbandonedPomodoroClock, resumePomodoroBack, newerPomodoroClock, newPomodoroClock, POMODORO_LONG_BREAK_EVERY, POMODORO_PRESETS, pomodoroPhaseMs, pomodoroPreset, readPomodoroPreferences, samePomodoroClock, pomodoroCycleDots, pomodoroPageScores, pomodoroProgress, pomodoroClockKey, pomodoroClockLabel, pomodoroRemaining, reconcilePomodoroClock, tickPomodoroClock, togglePomodoroClock, validPomodoroClock } from "../../lib/pomodoroStudy.js";
import { QUESTIONS_PER_PAGE } from "../../lib/activeStudyPages.js";
import "./pomodoro-study.css";

/** This device's copy or the server's, whichever changed last, so a second device resumes the same minute. */
function restoreClock(key, run) {
  let local = null;
  let seen = 0;
  try {
    local = JSON.parse(window.localStorage.getItem(key) || "null");
    seen = Number(window.localStorage.getItem(`${key}.seen`)) || 0;
  } catch { /* A blocked or invalid storage entry is ignored. */ }
  const newer = newerPomodoroClock(local, run.pomodoro_clock);
  const now = Date.now();
  const saved = validPomodoroClock(newer) ? resumeAbandonedPomodoroClock(newer, Math.max(seen, newer.updatedAt || 0), now) : newer;
  if (validPomodoroClock(saved) && (saved.deadline === null || saved.deadline <= now + pomodoroPhaseMs(saved))) return tickPomodoroClock(saved, now);
  return newPomodoroClock(run.current_part, Date.now(), "focus", { preset: readPomodoroPreferences().preset });
}

let audioContext = null;
/** Browsers start audio only after a tap, so the context is woken by the first one. */
function unlockAudio() {
  try {
    const AudioContext = window.AudioContext || /** @type {any} */ (window).webkitAudioContext;
    if (!AudioContext) return;
    audioContext ||= new AudioContext();
    if (audioContext.state === "suspended") audioContext.resume().catch(() => undefined);
  } catch { /* Sound is optional. */ }
}

/** Two soft notes, quiet enough for a library. */
function playChime() {
  try {
    if (!audioContext || audioContext.state !== "running") return;
    const start = audioContext.currentTime;
    for (const [index, frequency] of [880, 660].entries()) {
      const tone = audioContext.createOscillator();
      const gain = audioContext.createGain();
      const at = start + index * .22;
      tone.type = "sine";
      tone.frequency.value = frequency;
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(.12, at + .02);
      gain.gain.exponentialRampToValueAtTime(.001, at + .5);
      tone.connect(gain).connect(audioContext.destination);
      tone.start(at);
      tone.stop(at + .52);
    }
  } catch { /* Sound is optional. */ }
}

/** A hidden tab shows the alert in its title until the student comes back. */
function flagTitle(text) {
  if (!document.hidden) return;
  const original = document.title;
  document.title = `⏰ ${text}`;
  const restore = () => {
    if (document.hidden) return;
    if (document.title === `⏰ ${text}`) document.title = original;
    document.removeEventListener("visibilitychange", restore);
  };
  document.addEventListener("visibilitychange", restore);
}

const focusMinutes = (preset) => POMODORO_PRESETS[pomodoroPreset(preset)].focus;

function PageTestSetup({ range, endPage, minutes, nextMinutes, busy, onStart, onClose, onReadMore }) {
  const { t } = useI18n();
  const dialogRef = useRef(null);
  const maximum = endPage === null ? 0 : Math.min(40, (endPage - range.start_page + 1) * QUESTIONS_PER_PAGE);
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
      <h2 id="pomodoro-test-title">{t("pomodoro.finished", { minutes })}</h2>
      <p id="pomodoro-test-description">{maximum ? t("pomodoro.pages", { start: range.start_page, end: endPage }) : t("pomodoro.noPages")}</p>
      {maximum > 0 && <>
        <label className="field"><span>{t("pomodoro.questions")}</span><input type="number" inputMode="numeric" min="1" max={maximum} step="1" value={count} disabled={busy || range.question_count != null} onChange={(event) => setCount(event.target.value === "" ? "" : Number(event.target.value))} /></label>
        <p>{t("pomodoro.limit", { max: maximum })}</p>
        {range.question_count != null && <p>{t("pomodoro.retry")}</p>}
      </>}
      {error && <p className="form-alert error" role="alert">{error}</p>}
      <div className="pomodoro-test-actions"><button type="button" className="btn btn-soft" onClick={onClose} disabled={busy}>{t("pomodoro.later")}</button><button type="submit" className="btn btn-primary" disabled={busy || (maximum > 0 && !valid)}>{maximum ? t("pomodoro.takeTest") : t("pomodoro.readMore", { minutes: nextMinutes })}</button></div>
    </form>
  </dialog>;
}

const RING_RADIUS = 23;
const POSITION_KEY = "lock-in.pomodoro.position";
const IDLE_AFTER_MS = 3000;
const EDGE = 8;

function readPosition() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(POSITION_KEY) || "null");
    return saved && Number.isFinite(saved.x) && Number.isFinite(saved.y) ? saved : null;
  } catch { return null; }
}

/** Keeps the whole clock on screen, whatever the viewport has become since. */
function clampPosition(position, element) {
  if (!position || !element) return position;
  const { width, height } = element.getBoundingClientRect();
  return {
    x: Math.min(Math.max(EDGE, position.x), Math.max(EDGE, window.innerWidth - width - EDGE)),
    y: Math.min(Math.max(EDGE, position.y), Math.max(EDGE, window.innerHeight - height - EDGE))
  };
}

/**
 * The floating shell: dragged anywhere by its body (the button still just
 * presses), remembered on this device, and faded while nobody is touching it.
 * A test that is due keeps it fully visible.
 */
function FloatingClock({ phase, running, progress, label, children }) {
  const ref = useRef(/** @type {HTMLDivElement | null} */ (null));
  const dragRef = useRef(/** @type {null | { id: number, dx: number, dy: number, moved: boolean, x: number, y: number }} */ (null));
  const idleTimerRef = useRef(0);
  const [position, setPosition] = useState(readPosition);
  const [dragging, setDragging] = useState(false);
  const [idle, setIdle] = useState(false);

  function wake() {
    setIdle(false);
    window.clearTimeout(idleTimerRef.current);
    idleTimerRef.current = window.setTimeout(() => {
      // A keyboard user parked on the button keeps it visible; a mouse click does not.
      if (!dragRef.current && !ref.current?.querySelector(":focus-visible")) setIdle(true);
    }, IDLE_AFTER_MS);
  }
  useEffect(() => { wake(); return () => window.clearTimeout(idleTimerRef.current); }, []);
  useEffect(() => {
    const fit = () => setPosition((current) => clampPosition(current, ref.current));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  function onPointerDown(event) {
    wake();
    if (event.button !== 0 || /** @type {Element} */ (event.target).closest("button")) return;
    const box = event.currentTarget.getBoundingClientRect();
    dragRef.current = { id: event.pointerId, dx: event.clientX - box.left, dy: event.clientY - box.top, moved: false, x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function onPointerMove(event) {
    const drag = dragRef.current;
    if (!drag || drag.id !== event.pointerId) return;
    if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 4) return;
    if (!drag.moved) { drag.moved = true; setDragging(true); }
    setPosition(clampPosition({ x: event.clientX - drag.dx, y: event.clientY - drag.dy }, ref.current));
  }
  function onPointerEnd(event) {
    const drag = dragRef.current;
    if (!drag || drag.id !== event.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    if (drag.moved) setPosition((current) => {
      try { window.localStorage.setItem(POSITION_KEY, JSON.stringify(current)); } catch { /* optional */ }
      return current;
    });
    wake();
  }

  const style = /** @type {import("react").CSSProperties} */ ({
    "--pomodoro-progress": progress,
    ...(position ? { left: `${position.x}px`, top: `${position.y}px`, right: "auto", bottom: "auto" } : {})
  });
  return <div ref={ref} className="pomodoro-study-clock" role="group" aria-label={label} data-phase={phase} data-running={running || undefined}
    data-idle={idle && !dragging && !["ready", "waiting"].includes(phase) ? "" : undefined} data-dragging={dragging || undefined} style={style}
    onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerEnd} onPointerCancel={onPointerEnd}
    onPointerEnter={wake} onPointerLeave={wake} onFocus={wake} onBlur={wake}>
    {children}
  </div>;
}

/** The one-second updates stay here, outside the expensive PDF workspace render. */
export function PomodoroStudy({ userId, run, page, virtualPage = false, active = true, blocked = false, deferSetup = false, busy = false, onStartTest, onOpenTest, onSaveClock }) {
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
      // While the page is open and in view, it is "seen"; a page closed without
      // saving its pause gives back the time after this (see restoreClock).
      if (!document.hidden) try { window.localStorage.setItem(`${key}.seen`, String(time)); } catch { /* optional */ }
    }
    tick();
    const timer = window.setInterval(tick, 1000);
    document.addEventListener("visibilitychange", tick);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", tick); };
  }, [active, key]);

  useEffect(() => {
    setClock((current) => reconcilePomodoroClock(current, { stage: run.stage, current_part: run.current_part, completed: run.completed_parts?.length }, Date.now(), blocked));
  }, [run.stage, run.current_part, run.completed_parts?.length, blocked]);

  useEffect(() => {
    if (!active || blocked || virtualPage || run.stage !== "reading" || !range || page < range.start_page || page > range.end_page) return;
    setClock((current) => current.phase === "focus" && current.part === range.part && pomodoroRemaining(current, Date.now()) > 0 && current.endPage !== page ? { ...current, endPage: page } : current);
  }, [active, blocked, virtualPage, page, range, run.stage, clock.phase]);

  // Saved here at once and on the server shortly after, stamped so the newest copy wins.
  const savedRef = useRef(clock);
  const pendingRef = useRef(null);
  const saveClockRef = useRef(onSaveClock);
  saveClockRef.current = onSaveClock;
  useEffect(() => {
    if (samePomodoroClock(savedRef.current, clock)) return;
    const stamped = { ...clock, updatedAt: Date.now() };
    savedRef.current = stamped;
    try { window.localStorage.setItem(key, JSON.stringify(stamped)); } catch { /* Timer remains usable when storage is unavailable. */ }
    window.clearTimeout(pendingRef.current?.timer);
    const send = () => { pendingRef.current = null; Promise.resolve(saveClockRef.current?.(stamped)).catch(() => undefined); };
    pendingRef.current = { send, timer: window.setTimeout(send, 800) };
  }, [key, clock]);
  useEffect(() => () => { const pending = pendingRef.current; if (pending) { window.clearTimeout(pending.timer); pending.send(); } }, []);
  // The timer runs only while the student is here: hiding the tab, closing the
  // page, switching workspace tab or leaving the reader stops it, and coming
  // back starts it again. A leaving page cannot wait for a render, so the
  // paused clock is stored and sent at once.
  const clockRef = useRef(clock);
  clockRef.current = clock;
  useEffect(() => {
    function leave() {
      const next = pausePomodoroAway(clockRef.current, Date.now());
      if (next === clockRef.current) return;
      const stamped = { ...next, updatedAt: Date.now() };
      clockRef.current = stamped;
      savedRef.current = stamped;
      try { window.localStorage.setItem(key, JSON.stringify(stamped)); } catch { /* optional */ }
      window.clearTimeout(pendingRef.current?.timer);
      pendingRef.current = null;
      Promise.resolve(saveClockRef.current?.(stamped)).catch(() => undefined);
      setClock(stamped);
    }
    function back() {
      if (document.hidden) return;
      setClock((current) => resumePomodoroBack(current, Date.now()));
    }
    if (!active) return undefined;
    const visibility = () => (document.hidden ? leave() : back());
    back();
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", leave);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", leave);
      leave();
    };
  }, [active, key]);
  // A newer copy from another device, once the run is reloaded, replaces this one.
  useEffect(() => {
    const server = run.pomodoro_clock;
    if (!server || newerPomodoroClock(savedRef.current, server) !== server || samePomodoroClock(savedRef.current, server)) return;
    savedRef.current = server;
    setClock(tickPomodoroClock(server, Date.now()));
  }, [run.pomodoro_clock]);
  useEffect(() => {
    document.addEventListener("pointerdown", unlockAudio, true);
    document.addEventListener("keydown", unlockAudio, true);
    return () => { document.removeEventListener("pointerdown", unlockAudio, true); document.removeEventListener("keydown", unlockAudio, true); };
  }, []);
  useEffect(() => { if (clock.phase === "focus" || clock.phase === "break") setSetupHidden(false); }, [clock.phase, clock.part]);
  const phaseRef = useRef(clock.phase);
  useEffect(() => {
    // A short buzz when reading or the break runs out, for a phone lying on the desk.
    const previous = phaseRef.current;
    phaseRef.current = clock.phase;
    if (["focus", "break"].includes(previous) && ["ready", "waiting"].includes(clock.phase)) {
      try { navigator.vibrate?.([120, 80, 120]); } catch { /* Vibration is optional. */ }
      // iPhones do not vibrate from the web, so a chime and the tab title carry the alert too.
      if (readPomodoroPreferences().sound) playChime();
      flagTitle(t(clock.phase === "ready" ? "pomodoro.ready" : "pomodoro.breakOver"));
    }
  }, [clock.phase, t]);

  if (!active || blocked || deferSetup) return null;
  const reading = run.stage === "reading";
  const timed = reading && ["focus", "break"].includes(clock.phase);
  const endPage = range?.question_count != null ? range.end_page
    : Number.isInteger(clock.endPage) && clock.endPage >= range?.start_page && clock.endPage <= range?.end_page ? clock.endPage : null;
  const openSetup = reading && clock.phase === "ready" && !setupHidden;
  const label = !reading ? t("pomodoro.openTest") : clock.phase === "ready" ? t("pomodoro.ready") : clock.phase === "waiting" ? t("pomodoro.start", { minutes: focusMinutes(readPomodoroPreferences().preset) }) : t(clock.phase === "break" ? (clock.long ? "pomodoro.longBreak" : "pomodoro.break") : clock.deadline === null ? "pomodoro.paused" : "pomodoro.focus");
  const phase = !reading ? "quiz" : timed && clock.deadline === null ? "paused" : clock.phase;
  const dots = pomodoroCycleDots(clock, run.completed_parts?.length);
  function startFocus() { setNow(Date.now()); setClock((current) => newPomodoroClock(run.current_part, Date.now(), "focus", { longAt: current.longAt, preset: readPomodoroPreferences().preset })); setSetupHidden(false); }
  function action() {
    if (!reading) onOpenTest();
    else if (clock.phase === "ready") setSetupHidden(false);
    else if (clock.phase === "waiting") startFocus();
    else setClock((current) => togglePomodoroClock(current, Date.now()));
  }
  return <>
    <FloatingClock phase={phase} running={timed && clock.deadline !== null} progress={pomodoroProgress(clock, now)} label={t("pomodoro.timer")}>
      <div className="pomodoro-study-text">
        <span className="pomodoro-study-time" role="timer" aria-live="off" dir="ltr">{timed ? pomodoroClockLabel(clock, now) : "00:00"}</span>
        <small>{label}</small>
        <span className="pomodoro-study-cycles" role="img" aria-label={t("pomodoro.cycles", { done: dots, total: POMODORO_LONG_BREAK_EVERY })}>{Array.from({ length: POMODORO_LONG_BREAK_EVERY }, (_, index) => <i key={index} className={index < dots ? "is-done" : ""} />)}</span>
      </div>
      <button type="button" disabled={busy} aria-label={timed ? t(clock.deadline === null ? "pomodoro.resume" : "pomodoro.pause") : label} onClick={action}>
        <svg className="pomodoro-study-ring" viewBox="0 0 52 52" aria-hidden="true"><circle className="is-track" cx="26" cy="26" r={RING_RADIUS} /><circle className="is-value" cx="26" cy="26" r={RING_RADIUS} pathLength="100" /></svg>
        <Icon name={timed && clock.deadline !== null ? "pause" : "play"} size={18} />
      </button>
    </FloatingClock>
    {openSetup && range && <PageTestSetup range={range} endPage={endPage} minutes={focusMinutes(clock.preset)} nextMinutes={focusMinutes(readPomodoroPreferences().preset)} busy={busy} onStart={onStartTest} onClose={() => setSetupHidden(true)} onReadMore={startFocus} />}
  </>;
}

/** Per-page scores for a page test, and the session recap once the final exam is graded. */
export function PomodoroResultDetails({ review, summary, final = false, busy = false, onOpenPage }) {
  const { t } = useI18n();
  const pages = pomodoroPageScores(review);
  if (!pages.length && !summary) return null;
  return <div className="pomodoro-result">
    {pages.length > 0 && <>
      <h3>{t("pomodoro.byPage")}</h3>
      <ul className="pomodoro-page-scores">
        {pages.map((item) => {
          const score = <><span>{t("pomodoro.pageShort", { page: item.page })}</span><strong dir="ltr">{item.correct}/{item.total}</strong></>;
          return <li key={item.page} className={item.weak ? "is-weak" : ""} style={/** @type {import("react").CSSProperties} */ ({ "--page-score": `${Math.round((item.correct / item.total) * 100)}%` })}>
            {item.weak && onOpenPage ? <button type="button" disabled={busy} aria-label={t("pomodoro.openPage", { page: item.page })} onClick={() => onOpenPage(item.page)}>{score}<Icon name="chevron-right" size={14} /></button> : score}
          </li>;
        })}
      </ul>
      {pages.some((item) => item.weak) && <p>{t(onOpenPage ? "pomodoro.weakPagesOpen" : "pomodoro.weakPages", { pages: pages.filter((item) => item.weak).map((item) => item.page).join(", ") })}</p>}
    </>}
    {summary && <>
      <h3>{t(final ? "pomodoro.sessionSummary" : "pomodoro.sessionSoFar")}</h3>
      <dl className="pomodoro-summary">
        <div><dt>{t("pomodoro.summaryCycles")}</dt><dd>{summary.tests.length}</dd></div>
        {summary.average_percent != null && <div><dt>{t("pomodoro.summaryAverage")}</dt><dd dir="ltr">{summary.average_percent}%</dd></div>}
        {summary.final_total > 0 && <div><dt>{t("pomodoro.summaryFinal")}</dt><dd dir="ltr">{summary.final_score}/{summary.final_total}</dd></div>}
      </dl>
    </>}
  </div>;
}
