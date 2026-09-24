---
name: lockin-focus-pdf-guardian
description: Safely modify or debug Lock-in Focus Workspace, PDF reader, Active Study reader integration, annotations, zoom/pinch, persistence, editions, page navigation, and responsive touch behavior. Use for PDF.js, ContinuousA4Pdf, Focus, reader state, iPad/mobile interaction, or study-view regressions.
---

# Lock-in Focus/PDF Guardian

This is a high-regression surface. Preserve behavior deliberately.

## Core invariants

Unless the task explicitly changes them:
- first open starts at the intended initial page
- edition/view state does not leak into another edition/view
- reading state and annotations remain scoped correctly
- Active Study page restrictions remain authoritative
- checkpoint/question flow is not auto-opened by unrelated actions
- previous unlocked reading pages remain available as designed
- PDF navigation does not bypass study progression rules
- zoom/pinch behavior stays usable across phone/tablet/desktop
- desktop-only controls do not duplicate touch controls
- browser storage remains account/document/view scoped where applicable

## Before editing

1. Use `lockin-impact-mapper` if available.
2. Find the exact state owner:
   - component state
   - URL/router
   - persisted browser storage
   - backend resume state
   - edition resolver
   - PDF.js viewport/render state
3. Find existing regression tests before touching the implementation.
4. Reproduce or state a precise expected-vs-actual behavior.

Do not start by rewriting the large workspace/page component.

## Large-file discipline

Some reader/workspace files are large.

Use surgical edits:
- locate the specific state transition/helper
- extract only if extraction lowers risk
- preserve existing event order unless evidence requires change
- avoid broad formatting/refactor mixed with bug fixes
- compare diff size to requested behavior

## PDF.js rules

Be careful with:
- page indexes vs human page numbers
- async render cancellation
- stale render promises
- range requests
- document replacement
- scroll restoration
- scale/zoom state
- ResizeObserver/layout timing
- touch gesture state
- canvas lifecycle
- current-part restrictions

Do not solve a rendering race by adding arbitrary sleeps.

## Active Study integration

Trace:
difficulty/edition selection
→ resolved edition/document
→ effective page ranges
→ current part
→ reader page visibility/navigation
→ checkpoint availability
→ question progression
→ resume/persistence

When ranges/configuration change, check stale resumed state.

## Persistence

Before modifying keys or stored shape:
- identify current key scope
- preserve backward compatibility or provide migration/clear behavior
- prevent University/Lockin and study/summary state collision
- treat browser storage as untrusted

## Responsive/touch

For UI interaction changes, consider:
- phone portrait
- short landscape
- iPad/tablet portrait/landscape
- desktop
- touch vs mouse
- WebKit-specific gesture differences where the suite supports them

Do not "fix" tablet behavior by shrinking desktop CSS only.

## Validation

Use the narrowest relevant combination of:
- frontend unit tests
- reader/PDF tests
- Focus workspace tests
- zoom/pinch specs
- persistence/lifecycle specs
- responsive/iPad specs
- range-request specs
- RTL only if direction/layout can change

Use `lockin-test-selector` if available.

## Output

FOCUS/PDF RESULT
ROOT CAUSE: <evidence-based>
STATE OWNER: <where>
INVARIANTS PRESERVED: <list>
CHANGED SURFACE: <small set>
TESTS: <evidence>
CROSS-DEVICE RISK: <none/remaining>
