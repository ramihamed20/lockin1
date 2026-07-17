import { FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { Button } from "../../components/Button";
import { Alert, EmptyState, PageSkeleton } from "../../components/Feedback";
import { SelectField } from "../../components/FormField";
import { useI18n } from "../../i18n/I18nProvider";
import { educationChildren, learningDashboard, searchLearning } from "./api";
import type { EducationNode, LearningDashboard, Paginated, SearchEntry } from "./types";

function resultPath(result: SearchEntry) {
  return result.resource_kind === "learning_object"
    ? `/learn/content/${result.resource_id}`
    : `/learn/nodes/${result.resource_id}`;
}

export function LearningHomePage() {
  const { t } = useI18n();
  const [dashboard, setDashboard] = useState<LearningDashboard | null>(null);
  const [roots, setRoots] = useState<EducationNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [partialError, setPartialError] = useState(false);
  const [query, setQuery] = useState("");
  const [contentType, setContentType] = useState("");
  const [searchResults, setSearchResults] = useState<Paginated<SearchEntry> | null>(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.allSettled([
      learningDashboard(controller.signal),
      educationChildren(undefined, controller.signal)
    ]).then(([dashboardResult, rootsResult]) => {
      if (controller.signal.aborted) return;
      if (dashboardResult.status === "fulfilled") setDashboard(dashboardResult.value);
      if (rootsResult.status === "fulfilled") setRoots(rootsResult.value.results);
      setPartialError(dashboardResult.status === "rejected" || rootsResult.status === "rejected");
      setLoading(false);
    });
    return () => controller.abort();
  }, []);

  async function submitSearch(event: FormEvent) {
    event.preventDefault();
    setSearching(true);
    try {
      setSearchResults(await searchLearning(query.trim(), contentType));
    } catch {
      setPartialError(true);
    } finally {
      setSearching(false);
    }
  }

  if (loading) return <PageSkeleton label={t("loadingLearning")} />;

  return (
    <div className="page learning-home">
      <header className="page-heading page-heading--wide">
        <h1>{t("learningTitle")}</h1>
        <p>{t("learningCopy")}</p>
      </header>

      {partialError ? <Alert>{t("learningPartialError")}</Alert> : null}

      <form className="study-search" role="search" onSubmit={(event) => void submitSearch(event)}>
        <div className="field study-search__query">
          <label htmlFor="study-search">{t("searchLearning")}</label>
          <input
            id="study-search"
            type="search"
            value={query}
            maxLength={120}
            placeholder={t("searchPlaceholder")}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <SelectField label={t("contentType")} value={contentType} onChange={(event) => setContentType(event.target.value)}>
          <option value="">{t("allTypes")}</option>
          <option value="pdf">{t("pdfDocument")}</option>
          <option value="audio">{t("audioLesson")}</option>
        </SelectField>
        <Button type="submit" disabled={searching}>{searching ? t("searching") : t("searchAction")}</Button>
      </form>

      {searchResults ? (
        <section className="study-section" aria-labelledby="search-results-title">
          <header className="study-section__heading">
            <h2 id="search-results-title">{t("searchResults")}</h2>
            <span>{searchResults.count}</span>
          </header>
          {searchResults.results.length ? (
            <ul className="resource-list">
              {searchResults.results.map((result) => (
                <li key={`${result.resource_kind}-${result.resource_id}`}>
                  <Link to={resultPath(result)}>
                    <span className="resource-type">{result.content_type || result.resource_kind}</span>
                    <strong>{result.title}</strong>
                    <span>{result.summary || t("openLearningObject")}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : <EmptyState title={t("noSearchResults")}>{t("noSearchResultsCopy")}</EmptyState>}
        </section>
      ) : null}

      <section className="next-study" aria-labelledby="next-study-title">
        <div>
          <p>{dashboard?.next_item?.reason === "resume" ? t("resumeStudy") : t("startStudy")}</p>
          <h2 id="next-study-title">{dashboard?.next_item?.title ?? t("chooseStudyPath")}</h2>
          <span>{dashboard?.next_item ? `${dashboard.next_item.completion_percent}% ${t("complete")}` : t("chooseStudyPathCopy")}</span>
        </div>
        <Link className="button button--primary" to={dashboard?.next_item ? `/learn/content/${dashboard.next_item.learning_object_id}` : roots[0] ? `/learn/nodes/${roots[0].id}` : "/learn"}>
          {dashboard?.next_item ? t("continueStudy") : t("browseSubjects")}
        </Link>
      </section>

      <section className="study-section" aria-labelledby="study-paths-title">
        <header className="study-section__heading">
          <h2 id="study-paths-title">{t("studyPaths")}</h2>
          <span>{roots.length}</span>
        </header>
        {roots.length ? (
          <ul className="path-list">
            {roots.map((root) => (
              <li key={root.id}>
                <Link to={`/learn/nodes/${root.id}`}><strong>{root.title}</strong><span>{root.description || t("explorePath")}</span></Link>
              </li>
            ))}
          </ul>
        ) : <EmptyState title={t("noStudyPaths")}>{t("noStudyPathsCopy")}</EmptyState>}
      </section>

      <section className="learning-summary" aria-label={t("learningSummary")}>
        <div><strong>{dashboard?.bookmark_count ?? 0}</strong><span>{t("bookmarks")}</span></div>
        <div><strong>{dashboard?.completed_count ?? 0}</strong><span>{t("completedItems")}</span></div>
        <div><strong>{dashboard?.review_due.length ?? 0}</strong><span>{t("dueReview")}</span></div>
      </section>
    </div>
  );
}
