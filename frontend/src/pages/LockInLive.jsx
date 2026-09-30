import { useEffect, useRef, useState } from "react";
import { Coffee, Pause, Play, X } from "lucide-react";
import { useI18n } from "../components/I18nProvider.jsx";
import { ConfirmDialog } from "../components/shared/ConfirmDialog.jsx";
import { useVisibleNow } from "../hooks/useVisibleNow.js";
import { LockInBar, LockInMenu, lockInMemberName } from "./LockInLobby.jsx";
import "./lock-in-lobby.css";
import "./lock-in-live.css";

function clock(seconds) {
  const safe = Math.max(0, Math.floor(Number(seconds) || 0));
  const parts = [Math.floor(safe / 3600), Math.floor((safe % 3600) / 60), safe % 60];
  return (parts[0] ? parts : parts.slice(1)).map((value, index) =>
    index === 0 ? String(value) : String(value).padStart(2, "0")
  ).join(":");
}

const PRESENCE_LABEL = { focused: "lockIn.focused", break: "lockIn.onBreak", away: "lockIn.away" };

function LiveSummary({ payload, onHome }) {
  const { t } = useI18n();
  const { session, timing, member_count: memberCount } = payload;
  const duration = Math.max(0, Math.floor((new Date(session.ended_at).getTime() - new Date(session.started_at).getTime()) / 1000));
  return <main className="lm-shell lm-live" aria-label={t("lockIn.sessionLabel")}>
    <LockInBar onBack={onHome} backLabel={t("lockIn.home")} />
    <section className="lm-page lm-live-summary" aria-labelledby="lm-live-summary-title">
      <header className="lm-heading">
        <h1 id="lm-live-summary-title">{t("lockIn.complete")}</h1>
        <p dir="auto">{payload.team?.name || session.team_name || t("lockIn.solo")}</p>
      </header>
      <div className="lm-summary-total" aria-label={`${t("lockIn.totalTime")} ${clock(duration)}`}><strong dir="ltr">{clock(duration)}</strong><span>{t("lockIn.totalTime")}</span></div>
      <dl className="ui-group lm-summary-facts">
        <div className="ui-row"><dt className="ui-row-body"><span>{t("lockIn.focusTime")}</span></dt><dd className="ui-row-value" dir="ltr">{clock(timing.active_elapsed_seconds)}</dd></div>
        <div className="ui-row"><dt className="ui-row-body"><span>{t("lockIn.breakTime")}</span></dt><dd className="ui-row-value" dir="ltr">{clock(timing.break_elapsed_seconds)}</dd></div>
        {session.team_id && <div className="ui-row"><dt className="ui-row-body"><span>{t("lockIn.members")}</span></dt><dd className="ui-row-value">{memberCount}</dd></div>}
      </dl>
      <button className="btn btn-primary lm-submit" type="button" onClick={onHome}>{t("lockIn.done")}</button>
    </section>
  </main>;
}

