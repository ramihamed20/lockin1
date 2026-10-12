import { expect, test } from "@playwright/test";

const pages = ["about", "medicine", "dentistry"];

test("public search pages work without JavaScript, at phone and desktop widths", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
  try {
    const page = await context.newPage();
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      for (const slug of pages) {
        const response = await page.goto(`/${slug}/`);
        expect(response.status()).toBe(200);
        expect(response.headers()["x-robots-tag"]).not.toContain("noindex");
        await expect(page.locator("html")).toHaveAttribute("lang", "ar");
        await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await expect(page.getByRole("link", { name: "افتح بيئتك الدراسية" })).toHaveAttribute("href", "/#/");
        await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `https://lockin.ly/${slug}/`);
        await expect(page.locator('[itemtype="https://schema.org/Organization"]')).toContainText("ليبيا");
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      }
    }
    await page.goto("/about/");
    await page.getByRole("navigation", { name: "الصفحات العامة" }).getByRole("link", { name: "الطب البشري", exact: true }).click();
    await expect(page).toHaveURL(/\/medicine\/$/);
  } finally {
    await context.close();
  }
});

test("public routes normalize URLs, expose sitemap XML and keep private app responses noindex", async ({ request }) => {
  for (const slug of pages) {
    for (const path of [`/${slug}`, `/${slug}/index.html`]) {
      const response = await request.get(path, { maxRedirects: 0 });
      expect(response.status()).toBe(308);
      expect(response.headers().location).toBe(`/${slug}/`);
    }
  }
  const sitemap = await request.get("/sitemap.xml");
  expect(sitemap.headers()["content-type"]).toContain("application/xml");
  const xml = await sitemap.text();
  expect([...xml.matchAll(/<loc>/g)]).toHaveLength(pages.length);
  expect(xml).not.toMatch(/#|\/api\/|\/profile|\/materials/);
  for (const path of ["/", "/settings", "/about/private"]) {
    const response = await request.get(path);
    expect(response.headers()["x-robots-tag"]).toContain("noindex");
    expect(await response.text()).toContain('name="robots" content="noindex');
  }
});
