const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

export function clampToBounds(value, minimum, maximum) {
  return Math.min(Math.max(finite(value), minimum), maximum);
}

/**
 * iOS-like resistance curve. It deliberately asymptotes at `limit` so a
 * prolonged drag cannot pull the document an unsafe distance outside its
 * committed geometry.
 */
export function resistedDistance(distance, limit) {
  const magnitude = Math.abs(finite(distance));
  const cap = Math.max(0.001, finite(limit, 1));
  return Math.sign(finite(distance)) * cap * (1 - Math.exp(-magnitude / cap));
}

/**
 * Converts a displayed rubber-band displacement back into its virtual input.
 * This lets a new drag begin from the exact in-flight spring position instead
 * of visually jumping back to the legal boundary first.
 */
export function unresistedDistance(distance, limit) {
  const cap = Math.max(0.001, finite(limit, 1));
  const magnitude = Math.min(Math.abs(finite(distance)), cap * .999);
  return Math.sign(finite(distance)) * -cap * Math.log(1 - magnitude / cap);
}

/** Adds bounded physical input to one persistent spring axis. */
export function addSpringImpulse(axis, { position, impulse = 0, maxPosition, maxVelocity }) {
  const limit = Math.max(.001, finite(maxPosition, 1));
  const velocityLimit = Math.max(.001, finite(maxVelocity, 1));
  const nextPosition = clampToBounds(finite(position), -limit, limit);
  return {
    value: nextPosition,
    velocity: clampToBounds(finite(axis?.velocity) + finite(impulse), -velocityLimit, velocityLimit),
    target: 0
  };
}

/** Keeps legal scale separate from a short-lived visual overshoot. */
export function elasticScale(rawScale, minimum, maximum, overshootLimit = 0.2) {
  const legal = clampToBounds(rawScale, minimum, maximum);
  const excess = finite(rawScale) - legal;
  return {
    legal,
    overshoot: resistedDistance(excess, overshootLimit),
    display: legal + resistedDistance(excess, overshootLimit)
  };
}

/**
 * Returns a legal scroll position and a transform-only visual displacement.
 * The latter is never committed to the scroll container.
 */
export function elasticScrollPosition(rawPosition, minimum, maximum, visualLimit) {
  const legal = clampToBounds(rawPosition, minimum, maximum);
  return {
    legal,
    overshoot: resistedDistance(finite(rawPosition) - legal, visualLimit)
  };
}

const SPRING_SUB_STEP_SECONDS = .008;
const MAX_SPRING_CATCH_UP_SECONDS = .064;

/**
 * A stable, critically damped spring integration step for a rAF loop.
 *
 * Long frames are integrated in fixed sub-steps rather than being clamped to a
 * single short step. A dropped frame then still advances the real elapsed time,
 * so the spring-back keeps its duration on a loaded or throttled device instead
 * of degrading into slow motion.
 */
export function advanceSpring({ value, velocity = 0, target = 0, stiffness = 320, damping = 36 }, deltaMs) {
  const elapsed = Math.min(MAX_SPRING_CATCH_UP_SECONDS, Math.max(.001, finite(deltaMs, 16) / 1000));
  const steps = Math.max(1, Math.ceil(elapsed / SPRING_SUB_STEP_SECONDS));
  const step = elapsed / steps;
  const goal = finite(target);
  const stiffnessValue = finite(stiffness, 320);
  const dampingValue = finite(damping, 36);
  let nextValue = finite(value);
  let nextVelocity = finite(velocity);
  for (let index = 0; index < steps; index += 1) {
    nextVelocity += (-stiffnessValue * (nextValue - goal) - dampingValue * nextVelocity) * step;
    nextValue += nextVelocity * step;
  }
  const settled = Math.abs(nextValue - goal) < .08 && Math.abs(nextVelocity) < .08;
  return { value: settled ? goal : nextValue, velocity: settled ? 0 : nextVelocity, settled };
}

/**
 * Rubber-band zoom. Overshoot is measured in log space so pinching past the
 * maximum and past the minimum resist by the same visual ratio. `legal` is the
 * value that may be committed; `display` is the compositor-only scale that the
 * caller animates back to `legal` on release.
 */
export function elasticZoomScale(rawScale, minimum, maximum, ratioLimit = .22) {
  const low = Math.max(.001, finite(minimum, .001));
  const high = Math.max(low, finite(maximum, low));
  const raw = Math.max(.001, finite(rawScale, low));
  const legal = clampToBounds(raw, low, high);
  const limit = Math.log(1 + Math.max(.001, finite(ratioLimit, .22)));
  const resisted = resistedDistance(Math.log(raw / legal), limit);
  return { legal, display: legal * Math.exp(resisted), overshoot: resisted };
}
