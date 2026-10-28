import { Link, useNavigate } from "react-router-dom";
import { clock, liveClock } from "../components/lock-in/liveSession.js";
import { useLiveConnection } from "../components/lock-in/useLiveConnection.js";
import { SessionNote } from "../components/lock-in/SessionNote.jsx";
import { SessionRoomPanel } from "../components/lock-in/SessionRoomPanel.jsx";
import { useEffect, useState } from "react";
import { ArrowUpRight, BookOpen, Coffee, Pause, Play, X } from "lucide-react";
import { useI18n } from "../components/I18nProvider.jsx";
import { ConfirmDialog } from "../components/shared/ConfirmDialog.jsx";
import { useVisibleNow } from "../hooks/useVisibleNow.js";
import { LockInBar, LockInMenu, lockInMemberName } from "./LockInLobby.jsx";
import "./lock-in-lobby.css";
import "./lock-in-live.css";

const PRESENCE_LABEL = { focused: "lockIn.focused", break: "lockIn.onBreak", away: "lockIn.away" };

function LiveSummary({ payload, onHome }) {
  const { t } = useI18n();
  const [noteDirty, setNoteDirty] = useState(false);
  const [exitOpen, setExitOpen] = useState(false);
  const goHome = () => noteDirty ? setExitOpen(true) : onHome();
  const { session, timing, member_count: memberCount } = payload;
  const duration = Math.max(0, Math.floor((new Date(session.ended_at).getTime() - new Date(session.started_at).getTime()) / 1000));
  return <main className="lm-shell lm-live" aria-label={t("lockIn.sessionLabel")}>
    <LockInBar onBack={goHome} backLabel={t("lockIn.home")} />
    <section className="lm-page lm-live-summary" aria-labelledby="lm-live-summary-title">
      <header className="lm-heading">
        <h1 id="lm-live-summary-title">{t("lockIn.complete")}</h1>
        <p dir="auto">{payload.team?.name || session.team_name || t("lockIn.solo")}</p>
      </header>
      <div className="lm-summary-total" aria-label={`${t("lockIn.totalTime")} ${clock(duration)}`}><strong dir="ltr">{clock(duration)}</strong><span>{t("lockIn.totalTime")}</span></div>
      <dl className="ui-group lm-summary-facts">
        <div className="ui-row"><dt className="ui-row-body"><span>{t("lockIn.focusTime")}</span></dt><dd className="ui-row-value" dir="ltr">{clock(payload.self_active_seconds ?? timing.active_elapsed_seconds)}</dd></div>
        <div className="ui-row"><dt className="ui-row-body"><span>{t("lockIn.breakTime")}</span></dt><dd className="ui-row-value" dir="ltr">{clock(timing.break_elapsed_seconds)}</dd></div>
        {session.team_id && <div className="ui-row"><dt className="ui-row-body"><span>{t("lockIn.members")}</span></dt><dd className="ui-row-value">{memberCount}</dd></div>}
      </dl>
      {session.goal && <p dir="auto" className="lm-session-goal">{session.goal}</p>}
      {(!session.team_id || session.experience_version === 2) && <SessionNote payload={payload} onDirtyChange={setNoteDirty} />}
      <button className="btn btn-primary lm-submit" type="button" onClick={goHome}>{t("lockIn.done")}</button>
    </section>
    <ConfirmDialog open={exitOpen} title={t("lockIn.unsavedNote")} message={t("lockIn.unsavedNoteMessage")} confirmLabel={t("lockIn.leaveWithoutSaving")} onCancel={() => setExitOpen(false)} onConfirm={onHome} />
  </main>;
}

