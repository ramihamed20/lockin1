import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { motivationApi } from "../api/motivation.js";
import { Icon } from "../lib/icons.jsx";
import { prefersReducedMotion } from "../lib/motion.js";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { EmptyState, ErrorPanel, LoadingPanel, Page, RadioGroup, RadioOption, Switch, Tab, TabList } from "../components/ui/index.jsx";
import { IconButton } from "../components/ui/interactive.jsx";
import { formatDateTime, formatNumber } from "../lib/i18n.js";
import { useI18n } from "../components/I18nProvider.jsx";

const PERIODS = ["weekly", "monthly", "all_time"];
const DISPLAY_MODES = [["full_name", "fullName"], ["initials", "initials"], ["anonymous", "anonymous"]];

function reveal(element) {
  if (!element) return;
  element.scrollIntoView({ block: "center", behavior: prefersReducedMotion() ? "instant" : "smooth" });
  element.focus({ preventScroll: true });
}

export default function Ranked() {
  const { t } = useI18n();
  const [period, setPeriod] = useState("weekly");
  const ranking = useAsyncData(() => motivationApi.liveRanking(period), [period]);
  const profile = useAsyncData(() => motivationApi.rankingProfile(), []);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saved, setSaved] = useState(false);
  const privacyRef = useRef(null);
  const ownRowRef = useRef(null);

  useEffect(() => { if (profile.data) setDraft(profile.data); }, [profile.data]);

  async function saveProfile(event) {
    event.preventDefault();
    if (!draft || saving) return;
    setSaving(true);
    setSaved(false);
    setSaveError("");
    try {
      setDraft(await motivationApi.updateRankingProfile({ included: draft.included === true, displayMode: draft.display_mode }));
      setSaved(true);
      profile.reload();
      ranking.reload();
    } catch (error) {
      setSaveError(error.message || t("ranked.saveError"));
    } finally { setSaving(false); }
  }

  function changeDraft(change) {
    setSaved(false);
    setSaveError("");
    setDraft((current) => ({ ...current, ...change }));
  }

  function openPrivacy() {
    if (!privacyRef.current) return;
    privacyRef.current.open = true;
    reveal(privacyRef.current.querySelector("summary"));
  }

  const data = ranking.data;
  const own = data?.own_entry;
  const entries = Array.isArray(data?.entries) ? data.entries : [];
  const excluded = profile.data?.included === false;

  return <Page title={t("rankMode.title")} headingHandled>
    <div className="rank-mode">
      <header className="rank-mode-heading">
        <div><h1>{t("rankMode.title")}</h1>{data?.cohort_name && <p dir="auto">{data.cohort_name}</p>}</div>
        <IconButton className="rank-mode-icon-button" label={t("ranked.privacy")} onClick={openPrivacy}><Icon name="settings" size={20} /></IconButton>
      </header>
      <div className="rank-mode-toolbar">
        <TabList className="ui-segmented rank-mode-periods" value={period} onChange={setPeriod} label={t("rankMode.period")}>
          {PERIODS.map((value) => <Tab key={value} value={value}>{t(`rankMode.${value}`)}</Tab>)}
        </TabList>
        <IconButton className="rank-mode-icon-button" label={t("rankMode.refresh")} onClick={ranking.reload} disabled={ranking.loading || ranking.refreshing} aria-busy={ranking.refreshing}>
          <Icon name="rotate-forward" size={18} />
        </IconButton>
      </div>

      {ranking.loading ? <RankSkeleton /> : ranking.error ? <ErrorPanel message={ranking.errorDetails || ranking.error} onRetry={ranking.reload} /> : data && <div className="rank-mode-content" aria-busy={ranking.refreshing}>
        {!data.cohort_required && <StandingSummary data={data} excluded={excluded} onPrivacy={openPrivacy} />}
        {data.cohort_required ? <section className="rank-mode-unassigned">
          <EmptyState title={t("rankMode.chooseCohort")} text={t("rankMode.chooseCohortBody")} />
          <Link className="btn btn-soft" to="/profile">{t("rankMode.editProfile")}</Link>
        </section> : <section className="rank-mode-board" aria-labelledby="rank-mode-board-title">
          <header>
            <h2 id="rank-mode-board-title">{t("rankMode.boardTitle")}</h2>
            {own && <button type="button" className="rank-mode-text-button" onClick={() => reveal(ownRowRef.current)}><Icon name="target" size={15} />{t("rankMode.findMe")}</button>}
          </header>
          <div className="rank-mode-column-labels" aria-hidden="true"><span>{t("rankMode.rankLabel")}</span><span>XP</span></div>
          {entries.length ? <ol className="rank-mode-list">{entries.map((entry) => <RankRow key={entry.entry_key} entry={entry} ownRef={ownRowRef} />)}</ol> : <EmptyState title={t("rankMode.empty")} text={t("rankMode.emptyBody")} />}
          {own && !entries.some((entry) => entry.is_me) && <div className="rank-mode-own"><p>{t("rankMode.yourPosition")}</p><ol className="rank-mode-list"><RankRow entry={own} ownRef={ownRowRef} /></ol></div>}

        </section>}
      </div>}

      <div className="rank-mode-details">
        <details className="rank-mode-panel" ref={privacyRef}>
          <summary><span className="rank-mode-setting-icon"><Icon name="eye" size={19} /></span><span><strong>{t("rankMode.privacyTitle")}</strong></span><Icon name="chevron-down" size={17} /></summary>
          <div className="rank-mode-disclosure">
            <p>{t("rankMode.privacyBody")}</p>
            {profile.loading ? <LoadingPanel /> : profile.error ? <ErrorPanel message={profile.errorDetails || profile.error} onRetry={profile.reload} /> : draft && <form onSubmit={saveProfile}>
              <fieldset disabled={saving || profile.refreshing}>
                <div className="rank-mode-inclusion"><label htmlFor="rank-mode-included">{t("ranked.includeScore")}</label><Switch id="rank-mode-included" label={t("ranked.includeScore")} checked={draft.included === true} onCheckedChange={(included) => changeDraft({ included })} /></div>
                <span className="rank-mode-choice-label">{t("ranked.howOthersSee")}</span>
                <RadioGroup className="rank-mode-display-options" value={draft.display_mode || "initials"} onChange={(display_mode) => changeDraft({ display_mode })} label={t("ranked.howOthersSee")} orientation="vertical">
                  {DISPLAY_MODES.map(([value, key]) => <RadioOption className="rank-mode-display-option" key={value} value={value} disabled={saving || profile.refreshing}>
                    <span>{t(`ranked.${key}`)}</span><span className="rank-mode-check" aria-hidden="true">{draft.display_mode === value && <Icon name="check" size={18} />}</span>
                  </RadioOption>)}
                </RadioGroup>
                <button className="btn btn-soft" type="submit">{t(saving ? "profile.saving" : "ranked.saveVisibility")}</button>
              </fieldset>
              {saveError && <p className="rank-mode-save-error" role="alert">{saveError}</p>}{saved && <p className="rank-mode-save-success" role="status"><Icon name="check" size={16} />{t("rankMode.saved")}</p>}
            </form>}
          </div>
        </details>
        <details className="rank-mode-panel">
          <summary><span className="rank-mode-setting-icon"><Icon name="help" size={19} /></span><span><strong>{t("rankMode.rulesTitle")}</strong></span><Icon name="chevron-down" size={17} /></summary>
          <div className="rank-mode-disclosure">
            <ul>{["ruleXP", "ruleScope", "ruleTies", "ruleTime", "ruleOffline"].map((key) => <li key={key}>{t(`rankMode.${key}`)}</li>)}</ul>
            {data && <div className="rank-mode-timing">
              <small>{t("rankMode.updated", { date: formatDateTime(data.generated_at, { timeZone: "Africa/Tripoli" }) })}</small>
              {data.period_end && <span>{t("rankMode.resets", { date: formatDateTime(data.period_end, { timeZone: "Africa/Tripoli" }) })}</span>}
            </div>}
          </div>
        </details>
      </div>
    </div>
  </Page>;
}

