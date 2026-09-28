import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Copy, MoreHorizontal, Settings2, X } from "lucide-react";
import { focusApi } from "../api/focus.js";
import { ConfirmDialog } from "../components/shared/ConfirmDialog.jsx";
import "./lock-in-lobby.css";

const copy = {
  en: {
    home: "Home", leaderboard: "Leaderboard", exit: "Exit", solo: "Solo", team: "Team", teams: "Teams",
    createTeam: "Create Team", joinTeam: "Join Team", teamName: "Team name", maxMembers: "Maximum members",
    anonymous: "Stay Anonymous", create: "Create", join: "Join", code: "Team code", members: "Members",
    copy: "Copy", copied: "Copied", start: "Start Lockin", resume: "Resume", settings: "Host controls",
    save: "Save", lock: "Lock joining", unlock: "Unlock joining", regenerate: "New code",
    kick: "Remove", transfer: "Transfer Host", leave: "Leave Team", end: "End Team",
    cancel: "Cancel", confirm: "Confirm", weekly: "Weekly", allTime: "All Time",
    noRanks: "No rankings yet", noTeams: "No teams yet", full: "Full", closed: "Ended",
    codeInvalid: "Enter six digits.", error: "Could not update the team.", removed: "Team access ended.",
    friends: "Add Friends", unavailable: "No friends feature yet", host: "Host",
    material: "Study material", independent: "Independent study", duration: "Duration", minutes: "min", back: "Back", period: "Period", waiting: "Waiting", joinLive: "Join Lockin"
  },
  ar: {
    home: "الرئيسية", leaderboard: "لوحة الصدارة", exit: "خروج", solo: "فردي", team: "فريق", teams: "الفرق",
    createTeam: "إنشاء فريق", joinTeam: "الانضمام لفريق", teamName: "اسم الفريق", maxMembers: "الحد الأقصى للأعضاء",
    anonymous: "البقاء مجهولًا", create: "إنشاء", join: "انضمام", code: "رمز الفريق", members: "الأعضاء",
    copy: "نسخ", copied: "تم النسخ", start: "ابدأ التركيز", resume: "استئناف", settings: "إدارة الفريق",
    save: "حفظ", lock: "إغلاق الانضمام", unlock: "فتح الانضمام", regenerate: "رمز جديد",
    kick: "إزالة", transfer: "نقل الإدارة", leave: "مغادرة الفريق", end: "إنهاء الفريق",
    cancel: "إلغاء", confirm: "تأكيد", weekly: "أسبوعي", allTime: "كل الوقت",
    noRanks: "لا توجد نتائج بعد", noTeams: "لا توجد فرق بعد", full: "ممتلئ", closed: "انتهى",
    codeInvalid: "أدخل ستة أرقام.", error: "تعذر تحديث الفريق.", removed: "انتهى الوصول للفريق.",
    friends: "إضافة أصدقاء", unavailable: "ميزة الأصدقاء غير متاحة بعد", host: "المضيف",
    material: "المادة", independent: "دراسة مستقلة", duration: "المدة", minutes: "دقيقة", back: "رجوع", period: "الفترة", waiting: "انتظار", joinLive: "دخول الجلسة"
  }
};

function AnonymousToggle({ checked, onChange, label }) {
  return <label className="lm-toggle"><span>{label}</span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /></label>;
}

function TeamCode({ code, labels }) {
  const [copied, setCopied] = useState(false);
  async function copyCode() {
    try { await navigator.clipboard.writeText(code); setCopied(true); window.setTimeout(() => setCopied(false), 1800); }
    catch { setCopied(false); }
  }
  return <div className="lm-code"><span>{labels.code}</span><div><strong dir="ltr">{code}</strong><button type="button" onClick={copyCode} aria-label={copied ? labels.copied : labels.copy}>{copied ? <Check size={20} /> : <Copy size={20} />}<span>{copied ? labels.copied : labels.copy}</span></button></div></div>;
}

