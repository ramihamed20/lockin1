/** @param {string} scope @param {string} [surface] */
export function initialCompanionMotion(scope, surface = "") {
  return { scope, surface, phase: "thinking", cue: surface ? "" : "invite", token: 0 };
}

/** Scope-checked events prevent an old page's typing/save/timer changing the pet.
 * @param {ReturnType<typeof initialCompanionMotion>} state
 * @param {{type: string, scope: string, surface?: string, phase?: string, token?: number, confirmed?: boolean}} event
 */
export function companionMotionReducer(state, event) {
  if (event.type === "reset") return initialCompanionMotion(event.scope, event.surface);
  if (event.scope !== state.scope) return state;
  if (event.type === "surface") {
    if (event.surface === state.surface) return state;
    return { ...state, surface: event.surface, phase: "thinking", cue: event.surface ? "" : "settle", token: state.token + 1 };
  }
  if (event.type === "phase" && state.surface === "idea" && ["idle", "speaking", "thinking"].includes(event.phase)) return { ...state, phase: event.phase };
  if (event.type === "saved" && event.confirmed === true) return { ...state, cue: "saved", token: state.token + 1 };
  if (event.type === "finish" && event.token === state.token) return { ...state, cue: "" };
  return state;
}

export function companionMotionState(state) {
  return state.cue || (state.surface === "idea" ? state.phase : "idle");
}
