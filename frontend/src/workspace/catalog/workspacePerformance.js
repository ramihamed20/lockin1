/**
 * Development-only, pull-based measurements. It intentionally creates no UI
 * and writes nothing in production; developers can inspect
 * `window.__lockInFocusPerformance` while stress-testing a document.
 */
export function createWorkspacePerformanceMonitor() {
  const enabled = Boolean(import.meta.env.DEV);
  const samples = new Map();
  const metrics = {
    drawingFrame: { count: 0, total: 0, max: 0 },
    eraserFrame: { count: 0, total: 0, max: 0 },
    pointerToPaint: { count: 0, total: 0, max: 0 },
    geometryTime: { count: 0, total: 0, max: 0 },
    eraserCandidates: { count: 0, total: 0, max: 0 },
    annotationSave: { count: 0, total: 0, max: 0 },
    pdfRender: { count: 0, total: 0, max: 0 },
    liveCanvasRedraws: 0,
    reactRendersDuringGesture: 0,
    storedStrokes: 0,
    storedPoints: 0
  };

  function publish() {
    if (enabled && typeof window !== "undefined") {
      const snapshot = { ...metrics };
      for (const [name, value] of Object.entries(metrics)) {
        if (value && typeof value === "object" && "count" in value) {
          const values = samples.get(name) || [];
          const sorted = [...values].sort((first, second) => first - second);
          snapshot[name] = {
            ...value,
            average: value.count ? value.total / value.count : 0,
            p95: sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * .95))] : 0
          };
        }
      }
      window.__lockInFocusPerformance = snapshot;
    }
  }

  function record(name, duration) {
    if (!enabled || !metrics[name]) return;
    const bucket = metrics[name];
    bucket.count += 1;
    bucket.total += duration;
    bucket.max = Math.max(bucket.max, duration);
    const values = samples.get(name) || [];
    values.push(duration);
    if (values.length > 240) values.shift();
    samples.set(name, values);
    publish();
  }

  return {
    measure(name, work) {
      if (!enabled) return work();
      const started = window.performance.now();
      const result = work();
      record(name, window.performance.now() - started);
      return result;
    },
    record,
    recordValue(name, value) {
      record(name, Math.max(0, Number(value) || 0));
    },
    increment(name) {
      if (!enabled || !(name in metrics)) return;
      metrics[name] += 1;
      publish();
    },
    annotationSnapshot(annotations) {
      if (!enabled) return;
      metrics.storedStrokes = annotations.length;
      metrics.storedPoints = annotations.reduce((total, annotation) => total + (annotation.points?.length || 0), 0);
      publish();
    }
  };
}
