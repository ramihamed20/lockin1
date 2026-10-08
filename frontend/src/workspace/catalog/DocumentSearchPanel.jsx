import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, ChevronUp, EyeOff, Loader2, Search, SearchX, X } from "lucide-react";
import { useI18n } from "../../components/I18nProvider.jsx";
import { createDocumentTextSource, normalizeSearchQuery, searchDocument } from "./documentSearch.js";
import { MAX_COVERS_PER_ACTION } from "./recallCovers.js";

const SEARCH_DELAY_MS = 220;
const MIN_QUERY_LENGTH = 2;
const LISTED_RESULTS = 200;
/** @typedef {{ status: "idle" | "searching" | "done", matches: any[], searchedPages: number, totalPages: number, truncated: boolean, key?: object }} SearchState */
/** @type {SearchState} */
const IDLE = Object.freeze({ status: "idle", matches: [], searchedPages: 0, totalPages: 0, truncated: false });
const NO_MATCHES = Object.freeze([]);

/**
 * Search state for the open document. It lives in the workspace, not the
 * panel, so the highlights and the position survive closing the panel - on a
 * phone the panel closes every time it shows a match.
 * @param {any} documentProxy
 * @param {{ firstPage: number, lastPage: number }} range the pages the reader may show
 */
export function useDocumentSearch(documentProxy, { firstPage, lastPage }) {
  const [query, setQuery] = useState("");
  const [state, setState] = useState(/** @type {SearchState} */ (IDLE));
  const [activeIndex, setActiveIndex] = useState(-1);
  const source = useMemo(() => (documentProxy ? createDocumentTextSource(documentProxy) : null), [documentProxy]);
  const normalizedQuery = normalizeSearchQuery(query);
  const searchKey = useMemo(() => ({ source, firstPage, lastPage, normalizedQuery }), [source, firstPage, lastPage, normalizedQuery]);
  // Results belong to an exact query/document/range. Old results become
  // unusable in the render that changes any of those inputs, before debounce.
  const currentState = state.key === searchKey ? state : {
    ...IDLE,
    status: source && normalizedQuery.length >= MIN_QUERY_LENGTH ? "searching" : "idle",
    totalPages: Math.max(0, lastPage - firstPage + 1)
  };
  const currentIndex = state.key === searchKey ? activeIndex : -1;

  useEffect(() => {
    if (!source || normalizeSearchQuery(query).length < MIN_QUERY_LENGTH) {
      setState(IDLE);
      setActiveIndex(-1);
      return undefined;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setActiveIndex(-1);
      setState({ ...IDLE, key: searchKey, status: "searching", totalPages: Math.max(0, lastPage - firstPage + 1) });
      const result = await searchDocument(source, query, {
        firstPage,
        lastPage,
        isCancelled: () => cancelled,
        onProgress: (progress) => { if (!cancelled) setState({ key: searchKey, status: "searching", truncated: false, ...progress }); }
      });
      if (cancelled || !result) return;
      setState({ key: searchKey, status: "done", ...result });
    }, SEARCH_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [firstPage, lastPage, query, source, searchKey]);

  const matchesByPage = useMemo(() => {
    const pages = new Map();
    for (const match of currentState.matches) {
      const bucket = pages.get(match.page);
      if (bucket) bucket.push(match);
      else pages.set(match.page, [match]);
    }
    return pages;
  }, [currentState.matches]);

  const clear = useCallback(() => {
    setQuery("");
    setActiveIndex(-1);
  }, []);

  return {
    query,
    setQuery,
    status: currentState.status,
    matches: currentState.matches,
    searchedPages: currentState.searchedPages,
    totalPages: currentState.totalPages,
    truncated: currentState.truncated,
    activeIndex: currentIndex,
    activeMatch: currentState.matches[currentIndex] || null,
    setActiveIndex,
    matchesByPage,
    clear,
    ready: Boolean(source)
  };
}

/** The highlighted occurrences on one page, drawn under the annotations. */
export function SearchHighlights({ matches = NO_MATCHES, activeId = null }) {
  if (!matches.length) return null;
  return <div className="workspace-search-highlights" aria-hidden="true">
    {matches.flatMap((match) => match.rectangles.map((rectangle, index) => <span
      key={`${match.id}-${index}`}
      className={match.id === activeId ? "is-active" : undefined}
      style={{
        left: `${rectangle.x / 10}%`,
        top: `${rectangle.y / 10}%`,
        width: `${rectangle.width / 10}%`,
        height: `${rectangle.height / 10}%`
      }}
    />))}
  </div>;
}

function stepIndex(search, direction) {
  const total = search.matches.length;
  if (!total) return -1;
  if (search.activeIndex < 0) return direction > 0 ? 0 : total - 1;
  return (search.activeIndex + direction + total) % total;
}

/**
 * @param {{
 *   search: ReturnType<typeof useDocumentSearch>,
 *   onShowMatch: (match: any) => void,
 *   onHideMatches: (matches: any[], keepSearch?: boolean) => void,
 *   coveredIds?: Set<string>,
 *   onClose: () => void,
 *   open: boolean
 * }} props
 */
export function DocumentSearchPanel({ search, onShowMatch, onHideMatches, onClose, open, coveredIds = new Set() }) {
  const { t } = useI18n();
  const inputRef = useRef(/** @type {HTMLInputElement | null} */ (null));
  const listRef = useRef(/** @type {HTMLOListElement | null} */ (null));
  const [listedResults, setListedResults] = useState(LISTED_RESULTS);

  useEffect(() => setListedResults(LISTED_RESULTS), [search.query]);

  useEffect(() => {
    if (!open) return undefined;
    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus({ preventScroll: true });
      inputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (search.activeIndex < 0) return;
    if (search.activeIndex >= listedResults) {
      setListedResults(Math.ceil((search.activeIndex + 1) / LISTED_RESULTS) * LISTED_RESULTS);
      return;
    }
    listRef.current?.querySelector(`[data-search-index="${search.activeIndex}"]`)?.scrollIntoView({ block: "nearest" });
  }, [search.activeIndex, listedResults]);

  const show = (index) => {
    const match = search.matches[index];
    if (!match) return;
    inputRef.current?.blur();
    search.setActiveIndex(index);
    onShowMatch(match);
  };

  const total = search.matches.length;
  const searching = search.status === "searching";
  const hasQuery = normalizeSearchQuery(search.query).length >= MIN_QUERY_LENGTH;
  const remaining = search.matches.filter((match) => !coveredIds.has(match.id));
  const tooManyCovers = remaining.reduce((count, match) => count + match.rectangles.length, 0) > MAX_COVERS_PER_ACTION;
  const activeCovered = Boolean(search.activeMatch && coveredIds.has(search.activeMatch.id));
  let summary = "";
  if (!search.ready) summary = t("focus.searchPreparing");
  else if (!hasQuery) summary = t("focus.searchHint");
  else if (searching) summary = t("focus.searchProgress", { searched: search.searchedPages, total: search.totalPages });
  else if (!total) summary = t("focus.searchNoResults");
  else if (search.truncated) summary = t("focus.searchTooMany", { count: total });
  else summary = t("focus.searchResultCount", { count: total });

  return <>
    <header>
      <span className="workspace-search-heading"><Search size={18} aria-hidden="true" /><strong>{t("focus.searchDocument")}</strong></span>
      <button type="button" aria-label={t("focus.closeSearch")} onClick={onClose}><X size={17} /></button>
    </header>
    <div className="workspace-search-field">
      <Search size={17} aria-hidden="true" />
      <input
        ref={inputRef}
        type="search"
        dir="auto"
        value={search.query}
        enterKeyHint="search"
        autoComplete="off"
        spellCheck="false"
        aria-label={t("focus.searchDocument")}
        aria-describedby="workspace-search-summary"
        placeholder={t("focus.searchPlaceholder")}
        disabled={!search.ready}
        onChange={(event) => search.setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          show(stepIndex(search, event.shiftKey ? -1 : 1));
        }}
      />
      {searching && <Loader2 className="workspace-search-spinner" size={16} aria-hidden="true" />}
      {search.query && <button type="button" className="workspace-search-clear" aria-label={t("focus.clearSearch")} onClick={() => { search.clear(); inputRef.current?.focus(); }}><X size={15} /></button>}
    </div>
    {searching && <div className="workspace-search-progress" aria-hidden="true"><span style={{ width: `${search.totalPages ? search.searchedPages / search.totalPages * 100 : 0}%` }} /></div>}
    <div className="workspace-search-status">
      <p id="workspace-search-summary" role="status" aria-live="polite">
        {total > 0 && search.activeIndex >= 0 ? t("focus.searchPosition", { current: search.activeIndex + 1, total }) : summary}
      </p>
      <span className="workspace-search-steps">
        <button type="button" aria-label={t("focus.previousMatch")} disabled={!total} onClick={() => show(stepIndex(search, -1))}><ChevronUp size={17} /></button>
        <button type="button" aria-label={t("focus.nextMatch")} disabled={!total} onClick={() => show(stepIndex(search, 1))}><ChevronDown size={17} /></button>
      </span>
    </div>
    {!total && <div className="workspace-search-empty">
      {searching ? <Loader2 className="workspace-search-spinner" size={28} aria-hidden="true" /> : hasQuery ? <SearchX size={30} aria-hidden="true" /> : <Search size={30} aria-hidden="true" />}
      <strong>{t(searching ? "focus.searchReading" : hasQuery ? "focus.searchTryAnother" : "focus.searchStart")}</strong>
      <p>{t(hasQuery ? "focus.searchTextOnly" : "focus.searchRecallHint")}</p>
    </div>}
    {total > 0 && <ol className="workspace-search-results" ref={listRef} aria-label={t("focus.searchResults")}>
      {search.matches.slice(0, listedResults).map((match, index) => <li key={match.id}>
        <button type="button" data-search-index={index} aria-current={index === search.activeIndex ? "true" : undefined} onClick={() => show(index)}>
          <small><span className="workspace-search-page">{t("focus.pageNumberLabel", { page: match.page })}</span>{coveredIds.has(match.id) && <span className="workspace-search-covered"><Check size={12} aria-hidden="true" />{t("focus.matchHidden")}</span>}</small>
          <span dir="auto">{match.snippet.before}<mark>{match.snippet.match}</mark>{match.snippet.after}</span>
        </button>
      </li>)}
      {total > listedResults && <li><button type="button" className="workspace-search-load-more" onClick={() => setListedResults((count) => count + LISTED_RESULTS)}>{t("focus.searchShowMore", { count: total - listedResults })}</button></li>}
    </ol>}
    {total > 0 && !searching && <footer className="workspace-search-footer">
      <p>{t("focus.searchRecallTitle")}</p>
      {search.activeMatch && <button type="button" className="workspace-search-hide-one" disabled={activeCovered} onClick={() => onHideMatches([search.activeMatch], true)}>
        {activeCovered ? <Check size={17} aria-hidden="true" /> : <EyeOff size={17} aria-hidden="true" />}
        <span><strong>{t(activeCovered ? "focus.matchHidden" : "focus.hideSelectedMatch")}</strong><small>{t("focus.hideSelectedHint")}</small></span>
      </button>}
      <button type="button" disabled={!remaining.length || tooManyCovers} onClick={() => onHideMatches(remaining)}>
        <EyeOff size={17} aria-hidden="true" />
        <span><strong>{t("focus.hideMatches", { count: remaining.length })}</strong><small>{t(tooManyCovers ? "focus.narrowSearchForCovers" : "focus.hideMatchesHint")}</small></span>
      </button>
    </footer>}
  </>;
}