function StandingSummary({ data, excluded, onPrivacy }) {
  const { t } = useI18n();
  const own = data.own_entry;
  const hasGoal = !excluded && own && data.points_to_next_rank > 0;
  const goal = hasGoal ? own.score + data.points_to_next_rank : 0;
  const title = excluded ? t("rankMode.hidden") : own?.position === 1 ? t("rankMode.leadingShort") : hasGoal ? t("rankMode.gap", { count: formatNumber(data.points_to_next_rank) }) : "";

  return <section className="rank-mode-standing" aria-label={t("rankMode.overview")}>
    <div className="rank-mode-standing-top">
      <div className="rank-mode-position"><span>{t("ranked.yourRank")}</span><strong dir="ltr" data-compact={own?.position >= 100 ? "true" : undefined}>{own ? `#${formatNumber(own.position)}` : "—"}</strong></div>
      <div className="rank-mode-standing-info">
        <p>{t("rankMode.yourXP")}</p><strong>{excluded ? "—" : formatNumber(own?.score || 0)} <small>XP</small></strong>
        <p className="rank-mode-participant-count"><span>{t("rankMode.participants")}</span><b>{formatNumber(data.participant_count || 0)}</b></p>
      </div>
    </div>
    <div className="rank-mode-next">
      {title && <strong className="rank-mode-next-title">{title}</strong>}
      {hasGoal && <div className="rank-mode-goal">
        <progress value={own.score} max={goal} aria-label={t("rankMode.goalLabel")} />
      </div>}
      {excluded ? <button className="rank-mode-text-button" type="button" onClick={onPrivacy}>{t("rankMode.managePrivacy")}<Icon name="chevron-right" size={16} /></button> : <Link className="btn btn-primary rank-mode-study" to="/materials"><Icon name="book-open" size={17} />{t("rankMode.study")}<Icon className="rank-mode-forward" name="chevron-right" size={16} /></Link>}
    </div>
  </section>;
}

function RankRow({ entry, ownRef }) {
  const { t } = useI18n();
  return <li ref={entry.is_me ? ownRef : undefined} tabIndex={-1} className={`rank-mode-row${entry.is_me ? " is-me" : ""}`} aria-current={entry.is_me ? "true" : undefined}>
    <span className="rank-mode-place" data-podium={entry.position <= 3 ? entry.position : undefined}>{formatNumber(entry.position)}</span>
    <span className="rank-mode-avatar" aria-hidden="true">{entry.is_me ? <Icon name="user" size={19} /> : entry.display_name?.trim().charAt(0) || "·"}</span>
    <div className="rank-mode-person"><strong dir="auto">{entry.display_name}</strong>{entry.is_me && <small>{t("ranked.you")}</small>}</div>
    <strong className="rank-mode-score">{formatNumber(entry.score)}</strong>
  </li>;
}

function RankSkeleton() {
  const { t } = useI18n();
  return <div className="rank-mode-skeleton" role="status" aria-busy="true"><span className="visually-hidden">{t("common.loading")}</span><div className="rank-mode-skeleton-standing" aria-hidden="true" />{[0, 1, 2, 3].map((key) => <div className="rank-mode-skeleton-row" aria-hidden="true" key={key}><i /><span /><b /></div>)}</div>;
}
