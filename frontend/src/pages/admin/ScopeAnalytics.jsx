import { useState } from "react";
import { adminControlApi } from "../../api/adminControl.js";
import { useAsyncData } from "../../hooks/useAsyncData.js";
import { Icon } from "../../lib/icons.jsx";
import { formatNumber } from "../../lib/i18n.js";
import { EmptyState, ErrorPanel, LoadingPanel } from "../../components/ui/index.jsx";

/**
 * Platform totals for Overall, one University, one Specialty or one Year.
 *
 * Every figure is aggregated on the server for the selected scope. The choices
 * are the server's own University -> Specialty -> Year nodes, sent back as ids,
 * so a Specialty name shared by two universities is never one filter.
 */
const EMPTY_SCOPE = { university: "", specialty: "", year: "" };
const LEVEL_LABELS = { university: "University", specialty: "Specialty", year: "Year" };

function percent(value) {
  return value == null ? "—" : `${value}%`;
}

function Kpi({ label, value, hint = "", icon, tone = "purple" }) {
  return <article className={`creator-metric tone-${tone}`}><span><Icon name={icon} size={18} /></span><div><small>{label}</small><strong>{value}</strong>{hint && <p>{hint}</p>}</div></article>;
}

function isEmpty(metrics) {
  return !metrics.students && !metrics.subjects && !metrics.sheets && !metrics.published_questions && !metrics.question_answers;
}

export default function ScopeAnalytics() {
  const [scope, setScope] = useState(EMPTY_SCOPE);
  const data = useAsyncData(() => adminControlApi.scopedAnalytics(scope), [scope.university, scope.specialty, scope.year]);
  const body = data.data;

  function choose(level, value) {
    // Changing a level clears everything beneath it: a Year belongs to exactly
    // one Specialty, and a Specialty to exactly one University.
    if (level === "university") setScope({ ...EMPTY_SCOPE, university: value });
    if (level === "specialty") setScope((current) => ({ ...current, specialty: value, year: "" }));
    if (level === "year") setScope((current) => ({ ...current, year: value }));
  }

  function chooseLevel(level) {
    if (level === "overall") setScope(EMPTY_SCOPE);
    if (level === "university") setScope((current) => ({ ...current, specialty: "", year: "" }));
    if (level === "specialty") setScope((current) => ({ ...current, year: "" }));
  }

  const level = body?.scope?.level || "overall";
  const options = body?.options || { universities: [], specialties: [], years: [] };
  const path = [body?.scope?.university, body?.scope?.specialty, body?.scope?.year].filter(Boolean);

  return <section className="creator-panel scope-analytics" aria-labelledby="scope-analytics-title" aria-busy={data.loading}>
    <div className="creator-panel-heading"><div><p>Platform data</p><h2 id="scope-analytics-title">Scope analytics</h2><span>{path.length ? path.map((item) => item.title).join(" → ") : "Overall · every university"}</span></div>{data.loading && body && <span className="creator-status-dot">Updating</span>}</div>
    <div className="scope-analytics-filters">
      <label className="field"><span>Scope</span><select value={level} onChange={(event) => chooseLevel(event.target.value)}>
        <option value="overall">Overall</option>
        {["university", "specialty", "year"].map((item) => <option key={item} value={item} disabled={!scope[item]}>{LEVEL_LABELS[item]}</option>)}
      </select></label>
      <label className="field"><span>University</span><select value={scope.university} onChange={(event) => choose("university", event.target.value)} disabled={!options.universities.length}>
        <option value="">All universities</option>
        {options.universities.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
      </select></label>
      <label className="field"><span>Specialty</span><select value={scope.specialty} onChange={(event) => choose("specialty", event.target.value)} disabled={!scope.university || !options.specialties.length}>
        <option value="">{scope.university ? "All specialties" : "Choose a university"}</option>
        {options.specialties.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
      </select></label>
      <label className="field"><span>Year</span><select value={scope.year} onChange={(event) => choose("year", event.target.value)} disabled={!scope.specialty || !options.years.length}>
        <option value="">{scope.specialty ? "All years" : "Choose a specialty"}</option>
        {options.years.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
      </select></label>
    </div>
    {!body && data.loading ? <LoadingPanel /> : data.error ? <ErrorPanel message={data.error} onRetry={() => setScope(EMPTY_SCOPE)} /> : body && <ScopeBody body={body} onDrill={choose} />}
  </section>;
}

function ScopeBody({ body, onDrill }) {
  const { metrics, breakdown } = body;
  if (isEmpty(metrics)) return <EmptyState icon="analytics" title="No data in this scope yet" text="Students, sheets and answers will be counted here as soon as this scope has any." />;
  return <>
    <section className="creator-metrics creator-metrics-four scope-analytics-kpis" aria-label="Scope totals">
      <Kpi label="Students" value={formatNumber(metrics.students)} hint={`${formatNumber(metrics.active_students)} active in ${body.active_window_days} days`} icon="user" />
      <Kpi label="Universities" value={formatNumber(metrics.universities)} hint={`${formatNumber(metrics.specialties)} specialties · ${formatNumber(metrics.years)} years`} icon="home" />
      <Kpi label="Subjects" value={formatNumber(metrics.subjects)} hint={`${formatNumber(metrics.sheets)} published sheets`} icon="book-open" tone="gold" />
      <Kpi label="Published questions" value={formatNumber(metrics.published_questions)} icon="file-question" tone="gold" />
      <Kpi label="Question answers" value={formatNumber(metrics.question_answers)} hint={`${formatNumber(metrics.correct_answers)} correct · ${formatNumber(metrics.incorrect_answers)} incorrect`} icon="list-checks" />
      <Kpi label="Accuracy" value={percent(metrics.accuracy)} hint="Correct share of all answers" icon="target" tone="green" />
      <Kpi label="XP awarded" value={formatNumber(metrics.xp_awarded)} hint="Net XP ledger total" icon="sparkles" tone="gold" />
      <Kpi label="Active subscriptions" value={formatNumber(metrics.active_subscriptions)} hint={`${formatNumber(metrics.trial_subscriptions)} on trial`} icon="layers" tone="green" />
    </section>
    {breakdown.level && breakdown.rows.length > 0 && <div className="creator-table-wrap"><table className="creator-table scope-analytics-table">
      <caption className="visually-hidden">Breakdown by {LEVEL_LABELS[breakdown.level].toLowerCase()}</caption>
      <thead><tr><th>{LEVEL_LABELS[breakdown.level]}</th><th>Students</th><th>Subjects</th><th>Sheets</th><th>Published questions</th><th>Answers</th><th>Accuracy</th></tr></thead>
      <tbody>{breakdown.rows.map((row) => <tr key={row.id}>
        <td className="is-identity"><button className="scope-analytics-drill" type="button" onClick={() => onDrill(breakdown.level, row.id)}><strong>{row.title}</strong><Icon name="chevron-right" size={15} /></button></td>
        <td data-label="Students">{formatNumber(row.students)}</td>
        <td data-label="Subjects">{formatNumber(row.subjects)}</td>
        <td data-label="Sheets">{formatNumber(row.sheets)}</td>
        <td data-label="Published questions">{formatNumber(row.published_questions)}</td>
        <td data-label="Answers">{formatNumber(row.question_answers)}</td>
        <td data-label="Accuracy">{percent(row.accuracy)}</td>
      </tr>)}</tbody>
    </table></div>}
  </>;
}
