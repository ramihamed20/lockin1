import { useEffect, useRef, useState } from "react";
import { ArrowLeft, MoreHorizontal, Pause, Play, X } from "lucide-react";
import { ConfirmDialog } from "../components/shared/ConfirmDialog.jsx";
import { useVisibleNow } from "../hooks/useVisibleNow.js";
import "./lock-in-live.css";

const copy = {
  en: {
    home: "Home", solo: "Solo", team: "Team", focused: "Focused", break: "Break",
    away: "Away", paused: "Paused", pause: "Pause", resume: "Resume", end: "End Lockin",
    leave: "Leave Session", members: "Members", controls: "Session controls",
    lock: "Lock joining", unlock: "Unlock joining", remove: "Remove", cancel: "Cancel",
    endConfirm: "End Lockin?", leaveConfirm: "Leave Session?", removeConfirm: "Remove member?",
    complete: "LOCKED IN", done: "Done", duration: "Duration", focusTime: "Focused",
    breakTime: "Break", remaining: "Remaining", elapsed: "Elapsed", reconnecting: "Reconnecting…"
  },
  ar: {
    home: "الرئيسية", solo: "فردي", team: "فريق", focused: "تركيز", break: "استراحة",
    away: "بعيد", paused: "متوقف", pause: "إيقاف مؤقت", resume: "استئناف", end: "إنهاء التركيز",
    leave: "مغادرة الجلسة", members: "الأعضاء", controls: "إدارة الجلسة",
    lock: "إغلاق الانضمام", unlock: "فتح الانضمام", remove: "إزالة", cancel: "إلغاء",
    endConfirm: "إنهاء التركيز؟", leaveConfirm: "مغادرة الجلسة؟", removeConfirm: "إزالة العضو؟",
    complete: "اكتمل التركيز", done: "تم", duration: "المدة", focusTime: "تركيز",
    breakTime: "استراحة", remaining: "المتبقي", elapsed: "المنقضي", reconnecting: "جارٍ إعادة الاتصال…"
  }
};

function clock(seconds) {
  const safe = Math.max(0, Math.floor(Number(seconds) || 0));
  const parts = [Math.floor(safe / 3600), Math.floor((safe % 3600) / 60), safe % 60];
  return (parts[0] ? parts : parts.slice(1)).map((value, index) =>
    index === 0 ? String(value) : String(value).padStart(2, "0")
  ).join(":");
}

function LiveSummary({ payload, labels, onHome }) {
  const { session, timing, member_count: memberCount } = payload;
  const duration = Math.max(0, Math.floor((new Date(session.ended_at).getTime() - new Date(session.started_at).getTime()) / 1000));
  return <main className="lm-shell lm-live" aria-label="Lockin Mode"><div className="lm-live-frame">
    <header className="lm-live-top"><span className="lm-live-brand">LOCKIN<span>.</span></span><button type="button" onClick={onHome}><ArrowLeft size={18} />{labels.home}</button></header>
    <section className="lm-live-summary" aria-labelledby="lm-live-summary-title"><p className="lm-live-kicker">{labels.complete}</p><h1 id="lm-live-summary-title" dir="ltr">{clock(duration)}</h1><p>{labels.duration}</p><div className="lm-live-summary-facts"><div><span>{labels.focusTime}</span><strong dir="ltr">{clock(timing.active_elapsed_seconds)}</strong></div><div><span>{labels.breakTime}</span><strong dir="ltr">{clock(timing.break_elapsed_seconds)}</strong></div>{session.team_id && <div><span>{labels.members}</span><strong>{memberCount}</strong></div>}</div><button className="lm-live-primary" type="button" onClick={onHome}>{labels.done}</button></section>
  </div></main>;
}