export default function LockInLive({ payload, busy, error, onAction, onHome, onPresence, onLeave, onTeamAction, onRefresh }) {
  const { t } = useI18n();
  const { session, participants = [], team } = payload;
  const teamMode = Boolean(session.team_id);
  const [confirm, setConfirm] = useState(null);
  const [noteDirty, setNoteDirty] = useState(false);
  const navigate = useNavigate();
  useVisibleNow(session.status === "active" || session.status === "on_break");
  const { personal: activeSeconds, remaining } = liveClock(payload, window.performance.now());
  useLiveConnection({ payload, onRefresh, onPresence });
  const onBreak = teamMode ? payload.self_presence === "break" : session.status === "on_break";
  const paused = session.status === "paused";
  const statusKey = paused ? "lockIn.paused" : onBreak ? "lockIn.onBreak" : "lockIn.focused";
  const statusTone = paused ? "is-paused" : onBreak ? "is-break" : "is-focused";

  useEffect(() => {
    if (remaining !== 0 || session.status !== "active") return undefined;
    void onRefresh();
    return undefined;
  }, [remaining, session.status, onRefresh]);

  if (["completed", "abandoned"].includes(session.status)) {
    return <LiveSummary payload={payload} onHome={onHome} />;
  }

  const leaving = teamMode && !payload.is_host;
  const confirmCopy = ["home", "sheet"].includes(confirm?.type)
    ? { title: t("lockIn.unsavedNote"), message: t("lockIn.unsavedNoteMessage"), label: t("lockIn.leaveWithoutSaving") }
    : confirm?.type === "kick"
    ? { title: t("lockIn.removeConfirm", { name: confirm.name }), message: t("lockIn.removeMessage"), label: t("lockIn.remove") }
    : confirm?.type === "leave"
      ? { title: t("lockIn.leaveSessionConfirm"), message: t("lockIn.leaveSessionMessage"), label: t("lockIn.leaveSession") }
      : { title: t("lockIn.endConfirm"), message: teamMode ? t("lockIn.endTeamSessionMessage") : t("lockIn.endSoloMessage"), label: t("lockIn.endSession") };

  const progress = session.planned_duration_seconds > 0 && remaining != null
    ? Math.max(0, Math.min(100, (1 - remaining / session.planned_duration_seconds) * 100)) : 0;
  const members = teamMode && <section className="ui-group-block lm-live-presence" aria-labelledby="lm-live-members">
        <h2 className="ui-group-title" id="lm-live-members">{t("lockIn.members")} · {participants.length}</h2>
        <ul className="ui-group" aria-labelledby="lm-live-members">{participants.map((member) => {
          const name = lockInMemberName(member, t);
          return <li key={member.member_id}><div className="ui-row">
            <span className="lm-member-avatar" aria-hidden="true">{name.slice(0, 1)}<i className={`lm-live-dot is-${member.presence || "away"}`} /></span>
            <span className="ui-row-body"><strong dir="auto">{name}</strong></span>
            <span className="ui-row-value">{t(PRESENCE_LABEL[member.presence] || "lockIn.away")}</span>
            {payload.is_host && member.member_id !== team.self_member_id && <button className="lm-icon-button" type="button" aria-label={`${t("lockIn.remove")}: ${name}`} onClick={() => setConfirm({ type: "kick", member, name })}><X size={16} aria-hidden="true" /></button>}
          </div></li>;
        })}</ul>
      </section>;

  return <main className={`lm-shell lm-live${teamMode ? " is-team" : ""}`} aria-label={t("lockIn.sessionLabel")}>
    <LockInBar
      onBack={() => noteDirty ? setConfirm({ type: "home" }) : onHome()}
      backLabel={t("lockIn.home")}
      end={teamMode && payload.is_host ? <LockInMenu label={t("lockIn.sessionControls")} items={[
        { label: team.joining_locked ? t("lockIn.unlockJoining") : t("lockIn.lockJoining"), onSelect: () => void onTeamAction("update", { joining_locked: !team.joining_locked }) },
        { label: t("lockIn.endSession"), danger: true, onSelect: () => setConfirm({ type: "end" }) }
      ]} /> : null}
    >
      <span className="lm-bar-title" dir="auto">{team?.name || t("lockIn.solo")}</span>
    </LockInBar>
    {session.goal && <p className="lm-session-goal" dir="auto">{session.goal}</p>}
    <div className={`lm-live-main${teamMode ? " lm-room-layout" : ""}`}>
      <div className="lm-live-study">
      <section className="lm-live-clock" aria-label={remaining == null ? t("lockIn.timeFocused") : t("lockIn.timeRemaining")}>
        <div className={`lm-clock-face ${statusTone}`}>
          <svg className="lm-clock-ring" viewBox="0 0 300 300" aria-hidden="true">
            <circle className="lm-clock-track" cx="150" cy="150" r="144" />
            <circle className="lm-clock-progress" cx="150" cy="150" r="144" pathLength="100" strokeDasharray={`${progress} 100`} />
          </svg>
          <div className="lm-clock-content"><span className="lm-clock-label">{t(remaining == null ? "lockIn.timeFocused" : "lockIn.timeRemaining")}</span><h1 dir="ltr">{clock(remaining ?? activeSeconds)}</h1></div>
        </div>
        <p className={`lm-status ${statusTone}`}><span className="lm-live-dot" aria-hidden="true" />{t(statusKey)}</p>
        {remaining != null && <p className="lm-live-meta">{t("lockIn.focusedSoFar", { time: clock(activeSeconds) })}</p>}
      </section>
      {payload.study_target?.reader_path && <section className="lm-study-target">
        <span className="lm-sheet-symbol"><BookOpen size={24} aria-hidden="true" /></span>
        <div className="lm-sheet-copy"><strong dir="auto">{payload.study_target.title}</strong>
          {payload.study_target.page_end && <span>{t("lockIn.pageRange", { start: payload.study_target.page_start, end: payload.study_target.page_end })}</span>}
        </div>
        <Link className="btn btn-primary" to={payload.study_target.reader_path} state={{ lockInPanelOpen: teamMode }} onClick={(event) => { if (noteDirty) { event.preventDefault(); setConfirm({ type: "sheet" }); } }}>{t("lockIn.openSheet")}<ArrowUpRight className="lm-flip" size={16} aria-hidden="true" /></Link>
      </section>}
      {(!teamMode || session.experience_version === 2) && <div className="lm-live-extras"><SessionNote payload={payload} onDirtyChange={setNoteDirty} /></div>}
      </div>
      {teamMode && <SessionRoomPanel payload={payload} members={members} />}
    </div>
    <footer className="lm-live-controls">
      {!teamMode && <button className="btn btn-soft" type="button" disabled={Boolean(busy)} onClick={() => void onAction(paused ? "resume" : "pause")}>{paused ? <Play size={17} aria-hidden="true" /> : <Pause size={17} aria-hidden="true" />}{paused ? t("lockIn.resume") : t("lockIn.pause")}</button>}
      {!paused && <button className="btn btn-soft" type="button" disabled={Boolean(busy)} onClick={() => { if (teamMode) void onPresence(onBreak ? "focused" : "break").catch(() => {}); else void onAction(onBreak ? "end-break" : "start-break"); }}>{onBreak ? <Play size={17} aria-hidden="true" /> : <Coffee size={17} aria-hidden="true" />}{onBreak ? t("lockIn.backToFocus") : t("lockIn.takeBreak")}</button>}
      <button className="btn btn-soft lm-live-end" type="button" disabled={Boolean(busy)} onClick={() => setConfirm({ type: leaving ? "leave" : "end" })}>{leaving ? t("lockIn.leaveSession") : t("lockIn.endSession")}</button>
    </footer>
    {error && <p className="lm-error lm-live-error" role="alert">{error}</p>}
    <ConfirmDialog open={Boolean(confirm)} title={confirmCopy.title} message={noteDirty && ["end", "leave"].includes(confirm?.type) ? `${confirmCopy.message} ${t("lockIn.unsavedNoteMessage")}` : confirmCopy.message} confirmLabel={confirmCopy.label} cancelLabel={t("common.cancel")} busy={Boolean(busy)} onCancel={() => setConfirm(null)} onConfirm={() => { const choice = confirm; setConfirm(null); if (choice?.type === "home") onHome(); else if (choice?.type === "sheet") navigate(payload.study_target.reader_path, { state: { lockInPanelOpen: teamMode } }); else if (choice?.type === "kick") void onTeamAction("kick", { member_id: choice.member.member_id }); else if (choice?.type === "leave") void onLeave(); else void onAction("complete"); }} />
  </main>;
}
