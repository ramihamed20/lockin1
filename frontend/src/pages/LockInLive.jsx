import { Link, useNavigate } from "react-router-dom";
import { clock, liveClock } from "../components/lock-in/liveSession.js";
import { useLiveConnection } from "../components/lock-in/useLiveConnection.js";
import { TeamGoalProgress } from "../components/lock-in/TeamGoalProgress.jsx";
import { SessionNote } from "../components/lock-in/SessionNote.jsx";
import { SessionRoomPanel } from "../components/lock-in/SessionRoomPanel.jsx";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ArrowUpRight, BookOpen, Coffee, Focus, Pause, Play, Users, Crown, X } from "lucide-react";
import { useI18n } from "../components/I18nProvider.jsx";
import { ConfirmDialog } from "../components/shared/ConfirmDialog.jsx";
import { useVisibleNow } from "../hooks/useVisibleNow.js";
import { LockInBar, LockInMenu, lockInMemberName } from "./LockInLobby.jsx";
import "./lock-in-lobby.css";
import "./lock-in-live.css";
import "../components/lock-in/team-goals.css";

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

export default function LockInLive({ payload, busy, error, onAction, onHome, onPresence, onLeave, onTeamAction, onRefresh, onGoal, onExit = onHome }) {
  const { t } = useI18n();
  const { session, participants = [], team } = payload;
  const teamMode = Boolean(session.team_id);
  const [roomHidden, setRoomHidden] = useState(false);
  const roomId = useId();
  const roomToggleRef = useRef(null);
  const closeRoom = useCallback(() => { setRoomHidden(true); roomToggleRef.current?.focus({ preventScroll: true }); }, []);
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

  useEffect(() => {
    if (!teamMode || roomHidden || ["completed", "abandoned"].includes(session.status)) return undefined;
    const escape = (event) => {
      if (event.defaultPrevented || event.isComposing || event.key !== "Escape" || !document.getElementById(roomId)?.contains(event.target)) return;
      event.preventDefault(); closeRoom();
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [teamMode, roomHidden, roomId, closeRoom, session.status]);

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
            <span className="ui-row-body"><strong dir="auto">{name}</strong>{member.role === "owner" && <small className="lm-live-host"><Crown size={12} aria-hidden="true" />{t("lockIn.host")}</small>}</span>
            <span className={`ui-row-value lm-presence-label is-${member.presence || "away"}`}>{t(PRESENCE_LABEL[member.presence] || "lockIn.away")}</span>
            {payload.is_host && member.member_id !== team.self_member_id && <button className="lm-icon-button" type="button" aria-label={`${t("lockIn.remove")}: ${name}`} onClick={() => setConfirm({ type: "kick", member, name })}><X size={16} aria-hidden="true" /></button>}
          </div></li>;
        })}</ul>
      </section>;

  return <main className={`lm-shell lm-live${teamMode ? " is-team" : ""}${teamMode && roomHidden ? " is-room-hidden" : ""}`} aria-label={t("lockIn.sessionLabel")}>
    <LockInBar
      onBack={() => noteDirty ? setConfirm({ type: "home" }) : (teamMode ? onExit() : onHome())}
      backLabel={teamMode ? "End Lockin" : t("lockIn.home")}
      end={teamMode ? <div className="lm-live-top-actions">
        <button ref={roomToggleRef} className="lm-live-team-toggle" type="button" aria-label={t("lockIn.team")} aria-expanded={!roomHidden} aria-controls={roomId} onClick={() => { if (roomHidden) setRoomHidden(false); else closeRoom(); }}><Users size={17} aria-hidden="true" /><span>{participants.length}</span></button>
        {payload.is_host && <LockInMenu label={t("lockIn.sessionControls")} items={[
          { label: team.joining_locked ? t("lockIn.unlockJoining") : t("lockIn.lockJoining"), onSelect: () => void onTeamAction("update", { joining_locked: !team.joining_locked }) },
          { label: t("lockIn.endSession"), danger: true, onSelect: () => setConfirm({ type: "end" }) }
        ]} />}
      </div> : null}
    >
      <span className="lm-bar-title lm-live-team-title">{teamMode && <span className="lm-live-team-mark" aria-hidden="true">{team?.image_url ? <img src={team.image_url} alt="" /> : <Users size={19} />}</span>}<span dir="auto">{team?.name || t("lockIn.solo")}</span></span>
    </LockInBar>
    <div className={`lm-live-main${teamMode ? " lm-room-layout" : ""}`}>
      <div className="lm-live-study">
      {teamMode && <TeamGoalProgress payload={payload} onSave={onGoal} onRefresh={onRefresh} />}
      <section className="lm-live-clock" aria-label={remaining == null ? t("lockIn.timeFocused") : t("lockIn.timeRemaining")}>
        <div className={teamMode ? "visually-hidden" : "lm-study-heading"}><span className="lm-focus-symbol" aria-hidden="true"><Focus size={22} /></span><span>{t(teamMode ? "lockIn.teamSession" : "lockIn.title")}</span><p className={`lm-status ${statusTone}`}><span className="lm-live-dot" aria-hidden="true" />{t(statusKey)}</p></div>
        {session.goal && <p className="lm-session-goal" dir="auto">{session.goal}</p>}
        <div className={`lm-clock-face ${statusTone}`}>
          <span className={teamMode ? "visually-hidden" : "lm-clock-label"}>{t(remaining == null ? "lockIn.timeFocused" : "lockIn.timeRemaining")}</span>
          <h1 dir="ltr">{clock(remaining ?? activeSeconds)}</h1>
        </div>
        {remaining != null && <div className={teamMode ? "lm-timeline visually-hidden" : "lm-timeline"}><progress max="100" value={progress} aria-label={t("lockIn.focusTime")} /><div><span>{t("lockIn.focusedSoFar", { time: clock(activeSeconds) })}</span><span dir="ltr">{clock(session.planned_duration_seconds)}</span></div></div>}
    <div className="lm-live-controls">
      {!teamMode && <button className="btn btn-soft" type="button" disabled={Boolean(busy)} onClick={() => void onAction(paused ? "resume" : "pause")}>{paused ? <Play size={17} aria-hidden="true" /> : <Pause size={17} aria-hidden="true" />}{paused ? t("lockIn.resume") : t("lockIn.pause")}</button>}
      {!paused && <button className="btn btn-soft" type="button" disabled={Boolean(busy)} onClick={() => { if (teamMode) void onPresence(onBreak ? "focused" : "break").catch(() => {}); else void onAction(onBreak ? "end-break" : "start-break"); }}>{onBreak ? <Play size={17} aria-hidden="true" /> : <Coffee size={17} aria-hidden="true" />}{onBreak ? t("lockIn.backToFocus") : t("lockIn.takeBreak")}</button>}
      <button className="btn btn-soft lm-live-end" type="button" disabled={Boolean(busy)} onClick={() => setConfirm({ type: leaving ? "leave" : "end" })}>{leaving ? t("lockIn.leaveSession") : t("lockIn.endSession")}</button>
    </div>
      </section>
      {payload.study_target?.reader_path && <section className="lm-study-target">
        <span className="lm-sheet-symbol"><BookOpen size={24} aria-hidden="true" /></span>
        <div className="lm-sheet-copy"><strong dir="auto">{payload.study_target.title}</strong>
          {payload.study_target.page_end && <span>{t("lockIn.pageRange", { start: `⁦${payload.study_target.page_start}`, end: `${payload.study_target.page_end}⁩` })}</span>}
        </div>
        <Link className="btn btn-primary" to={payload.study_target.reader_path} state={{ lockInPanelOpen: teamMode && !roomHidden }} onClick={(event) => { if (noteDirty) { event.preventDefault(); setConfirm({ type: "sheet" }); } }}>{t("lockIn.openSheet")}<ArrowUpRight className="lm-flip" size={16} aria-hidden="true" /></Link>
      </section>}
      {(!teamMode || session.experience_version === 2) && <div className="lm-live-extras"><SessionNote payload={payload} onDirtyChange={setNoteDirty} /></div>}
      </div>
      {teamMode && <SessionRoomPanel payload={payload} members={members} variant="session" hidden={roomHidden} panelId={roomId} />}
    </div>
    {error && <p className="lm-error lm-live-error" role="alert">{error}</p>}
    <ConfirmDialog open={Boolean(confirm)} title={confirmCopy.title} message={noteDirty && ["end", "leave"].includes(confirm?.type) ? `${confirmCopy.message} ${t("lockIn.unsavedNoteMessage")}` : confirmCopy.message} confirmLabel={confirmCopy.label} cancelLabel={t("common.cancel")} busy={Boolean(busy)} onCancel={() => setConfirm(null)} onConfirm={() => { const choice = confirm; setConfirm(null); if (choice?.type === "home") { if (teamMode) onExit(); else onHome(); } else if (choice?.type === "sheet") navigate(payload.study_target.reader_path, { state: { lockInPanelOpen: teamMode && !roomHidden } }); else if (choice?.type === "kick") void onTeamAction("kick", { member_id: choice.member.member_id }); else if (choice?.type === "leave") void onLeave(); else void onAction("complete"); }} />
  </main>;
}
