# Lockin public search setup

## Implemented source changes

Lockin is a connected study environment, currently available to human medicine
and dentistry students in Libya. Public copy explains the problem of fragmented
study and the connection between understanding and review; it does not promise
grades, institution coverage, or unavailable features.

- `https://lockin.ly/about/`: brand and problem/solution explanation.
- `https://lockin.ly/medicine/`: context for human medicine students.
- `https://lockin.ly/dentistry/`: context for dentistry students.
- Each is static Arabic RTL HTML, with unique title/description, canonical,
  social metadata and Schema.org WebPage/WebSite/Organization microdata.
  Microdata preserves the strict script CSP without inline scripts or new dependencies.
- `/robots.txt` allows only those exact public page paths, their public
  presentation resources, robots and sitemap for search crawlers.
- OAI-SearchBot, Googlebot, Bingbot, Applebot, PerplexityBot and Claude-SearchBot
  share the same restricted public crawl policy. The previous model-training
  opt-out stays in place for GPTBot, ClaudeBot and Google-Extended.
- `/sitemap.xml` contains only the three public canonical URLs. No invented
  lastmod dates or private material/account URLs.
- Both production Nginx configurations lift X-Robots-Tag noindex only on the
  exact public page allowlist. Inherited security headers, API proxying,
  streaming, private-file delivery and admin closure stay in place.
- The root is still the private HashRouter app entry, with noindex in both HTML
  and HTTP headers. Its metadata now describes both supported study paths and
  sign-in includes an ordinary link to the public about page. No authenticated
  navigation, OAuth, session, or PWA caching behavior is changed.

The public pages are the search entry points. Do not change the root canonical
to /about/, remove the app's noindex globally, or index hash routes. A future
public homepage needs a separately tested plan for existing PWA and hash URLs.

Robots restrictions alone do not prevent a URL-only search result and are not
authorization. Application/API authentication, authorization and private storage
remain the actual data boundary. Do not expose API data, user names, learning
progress, files, account tokens or billing in public HTML or sitemaps.

## Evidence and limits

Changes were prepared through the connected GitHub repository because the local
shell and browser runtime failed to start (sandbox helper setup error).
The public web fetcher also could not retrieve lockin.ly, HTTP/www variants,
robots or sitemap. This is not evidence of an outage or a Cloudflare block.
It remains necessary to compare deployed source and inspect live HTTP headers.

Validation included in the PR:

- Node tests: crawler policy for search/training agents and unknown/private paths;
  canonical sitemap and complete static HTML; private shell noindex.
- Playwright: no-JavaScript content, public navigation, 390/1280px overflow,
  redirects, XML MIME and private response noindex.
- Real image smoke probes in both existing VPS edge-runtime and managed
  container-runtime jobs: public HTML/indexing headers, retained security
  headers, sitemap/robots MIME and content, redirects, private noindex.
- Existing repository lint/type/build/PWA/auth/security gates remain required.

Do not describe tests as passing until the checks for the PR commit finish.
Do not merge or deploy with failing or incomplete production gates.

## Account work after a tested staging/production release

Nothing in this file claims domain verification, sitemap submission or indexing.
No verification value has been generated or guessed.

1. Open Google Search Console with the owner's intended Google account.
   Add a Domain property `lockin.ly` if it does not already exist. Obtain the
   exact DNS verification value from its interface. Add that TXT record in
   Cloudflare without replacing any existing TXT, A/AAAA/CNAME, MX, NS, or TLS
   configuration; keep it for continued verification. Verify via the interface.
2. Submit `https://lockin.ly/sitemap.xml`. Inspect the three canonical public
   URLs using the live test and request indexing after their actual 200 HTML,
   canonical and noindex absence are confirmed. Record the submission result.
3. Open Bing Webmaster Tools with the intended Microsoft account. Import the
   verified Search Console property only after the owner completes any account
   consent screen, or use Bing's exact DNS/meta/XML verification method.
   Submit the same sitemap and run URL Inspection. Record the result.
4. Inspect Cloudflare DNS, crawler request logs, AI Crawl Control, Block AI Bots,
   custom WAF rules, managed robots rules, Bot Fight Mode and challenge settings.
   Confirm root robots.txt is the expected version and the public paths return
   HTML, not a challenge, to verified Google/Bing/OpenAI/Perplexity search bots.
   Correlate user agents with verified-bot identity or current official IP
   ranges; a user-agent string alone is not authentication.
5. If an actual edge rule blocks a search crawler, make the narrowest justified
   public-path exception. Do not disable the WAF, bot protection, access control
   or rate limits globally. Do not bypass authentication for private paths.
   Cloudflare account access and live evidence are required before altering rules.
6. Preserve the existing domain/TLS/redirect service. Inspect apex/www records
   and redirects before normalizing hostnames; never invent or replace the origin.

Account consent/sign-in steps must be handled in the available account interface.
Record each completed step separately from pending work. Search eligibility does
not guarantee indexing, ranking, or inclusion in an AI answer.

## Official references

- OpenAI crawlers: https://developers.openai.com/api/docs/bots
- Google AI features: https://developers.google.com/search/docs/appearance/ai-features
- Google noindex: https://developers.google.com/search/docs/crawling-indexing/block-indexing
- Google property setup: https://support.google.com/webmasters/answer/34592
- Bing site verification: https://www.bing.com/webmasters/help/add-and-verify-site-12184f8b
- Cloudflare AI Crawl Control: https://developers.cloudflare.com/ai-crawl-control/configuration/ai-crawl-control-with-bots/
- Perplexity crawlers: https://docs.perplexity.ai/docs/resources/perplexity-crawlers
- Anthropic crawlers: https://privacy.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler
