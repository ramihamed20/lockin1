# Focus Workspace — Real Device Checklist

A 15–30 minute manual pass. Automated coverage runs on Chromium and WebKit
engines only; **nothing below has been verified on physical hardware.** Pressure,
tilt, palm rejection, and true multi-touch cannot be simulated, so this pass is
the gate for the areas marked **(hardware only)**.

## How to run it

1. Build and serve the app, then open a catalogue sheet and choose **Normal Study**.
2. Work top to bottom. Tick Pass or Fail, and write what you actually saw.
3. Stop and record anything that loses ink — that is the only category that
   blocks launch on its own.

Legend: **P** = pass, **F** = fail.

---

## A. iPad + Apple Pencil

| # | Action | Expected | P/F | Notes |
|---|--------|----------|-----|-------|
| A1 | Write a sentence at a normal pace with the Pencil | Ink follows the tip with no perceptible lag; no gaps or white specks inside strokes | | |
| A2 | Write as fast as you can for ~10 seconds | Strokes stay connected; no dropped segments; no stair-stepping | | |
| A3 | **(hardware only)** Press hard, then very lightly, with the Fountain and Brush pens | Stroke width visibly follows pressure; light touch never disappears entirely | | |
| A4 | **(hardware only)** Tilt the Pencil while drawing with Pencil profile | Stroke widens slightly with tilt; no jitter or flicker | | |
| A5 | **(hardware only)** Rest your palm on the glass, then write | Palm produces no ink and no page movement; writing is unaffected | | |
| A6 | Rest palm, then lift Pencil and immediately tap with one finger | Finger tap does not draw (Apple Pencil mode on) | | |
| A7 | With Pencil hovering, drag one finger | Page scrolls; no ink appears | | |
| A8 | Two-finger drag while the Pencil is near the screen | Page pans smoothly; the in-progress stroke, if any, is kept, not discarded | | |
| A9 | Pinch to zoom in and out repeatedly | Zoom follows both fingers continuously; the point under your fingers stays put | | |
| A10 | Pinch far past maximum zoom, then release | Resists, then springs back smoothly to the limit; no jump, no stuck transform | | |
| A11 | Pinch far past minimum zoom, then release | Same resistance and spring-back; the page never ends up smaller than the reader | | |
| A12 | Start a pinch *while* drawing a stroke | The stroke is kept (not lost); pinch takes over cleanly; no stuck "springing" state | | |
| A13 | Erase across several strokes with the Precision eraser | Only what the eraser touched is removed; untouched ink is byte-identical | | |
| A14 | Undo the erase | One undo restores every affected stroke exactly | | |
| A15 | Lasso a group, then use Copy / Duplicate / Rotate / Delete from the menu | Every menu button responds to a **tap** (not just a stylus click) | | |
| A16 | With a selection active, open the Lasso tool options and pick a colour | The whole selection recolours; undo reverts it | | |
| A17 | Add a custom colour, then delete it | Exactly one colour is added; the Add button disappears at 10; deletion frees a slot | | |
| A18 | Adjust Thickness and Opacity sliders with the Pencil and with a finger | Both are easy to hit and update the live preview | | |
| A19 | Tap the page chip, type a page number, press Go | The reader jumps there and the chip updates | | |
| A20 | Rotate the iPad between portrait and landscape | The page refits to width; no gesture stays stuck; the palette stays on screen | | |
| A21 | Switch to another app for ~30s and come back | Workspace resumes; no stuck drawing state; ink intact | | |
| A22 | Write for 10+ minutes across several pages, then close and reopen the sheet | Every mark is still there, on the right pages, at the right position | | |
| A23 | **(hardware only)** Repeat A22 with ~500+ strokes on one page | Drawing still feels immediate; no growing lag as the page fills | | |

## B. iPhone (Safari)

