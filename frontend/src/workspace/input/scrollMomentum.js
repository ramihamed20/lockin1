import { WORKSPACE_GESTURE } from "../config.js";

export const PAN_SAMPLE_WINDOW_MS = WORKSPACE_GESTURE.panSampleWindowMs;
export const MAX_PAN_SAMPLES = WORKSPACE_GESTURE.maximumPanSamples;
export const MIN_MOMENTUM_VELOCITY = 0.28;

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

/** Mutates a gesture-local history array to avoid allocations in React state. */
export function appendRecentPointerSamples(history, incoming, windowMs = PAN_SAMPLE_WINDOW_MS) {
  for (const sample of incoming) {
    const next = {
      x: finiteNumber(sample.x ?? sample.clientX),
      y: finiteNumber(sample.y ?? sample.clientY),
      time: finiteNumber(sample.time ?? sample.timeStamp)
    };
    const previous = history[history.length - 1];
    if (previous && next.time < previous.time) continue;
    if (previous && next.time === previous.time) history[history.length - 1] = next;
    else history.push(next);
  }
  const latestTime = history[history.length - 1]?.time ?? 0;
  const earliestTime = latestTime - windowMs;
  while (history.length > 2 && (history[1].time < earliestTime || history.length > MAX_PAN_SAMPLES)) history.shift();
  return history;
}

/**
 * Estimates scroll velocity (the inverse of finger velocity) from recent
 * segments. Recent segments receive more weight than the old edge of the
 * sampling window, and a finger held still before release loses momentum.
 */
export function estimateReleaseScrollVelocity(samples, releaseTime, windowMs = PAN_SAMPLE_WINDOW_MS) {
  if (!Array.isArray(samples) || samples.length < 2) return { x: 0, y: 0, speed: 0 };
  const releasedAt = finiteNumber(releaseTime, samples[samples.length - 1].time);
  const lastSample = samples[samples.length - 1];
  const releaseGap = Math.max(0, releasedAt - lastSample.time);
  if (releaseGap >= 80) return { x: 0, y: 0, speed: 0 };
  const recent = samples.filter((sample) => sample.time >= releasedAt - windowMs);
  if (recent.length < 2) return { x: 0, y: 0, speed: 0 };
  let weightedX = 0;
  let weightedY = 0;
  let totalWeight = 0;
  for (let index = 1; index < recent.length; index += 1) {
    const previous = recent[index - 1];
    const current = recent[index];
    const deltaTime = current.time - previous.time;
    if (deltaTime <= 0 || deltaTime > 50) continue;
    const recency = clamp(1 - (releasedAt - current.time) / windowMs, 0, 1);
    const weight = (0.3 + 0.7 * recency * recency) * Math.min(deltaTime, 24);
    weightedX += clamp((previous.x - current.x) / deltaTime, -24, 24) * weight;
    weightedY += clamp((previous.y - current.y) / deltaTime, -24, 24) * weight;
    totalWeight += weight;
  }
  if (!totalWeight) return { x: 0, y: 0, speed: 0 };
  const releaseGapFactor = clamp(1 - Math.max(0, releaseGap - 16) / 64, 0, 1);
  const x = weightedX / totalWeight * releaseGapFactor;
  const y = weightedY / totalWeight * releaseGapFactor;
  return { x, y, speed: Math.hypot(x, y) };
}

/** @param {{ viewportWidth?: number, reducedMotion?: boolean }} options */
export function momentumConfig({ viewportWidth, reducedMotion = false } = {}) {
  const tablet = finiteNumber(viewportWidth) >= 700;
  return {
    baseFriction: tablet ? 0.00095 : 0.0009,
    maxVelocity: tablet ? 7.2 : 6.8,
    stopVelocity: 0.03,
    reducedMotion
  };
}

/** Converts measured release speed into precise/low/medium/high intent bands. */
export function momentumVelocityForIntent(velocity, config) {
  const x = finiteNumber(velocity?.x);
  const y = finiteNumber(velocity?.y);
  const speed = Math.hypot(x, y);
  if (config?.reducedMotion || speed < MIN_MOMENTUM_VELOCITY) return { x: 0, y: 0, speed: 0, band: "precise" };
  let gain = 1.18;
  let band = "high";
  if (speed < 0.65) {
    gain = 0.45;
    band = "low";
  } else if (speed < 1.7) {
    gain = 0.95;
    band = "medium";
  }
  const targetSpeed = Math.min(finiteNumber(config?.maxVelocity, 6.8), speed * gain);
  return { x: x / speed * targetSpeed, y: y / speed * targetSpeed, speed: targetSpeed, band };
}

/** One bounded exponential-decay step. Velocity is in CSS px/ms. */
export function advanceMomentumFrame(state, deltaTime, config, bounds) {
  const elapsed = clamp(finiteNumber(deltaTime, 16), 1, 32);
  const speed = Math.hypot(state.velocityX, state.velocityY);
  const speedFriction = speed < 0.8 ? 1.85 : speed < 2 ? 1.5 : 1;
  const friction = finiteNumber(config.baseFriction, 0.001) * speedFriction;
  const decay = Math.exp(-friction * elapsed);
  const travelFactor = (1 - decay) / friction;
  const unclampedLeft = state.scrollLeft + state.velocityX * travelFactor;
  const unclampedTop = state.scrollTop + state.velocityY * travelFactor;
  const minScrollLeft = Math.max(0, finiteNumber(bounds.minScrollLeft));
  const minScrollTop = Math.max(0, finiteNumber(bounds.minScrollTop));
  const scrollLeft = clamp(unclampedLeft, minScrollLeft, Math.max(minScrollLeft, finiteNumber(bounds.maxScrollLeft)));
  const scrollTop = clamp(unclampedTop, minScrollTop, Math.max(minScrollTop, finiteNumber(bounds.maxScrollTop)));
  let velocityX = state.velocityX * decay;
  let velocityY = state.velocityY * decay;
  if (scrollLeft !== unclampedLeft) velocityX = 0;
  if (scrollTop !== unclampedTop) velocityY = 0;
  if (Math.hypot(velocityX, velocityY) < finiteNumber(config.stopVelocity, 0.03)) {
    velocityX = 0;
    velocityY = 0;
  }
  return {
    scrollLeft,
    scrollTop,
    unclampedLeft,
    unclampedTop,
    velocityX,
    velocityY,
    active: velocityX !== 0 || velocityY !== 0
  };
}
