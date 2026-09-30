import { useEffect, useState } from "react";
import { accountsApi } from "../api/accounts.js";
import { motivationApi } from "../api/motivation.js";
import { progressApi } from "../api/progress.js";
import { Icon } from "../lib/icons.jsx";
import { Link } from "react-router-dom";
import { LoadingPanel, Page, ProgressLine } from "../components/ui/index.jsx";
import { AccountFieldErrors, AccountFormAlert, fieldErrorAttributes } from "../components/account/AccountFormErrors.jsx";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { formatDate, formatNumber as formatLocaleNumber } from "../lib/i18n.js";
import { UserAvatar } from "../components/shared/UserAvatar.jsx";
import { ProfilePictureEditor } from "../components/account/ProfilePictureEditor.jsx";
import { ConfirmDialog } from "../components/shared/ConfirmDialog.jsx";
import { useI18n } from "../components/I18nProvider.jsx";
import { PRODUCT_ROLES } from "../api/contracts.js";
import { hasProductRole } from "../lib/authz.js";
import { educationPathFor, isSelectableStudyPath, uniqueEducationOptions } from "../lib/educationPath.js";

function resolved(result, fallback) {
  return result.status === "fulfilled" ? result.value : fallback;
}

async function loadProfileWorkspace() {
  const results = await Promise.allSettled([
    accountsApi.getProfile(),
    progressApi.learningDashboard(),
    motivationApi.xpSummary(),
    motivationApi.xpLedger({ pageSize: 100 }),
    motivationApi.streakSummary(),
    motivationApi.currentRanking()
  ]);
  const [account, learning, xp, ledger, streak, ranking] = results;
  return {
    account: resolved(account, null),
    learning: resolved(learning, {}),
    xp: resolved(xp, {}),
    ledger: resolved(ledger, { count: 0, results: [] }),
    streak: resolved(streak, {}),
    ranking: resolved(ranking, {}),
    availability: {
      account: account.status === "fulfilled",
      learning: learning.status === "fulfilled",
      xp: xp.status === "fulfilled",
      ledger: ledger.status === "fulfilled",
      streak: streak.status === "fulfilled",
      ranking: ranking.status === "fulfilled"
    },
    unavailableCount: results.filter((result) => result.status === "rejected").length
  };
}

function asNumber(value) {
  return Number(value) || 0;
}

function formatNumber(value) {
  return formatLocaleNumber(asNumber(value));
}

function optionalNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatOptionalNumber(value, fallback) {
  const number = optionalNumber(value);
  return number === null ? fallback : formatLocaleNumber(number);
}

function dateLabel(value, t) {
  if (!value) return t("profile.memberDateUnavailable");
  const formatted = formatDate(value, { day: "numeric", month: "short", year: "numeric" });
  return formatted === "—" ? t("profile.memberDateUnavailable") : formatted;
}

function activityCells(entries, days = 91) {
  const values = new Map();
  entries.forEach((entry) => {
    const date = new Date(entry?.occurred_at);
    if (Number.isNaN(date.getTime())) return;
    const key = date.toISOString().slice(0, 10);
    values.set(key, (values.get(key) || 0) + 1);
  });

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (days - index - 1));
    const key = date.toISOString().slice(0, 10);
    const value = values.get(key) || 0;
    return { key, value, level: value >= 4 ? 4 : value >= 3 ? 3 : value >= 2 ? 2 : value ? 1 : 0 };
  });
}