| # | Action | Expected | P/F | Notes |
|---|--------|----------|-----|-------|
| B1 | One-finger drag on the page | Scrolls; no accidental ink | | |
| B2 | Turn on finger drawing in settings, then draw | Finger draws; one-finger scroll no longer draws over the page | | |
| B3 | Pinch zoom, then pan a zoomed page | Both follow the fingers; the page never escapes the reader | | |
| B4 | Double-tap the page | Zooms in, then back out on a second double-tap | | |
| B5 | Open the page chip and use −/＋/Fit width | Zoom steps predictably; Fit width fills the reader with no side gaps | | |
| B6 | Open the toolbar and scroll it sideways | Every tool is reachable; nothing is clipped behind the notch or home bar | | |
| B7 | Open Workspace settings and scroll to the bottom | The whole panel is reachable; the bottom is not under the browser bar | | |
| B8 | Type into the page-number field | The keyboard opens; typing digits does not switch tools or change page | | |
| B9 | Open the notes drawer and type a note | The keyboard does not cover the Save button; the note saves to the right page | | |
| B10 | Rotate to landscape | Toolbar shrinks but stays usable; the page dock does not overlap the checkpoint button | | |
| B11 | Install to the home screen and reopen (PWA) | Opens standalone; safe areas respected; ink from the browser session is present | | |
| B12 | In the PWA, draw, then swipe away the app and reopen | The last strokes are still there | | |

## C. Android phone (Chrome)

| # | Action | Expected | P/F | Notes |
|---|--------|----------|-----|-------|
| C1 | One-finger scroll and fling | Scrolls with momentum; stops cleanly at the ends | | |
| C2 | Pinch zoom in and out | Continuous; no snapping to preset levels | | |
| C3 | Pinch past the limits and release | Rubber-bands, then settles back | | |
| C4 | Draw with a finger (finger drawing on) | Ink appears immediately and stays after release | | |
| C5 | Tap toolbar buttons and the selection menu | Every button responds to the first tap | | |
| C6 | Use the on-screen keyboard in the page field and the note field | No shortcut hijacking; fields behave normally | | |
| C7 | Switch apps and return | No stuck gesture; ink intact | | |
| C8 | Install as a PWA and repeat C1–C4 | Same behaviour standalone | | |
| C9 | Turn off the network, draw, then turn it back on | Drawing keeps working; marks persist; no error screen | | |

## D. Android tablet

| # | Action | Expected | P/F | Notes |
|---|--------|----------|-----|-------|
| D1 | Portrait: draw, erase, undo, redo | All behave as on the iPad | | |
| D2 | Landscape: repeat D1 | Layout adapts; palette stays on screen | | |
| D3 | Two- and three-finger gestures during drawing | Extra fingers never create ink; the active stroke is not lost | | |
| D4 | **(hardware only)** With an active stylus (S Pen or similar): pressure and palm rejection | Pressure varies width; palm does not draw | | |
| D5 | Rotate while zoomed in | Refits to width; no stuck transform | | |

## E. Data safety (run on at least one device)

| # | Action | Expected | P/F | Notes |
|---|--------|----------|-----|-------|
| E1 | Draw, then immediately tap Exit Workspace (within ~1s) | Reopening the sheet shows the last stroke | | |
| E2 | Draw, then background the app immediately | Same: nothing is lost | | |
| E3 | Settings → Export marks and notes | A `lock-in-<material>-<sheet>-<date>.json` file is saved | | |
| E4 | Clear ink on page, then Restore from that backup | The cleared marks come back; a second restore adds nothing | | |
| E5 | Restore a backup taken on a *different* sheet | A confirmation appears first; Cancel changes nothing | | |
| E6 | Sign out, sign in as another account, open the same sheet | The second account sees an empty sheet; the first account's marks return on switching back | | |
| E7 | Fill a page with many strokes over a long session | No "out of space" warning appears | | |

---

## Reporting

For every **F**, record: device and OS version, browser, what you did, what
happened, and whether any ink was lost. Anything in section E that fails should
be treated as a launch blocker.
