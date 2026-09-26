import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { myGroupApi } from "../api/myGroup.js";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { useI18n } from "../components/I18nProvider.jsx";
import { EmptyState, ErrorPanel, LoadingPanel, Page } from "../components/ui/index.jsx";
import { GroupBadge, GroupChoice, MyGroupFlow } from "../components/myGroup/MyGroupControls.jsx";
import {
  PRACTICAL_GROUPS,
  SUBJECT_KEYS,
  THEORY_GROUPS,
  clockLabel,
  draftFromPreferences,
  practicalChoices,
  sessionsByDay,
  slotLabel,
  subjectLabel,
  timetableRows,
  withPracticalChoice
} from "../lib/myGroup.js";

export default function MyGroup() {
  const { t } = useI18n();
  const remote = useAsyncData((signal) => myGroupApi.get(signal), []);
  const [saved, setSaved] = useState(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const panel = searchParams.get("customize") === "1" ? "customize" : searchParams.get("change") === "1" ? "change" : "";
  const data = saved || remote.data;

  function openPanel(name) {
    setSearchParams(name ? { [name]: "1" } : {}, { replace: true });
  }

  if (remote.loading && !data) return <LoadingPanel />;
  if (remote.error && !data) return <ErrorPanel message={t("myGroup.loadError")} onRetry={remote.reload} />;

  if (!data.available) {
    return (
      <Page title="My Group" showHeading={false}>
        <section className="panel mg-page-card mg-card--setup">
          <EmptyState title={t("myGroup.title")} text={t("myGroup.unavailable")} />
        </section>
      </Page>
    );
  }

  if (!data.configured) {
    return (
      <Page title="My Group" showHeading={false} headingHandled>
        <section className="panel mg-page-card mg-card--setup">
          <MyGroupFlow options={data.options} idPrefix="page-my-group" headingLevel={1} onSaved={setSaved} />
        </section>
      </Page>
    );
  }

  const { preferences, timetable, options } = data;
  const canCustomize = Boolean(options?.per_subject_overrides);
  const current = {
    theoryGroup: preferences.theory_group,
    practicalGroup: preferences.default_practical_group,
    practicalOverrides: draftFromPreferences(preferences).practicalOverrides
  };
  const onSaved = (next) => { setSaved(next); openPanel(""); };
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
            <button type="button" className={`btn compact ${panel === "change" ? "btn-primary" : "btn-soft"}`} aria-expanded={panel === "change"} aria-controls="my-group-change" onClick={() => openPanel(panel === "change" ? "" : "change")}>{t("myGroup.changeGroup")}</button>
            {canCustomize && <button type="button" className={`btn compact ${panel === "customize" ? "btn-primary" : "btn-soft"}`} aria-expanded={panel === "customize"} aria-controls="my-group-customize" onClick={() => openPanel(panel === "customize" ? "" : "customize")}>{t("myGroup.customize")}</button>}
          </div>
        </header>
        {panel === "change" && (
          <div id="my-group-change" className="mg-change-panel">
            <MyGroupFlow key={preferences.updated_at} options={options} initial={current} mode="change" idPrefix="change-my-group" onSaved={onSaved} onCancel={() => openPanel("")} />
          </div>
        )}
        {panel === "customize" && canCustomize && <CustomizePanel key={preferences.updated_at} preferences={preferences} onSaved={onSaved} />}
        <Timetable timetable={timetable} />
      </section>
    </Page>
  );
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/**
 * "Theory · A" / "Practical · A1" (Year 2), "Theory · MS110" (Year 1): the kind
 * in words, so colour is never the only cue. Year 1 shows the course code the
 * official sheets use; its groups are already in the page header.
 */
function SessionMeta({ session }) {
  const { t } = useI18n();
  const code = session.code || (session.kind === "practical" ? session.practical_group : session.schedule_set);
  return (
    <span className="mg-session-meta">
      {t(session.kind === "theory" ? "myGroup.theory" : "myGroup.practical")}
      {code ? <> · <bdi dir="ltr">{code}</bdi></> : null}
    </span>
  );
}

function Timetable({ timetable }) {
  const { t } = useI18n();
  const rows = timetableRows(timetable);
  const days = sessionsByDay(timetable);
  const today = WEEKDAYS[new Date().getDay()];
  const todayLabel = <span className="mg-today">{t("myGroup.today")}</span>;
  return (
    <>
      <div className="mg-grid-scroll">
        <table className="mg-grid">
          <caption className="visually-hidden">{t("myGroup.personalSchedule")}</caption>
          <thead>
            <tr>
              <th scope="col">{t("myGroup.day")}</th>
              {timetable.slots.map((slot) => (
                <th scope="col" key={slot.start_time} aria-label={slotLabel(t, slot)}>
                  <bdi><span className="mg-slot-start">{clockLabel(t, slot.start_time)}</span> <span className="mg-slot-end">{t("myGroup.until", { time: clockLabel(t, slot.end_time) })}</span></bdi>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ day, cells }) => (
              <tr key={day} className={day === today ? "is-today" : undefined} aria-current={day === today ? "date" : undefined}>
                <th scope="row"><span className="mg-day-name">{t(`myGroup.day.${day}`)}</span>{day === today && todayLabel}</th>
                {cells.map(({ slotIndex, span, sessions }) => (
                  <td key={timetable.slots[slotIndex].start_time} colSpan={span > 1 ? span : undefined} className={sessions.length ? "" : "is-empty"}>
                    {sessions.length > 0 && <div className={`mg-cell-stack${sessions.length > 1 ? " is-clash" : ""}`} title={sessions.length > 1 ? t("myGroup.clash") : undefined}>
                      {sessions.map((session) => (
                        <span key={`${session.kind}-${session.subject}-${session.start_time}`} className={`mg-session mg-session--${session.kind}`}>
                          <span className="mg-session-name">{subjectLabel(t, session.subject)}</span>
                          <SessionMeta session={session} />
                          {session.offSlot && <bdi className="mg-session-time">{slotLabel(t, session)}</bdi>}
                        </span>
                      ))}
                    </div>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Phones and narrow cards get the same week as a day list, in time order. */}
      <ol className="mg-agenda">
        {days.map(({ day, sessions }) => (
          <li key={day} className={`mg-agenda-day${day === today ? " is-today" : ""}`}>
            <h2>{t(`myGroup.day.${day}`)}{day === today && todayLabel}</h2>
            {sessions.length ? <ul>
              {sessions.map((session) => (
                <li key={`${session.kind}-${session.subject}-${session.start_time}`} className={`mg-agenda-item mg-session--${session.kind}`}>
                  <bdi className="mg-agenda-time">{slotLabel(t, session)}</bdi>
                  <span className="mg-agenda-body">
                    <span className="mg-session-name">{subjectLabel(t, session.subject)}</span>
                    <SessionMeta session={session} />
                  </span>
                </li>
              ))}
            </ul> : <p className="mg-agenda-free">{t("myGroup.noLectures")}</p>}
          </li>
        ))}
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
