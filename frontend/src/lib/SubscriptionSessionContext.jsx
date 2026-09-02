import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { billingApi } from "../api/billing.js";
import {
  hasDirectStudyAccess,
  isSubscriptionSnapshotFresh,
  readSubscriptionSnapshot,
  subscriptionRefreshAt,
  writeSubscriptionSnapshot
} from "./subscriptionSession.js";

const MAX_TIMER_DELAY = 2_147_000_000;
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

  const commit = useCallback((subscription, entitlements) => {
    const next = writeSubscriptionSnapshot(
      userId,
      subscription,
      entitlements === undefined ? state.entitlements : entitlements
    );
    if (!isSubscriptionSnapshotFresh(next, userId)) {
      setState({ ready: false, error: "Subscription access did not include a valid expiration.", ...next });
      return null;
    }
    setState({ ready: true, error: "", ...next });
    return next;
  }, [state.entitlements, userId]);

  const refresh = useCallback(async ({ blocking = true } = {}) => {
    if (!userId) return null;
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
      setState({ ready: true, error: "", ...next });
      return next;
    } catch (error) {
      if (requestRef.current === requestId) {
        setState((current) => ({ ...current, ready: !blocking && current.ready, error: error?.message || "Subscription access could not be loaded." }));
      }
      return null;
    }
  }, [userId]);

  useEffect(() => {
    if (state.ready || state.error || !userId) return;
    void refresh();
  }, [refresh, state.error, state.ready, userId]);

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

  const value = useMemo(() => ({
    ...state,
    directAccess: hasDirectStudyAccess(state.entitlements),
    accessAllowed: Boolean(state.subscription?.access_allowed || hasDirectStudyAccess(state.entitlements)),
    canAccessNow: () => {
      if (hasDirectStudyAccess(state.entitlements)) return true;
      if (!state.subscription?.access_allowed) return false;
      const refreshAt = subscriptionRefreshAt(state);
      if (["trialing", "active", "grace"].includes(state.subscription.status)) {
        return refreshAt !== null && Date.now() < refreshAt;
      }
      return true;
    },
    refresh,
    setAuthoritativeSubscription: (subscription) => commit(subscription)
  }), [commit, refresh, state]);

  return <SubscriptionSessionContext.Provider value={value}>{children}</SubscriptionSessionContext.Provider>;
}

export function useSubscriptionSession() {
  const context = useContext(SubscriptionSessionContext);
  if (!context) throw new Error("useSubscriptionSession must be used within a SubscriptionSessionProvider");
  return context;
}
