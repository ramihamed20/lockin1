import { useCallback, useEffect, useRef, useState } from "react";
import { sheetSummariesApi } from "../../api/sheetSummaries.js";

const DRAFT_PREFIX = "lock-in.summary.draft.";
const SAVE_DELAY_MS = 700;
const RETRY_MS = 5000;

function readDrafts(summaryId) {
  try {
    const value = JSON.parse(window.localStorage.getItem(DRAFT_PREFIX + summaryId) || "null");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}

function writeDrafts(summaryId, drafts) {
  try {
    if (Object.keys(drafts).length) window.localStorage.setItem(DRAFT_PREFIX + summaryId, JSON.stringify(drafts));
    else window.localStorage.removeItem(DRAFT_PREFIX + summaryId);
  } catch { /* The server copy still saves. */ }
}

/**
 * The student's summaries of one sheet. Keyboard text is kept on this device
 * the moment it is typed and sent shortly after, page by page, so a closed tab
 * or a dropped connection loses nothing and two tabs never overwrite each
 * other's pages.
 */
export function useSheetSummaries(documentId) {
  const [summaries, setSummaries] = useState(/** @type {any[]} */ ([]));
  const [maxPerSheet, setMaxPerSheet] = useState(2);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [saveState, setSaveState] = useState(/** @type {Record<string, string>} */ ({}));
  const [drafts, setDrafts] = useState(/** @type {Record<string, Record<string, string>>} */ ({}));
  const timers = useRef(/** @type {Map<string, number>} */ (new Map()));
  const inFlight = useRef(/** @type {Set<string>} */ (new Set()));

  const reload = useCallback(async () => {
    if (!documentId) return;
    try {
      const { results, maxPerSheet: max } = await sheetSummariesApi.forDocument(documentId);
      setSummaries(results);
      setMaxPerSheet(max);
      setDrafts(Object.fromEntries(results.filter((item) => item.mode === "keyboard").map((item) => [item.id, readDrafts(item.id)])));
      setLoaded(true);
      setError("");
    } catch (failure) {
      setError(/** @type {any} */ (failure)?.message || "");
    }
  }, [documentId]);

  useEffect(() => { setLoaded(false); setSummaries([]); void reload(); }, [reload]);

  const replace = useCallback((summary) => {
    setSummaries((current) => current.map((item) => item.id === summary.id ? summary : item));
    return summary;
  }, []);

  const flush = useCallback(async (summaryId) => {
    window.clearTimeout(timers.current.get(summaryId));
    timers.current.delete(summaryId);
    if (inFlight.current.has(summaryId)) { timers.current.set(summaryId, window.setTimeout(() => void flush(summaryId), SAVE_DELAY_MS)); return; }
    const pending = readDrafts(summaryId);
    if (!Object.keys(pending).length) return;
    inFlight.current.add(summaryId);
    setSaveState((current) => ({ ...current, [summaryId]: "saving" }));
    try {
      const saved = await sheetSummariesApi.update(summaryId, { pages: pending });
      replace(saved);
      // Drop only the drafts that were sent unchanged; anything typed since stays queued.
      const latest = readDrafts(summaryId);
      for (const [page, text] of Object.entries(pending)) if (latest[page] === text) delete latest[page];
      writeDrafts(summaryId, latest);
      setDrafts((current) => ({ ...current, [summaryId]: latest }));
      setSaveState((current) => ({ ...current, [summaryId]: Object.keys(latest).length ? "saving" : "saved" }));
      if (Object.keys(latest).length) timers.current.set(summaryId, window.setTimeout(() => void flush(summaryId), SAVE_DELAY_MS));
    } catch {
      setSaveState((current) => ({ ...current, [summaryId]: navigator.onLine === false ? "offline" : "failed" }));
      timers.current.set(summaryId, window.setTimeout(() => void flush(summaryId), RETRY_MS));
    } finally {
      inFlight.current.delete(summaryId);
    }
  }, [replace]);

  useEffect(() => {
    const online = () => { for (const item of summaries) if (item.mode === "keyboard") void flush(item.id); };
    window.addEventListener("online", online);
    online();
    return () => window.removeEventListener("online", online);
    // Pending drafts from an earlier visit go out once the summaries are known.
  }, [summaries.length, flush]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { for (const timer of timers.current.values()) window.clearTimeout(timer); }, []);

  const writePage = useCallback((summaryId, page, text) => {
    const next = { ...readDrafts(summaryId), [String(page)]: text };
    writeDrafts(summaryId, next);
    setDrafts((current) => ({ ...current, [summaryId]: next }));
    setSaveState((current) => ({ ...current, [summaryId]: "saving" }));
    window.clearTimeout(timers.current.get(summaryId));
    timers.current.set(summaryId, window.setTimeout(() => void flush(summaryId), SAVE_DELAY_MS));
  }, [flush]);

  /** What the student sees for a page: their unsent draft first, then the saved text. */
  const pageText = useCallback((summary, page) => {
    const draft = drafts[summary.id]?.[String(page)];
    return draft !== undefined ? draft : summary.pages?.[String(page)] || "";
  }, [drafts]);

  /** A summary with its unsent drafts applied, for progress and the PDF. */
  const withDrafts = useCallback((summary) => {
    if (summary.mode !== "keyboard") return summary;
    const pages = { ...(summary.pages || {}) };
    for (const [page, text] of Object.entries(drafts[summary.id] || {})) {
      if (String(text).trim()) pages[page] = text; else delete pages[page];
    }
    return { ...summary, pages };
  }, [drafts]);

  const create = useCallback(async (form) => {
    const summary = await sheetSummariesApi.create(documentId, form);
    setSummaries((current) => [summary, ...current]);
    return summary;
  }, [documentId]);

  const update = useCallback(async (summaryId, changes) => replace(await sheetSummariesApi.update(summaryId, changes)), [replace]);

  const remove = useCallback(async (summaryId) => {
    await sheetSummariesApi.remove(summaryId);
    writeDrafts(summaryId, {});
    setSummaries((current) => current.filter((item) => item.id !== summaryId));
  }, []);

  return { summaries, maxPerSheet, loaded, error, saveState, reload, create, update, remove, writePage, pageText, withDrafts, flush };
}