function ActivityHeatmap({ cells, onSelect, compact = false }) {
  const { t } = useI18n();
  const [activeIndex, setActiveIndex] = useState(() => Math.max(0, cells.length - 1));

  useEffect(() => {
    setActiveIndex((current) => Math.min(Math.max(0, current), Math.max(0, cells.length - 1)));
  }, [cells.length]);

  function select(index) {
    const bounded = Math.min(Math.max(0, index), cells.length - 1);
    setActiveIndex(bounded);
    onSelect?.(cells[bounded]);
  }

  function handleKeyDown(event) {
    const rtl = document.documentElement.dir === "rtl";
    // One column per week, one row per weekday: across moves a week, down a day.
    const horizontal = event.key === "ArrowRight" ? (rtl ? -7 : 7) : event.key === "ArrowLeft" ? (rtl ? 7 : -7) : 0;
    const vertical = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    const next = event.key === "Home" ? 0 : event.key === "End" ? cells.length - 1 : activeIndex + horizontal + vertical;
    if (!horizontal && !vertical && !["Home", "End", "Enter", " "].includes(event.key)) return;
    event.preventDefault();
    select(["Enter", " "].includes(event.key) ? activeIndex : next);
  }

  function handleClick(event) {
    const cell = event.target.closest?.("[data-activity-index]");
    if (cell) select(Number(cell.dataset.activityIndex));
  }

  return (
    <div
      className={`profile-heatmap ${compact ? "profile-heatmap--compact" : ""}`.trim()}
      role="grid"
      tabIndex={0}
      aria-label={t("profile.heatmapLabel")}
      aria-activedescendant={cells[activeIndex] ? `activity-${compact ? "compact-" : ""}${cells[activeIndex].key}` : undefined}
      onKeyDown={handleKeyDown}
      onClick={handleClick}
    >
      {cells.map((cell, index) => (
        <span
          id={`activity-${compact ? "compact-" : ""}${cell.key}`}
          role="gridcell"
          key={cell.key}
          data-activity-index={index}
          className={`profile-heat-cell level-${cell.level}`}
          aria-label={t("profile.cellLabel", { date: cell.key, awards: t("profile.awardsCount", { count: cell.value }) })}
          aria-selected={activeIndex === index}
        />
      ))}
    </div>
  );
}