/** The position and the arrows, kept on screen while the panel is closed. */
export function SearchNavigator({ search, onShowMatch, onOpen, onHideMatch, covered = false }) {
  const { t } = useI18n();
  const total = search.matches.length;
  if (!total || search.activeIndex < 0) return null;
  const show = (direction) => {
    const index = stepIndex(search, direction);
    search.setActiveIndex(index);
    onShowMatch(search.matches[index]);
  };
  return <div className="workspace-search-navigator" role="group" aria-label={t("focus.searchResults")}>
    <button type="button" className="workspace-search-navigator-query" onClick={onOpen} aria-label={t("focus.searchDocument")}>
      <Search size={15} aria-hidden="true" />
      <span dir="auto">{search.query}</span>
      <small>{t("focus.searchPosition", { current: search.activeIndex + 1, total })}</small>
    </button>
    <button type="button" aria-label={t("focus.previousMatch")} onClick={() => show(-1)}><ChevronUp size={17} /></button>
    <button type="button" aria-label={t("focus.nextMatch")} onClick={() => show(1)}><ChevronDown size={17} /></button>
    <button type="button" aria-label={t(covered ? "focus.matchHidden" : "focus.hideSelectedMatch")} disabled={covered} onClick={onHideMatch}>{covered ? <Check size={17} /> : <EyeOff size={17} />}</button>
    <button type="button" aria-label={t("focus.clearSearch")} onClick={search.clear}><X size={16} /></button>
  </div>;
}
