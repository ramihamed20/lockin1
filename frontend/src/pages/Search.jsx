import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { discoveryApi } from "../api/learning.js";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { EmptyState, ErrorPanel, ListRow, LoadingPanel, Page } from "../components/ui/index.jsx";
import { PaginationControls } from "../components/learning/PaginationControls.jsx";

const KIND_OPTIONS = [
  ["", "All results"],
  ["subject", "Subjects"],
  ["learning_object", "Learning materials"]
];

const CONTENT_TYPE_OPTIONS = [
  ["", "All formats"],
  ["pdf", "PDF"],
  ["audio", "Audio"],
  ["video", "Video"]
];

function resultDestination(result) {
  if (result.resource_kind === "learning_object") return `/materials/objects/${result.resource_id}`;
  if (["subject", "course", "module", "lesson"].includes(result.resource_kind)) return `/materials/${result.resource_id}`;
  return null;
}

function resultLabel(result) {
  const kind = String(result.resource_kind || "result").replaceAll("_", " ");
  return `${kind}${result.content_type ? ` · ${String(result.content_type).toUpperCase()}` : ""}`;
}

export default function Search() {
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get("q") || "";
  const kind = searchParams.get("kind") || "";
  const contentType = searchParams.get("content_type") || "";
  const academicPath = searchParams.get("academic_path") || "";
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const [draft, setDraft] = useState(query);

  useEffect(() => setDraft(query), [query]);

  const results = useAsyncData(
    () => query.trim()
      ? discoveryApi.search({ query, kinds: kind ? [kind] : [], contentTypes: contentType ? [contentType] : [], academicPath, page })
      : Promise.resolve({ count: 0, next: null, previous: null, results: [] }),
    [query, kind, contentType, academicPath, page]
  );

  function updateSearch(changes) {
    const next = new URLSearchParams(searchParams);
    Object.entries(changes).forEach(([key, value]) => {
      if (value) next.set(key, String(value));
      else next.delete(key);
    });
    setSearchParams(next);
  }

  function submitSearch(event) {
    event.preventDefault();
    updateSearch({ q: draft.trim(), page: "" });
  }

  return (
    <Page title="Search" subtitle="Search the server-indexed academic catalogue available to your account.">
      <form className="password-form" onSubmit={submitSearch}>
        <label className="field"><span>Search catalogue</span><input type="search" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Search subjects or published material" maxLength="120" /></label>
        <div className="focus-timer-actions"><button className="btn btn-primary" type="submit">Search</button></div>
        <div className="choice-grid">
          <label className="field"><span>Result type</span><select value={kind} onChange={(event) => updateSearch({ kind: event.target.value, page: "" })}>{KIND_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="field"><span>Format</span><select value={contentType} onChange={(event) => updateSearch({ content_type: event.target.value, page: "" })}>{CONTENT_TYPE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="field"><span>Academic path</span><input value={academicPath} onChange={(event) => updateSearch({ academic_path: event.target.value, page: "" })} placeholder="Optional path prefix" /></label>
        </div>
      </form>

      {!query.trim() ? <EmptyState title="Search the catalogue" text="Enter a term to search the published academic resources available through the Django API." /> : results.loading ? <LoadingPanel /> : results.error ? <ErrorPanel message={results.error} onRetry={results.reload} /> : (
        <>
          <section className="list-panel">
            {results.data.results.length ? results.data.results.map((result) => {
              const destination = resultDestination(result);
              return <ListRow key={`${result.resource_kind}-${result.resource_id}`} title={result.title} meta={`${resultLabel(result)}${result.summary ? ` · ${result.summary}` : ""}`} icon="search" action={destination ? <Link className="btn btn-soft compact" to={destination}>Open</Link> : <button className="btn btn-soft compact" type="button" disabled>Available in a later phase</button>} />;
            }) : <EmptyState title="No matches" text="Try another term or clear one of the server-supported filters." />}
          </section>
          <PaginationControls page={page} pageData={results.data} onPageChange={(nextPage) => updateSearch({ page: nextPage })} label="Search result pages" />
        </>
      )}
    </Page>
  );
}
