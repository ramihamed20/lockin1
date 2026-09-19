import { useCallback, useEffect, useState } from "react";
import { normalizeUserError } from "../lib/errors.js";

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
 * @param {(signal: AbortSignal) => Promise<any>} loader
 * @param {unknown[]} deps
 * @param {{ keepPreviousData?: boolean }} [options]
 */
export function useAsyncData(loader, deps = [], { keepPreviousData = false } = {}) {
  const [state, setState] = useState({ loading: true, refreshing: false, error: "", data: null });
  const [reloadVersion, setReloadVersion] = useState(0);

  /* eslint-disable react-hooks/exhaustive-deps -- callers provide the loader's semantic dependency list */
  useEffect(() => {
    let active = true;
    const controller = typeof AbortController === "undefined" ? null : new AbortController();
    setState((prev) => {
      const keep = keepPreviousData && prev.data !== null && !prev.error;
      return keep
        ? { ...prev, loading: false, refreshing: true }
        : { ...prev, loading: true, refreshing: false, error: "" };
    });
    Promise.resolve()
      .then(() => loader(controller?.signal))
      .then((data) => {
        if (active) setState({ loading: false, refreshing: false, error: "", data });
      })
      .catch((error) => {
        // A cancelled request is not a failure the reader should see: it was
        // this hook that cancelled it, and whatever replaced it owns the screen.
        if (!active || error?.code === "aborted" || error?.name === "AbortError") return;
        setState({
          loading: false,
          refreshing: false,
          error: normalizeUserError(error?.message, "This information could not be loaded."),
          data: null
        });
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
