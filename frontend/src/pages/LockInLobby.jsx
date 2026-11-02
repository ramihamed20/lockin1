import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, ChevronRight, Copy, Camera, Focus, LogOut, KeyRound, Timer, UserPlus, Users, X } from "lucide-react";
import { LockInMenu } from "../components/lock-in/LockInMenu.jsx";
import LockInFriends from "../components/lock-in/LockInFriends.jsx";
import { focusApi } from "../api/focus.js";
import { useI18n } from "../components/I18nProvider.jsx";
import { ConfirmDialog } from "../components/shared/ConfirmDialog.jsx";
import { UserAvatar } from "../components/shared/UserAvatar.jsx";
import { EmptyState, ErrorPanel, LoadingPanel } from "../components/ui/index.jsx";
import { RadioGroup, RadioOption, Switch, Tab, TabList } from "../components/ui/interactive.jsx";
import "./lock-in-lobby.css";

export { LockInMenu };

const DURATIONS = [25, 45, 60, 90];

/** The server names anonymous members "Anonymous 01"; show that in the reader's language. */
export function lockInMemberName(member, t) {
  const match = member?.anonymous && /^Anonymous ([0-9A-F]+)$/.exec(String(member.name || ""));
  return match ? t("lockIn.anonymousName", { number: match[1] }) : member?.name || "";
}

function initial(name) {
  return String(name || "?").trim().slice(0, 1).toUpperCase() || "?";
}

/** The bar every Lock-in Mode screen shares: the way out at the start, the
 *  section switch in the middle, and room for one control at the end. */
export function LockInBar({ onBack, backLabel, backIcon = "back", children = null, end = null }) {
  return <header className="lm-bar">
    <div className="lm-bar-start">
      <button className="btn btn-soft compact lm-bar-back" type="button" onClick={onBack} aria-label={backLabel}>
        {backIcon === "close" ? <X size={17} aria-hidden="true" /> : <ArrowLeft className="lm-flip" size={17} aria-hidden="true" />}
        <span>{backLabel}</span>
      </button>
    </div>
    <div className="lm-bar-center">{children}</div>
    <div className="lm-bar-end">{end}</div>
  </header>;
}