export function LockInSetup({ bootstrap, teamId, preselectedDocumentVersionId, onStart, onBack, onResume, busy, error }) {
  const labels = copy[document.documentElement.lang?.startsWith("ar") ? "ar" : "en"];
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
  return <main className="lm-shell" aria-label="Lockin Mode"><div className="lm-frame"><header className="lm-header"><button className="lm-wordmark" type="button" onClick={onBack}>LOCKIN<span className="lm-wordmark-dot">.</span></button><button className="lm-exit" type="button" onClick={onBack}><ArrowLeft size={18} />{labels.back}</button></header><section className="lm-step lm-setup"><h1>{teamId ? labels.team : labels.solo}</h1>{bootstrap?.active_session && <button className="lm-resume" type="button" onClick={onResume}>{labels.resume}<ArrowRight size={18} /></button>}<form className="lm-form" onSubmit={submit}>{!teamId && preselectedDocumentVersionId && <label>{labels.material}<select value={materialId} onChange={(event) => setMaterialId(event.target.value)}><option value="">{labels.independent}</option>{materials.map((item) => <option key={item.document_version_id} value={item.document_version_id}>{item.title}</option>)}</select></label>}<fieldset className="lm-duration"><legend>{labels.duration}</legend><div>{[25, 45, 60, 90].map((value) => <label key={value}><input type="radio" name="lockin-duration" value={value} checked={duration === String(value)} onChange={() => setDuration(String(value))} /><span>{value}<small>{labels.minutes}</small></span></label>)}</div></fieldset>{!teamId && <AnonymousToggle checked={anonymous} onChange={setAnonymous} label={labels.anonymous} />}{error && <p className="lm-error" role="alert">{error}</p>}<button className="lm-primary" type="submit" disabled={busy}>{labels.start}<ArrowRight size={18} /></button></form></section></div></main>;
}

function TeamLobby({ team, labels, onAction, onStart, onJoinLive, busy, error }) {
  const [name, setName] = useState(team.name);
  const [maximum, setMaximum] = useState(String(team.max_members));
  const [confirm, setConfirm] = useState(null);
  const host = team.role === "owner" && !team.closed_at;
  useEffect(() => { setName(team.name); setMaximum(String(team.max_members)); }, [team.name, team.max_members]);
  const act = async (action, body = {}) => { setConfirm(null); await onAction(action, body); };
  return <section className="lm-team" aria-labelledby="lm-team-title">
    <div className="lm-team-heading"><div><span className="lm-kicker">{labels.team}</span><h1 id="lm-team-title" dir="auto">{team.name}</h1><p>{team.member_count} / {team.max_members} {labels.members}</p></div><div className="lm-team-heading-actions">{team.closed_at ? <span>{labels.closed}</span> : team.active_session_id ? <button className="lm-primary" type="button" onClick={() => onJoinLive(team.id)}>{labels.joinLive}<ArrowRight size={18} /></button> : host ? <button className="lm-primary" type="button" onClick={() => onStart(team.id)}>{labels.start}<ArrowRight size={18} /></button> : <span className="lm-waiting">{labels.waiting}</span>}</div></div>
    {!team.closed_at && <TeamCode code={team.invite_code} labels={labels} />}
    <div className="lm-member-list">
      <h2>{labels.members}</h2>
      {team.members.map((member) => <div className="lm-member" key={member.member_id || member.user_id}>
        <span className="lm-avatar" aria-hidden="true">{member.name.slice(0, 1).toUpperCase()}</span>
        <strong dir="auto">{member.name}</strong>
        {member.role === "owner" && <span className="lm-host">{labels.host}</span>}
        {host && member.member_id !== team.self_member_id && <details className="lm-member-menu">
          <summary aria-label={`${labels.settings}: ${member.name}`}><MoreHorizontal size={19} /></summary>
          <div className="lm-member-actions">
            <button type="button" onClick={() => setConfirm({ action: "transfer-host", body: { member_id: member.member_id }, title: labels.transfer })}>{labels.transfer}</button>
            <button type="button" onClick={() => setConfirm({ action: "kick", body: { member_id: member.member_id }, title: labels.kick })}>{labels.kick}</button>
          </div>
        </details>}
      </div>)}
    </div>
    {host && <details className="lm-settings"><summary><Settings2 size={18} />{labels.settings}</summary><form onSubmit={(event) => { event.preventDefault(); void act("update", { name: name.trim(), ...(maximum !== String(team.max_members) ? { max_members: Number(maximum) } : {}) }); }}><label>{labels.teamName}<input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} required /></label><label>{labels.maxMembers}<input type="number" min={Math.max(2, team.member_count)} max={Math.max(20, team.max_members)} value={maximum} onChange={(event) => setMaximum(event.target.value)} required /></label><button type="submit" disabled={busy}>{labels.save}</button></form><div className="lm-setting-actions"><button type="button" onClick={() => void act("update", { joining_locked: !team.joining_locked })}>{team.joining_locked ? labels.unlock : labels.lock}</button><button type="button" onClick={() => setConfirm({ action: "regenerate-code", title: labels.regenerate })}>{labels.regenerate}</button><button type="button" onClick={() => setConfirm({ action: "end", title: labels.end })}>{labels.end}</button></div></details>}
    <button className="lm-leave" type="button" onClick={() => setConfirm({ action: "leave", title: labels.leave })}>{labels.leave}</button>
    {error && <p className="lm-error" role="alert">{error}</p>}
    <ConfirmDialog open={Boolean(confirm)} title={confirm?.title} message={confirm?.title} confirmLabel={labels.confirm} cancelLabel={labels.cancel} busy={busy} onCancel={() => setConfirm(null)} onConfirm={() => void act(confirm.action, confirm.body)} />
  </section>;
}

