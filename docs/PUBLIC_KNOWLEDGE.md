# Lockin public knowledge and search

Lockin's public information is static Arabic HTML with an exact route allowlist. The application remains a private HashRouter entry. Public pages do not request the API or contain student documents, answers, profiles or annotations.

## Editorial contract
Use the owner-approved identity: Lockin, a connected study ecosystem for currently supported human medicine and dentistry study paths in Libya. About opens with “دراستك. بتناغم.” / “Everything in sync.”. Feature claims are qualified by published content, cohort and access requirements.

The About and Support sections of Settings link to the public pages. Existing account, appearance, notifications, offline, feedback and update sections retain their behavior. Public About stays concise; detailed information lives in feature pages and Help.

## Source of truth
- `frontend/content/public-knowledge.json`: 22 reviewed capabilities, 49 publishable Q&A entries and 8 withheld drafts. Each entry records availability, source URL, date, evidence paths, steps and alternative phrasings. It is not copied into the public output.
- `frontend/scripts/build-public-knowledge.mjs`: deterministic HTML, canonical metadata, JSON-LD, exact routes, robots, sitemap and optional llms.txt.
- Generated HTML is checked in so raw HTML can be reviewed and rendered before a client bundle executes.
- `frontend/public/public-search-routes.json`: generated canonical paths. The E2E static server uses this exact list.
- The same route list generates both supported Nginx configurations. Location-level header overrides are avoided so private and public security headers inherit normally.
- Vite runs the generator in check mode before any build. Drift in source evidence, generated HTML or server routes blocks the build.

## Re-verification when the product changes
Evidence digests normalize line endings and identify the exact reviewed source. Changing a watched file names the affected entries with `needs_verification`. Full-file hashes intentionally err toward review rather than silently publishing stale steps; unrelated edits in a watched file can also require review.

Do not refresh digests automatically. Inspect the changed capability, test its actual user path and update the answer, availability, evidence digest and Last Verified only after review. A source hash proves freshness against reviewed code, not live production functionality. Outbound email and production content availability need separate checks.

To withhold an answer, set its status to `needs_verification`; it must not be in the generated sitemap or public links. Password reset/change, email change, final account deletion, Flashcards, Pomodoro, oral tests and live study groups are withheld in the initial registry. “My Group” is a timetable, not evidence of a live study group. Rank, community and study plan are coming soon in the product registry.

Commands, from `frontend/`:
```sh
node scripts/build-public-knowledge.mjs
node scripts/build-public-knowledge.mjs --check
node --test tests/public-search.test.js
pnpm build
pnpm exec playwright install chromium webkit
pnpm exec playwright test --config playwright.public.config.js
```

## Coverage and deployment
63 canonical pages: 3 product/audience pages, a feature index and 4 feature pages, Help, 5 Help topic directories and 49 direct-answer pages. Eight pending questions have no public page. Existing training opt-outs are preserved. Search agents can crawl only exact public URLs and rendering resources.

Browser coverage includes no-JavaScript HTML, raw HTTP, canonical redirects, JSON-LD parsing, internal links, private noindex, Settings navigation, desktop Chromium and iPhone/iPad WebKit emulation. Emulation is not physical Safari-device certification. Both image-runtime smoke checks probe representative feature/Help pages and sitemap XML.

No screenshots of production student accounts or materials are included. Screenshots of test layouts may be used for review; no fabricated product image is presented as a real student screen.

## Search accounts
Google Search Console Domain property and Bing site ownership were verified on 2026-10-12 using independent DNS-only verification records. Existing origin, proxy and mail records were preserved. Inspected Cloudflare search crawler policies allowed the relevant agents; no WAF or bot policy was changed.

Production still served a blocked robots policy and SPA HTML at sitemap.xml at the last live inspection. Sitemap submission and indexing requests are deferred until the tested version is approved, deployed and checked at the real domain. Do not imply account verification equals indexing.

## Deployment acceptance
- Explicit owner approval and valid deployment access.
- Successful CI for the final reviewed head, including both actual Nginx runtimes.
- Live raw HTML and headers on all canonical public URLs; valid application/xml sitemap and correct robots.
- Private routes and protected files keep authentication/authorization and noindex.
- Submit https://lockin.ly/sitemap.xml in the verified Google and Bing properties, then inspect public URLs.
- Field check delivery/recovery before publishing the pending account instructions.

No database, product-study flow, payment policy or model-training consent change is part of this work.

## Official references
- [Google AI search guidance](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide): indexed useful HTML is the foundation; structured data matches visible content.
- [Google documentation updates](https://developers.google.com/search/updates): do not promise FAQ rich results. These pages use WebPage/BreadcrumbList, with Organization/WebSite and a matching WebApplication on About, rather than QAPage or rich-result promises.
- [OpenAI crawlers](https://developers.openai.com/api/docs/bots): OAI-SearchBot and GPTBot are separate controls.
- [Cloudflare bot controls](https://developers.cloudflare.com/ai-crawl-control/configuration/ai-crawl-control-with-bots/).

llms.txt is an optional source index, not an indexing substitute or appearance guarantee.

## Image build source evidence

Both image builders mount the complete repository context read-only during the Vite build using LOCKIN_PUBLIC_EVIDENCE_ROOT. Missing or changed source still fails the build; there is no skip-validation switch. Source evidence is not copied into runtime layers or public output.

Build the separate edge image from the repository root with docker build -f frontend/Dockerfile [approved build arguments] .; Compose and CI use this same context. Root .dockerignore excludes nested local environment files. The image layer probe supplies only explicit source evidence and applies the same build-only prerequisite to historical comparison images.

The freshness gate runs for builds, tests and the knowledge CLI. Development Vite startup does not require backend files inside the frontend development container.

## Presentation alignment — 2026-10-13

The public pages now share a generated, byte-identical copy of src/styles/tokens.css with the application. Builds check this copy, robots permits this exact CSS resource, and the Nginx smoke verifies its MIME type. Compact reading widths, neutral grouped links, current navigation and capsule actions follow Lock-in V2. About/Support use existing Settings rows and icons, with Study and Help/contact groups. Product copy, public URLs and availability are unchanged. The i18n source digest was reviewed after adding four group-label translations only; all existing translated controls remain byte-for-byte unchanged.

## Development routing — 2026-10-13

Vite development now serves the published public route allowlist before its SPA fallback. Previously /about/ and /help/ returned the private app shell and re-ran account bootstrap; the production-only HTTP tests missed this. The dev handler returns the original static HTML (GET/HEAD), normalizes published aliases, fails missing public files closed and leaves private/app/API routing untouched. tests/public-knowledge-dev.test.js starts the actual Vite config and checks all published pages plus private fallback and CSS.
