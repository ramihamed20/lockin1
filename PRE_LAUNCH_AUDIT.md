# Pre-Launch Audit — Dentify / Lock-in

Audit scope: read-only review of the frontend, Django backend, PWA setup, deployment configuration, security controls, accessibility patterns, routes, and launch documentation. No application files were changed as part of the audit.

## Launch Readiness Summary

**Score: 62/100 — not ready for a public production launch yet.**

- **P0 issues:** 2
- **P1 issues:** 11
- Local frontend tests: **63/63 passed**.
- Production Django validation correctly refuses to run without production secrets, which is expected.

### Top five fixes before launch

1. Fix the production build/CI mismatch: production Compose and CI expect a `frontend/Dockerfile` and npm scripts that are absent.
2. Prove a production-equivalent deployment: staging release, HTTPS, restore drill, monitoring, and rollback path.
3. Publish real Privacy Policy, Terms, and a user-visible support contact.
4. Add deployed edge security headers, especially CSP and Permissions Policy; complete malware scanning for creator uploads.
5. Make the private SPA explicitly non-indexable, then complete real iPhone/iPad/Safari and accessibility testing.

### Product context

This is a private PWA learning platform for dental/university students. It provides authenticated learning materials, focus sessions, quizzes, community features, creator/moderator/admin tooling, and a Django API. It is not currently a public marketing, local-business, or e-commerce website. Production configuration requires `PAYMENT_PROVIDER=none`; a real payment provider is not currently enabled.

### Checklist items clearly not needed now

Opening hours, maps/directions, tap-to-call, LocalBusiness schema, dedicated service pages, before/after galleries, testimonials, case studies, team photos, response-time promises, and payment/refund marketing content while payments remain disabled.

## Checklist Audit

| # | Item | Status | Priority | Existing? | Recommendation |
|---:|---|---|---|---|---|
| 1 | sitemap.xml | NOT RELEVANT | — | No | Do not create one for a private hash-routed app. |
| 2 | Rich tooltips | OPTIONAL | P3 | Partial | Add only where icon-only controls need clarification. |
| 3 | Canonical tags | NOT RELEVANT | — | No | No indexable pathname pages currently exist. |
| 4 | Site favicon | ALREADY IMPLEMENTED | P3 | Yes | PWA/browser/Apple icon metadata is present. |
| 5 | Tap-to-call phone number | NOT RELEVANT | — | No | No physical/local-service contact model. |
| 6 | Clear form error messages | ALREADY IMPLEMENTED | P2 | Yes | Authentication forms expose field and summary errors. |
| 7 | Opening hours | NOT RELEVANT | — | No | Not a visitable local business. |
| 8 | Google Search Console readiness | NOT RELEVANT | — | No | Relevant only after adding public acquisition pages. |
| 9 | Blog posts/content strategy | NOT RELEVANT | — | No | Not needed to launch the private learning application. |
| 10 | About page / brand story | NOT RELEVANT | — | No | Not required for the product workflow. |
| 11 | Before-and-after gallery | NOT RELEVANT | — | No | Does not suit this product. |
| 12 | Dedicated page per service | NOT RELEVANT | — | No | This is not a service-business site. |
| 13 | Visible contact email | REQUIRED BEFORE LAUNCH | P1 | No | Add a real support/contact route or email for users and legal notices. |
| 14 | Working social links | NOT RELEVANT | — | No | No social presence is represented in the product. |
| 15 | Properly compressed/responsive images | IMPLEMENTED BUT NEEDS IMPROVEMENT | P2 | Partial | Good AVIF/WebP usage in places; audit remaining large PNGs and store imagery. |
| 16 | Cookie consent | NOT RELEVANT | — | No | No third-party analytics/tracking was found; disclose essential auth cookies in Privacy Policy. |
| 17 | llms.txt | NOT RELEVANT | — | No | No public documentation corpus to expose. |
| 18 | Terms of Service page | REQUIRED BEFORE LAUNCH | P1 | No | Registration records policy acceptance but no policy page is linked. |
| 19 | Clear payment methods | NOT RELEVANT | — | No | Production configuration requires `PAYMENT_PROVIDER=none`. |
| 20 | Guarantee/refund statement | NOT RELEVANT | — | No | Required only when subscriptions/payments are truly enabled. |
| 21 | Custom 404 / Not Found page | IMPLEMENTED BUT NEEDS IMPROVEMENT | P2 | Partial | Authenticated users receive a Not Found page; unknown unauthenticated hash routes lead to auth. |
| 22 | Primary CTA above the fold | NOT RELEVANT | — | Partial | Login/sign-up are already the application’s primary actions. |
| 23 | Internal linking | ALREADY IMPLEMENTED | P3 | Yes | App navigation, cards, and route links cover product navigation. |
| 24 | Thank-you / success page after important forms | ALREADY IMPLEMENTED | P3 | Yes | Account flows provide in-context success/error feedback; separate pages are unnecessary. |
| 25 | Breadcrumb navigation | NOT RELEVANT | — | No | Would add noise to the focused application UI. |
| 26 | Case studies | NOT RELEVANT | — | No | Do not manufacture marketing proof. |
| 27 | FAQ section | NOT RELEVANT | — | No | Add help content only after observing real support needs. |
| 28 | Response-time promise | NOT RELEVANT | — | No | Not appropriate without an operational support commitment. |
| 29 | Sticky mobile CTA | NOT RELEVANT | — | No | Mobile navigation already occupies this interaction space. |
| 30 | robots.txt | REQUIRED BEFORE LAUNCH | P1 | No | Explicitly prevent search indexing of the private login shell and app. |
| 31 | Unique page titles | IMPLEMENTED BUT NEEDS IMPROVEMENT | P2 | Partial | Route titles exist, but brand naming mixes Dentify/Lock-in and titles are not SEO metadata. |
| 32 | Meta descriptions | IMPLEMENTED BUT NEEDS IMPROVEMENT | P2 | Partial | Only static root metadata exists; private routes should not be search targets. |
| 33 | Social sharing / Open Graph images | OPTIONAL | P3 | Partial | Basic OG text exists; add images only for future public pages. |
| 34 | Maps and directions | NOT RELEVANT | — | No | No user visit/location workflow. |
| 35 | Real reviews/testimonials | NOT RELEVANT | — | No | Do not add fake social proof. |
| 36 | Alt text on meaningful images | IMPLEMENTED BUT NEEDS IMPROVEMENT | P2 | Partial | Most UI imagery is handled well; audit dynamic material/creator media before launch. |
| 37 | Relevant Schema.org structured data | NOT RELEVANT | — | No | Private learning routes should not emit public structured data. |
| 38 | Privacy Policy page | REQUIRED BEFORE LAUNCH | P1 | No | Needed for student/user data, auth cookies, email, uploads, and community data. |
| 39 | Privacy-conscious analytics | RECOMMENDED | P1 | No | Add minimal error monitoring/operational telemetry with a disclosed retention policy. |
| 40 | Team photo / team section | NOT RELEVANT | — | No | No launch need for a private product. |

