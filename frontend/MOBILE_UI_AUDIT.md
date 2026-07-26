# Mobile UI/UX Audit

## Scope and method

This audit covers the replacement React frontend while signed in as Student, Creator, and Admin. The visual system, component language, themes, and desktop layouts were retained.

Live-browser checks used the running local application at `http://127.0.0.1:5050/` with its Django API. The required 320px and 390px viewports were exercised against the live DOM, not inferred from source. Additional core-route checks used 360px, 375px, 414px, 430px, tablet portrait (768x1024), and tablet landscape (1024x768). iPhone 13 and Pixel 5 touch/device emulation were also run in Chromium.

## Route checklist

| Area | Routes checked at 320px and 390px | Result |
| --- | --- | --- |
| Student | `/`, `/materials`, `/questions`, `/review`, `/search`, `/ranked`, `/analytics`, `/bookmarks`, `/progress`, `/achievements`, `/notifications`, `/profile`, `/settings`, `/community` | No document-level horizontal overflow in 28 checks. |
| Student dynamic views | `/questions/quizzes/:quizId`, `/focus/:documentVersionId` | No document-level overflow; Focus toolbar, document area, sheet states, and session controls inspected interactively. |
| Creator | `/creator`, `/creator/education`, `/creator/content`, `/creator/questions`, `/creator/quizzes` | No document-level horizontal overflow in 10 checks. |
| Admin | `/operations/admin/overview`, `/users`, `/purchases`, `/subscriptions`, `/notifications`, `/reports`, `/audit`, `/settings`, `/system`, `/exports` | No document-level horizontal overflow in 20 checks. Admin records use responsive operation rows/cards rather than HTML tables. |
| Core viewport matrix | Student dashboard, quiz, Focus; Creator education; Admin users | No document-level overflow at 320, 360, 375, 390, 414, 430, 768x1024, or 1024x768. |

The 58 static navigation route/viewport checks above all had `scrollWidth === viewport width`. The Analytics route intentionally displayed its existing backend-unavailable state; that state fitted the viewport. Creator Quizzes was also allowed to settle before checking its loaded state.

## Findings and disposition

| Severity | Affected routes | Finding and root cause | Shared component or area | Resolution |
| --- | --- | --- | --- | --- |
| Critical | All routes on iPhone/browser zoom | The viewport tag disabled user zoom with `maximum-scale=1,user-scalable=no`, which blocked a key mobile accessibility behavior. | `index.html` | Removed the zoom restriction and added `viewport-fit=cover`. |
| Major | Student dashboard and any page using `StatsGrid` on narrow phones | The metric strip retained a horizontal card layout; the final card was partially off-screen at 320px. | `.stats-grid` | Reflows to readable grid cards: one column at <=374px, two columns otherwise, with a lone final card spanning the row. |
| Major | Focus Workspace | The phone header horizontally scrolled pause/resume/leave controls, making important session controls undiscoverable. | `FocusPdfWorkspace`, `.pdf-workspace-header` | Session actions, zoom, undo/redo, and completion action now have contained mobile grid rows; all visible controls meet the 44px height target. |
| Major | Focus Workspace | The annotation sheet inherited desktop row layout, making its contents wider than the viewport (up to 480px at a 390px viewport). The collapsed sheet could expose off-screen content. | `.pdf-study-sidebar` | Phone sheet is width-contained, vertically scrollable, starts closed, and lays tools into touch-safe grids. No expanded-tool horizontal overflow remains at 320px or 390px. |
| Major | Bookmark removal, assessment submission, and all `ConfirmDialog` callers | Confirmation dialogs did not lock background scrolling, retain focus, or guarantee a viewport-contained action area. | `ConfirmDialog` | Added scroll lock, initial focus, Tab cycle, Escape close, focus restoration, dialog semantics, and stacked 48px mobile actions. |
| Moderate | Creator and Admin action rows; Focus duration selectors; mobile tabs | Compact actions were commonly 36-38px high. | `.btn.compact`, tabs, duration options, checklist rows | Shared mobile minimum height is now 44px without changing desktop spacing. |
| Moderate | Admin/Creator long IDs, user details, records, errors | Long values could force a flex item beyond its container in record/detail layouts. | Shared operation/detail classes | Added targeted `min-width: 0` and safe wrapping; no global typography reduction. |
| Moderate | Focus Workspace | Header could shrink below its contents as a flex item and overlap its sync notice/document. | `.pdf-workspace-header`, viewer | Header no longer shrinks; the viewer uses a bounded scrolling region. |

## Behavior checks

- Mobile navigation drawer: opened at 320px, locked background scrolling, kept the close control reachable, and closed after route navigation to Materials.
- Dialog: opened a real bookmark removal confirmation at 320px; it was contained within 16px side margins, locked page scroll, closed on Escape, and returned focus to the triggering action.
- Admin empty state: a server-side no-match search rendered “No users found” at 320px without overflow; its search field was 48px high and fully contained.
- Forms: Student Profile, Student Settings, and Admin Settings fields were inspected at 320px; no visible field crossed the viewport. Multi-column form content is stacked by the existing mobile rules.
- Focus: collapsed and expanded tool sheets were tested at 320px and 390px. The document remains scrollable above the sheet, the toggle remains 44px and reachable, and the expanded sheet has no horizontal overflow.
- Assessment: the real quiz detail view was inspected at 320px and 390px. Its question-count controls, server-authoritative messaging, and start action fit the screen. The active-attempt answer component was source-audited for 52px answer targets and wrapped option text; no non-destructive active demo attempt was available to mutate.
- Tables: the current Admin surface does not render desktop `<table>` elements. It uses responsive operation rows/cards, so no unreadable shrunken table was found.

## Accessibility and device notes

- The app now allows browser zoom and preserves the iPhone safe-area viewport declaration.
- Reduced-motion behavior and visible focus styles already existed and remain intact.
- iPhone 13 and Pixel 5 touch emulation in Chromium confirmed no overflow on Dashboard and Focus in portrait. iPhone landscape emulation was also checked for horizontal overflow.
- Native WebKit Safari on physical iOS hardware was not available in this Windows workspace. This is a validation-environment limitation, not a known layout defect; final release verification should include a physical iPhone Safari pass, especially with the on-screen keyboard open and system large-text settings enabled.

## Deliberately preserved behavior

No product feature was removed or simulated. Existing backend-unavailable messaging (for example, Analytics) remains explicit and fits mobile width. The frontend continues to treat Django as authoritative for assessment answers, results, progress, Focus state, and administrative actions.
