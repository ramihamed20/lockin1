import { useId, useState } from "react";
import { Tab, TabList } from "../ui/interactive.jsx";
import { ChevronDown, UserPlus, Users, X } from "lucide-react";
import { useI18n } from "../I18nProvider.jsx";
import { TeamCode, lockInMemberName } from "../../pages/LockInLobby.jsx";
import { TeamDiscussion } from "./TeamDiscussion.jsx";

/** Same team and message contracts in the room and beside a Focus sheet. */
export function SessionRoomPanel({ payload, onClose = undefined, members = null }) {
  const { t } = useI18n();
  const { team, participants = [] } = payload;
  const [section, setSection] = useState("chat");
  const id = useId();
  if (!team) return null;
  return <aside className="lm-room-panel" aria-label={t("lockIn.team")}>
    <header className="lm-room-panel-heading">
      <Users size={18} aria-hidden="true" /><strong dir="auto">{team.name}</strong>
      <span className="lm-avatar-stack" aria-hidden="true">{participants.slice(0, 3).map((member) => <span key={member.member_id}>{lockInMemberName(member, t).slice(0, 1)}</span>)}</span>
      {onClose && <button type="button" className="lm-icon-button" onClick={onClose} aria-label={t("common.close")}><X size={18} /></button>}
    </header>
    <TabList className="ui-segmented lm-room-tabs" label={t("lockIn.team")} value={section} onChange={setSection}>
      <Tab value="chat" id={`${id}-chat-tab`} aria-controls={`${id}-panel`}>{t("lockIn.discussion")}</Tab>
      <Tab value="members" id={`${id}-members-tab`} aria-controls={`${id}-panel`}>{t("lockIn.members")} <span className="lm-count">{participants.length}</span></Tab>
    </TabList>
    {!team.closed_at && !team.joining_locked && team.invite_code && <details className="lm-room-invite">
      <summary><UserPlus size={16} aria-hidden="true" /><span>{t("lockIn.inviteFriends")}</span><b dir="ltr">{team.invite_code}</b><ChevronDown size={14} aria-hidden="true" /></summary>
      <TeamCode code={team.invite_code} compact />
    </details>}
    <div className="lm-room-panel-body" id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${section}-tab`}>
      {section === "members" && (members || <section className="lm-room-members">
        <ul className="ui-group">{participants.map((member) => <li key={member.member_id} className="ui-row">
          <span className="lm-member-avatar" aria-hidden="true">{lockInMemberName(member, t).slice(0, 1)}<i className={`lm-live-dot is-${member.presence || "away"}`} /></span>
          <span className="ui-row-body" dir="auto">{lockInMemberName(member, t)}</span>
          <span className="ui-row-value">{t(member.presence === "focused" ? "lockIn.focused" : member.presence === "break" ? "lockIn.onBreak" : "lockIn.away")}</span>
        </li>)}</ul>
      </section>)}
      <div hidden={section !== "chat"}><TeamDiscussion key={team.id} teamId={team.id} expanded active={section === "chat"} /></div>
    </div>
  </aside>;
}
