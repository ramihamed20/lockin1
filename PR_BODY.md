Five fixes from this session, merged into one branch. No product logic changed beyond what each item describes.

### What is in it
- **Admin sheet page count** - the Active Study field was `readOnly` whenever a PDF was attached, so it refused every keystroke on every device. The custom exclusion box also unmounted mid-typing because "custom" was re-derived from its own value.
- **Sign-in and create-account** - every failure now names its field and takes the caret there. Django's password rules reached the form under `non_field_errors`, where nothing could show them, leaving "The request could not be completed." as the whole explanation; the study path was seeded from `educationPathFor(undefined)`, so the form believed a college was already chosen while the select showed empty.
- **Email verification by code** - a six-digit code with a ten-minute life replaces the mailed link (Resend is unchanged; only the message body differs). One `autocomplete="one-time-code"` field, verified on the sixth digit, resend after sixty seconds held on the server too, and five wrong answers burn the code. The `/verify-email` route is gone; password reset and email change are still links.
- **Arabic, iPad, artwork** - the Arabic build declines Chrome's machine translation (English keeps it); the iPad rail scrolls to its last entry instead of clipping it and pushing the streak card off screen; dashboard cards sit in one scrollable row in portrait at exactly the width they had; Dawn and Sunset are framed 10% closer on the cat.
- **Streak** - checked, not changed: same-day activities count one day, redelivered events count once, a missed day ends the run while the best run stays, and the API returns what the model holds. Pinned in `apps/streaks/tests`.

### Verification
329 frontend unit tests, 183 backend tests across accounts/streaks/content/motivation, and the full 249-test browser suite (236 passed, 13 skipped) all green on the merge commit, with lint, typecheck and build clean on both sides. Flows were also driven by hand against a local Django backend on phone, iPad-portrait and desktop viewports, in Arabic and English.

Generated with [Claude Code](https://claude.com/claude-code)
