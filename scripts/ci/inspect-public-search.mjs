import { resolve4, resolve6, resolveCname, resolveNs, resolveTxt } from "node:dns/promises";

const hostname = "lockin.ly";
const dns = await Promise.allSettled([
  resolveNs(hostname), resolve4(hostname), resolve6(hostname), resolveCname("www.lockin.ly"), resolveTxt(hostname)
]);
const value = (index) => dns[index].status === "fulfilled" ? dns[index].value : [];
const txt = value(4).map((parts) => parts.join(""));
console.log(JSON.stringify({
  check: "public-dns",
  hostname,
  nameservers: value(0),
  ipv4RecordCount: value(1).length,
  ipv6RecordCount: value(2).length,
  wwwCnameCount: value(3).length,
  txtRecordCount: txt.length,
  googleVerificationRecordPresent: txt.some((record) => record.startsWith("google-site-verification=")),
  errors: dns.map((result, index) => result.status === "rejected" ? { query: ["NS", "A", "AAAA", "www CNAME", "TXT"][index], code: result.reason.code || "lookup_failed" } : null).filter(Boolean)
}));

function publicRedirect(value) {
  if (!value) return null;
  try {
    const url = new URL(value, `https://${hostname}`);
    return `${url.origin}${url.pathname}`;
  } catch { return "invalid-location"; }
}

async function inspect(url, agent) {
  try {
    // No cookies, credentials, redirects, or authenticated endpoints.
    const response = await fetch(url, {
      headers: { "User-Agent": agent },
      redirect: "manual",
      signal: AbortSignal.timeout(15_000)
    });
    const body = await response.text();
    const pathname = new URL(url).pathname;
    const summary = {
      check: "public-http",
      url,
      agent,
      status: response.status,
      contentType: response.headers.get("content-type"),
      server: response.headers.get("server"),
      xRobotsTag: response.headers.get("x-robots-tag"),
      cfMitigated: response.headers.get("cf-mitigated"),
      location: publicRedirect(response.headers.get("location"))
    };
    if (pathname === "/robots.txt" && response.ok) {
      summary.robots = body.slice(0, 12_000).split("\n").filter((line) => /^\s*(?:User-agent|Allow|Disallow|Sitemap|Content-signal):/i.test(line)).map((line) => line.slice(0, 240));
    } else if (pathname === "/sitemap.xml" && response.ok) {
      const locations = [...body.matchAll(/<loc>([^<]+)<\/loc>/g)];
      summary.sitemapUrlCount = locations.length;
      // Summarize paths; do not print any user or document-specific URLs.
      summary.publicPagesIncluded = ["about", "medicine", "dentistry"].filter((slug) => body.includes(`https://lockin.ly/${slug}/`));
    } else if (response.ok && (response.headers.get("content-type") || "").includes("text/html")) {
      summary.title = body.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.slice(0, 200) || null;
      summary.robotsMeta = body.match(/<meta\b[^>]*name=["']robots["'][^>]*content=["']([^"']*)["']/i)?.[1] || null;
      summary.canonical = publicRedirect(body.match(/<link\b[^>]*rel=["']canonical["'][^>]*href=["']([^"']*)["']/i)?.[1]);
      summary.reactStartupShell = body.includes('id="root"') && body.includes("Opening your study room");
    }
    console.log(JSON.stringify(summary));
  } catch (error) {
    console.log(JSON.stringify({ check: "public-http", url, agent, error: error.cause?.code || error.name || "fetch_failed" }));
  }
}

for (const path of ["/", "/robots.txt", "/sitemap.xml", "/about/", "/medicine/", "/dentistry/"]) {
  await inspect(`https://${hostname}${path}`, "LockinPublicSearchAudit/1.0");
}
for (const agent of ["Googlebot", "Bingbot", "OAI-SearchBot", "PerplexityBot"]) {
  await inspect(`https://${hostname}/robots.txt`, agent);
}
await inspect("http://lockin.ly/", "LockinPublicSearchAudit/1.0");
await inspect("https://www.lockin.ly/", "LockinPublicSearchAudit/1.0");
console.log("Requests originate from a GitHub runner, not verified crawler IP ranges. These results cannot establish how verified bots are treated.");
