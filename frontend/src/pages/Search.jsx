import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { discoveryApi } from "../api/learning.js";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { ErrorPanel, ListRow, LoadingPanel, Page } from "../components/ui/index.jsx";
import { useI18n } from "../components/I18nProvider.jsx";
import { mergeSearchResults } from "../lib/globalSearch.js";

const TYPE_KEYS = {
  subject: "search.typeSubject",
  topic: "search.typeTopic",
  material: "search.typeMaterial",
  pdf: "search.typePdf",
  quiz: "search.typeQuiz",
  question: "search.typeQuestions",
  review: "search.typeReview"
};

export default function Search() {
  const { t } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get("q") || "";
  const [draft, setDraft] = useState(query);
  const inputRef = useRef(null);

  useEffect(() => setDraft(query), [query]);

  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  const normalizedDraft = draft.trim();
  const results = useAsyncData(
    () => normalizedDraft
      ? discoveryApi.search({ query: normalizedDraft, limit: 24 })
      : Promise.resolve({ count: 0, next: null, previous: null, results: [] }),
    [normalizedDraft]
  );

  function submitSearch(event) {
    event.preventDefault();
    setSearchParams(normalizedDraft ? { q: normalizedDraft } : {});
  }

  const mergedResults = normalizedDraft && !results.loading && !results.error
    ? mergeSearchResults(normalizedDraft, results.data.results)
    : [];

  return (
    <Page title="Search" subtitle={t("search.subtitle")}>
      <form className="password-form" onSubmit={submitSearch}>
        <label className="field"><span>{t("search.fieldLabel")}</span><input ref={inputRef} type="search" value={draft} onChange={(event) => setDraft(event.target.value.slice(0, 120))} placeholder={t("search.placeholder")} maxLength={120} /></label>
      </form>

      {!normalizedDraft ? <p className="muted">{t("search.typeToSearch")}</p> : results.loading ? <LoadingPanel /> : results.error ? <ErrorPanel message={results.error} onRetry={results.reload} /> : mergedResults.length ? <section className="list-panel">
        {mergedResults.map((result) => <ListRow key={`${result.destination}-${result.type}`} title={result.title} meta={[result.subtitle, t(TYPE_KEYS[result.type] || "search.typeTopic")].filter(Boolean).join(" · ")} icon="search" action={<Link className="btn btn-soft compact" to={result.destination}>{t("common.open")}</Link>} />)}
      </section> : <p className="muted">{t("search.noResults")}</p>}
    </Page>
  );
}