## P0 Findings

### 1. Production build configuration is internally inconsistent

`compose.production.yaml` and the GitHub Actions workflow expect a frontend Docker build context and `frontend/Dockerfile`, but that Dockerfile is absent. CI also calls `test:coverage`, `check:bundle`, and `test:e2e`; those scripts are not defined in `frontend/package.json`.

**Required change:** reconcile Docker locations and package scripts, then run the full CI pipeline successfully from a clean checkout before launch.

### 2. A production-equivalent release has not been proven

The launch TODO still records staging deployment, real TLS renewal, restore-drill, monitoring, and production upload-scanner work as incomplete. The source has strong production settings, but the deployed system must be validated rather than inferred from code.

**Required change:** complete and document a staging release rehearsal, HTTPS verification, migrations, backup restore, rollback, monitoring, and alerting.

## P1 Findings

### Legal, privacy, and support

Registration records policy acceptance, but users cannot inspect linked Terms or Privacy Policy. Publish real, reviewed policy pages; version them; link them from registration/settings; and add a genuine support contact route or email.

### Private-app indexing policy

The frontend uses `HashRouter`; routes after `#` are not crawler URLs, and the application is authentication-gated. Add a conservative `robots.txt` and `noindex` policy for the root/login shell. Do not add a sitemap for this application.

### Security headers

Django production settings include HTTPS-only host cookies, HSTS, CSRF origins, and secret handling. The current Nginx deployment template does not show CSP or Permissions Policy.

**Required change:** configure and validate CSP, Permissions Policy, frame protection, and related headers in deployed responses. Account for Google Fonts or self-host fonts.

### Creator uploads

The platform is designed to fail closed until scan-clean evidence exists, but actual malware-scanning integration remains incomplete. This matters because creators can upload content.

**Required change:** complete scanning, size/type enforcement, retention rules, and authorization checks before enabling public creator uploads.

### Accessibility bypass mechanism

The frontend tests explicitly assert that a skip-to-content control is absent. Persistent sidebar/navigation controls make a visible-on-focus “Skip to main content” link important for keyboard users.

**Required change:** add a semantic skip link and validate keyboard focus order across student and admin surfaces.

### Device and browser sign-off

Safe-area support, touch sizing, focus containment, and responsive CSS are implemented in source. Complete acceptance testing on real 320px phones, 375–430px phones, iPad portrait/landscape, Safari iOS, Chrome Android, and desktop keyboard navigation.