export default function LockInLive({ payload, busy, error, onAction, onHome, onPresence, onLeave, onTeamAction, onRefresh }) {
  const { t } = useI18n();
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
  const paused = session.status === "paused";
  const statusKey = paused ? "lockIn.paused" : onBreak ? "lockIn.onBreak" : "lockIn.focused";
  const statusTone = paused ? "is-paused" : onBreak ? "is-break" : "is-focused";

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
    return <LiveSummary payload={payload} onHome={onHome} />;
  }

  const leaving = teamMode && !payload.is_host;
  const confirmCopy = confirm?.type === "kick"
    ? { title: t("lockIn.removeConfirm", { name: confirm.name }), message: t("lockIn.removeMessage"), label: t("lockIn.remove") }
    : confirm?.type === "leave"
      ? { title: t("lockIn.leaveSessionConfirm"), message: t("lockIn.leaveSessionMessage"), label: t("lockIn.leaveSession") }
      : { title: t("lockIn.endConfirm"), message: teamMode ? t("lockIn.endTeamSessionMessage") : t("lockIn.endSoloMessage"), label: t("lockIn.endSession") };

  return <main className={`lm-shell lm-live${teamMode ? " is-team" : ""}`} aria-label={t("lockIn.sessionLabel")}>
    <LockInBar
      onBack={onHome}
      backLabel={t("lockIn.home")}
      end={teamMode && payload.is_host ? <LockInMenu label={t("lockIn.sessionControls")} items={[
        { label: team.joining_locked ? t("lockIn.unlockJoining") : t("lockIn.lockJoining"), onSelect: () => void onTeamAction("update", { joining_locked: !team.joining_locked }) },
        { label: t("lockIn.endSession"), danger: true, onSelect: () => setConfirm({ type: "end" }) }
      ]} /> : null}
    >
      <span className="lm-bar-title" dir="auto">{team?.name || t("lockIn.solo")}</span>
    </LockInBar>
    <div className="lm-live-main">
      <section className="lm-live-clock" aria-label={remaining == null ? t("lockIn.timeFocused") : t("lockIn.timeRemaining")}>
        <h1 dir="ltr">{clock(remaining ?? activeSeconds)}</h1>
        <p className={`lm-status ${statusTone}`}><span className="lm-live-dot" aria-hidden="true" />{t(statusKey)}</p>
        {remaining != null && <p className="lm-live-meta">{t("lockIn.focusedSoFar", { time: clock(activeSeconds) })}</p>}
      </section>
      {teamMode && <section className="ui-group-block lm-live-presence" aria-labelledby="lm-live-members">
        <h2 className="ui-group-title" id="lm-live-members">{t("lockIn.members")} · {participants.length}</h2>
        <ul className="ui-group" aria-labelledby="lm-live-members">{participants.map((member) => {
          const name = lockInMemberName(member, t);
          return <li key={member.member_id}><div className="ui-row">
            <span className={`lm-live-dot is-${member.presence || "away"}`} aria-hidden="true" />
            <span className="ui-row-body"><strong dir="auto">{name}</strong></span>
            <span className="ui-row-value">{t(PRESENCE_LABEL[member.presence] || "lockIn.away")}</span>
            {payload.is_host && member.member_id !== team.self_member_id && <button className="lm-icon-button" type="button" aria-label={`${t("lockIn.remove")}: ${name}`} onClick={() => setConfirm({ type: "kick", member, name })}><X size={16} aria-hidden="true" /></button>}
          </div></li>;
        })}</ul>
      </section>}
    </div>
    <footer className="lm-live-controls">
      {!teamMode && <button className="btn btn-soft" type="button" disabled={Boolean(busy)} onClick={() => void onAction(paused ? "resume" : "pause")}>{paused ? <Play size={17} aria-hidden="true" /> : <Pause size={17} aria-hidden="true" />}{paused ? t("lockIn.resume") : t("lockIn.pause")}</button>}
      {!paused && <button className="btn btn-soft" type="button" disabled={Boolean(busy)} onClick={() => { if (teamMode) void onPresence(onBreak ? "focused" : "break").catch(() => {}); else void onAction(onBreak ? "end-break" : "start-break"); }}>{onBreak ? <Play size={17} aria-hidden="true" /> : <Coffee size={17} aria-hidden="true" />}{onBreak ? t("lockIn.backToFocus") : t("lockIn.takeBreak")}</button>}
      <button className="btn btn-soft lm-live-end" type="button" onClick={() => setConfirm({ type: leaving ? "leave" : "end" })}>{leaving ? t("lockIn.leaveSession") : t("lockIn.endSession")}</button>
    </footer>
    {error && <p className="lm-error lm-live-error" role="alert">{error}</p>}
    <ConfirmDialog open={Boolean(confirm)} title={confirmCopy.title} message={confirmCopy.message} confirmLabel={confirmCopy.label} cancelLabel={t("common.cancel")} busy={Boolean(busy)} onCancel={() => setConfirm(null)} onConfirm={() => { const choice = confirm; setConfirm(null); if (choice?.type === "kick") void onTeamAction("kick", { member_id: choice.member.member_id }); else if (choice?.type === "leave") void onLeave(); else void onAction("complete"); }} />
  </main>;
}
