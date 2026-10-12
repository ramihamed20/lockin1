import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { buildPublicFiles, knowledge, pruneWithdrawnPages, verifyKnowledgeEvidence, writePublicKnowledge } from "../scripts/build-public-knowledge.mjs";
const { paths: pages } = buildPublicFiles();
const readPublic = (path) => readFile(new URL("../public/" + path, import.meta.url), "utf8");
function robotGroups(source) {
  const groups=[]; let group;
  for(const raw of source.split("\n")) {
    const line=raw.split("#",1)[0].trim(); if(!line) continue;
    const colon=line.indexOf(":"), key=line.slice(0,colon).toLowerCase(), value=line.slice(colon+1).trim();
    if(key==="user-agent") { if(!group || group.rules.length){group={agents:[],rules:[]};groups.push(group);}group.agents.push(value.toLowerCase()); }
    else if(group && ["allow","disallow"].includes(key)) group.rules.push({allow:key==="allow",path:value});
  }
  return groups;
}
function canCrawl(groups,agent,path) {
  const exact=groups.filter((group)=>group.agents.includes(agent.toLowerCase()));
  const selected=exact.length?exact:groups.filter((group)=>group.agents.includes("*"));
  const matches=selected.flatMap((group)=>group.rules).filter((rule)=>rule.path && (rule.path.endsWith("$")?path===rule.path.slice(0,-1):path.startsWith(rule.path)));
  matches.sort((a,b)=>b.path.replace(/\$$/,"").length-a.path.replace(/\$$/,"").length || Number(b.allow)-Number(a.allow));
  return matches[0]?.allow??true;
}
test("only exact published URLs are crawlable; private paths and training opt-out stay protected",async()=>{
  const groups=robotGroups(await readPublic("robots.txt"));
  for(const agent of ["Googlebot","Bingbot","Applebot","OAI-SearchBot","PerplexityBot","Claude-SearchBot","OtherBot"]){
    for(const path of pages) assert.equal(canCrawl(groups,agent,path),true,agent+": "+path);
    for(const path of ["/","/api/v1/files/document","/settings","/profile","/admin/","/operations/","/materials/","/media/document.pdf","/about/private","/help/reset-password/","/help/private/","/features/flashcards/","/features/notes/index.html"]){
      assert.equal(canCrawl(groups,agent,path),false,agent+": "+path);
    }
    assert.equal(canCrawl(groups,agent,"/public-search.css"),true);
    assert.equal(canCrawl(groups,agent,"/llms.txt"),true);
  }
  for(const agent of ["GPTBot","ClaudeBot","Google-Extended"]) for(const path of pages) assert.equal(canCrawl(groups,agent,path),false);
});
test("generated pages, sitemap, canonical URLs and JSON-LD have one consistent public source",async()=>{
  const xml=await readPublic("sitemap.xml");
  assert.deepEqual([...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m)=>m[1]),pages.map((path)=>"https://lockin.ly"+path));
  const titles=new Set(), descriptions=new Set();
  for(const path of pages){
    const html=await readPublic(path.slice(1)+"index.html");
    assert.match(html,/<html lang="ar" dir="rtl">/);
    assert.match(html,/name="robots" content="index, follow/);
    assert.doesNotMatch(html,/noindex|id="root"|api\/v1|<script(?! type="application\/ld\+json")/);
    assert.ok(html.includes('rel="canonical" href="https://lockin.ly'+path+'"'));
    assert.equal([...html.matchAll(/<h1\b/g)].length,1);
    const title=html.match(/<title>([^<]+)<\/title>/)[1], description=html.match(/name="description" content="([^"]+)"/)[1];
    titles.add(title);descriptions.add(description);
    const ld=JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]+?)<\/script>/)[1]);
    assert.equal(ld["@context"],"https://schema.org");
    const webPage=ld["@graph"].find((item)=>item["@type"]==="WebPage");
    assert.equal(webPage.url,"https://lockin.ly"+path);assert.equal(webPage.name,title);
    const crumbs=ld["@graph"].find((item)=>item["@type"]==="BreadcrumbList").itemListElement;
    assert.equal(crumbs.at(-1).item,"https://lockin.ly"+path);
    for(const match of html.matchAll(/href="(\/[^"]*)"/g)){
      const target=match[1];
      if(target.startsWith("/#/") || target.startsWith("/icons/") || target==="/public-search.css") continue;
      assert.ok(pages.includes(target),path+": broken link "+target);
    }
  }
  assert.equal(titles.size,pages.length);assert.equal(descriptions.size,pages.length);
  assert.doesNotThrow(()=>writePublicKnowledge({check:true}));
});
test("public answers have explicit evidence and withholding is enforced",()=>{
  assert.ok(knowledge.questions.length>=40 && knowledge.questions.length<=60);
  assert.equal(new Set(knowledge.questions.map((item)=>item.id)).size,knowledge.questions.length);
  for(const item of knowledge.questions){
    assert.equal(item.publicSourceUrl,"https://lockin.ly/help/"+item.id+"/");
    assert.ok(item.shortAnswer && item.lastVerified && item.keywords.length);
    assert.ok(item.verificationEvidence.length);
    assert.ok(knowledge.features.find((feature)=>feature.id===item.relatedFeature).publicDocumentable);
  }
  for(const item of knowledge.pendingQuestions) assert.ok(!pages.includes("/help/"+item.id+"/"));
  const source=Object.keys(knowledge.evidenceDigests)[0], saved=knowledge.evidenceDigests[source];
  try { knowledge.evidenceDigests[source]="changed";assert.throws(verifyKnowledgeEvidence,/needs_verification/); }
  finally { knowledge.evidenceDigests[source]=saved; }
});
test("app remains noindex and About/Support are reachable through settings",async()=>{
  const [shell,settings,links,auth]=await Promise.all([
    readFile(new URL("../index.html",import.meta.url),"utf8"),
    readFile(new URL("../src/pages/Settings.jsx",import.meta.url),"utf8"),
    readFile(new URL("../src/pages/PublicKnowledgeSettings.jsx",import.meta.url),"utf8"),
    readFile(new URL("../src/components/auth/AuthPage.jsx",import.meta.url),"utf8")
  ]);
  assert.match(shell,/name="robots" content="noindex, nofollow, noarchive"/);
  assert.doesNotMatch(shell,/rel="canonical"/);
  assert.match(settings,/id: "about"/);assert.match(settings,/id: "support"/);
  assert.match(links,/"\/about\/"/);assert.match(links,/"\/help\/"/);
  assert.match(auth,/href="\/about\/"/);
});

test("withdrawing a verified guide removes its old public HTML and rejects unsafe paths",()=>{
  const root=mkdtempSync(join(tmpdir(),"lockin-public-retirement-"));
  const guide=join(root,"help","retired-guide");
  mkdirSync(guide,{recursive:true});
  writeFileSync(join(guide,"index.html"),"withdrawn guide");
  try {
    assert.throws(()=>pruneWithdrawnPages(root,["/help/retired-guide/"],[],true),/Withdrawn guide/);
    pruneWithdrawnPages(root,["/help/retired-guide/"],[]);
    assert.equal(existsSync(join(guide,"index.html")),false);
    assert.throws(()=>pruneWithdrawnPages(root,["/../../private/"],[]),/Invalid previous/);
  } finally { rmdirSync(guide);rmdirSync(join(root,"help"));rmdirSync(root); }
  const item=knowledge.features.find((entry)=>entry.id==="notes"), saved=item.publicDocumentable;
  try { item.publicDocumentable=false;assert.throws(verifyKnowledgeEvidence,/review marketing copy/); }
  finally { item.publicDocumentable=saved; }
});
