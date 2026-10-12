import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const pages = ["about", "medicine", "dentistry"];
const readPublic = (path) => readFile(new URL(`../public/${path}`, import.meta.url), "utf8");

function robotGroups(source) {
  const groups = [];
  let group;
  for (const raw of source.split("\n")) {
    const line = raw.split("#", 1)[0].trim();
    if (!line) continue;
    const colon = line.indexOf(":");
    const key = line.slice(0, colon).toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key === "user-agent") {
      if (!group || group.rules.length) {
        group = { agents: [], rules: [] };
        groups.push(group);
      }
      group.agents.push(value.toLowerCase());
    } else if (group && (key === "allow" || key === "disallow")) {
      group.rules.push({ allow: key === "allow", path: value });
    }
  }
  return groups;
}

function canCrawl(groups, agent, path) {
  const exact = groups.filter((group) => group.agents.includes(agent.toLowerCase()));
  const selected = exact.length ? exact : groups.filter((group) => group.agents.includes("*"));
  const matches = selected.flatMap((group) => group.rules).filter((rule) => {
    if (!rule.path) return false;
    return rule.path.endsWith("$") ? path === rule.path.slice(0, -1) : path.startsWith(rule.path);
  });
  matches.sort((left, right) => right.path.replace(/\$$/, "").length - left.path.replace(/\$$/, "").length || Number(right.allow) - Number(left.allow));
  return matches[0]?.allow ?? true;
}

test("search crawlers can read public information but cannot crawl private or unexpected routes", async () => {
  const groups = robotGroups(await readPublic("robots.txt"));
  for (const agent of ["Googlebot", "Bingbot", "Applebot", "OAI-SearchBot", "PerplexityBot", "Claude-SearchBot", "SomeOtherBot"]) {
    for (const page of pages) assert.equal(canCrawl(groups, agent, `/${page}/`), true, `${agent}: ${page}`);
    for (const path of ["/", "/api/v1/files/document", "/settings", "/profile", "/admin/", "/operations/", "/materials/", "/media/document.pdf", "/about/private", "/medicine/student", "/dentistry/index.html"]) {
      assert.equal(canCrawl(groups, agent, path), false, `${agent}: ${path}`);
    }
    assert.equal(canCrawl(groups, agent, "/public-search.css"), true);
    assert.equal(canCrawl(groups, agent, "/icons/lockin-light-512-v2.png"), true);
  }
  for (const agent of ["GPTBot", "ClaudeBot", "Google-Extended"]) {
    for (const page of pages) assert.equal(canCrawl(groups, agent, `/${page}/`), false);
  }
});

test("sitemap contains only canonical public pages and each is useful HTML without JavaScript", async () => {
  const sitemap = await readPublic("sitemap.xml");
  const locations = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  assert.deepEqual(locations, pages.map((page) => `https://lockin.ly/${page}/`));
  const titles = new Set();
  const descriptions = new Set();
  for (const page of pages) {
    const html = await readPublic(`${page}/index.html`);
    assert.match(html, /<html lang="ar" dir="rtl">/);
    assert.match(html, /<meta name="robots" content="index, follow/);
    assert.doesNotMatch(html, /noindex|<script\b|id="root"|api\/v1/);
    assert.ok(html.includes(`<link rel="canonical" href="https://lockin.ly/${page}/" />`));
    assert.match(html, /itemtype="https:\/\/schema.org\/WebPage"/);
    assert.match(html, /itemtype="https:\/\/schema.org\/Organization"/);
    assert.match(html, /itemprop="areaServed">ليبيا/);
    assert.match(html, /الطب البشري/);
    assert.match(html, /طب الأسنان/);
    assert.equal([...html.matchAll(/<h1\b/g)].length, 1);
    assert.ok([...html.matchAll(/<p\b/g)].length >= 4);
    titles.add(html.match(/<title>([^<]+)<\/title>/)[1]);
    descriptions.add(html.match(/<meta name="description" content="([^"]+)"/)[1]);
    for (const other of pages) assert.ok(html.includes(`href="/${other}/"`));
  }
  assert.equal(titles.size, pages.length);
  assert.equal(descriptions.size, pages.length);
  assert.match(await readPublic("robots.txt"), /Sitemap: https:\/\/lockin.ly\/sitemap.xml/);
});

test("the authenticated app remains noindex and exposes a public-information link", async () => {
  const [shell, auth] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../src/components/auth/AuthPage.jsx", import.meta.url), "utf8")
  ]);
  assert.match(shell, /name="robots" content="noindex, nofollow, noarchive"/);
  assert.doesNotMatch(shell, /rel="canonical"/);
  assert.match(auth, /href="\/about\/"/);
});
