import { expect, test } from "@playwright/test";
import { fulfillAccessContract } from "./fixtures/productionApi.js";
async function mockAccount(page) {
  await page.route("**/api/v1/**", async(route)=>{
    const {pathname}=new URL(route.request().url());
    if(pathname==="/api/v1/auth/session") return route.fulfill({contentType:"application/json",body:JSON.stringify({user:{id:"knowledge-student",email:"student@example.test",full_name:"Student",username:"student",preferred_language:"ar",status:"active",is_email_verified:true,roles:["student"],date_joined:"2026-01-01T00:00:00Z"}})});
    if(pathname==="/api/v1/operations/session") return route.fulfill({status:403,contentType:"application/json",body:"{}"});
    if(await fulfillAccessContract(route,pathname)) return;
    if(pathname==="/api/v1/focus/lock-in") return route.fulfill({contentType:"application/json",body:JSON.stringify({active_session:null})});
    return route.fulfill({status:404,contentType:"application/json",body:"{}"});
  });
}
test("About and Support sections expose the official pages from settings",async({page}, testInfo)=>{
  await page.addInitScript(() => localStorage.setItem("lock-in.pwa-launch.dismissed-at", String(Date.now())));
  await mockAccount(page);
  await page.goto("/#/settings?section=about");
  await expect(page.locator("#settings-about")).toBeVisible();
  await expect(page.locator("#settings-about")).toContainText("دراستك. بتناغم.");
  await page.screenshot({ path: testInfo.outputPath("settings-about.png"), fullPage: true, animations: "disabled" });
  const about=page.locator("#settings-about").getByRole("link",{name:"تعرّف على Lockin",exact:true});
  await expect(about).toHaveAttribute("href","/about/");
  await about.click();
  await expect(page).toHaveURL(/\/about\/$/);
  await expect(page.getByRole("heading",{level:1})).toHaveText("دراستك. بتناغم.");
  await page.screenshot({ path: testInfo.outputPath("public-about.png"), fullPage: true, animations: "disabled" });
  await page.goto("/#/settings?section=support");
  await expect(page.locator("#settings-support")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("settings-support.png"), fullPage: true, animations: "disabled" });
  await expect(page.locator("#settings-support").getByRole("link",{name:"الإبلاغ عن مشكلة"})).toHaveAttribute("href","#/settings?section=suggest");
  await page.locator("#settings-support").getByRole("link",{name:"مركز مساعدة Lockin",exact:true}).click();
  await expect(page).toHaveURL(/\/help\/$/);
  await page.screenshot({ path: testInfo.outputPath("public-help.png"), fullPage: true, animations: "disabled" });
  await page.getByRole("link",{name:"كيف أبدأ Active Study؟",exact:true}).click();
  await expect(page).toHaveURL(/\/help\/start-active-study\/$/);
  await expect(page.getByRole("heading",{level:1})).toHaveText("كيف أبدأ Active Study؟");
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test("raw HTML remains public without account requests and withheld instructions never get indexed",async({request})=>{
  const sitemap=await request.get("/sitemap.xml"), xml=await sitemap.text();
  const paths=[...xml.matchAll(/<loc>https:\/\/lockin\.ly([^<]+)<\/loc>/g)].map((m)=>m[1]);
  expect(paths).toHaveLength(63);
  for(const path of paths){
    const response=await request.get(path,{headers:{"User-Agent":"OAI-SearchBot"}});
    expect(response.status()).toBe(200);
    expect(response.headers()["x-robots-tag"]).toContain("index, follow");
    const html=await response.text();
    expect(html).toContain("<h1");
    expect(html).not.toMatch(/id="root"|\/api\/v1\/|student@example/);
    expect(JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]+?)<\/script>/)[1])["@context"]).toBe("https://schema.org");
  }
  for(const path of ["/help/reset-password/","/features/flashcards/","/help/private/","/settings"]){
    const response=await request.get(path);
    expect(response.headers()["x-robots-tag"]).toContain("noindex");
  }
});
