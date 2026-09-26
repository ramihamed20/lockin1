import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { myGroupApi } from "../api/myGroup.js";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { useI18n } from "../components/I18nProvider.jsx";
import { ErrorPanel, LoadingPanel, Page } from "../components/ui/index.jsx";
import { GroupBadge, GroupChoice, MyGroupSetup } from "../components/myGroup/MyGroupControls.jsx";
import {
  PRACTICAL_GROUPS,
  SUBJECT_KEYS,
  THEORY_GROUPS,
  draftFromPreferences,
  practicalChoices,
  slotLabel,
  subjectLabel,
  timetableGrid,
  withPracticalChoice
} from "../lib/myGroup.js";

export default function MyGroup() {
  const { t } = useI18n();
  const remote = useAsyncData((signal) => myGroupApi.get(signal), []);
  const [saved, setSaved] = useState(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const customizing = searchParams.get("customize") === "1";
  const data = saved || remote.data;

  function setCustomizing(open) {
    setSearchParams(open ? { customize: "1" } : {}, { replace: true });
  }

  if (remote.loading && !data) return <LoadingPanel />;
  if (remote.error && !data) return <ErrorPanel message={t("myGroup.loadError")} onRetry={remote.reload} />;

  if (!data.configured) {
    return (
      <Page title="My Group" showHeading={false}>
        <section className="panel mg-page-card mg-card--setup"><MyGroupSetup idPrefix="page-my-group" onSaved={setSaved} /></section>
      </Page>
    );
  }

  const { preferences, timetable } = data;
  return (
    <Page title="My Group" showHeading={false} headingHandled>
      <section className="panel mg-page-card" aria-labelledby="my-group-heading">
        <header className="mg-page-head">
          <div className="mg-page-title">
            <p className="eyebrow">{t("myGroup.title")}</p>
            <h1 id="my-group-heading">{t("myGroup.personalSchedule")}</h1>
          </div>
          <div className="mg-page-tools">
            <span className="mg-badges">
              <GroupBadge labelKey="myGroup.theory" code={preferences.theory_group} />
              <GroupBadge labelKey="myGroup.practical" code={preferences.default_practical_group} />
            </span>
            <button type="button" className={`btn compact ${customizing ? "btn-primary" : "btn-soft"}`} aria-expanded={customizing} aria-controls="my-group-customize" onClick={() => setCustomizing(!customizing)}>{t("myGroup.customize")}</button>
          </div>
        </header>
        {customizing && <CustomizePanel key={preferences.updated_at} preferences={preferences} onSaved={(next) => { setSaved(next); setCustomizing(false); }} />}
        <Timetable timetable={timetable} />
        <p className="mg-legend" aria-hidden="true"><span className="mg-dot mg-dot--theory" />{t("myGroup.theory")}<span className="mg-dot mg-dot--practical" />{t("myGroup.practical")}</p>
      </section>
    </Page>
  );
}

function sessionLabel(t, session) {
  return `${subjectLabel(t, session.subject)}, ${t(session.kind === "theory" ? "myGroup.theory" : "myGroup.practical")}`;
}

function Timetable({ timetable }) {
  const { t } = useI18n();
  const rows = timetableGrid(timetable);
  return (
    <>
      <div className="mg-grid-scroll">
        <table className="mg-grid">
          <caption className="visually-hidden">{t("myGroup.personalSchedule")}</caption>
          <thead>
            <tr>
              <th scope="col">{t("myGroup.day")}</th>
              {timetable.slots.map((slot) => <th scope="col" key={slot.start_time}><bdi>{slotLabel(t, slot)}</bdi></th>)}
            </tr>
          </thead>
          <tbody>
            {timetable.days.map((day, dayIndex) => (
              <tr key={day}>
                <th scope="row">{t(`myGroup.day.${day}`)}</th>
                {rows[dayIndex].map((sessions, slotIndex) => (
                  <td key={timetable.slots[slotIndex].start_time} className={sessions.length ? "" : "is-empty"}>
                    {sessions.length > 0 && <div className={`mg-cell-stack${sessions.length > 1 ? " is-clash" : ""}`} title={sessions.length > 1 ? t("myGroup.clash") : undefined}>
                      {sessions.map((session) => <span key={`${session.kind}-${session.subject}`} className={`mg-session mg-session--${session.kind}`} aria-label={sessionLabel(t, session)}>{subjectLabel(t, session.subject)}</span>)}
                    </div>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Phones get the same data as a day list rather than a crushed grid. */}
      <ol className="mg-agenda">
        {timetable.days.map((day, dayIndex) => {
          const entries = rows[dayIndex].flatMap((sessions, slotIndex) => sessions.map((session) => ({ session, slot: timetable.slots[slotIndex] })));
          return (
            <li key={day} className="mg-agenda-day">
              <h2>{t(`myGroup.day.${day}`)}</h2>
              {entries.length ? <ul>
                {entries.map(({ session, slot }) => (
                  <li key={`${session.kind}-${session.subject}`} className={`mg-agenda-item mg-session--${session.kind}`}>
                    <bdi className="mg-agenda-time">{slotLabel(t, slot)}</bdi>
                    <span aria-label={sessionLabel(t, session)}>{subjectLabel(t, session.subject)}</span>
                  </li>
                ))}
              </ul> : <p className="mg-agenda-free" aria-hidden="true">—</p>}
            </li>
          );
        })}
      </ol>
    </>
  );
}

function CustomizePanel({ preferences, onSaved }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(() => draftFromPreferences(preferences));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const choices = practicalChoices(draft);

  function changeDefaults(changes) {
    // Re-apply each override against the new defaults so one that now equals
    // the default stops being stored as an override.
    const next = { ...draft, ...changes, practicalOverrides: {} };
    setDraft(Object.entries(draft.practicalOverrides).reduce((acc, [subject, choice]) => withPracticalChoice(acc, subject, choice), next));
  }

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      onSaved(await myGroupApi.save(draft));
    } catch {
      setError(t("myGroup.saveError"));
      setSaving(false);
    }
  }

  return (
    <form id="my-group-customize" className="mg-customize-panel" onSubmit={save}>
      <div className="mg-customize-defaults">
        <GroupChoice label={t("myGroup.selectTheory")} name="customize-theory" options={THEORY_GROUPS} value={draft.theoryGroup} onChange={(theoryGroup) => changeDefaults({ theoryGroup })} disabled={saving} />
        <GroupChoice label={t("myGroup.selectPractical")} name="customize-practical" options={PRACTICAL_GROUPS} value={draft.defaultPracticalGroup} onChange={(defaultPracticalGroup) => changeDefaults({ defaultPracticalGroup })} disabled={saving} />
      </div>
      <fieldset className="mg-overrides" disabled={saving}>
        <legend>{t("myGroup.perSubject")}</legend>
        {SUBJECT_KEYS.map((subject) => {
          const choice = choices[subject];
          const custom = Boolean(draft.practicalOverrides[subject]);
          const name = subjectLabel(t, subject);
          return (
            <div key={subject} className={`mg-override-row${custom ? " is-custom" : ""}`}>
              <span className="mg-override-name">{name}</span>
              <label>
                <span className="visually-hidden">{`${name} — ${t("myGroup.scheduleSet")}`}</span>
                <select dir="ltr" value={choice.scheduleSet} onChange={(event) => setDraft(withPracticalChoice(draft, subject, { ...choice, scheduleSet: event.target.value }))}>
                  {THEORY_GROUPS.map((group) => <option key={group} value={group}>{group}</option>)}
                </select>
              </label>
              <label>
                <span className="visually-hidden">{`${name} — ${t("myGroup.group")}`}</span>
                <select dir="ltr" value={choice.practicalGroup} onChange={(event) => setDraft(withPracticalChoice(draft, subject, { ...choice, practicalGroup: event.target.value }))}>
                  {PRACTICAL_GROUPS.map((group) => <option key={group} value={group}>{group}</option>)}
                </select>
              </label>
            </div>
          );
        })}
      </fieldset>
      <div className="mg-actions">
        {error && <p className="mg-error" role="alert">{error}</p>}
        <button type="button" className="btn btn-soft compact" disabled={saving || !Object.keys(draft.practicalOverrides).length} onClick={() => setDraft({ ...draft, practicalOverrides: {} })}>{t("myGroup.reset")}</button>
        <button type="submit" className="btn btn-primary compact" disabled={saving}>{saving ? t("myGroup.saving") : t("myGroup.save")}</button>
      </div>
    </form>
  );
}
