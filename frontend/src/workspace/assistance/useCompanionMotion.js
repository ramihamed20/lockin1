import { expressionDuration } from "../../lib/companionExpression.js";
import { useCallback, useEffect, useReducer } from "react";
import { companionMotionReducer, companionMotionState, initialCompanionMotion } from "../../lib/companionMotion.js";

export function useCompanionMotion(scope, surface, enabled) {
  const [stored, dispatch] = useReducer(companionMotionReducer, initialCompanionMotion(scope));
  const current = stored.scope === scope ? stored : initialCompanionMotion(scope, surface);
  const state = companionMotionState(current);
  useEffect(() => { dispatch({ type: "reset", scope, surface });
  // A scope change starts a new interaction; surface changes use their own event.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);
  useEffect(() => { dispatch({ type: "surface", scope, surface }); }, [scope, surface]);
  useEffect(() => {
    if (!current.cue) return undefined;
    if (!enabled) { dispatch({ type: "finish", scope, token: current.token }); return undefined; }
    const timer = window.setTimeout(() => dispatch({ type: "finish", scope, token: current.token }), expressionDuration(current.cue));
    return () => window.clearTimeout(timer);
  }, [enabled, scope, current.cue, current.token]);
  const phase = useCallback((value) => dispatch({ type: "phase", scope, phase: value }), [scope]);
  const saved = useCallback(() => dispatch({ type: "saved", scope, confirmed: true }), [scope]);
  return { state, sequenceKey: scope + "/" + current.token, phase, saved };
}
