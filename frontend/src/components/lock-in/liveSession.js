export function liveClock(payload, monotonicNow) {
  const elapsed = Math.max(0, (monotonicNow - (payload.received_at_monotonic_ms ?? monotonicNow)) / 1000);
  const running = payload.session.status === "active";
  const planned = payload.session.planned_duration_seconds;
  const room = Number(payload.timing.active_elapsed_seconds || 0) + (running ? elapsed : 0);
  const personal = Number(payload.self_active_seconds ?? payload.timing.active_elapsed_seconds ?? 0)
    + (running && payload.self_running !== false ? Math.min(elapsed, 75) : 0);
  return {
    room: planned == null ? room : Math.min(planned, room),
    personal: planned == null ? personal : Math.min(planned, personal),
    remaining: planned == null ? null : Math.max(0, planned - room)
  };
}

export function acceptsLiveResponse(current, next) {
  if (!current || current.session?.id !== next.session?.id) return true;
  const terminal = ["completed", "abandoned"];
  if (terminal.includes(current.session.status) && !terminal.includes(next.session.status)) return false;
  if (Number(current.session_revision || 0) > Number(next.session_revision || 0)) return false;
  return new Date(next.timing?.server_now || 0).getTime() >= new Date(current.timing?.server_now || 0).getTime();
}

export function clock(seconds) {
  const safe = Math.max(0, Math.floor(Number(seconds) || 0));
  const parts = [Math.floor(safe / 3600), Math.floor((safe % 3600) / 60), safe % 60];
  return (parts[0] ? parts : parts.slice(1)).map((value, index) =>
    index === 0 ? String(value) : String(value).padStart(2, "0")
  ).join(":");
}