export default function LockInLobby({ bootstrap, onExit, onSolo, onTeamStart, onResume, onResumeSession, onRefresh }) {
  const labels = copy[document.documentElement.lang?.startsWith("ar") ? "ar" : "en"];
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

  const loadTeam = useCallback(async (id) => {
    try { const result = await focusApi.getLockInTeam(id); const nextTeam = /** @type {any} */ (result.team); setTeam(nextTeam); setError(""); if (nextTeam.active_session_id && nextTeam.can_resume_session) onResumeSession(nextTeam.active_session_id); }
    catch { setTeam(null); setTeamId(null); setScreen("home"); setError(labels.removed); await onRefresh(); }
  }, [labels.removed, onRefresh, onResumeSession]);

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

  function openTeam(selected) { setTeamId(selected.id); setTeam(selected); setScreen("lobby"); setError(""); }
  async function create(event) {
    event.preventDefault(); setBusy(true); setError("");
    try { const result = await focusApi.createLockInTeam({ name: name.trim(), max_members: Number(maximum), anonymous }); openTeam(result.team); await onRefresh(); }
    catch (failure) { setError(failure.message || labels.error); }
    finally { setBusy(false); }
  }
  async function join(event) {
    event.preventDefault();
    if (!/^[0-9]{6}$/.test(code)) { setError(labels.codeInvalid); return; }
    setBusy(true); setError("");
    try { const result = await focusApi.joinLockInTeam(code, anonymous); openTeam(result.team); await onRefresh(); }
    catch (failure) { setError(failure.message || labels.error); }
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
    } catch (failure) { setError(failure.message || labels.error); }
    finally { setBusy(false); }
  }

  async function joinLive(id) {
    setBusy(true); setError("");
    try { const result = await focusApi.joinLockInTeamSession(id); onResumeSession(/** @type {any} */ (result.session).id); }
    catch (failure) { setError(failure.message || labels.error); }
    finally { setBusy(false); }
  }

  const rankRows = rankTab === "solo" ? rankings.solo || [] : rankings.teams || [];
  return <main className="lm-shell" aria-label="Lockin Mode"><div className="lm-frame">
    <header className="lm-header"><button className="lm-wordmark" type="button" onClick={() => setScreen("home")} aria-label={labels.home}>LOCKIN<span className="lm-wordmark-dot">.</span></button><nav aria-label="Lockin Mode"><button type="button" className={screen === "home" ? "active" : ""} onClick={() => setScreen("home")}>{labels.home}</button><button type="button" className={screen === "leaderboard" ? "active" : ""} onClick={() => setScreen("leaderboard")}>{labels.leaderboard}</button></nav><button className="lm-exit" type="button" onClick={onExit}><X size={18} />{labels.exit}</button></header>
    {screen === "home" && <section className="lm-home" aria-labelledby="lm-title"><div className="lm-overline">LOCKIN MODE</div><h1 id="lm-title">{labels.solo}<span className="lm-slash"> / </span>{labels.team}</h1><div className="lm-choices"><button type="button" onClick={() => onSolo()}><span className="lm-choice-mark">01</span><strong>{labels.solo}</strong><ArrowRight size={22} /></button><button type="button" onClick={() => setScreen("team")}><span className="lm-choice-mark">02</span><strong>{labels.team}</strong><ArrowRight size={22} /></button></div>{active && <button className="lm-resume" type="button" onClick={onResume}><span>{labels.resume}</span><strong dir="auto">{active.team?.name || labels.solo}</strong><ArrowRight size={18} /></button>}{teams.length > 0 && <div className="lm-team-shortcuts">{teams.filter((item) => !item.closed_at).map((item) => <button type="button" key={item.id} onClick={() => openTeam(item)}><span dir="auto">{item.name}</span><small>{item.member_count} / {item.max_members}</small><ArrowRight size={16} /></button>)}</div>}{error && <p className="lm-error" role="alert">{error}</p>}</section>}
    {screen === "team" && <section className="lm-step"><button className="lm-back" type="button" onClick={() => setScreen("home")} aria-label={labels.home}><ArrowLeft size={21} /></button><h1>{labels.team}</h1><div className="lm-choices"><button type="button" onClick={() => { setError(""); setScreen("create"); }}><span className="lm-choice-mark">01</span><strong>{labels.createTeam}</strong><ArrowRight size={22} /></button><button type="button" onClick={() => { setError(""); setScreen("join"); }}><span className="lm-choice-mark">02</span><strong>{labels.joinTeam}</strong><ArrowRight size={22} /></button></div>{teams.length > 0 && <div className="lm-team-shortcuts">{teams.filter((item) => !item.closed_at).map((item) => <button type="button" key={item.id} onClick={() => openTeam(item)}><span dir="auto">{item.name}</span><small>{item.member_count} / {item.max_members}</small><ArrowRight size={16} /></button>)}</div>}</section>}
    {screen === "create" && <section className="lm-step"><button className="lm-back" type="button" onClick={() => setScreen("team")} aria-label={labels.team}><ArrowLeft size={21} /></button><h1>{labels.createTeam}</h1><form className="lm-form" onSubmit={create}><label>{labels.teamName}<input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} required /></label><label>{labels.maxMembers}<input type="number" inputMode="numeric" min="2" max="20" value={maximum} onChange={(event) => setMaximum(event.target.value)} required /></label><AnonymousToggle checked={anonymous} onChange={setAnonymous} label={labels.anonymous} />{error && <p className="lm-error" role="alert">{error}</p>}<button className="lm-primary" type="submit" disabled={busy || !name.trim()}>{labels.create}<ArrowRight size={18} /></button></form></section>}
    {screen === "join" && <section className="lm-step"><button className="lm-back" type="button" onClick={() => setScreen("team")} aria-label={labels.team}><ArrowLeft size={21} /></button><h1>{labels.joinTeam}</h1><form className="lm-form" onSubmit={join}><label>{labels.code}<input className="lm-code-input" dir="ltr" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} required /></label><AnonymousToggle checked={anonymous} onChange={setAnonymous} label={labels.anonymous} />{error && <p className="lm-error" role="alert">{error}</p>}<button className="lm-primary" type="submit" disabled={busy || code.length !== 6}>{labels.join}<ArrowRight size={18} /></button></form></section>}
    {screen === "lobby" && team && <TeamLobby team={team} labels={labels} onAction={action} onStart={onTeamStart} onJoinLive={joinLive} busy={busy} error={error} />}
    {screen === "leaderboard" && <section className="lm-leaderboard"><h1>{labels.leaderboard}</h1><div className="lm-rank-controls"><div role="group" aria-label={labels.leaderboard}><button type="button" aria-pressed={rankTab === "solo"} onClick={() => setRankTab("solo")}>{labels.solo}</button><button type="button" aria-pressed={rankTab === "teams"} onClick={() => setRankTab("teams")}>{labels.teams}</button></div><div role="group" aria-label={labels.period}><button type="button" aria-pressed={period === "weekly"} onClick={() => setPeriod("weekly")}>{labels.weekly}</button><button type="button" aria-pressed={period === "all_time"} onClick={() => setPeriod("all_time")}>{labels.allTime}</button></div></div>{rankRows.length ? <ol className="lm-rank-list">{rankRows.map((row, index) => <li key={row.id || index}><span>{String(index + 1).padStart(2, "0")}</span><strong dir="auto">{row.name}</strong><small>{Math.round((row.active_seconds ?? row.weekly_active_seconds ?? 0) / 60)} {labels.minutes}</small></li>)}</ol> : <p className="lm-empty">{labels.noRanks}</p>}</section>}
  </div></main>;
}
