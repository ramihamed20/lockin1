# Lockin public search setup

## Source changes awaiting deployment

See [Public Knowledge](PUBLIC_KNOWLEDGE.md) and [Feature Inventory](PUBLIC_FEATURE_INVENTORY.md) for the current implementation and verification scope.

- 63 static Arabic RTL canonical pages: About, Medicine, Dentistry, five feature pages including the index, and Help with five category indexes and 49 individual guides.
- Settings exposes About and Support using existing navigation and components. Student study flows and account actions are unchanged.
- Each page has a unique title/description, canonical, social metadata and visible content in raw HTML. JSON-LD describes Organization, WebSite, WebPage and BreadcrumbList; About also describes WebApplication. Inert structured data adds no application JavaScript or relaxed CSP.
- Exact routes are generated together for sitemap, robots and both Nginx configurations. Public routes return HTML and canonical redirects; private application/API/file paths retain existing authentication and noindex behavior.
- Search crawlers include Googlebot, Bingbot and OAI-SearchBot. Existing GPTBot, ClaudeBot and Google-Extended training opt-outs are retained.
- llms.txt is an optional source directory, not a search eligibility requirement or ranking promise.
- The public knowledge source stays outside public/dist. It contains source evidence and review dates, never student records or secrets.
- The build refuses stale source hashes. Withdrawn guides are removed from published HTML, sitemap and public route grants. Required marketing capabilities also block release when withdrawn.

The root remains the private HashRouter application and retains noindex. Do not replace its routing or PWA behavior with a public homepage as part of this change.

## Account work completed earlier in this task

On 2026-10-12 Google Search Console ownership for lockin.ly and Bing Webmaster Tools ownership for https://lockin.ly/ were verified. Separate DNS-only verification records were added through Cloudflare. Existing site routing, proxy state and mail records were preserved.

Search crawler settings were inspected. No WAF, security-rule or model-training policy changes were applied.

## Production and indexing gate

The latest production audit still found a site-wide robots disallow, a sitemap path returning the SPA, and public paths served through the private app. Repository changes alone do not change these live responses.

Before requesting indexing:
1. Review the expanded draft PR and its passing validation.
2. Obtain explicit owner approval for the production release, as required by the user and repository AGENTS.md.
3. Use the repository's existing prebuilt-image deployment process; verify the deployed revision.
4. Run scripts/ci/public-search-smoke.sh against the deployed site and both representative search user agents.
5. Confirm sitemap XML lists only current public canonical pages, and login/dashboard/API/file responses retain their protections.
6. Submit https://lockin.ly/sitemap.xml in both verified webmaster properties, then inspect representative public URLs.

No sitemap was submitted while the live sitemap returned application HTML. There is no deployment approval or confirmed deployment access recorded for the expanded implementation.

robots.txt is a crawl instruction, not a privacy boundary. Existing application/API permissions and protected storage remain the data boundary.

## Verification

Run the commands documented in PUBLIC_KNOWLEDGE.md. Current results must be recorded for the expanded commit; earlier three-page CI results are historical.

Local WebKit tests emulate iPhone/iPad browser behavior. They do not certify a physical Apple device. Source and mocked-interface evidence cannot confirm production email delivery, subscriptions or published cohort content.

Password change/reset, email change, deletion and unlaunched feature instructions remain unpublished pending verification.

## Official references

- [Google AI search guidance](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide)
- [OpenAI crawler controls](https://developers.openai.com/api/docs/bots)
- [Google sitemap guidance](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)

Indexability and useful sources improve eligibility; no ranking, citation or recommendation is guaranteed.
