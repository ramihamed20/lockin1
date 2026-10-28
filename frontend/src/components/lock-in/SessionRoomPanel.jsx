import { Users, X } from "lucide-react";
import { useI18n } from "../I18nProvider.jsx";
import { TeamCode, lockInMemberName } from "../../pages/LockInLobby.jsx";
import { TeamDiscussion } from "./TeamDiscussion.jsx";

/** Same team and message contracts in the room and beside a Focus sheet. */
export function SessionRoomPanel({ payload, onClose = undefined, members = null }) {
  const { t } = useI18n();
  const { team, participants = [] } = payload;
  if (!team) return null;
  return <aside className="lm-room-panel" aria-label={t("lockIn.team")}>
    <header className="lm-room-panel-heading">
      <Users size={18} aria-hidden="true" /><strong dir="auto">{team.name}</strong>
      {onClose && <button type="button" className="lm-icon-button" onClick={onClose} aria-label={t("common.close")}><X size={18} /></button>}
    </header>
    <div className="lm-room-panel-body">
      {!team.closed_at && !team.joining_locked && team.invite_code && <TeamCode code={team.invite_code} compact />}
      {members || <details className="lm-room-members">
        <summary>{t("lockIn.members")} · {participants.length}</summary>
        <ul className="ui-group">{participants.map((member) => <li key={member.member_id} className="ui-row">
          <span className={`lm-live-dot is-${member.presence || "away"}`} aria-hidden="true" />
          <span className="ui-row-body" dir="auto">{lockInMemberName(member, t)}</span>
          <span className="ui-row-value">{t(member.presence === "focused" ? "lockIn.focused" : member.presence === "break" ? "lockIn.onBreak" : "lockIn.away")}</span>
        </li>)}</ul>
      </details>}
      <TeamDiscussion key={team.id} teamId={team.id} expanded />
    </div>
  </aside>;
}
