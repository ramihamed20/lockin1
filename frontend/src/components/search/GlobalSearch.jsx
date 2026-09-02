import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import { discoveryApi } from "../../api/learning.js";
import { COMPACT_SHELL_QUERY } from "../../lib/constants.js";
import { mergeSearchResults, normalizeSearchText } from "../../lib/globalSearch.js";
import { Icon } from "../../lib/icons.jsx";
import { useI18n } from "../I18nProvider.jsx";

const TYPE_PRESENTATION = {
  subject: { icon: "book-open", label: "search.typeSubject" },
  topic: { icon: "layers", label: "search.typeTopic" },
  material: { icon: "file", label: "search.typeMaterial" },
  pdf: { icon: "file", label: "search.typePdf" },
  quiz: { icon: "list-checks", label: "search.typeQuiz" },
  question: { icon: "file-question", label: "search.typeQuestions" },
  review: { icon: "target", label: "search.typeReview" }
};

function HighlightMatch({ value, query }) {
  const text = String(value || "");
  const term = String(query || "").trim();
  if (!term) return text;
  const index = normalizeSearchText(text).indexOf(normalizeSearchText(term));
  if (index < 0) return text;
  // NFKC only normalises presentation forms; it does not change the length of
  // ordinary English or Arabic titles used by this product.
  const end = index + term.length;
  return <>{text.slice(0, index)}<mark>{text.slice(index, end)}</mark>{text.slice(end)}</>;
}

function resultPresentation(type) {
  return TYPE_PRESENTATION[type] || TYPE_PRESENTATION.topic;
}

