/**
 * A small priority queue for expensive PDF.js work. Jobs are collected for one
 * microtask before draining so the dominant page can outrank earlier DOM pages.
 */
export function pdfRenderGenerationIsCurrent(controller, generation, cancelled = false) {
  return !cancelled && !controller.suspended && controller.generation === generation;
}

export class PdfRenderQueue {
  constructor({ concurrency = 1 } = {}) {
    this.concurrency = Math.max(1, Number(concurrency) || 1);
    this.pending = [];
    this.jobs = new Map();
    this.activeCount = 0;
    this.sequence = 0;
    this.drainScheduled = false;
    this.destroyed = false;
  }

  enqueue({ key, priority = 0, run }) {
    if (this.destroyed || typeof run !== "function") return () => {};
    const previous = this.jobs.get(key);
    if (previous) this.cancelJob(previous);
    const job = {
      key,
      priority: Number(priority) || 0,
      run,
      sequence: this.sequence++,
      active: false,
      cancelled: false,
      cancelActive: null
    };
    this.jobs.set(key, job);
    this.pending.push(job);
    this.scheduleDrain();
    return () => this.cancelJob(job);
  }

  cancel(key) {
    const job = this.jobs.get(key);
    if (job) this.cancelJob(job);
  }

  cancelJob(job) {
    if (!job || job.cancelled) return;
    job.cancelled = true;
    if (this.jobs.get(job.key) === job) this.jobs.delete(job.key);
    job.cancelActive?.();
    this.scheduleDrain();
  }

  clear() {
    [...this.jobs.values()].forEach((job) => this.cancelJob(job));
    this.pending = [];
  }

  destroy() {
    this.destroyed = true;
    this.clear();
  }

  scheduleDrain() {
    if (this.destroyed || this.drainScheduled) return;
    this.drainScheduled = true;
    globalThis.queueMicrotask(() => {
      this.drainScheduled = false;
      this.drain();
    });
  }

  drain() {
    if (this.destroyed || this.activeCount >= this.concurrency) return;
    this.pending.sort((first, second) => first.priority - second.priority || first.sequence - second.sequence);
    while (this.activeCount < this.concurrency && this.pending.length) {
      const job = this.pending.shift();
      if (job.cancelled || this.jobs.get(job.key) !== job) continue;
      this.start(job);
    }
  }

  start(job) {
    job.active = true;
    this.activeCount += 1;
    const controls = {
      isCancelled: () => job.cancelled,
      registerCancel: (cancel) => {
        job.cancelActive = typeof cancel === "function" ? cancel : null;
        if (job.cancelled) job.cancelActive?.();
      }
    };
    Promise.resolve()
      .then(() => job.run(controls))
      .catch((error) => {
        if (!job.cancelled) console.error("Queued PDF render failed", error);
      })
      .finally(() => {
        job.active = false;
        job.cancelActive = null;
        this.activeCount -= 1;
        if (this.jobs.get(job.key) === job) this.jobs.delete(job.key);
        this.scheduleDrain();
      });
  }
}