function TeamPhotoInput({ imageUrl = null, file = null, onChange, busy = false }) {
  const { t } = useI18n();
  const [preview, setPreview] = useState("");
  useEffect(() => {
    if (!file) { setPreview(""); return undefined; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return <label className={`lm-photo-picker${busy ? " is-busy" : ""}`}>
    <span className="lm-photo-preview" aria-hidden="true">{preview || imageUrl ? <img src={preview || imageUrl} alt="" /> : <Camera size={27} />}</span>
    <span><strong>{t("lockIn.teamPhoto")}</strong></span>
    <input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} aria-label={t("lockIn.teamPhoto")} onChange={(event) => { const selected = event.currentTarget.files?.[0]; if (selected) onChange(selected); event.currentTarget.value = ""; }} />
  </label>;
}

function rankDuration(seconds, t) {
  if (seconds == null) return "—";
  const minutes = Math.floor(Math.max(0, Number(seconds) || 0) / 60);
  return t("lockIn.rankDuration", { hours: Math.floor(minutes / 60), minutes: minutes % 60 });
}

function rankScore(row, metric, t) {
  if (metric === "accuracy") return row.accuracy_percent == null ? "—" : `${row.accuracy_percent}%`;
  if (metric === "sheets") return String(row.completed_sheets ?? 0);
  return rankDuration(metric === "continuous" ? row.longest_focus_seconds : row.active_seconds ?? row.weekly_active_seconds, t);
}

function AnonymousRow({ id, checked, onChange }) {
  const { t } = useI18n();
  return <div className="ui-group-block">
    <div className="ui-group">
      <div className="ui-row">
        <span className="ui-row-body"><label htmlFor={id}>{t("lockIn.anonymous")}</label></span>
        <Switch id={id} checked={checked} onCheckedChange={onChange} />
      </div>
    </div>
  </div>;
}

function NavRow({ icon: RowIcon, title, hint = null, onClick, value = null }) {
  return <li>
    <button className="ui-row" type="button" onClick={onClick}>
      {RowIcon && <span className="ui-row-icon" aria-hidden="true"><RowIcon /></span>}
      <span className="ui-row-body"><strong dir="auto">{title}</strong>{hint && <small>{hint}</small>}</span>
      {value && <span className="ui-row-value">{value}</span>}
      <ChevronRight className="ui-row-chevron" size={18} aria-hidden="true" />
    </button>
  </li>;
}

function TeamRows({ teams, onOpen }) {
  const { t } = useI18n();
  const open = teams.filter((item) => !item.closed_at);
  if (!open.length) return null;
  return <section className="ui-group-block" aria-labelledby="lm-your-teams">
    <h2 className="ui-group-title" id="lm-your-teams">{t("lockIn.yourTeams")}</h2>
    <ul className="ui-group lm-team-list">
      {open.map((item) => <NavRow key={item.id} icon={Users} title={item.name} hint={t("lockIn.membersOf", { count: item.member_count, max: item.max_members })} value={item.active_session_id ? t("lockIn.liveNow") : null} onClick={() => onOpen(item)} />)}
    </ul>
  </section>;
}

export function TeamCode({ code, compact = false }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  async function copyCode() {
    try { await navigator.clipboard.writeText(code); setCopyFailed(false); setCopied(true); window.setTimeout(() => setCopied(false), 1800); }
    catch { setCopied(false); setCopyFailed(true); }
  }
  return <section className={`lm-code-card${compact ? " is-compact" : ""}`} aria-label={t("lockIn.inviteFriends")}>
    <div>
      <h2>{t(compact ? "lockIn.inviteFriends" : "lockIn.code")}</h2>
      <strong dir="ltr" translate="no">{code}</strong>

      {copyFailed && <><label className="visually-hidden" htmlFor={`lm-copy-${code}`}>{t("lockIn.code")}</label><input id={`lm-copy-${code}`} className="lm-copy-fallback" readOnly value={code} dir="ltr" onFocus={(event) => event.currentTarget.select()} /><p role="status">{t("lockIn.copyManually")}</p></>}
    </div>
    <button className="btn btn-soft compact" type="button" onClick={copyCode} aria-live="polite">
      {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}{copied ? t("lockIn.copied") : t("lockIn.copy")}
    </button>
  </section>;
}

function MemberRows({ members, renderEnd }) {
  const { t } = useI18n();
  return <ul className="ui-group lm-members">
    {members.map((member) => {
      const name = lockInMemberName(member, t);
      return <li key={member.member_id || member.user_id}>
        <div className="ui-row">
          <span className="lm-avatar" aria-hidden="true">{initial(name)}</span>
          <span className="ui-row-body"><strong dir="auto">{name}</strong></span>
          {member.role === "owner" && <span className="lm-tag">{t("lockIn.host")}</span>}
          {renderEnd?.(member, name)}
        </div>
      </li>;
    })}
  </ul>;
}

export function LockInSetup({ bootstrap, teamId, preselectedDocumentVersionId, onStart, onBack, onExit, onResume, busy, error }) {
  const { t } = useI18n();
  const materials = Array.isArray(bootstrap?.materials) ? bootstrap.materials : [];
  const initialMaterial = materials.some((item) => item.document_version_id === preselectedDocumentVersionId)
    ? preselectedDocumentVersionId : "";
  const [materialId, setMaterialId] = useState(initialMaterial);
  const [duration, setDuration] = useState("25");
  const [anonymous, setAnonymous] = useState(false);
  const [goal, setGoal] = useState("");
  const [pageStart, setPageStart] = useState("1");
  const [pageEnd, setPageEnd] = useState("");
  const selectedMaterial = materials.find((item) => item.document_version_id === materialId);
  function submit(event) {
    event.preventDefault();
    onStart({
      documentVersionId: materialId || null,
      sessionType: materialId ? "material" : "timed",
      plannedDurationSeconds: Number(duration) * 60,
      breakDurationSeconds: null,
      teamId: teamId || null,
      anonymous: !teamId && anonymous,
      experienceVersion: 2, goal: goal.trim(),
      pageStart: Number(pageStart), pageEnd: pageEnd ? Number(pageEnd) : null,
      topic: "", note: "", tasks: []
    });
  }
  return <main className="lm-shell lm-setup-shell" aria-label={t("lockIn.title")}>
    <header className="lm-entry-bar"><h1><span className="lm-brand-mark" aria-hidden="true"><Focus size={21} /></span>{t("lockIn.title")}</h1><button className="btn btn-soft lm-end" type="button" onClick={onExit}><LogOut size={17} aria-hidden="true" /><span lang="en" dir="ltr">End Lockin</span></button></header>
    <LockInBar onBack={onBack} backLabel={t("lockIn.back")} />
    <div className="lm-page">
      <header className="lm-heading"><h1>{teamId ? t("lockIn.teamSession") : t("lockIn.soloSession")}</h1></header>
      {bootstrap?.active_session && <ResumeCard active={bootstrap.active_session} onResume={onResume} />}
      <form className="lm-form lm-setup-form" onSubmit={submit}>
        <section className="lm-setup-timing" aria-labelledby="lm-duration-title">
          <span className="lm-focus-symbol" aria-hidden="true"><Timer size={22} /></span>
          <output className="lm-duration-preview" aria-label={t("lockIn.duration")}><strong>{duration || "—"}</strong><span>{t("lockIn.minuteUnit")}</span></output>
        <div className="ui-group-block">
          <h2 className="ui-group-title" id="lm-duration-title">{t("lockIn.duration")}</h2>
          <RadioGroup className="lm-durations" value={duration} onChange={setDuration} label={t("lockIn.duration")}>
            {DURATIONS.map((value) => <RadioOption key={value} value={String(value)} className="lm-duration"><strong>{value}</strong><small>{t("lockIn.minuteUnit")}</small></RadioOption>)}
          </RadioGroup>
        </div>
        <details className="lm-custom-duration"><summary>{t("lockIn.customize")}</summary>
          <label htmlFor="lm-custom-minutes">{t("lockIn.duration")}</label>
          <input id="lm-custom-minutes" type="number" min="1" max="480" value={duration} onChange={(event) => setDuration(event.target.value)} required />
        </details>
        </section>
        <section className="lm-setup-details" aria-label={t("lockIn.material")}>
        <div className="ui-group">
          <div className="ui-row">
            <label className="ui-row-body" htmlFor="lm-goal">{t("lockIn.goal")}</label>
            <input id="lm-goal" className="ui-row-input lm-row-input-wide" maxLength={280} value={goal} onChange={(event) => setGoal(event.target.value)} placeholder={t("lockIn.goalPlaceholder")} />
          </div>
        </div>
        {<div className="ui-group-block">
          <div className="ui-group"><div className="ui-row">
            <label className="ui-row-body" htmlFor="lm-material"><span>{t("lockIn.material")}</span></label>
            <select id="lm-material" className="ui-row-input lm-select" value={materialId} onChange={(event) => { setMaterialId(event.target.value); setPageStart("1"); setPageEnd(""); }}>
              <option value="">{t("lockIn.independent")}</option>
              {materials.map((item) => <option key={item.document_version_id} value={item.document_version_id}>{item.title}</option>)}
            </select>
          </div></div>
        </div>}
        {materialId && <div className="ui-group lm-page-range">
          <div className="ui-row"><label className="ui-row-body" htmlFor="lm-page-start">{t("lockIn.fromPage")}</label>
            <input id="lm-page-start" className="ui-row-input lm-row-input-number" type="number" min="1" max={selectedMaterial?.page_count || undefined} required value={pageStart} onChange={(event) => setPageStart(event.target.value)} /></div>
          <div className="ui-row"><label className="ui-row-body" htmlFor="lm-page-end">{t("lockIn.toPage")}</label>
            <input id="lm-page-end" className="ui-row-input lm-row-input-number" type="number" min={Number(pageStart)} max={selectedMaterial?.page_count || undefined} value={pageEnd} onChange={(event) => setPageEnd(event.target.value)} /></div>
        </div>}
        {!teamId && <AnonymousRow id="lm-solo-anonymous" checked={anonymous} onChange={setAnonymous} />}
        </section>
        {error && <p className="lm-error" role="alert">{error}</p>}
        <div className="lm-form-submit"><button className="btn btn-primary lm-submit" type="submit" disabled={busy}><Timer size={18} aria-hidden="true" />{t("lockIn.start")}</button></div>
      </form>
    </div>
  </main>;
}

function ResumeCard({ active, onResume }) {
  const { t } = useI18n();
  return <section className="lm-resume-card" aria-labelledby="lm-resume-title">
    <span className="lm-live-dot" aria-hidden="true" />
    <div>
      <h2 id="lm-resume-title">{t("lockIn.inProgress")}</h2>
      <p dir="auto">{active.team?.name || t("lockIn.solo")}</p>
    </div>
    <button className="btn btn-primary compact" type="button" onClick={onResume}>{t("lockIn.resume")}</button>
  </section>;
}

function TeamLobby({ team, onAction, onStart, onJoinLive, onImageUpload, onInviteFriends, busy, error }) {
  const { t } = useI18n();
  const [name, setName] = useState(team.name);
  const [maximum, setMaximum] = useState(String(team.max_members));
  const [confirm, setConfirm] = useState(null);
  const host = team.role === "owner" && !team.closed_at;
  useEffect(() => { setName(team.name); setMaximum(String(team.max_members)); }, [team.name, team.max_members]);
  const act = async (action, body = {}) => { setConfirm(null); await onAction(action, body); };
  const settingsChanged = name.trim() !== team.name || maximum !== String(team.max_members);
  const others = team.members.filter((member) => member.member_id !== team.self_member_id);

  return <div className="lm-page" aria-labelledby="lm-team-title">
    <header className="lm-heading lm-team-heading">
      <div>
        <h1 id="lm-team-title" className="lm-team-title" dir="auto">{team.image_url && <img src={team.image_url} className="lm-rank-avatar" alt="" />}{team.name}</h1>
        <p>{team.closed_at ? t("lockIn.ended") : t("lockIn.membersOf", { count: team.member_count, max: team.max_members })}</p>
      </div>
      {!team.closed_at && (team.active_session_id
        ? <button className="btn btn-primary" type="button" disabled={busy} onClick={() => onJoinLive(team.id)}>{t("lockIn.joinSession")}</button>
        : host
          ? <button className="btn btn-primary" type="button" disabled={busy} onClick={() => onStart(team.id)}>{t("lockIn.startSession")}</button>
          : <p className="lm-waiting" role="status"><span className="lm-live-dot is-waiting" aria-hidden="true" />{t("lockIn.waitingForHost")}</p>)}
    </header>

    {host && <button className="btn btn-soft" type="button" onClick={onInviteFriends}><UserPlus size={17} aria-hidden="true" />{t("lockIn.inviteFriends")}</button>}
    {host && <TeamPhotoInput imageUrl={team.image_url} onChange={onImageUpload} busy={busy} />}
    {!team.closed_at && <TeamCode code={team.invite_code} />}

    <section className="ui-group-block" aria-labelledby="lm-members-title">
      <h2 className="ui-group-title" id="lm-members-title">{t("lockIn.members")}</h2>
      <MemberRows members={team.members} renderEnd={(member, memberName) => host && member.member_id !== team.self_member_id
        ? <LockInMenu label={t("lockIn.memberOptions", { name: memberName })} items={[
          { label: t("lockIn.makeHost"), onSelect: () => setConfirm({ action: "transfer-host", body: { member_id: member.member_id }, title: t("lockIn.makeHostConfirm", { name: memberName }), message: t("lockIn.makeHostMessage"), label: t("lockIn.makeHost"), variant: "primary" }) },
          { label: t("lockIn.remove"), danger: true, onSelect: () => setConfirm({ action: "kick", body: { member_id: member.member_id }, title: t("lockIn.removeConfirm", { name: memberName }), message: t("lockIn.removeMessage"), label: t("lockIn.remove") }) }
        ]} />
        : null} />
    </section>

    {host && <section className="ui-group-block" aria-labelledby="lm-settings-title">
      <h2 className="ui-group-title" id="lm-settings-title">{t("lockIn.teamSettings")}</h2>
      <form className="ui-group" onSubmit={(event) => { event.preventDefault(); if (settingsChanged) void act("update", { name: name.trim(), ...(maximum !== String(team.max_members) ? { max_members: Number(maximum) } : {}) }); }}>
        <div className="ui-row">
          <label className="ui-row-body" htmlFor="lm-team-name"><span>{t("lockIn.teamName")}</span></label>
          <input id="lm-team-name" className="ui-row-input lm-row-input-wide" dir="auto" value={name} maxLength={80} onChange={(event) => setName(event.target.value)} required />
        </div>
        <div className="ui-row">
          <label className="ui-row-body" htmlFor="lm-team-max"><span>{t("lockIn.maxMembers")}</span></label>
          <input id="lm-team-max" className="ui-row-input lm-row-input-number" type="number" inputMode="numeric" min={Math.max(2, team.member_count)} max={Math.max(20, team.max_members)} value={maximum} onChange={(event) => setMaximum(event.target.value)} required />
        </div>
        {settingsChanged && <div className="ui-row lm-row-actions"><button className="btn btn-primary compact" type="submit" disabled={busy || !name.trim()}>{t("lockIn.save")}</button></div>}
      </form>
      <div className="ui-group">
        <div className="ui-row">
          <span className="ui-row-body"><label htmlFor="lm-team-joining">{t("lockIn.allowJoining")}</label></span>
          <Switch id="lm-team-joining" checked={!team.joining_locked} busy={busy} disabled={busy} onCheckedChange={(allow) => void act("update", { joining_locked: !allow })} />
        </div>
        <button className="ui-row" type="button" disabled={busy} onClick={() => setConfirm({ action: "regenerate-code", title: t("lockIn.newCodeConfirm"), message: t("lockIn.newCodeMessage"), label: t("lockIn.newCode"), variant: "primary" })}>
          <span className="ui-row-body"><span>{t("lockIn.newCode")}</span></span>
        </button>
        <button className="ui-row is-danger" type="button" disabled={busy} onClick={() => setConfirm({ action: "end", title: t("lockIn.endTeamConfirm"), message: t("lockIn.endTeamMessage"), label: t("lockIn.endTeam") })}>
          <span className="ui-row-body"><strong>{t("lockIn.endTeam")}</strong></span>
        </button>
      </div>
    </section>}

    <div className="ui-group">
      <button className="ui-row is-danger" type="button" disabled={busy} onClick={() => setConfirm({ action: "leave", title: t("lockIn.leaveTeamConfirm"), message: host && others.length ? t("lockIn.leaveTeamHostMessage") : t("lockIn.leaveTeamMessage"), label: t("lockIn.leaveTeam") })}>
        <span className="ui-row-body"><strong>{t("lockIn.leaveTeam")}</strong></span>
      </button>
    </div>
    {error && <p className="lm-error" role="alert">{error}</p>}
    <ConfirmDialog open={Boolean(confirm)} title={confirm?.title} message={confirm?.message} confirmLabel={confirm?.label} confirmVariant={confirm?.variant || "danger"} busy={busy} onCancel={() => setConfirm(null)} onConfirm={() => void act(confirm.action, confirm.body)} />
  </div>;
}

export default function LockInLobby({ bootstrap, onExit, onSolo, onTeamStart, onResume, onResumeSession, onRefresh }) {
  const { t } = useI18n();
  const [screen, setScreen] = useState("home");
  const [teamId, setTeamId] = useState(null);
  const [team, setTeam] = useState(null);
  const [name, setName] = useState("");
  const [maximum, setMaximum] = useState("8");
  const [code, setCode] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [rankTab, setRankTab] = useState("teams");
  const [rankMetric, setRankMetric] = useState("time");
  const [rankLoading, setRankLoading] = useState(false);
  const [rankError, setRankError] = useState("");
  const [rankRetry, setRankRetry] = useState(0);
  const [imageFile, setImageFile] = useState(null);
  const [friendTeamId, setFriendTeamId] = useState("");
  const teamMutationRef = useRef(0);
  const [period, setPeriod] = useState("weekly");
  const [rankings, setRankings] = useState({ solo: [], teams: bootstrap.team_rankings || [], minAnswers: 20 });
  const teams = Array.isArray(bootstrap.teams) ? bootstrap.teams : [];
  const active = bootstrap.active_session;
  const removedMessage = t("lockIn.removedFromTeam");

  const loadTeam = useCallback(async (id) => {
    const mutation = teamMutationRef.current;
    try { const result = await focusApi.getLockInTeam(id); if (mutation !== teamMutationRef.current) return; const nextTeam = /** @type {any} */ (result.team); setTeam(nextTeam); setError((current) => current === t("lockIn.reconnecting") ? "" : current); if (nextTeam.active_session_id && nextTeam.can_resume_session) onResumeSession(nextTeam.active_session_id); }
    catch (failure) {
      if (mutation !== teamMutationRef.current) return;
      if ([400, 403, 404].includes(failure.status)) { setTeam(null); setTeamId(null); setScreen("home"); setError(removedMessage); await onRefresh(); }
      else setError(t("lockIn.reconnecting"));
    }
  }, [removedMessage, onRefresh, onResumeSession, t]);

  useEffect(() => {
    if (!teamId || screen !== "lobby") return undefined;
    void loadTeam(teamId);
    const refresh = () => { if (!document.hidden) void loadTeam(teamId); };
    const interval = window.setInterval(refresh, 10000);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.clearInterval(interval); document.removeEventListener("visibilitychange", refresh); };
  }, [teamId, screen, loadTeam]);

  useEffect(() => {
    if (screen !== "leaderboard") return undefined;
    let cancelled = false;
    setRankLoading(true);
    setRankError("");
    focusApi.getLockInLeaderboard(period, rankMetric).then((result) => {
      if (rankMetric !== "time" && result.metric !== rankMetric) throw new Error(t("lockIn.rankUnavailable"));
      if (!cancelled) setRankings({
        solo: Array.isArray(result.solo) ? result.solo : [],
        teams: Array.isArray(result.teams) ? result.teams : [],
        minAnswers: Number(result.accuracy_min_answers) || 20
      });
    }).catch((failure) => { if (!cancelled) setRankError(failure.message || t("lockIn.rankFailed")); })
      .finally(() => { if (!cancelled) setRankLoading(false); });
    return () => { cancelled = true; };
  }, [screen, period, rankMetric, rankRetry, t]);


  function go(next) { setError(""); setScreen(next); window.scrollTo(0, 0); }
  function openTeam(selected) { setTeamId(selected.id); setTeam(selected); go("lobby"); }
  async function create(event) {
    event.preventDefault(); setBusy(true); setError("");
    try { const result = await focusApi.createLockInTeam({ name: name.trim(), max_members: Number(maximum), anonymous }); openTeam(result.team);
      if (imageFile) { const uploaded = await focusApi.uploadLockInTeamImage(/** @type {{id: string}} */ (result.team).id, imageFile); teamMutationRef.current++; setTeam(uploaded.team); setImageFile(null); }
      await onRefresh(); }
    catch (failure) { setError(failure.message || t("lockIn.error")); }
    finally { setBusy(false); }
  }
  async function join(event) {
    event.preventDefault();
    if (!/^[0-9]{6}$/.test(code)) { setError(t("lockIn.codeInvalid")); return; }
    setBusy(true); setError("");
    try { const result = await focusApi.joinLockInTeam(code, anonymous); openTeam(result.team); await onRefresh(); }
    catch (failure) { setError(failure.code === "not_found" ? t("lockIn.teamNotFound") : failure.message || t("lockIn.error")); }
    finally { setBusy(false); }
  }
  async function action(kind, body = {}) {
    if (!team) return;
    setBusy(true); setError("");
    try {
      const result = kind === "update" ? await focusApi.updateLockInTeam(team.id, body) : await focusApi.lockInTeamAction(team.id, kind, body);
      if (kind === "leave") { setScreen("home"); setTeam(null); setTeamId(null); }
      else setTeam(result.team);
      await onRefresh();
    } catch (failure) { setError(failure.message || t("lockIn.error")); }
    finally { setBusy(false); }
  }

  async function uploadTeamImage(file) {
    if (!team || busy) return;
    setBusy(true); setError("");
    teamMutationRef.current++;
    try { const result = await focusApi.uploadLockInTeamImage(team.id, file); teamMutationRef.current++; setTeam(result.team); await onRefresh(); }
    catch (failure) { setError(failure.message || t("lockIn.photoFailed")); }
    finally { setBusy(false); }
  }

  async function joinLive(id) {
    setBusy(true); setError("");
    try { const result = await focusApi.joinLockInTeamSession(id); onResumeSession(/** @type {any} */ (result.session).id); }
    catch (failure) { setError(failure.message || t("lockIn.error")); }
    finally { setBusy(false); }
  }

  const topLevel = screen === "home" || screen === "leaderboard";
  const back = screen === "create" || screen === "join" ? "team" : "home";
  const rankRows = rankTab === "solo" ? rankings.solo || [] : rankings.teams || [];
  return <main className="lm-shell lm-standalone" aria-label={t("lockIn.title")}>
    <header className="lm-entry-bar">
      <h1><span className="lm-brand-mark" aria-hidden="true"><Focus size={21} /></span>{t("lockIn.title")}</h1>
      <button type="button" className="btn btn-soft lm-end" onClick={onExit}><LogOut size={17} aria-hidden="true" /><span lang="en" dir="ltr">End Lockin</span></button>
    </header>
    {topLevel ? <div className="lm-entry-tabs">
      <TabList className="ui-segmented lm-sections" label={t("lockIn.sections")} value={screen} onChange={go}>
        <Tab value="home">{t("lockIn.home")}</Tab>
        <Tab value="leaderboard">{t("lockIn.leaderboard")}</Tab>
      </TabList>
    </div> : <LockInBar onBack={() => go(back)} backLabel={t("lockIn.back")} />}

    {screen === "home" && <div className="lm-page lm-home-page">
      {active && <ResumeCard active={active} onResume={onResume} />}
      <section className="ui-group-block" aria-labelledby="lm-start-title">
        <h2 className="visually-hidden" id="lm-start-title">{t("lockIn.startGroup")}</h2>
        <ul className="ui-group lm-mode-choices">
          <NavRow icon={Timer} title={t("lockIn.solo")} onClick={() => onSolo()} />
          <NavRow icon={Users} title={t("lockIn.team")} onClick={() => go("team")} />
        </ul>
      </section>
      <LockInFriends teams={teams} initialTeamId={friendTeamId} onCreateTeam={() => go("create")} onOpenTeam={async (nextTeam) => { await onRefresh(); openTeam(nextTeam); }} />
      <TeamRows teams={teams} onOpen={openTeam} />
      {error && <p className="lm-error" role="alert">{error}</p>}
    </div>}

    {screen === "team" && <div className="lm-page">
      <header className="lm-heading"><h1>{t("lockIn.team")}</h1></header>
      <ul className="ui-group">
        <NavRow icon={UserPlus} title={t("lockIn.createTeam")} onClick={() => go("create")} />
        <NavRow icon={KeyRound} title={t("lockIn.joinTeam")} onClick={() => go("join")} />
      </ul>
      <TeamRows teams={teams} onOpen={openTeam} />
    </div>}

    {screen === "create" && <div className="lm-page">
      <header className="lm-heading"><h1>{t("lockIn.createTeam")}</h1></header>
      <form className="lm-form" onSubmit={create}>
        <TeamPhotoInput file={imageFile} onChange={setImageFile} busy={busy} />
        <div className="ui-group">
          <div className="ui-row">
            <label className="ui-row-body" htmlFor="lm-create-name"><span>{t("lockIn.teamName")}</span></label>
            <input id="lm-create-name" className="ui-row-input lm-row-input-wide" dir="auto" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} required autoComplete="off" />
          </div>
          <div className="ui-row">
            <label className="ui-row-body" htmlFor="lm-create-max"><span>{t("lockIn.maxMembers")}</span></label>
            <input id="lm-create-max" className="ui-row-input lm-row-input-number" type="number" inputMode="numeric" min="2" max="20" value={maximum} onChange={(event) => setMaximum(event.target.value)} required />
          </div>
        </div>
        <AnonymousRow id="lm-create-anonymous" checked={anonymous} onChange={setAnonymous} />
        {error && <p className="lm-error" role="alert">{error}</p>}
        <button className="btn btn-primary lm-submit" type="submit" disabled={busy || !name.trim()}>{t("lockIn.create")}</button>
      </form>
    </div>}

    {screen === "join" && <div className="lm-page">
      <header className="lm-heading"><h1>{t("lockIn.joinTeam")}</h1></header>
      <form className="lm-form" onSubmit={join}>
        <label className="visually-hidden" htmlFor="lm-join-code">{t("lockIn.code")}</label>
        <input id="lm-join-code" className="lm-code-input" dir="ltr" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} placeholder="000000" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} required />
        <AnonymousRow id="lm-join-anonymous" checked={anonymous} onChange={setAnonymous} />
        {error && <p className="lm-error" role="alert">{error}</p>}
        <button className="btn btn-primary lm-submit" type="submit" disabled={busy || code.length !== 6}>{t("lockIn.join")}</button>
      </form>
    </div>}

    {screen === "lobby" && team && <TeamLobby team={team} onAction={action} onStart={onTeamStart} onJoinLive={joinLive} onImageUpload={uploadTeamImage} onInviteFriends={() => { setFriendTeamId(team.id); go("home"); window.setTimeout(() => document.getElementById("lm-friends")?.scrollIntoView({ block: "start" }), 0); }} busy={busy} error={error} />}

    {screen === "leaderboard" && <div className="lm-page lm-leaderboard-page">
      <div className="lm-rank-controls">
        <TabList className="ui-segmented" label={t("lockIn.ranking")} value={rankTab} onChange={(value) => { setRankTab(value); setRankMetric("time"); }}>
          <Tab value="teams">{t("lockIn.teams")}</Tab>
          <Tab value="solo">{t("lockIn.solo")}</Tab>
        </TabList>
        <select className="lm-period-select" aria-label={t("lockIn.period")} value={period} onChange={(event) => setPeriod(event.target.value)}>
          <option value="weekly">{t("lockIn.thisWeek")}</option>
          <option value="all_time">{t("lockIn.allTime")}</option>
        </select>
      </div>
      <TabList className="ui-segmented lm-rank-metrics" label={t("lockIn.rankCategory")} value={rankMetric} onChange={setRankMetric}>
        <Tab value="time">{t("lockIn.rankBest")}</Tab>
        {rankTab === "teams" && <Tab value="sheets">{t("lockIn.rankSheets")}</Tab>}
        <Tab value="accuracy">{t("lockIn.rankAccuracy")}</Tab>
        {rankTab === "solo" && <Tab value="continuous">{t("lockIn.rankContinuous")}</Tab>}
      </TabList>
      {rankLoading ? <LoadingPanel variant="list" /> : rankError ? <ErrorPanel message={rankError} onRetry={() => setRankRetry((value) => value + 1)} /> : rankRows.length
        ? <ol className="lm-ranking-list">{rankRows.map((row, index) => <li key={row.id || index} className={index < 3 ? `lm-place-${index + 1}` : undefined}>
          <div className="lm-ranking-row">
            <span className="lm-rank" aria-label={t("lockIn.rankPosition", { rank: index + 1 })}>{index + 1}</span>
            {rankTab === "solo" && row.avatar && !row.anonymous
              ? <UserAvatar avatar={row.avatar} className="lm-rank-avatar" />
              : <span className="lm-rank-avatar" aria-hidden="true">{initial(lockInMemberName(row, t))}{row.image_url && <img src={row.image_url} alt="" onError={(event) => { event.currentTarget.style.display = "none"; }} />}</span>}
            <div className="lm-rank-identity"><strong dir="auto">{lockInMemberName(row, t)}</strong>
              {rankMetric !== "time" && <small className="lm-rank-time"><bdi>{rankDuration(row.active_seconds ?? row.weekly_active_seconds, t)}</bdi></small>}
            </div>
            <div className="lm-rank-score"><strong dir={rankMetric === "accuracy" || rankMetric === "sheets" ? "ltr" : "auto"}>{rankScore(row, rankMetric, t)}</strong></div>
          </div>
        </li>)}</ol>
        : <EmptyState title={t("lockIn.noRanks")} text={t("lockIn.noRanksHint")} />}
    </div>}
  </main>;
}