/** Reusable global-search field and type-ahead result surface. */
export function GlobalSearch({ onOpenChange }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const inputId = useId();
  const listboxId = useId();
  const desktopInputRef = useRef(null);
  const mobileInputRef = useRef(null);
  const triggerRef = useRef(null);
  const desktopPanelRef = useRef(null);
  const requestAbortRef = useRef(null);
  const resultCacheRef = useRef(new Map());
  const [isCompact, setIsCompact] = useState(() => window.matchMedia(COMPACT_SHELL_QUERY).matches);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [serverResults, setServerResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const [position, setPosition] = useState({ left: 12, top: 12, width: 320 });
  const results = useMemo(() => mergeSearchResults(query, serverResults), [query, serverResults]);
  const normalizedQuery = normalizeSearchText(query);

  const close = useCallback(({ restoreFocus = false } = {}) => {
    requestAbortRef.current?.abort();
    setOpen(false);
    setActiveIndex(-1);
    setError("");
    if (restoreFocus) window.requestAnimationFrame(() => desktopInputRef.current?.focus());
  }, []);

  const focusActiveInput = useCallback(() => {
    window.requestAnimationFrame(() => {
      (isCompact ? mobileInputRef.current : desktopInputRef.current)?.focus({ preventScroll: true });
    });
  }, [isCompact]);

  const openSearch = useCallback(() => {
    setOpen(true);
    focusActiveInput();
  }, [focusActiveInput]);

  useEffect(() => onOpenChange?.(open), [onOpenChange, open]);

  useEffect(() => {
    const media = window.matchMedia(COMPACT_SHELL_QUERY);
    const update = () => setIsCompact(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    close();
    // A route change must always dismiss the panel, without returning focus to
    // an input that is now behind the new page.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- location is intentional here
  }, [location.pathname]);

  useEffect(() => () => requestAbortRef.current?.abort(), []);

  useEffect(() => {
    if (!open || !normalizedQuery) {
      setServerResults([]);
      setLoading(false);
      return undefined;
    }
    const cached = resultCacheRef.current.get(normalizedQuery);
    if (cached) {
      setServerResults(cached);
      setLoading(false);
      return undefined;
    }

    const controller = new globalThis.AbortController();
    requestAbortRef.current?.abort();
    requestAbortRef.current = controller;
    setLoading(true);
    setError("");
    const timer = window.setTimeout(() => {
      discoveryApi.search({ query, limit: 12, signal: controller.signal })
        .then((payload) => {
          if (controller.signal.aborted) return;
          const next = Array.isArray(payload.results) ? payload.results : [];
          resultCacheRef.current.set(normalizedQuery, next);
          setServerResults(next);
        })
        .catch((requestError) => {
          if (controller.signal.aborted) return;
          setServerResults([]);
          setError(requestError?.message || t("search.loadError"));
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 90);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [normalizedQuery, open, query, t]);

  useEffect(() => {
    setActiveIndex(results.length ? 0 : -1);
  }, [normalizedQuery, results.length]);

  useEffect(() => {
    if (!open || isCompact) return undefined;
    const updatePosition = () => {
      const anchor = triggerRef.current?.getBoundingClientRect();
      if (!anchor) return;
      const width = Math.min(480, Math.max(320, anchor.width));
      const left = Math.min(Math.max(12, anchor.left), window.innerWidth - width - 12);
      const top = Math.min(anchor.bottom + 8, Math.max(12, window.innerHeight - 160));
      setPosition({ left, top, width });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, { capture: true, passive: true });
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, { capture: true });
    };
  }, [isCompact, open]);

  useEffect(() => {
    if (!open || isCompact) return undefined;
    const handlePointerDown = (event) => {
      if (triggerRef.current?.contains(event.target) || desktopPanelRef.current?.contains(event.target)) return;
      close();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [close, isCompact, open]);

  useEffect(() => {
    const handleShortcut = (event) => {
      const active = document.activeElement;
      const isEditable = active instanceof HTMLElement && (active.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName));
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        openSearch();
      } else if (event.key === "/" && !isEditable) {
        event.preventDefault();
        openSearch();
      }
    };
    document.addEventListener("keydown", handleShortcut);
    return () => document.removeEventListener("keydown", handleShortcut);
  }, [openSearch]);

  function chooseResult(result) {
    if (!result?.destination) return;
    close();
    navigate(result.destination);
  }

  function handleKeyDown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      close({ restoreFocus: !isCompact });
      return;
    }
    if (!results.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => current < 0 ? 0 : (current + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => current <= 0 ? results.length - 1 : current - 1);
    } else if (event.key === "Enter" && activeIndex >= 0) {
      event.preventDefault();
      chooseResult(results[activeIndex]);
    }
  }

  const fieldProps = {
    type: "search",
    value: query,
    placeholder: t("shell.searchPlaceholder"),
    "aria-label": t("common.search"),
    "aria-expanded": open,
    "aria-controls": listboxId,
    "aria-activedescendant": activeIndex >= 0 ? `${inputId}-result-${activeIndex}` : undefined,
    role: "combobox",
    autoComplete: "off",
    onChange: (event) => setQuery(event.target.value.slice(0, 120)),
    onKeyDown: handleKeyDown
  };

  const status = !normalizedQuery
    ? <p className="global-search-hint">{t("search.typeToSearch")}</p>
    : loading && !results.length
      ? <p className="global-search-hint" role="status">{t("search.searching")}</p>
      : error && !results.length
        ? <p className="global-search-hint" role="status">{error}</p>
        : !results.length
          ? <p className="global-search-hint" role="status">{t("search.noResults")}</p>
          : null;

  const resultsList = results.length ? (
    <ul id={listboxId} className="global-search-results" role="listbox" aria-label={t("search.resultsLabel")}>
      {results.map((result, index) => {
        const presentation = resultPresentation(result.type);
        const selected = index === activeIndex;
        return <li key={`${result.destination}-${result.type}`} role="presentation">
          <button
            id={`${inputId}-result-${index}`}
            className={`global-search-result ${selected ? "is-active" : ""}`}
            type="button"
            role="option"
            aria-selected={selected}
            onMouseMove={() => setActiveIndex(index)}
            onFocus={() => setActiveIndex(index)}
            onClick={() => chooseResult(result)}
          >
            <span className="global-search-result-icon"><Icon name={presentation.icon} size={18} /></span>
            <span className="global-search-result-copy" dir="auto">
              <strong><HighlightMatch value={result.title} query={query} /></strong>
              <small>{[result.subtitle, t(presentation.label)].filter(Boolean).join(" · ")}</small>
            </span>
            {result.metadata?.bookmarked && <span className="global-search-bookmark" aria-label={t("search.bookmarked")}><Icon name="bookmark" size={15} /></span>}
          </button>
        </li>;
      })}
    </ul>
  ) : null;

  const desktopPanel = open && !isCompact ? (
    <section
      ref={desktopPanelRef}
      className="global-search-panel global-search-panel--desktop"
      role="dialog"
      aria-label={t("common.search")}
      style={/** @type {import("react").CSSProperties & Record<string, string>} */ ({ "--global-search-left": `${position.left}px`, "--global-search-top": `${position.top}px`, "--global-search-width": `${position.width}px` })}
    >
      {status}
      {resultsList}
    </section>
  ) : null;

  const mobilePanel = open && isCompact ? (
    <div className="global-search-mobile-layer" role="dialog" aria-modal="true" aria-label={t("common.search")}>
      <div className="global-search-mobile-head">
        <label className="search-box global-search-mobile-input">
          <Icon name="search" size={18} />
          <input ref={mobileInputRef} {...fieldProps} />
        </label>
        <button className="icon-btn" type="button" onClick={() => close()} aria-label={t("common.close")}><Icon name="x" size={19} /></button>
      </div>
      <div className="global-search-mobile-results">
        {status}
        {resultsList}
      </div>
    </div>
  ) : null;

  return <>
    <div className="global-search">
      <label className="search-box global-search-desktop-input" ref={triggerRef}>
        <Icon name="search" size={18} />
        <input ref={desktopInputRef} {...fieldProps} onFocus={openSearch} />
      </label>
      <button className="icon-btn topbar-search-action global-search-mobile-trigger" type="button" onClick={openSearch} aria-label={t("common.search")} aria-expanded={open} aria-controls={listboxId}>
        <Icon name="search" size={19} />
      </button>
    </div>
    {createPortal(<>{desktopPanel}{mobilePanel}</>, document.body)}
  </>;
}
