import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { billingApi } from "../api/billing.js";
import {
  hasDirectStudyAccess,
  hasPendingManualPayment,
  hasSubscriptionExemption,
  isSubscriptionSnapshotFresh,
  manualPaymentReview,
  readSubscriptionSnapshot,
  subscriptionRefreshAt,
  writeSubscriptionSnapshot
} from "./subscriptionSession.js";

const MAX_TIMER_DELAY = 2_147_000_000;
const RETRY_BASE_DELAY_MS = 1_000;
const RETRY_MAX_DELAY_MS = 30_000;
const SubscriptionSessionContext = createContext(null);

function initialState(userId) {
  const cached = readSubscriptionSnapshot(userId);
  return cached
    ? { ready: true, error: "", ...cached }
    : { ready: false, error: "", subscription: null, entitlements: [] };
}

export function SubscriptionSessionProvider({ user, children }) {
  const userId = String(user?.id || "");
  const [state, setState] = useState(() => initialState(userId));
  const requestRef = useRef(0);
  const revalidatedRef = useRef(false);
  const retryAttemptRef = useRef(0);
  const directAccess = hasDirectStudyAccess(state.entitlements);
  const accessExempt = hasSubscriptionExemption(state.subscription);

  const commit = useCallback((subscription, entitlements) => {
    const next = writeSubscriptionSnapshot(
      userId,
      subscription,
      entitlements === undefined ? state.entitlements : entitlements
    );
    if (!isSubscriptionSnapshotFresh(next, userId)) {
      retryAttemptRef.current += 1;
      setState({ ready: false, error: "Subscription access did not include a valid expiration.", ...next });
      return null;
    }
    retryAttemptRef.current = 0;
    setState({ ready: true, error: "", ...next });
    return next;
  }, [state.entitlements, userId]);

  const refresh = useCallback(async ({ blocking = true } = {}) => {
    if (!userId) return null;
    revalidatedRef.current = true;
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    if (blocking) setState((current) => ({ ...current, ready: false, error: "" }));
    try {
      const snapshot = await billingApi.accessSnapshot();
      if (requestRef.current !== requestId) return null;
      const next = writeSubscriptionSnapshot(userId, snapshot.subscription, snapshot.entitlements);
      if (!isSubscriptionSnapshotFresh(next, userId)) {
        throw new Error("Subscription access did not include a valid expiration.");
      }
      retryAttemptRef.current = 0;
      setState({ ready: true, error: "", ...next });
      return next;
    } catch (error) {
      if (requestRef.current === requestId) {
        retryAttemptRef.current += 1;
        setState((current) => ({ ...current, ready: !blocking && current.ready, error: error?.message || "Subscription access could not be loaded." }));
      }
      return null;
    }
  }, [userId]);

  useEffect(() => {
    if (state.ready || !userId) return undefined;
    if (!state.error) {
      void refresh();
      return undefined;
    }
    const delay = Math.min(
      RETRY_MAX_DELAY_MS,
      RETRY_BASE_DELAY_MS * (2 ** Math.max(0, retryAttemptRef.current - 1))
    );
    const timer = window.setTimeout(() => void refresh(), delay);
    return () => window.clearTimeout(timer);
  }, [refresh, state.error, state.ready, userId]);

  // A cached snapshot renders the screen immediately; it does not get to decide
  // anything. Reloading the page used to show the reader whatever was true when
  // the tab was last open, for as long as that cache stayed fresh — so someone
  // whose payment had just been approved reloaded, and was told again that a
  // payment was already under review. Ask the server once on mount, without
  // blocking, and let the answer replace the cache as soon as it lands.
  useEffect(() => {
    if (!userId || revalidatedRef.current) return;
    void refresh({ blocking: false });
  }, [refresh, userId]);

  useEffect(() => {
    if (!state.ready) return undefined;
    const refreshAt = subscriptionRefreshAt(state);
    if (refreshAt === null) return undefined;
    let timer = 0;
    let cancelled = false;
    const schedule = () => {
      if (cancelled) return;
      const remaining = refreshAt - Date.now();
      if (remaining <= 0) {
        void refresh({ blocking: true });
        return;
      }
      timer = window.setTimeout(schedule, Math.min(remaining, MAX_TIMER_DELAY));
    };
    schedule();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [refresh, state]);

  // Polled for every signed-in reader, not only for one who currently has
  // access. The reader who most needs the next answer is the one waiting on an
  // administrator to approve a recharge card: gating this on `access_allowed`
  // meant that reader was the only one never asking, so an approval landed in
  // the database and nowhere else until they reopened the tab. A reader whose
  // access is stable and unbounded — a manual grant, a Founder exemption — has
  // nothing to learn from the poll and is left alone.
  const polls = Boolean(state.ready && !directAccess && !accessExempt);
  useEffect(() => {
    if (!polls) return undefined;
    const refreshIfVisible = () => {
      if (document.visibilityState !== "hidden") void refresh({ blocking: false });
    };
    const timer = window.setInterval(refreshIfVisible, 30_000);
    window.addEventListener("focus", refreshIfVisible);
    document.addEventListener("visibilitychange", refreshIfVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshIfVisible);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [polls, refresh]);

  const value = useMemo(() => ({
    ...state,
    directAccess,
    accessExempt,
    accessAllowed: Boolean(state.subscription?.access_allowed || directAccess),
    manualPaymentReview: manualPaymentReview(state.subscription),
    pendingManualPayment: hasPendingManualPayment(state.subscription),
    canAccessNow: () => {
      if (accessExempt) return true;
      if (directAccess) return true;
      if (!state.subscription?.access_allowed) return false;
      const refreshAt = subscriptionRefreshAt(state);
      if (["trialing", "active", "grace"].includes(state.subscription.status)) {
        return refreshAt !== null && Date.now() < refreshAt;
      }
      return true;
    },
    refresh,
    setAuthoritativeSubscription: (subscription) => commit(subscription)
  }), [accessExempt, commit, directAccess, refresh, state]);

  return <SubscriptionSessionContext.Provider value={value}>{children}</SubscriptionSessionContext.Provider>;
}

export function useSubscriptionSession() {
  const context = useContext(SubscriptionSessionContext);
  if (!context) throw new Error("useSubscriptionSession must be used within a SubscriptionSessionProvider");
  return context;
}
