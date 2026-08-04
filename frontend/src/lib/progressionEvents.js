export const PROGRESSION_UPDATED_EVENT = "lock-in:progression-updated";

export function notifyProgressionUpdated() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(PROGRESSION_UPDATED_EVENT));
}
