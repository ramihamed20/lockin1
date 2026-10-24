const DEFAULT_MINIMUM_DISTANCE_PX = .35;
const DEFAULT_MAXIMUM_GAP_PX = 6;
const MAX_INTERPOLATED_POINTS = 48;
const MAX_DIAGNOSTIC_POINTS = 256;
// Simulated pressure for a finger or mouse, from speed in css px per ms: a slow
// hand presses harder, a quick one lifts - the way ink pools and thins on paper.
const SIMULATED_PRESSURE = Object.freeze({ start: .55, slow: .78, fast: .3, fastSpeed: 1.5, follow: .22 });

/**
 * @typedef {Object} NormalizedInkSample
 * @property {number} x
 * @property {number} y
 * @property {number} page
 * @property {number} t
 * @property {number} p
 * @property {boolean} pressureAvailable
 * @property {"pen"|"touch"|"mouse"|"unknown"} pointer
 * @property {number} pointerId
 * @property {number} buttons
 * @property {number} contactWidth
 * @property {number} contactHeight
 * @property {number} tiltX
 * @property {number} tiltY
 * @property {number|null} altitudeAngle
 * @property {number|null} azimuthAngle
 * @property {number|null} twist
 * @property {number|null} tangentialPressure
 * @property {boolean} isPrimary
 */

/**
 * @typedef {Object} InkSession
 * @property {number} pointerId
 * @property {"pen"|"touch"|"mouse"|"unknown"} pointerType
 * @property {number} page
 * @property {NormalizedInkSample[]} points
 * @property {boolean} active
 * @property {boolean} finalized
 * @property {number|null} lastPressure
 * @property {boolean} hasReliablePressure
 * @property {{x:number,y:number,t:number,p:number}|null} simulation last sample of a pointer without pressure
 */

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value));
}

