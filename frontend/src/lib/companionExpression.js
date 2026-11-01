import { sampleGesture, blendGesture, ease } from "./companionGestures.js";

export const expressionDuration = (state) => ({ invite: 2800, saved: 1900, settle: 900 }[state] || 0);
const pulse = (t, start, peak, end, done) => ease((t - start) / (peak - start)) * (1 - ease((t - end) / (done - end)));

/** Pure timeline shared by the original-image renderer and lifecycle tests. */
export function expressionPose(state, elapsed, clock, character, gaze = { x: 0, y: 0 }) {
  const t = Math.max(0, Number.isFinite(elapsed) ? elapsed : 0);
  const time = Math.max(0, Number.isFinite(clock) ? clock : 0);
  const kind = state === "invite" ? "wave" : state === "speaking" ? "explain" : state === "saved" ? "saved" : "idle";
  const p = sampleGesture(kind, state === "speaking" ? t % 3.8 : t, character);
  // Uneven spacing and an occasional double blink keep a calm, organic rhythm.
  const cycle = (time + (character === "girl" ? .8 : 0)) % 9.7;
  const blink = Math.max(pulse(cycle, 3.1, 3.18, 3.21, 3.34), pulse(cycle, 7.9, 7.98, 8, 8.12), pulse(cycle, 8.2, 8.27, 8.29, 8.4));
  p.eyeOpen = Math.max(.025, 1 - blink);
  p.gazeX = Math.max(-1, Math.min(1, Number(gaze.x) || 0)) * 9 + Math.sin(time * .6) * 3;
  p.gazeY = Math.max(-1, Math.min(1, Number(gaze.y) || 0)) * 7;
  p.mouth = 0;
  p.thought = 0;
  p.idea = 0;
  if (state === "speaking") {
    const phrase = 1 - pulse(t % 2.4, 1.8, 1.95, 2.15, 2.35);
    p.mouth = phrase * (.18 + .82 * Math.pow(Math.sin(t * 11.7), 2));
    p.idea = pulse(t % 3.8, .2, .65, 2.5, 3.7);
  } else if (state === "thinking") {
    p.head = -3 + Math.sin(t * 1.4) * 1.2;
    p.gazeY -= 12;
    p.gazeX += 9;
    p.thought = ease(t / .4);
    p.armR = character === "girl" ? -15 : -12;
  }
  return p;
}

/** @returns {ReturnType<typeof expressionPose>} */
export function blendExpression(a, b, weight) {
  if (weight <= 0) return { ...a };
  if (weight >= 1) return { ...b };
  return /** @type {ReturnType<typeof expressionPose>} */ (blendGesture(a, b, weight));
}
