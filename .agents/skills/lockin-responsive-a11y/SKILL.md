---
name: lockin-responsive-a11y
description: Review and validate Lock-in UI changes across phone, tablet/iPad, desktop, landscape, Arabic RTL, keyboard, touch, and accessibility. Use for layout, sidebar, navigation, controls, dialogs, responsive CSS, or interaction-state work.
---

# Lock-in Responsive & Accessibility Guardian

Responsive behavior is structural, not desktop scaled down.

## Viewport matrix

Choose relevant targets rather than testing everything blindly:
- narrow phone
- normal phone
- short landscape
- tablet/iPad portrait
- tablet/iPad landscape
- desktop
- wide desktop when layout can stretch

## Interaction matrix

As relevant:
- touch
- mouse
- keyboard
- focus-visible
- screen-reader labels/semantics
- reduced motion

## Checks

Look for:
- horizontal overflow
- clipped controls
- fixed elements covering content
- unusable sticky/floating UI
- touch targets too small
- inaccessible icon-only buttons
- focus lost in dialogs/drawers
- keyboard traps
- hidden content still focusable
- incorrect RTL order/alignment
- duplicate desktop/mobile controls
- viewport-height bugs on mobile browsers

## RTL

Prefer logical properties and direction-aware layout.
Do not mirror educational content that must preserve its own direction.

## CSS discipline

Before adding another breakpoint:
- inspect existing responsive layers
- identify the rule actually winning
- avoid specificity escalation
- preserve cascade order

## Playwright

Use the smallest relevant existing specs:
- viewport shell
- responsive regressions
- iPad/sidebar/dashboard
- touch targets
- RTL
- keyboard
- interaction states
- Focus responsive specs when applicable

Screenshots can support evidence but do not replace behavioral assertions.

## Output

RESPONSIVE/A11Y RESULT
VIEWPORTS: <tested>
INPUTS: <touch/mouse/keyboard>
RTL: <result>
OVERFLOW: <result>
A11Y: <result>
TESTS: <evidence>
REMAINING DEVICE RISK: <if any>