### Backups, monitoring, and privacy-conscious telemetry

There is recovery intent but no evidence of a successful production-like restore drill. Add a restoration test for database and media, and adopt minimal error/uptime/performance monitoring with documented retention and access controls. Google Analytics is not mandatory.

## Implemented but Needs Improvement

### Images

Responsive AVIF/WebP patterns exist, but several large PNG originals remain in `frontend/public`. Use responsive variants consistently, especially store/hero assets, and constrain dynamic creator content dimensions with appropriate alt text.

### Not Found behavior

An authenticated in-app Not Found state exists. Unknown unauthenticated hash routes are instead routed to authentication. This is not an SEO issue, but should be refined for clearer user feedback.

### Metadata and branding

Route titles are updated client-side and the root HTML contains static metadata. Keep titles for usability, unify the Dentify/Lock-in brand, and defer route-level public SEO until actual public pages exist.

### Performance and offline behavior

Route-level lazy loading and PWA cache boundaries are sensible. The service worker intentionally avoids caching private API data. Establish a production performance budget and measure Core Web Vitals with material/PDF-heavy usage. Clarify that installation does not provide full offline study access.

## Missing Items Not Included in the Original Checklist

- **Service-worker update UX:** validate that auto-updates do not interrupt quizzes or focus sessions without warning.
- **Error monitoring and alerting:** error boundaries and safe API error normalization exist, but deployed monitoring is not confirmed.
- **Brand consistency:** product strings mix Dentify and Lock-in.
- **Release governance:** require a green CI build, dependency review, migration plan, rollback procedure, and signed production checklist.

## SEO & Indexing Plan

| Route/category | Index | Sitemap | Canonical | Access | Reason |
|---|---|---|---|---|---|
| `/` and `/#/` authentication shell | Noindex | No | No | Public login only | Entry point, not public discovery content. |
| `/#/verify-email`, `/#/confirm-email`, `/#/reset-password` | Noindex | No | No | Token/unauthenticated flows | Sensitive transactional routes. |
| Student routes: dashboard, materials, questions, focus, profile, settings, progress, community | Noindex | No | No | Authenticated | Private user/product data and hash-only routing. |
| Creator, moderator, admin, operations routes | Noindex | No | No | Role-protected | Privileged operational interfaces. |
| In-app Not Found route | Noindex | No | No | Contextual | Not public content. |
| `/api/v1/*`, Django admin, health/readiness | Noindex | No | No | Protected/operational | Never expose APIs or operational endpoints to search. |
| Manifest, service worker, icons, static assets | Noindex | No | No | Static | Not documents for search engines. |
| Future public marketing/docs pages | Index | Yes | Yes | Public | Add standard metadata only if these pages are deliberately built. |

## Recommended Implementation Order

### Phase 1 — Launch blockers

1. Repair the frontend Docker/CI contract and run it successfully.
2. Complete a production-equivalent staging deployment and release rehearsal.
3. Verify HTTPS, migration, rollback, backups, and restoration.
4. Complete malware scanning before enabling creator uploads.

### Phase 2 — Important before public launch

1. Publish linked Terms, Privacy Policy, and support contact details.
2. Add private-app noindex/robots policy.
3. Configure and verify CSP, Permissions Policy, and edge headers.
4. Add a skip link; complete keyboard, contrast, screen-reader, Safari/iOS, and iPad acceptance testing.
5. Establish error monitoring, uptime alerts, and performance measurements.

### Phase 3 — Post-launch improvements

1. Optimize remaining large/raster assets and responsive image delivery.
2. Improve authenticated-route Not Found behavior.
3. Unify Dentify/Lock-in naming.
4. Refine PWA update messaging and offline expectations.
5. Consider self-hosting fonts.

### Phase 4 — Optional growth/marketing features

1. Build separate public marketing pages only if acquisition becomes a goal.
2. Then add sitemap, canonical metadata, OG images, Search Console, and relevant SoftwareApplication/Course schema.
3. Add FAQ/help content only from real user-support patterns.

## Final Verdict

The codebase has a strong foundation: authenticated API boundaries, CSRF handling, rate limiting, production-oriented Django settings, PWA icons/manifest, lazy routes, error states, and passing local frontend tests.

It is **not reasonable to launch publicly today** because production build/release evidence is incomplete, legal/support surfaces are missing, upload scanning is unfinished, and deployed security/accessibility/device validation remains outstanding.

**Must fix first:** the Docker/CI mismatch, production staging/recovery proof, legal/support pages, security headers/upload scanning, private indexing policy, and keyboard/mobile-device acceptance testing.

Ignore the local-business and generic marketing checklist items unless you deliberately introduce public marketing pages or real paid subscriptions.
