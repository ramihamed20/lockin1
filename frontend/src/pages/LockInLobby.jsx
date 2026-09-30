import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, ChevronRight, Copy, KeyRound, MoreHorizontal, Timer, UserPlus, Users, X } from "lucide-react";
import { focusApi } from "../api/focus.js";
import { useI18n } from "../components/I18nProvider.jsx";
import { ConfirmDialog } from "../components/shared/ConfirmDialog.jsx";
import { EmptyState } from "../components/ui/index.jsx";
import { RadioGroup, RadioOption, Switch, Tab, TabList } from "../components/ui/interactive.jsx";
import "./lock-in-lobby.css";

const DURATIONS = [25, 45, 60, 90];

/** The server names anonymous members "Anonymous 01"; show that in the reader's language. */
export function lockInMemberName(member, t) {
  const match = member?.anonymous && /^Anonymous (\d+)$/.exec(String(member.name || ""));
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
      <button className="btn btn-soft compact lm-bar-back" type="button" onClick={onBack}>
        {backIcon === "close" ? <X size={17} aria-hidden="true" /> : <ArrowLeft className="lm-flip" size={17} aria-hidden="true" />}
        <span>{backLabel}</span>
      </button>
    </div>
    <div className="lm-bar-center">{children}</div>
    <div className="lm-bar-end">{end}</div>
  </header>;
}

function AnonymousRow({ id, checked, onChange }) {
  const { t } = useI18n();
  return <div className="ui-group-block">
    <div className="ui-group">
      <div className="ui-row">
        <span className="ui-row-body"><label htmlFor={id}>{t("lockIn.anonymous")}</label><small>{t("lockIn.anonymousHint")}</small></span>
        <Switch id={id} checked={checked} onCheckedChange={onChange} />
      </div>
    </div>
  </div>;
}

function NavRow({ icon: RowIcon, title, hint, onClick, value = null }) {
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
    <ul className="ui-group">
      {open.map((item) => <NavRow key={item.id} icon={Users} title={item.name} hint={t("lockIn.membersOf", { count: item.member_count, max: item.max_members })} onClick={() => onOpen(item)} />)}
    </ul>
  </section>;
}

function TeamCode({ code }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  async function copyCode() {
    try { await navigator.clipboard.writeText(code); setCopied(true); window.setTimeout(() => setCopied(false), 1800); }
    catch { setCopied(false); }
  }
  return <section className="lm-code-card" aria-labelledby="lm-code-label">
    <div>
      <h2 id="lm-code-label">{t("lockIn.code")}</h2>
      <strong dir="ltr" translate="no">{code}</strong>
      <p>{t("lockIn.codeHint")}</p>
    </div>
    <button className="btn btn-soft compact" type="button" onClick={copyCode} aria-live="polite">
      {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}{copied ? t("lockIn.copied") : t("lockIn.copy")}
    </button>
  </section>;
}

/** A small anchored menu. Opens with focus on its first item, closes on
 *  Escape (returning focus to the button), on a click elsewhere and after a choice. */
export function LockInMenu({ label, items }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    rootRef.current?.querySelector("[role='menuitem']")?.focus();
    const onPointer = (event) => { if (!rootRef.current?.contains(event.target)) setOpen(false); };
    const onKey = (event) => {
      if (event.key === "Escape") { setOpen(false); buttonRef.current?.focus(); return; }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const entries = Array.from(rootRef.current?.querySelectorAll("[role='menuitem']") || []);
      const index = entries.indexOf(document.activeElement);
      if (index === -1) return;
      event.preventDefault();
      entries[(index + (event.key === "ArrowDown" ? 1 : -1) + entries.length) % entries.length]?.focus();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onPointer); document.removeEventListener("keydown", onKey); };
  }, [open]);
  return <div className="lm-menu-anchor" ref={rootRef}>
    <button ref={buttonRef} className="lm-icon-button" type="button" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}><MoreHorizontal size={19} aria-hidden="true" /></button>
    {open && <div className="lm-menu" role="menu" aria-label={label}>
      {items.map((item) => <button key={item.label} type="button" role="menuitem" className={item.danger ? "is-danger" : undefined} onClick={() => { setOpen(false); item.onSelect(); }}>{item.label}</button>)}
    </div>}
  </div>;
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