export default function Profile({ user, onUserUpdate }) {
  const { t } = useI18n();
  const profile = useAsyncData(loadProfileWorkspace, [user?.id]);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: user?.name || "", preferredLanguage: user?.preferredLanguage || "en" });
  const [saving, setSaving] = useState(false);
  const [profileError, setProfileError] = useState(null);
  const [selectedActivity, setSelectedActivity] = useState(null);
  const [cohorts, setCohorts] = useState([]);
  const [cohortLoading, setCohortLoading] = useState(false);
  const [studyPathOpen, setStudyPathOpen] = useState(false);
  const [selectedCohortId, setSelectedCohortId] = useState("");
  const [selectedCollegeId, setSelectedCollegeId] = useState("");
  const [selectedSpecialtyId, setSelectedSpecialtyId] = useState("");
  const [pendingCohortId, setPendingCohortId] = useState("");
  const [changingCohort, setChangingCohort] = useState(false);
  const [studyPathMessage, setStudyPathMessage] = useState("");

  const workspace = profile.data || {};
  const account = workspace.account || user;
  const isFounder = hasProductRole(account, PRODUCT_ROLES.ADMINISTRATOR);
  const contextStorageKey = account?.id ? `lockin.education.context.${account.id}` : "";
  const founderContextId = isFounder && contextStorageKey && typeof window !== "undefined"
    ? window.sessionStorage.getItem(contextStorageKey) || ""
    : "";
  const activeCohortId = founderContextId || account?.cohort?.id || "";
  const activeCohort = cohorts.find((cohort) => cohort.id === activeCohortId) || account?.cohort || null;
  const selectableCohorts = cohorts.filter(isSelectableStudyPath);
  const studyPathColleges = uniqueEducationOptions(selectableCohorts, "college");
  const studyPathSpecialties = (() => {
    const options = new Map();
    selectableCohorts.filter((cohort) => educationPathFor(cohort).collegeId === selectedCollegeId).forEach((cohort) => {
      const path = educationPathFor(cohort);
      if (!options.has(path.specialtyId)) options.set(path.specialtyId, { id: path.specialtyId, label: path.specialtyLabel });
    });
    return [...options.values()];
  })();
  const studyPathYears = selectableCohorts.filter((cohort) => {
    const path = educationPathFor(cohort);
    return path.collegeId === selectedCollegeId && path.specialtyId === selectedSpecialtyId;
  });
  const learning = workspace.learning || {};
  const xp = workspace.xp || {};
  const streak = workspace.streak || {};
  const ranking = workspace.ranking || {};
  const dueReviewCount = Array.isArray(learning.review_due) ? learning.review_due.length : null;
  const level = asNumber(xp.level) || 1;
  const levelProgress = asNumber(xp.level_target) ? Math.round((asNumber(xp.level_progress) / asNumber(xp.level_target)) * 100) : 0;
  const recentActivity = activityCells(Array.isArray(workspace.ledger?.results) ? workspace.ledger.results : []);
  const activeDays = recentActivity.filter((cell) => cell.value > 0).length;
  const totalStudyTime = typeof learning.total_study_time === "string" && learning.total_study_time.trim() ? learning.total_study_time : null;
  const studyInsight = dueReviewCount > 0
    ? t("profile.insightDue", { count: dueReviewCount })
    : activeDays > 0
      ? t("profile.insightActive", { count: activeDays })
      : t("profile.insightNone");
  const profileRank = optionalNumber(ranking.own_entry?.position);
  const rankScore = optionalNumber(ranking.own_entry?.score);

  useEffect(() => {
    setForm({ name: account?.name || user?.name || "", preferredLanguage: account?.preferredLanguage || user?.preferredLanguage || "en" });
  }, [account?.id, account?.name, account?.preferredLanguage, user?.name, user?.preferredLanguage]);

  async function saveProfile(event) {
    event.preventDefault();
    setSaving(true);
    setProfileError(null);
    try {
      const updated = await accountsApi.updateProfile({ fullName: form.name });
      onUserUpdate?.(updated);
      setEditing(false);
      profile.reload();
    } catch (error) {
      setProfileError(error);
    } finally {
      setSaving(false);
    }
  }

  function handleAvatarSaved(updated) {
    onUserUpdate?.(updated);
    profile.reload();
  }

  async function openStudyPathChange() {
    setCohortLoading(true);
    setProfileError(null);
    try {
      const options = await accountsApi.listCohorts();
      setCohorts(options);
      setSelectedCohortId(activeCohortId);
      const activePath = educationPathFor(options.find((cohort) => cohort.id === activeCohortId) || account?.cohort);
      setSelectedCollegeId(activePath.collegeId || "");
      setSelectedSpecialtyId(activePath.specialtyId || "");
      setStudyPathOpen(true);
      setStudyPathMessage("");
    }
    catch (error) { setProfileError(error); }
    finally { setCohortLoading(false); }
  }

  function reviewStudyPathChange() {
    if (!selectedCohortId || selectedCohortId === activeCohortId) return;
    setPendingCohortId(selectedCohortId);
  }

  async function confirmStudyPathChange() {
    if (!pendingCohortId) return;
    setChangingCohort(true);
    setProfileError(null);
    try {
      const next = cohorts.find((cohort) => cohort.id === pendingCohortId);
      if (!next) throw new Error(t("profile.pathUnavailable"));
      if (isFounder) {
        window.sessionStorage.setItem(contextStorageKey, next.id);
        window.dispatchEvent(new window.CustomEvent("lockin:education-context-changed", { detail: { cohortId: next.id } }));
        setStudyPathMessage(t("profile.contextChanged", { name: next.name_en }));
      } else {
        const updated = await accountsApi.updateProfile({ cohortId: next.id, confirmCohortChange: true });
        onUserUpdate?.(updated);
        profile.reload();
        window.dispatchEvent(new window.CustomEvent("lockin:education-context-changed", { detail: { cohortId: next.id } }));
        setStudyPathMessage(t("profile.pathChanged", { name: next.name_en }));
      }
      setSelectedCohortId(next.id);
      setPendingCohortId("");
      setStudyPathOpen(false);
    } catch (error) {
      setProfileError(error);
      setPendingCohortId("");
    }
    finally { setChangingCohort(false); }
  }

  if (profile.loading) return <Page title="My Profile"><LoadingPanel variant="profile" /></Page>;

  const displayName = account?.name || t("profile.learner");
  const bestStreak = optionalNumber(streak.longest_days);

  return (
    <Page title="My Profile" headingHandled>
      <div className="profile-v2">
        {workspace.unavailableCount > 0 && <p className="profile-v2-note" role="status"><Icon name="activity" size={15} />{t("profile.syncNote")}</p>}

        {/* Identity first, the way an account page opens: who you are, then
            what you are working through. */}
        <header className="profile-v2-hero">
          <UserAvatar user={account} className="profile-avatar-image profile-v2-avatar" alt={t("profile.avatarPreviewAlt")} loading="eager" />
          <div className="profile-v2-identity">
            <h1 dir="auto">{displayName}</h1>
            <p dir="auto">{[account?.email, t("profile.memberSinceValue", { date: dateLabel(account?.dateJoined, t) })].filter(Boolean).join(" · ")}</p>
          </div>
          <button className="btn btn-soft compact profile-v2-edit-toggle" type="button" aria-expanded={editing} aria-controls="profile-v2-edit" onClick={() => setEditing((value) => !value)}>
            <Icon name="pencil" size={14} /> {t("profile.editProfile")}
          </button>
        </header>

        {editing && <form id="profile-v2-edit" onSubmit={saveProfile} className="ui-group profile-v2-edit">
          <label className="field"><span>{t("profile.displayName")}</span><input type="text" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required {...fieldErrorAttributes(profileError, "full_name", "profile-name-error")} /><AccountFieldErrors error={profileError} field="full_name" id="profile-name-error" /></label>
          <ProfilePictureEditor user={account} onSaved={handleAvatarSaved} />
          <AccountFormAlert error={profileError} />
          <div className="profile-v2-edit-actions"><button className="btn btn-soft compact" type="button" onClick={() => setEditing(false)}>{t("common.cancel")}</button><button className="btn btn-primary compact" type="submit" aria-busy={saving || undefined} disabled={saving}>{t(saving ? "profile.saving" : "profile.saveChanges")}</button></div>
        </form>}

        <section className="profile-v2-section" aria-labelledby="profile-v2-progress-heading">
          <div className="profile-v2-section-head">
            <h2 id="profile-v2-progress-heading">{t("profile.progressHeading")}</h2>
            <Link className="ui-section-link" to="/progress">{t("profile.seeProgress")}</Link>
          </div>
          <div className="ui-group profile-v2-level">
            <div className="profile-v2-level-top">
              <strong>{t("profile.levelValue", { level })}</strong>
              <span dir="auto">{t("profile.levelProgress", { current: formatNumber(xp.level_progress), target: formatNumber(xp.level_target) })}</span>
            </div>
            <ProgressLine value={levelProgress} />
          </div>
          <div className="ui-stat-row profile-v2-stats">
            <div className="ui-stat"><span>{t("profile.totalXp")}</span><strong dir="auto">{formatOptionalNumber(xp.total_points, "—")}</strong></div>
            <div className="ui-stat"><span>{t("profile.currentStreak")}</span><strong dir="auto">{formatOptionalNumber(streak.current_days, "—")}</strong></div>
            <div className="ui-stat"><span>{t("profile.bestStreak")}</span><strong dir="auto">{bestStreak === null ? "—" : formatNumber(bestStreak)}</strong></div>
            <div className="ui-stat"><span>{t("profile.reviewQueue")}</span><strong dir="auto">{formatOptionalNumber(dueReviewCount, "—")}</strong></div>
          </div>
        </section>

        <section className="profile-v2-section" aria-labelledby="profile-v2-activity-heading">
          <div className="profile-v2-section-head">
            <h2 id="profile-v2-activity-heading">{t("profile.studyActivity")}</h2>
            <span className="profile-v2-section-meta">{t("profile.last13")}</span>
          </div>
          <div className="ui-group profile-v2-activity">
            <ActivityHeatmap cells={recentActivity} onSelect={setSelectedActivity} />
            <div className="profile-v2-activity-foot">
              <p dir="auto" role="status">{selectedActivity ? <><strong dir="auto">{selectedActivity.key}</strong> · {t("profile.awardsRecorded", { count: selectedActivity.value })}</> : studyInsight}</p>
              <div className="profile-v2-legend" aria-hidden="true"><small>{t("profile.less")}</small>{[0, 1, 2, 3, 4].map((cellLevel) => <i key={cellLevel} className={`profile-heat-cell level-${cellLevel}`} />)}<small>{t("profile.more")}</small></div>
            </div>
          </div>
          {(profileRank !== null || totalStudyTime) && <ul className="ui-group">
            {profileRank !== null && <li className="ui-row">
              <span className="ui-row-icon"><Icon name="trophy" size={17} /></span>
              <span className="ui-row-body"><strong>{t("profile.rankingRow")}</strong><small dir="auto">{ranking.definition?.title || t("profile.currentPosition")}</small></span>
              <span className="ui-row-value" dir="auto">#{formatNumber(profileRank)}{rankScore !== null ? ` · ${t("profile.pointsValue", { count: rankScore })}` : ""}</span>
            </li>}
            {totalStudyTime && <li className="ui-row">
              <span className="ui-row-icon"><Icon name="clock" size={17} /></span>
              <span className="ui-row-body"><strong>{t("profile.totalStudyTime")}</strong></span>
              <span className="ui-row-value" dir="auto">{totalStudyTime}</span>
            </li>}
          </ul>}
        </section>

        <section className="profile-v2-section" aria-labelledby="profile-v2-path-heading">
          <div className="profile-v2-section-head"><h2 id="profile-v2-path-heading">{t("profile.studyPath")}</h2></div>
          <div className="ui-group">
            <div className="ui-row">
              <span className="ui-row-icon"><Icon name="book-open" size={17} /></span>
              <span className="ui-row-body"><strong>{t("profile.studyPathTitle")}</strong><small dir="auto">{activeCohort?.name_en || t("profile.noStudyPath")}</small></span>
            </div>
            {!studyPathOpen && <button className="ui-row profile-v2-path-action" type="button" onClick={openStudyPathChange} disabled={cohortLoading} aria-busy={cohortLoading || undefined}>
              <span className="ui-row-body"><span>{cohortLoading ? t("profile.loadingPaths") : t("profile.changeStudyPath")}</span></span>
            </button>}
            {studyPathOpen && <div className="profile-v2-path-form">
              <label className="field"><span>{t("profile.college")}</span><select value={selectedCollegeId} onChange={(event) => { setSelectedCollegeId(event.target.value); setSelectedSpecialtyId(""); setSelectedCohortId(""); }}><option value="">{t("profile.chooseCollege")}</option>{studyPathColleges.map((college) => <option key={college.id} value={college.id}>{college.label}</option>)}</select></label>
              <label className="field"><span>{t("profile.specialty")}</span><select value={selectedSpecialtyId} disabled={!selectedCollegeId} onChange={(event) => { setSelectedSpecialtyId(event.target.value); setSelectedCohortId(""); }}><option value="">{t("profile.chooseSpecialty")}</option>{studyPathSpecialties.map((specialty) => <option key={specialty.id} value={specialty.id}>{specialty.label}</option>)}</select></label>
              <label className="field"><span>{t("profile.yearBatch")}</span><select value={selectedCohortId} disabled={!selectedSpecialtyId} onChange={(event) => setSelectedCohortId(event.target.value)}><option value="">{t("profile.chooseYear")}</option>{studyPathYears.map((cohort) => <option key={cohort.id} value={cohort.id}>{educationPathFor(cohort).yearLabel}</option>)}</select></label>
              <div className="profile-v2-edit-actions"><button className="btn btn-soft compact" type="button" onClick={() => setStudyPathOpen(false)}>{t("common.cancel")}</button><button className="btn btn-primary compact" type="button" disabled={!selectedCohortId || selectedCohortId === activeCohortId} onClick={reviewStudyPathChange}>{t("profile.reviewChange")}</button></div>
            </div>}
          </div>
          {studyPathMessage && <p className="ui-group-footer" role="status">{studyPathMessage}</p>}
          {!editing && <AccountFormAlert error={profileError} />}
        </section>

        <ConfirmDialog open={Boolean(pendingCohortId)} title={t(isFounder ? "profile.contextTitle" : "profile.changePathTitle")} message={t(isFounder ? "profile.contextMessage" : "profile.changePathMessage")} confirmLabel={changingCohort ? t("profile.changing") : t(isFounder ? "profile.contextConfirm" : "profile.changePathConfirm")} busy={changingCohort} onCancel={() => setPendingCohortId("")} onConfirm={confirmStudyPathChange} />
      </div>
    </Page>
  );
}
