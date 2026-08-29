import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { discoveryApi } from "../api/learning.js";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { EmptyState, ErrorPanel, ListRow, LoadingPanel, Page } from "../components/ui/index.jsx";
import { PaginationControls } from "../components/learning/PaginationControls.jsx";
import { useI18n } from "../components/I18nProvider.jsx";

const KIND_KEYS = [
  ["", "search.allResults"],
  ["subject", "search.subjects"],
  ["learning_object", "search.learningMaterials"]
];

const CONTENT_TYPE_KEYS = [
  ["", "search.allFormats"],
  ["pdf", "search.pdf"],
  ["audio", "materials.audio"],
  ["video", "materials.video"]
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
  const { t } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get("q") || "";
  const kind = searchParams.get("kind") || "";
  const contentType = searchParams.get("content_type") || "";
  const academicPath = searchParams.get("academic_path") || "";
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const [draft, setDraft] = useState(query);
  const inputRef = useRef(null);

  useEffect(() => setDraft(query), [query]);

  // Arriving from the topbar search icon means the intent is to type, so the
  // field takes focus. A visit that already carries a query came from a
  // submitted search, where the results deserve focus more than the box does.
  useEffect(() => {
    if (query) return;
    inputRef.current?.focus({ preventScroll: true });
  }, [query]);

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
    <Page title="Search" subtitle={t("search.subtitle")}>
      <form className="password-form" onSubmit={submitSearch}>
        <label className="field"><span>{t("search.fieldLabel")}</span><input ref={inputRef} type="search" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={t("search.placeholder")} maxLength={120} /></label>
        <div className="focus-timer-actions"><button className="btn btn-primary" type="submit">{t("search.submit")}</button></div>
        <div className="choice-grid">
          <label className="field"><span>{t("search.resultType")}</span><select value={kind} onChange={(event) => updateSearch({ kind: event.target.value, page: "" })}>{KIND_KEYS.map(([value, labelKey]) => <option key={value} value={value}>{t(labelKey)}</option>)}</select></label>
          <label className="field"><span>{t("search.format")}</span><select value={contentType} onChange={(event) => updateSearch({ content_type: event.target.value, page: "" })}>{CONTENT_TYPE_KEYS.map(([value, labelKey]) => <option key={value} value={value}>{t(labelKey)}</option>)}</select></label>
          <label className="field"><span>{t("search.academicPath")}</span><input value={academicPath} onChange={(event) => updateSearch({ academic_path: event.target.value, page: "" })} placeholder={t("search.pathPlaceholder")} /></label>
        </div>
      </form>

      {!query.trim() ? <EmptyState title={t("search.startTitle")} text={t("search.startText")} /> : results.loading ? <LoadingPanel /> : results.error ? <ErrorPanel message={results.error} onRetry={results.reload} /> : (
        <>
          <section className="list-panel">
            {results.data.results.length ? results.data.results.map((result) => {
              const destination = resultDestination(result);
              return <ListRow key={`${result.resource_kind}-${result.resource_id}`} title={result.title} meta={`${resultLabel(result)}${result.summary ? ` · ${result.summary}` : ""}`} icon="search" action={destination ? <Link className="btn btn-soft compact" to={destination}>{t("common.open")}</Link> : <button className="btn btn-soft compact" type="button" disabled>{t("search.laterPhase")}</button>} />;
            }) : <EmptyState title={t("search.noMatchTitle")} text={t("search.noMatchText")} />}
          </section>
          <PaginationControls page={page} pageData={results.data} onPageChange={(nextPage) => updateSearch({ page: nextPage })} label={t("search.pages")} />
        </>
      )}
    </Page>
  );
}
