/** Pure timing rules shared by the Paper Workspace control bar and its tests. */

export const SKIP_SECONDS = 10;
export const IDLE_DELAY_MS = 3500;

/** 0:07, 12:30, 1:02:05 — Latin digits in every locale, like the timer. */
export function formatMediaTime(seconds) {
  const safe = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = String(safe % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** Where a ±10 s skip lands, kept inside the media. */
export function skipTarget(time, delta, duration) {
  const next = (Number(time) || 0) + delta;
  const end = Number.isFinite(duration) && duration > 0 ? duration : Infinity;
  return Math.min(end, Math.max(0, next));
}