export default function LockInLive({ payload, busy, error, onAction, onHome, onPresence, onLeave, onTeamAction, onRefresh }) {
  const labels = copy[document.documentElement.lang?.startsWith("ar") ? "ar" : "en"];
  const { session, timing, participants = [], team } = payload;
  const teamMode = Boolean(session.team_id);
  const [confirm, setConfirm] = useState(null);
  const lastInput = useRef(Date.now());
  const presenceRef = useRef(payload.self_presence);
  const sendingRef = useRef(false);
  const tick = useVisibleNow(session.status === "active" || session.status === "on_break");
  const elapsedSinceSnapshot = Math.max(0, Math.floor((tick - (payload.received_at_ms || tick)) / 1000));
  const activeSeconds = Number(timing.active_elapsed_seconds || 0) + (
    session.status === "active" ? elapsedSinceSnapshot : 0
  );
  const remaining = session.planned_duration_seconds == null ? null : Math.max(
    0, Number(session.planned_duration_seconds) - activeSeconds
  );
  const onBreak = teamMode ? payload.self_presence === "break" : session.status === "on_break";
  const statusLabel = session.status === "paused" ? labels.paused : onBreak ? labels.break : labels.focused;

  useEffect(() => { presenceRef.current = payload.self_presence; }, [payload.self_presence]);
  useEffect(() => {
    if (["completed", "abandoned"].includes(session.status)) return undefined;
    const refresh = () => { void onRefresh(); };
    const interval = window.setInterval(refresh, 10000);
    return () => window.clearInterval(interval);
  }, [onRefresh, session.status]);

  useEffect(() => {
    if (!teamMode || session.status !== "active") return undefined;
    const send = async (presence) => {
      if (sendingRef.current || presenceRef.current === presence && presence === "away") return;
      sendingRef.current = true;
      try { await onPresence(presence); presenceRef.current = presence; }
      catch { /* The next heartbeat or refresh restores server state. */ }
      finally { sendingRef.current = false; }
    };
    const activity = () => {
      lastInput.current = Date.now();
      if (!document.hidden && presenceRef.current === "away") void send("focused");
    };
    const visibility = () => {
      if (document.hidden && presenceRef.current !== "break") void send("away");
      else if (!document.hidden && presenceRef.current === "away") void send("focused");
      if (!document.hidden) void onRefresh();
    };
    const heartbeat = () => {
      if (document.hidden) return;
      const next = presenceRef.current === "break" ? "break"
        : Date.now() - lastInput.current > 5 * 60 * 1000 ? "away" : "focused";
      void send(next);
    };
    heartbeat();
    const interval = window.setInterval(heartbeat, 25000);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pointerdown", activity, { passive: true });
    window.addEventListener("keydown", activity);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pointerdown", activity);
      window.removeEventListener("keydown", activity);
    };
  }, [onPresence, onRefresh, session.status, teamMode]);

  if (["completed", "abandoned"].includes(session.status)) {
    return <LiveSummary payload={payload} labels={labels} onHome={onHome} />;
  }

  return <main className="lm-shell lm-live" aria-label="Lockin Session"><div className="lm-live-frame">
    <header className="lm-live-top"><button type="button" onClick={onHome} aria-label={labels.home}><ArrowLeft size={18} /><span>{labels.home}</span></button><span className="lm-live-brand">LOCKIN<span>.</span></span>{teamMode && payload.is_host ? <details className="lm-live-more"><summary aria-label={labels.controls}><MoreHorizontal size={21} /></summary><div><button type="button" onClick={() => void onTeamAction("update", { joining_locked: !team.joining_locked })}>{team.joining_locked ? labels.unlock : labels.lock}</button><button type="button" className="danger" onClick={() => setConfirm({ type: "end" })}>{labels.end}</button></div></details> : <span className="lm-live-top-spacer" />}</header>
    <div className="lm-live-main"><section className="lm-live-clock" aria-label={remaining == null ? labels.elapsed : labels.remaining}><p className="lm-live-kicker" dir="auto">{team?.name || labels.solo}</p><h1 dir="ltr">{clock(remaining ?? activeSeconds)}</h1><p className="lm-live-status"><span className={onBreak ? "break" : ""} />{statusLabel}</p><div className="lm-live-meta"><span>{remaining == null ? labels.elapsed : labels.remaining}</span><span dir="ltr">{clock(activeSeconds)} {labels.elapsed}</span></div></section>
      {teamMode && <aside className="lm-live-presence" aria-label={labels.members}><h2>{labels.members}<span>{participants.length}</span></h2><ul>{participants.map((member) => <li key={member.member_id}><span className={`lm-live-dot ${member.presence}`} aria-hidden="true" /><strong dir="auto">{member.name}</strong><small>{labels[member.presence] || labels.away}</small>{payload.is_host && member.member_id !== team.self_member_id && <button type="button" aria-label={`${labels.remove}: ${member.name}`} onClick={() => setConfirm({ type: "kick", member })}><X size={16} /></button>}</li>)}</ul></aside>}
    </div>
    <footer className="lm-live-controls">{!teamMode && <button type="button" disabled={Boolean(busy)} onClick={() => void onAction(session.status === "paused" ? "resume" : "pause")}>{session.status === "paused" ? <Play size={18} /> : <Pause size={18} />}{session.status === "paused" ? labels.resume : labels.pause}</button>}{session.status !== "paused" && <button type="button" disabled={Boolean(busy)} onClick={() => { if (teamMode) void onPresence(onBreak ? "focused" : "break").catch(() => {}); else void onAction(onBreak ? "end-break" : "start-break"); }}>{onBreak ? labels.resume : labels.break}</button>}<button className="lm-live-secondary" type="button" onClick={() => setConfirm({ type: teamMode && !payload.is_host ? "leave" : "end" })}>{teamMode && !payload.is_host ? labels.leave : labels.end}</button></footer>
    {error && <p className="lm-live-error" role="alert">{error}</p>}
    <ConfirmDialog open={Boolean(confirm)} title={confirm?.type === "kick" ? labels.removeConfirm : confirm?.type === "leave" ? labels.leaveConfirm : labels.endConfirm} message="\u00a0" confirmLabel={confirm?.type === "kick" ? labels.remove : confirm?.type === "leave" ? labels.leave : labels.end} cancelLabel={labels.cancel} busy={Boolean(busy)} onCancel={() => setConfirm(null)} onConfirm={() => { const choice = confirm; setConfirm(null); if (choice?.type === "kick") void onTeamAction("kick", { member_id: choice.member.member_id }); else if (choice?.type === "leave") void onLeave(); else void onAction("complete"); }} />
  </div></main>;
}
