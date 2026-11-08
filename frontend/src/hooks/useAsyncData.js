import { useCallback, useEffect, useRef, useState } from "react";
import { normalizeUserError } from "../lib/errors.js";

// Last loaded copy per `cacheKey`, for this tab only (memory, never storage).
// Bounded so a long session moving between many records cannot grow it freely.
const remembered = new Map();
const REMEMBERED_LIMIT = 60;

function remember(key, data) {
  remembered.delete(key);
  remembered.set(key, data);
  if (remembered.size > REMEMBERED_LIMIT) remembered.delete(remembered.keys().next().value);
}

/** Forget every remembered screen. Called on sign-out. */
export function clearAsyncDataCache() {
  remembered.clear();
}

/**
 * Load data for the lifetime of a component.
 *
 * The loader is given an `AbortSignal`. Pass it to `request` and the transport
 * is cancelled when the component unmounts or the dependencies change, instead
 * of running to completion against a result nobody will read. A loader that
 * ignores the signal still behaves exactly as before -- the stale result is
 * discarded, it is just not cancelled.
 *
 * Only reads belong here. A loader that performs a write should not be
 * cancelled by a navigation, because the write may already have happened on the
 * server; those calls own their own lifetime and do not pass this signal.
 *
 * `keepPreviousData` is for lists refined in place (search, filters, paging):
 * once something has loaded, a refetch keeps showing it with `refreshing` set
 * instead of dropping back to `loading`, so the screen does not flash to a
 * skeleton on every keystroke. Leave it off wherever the dependencies change
 * *which record* is shown -- a detail view must never display the previous
 * record's data while the next one loads.
 *
 * `reload()` always keeps what is on screen. It asks for the same record
 * again (after a save, a retry, a pull to refresh), so showing it while the
 * fresh copy arrives is never showing the wrong thing -- and the page no
 * longer collapses to a skeleton and back after every action.
 *
 * `cacheKey` is for screens a student moves between (Questions, Review,
 * Progress...). Returning to one shows what it showed last time at once, with
 * `refreshing` set while a fresh copy loads in the background, instead of a
 * loading screen on every visit. The key must name the account and the record
 * (`questions:<userId>:<source>`): it decides whose data may be shown.
 *
 * @param {(signal: AbortSignal) => Promise<any>} loader
 * @param {unknown[]} deps
 * @param {{ keepPreviousData?: boolean, retainOnError?: boolean, cacheKey?: string }} [options]
 */
export function useAsyncData(loader, deps = [], { keepPreviousData = false, retainOnError = false, cacheKey = "" } = {}) {
  const [state, setState] = useState(() => (
    cacheKey && remembered.has(cacheKey)
      ? { loading: false, refreshing: true, error: "", errorDetails: /** @type {any} */ (null), data: remembered.get(cacheKey) }
      : { loading: true, refreshing: false, error: "", errorDetails: /** @type {any} */ (null), data: null }
  ));
  const [reloadVersion, setReloadVersion] = useState(0);
  const lastRun = useRef({ deps: /** @type {unknown[] | null} */ (null), reloadVersion: 0 });

  /* eslint-disable react-hooks/exhaustive-deps -- callers provide the loader's semantic dependency list */
  useEffect(() => {
    let active = true;
    const controller = typeof AbortController === "undefined" ? null : new AbortController();
    const previous = lastRun.current;
    const sameRecord = previous.deps !== null
      && previous.deps.length === deps.length
      && previous.deps.every((value, index) => Object.is(value, deps[index]));
    const reloadOnly = sameRecord && previous.reloadVersion !== reloadVersion;
    lastRun.current = { deps, reloadVersion };
    setState((prev) => {
      // A remembered copy of *this* record is always safe to show while the
      // fresh one loads; it is never another record's data.
      if (cacheKey && remembered.has(cacheKey) && !reloadOnly) {
        return { loading: false, refreshing: true, error: "", errorDetails: /** @type {any} */ (null), data: remembered.get(cacheKey) };
      }
      const keep = prev.data !== null
        && (reloadOnly || (keepPreviousData && (!prev.error || retainOnError)));
      return keep
        ? { ...prev, loading: false, refreshing: true }
        : { ...prev, loading: true, refreshing: false, error: "", errorDetails: null };
    });
    Promise.resolve()
      .then(() => loader(controller?.signal))
      .then((data) => {
        if (cacheKey) remember(cacheKey, data);
        if (active) setState({ loading: false, refreshing: false, error: "", errorDetails: /** @type {any} */ (null), data });
      })
      .catch((error) => {
        // A cancelled request is not a failure the reader should see: it was
        // this hook that cancelled it, and whatever replaced it owns the screen.
        if (!active || error?.code === "aborted" || error?.name === "AbortError") return;
        // A failed refresh must not leave a copy that a later visit would show
        // as if it were current -- above all after an authorization error.
        if (cacheKey) remembered.delete(cacheKey);
        setState((prev) => ({
          loading: false,
          refreshing: false,
          error: normalizeUserError(error?.message, "This information could not be loaded."),
          errorDetails: error,
          // Opt-in read-only lists may stay usable during a connectivity
          // failure. Authorization, validation and missing-record errors clear
          // the previous data immediately.
          data: retainOnError && keepPreviousData && (error?.status === 0 || error?.status >= 500) ? prev.data : null
        }));
      });
    return () => {
      active = false;
      controller?.abort();
    };
  }, [...deps, reloadVersion]);
  /* eslint-enable react-hooks/exhaustive-deps */

  const reload = useCallback(() => setReloadVersion((current) => current + 1), []);

  return {
    ...state,
    reload
  };
}

/**
 * The value, once it has stopped changing for `delay` milliseconds. Search
 * fields use it so a request is sent for what the reader typed, not for every
 * letter on the way there.
 *
 * @template T
 * @param {T} value
 * @param {number} [delay]
 * @returns {T}
 */
export function useDebouncedValue(value, delay = 300) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    if (Object.is(value, settled)) return undefined;
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay, settled]);
  return settled;
}