export function LockInSetup({ bootstrap, teamId, preselectedDocumentVersionId, onStart, onBack, onResume, busy, error }) {
  const { t } = useI18n();
  const materials = Array.isArray(bootstrap?.materials) ? bootstrap.materials : [];
  const initialMaterial = materials.some((item) => item.document_version_id === preselectedDocumentVersionId)
    ? preselectedDocumentVersionId : "";
  const [materialId, setMaterialId] = useState(initialMaterial);
  const [duration, setDuration] = useState("25");
  const [anonymous, setAnonymous] = useState(false);
  function submit(event) {
    event.preventDefault();
    onStart({
      documentVersionId: materialId || null,
      sessionType: materialId ? "material" : "timed",
      plannedDurationSeconds: Number(duration) * 60,
      breakDurationSeconds: null,
      teamId: teamId || null,
      anonymous: !teamId && anonymous,
      goal: "", topic: "", note: "", tasks: []
    });
  }
  return <main className="lm-shell" aria-label={t("lockIn.title")}>
    <LockInBar onBack={onBack} backLabel={t("lockIn.back")} />
    <div className="lm-page">
      <header className="lm-heading"><h1>{teamId ? t("lockIn.teamSession") : t("lockIn.soloSession")}</h1></header>
      {bootstrap?.active_session && <ResumeCard active={bootstrap.active_session} onResume={onResume} />}
      <form className="lm-form" onSubmit={submit}>
        {!teamId && preselectedDocumentVersionId && <div className="ui-group-block">
          <div className="ui-group"><div className="ui-row">
            <label className="ui-row-body" htmlFor="lm-material"><span>{t("lockIn.material")}</span></label>
            <select id="lm-material" className="ui-row-input lm-select" value={materialId} onChange={(event) => setMaterialId(event.target.value)}>
              <option value="">{t("lockIn.independent")}</option>
              {materials.map((item) => <option key={item.document_version_id} value={item.document_version_id}>{item.title}</option>)}
            </select>
          </div></div>
        </div>}
        <div className="ui-group-block">
          <h2 className="ui-group-title" id="lm-duration-title">{t("lockIn.duration")}</h2>
          <RadioGroup className="lm-durations" value={duration} onChange={setDuration} label={t("lockIn.duration")}>
            {DURATIONS.map((value) => <RadioOption key={value} value={String(value)} className="lm-duration"><strong>{value}</strong><small>{t("lockIn.minuteUnit")}</small></RadioOption>)}
          </RadioGroup>
        </div>
        {!teamId && <AnonymousRow id="lm-solo-anonymous" checked={anonymous} onChange={setAnonymous} />}
        {error && <p className="lm-error" role="alert">{error}</p>}
        <button className="btn btn-primary lm-submit" type="submit" disabled={busy}>{t("lockIn.start")}</button>
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

function TeamLobby({ team, onAction, onStart, onJoinLive, busy, error }) {
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
        <h1 id="lm-team-title" dir="auto">{team.name}</h1>
        <p>{team.closed_at ? t("lockIn.ended") : t("lockIn.membersOf", { count: team.member_count, max: team.max_members })}</p>
      </div>
      {!team.closed_at && (team.active_session_id
        ? <button className="btn btn-primary" type="button" disabled={busy} onClick={() => onJoinLive(team.id)}>{t("lockIn.joinSession")}</button>
        : host
          ? <button className="btn btn-primary" type="button" disabled={busy} onClick={() => onStart(team.id)}>{t("lockIn.startSession")}</button>
          : <p className="lm-waiting" role="status"><span className="lm-live-dot is-waiting" aria-hidden="true" />{t("lockIn.waitingForHost")}</p>)}
    </header>

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
  const [period, setPeriod] = useState("weekly");
  const [rankings, setRankings] = useState({ solo: [], teams: bootstrap.team_rankings || [] });
  const teams = Array.isArray(bootstrap.teams) ? bootstrap.teams : [];
  const active = bootstrap.active_session;
  const removedMessage = t("lockIn.removedFromTeam");

  const loadTeam = useCallback(async (id) => {
    try { const result = await focusApi.getLockInTeam(id); const nextTeam = /** @type {any} */ (result.team); setTeam(nextTeam); setError(""); if (nextTeam.active_session_id && nextTeam.can_resume_session) onResumeSession(nextTeam.active_session_id); }
    catch { setTeam(null); setTeamId(null); setScreen("home"); setError(removedMessage); await onRefresh(); }
  }, [removedMessage, onRefresh, onResumeSession]);

  useEffect(() => {
    if (!teamId || screen !== "lobby") return undefined;
    void loadTeam(teamId);
    const interval = window.setInterval(() => { void loadTeam(teamId); }, 10000);
    return () => window.clearInterval(interval);
  }, [teamId, screen, loadTeam]);

  useEffect(() => {
    if (screen !== "leaderboard") return undefined;
    let cancelled = false;
    focusApi.getLockInLeaderboard(period).then((result) => {
      if (!cancelled) setRankings({
        solo: Array.isArray(result.solo) ? result.solo : [],
        teams: Array.isArray(result.teams) ? result.teams : []
      });
    }).catch(() => { if (!cancelled) setRankings({ solo: [], teams: bootstrap.team_rankings || [] }); });
    return () => { cancelled = true; };
  }, [screen, period, bootstrap.team_rankings]);

  function go(next) { setError(""); setScreen(next); window.scrollTo(0, 0); }
  function openTeam(selected) { setTeamId(selected.id); setTeam(selected); go("lobby"); }
  async function create(event) {
    event.preventDefault(); setBusy(true); setError("");
    try { const result = await focusApi.createLockInTeam({ name: name.trim(), max_members: Number(maximum), anonymous }); openTeam(result.team); await onRefresh(); }
    catch (failure) { setError(failure.message || t("lockIn.error")); }
    finally { setBusy(false); }
  }
  async function join(event) {
    event.preventDefault();
    if (!/^[0-9]{6}$/.test(code)) { setError(t("lockIn.codeInvalid")); return; }
    setBusy(true); setError("");
    try { const result = await focusApi.joinLockInTeam(code, anonymous); openTeam(result.team); await onRefresh(); }
    catch (failure) { setError(failure.message || t("lockIn.error")); }
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

  async function joinLive(id) {
    setBusy(true); setError("");
    try { const result = await focusApi.joinLockInTeamSession(id); onResumeSession(/** @type {any} */ (result.session).id); }
    catch (failure) { setError(failure.message || t("lockIn.error")); }
    finally { setBusy(false); }
  }

  const topLevel = screen === "home" || screen === "leaderboard";
  const back = screen === "create" || screen === "join" ? "team" : "home";
  const rankRows = rankTab === "solo" ? rankings.solo || [] : rankings.teams || [];
  return <main className="lm-shell" aria-label={t("lockIn.title")}>
    <LockInBar
      onBack={topLevel ? onExit : () => go(back)}
      backLabel={topLevel ? t("lockIn.exit") : t("lockIn.back")}
      backIcon={topLevel ? "close" : "back"}
    >
      {topLevel && <TabList className="ui-segmented lm-sections" label={t("lockIn.sections")} value={screen} onChange={go}>
        <Tab value="home">{t("lockIn.home")}</Tab>
        <Tab value="leaderboard">{t("lockIn.leaderboard")}</Tab>
      </TabList>}
    </LockInBar>

    {screen === "home" && <div className="lm-page">
      <header className="lm-heading"><h1 id="lm-title">{t("lockIn.title")}</h1><p>{t("lockIn.intro")}</p></header>
      {active && <ResumeCard active={active} onResume={onResume} />}
      <section className="ui-group-block" aria-labelledby="lm-start-title">
        <h2 className="ui-group-title" id="lm-start-title">{t("lockIn.startGroup")}</h2>
        <ul className="ui-group">
          <NavRow icon={Timer} title={t("lockIn.solo")} hint={t("lockIn.soloHint")} onClick={() => onSolo()} />
          <NavRow icon={Users} title={t("lockIn.team")} hint={t("lockIn.teamHint")} onClick={() => go("team")} />
        </ul>
      </section>
      <TeamRows teams={teams} onOpen={openTeam} />
      {error && <p className="lm-error" role="alert">{error}</p>}
    </div>}

    {screen === "team" && <div className="lm-page">
      <header className="lm-heading"><h1>{t("lockIn.team")}</h1></header>
      <ul className="ui-group">
        <NavRow icon={UserPlus} title={t("lockIn.createTeam")} hint={t("lockIn.createTeamHint")} onClick={() => go("create")} />
        <NavRow icon={KeyRound} title={t("lockIn.joinTeam")} hint={t("lockIn.joinTeamHint")} onClick={() => go("join")} />
      </ul>
      <TeamRows teams={teams} onOpen={openTeam} />
    </div>}

    {screen === "create" && <div className="lm-page">
      <header className="lm-heading"><h1>{t("lockIn.createTeam")}</h1></header>
      <form className="lm-form" onSubmit={create}>
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
      <header className="lm-heading"><h1>{t("lockIn.joinTeam")}</h1><p>{t("lockIn.joinTeamHint")}</p></header>
      <form className="lm-form" onSubmit={join}>
        <label className="visually-hidden" htmlFor="lm-join-code">{t("lockIn.code")}</label>
        <input id="lm-join-code" className="lm-code-input" dir="ltr" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} placeholder="000000" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} required />
        <AnonymousRow id="lm-join-anonymous" checked={anonymous} onChange={setAnonymous} />
        {error && <p className="lm-error" role="alert">{error}</p>}
        <button className="btn btn-primary lm-submit" type="submit" disabled={busy || code.length !== 6}>{t("lockIn.join")}</button>
      </form>
    </div>}

    {screen === "lobby" && team && <TeamLobby team={team} onAction={action} onStart={onTeamStart} onJoinLive={joinLive} busy={busy} error={error} />}

    {screen === "leaderboard" && <div className="lm-page">
      <header className="lm-heading"><h1>{t("lockIn.leaderboard")}</h1></header>
      <div className="lm-rank-controls">
        <TabList className="ui-segmented" label={t("lockIn.ranking")} value={rankTab} onChange={setRankTab}>
          <Tab value="teams">{t("lockIn.teams")}</Tab>
          <Tab value="solo">{t("lockIn.solo")}</Tab>
        </TabList>
        <TabList className="ui-segmented" label={t("lockIn.period")} value={period} onChange={setPeriod}>
          <Tab value="weekly">{t("lockIn.thisWeek")}</Tab>
          <Tab value="all_time">{t("lockIn.allTime")}</Tab>
        </TabList>
      </div>
      {rankRows.length
        ? <ol className="ui-group lm-rank-list">{rankRows.map((row, index) => <li key={row.id || index}>
          <div className="ui-row">
            <span className="lm-rank" aria-hidden="true">{index + 1}</span>
            <span className="ui-row-body"><strong dir="auto">{lockInMemberName(row, t)}</strong></span>
            <span className="ui-row-value">{t("lockIn.minutes", { count: Math.round((row.active_seconds ?? row.weekly_active_seconds ?? 0) / 60) })}</span>
          </div>
        </li>)}</ol>
        : <EmptyState title={t("lockIn.noRanks")} text={t("lockIn.noRanksHint")} />}
    </div>}
  </main>;
}
