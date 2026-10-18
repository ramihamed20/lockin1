import { expect, test } from "@playwright/test";
import { fulfillAccessContract } from "./fixtures/productionApi.js";
import { signE2eLease } from "./fixtures/offlineLease.js";

// These tests verify public links, not PWA caching. Blocking service workers
// keeps WebKit API mocks active after returning from a static public page.
test.use({ serviceWorkers: "block" });
async function mockAccount(page) {
  await page.route("**/api/v1/**", async(route)=>{
    const {pathname}=new URL(route.request().url());
    if(pathname==="/api/v1/auth/session") return route.fulfill({contentType:"application/json",body:JSON.stringify({user:{id:"knowledge-student",email:"student@example.test",full_name:"Student",username:"student",preferred_language:"ar",status:"active",is_email_verified:true,roles:["student"],date_joined:"2026-01-01T00:00:00Z"}})});
    if(pathname==="/api/v1/offline/lease/") return route.fulfill({contentType:"application/json",body:JSON.stringify({lease:signE2eLease("knowledge-student")})});
    if(pathname==="/api/v1/offline/manifest/") return route.fulfill({contentType:"application/json",body:JSON.stringify({version:1,subjects:[],items:[]})});
    if(pathname==="/api/v1/catalog/materials" || pathname==="/api/v1/catalog/questions") return route.fulfill({contentType:"application/json",body:JSON.stringify({count:0,results:[]})});
    if(pathname==="/api/v1/operations/session") return route.fulfill({status:403,contentType:"application/json",body:"{}"});
    if(await fulfillAccessContract(route,pathname)) return;
    if(pathname==="/api/v1/focus/lock-in") return route.fulfill({contentType:"application/json",body:JSON.stringify({active_session:null})});
    return route.fulfill({status:404,contentType:"application/json",body:"{}"});
  });
}
test("About and Support sections expose the official pages from settings",async({page}, testInfo)=>{
  test.setTimeout(90000);
  await page.addInitScript(() => localStorage.setItem("lock-in.pwa-launch.dismissed-at", String(Date.now())));
  await mockAccount(page);
  await page.goto("/#/settings?section=about");
  await expect(page.locator("#settings-about")).toBeVisible();
  await expect(page.locator("#settings-about")).toContainText("دراستك. بتناغم.");
  await page.screenshot({ path: testInfo.outputPath("settings-about.png"), fullPage: false, animations: "disabled", scale: "css" });
  const about=page.locator("#settings-about").getByRole("link",{name:"تعرّف على Lockin",exact:true});
  await expect(about).toHaveAttribute("href","/about/");
  await about.click();
  await expect(page).toHaveURL(/\/about\/$/);
  await expect(page.getByRole("heading",{level:1})).toHaveText("دراستك. بتناغم.");
  await page.screenshot({ path: testInfo.outputPath("public-about.png"), fullPage: true, animations: "disabled", scale: "css" });
  await page.goto("/#/settings?section=support");
  await expect(page.locator("#settings-support")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("settings-support.png"), fullPage: false, animations: "disabled", scale: "css" });
  await expect(page.locator("#settings-support").getByRole("link",{name:"الإبلاغ عن مشكلة"})).toHaveAttribute("href","#/settings?section=suggest");
  await page.locator("#settings-support").getByRole("link",{name:"مركز مساعدة Lockin",exact:true}).click();
  await expect(page).toHaveURL(/\/help\/$/);
  await page.screenshot({ path: testInfo.outputPath("public-help.png"), fullPage: true, animations: "disabled", scale: "css" });
  await page.getByRole("link",{name:"كيف أبدأ Active Study؟",exact:true}).click();
  await expect(page).toHaveURL(/\/help\/start-active-study\/$/);
  await expect(page.getByRole("heading",{level:1})).toHaveText("كيف أبدأ Active Study؟");
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test("raw HTML remains public without account requests and withheld instructions never get indexed",async({request})=>{
  const sitemap=await request.get("/sitemap.xml"), xml=await sitemap.text();
  const paths=[...xml.matchAll(/<loc>https:\/\/lockin\.ly([^<]+)<\/loc>/g)].map((m)=>m[1]);
  expect(paths).toHaveLength(132);
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


test("public reading pages use the same design as existing settings and retain touch and keyboard access",async({page})=>{
  test.setTimeout(90000);
  await page.addInitScript(()=>localStorage.setItem("lock-in.pwa-launch.dismissed-at",String(Date.now())));
  await mockAccount(page);
  await page.goto("/#/settings?section=notifications");
  await expect(page.locator("#settings-notifications")).toBeVisible();
  const style=await page.evaluate(()=>{
    const body=getComputedStyle(document.body),label=getComputedStyle(document.querySelector("#settings-notifications .ui-row-body"));
    return {font:body.fontFamily,background:body.backgroundColor,text:body.color,labelSize:label.fontSize};
  });
  await page.goto("/help/");
  const publicStyle=await page.evaluate(()=>{
    const body=getComputedStyle(document.body),link=getComputedStyle(document.querySelector(".guide-list-title"));
    return {font:body.fontFamily,background:body.backgroundColor,text:body.color,labelSize:link.fontSize};
  });
  expect(publicStyle).toEqual(style);
  const link=page.locator(".guide-list a").first();
  await link.focus();
  await expect(link).toBeFocused();
  expect(await link.evaluate(el=>getComputedStyle(el).outlineStyle)).not.toBe("none");
  expect((await link.boundingBox()).height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