function distance(first, second) {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function nativeEventSamples(event, method) {
  let derived = [];
  try {
    const getter = event?.[method];
    if (typeof getter === "function") derived = getter.call(event) || [];
  } catch {
    derived = [];
  }
  const samples = derived.length ? [...derived] : method === "getPredictedEvents" ? [] : [event];
  const last = samples[samples.length - 1];
  if (method !== "getPredictedEvents" && last && last !== event
    && (last.clientX !== event.clientX || last.clientY !== event.clientY || last.timeStamp !== event.timeStamp)) {
    samples.push(event);
  }
  return samples.filter(Boolean);
}

function interpolateSample(first, second, ratio) {
  const progress = clamp(ratio);
  const numeric = ["p", "t", "contactWidth", "contactHeight", "tiltX", "tiltY", "altitudeAngle", "azimuthAngle", "twist", "tangentialPressure"];
  const point = {
    ...first,
    x: first.x + (second.x - first.x) * progress,
    y: first.y + (second.y - first.y) * progress
  };
  for (const key of numeric) {
    if (Number.isFinite(first[key]) && Number.isFinite(second[key])) point[key] = first[key] + (second[key] - first[key]) * progress;
    else if (Number.isFinite(second[key])) point[key] = second[key];
  }
  point.pressureAvailable = Boolean(first.pressureAvailable || second.pressureAvailable);
  return point;
}

function diagnosticSlice(points) {
  return points.slice(-MAX_DIAGNOSTIC_POINTS).map((point) => ({ ...point }));
}

/**
 * Creates the pointer/stylus input boundary used by the workspace. It owns one
 * active pointer at a time and never depends on React state.
 */
export function createInkInputController() {
  /** @type {InkSession|null} */
  let session = null;
  let mapClientPoint = null;
  let pageUnitsPerCssPixel = 1;
  let debugEnabled = false;
  let diagnostics = {
    phase: "idle",
    raw: [],
    rawPage: [],
    normalized: [],
    predicted: [],
    pointerId: null,
    pointerType: null,
    capture: false,
    reason: null
  };

  function publishDiagnostics(phase, extra = {}) {
    diagnostics = {
      ...diagnostics,
      phase,
      pointerId: session?.pointerId ?? diagnostics.pointerId,
      pointerType: session?.pointerType ?? diagnostics.pointerType,
      ...extra
    };
  }

  function normalizedPressure(sample, event, mutatePressureState) {
    const pointer = String(sample.pointerType || event.pointerType || "unknown");
    if (pointer !== "pen") return { p: .5, pressureAvailable: false };
    const raw = Number(sample.pressure);
    if (Number.isFinite(raw) && raw > .005) {
      const next = clamp(raw);
      const pressure = session?.hasReliablePressure && Number.isFinite(session.lastPressure)
        ? session.lastPressure * .28 + next * .72
        : next;
      if (mutatePressureState && session) {
        session.lastPressure = pressure;
        session.hasReliablePressure = true;
      }
      return { p: pressure, pressureAvailable: true };
    }
    if (session?.hasReliablePressure && Number.isFinite(session.lastPressure)) {
      return { p: session.lastPressure, pressureAvailable: true };
    }
    return { p: .5, pressureAvailable: false };
  }

  /**
   * Pressure for a pointer that reports none, eased towards the value its speed
   * implies so a single jittery sample cannot pinch the line.
   */
  function simulatedPressure(point, time, mutate) {
    const state = session?.simulation;
    if (!state) return SIMULATED_PRESSURE.start;
    const elapsed = Math.max(1, time - state.t);
    const speed = Math.hypot(point.x - state.x, point.y - state.y) / pageUnitsPerCssPixel / elapsed;
    const target = SIMULATED_PRESSURE.slow - (SIMULATED_PRESSURE.slow - SIMULATED_PRESSURE.fast) * clamp(speed / SIMULATED_PRESSURE.fastSpeed);
    const pressure = state.p + (target - state.p) * SIMULATED_PRESSURE.follow;
    if (mutate) session.simulation = { x: point.x, y: point.y, t: time, p: pressure };
    return pressure;
  }

  function normalizeSample(sample, event, mutatePressureState = true) {
    if (!mapClientPoint || !session) return null;
    const clientX = Number(sample.clientX);
    const clientY = Number(sample.clientY);
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;
    const mapped = mapClientPoint(clientX, clientY, session.page);
    if (!mapped || !Number.isFinite(Number(mapped.x)) || !Number.isFinite(Number(mapped.y))) return null;
    const pointer = ["pen", "touch", "mouse"].includes(sample.pointerType || event.pointerType)
      ? (sample.pointerType || event.pointerType)
      : "unknown";
    const pressure = normalizedPressure(sample, event, mutatePressureState);
    const time = Math.max(0, finite(sample.timeStamp, Date.now()));
    if (pointer !== "pen") {
      const point = { x: Number(mapped.x), y: Number(mapped.y) };
      pressure.p = simulatedPressure(point, time, mutatePressureState);
      if (mutatePressureState && !session.simulation) session.simulation = { ...point, t: time, p: pressure.p };
    }
    return {
      ...mapped,
      page: session.page,
      t: time,
      p: pressure.p,
      pressureAvailable: pressure.pressureAvailable,
      pointer,
      pointerId: Math.max(0, Math.round(finite(sample.pointerId ?? event.pointerId))),
      buttons: Math.max(0, Math.round(finite(sample.buttons ?? event.buttons))),
      contactWidth: Math.max(0, finite(sample.width)),
      contactHeight: Math.max(0, finite(sample.height)),
      tiltX: clamp(finite(sample.tiltX), -90, 90),
      tiltY: clamp(finite(sample.tiltY), -90, 90),
      altitudeAngle: sample.altitudeAngle != null && Number.isFinite(Number(sample.altitudeAngle)) ? Number(sample.altitudeAngle) : null,
      azimuthAngle: sample.azimuthAngle != null && Number.isFinite(Number(sample.azimuthAngle)) ? Number(sample.azimuthAngle) : null,
      twist: sample.twist != null && Number.isFinite(Number(sample.twist)) ? Number(sample.twist) : null,
      tangentialPressure: sample.tangentialPressure != null && Number.isFinite(Number(sample.tangentialPressure)) ? Number(sample.tangentialPressure) : null,
      isPrimary: sample.isPrimary !== false,
      w: null
    };
  }

  function appendNormalized(point, destination) {
    const previous = destination[destination.length - 1];
    if (!previous) {
      destination.push(point);
      return [point];
    }
    const separation = distance(previous, point);
    const minimumDistance = DEFAULT_MINIMUM_DISTANCE_PX * pageUnitsPerCssPixel;
    if (separation < minimumDistance) {
      destination[destination.length - 1] = point;
      return [];
    }
    const maximumGap = Math.max(minimumDistance, DEFAULT_MAXIMUM_GAP_PX * pageUnitsPerCssPixel);
    const steps = Math.min(MAX_INTERPOLATED_POINTS, Math.max(1, Math.ceil(separation / maximumGap)));
    const appended = [];
    for (let step = 1; step <= steps; step += 1) {
      const next = step === steps ? point : interpolateSample(previous, point, step / steps);
      destination.push(next);
      appended.push(next);
    }
    return appended;
  }

  function appendEvent(event, phase = "move") {
    if (!session?.active || session.finalized || Number(event?.pointerId) !== session.pointerId) return { appended: [], points: session?.points || [] };
    const raw = nativeEventSamples(event, "getCoalescedEvents");
    const appended = [];
    const rawPage = [];
    for (const sample of raw) {
      const normalized = normalizeSample(sample, event, true);
      if (normalized) {
        rawPage.push(normalized);
        appended.push(...appendNormalized(normalized, session.points));
      }
    }
    if (debugEnabled) {
      publishDiagnostics(phase, {
        raw: diagnosticSlice(raw.map((sample) => ({ x: finite(sample.clientX), y: finite(sample.clientY), t: finite(sample.timeStamp) }))),
        rawPage: diagnosticSlice(rawPage),
        normalized: diagnosticSlice(session.points),
        reason: null
      });
    }
    return { appended, points: session.points };
  }

  return {
    begin(event, options) {
      const pointerId = Math.max(0, Math.round(finite(event?.pointerId)));
      mapClientPoint = options?.mapClientPoint;
      pageUnitsPerCssPixel = Math.max(.001, finite(options?.pageUnitsPerCssPixel, 1));
      debugEnabled = options?.debug === true;
      session = {
        pointerId,
        pointerType: ["pen", "touch", "mouse"].includes(event?.pointerType) ? event.pointerType : "unknown",
        page: Number.isSafeInteger(options?.page) && options.page < 0 ? options.page : Math.max(1, Math.round(finite(options?.page, 1))),
        points: [],
        active: true,
        finalized: false,
        lastPressure: null,
        hasReliablePressure: false,
        simulation: null
      };
      publishDiagnostics("begin", { pointerId, pointerType: session.pointerType, capture: options?.captured === true, reason: null });
      return appendEvent(event, "begin");
    },
    append(event) {
      return appendEvent(event, "move");
    },
    predicted(event) {
      if (!session?.active || session.finalized || Number(event?.pointerId) !== session.pointerId) return [];
      const raw = nativeEventSamples(event, "getPredictedEvents");
      const predicted = raw.map((sample) => normalizeSample(sample, event, false)).filter(Boolean);
      if (debugEnabled) publishDiagnostics("predict", { predicted: diagnosticSlice(predicted) });
      return predicted;
    },
    finish(event, reason = "pointerup") {
      if (!session?.active || session.finalized || Number(event?.pointerId) !== session.pointerId) return null;
      appendEvent(event, "finish");
      session.active = false;
      session.finalized = true;
      publishDiagnostics("finished", { capture: false, reason, normalized: diagnosticSlice(session.points) });
      return { ...session, points: [...session.points], reason };
    },
    cancel(reason = "pointercancel") {
      if (!session || session.finalized) return null;
      session.active = false;
      session.finalized = true;
      publishDiagnostics("cancelled", { capture: false, reason, normalized: diagnosticSlice(session.points) });
      return { ...session, points: [...session.points], reason };
    },
    lostCapture(event) {
      if (!session?.active || session.finalized || Number(event?.pointerId) !== session.pointerId) return null;
      appendEvent(event, "lostpointercapture");
      session.active = false;
      session.finalized = true;
      publishDiagnostics("finished", { capture: false, reason: "lostpointercapture", normalized: diagnosticSlice(session.points) });
      return { ...session, points: [...session.points], reason: "lostpointercapture" };
    },
    hasActivePointer(pointerId) {
      return Boolean(session?.active && !session.finalized && session.pointerId === Number(pointerId));
    },
    setCapture(captured) {
      publishDiagnostics(diagnostics.phase, { capture: Boolean(captured) });
    },
    getDiagnostics() {
      return {
        ...diagnostics,
        raw: diagnosticSlice(diagnostics.raw),
        rawPage: diagnosticSlice(diagnostics.rawPage || []),
        normalized: diagnosticSlice(diagnostics.normalized),
        predicted: diagnosticSlice(diagnostics.predicted)
      };
    },
    reset() {
      session = null;
      mapClientPoint = null;
      diagnostics = { phase: "idle", raw: [], rawPage: [], normalized: [], predicted: [], pointerId: null, pointerType: null, capture: false, reason: null };
    }
  };
}
