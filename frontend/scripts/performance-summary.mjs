import { readFile } from "node:fs/promises";

// Deterministic nearest-rank summaries. Keep raw evidence and its lab context.
function distribution(values) {
  const sorted = values.filter((value) => typeof value === "number" && Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return { samples: 0, p50: null, p75: null, p95: null };
  return Object.fromEntries([["samples", sorted.length], ...[.5, .75, .95].map((q) => ["p" + Math.round(q * 100), Math.round(sorted[Math.ceil(sorted.length * q) - 1] * 10) / 10])]);
}
for (const file of process.argv.slice(2)) {
  const report = JSON.parse(await readFile(file, "utf8"));
  if (!Array.isArray(report.results) || !report.results.length) throw new Error("No completed samples: " + file);
  const summary = { file, environment: report.environment, buildIndexSha256: report.buildIndexSha256, completedRuns: report.results.length, errors: report.results.flatMap((row) => row.errors || []) };
  if (report.results[0].coldReadyMs !== undefined) {
    summary.coldReadyMs = distribution(report.results.map((row) => row.coldReadyMs));
    summary.warmReadyMs = distribution(report.results.map((row) => row.warmReadyMs));
    summary.coldStudyNavigationMs = distribution(report.results.map((row) => row.coldStudyNavigationMs));
    summary.warmStudyNavigationMs = distribution(report.results.map((row) => row.warmStudyNavigationMs));
    summary.initialLcpMs = distribution(report.results.map((row) => row.cold.lcp));
    summary.initialCls = distribution(report.results.map((row) => row.cold.cls));
    const routes = report.results.flatMap((row) => row.routes);
    summary.routeReadyMs = Object.fromEntries([...new Set(routes.map((row) => row.name))].map((name) => [name, distribution(routes.filter((row) => row.name === name).map((row) => row.readyMs))]));
  } else {
    summary.byStoredStrokes = Object.fromEntries([...new Set(report.results.map((row) => row.strokes))].map((count) => {
      const rows = report.results.filter((row) => row.strokes === count);
      return [count, { coldUsableMs: distribution(rows.map((row) => row.coldUsableMs)), gestureFrameMs: distribution(rows.flatMap((row) => row.drawing?.frameDurationsMs || [])), commitObservationMs: distribution(rows.map((row) => row.drawing?.commitObservationMs)), settledCanvasBackingBytesProxy: distribution(rows.map((row) => row.settled.panes.reduce((total, pane) => total + pane.approximateBytes, 0))), hiddenCanvasBackingBytesProxy: distribution(rows.map((row) => row.settled.panes.filter((pane) => !pane.active).reduce((total, pane) => total + pane.approximateBytes, 0))) }];
    }));
    const phases = report.results.flatMap((row) => row.pdfLoadTimings || []);
    summary.pdfLoadPhasesByPageCount = Object.fromEntries([...new Set(phases.map((row) => row.pageCount))].map((count) => [count, Object.fromEntries(["libraryMs", "sourceMs", "parseMs", "geometryMs"].map((key) => [key, distribution(phases.filter((row) => row.pageCount === count).map((row) => row[key]))]))]));
    const cycles = report.results.flatMap((row) => row.closedCycles || []);
    summary.closedCycles = Object.fromEntries([...new Set(cycles.map((row) => row.cycle))].map((cycle) => {
      const rows = cycles.filter((row) => row.cycle === cycle);
      return [cycle, { samples: rows.length, panes: rows.map((row) => row.memory.panes.length), canvasBackingBytesProxy: distribution(rows.map((row) => row.memory.panes.reduce((total, pane) => total + pane.approximateBytes, 0))), retainedMainHeapBytes: distribution(rows.map((row) => row.retainedMainHeap?.heap.usedSize)), domNodes: distribution(rows.map((row) => row.retainedMainHeap?.dom.nodes)), dedicatedWorkerTargets: distribution(rows.map((row) => row.retainedMainHeap?.dedicatedWorkerTargets)) }];
    }));
    const tabs = report.results.flatMap((row) => row.tabs);
    summary.tabUsableMs = Object.fromEntries([...new Set(tabs.map((row) => row.slug))].map((slug) => [slug, distribution(tabs.filter((row) => row.slug === slug).map((row) => row.usableMs))]));
  }
  console.log(JSON.stringify(summary, null, 2));
}
