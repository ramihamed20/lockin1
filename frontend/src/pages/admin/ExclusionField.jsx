import { useState } from "react";

/** First/last excluded pages, shared by Active Study settings and All Questions. */
export function ExclusionField({ label, value, onChange, error = "" }) {
  // "Custom" is a mode the admin chose, not something re-derived from the value on
  // every render: deriving it meant clearing the box (or typing a value a preset
  // covers) unmounted the input mid-keystroke and snapped the select back.
  const numeric = Number(value || 0);
  const [custom, setCustom] = useState(() => !(value !== "" && [0, 1, 2, 3].includes(numeric)));
  const preset = custom ? "custom" : String([0, 1, 2, 3].includes(numeric) ? numeric : 0);
  function choosePreset(next) {
    if (next === "custom") { setCustom(true); return; }
    setCustom(false); onChange(Number(next));
  }
  return <label className="field"><span>{label}</span><select value={preset} onChange={(event) => choosePreset(event.target.value)}><option value="0">None</option><option value="1">1 page</option><option value="2">2 pages</option><option value="3">3 pages</option><option value="custom">Custom</option></select>{custom && <input type="number" inputMode="numeric" min="0" max="9999" step="1" value={value} required aria-label={`${label}, custom page count`} onChange={(event) => onChange(event.target.value)} placeholder="Pages" />}{error && <small className="form-alert error" role="alert">{error}</small>}</label>;
}
