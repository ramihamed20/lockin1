# Focus Workspace — stylus compatibility QA

The goal is *capability-based input*, not a hardcoded list of "supported tablets".
A pen that a browser reports as `pointerType="pen"` uses pen-only mode. Passive
capacitive pens may be indistinguishable from fingers and require touch-compatible
drawing; this sacrifices automatic finger-vs-pen palm rejection.

## Browser probe (Settings → Drawing → Test your pen)

1. Tap the test button with the actual stylus rather than a finger.
2. If detected as **pen**, keep **Active pen only** enabled and check that one
   finger scrolls, two fingers pinch, and the stylus draws.
3. If detected as **touch** or unknown, use **Enable regular-pen compatibility**,
   select Pen, write, and scroll/zoom with two fingers. Do not claim the software
   can reject the palm of a passive capacitive stylus.
4. If detected as **mouse**, test drawing directly; mouse input draws even in
   pen-only mode.
5. Reopen the sheet and verify the student's chosen mode persists. Check that
   pen and highlighter strokes save, undo, and reappear after reload.

## Physical-device matrix (not yet tested)

| Device or pen | Expected path | Must verify physically |
|---|---|---|
| OSCAL Elite 1 bundled stylus | Touch-compatible if Android exposes Elite 1; probe otherwise | Actual pointer type, ink, two-finger pinch |
| Samsung Galaxy Tab S Pen | Active pen if reported as pen; probe otherwise | Pen drawing, finger scrolling, palm contact |
| Apple iPad with Apple Pencil | Active pen if reported as pen; probe otherwise | Safari + PWA ink, zoom, pressure where available |
| Xiaomi Pad + Focus Pen | Active pen if reported as pen; probe otherwise | Chrome ink, pressure where exposed |
| Lenovo Tab + Tab Pen / Precision Pen | Active pen if reported as pen; probe otherwise | Ink, palm contact, pressure/tilt where exposed |
| Huawei MatePad + M-Pencil | Active pen if reported as pen; probe otherwise | Ink and touch vs pen classification in browser |
| Passive capacitive stylus on any touch tablet | Student-enabled touch-compatible drawing | Writing, two-finger gestures, no false palm rejection claims |
| Desktop mouse / trackpad | Mouse support | Ink and pointer capture still work |

## Regression checklist

- Pen-only: touch must pan and not draw; a pen must draw; pinch must work.
- Touch-compatible: one contact draws with Pen selected; two contacts pinch
  instead of leaving ink or permanently locking scrolling.
- Unknown or empty pointerType: treat as touch-like for gesture tracking rather
  than blindly treating it as a mouse.
- Ignore large palm contacts when a real pen pointer is active, if the browser
  exposes enough contact geometry.
- A selected user preference always wins over Elite 1 auto-detection.
- Input probe does not collect identifiers, persist hardware data, or transmit
  pointer events.
- Verify with physical hardware: synthetic PointerEvents and unit tests cannot
  confirm any vendor's browser/firmware behavior.

Technical basis: Pointer Events pointerType, contact geometry, pressure, tilt,
coalesced events, and CSS touch-action; features vary by browser and device.
