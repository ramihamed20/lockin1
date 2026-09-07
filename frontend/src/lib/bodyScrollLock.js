const activeLocks = new Map();
let baseline = null;

function applyLocks(doc) {
  const body = doc?.body;
  if (!body) return;
  if (!activeLocks.size) {
    if (baseline) {
      body.style.overflow = baseline.overflow;
      body.style.touchAction = baseline.touchAction;
    }
    baseline = null;
    return;
  }
  body.style.overflow = "hidden";
  body.style.touchAction = Array.from(activeLocks.values()).some((lock) => lock.touchAction === "none")
    ? "none"
    : baseline?.touchAction || "";
}

/**
 * Lock document scrolling for one overlay owner.
 *
 * The returned release function is idempotent. The first owner captures the
 * real body styles and the last owner restores them, so closing one of several
 * nested overlays cannot strand the page with `overflow: hidden`.
 */
export function acquireBodyScrollLock({ touchAction = "" } = {}, doc = typeof document === "undefined" ? null : document) {
  const body = doc?.body;
  if (!body) return () => {};
  if (!activeLocks.size) {
    baseline = { overflow: body.style.overflow, touchAction: body.style.touchAction };
  }
  const owner = Symbol("body-scroll-lock");
  activeLocks.set(owner, { touchAction });
  applyLocks(doc);

  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeLocks.delete(owner);
    applyLocks(doc);
  };
}

