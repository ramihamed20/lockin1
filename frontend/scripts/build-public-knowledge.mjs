import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
export const frontendRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));
const repoRoot = resolve(process.env.LOCKIN_PUBLIC_EVIDENCE_ROOT || resolve(frontendRoot, "..")), publicRoot = resolve(frontendRoot, "public"), origin = "https://lockin.ly";
export const knowledge = JSON.parse(readFileSync(resolve(frontendRoot, "content/public-knowledge.json"), "utf8").replace(/^\uFEFF/, ""));
const tokenCss = readFileSync(resolve(frontendRoot, "src/styles/tokens.css"), "utf8").replace(/\r\n/g, "\n");
const themeColor = tokenCss.match(/--bg:\s*(#[a-f0-9]+)/i)[1];
const esc = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const feature = (id) => knowledge.features.find((entry) => entry.id === id);
const link = (path, text) => '<a href="' + esc(path) + '">' + esc(text) + "</a>";
const section = (title, paragraphs) => '<section class="story"><h2>' + esc(title) + '</h2><div>' + paragraphs.map((text) => "<p>" + esc(text) + "</p>").join("") + "</div></section>";
export function verifyKnowledgeEvidence() {
  const errors = [];
  const digests = new Map();
  for (const id of ["notes", "active-study", "review", "questions"]) {
    if (!feature(id)?.publicDocumentable) errors.push(id + ": review marketing copy before withdrawing this feature");
  }
  for (const entry of [...knowledge.features.filter((item) => item.publicDocumentable), ...knowledge.questions.filter((item) => item.status === "published")]) {
    const paths = entry.evidence || entry.verificationEvidence;
    if (!paths?.length || !entry.lastVerified) errors.push(entry.id + ": missing verification");
    for (const path of paths || []) {
      const absolute = resolve(repoRoot, path);
      if (!absolute.startsWith(repoRoot + sep) || !existsSync(absolute)) { errors.push(entry.id + ": evidence missing: " + path); continue; }
      if (!digests.has(path)) digests.set(path, createHash("sha256").update(readFileSync(absolute, "utf8").replace(/\r\n/g, "\n")).digest("hex"));
      const sha = digests.get(path);
      if (knowledge.evidenceDigests[path] !== sha) errors.push(entry.id + ": needs_verification: " + path);
    }
    if (entry.status === "published" && !feature(entry.relatedFeature)?.publicDocumentable) errors.push(entry.id + ": feature cannot be published");
  }
  if (errors.length) throw new Error("Public knowledge is stale. Re-test and review affected entries before publishing; do not blindly refresh hashes.\n" + [...new Set(errors)].join("\n"));
}
// English edition: same pages under /en/, translated from the reviewed Arabic source.
export const english = JSON.parse(readFileSync(resolve(frontendRoot, "content/public-knowledge.en.json"), "utf8").replace(/^﻿/, ""));
export const LOCALES = ["ar", "en"];
const localize = (path, lang) => (lang === "en" && path.startsWith("/") && !path.startsWith("/#") ? "/en" + path : path);
// The spellings students actually type for the brand, in both scripts.
const brandSpellings = ["Lock-in", "لوك إن"];
// Official profiles that speak for Lockin; search engines use them to confirm the brand.
const officialProfiles = ["https://t.me/lock_in_official"];
const UI = {
  ar: {
    dir: "rtl", ogLocale: "ar_LY", arrow: "←", chevron: "m15 18-6-6 6-6",
    navLabel: "الصفحات العامة", nav: { about: "عن Lockin", medicine: "الطب البشري", dentistry: "طب الأسنان", features: "الميزات", help: "الدعم" },
    language: "English", languageLabel: "Read this page in English", telegram: "قناة Lockin على تلغرام",
    footerDescription: "بيئة دراسية مترابطة لطلبة الطب البشري وطب الأسنان في", footerCountry: "ليبيا", footerLabel: "معلومات الحساب",
    footerLinks: { help: "مركز المساعدة", terms: "الشروط", privacy: "الخصوصية", support: "التواصل والدعم", app: "الدخول إلى Lockin" },
    skip: "انتقل إلى المحتوى", breadcrumbsLabel: "مسار الصفحة", start: "ابدأ الدراسة", logoAlt: "شعار Lockin",
    appDescription: "بيئة دراسية مترابطة لطلبة الطب البشري وطب الأسنان في ليبيا.",
    steps: "الخطوات", availability: "الإتاحة", verified: "آخر مراجعة للدليل:", openApp: "افتح Lockin", relatedGuides: "أدلة مرتبطة", relatedQuestions: "أسئلة مرتبطة",
    howTo: "طريقة الاستخدام", forAccount: "حسب ما يتاح لحسابك.", features: "الميزات", helpCenter: "مركز المساعدة", startHere: "ابدأ من هنا", helpEyebrow: "Lockin Help",
    topicTitleSuffix: " | مركز مساعدة Lockin", topicDescriptionSuffix: " أدلة رسمية مختصرة لاستخدام Lockin.", guideTitleSuffix: " | مساعدة Lockin",
    discover: "تعرّف على بيئتك الدراسية.", discoverFeatures: ["أدوات تعمل مع بعض", "كيف ترتبط القراءة بالملاحظات والأسئلة والمراجعة."], discoverHelp: ["كل إجابة. في مكانها.", "أدلة الاستخدام والمساعدة."],
    llmsSummary: "بيئة دراسية مترابطة لطلبة الطب البشري وطب الأسنان في ليبيا، ضمن المسارات والمحتوى المدعومين.", llmsSources: "المصادر الرسمية", llmsQuestions: "أسئلة وأجوبة",
    llmsNote: "الفهرس مساعد اختياري. صفحات HTML هي المصدر؛ لا يشمل ملفات الطلاب أو حساباتهم. لا يثبت الفهرس ترتيبًا أو توصية من أي محرك بحث."
  },
  en: { ...english.ui, dir: "ltr", ogLocale: "en_US", arrow: "→", chevron: "m9 18 6-6-6-6" }
};
const list = (entries, lang) => '<ul class="guide-list">' + entries.map(([path, title, detail]) => '<li><a href="' + esc(path) + '" aria-label="' + esc(title) + '"><span class="guide-list-body"><span class="guide-list-title">' + esc(title) + '</span>' + (detail ? '<span class="guide-list-summary">' + esc(detail) + '</span>' : '') + '</span><svg class="guide-chevron" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + UI[lang].chevron + '"/></svg></a></li>').join("") + "</ul>";
const sections = (items) => items.map(([title, paragraphs]) => section(title, paragraphs)).join("");
const nav = (page, lang) => {
  const ui = UI[lang], other = lang === "ar" ? "en" : "ar";
  const items = [["/about/", ui.nav.about], ["/medicine/", ui.nav.medicine], ["/dentistry/", ui.nav.dentistry], ["/features/", ui.nav.features], ["/help/", ui.nav.help]];
  return '<nav aria-label="' + esc(ui.navLabel) + '">' + items.map(([path, title]) => '<a href="' + localize(path, lang) + '"' + (page.key === path || page.key.startsWith(path) ? ' aria-current="page"' : '') + '>' + esc(title) + '</a>').join("") + '<a href="' + localize(page.key, other) + '" hreflang="' + other + '" lang="' + other + '" dir="' + UI[other].dir + '" aria-label="' + esc(ui.languageLabel) + '">' + esc(ui.language) + "</a></nav>";
};
const footer = (lang) => {
  const ui = UI[lang];
  return '<footer class="site-footer"><div itemscope itemtype="https://schema.org/Organization"><a itemprop="url" href="' + localize("/about/", lang) + '"><span itemprop="name" lang="en" dir="ltr">Lockin</span></a><span itemprop="description">' + esc(ui.footerDescription) + ' <span itemprop="areaServed">' + esc(ui.footerCountry) + '</span>.</span></div><nav aria-label="' + esc(ui.footerLabel) + '">' + [[localize("/help/", lang), ui.footerLinks.help], ["/#/terms", ui.footerLinks.terms], ["/#/privacy", ui.footerLinks.privacy], ["/#/support", ui.footerLinks.support], ["/#/", ui.footerLinks.app]].map(([path, text]) => link(path, text)).join("") + '<a href="' + officialProfiles[0] + '" rel="me noopener">' + esc(ui.telegram) + "</a></nav></footer>";
};
function renderPage(page, lang) {
  const ui = UI[lang];
  const url = origin + page.path;
  const alternates = LOCALES.map((code) => [code, origin + localize(page.key, code)]);
  const crumbs = [{ name: "Lockin", path: localize("/about/", lang) }, ...(page.crumbs || [])];
  if (page.key !== "/about/") crumbs.push({ name: page.heading, path: page.path });
  const graph = [
    { "@type": "Organization", "@id": origin + "/#organization", name: "Lockin", alternateName: brandSpellings, url: origin + "/about/", sameAs: officialProfiles, logo: origin + "/icons/lockin-light-512-v2.png", areaServed: { "@type": "Country", name: "Libya" } },
    { "@type": "WebSite", "@id": origin + "/#website", name: "Lockin", alternateName: brandSpellings, url: origin + "/about/", inLanguage: LOCALES, publisher: { "@id": origin + "/#organization" } },
    { "@type": "BreadcrumbList", "@id": url + "#breadcrumb", itemListElement: crumbs.map((item, index) => ({ "@type": "ListItem", position: index + 1, name: item.name, item: origin + item.path })) },
    { "@type": "WebPage", "@id": url + "#page", url, name: page.title, description: page.description, inLanguage: lang, dateModified: page.modified, isPartOf: { "@id": origin + "/#website" }, breadcrumb: { "@id": url + "#breadcrumb" } }
  ];
  if (page.key === "/about/") graph.push({ "@type": "WebApplication", name: "Lockin", url, applicationCategory: "EducationalApplication", operatingSystem: "Web browser", inLanguage: lang, description: ui.appDescription, publisher: { "@id": origin + "/#organization" } });
  const ld = JSON.stringify({ "@context": "https://schema.org", "@graph": graph }).replace(/</g, "\\u003c");
  const breadcrumb = page.crumbs?.length ? '<nav class="breadcrumbs" aria-label="' + esc(ui.breadcrumbsLabel) + '">' + crumbs.map((item) => link(item.path, item.name)).join('<span aria-hidden="true"> / </span>') + "</nav>" : "";
  const hreflang = alternates.map(([code, href]) => '<link rel="alternate" hreflang="' + code + '" href="' + href + '" />\n').join("") + '<link rel="alternate" hreflang="x-default" href="' + alternates[0][1] + '" />\n';
  const ogAlternate = LOCALES.filter((code) => code !== lang).map((code) => '<meta property="og:locale:alternate" content="' + UI[code].ogLocale + '" />\n').join("");
  return '<!doctype html>\n<html lang="' + lang + '" dir="' + ui.dir + '">\n<head>\n<meta charset="UTF-8" />\n<meta name="viewport" content="width=device-width, initial-scale=1" />\n<meta name="theme-color" content="' + themeColor + '" />\n<title>' + esc(page.title) + '</title>\n<meta name="description" content="' + esc(page.description) + '" />\n<meta name="robots" content="index, follow, max-image-preview:large" />\n<link rel="canonical" href="' + url + '" />\n' + hreflang + '<meta property="og:locale" content="' + ui.ogLocale + '" />\n' + ogAlternate + '<meta property="og:site_name" content="Lockin" />\n<meta property="og:type" content="website" />\n<meta property="og:url" content="' + url + '" />\n<meta property="og:title" content="' + esc(page.title) + '" />\n<meta property="og:description" content="' + esc(page.description) + '" />\n<meta property="og:image" content="' + origin + '/icons/lockin-light-512-v2.png" />\n<meta property="og:image:alt" content="' + esc(ui.logoAlt) + '" />\n<meta name="twitter:card" content="summary" />\n<meta name="twitter:title" content="' + esc(page.title) + '" />\n<meta name="twitter:description" content="' + esc(page.description) + '" />\n<link rel="icon" href="/icons/lockin-light-32-v2.png" />\n<link rel="stylesheet" href="/public-search-tokens.css" />\n<link rel="stylesheet" href="/public-search.css" />\n<script type="application/ld+json">' + ld + '</script>\n</head>\n<body itemscope itemtype="https://schema.org/WebPage"><a class="skip-link" href="#content">' + esc(ui.skip) + '</a><header class="site-header"><a class="brand" href="' + localize("/about/", lang) + '" lang="en" dir="ltr">Lockin</a>' + nav(page, lang) + '</header><main id="content">' + breadcrumb + '<header class="intro' + (page.guide ? " intro-guide" : "") + '"><p class="eyebrow">' + esc(page.eyebrow) + '</p><h1 itemprop="name">' + esc(page.heading) + '</h1>' + page.lead.map((text) => '<p class="lead">' + esc(text) + "</p>").join("") + (page.english ? '<p class="brand-line" lang="en" dir="ltr">' + esc(page.english) + "</p>" : "") + (page.guide ? "" : '<a class="primary-link" href="/#/">' + esc(ui.start) + ' <span aria-hidden="true">' + ui.arrow + "</span></a>") + '</header>' + page.body + '</main>' + footer(lang) + "</body>\n</html>\n";
}
// Arabic page copy. The English edition lives in public-knowledge.en.json under the same keys.
const arabicPages = {
  "/about/": { title: "Lockin | بيئة دراسية مترابطة لطلبة الطب وطب الأسنان في ليبيا", description: "اكتشف Lockin، بيئة دراسية تجمع الشيتات والأسئلة والملاحظات وActive Study ومراجعة الأخطاء، في تجربة مترابطة لطلبة الطب البشري وطب الأسنان في ليبيا.", eyebrow: knowledge.brand.eyebrow, heading: knowledge.brand.headline, lead: ["من أول شيت، إلى آخر مراجعة.", "كل خطوة تكمل اللي قبلها."], english: "Lockin. Everything in sync.", sections: [["كل شيء يبدأ من شيتك.", ["تقرأ، تكتب ملاحظاتك، وتختبر فهمك. بدون ما تتنقل بين أدوات منفصلة كل مرة."]], ["اقرأ. اختبر. تقدّم.", ["مع Active Study، الدراسة ما توقف عند آخر صفحة. كل مرحلة تعطيك فرصة تعرف شنو فهمت، وشنو يحتاج منك مراجعة. متاحة للشيتات والمستويات الجاهزة."]], ["حتى أخطاؤك لها مكان.", ["أخطاء الأسئلة المدعومة بالمراجعة ما تضيع بعد الاختبار. ترجع لها وقت المراجعة، وتتابع تقدمك خطوة بخطوة."]], ["أشياء كثيرة. تجربة واحدة.", ["مش الفكرة في عدد الأدوات.", "الفكرة إنها تشتغل مع بعض."]], ["متاحة حاليًا في ليبيا.", ["بدأت Lockin مع طلبة الطب البشري وطب الأسنان في ليبيا. المحتوى المتاح يتحدد حسب الجامعة والمسار الدراسي المدعوم وصلاحيات الحساب."]]] },
  "/medicine/": { title: "Lockin للطب البشري في طرابلس | شيتات وأسئلة ومراجعة", description: "لطلبة الطب البشري في طرابلس: ادرس الشيتات، اختبر فهمك باستخدام Active Study، وراجع أخطاءك وتابع تقدمك مع Lockin، في المسارات الدراسية المدعومة داخل ليبيا.", eyebrow: "Lockin للطب البشري", heading: "معلومات كثيرة. خطوات أوضح.", lead: ["من المحاضرة إلى السؤال. ومن السؤال إلى المراجعة.", "كل شيء يكمل الثاني."], sections: [["اقرأ جزءًا. واختبر فهمك.", ["مع Active Study، تتحول دراسة الشيت الجاهز إلى مراحل قصيرة تتبعها أسئلة تساعدك تعرف مستواك قبل ما تكمل."]], ["الغلط مش نهاية السؤال.", ["أخطاؤك في الأسئلة المدعومة تبقى محفوظة، عشان ترجع لها بدل ما تبدأ المراجعة من الصفر."]], ["وقت أقل في التنقل.", ["شيتاتك، أسئلتك، وملاحظاتك في تجربة واحدة، تخليك تركز على المادة اللي قدامك."]], ["المسارات المدعومة.", ["متاحة حاليًا لطلبة الطب البشري في طرابلس (دفعة 60 ودفعة 61). المواد والأسئلة المنشورة تختلف حسب الدفعة."]]] },
  "/dentistry/": { title: "Lockin لطب الأسنان | طرابلس وبنغازي والزاوية", description: "Lockin لطلبة طب الأسنان في طرابلس وبنغازي والزاوية. ادرس الشيتات، استخدم أدوات الملاحظات، واختبر نفسك بالأسئلة النظرية والعملية المتاحة، مع مراجعة أخطائك وتقدمك.", eyebrow: "Lockin لطب الأسنان", heading: "النظري والعملي. بتناغم.", lead: ["تفاصيل كثيرة، من المحاضرات إلى المواد العملية.", "مش لازم تكون دراستك متفرقة."], sections: [["شيتك. بطريقتك.", ["اقرأ، حدّد المهم، واكتب ملاحظاتك. كل هذا داخل مساحة صُممت للدراسة."]], ["من القراءة إلى الاختبار.", ["راجع ما درست، واختبر فهمك من خلال الأسئلة المتاحة لموادك، واستخدم Active Study للدراسة على مراحل عندما يكون الشيت جاهزًا."]], ["كل إجابة تعلّمك شيئًا.", ["إجاباتك الخاطئة في المصادر المدعومة تبقى محفوظة للمراجعة. وتقدمك يبقى واضحًا قدامك."]], ["المسارات المدعومة.", ["متاحة حاليًا لطلبة طب الأسنان في السنة الأولى والثانية في طرابلس وبنغازي والزاوية. المواد والأسئلة المنشورة تختلف حسب المدينة والسنة."]]] },
  "/features/": { title: "ميزات Lockin | دراسة وملاحظات وأسئلة ومراجعة", description: "تعرّف على أدوات Lockin المتاحة وكيف ترتبط الشيتات والملاحظات والدراسة النشطة والأسئلة والمراجعة داخل بيئة واحدة.", eyebrow: "بيئة دراسية مترابطة", heading: "كل خطوة تكمل اللي قبلها.", lead: ["من القراءة إلى السؤال، ومن السؤال إلى المراجعة."] },
  "/help/": { title: "مركز مساعدة Lockin | دليل الميزات والحساب والدراسة", description: "تعرّف على طريقة استخدام Lockin وActive Study والملاحظات والمراجعة وخصوصية الحساب من خلال الأدلة الرسمية للميزات المتاحة.", eyebrow: "Lockin Help", heading: "كل إجابة. في مكانها.", lead: ["تعرّف على الأدوات، وطريقة استخدامها، وكل ما تحتاج معرفته عن Lockin."] }
};
const arabicFeaturePages = {
  notes: { title: "الكتابة على PDF والملاحظات الدراسية | Lockin", description: "دوّن ملاحظاتك على شيتاتك الدراسية، وحدد النقاط المهمة واستخدم أدوات الكتابة داخل مساحة الدراسة في Lockin.", eyebrow: "أدوات الملاحظات", heading: "فكرتك. في مكانها.", lead: ["لما تكتب ملاحظة، المفروض تبقى قريبة من الشيء اللي تدرسه."], sections: [["مساحة تدرس فيها.", ["مع أدوات Lockin للكتابة والتحديد، تقدر تتفاعل مع صفحات شيتك بطريقتك. مش مجرد ملف تقرأه. مساحة تدرس فيها."]], ["قلم وتحديد ونص.", ["افتح الشيت في مساحة الدراسة، واختر القلم أو التحديد أو النص. العلامات مرتبطة بمساحة العمل الخاصة بك، مع حالة حفظ ومزامنة يجب متابعتها."]], ["مثال من جلسة دراسة.", ["تقرأ فقرة، تحدد موضعًا مهمًا وتكتب بجانبه سؤالًا للمراجعة. ترجع للملاحظة مع الصفحة نفسها بدل البحث في ملف منفصل."]]] },
  "active-study": { title: "Active Study | دراسة تفاعلية واختبارات على الشيتات – Lockin", description: "ادرس الشيت على مراحل مع Active Study في Lockin، واختبر فهمك بعد كل جزء أو بأسلوب بومودورو (Pomodoro)، ثم أكمل إلى الاختبار النهائي في الشيتات الجاهزة.", eyebrow: "Active Study", heading: "لا تكتفِ بأنك قرأته.", lead: ["اقرأ جزءًا. اختبر نفسك. واعرف شنو فهمت قبل ما تكمل."], sections: [["كل مرحلة تكمل اللي قبلها.", ["مع Active Study، يتحول الشيت الجاهز إلى مراحل، وكل مرحلة تعطيك فرصة تختبر فهمك. وفي النهاية، اختبار شامل يجمع اللي درسته."]], ["ابدأ من شيت جاهز.", ["افتح الشيت، اختر Active Study ومستوى الصعوبة، ثم ابدأ الدراسة النشطة عندما يكون الخيار متاحًا. الإتاحة تعتمد على تجهيز أسئلة الشيت والمستوى، لا على وجود PDF فقط."]], ["مثال من جلسة دراسة.", ["تقرأ الجزء الأول وتجيب عن اختبار مرحلته، ثم تتابع الجزء التالي وفق نتيجة الدراسة. عند العودة إلى الشيت نفسه، استخدم التقدم المحفوظ للمستوى الذي اخترته."]], ["بوتيرتك، أو مع مؤقت بومودورو.", ["في الشيتات الجديدة الجاهزة تقدر تحدد عدد الصفحات والأسئلة لكل اختبار، أو تذاكر بأسلوب Pomodoro: مؤقت تركيز 25 أو 45 أو 50 دقيقة، بعده اختبار للصفحات التي قرأتها وراحة، مع نتيجة حسب كل صفحة."]]] },
  review: { title: "مراجعة الأخطاء والأسئلة الدراسية | Lockin", description: "اكتشف كيف تساعدك Lockin على مراجعة إجاباتك الخاطئة المدعومة، والرجوع إلى النقاط التي تحتاج اهتمامًا أكثر.", eyebrow: "المراجعة", heading: "أخطاؤك. ما تضيع.", lead: ["انتهى الاختبار. لكن في أشياء تستحق ترجع لها."], sections: [["ارجع لما يحتاج اهتمامك.", ["Lockin تحتفظ بإجاباتك الخاطئة في المصادر المدعومة بالمراجعة، عشان تعرف شنو يحتاج منك اهتمامًا أكثر. كل مراجعة تبدأ من شيء تعلمته عن نفسك."]], ["من بنك المراجعة.", ["افتح مركز المراجعة ثم البنك أو جلسة المادة. الإجابة الصحيحة تخرج السؤال من المراجعة النشطة وتؤهله لاسترجاع لاحق؛ الخطأ يبقيه للمراجعة."]], ["مثال من جلسة مراجعة.", ["أخطأت في سؤال مدعوم، فتعود إليه في بنك المادة. بعد تصحيحه قد يظهر لاحقًا في اختبار الذاكرة عندما يستوفي شروط الإتاحة."]]] },
  questions: { title: "أسئلة الطب البشري وطب الأسنان في ليبيا | Lockin", description: "اختبر فهمك بالأسئلة الدراسية المتاحة لمواد الطب البشري وطب الأسنان في Lockin، بما فيها الأسئلة النظرية والعملية حسب المسار والمحتوى المنشور.", eyebrow: "الأسئلة", heading: "كل سؤال يكشف لك شيئًا.", lead: ["مش كفاية تعرف المعلومة لما تقراها. المهم تعرف إذا تقدر ترجع لها وقت السؤال."], sections: [["من الدراسة إلى الاختبار.", ["مع Lockin، تختبر فهمك بالأسئلة المتاحة لموادك، وتعرف أخطاءك، وترجع لها وقت المراجعة. من الدراسة إلى الاختبار. في نفس المكان."]], ["اختر المصدر المتاح.", ["قسم الأسئلة يعرض مصادر التدريب والسنوات وأسئلة الشيت بحسب المسار والمحتوى المنشور. قد تتضمن بعض المواد أسئلة صور أو تحديد موضع، بينما Mix غير متاحة حاليًا."]], ["مثال من مادة تدرسها.", ["تفتح مصدرًا متاحًا، ثم مادة ومجموعة أسئلة منشورة، وتجيب عن أسئلتها. عرض شيت للقراءة لا يثبت توفر أسئلة له؛ النشران منفصلان."]]] }
};
const MARKETING = ["/about/", "/medicine/", "/dentistry/"];
const FEATURE_PAGES = ["notes", "active-study", "review", "questions"];
// Every Arabic answer and page has an English counterpart, with the same number of steps, or the build stops.
function translated(table, id, what) {
  const entry = table?.[id];
  if (!entry) throw new Error("Missing English translation for " + what + ": " + id);
  return entry;
}
function localeContent(lang) {
  if (lang === "ar") return { page: (key) => arabicPages[key], featurePage: (id) => arabicFeaturePages[id], requirements: (id) => feature(id).requirements, category: (item) => item, question: (item) => item };
  return {
    page: (key) => translated(english.pages, key, "page"),
    featurePage: (id) => translated(english.featurePages, id, "feature page"),
    requirements: (id) => translated(english.features, id, "feature").requirements,
    category: (item) => ({ ...item, ...translated(english.categories, item.id, "category") }),
    question: (item) => {
      const entry = translated(english.questions, item.id, "question");
      if (entry.detailedSteps.length !== item.detailedSteps.length) throw new Error("English steps out of step with Arabic: " + item.id);
      return { ...item, ...entry };
    }
  };
}
const newest = (dates) => dates.filter(Boolean).sort().at(-1);
function buildLocale(lang, published) {
  const ui = UI[lang], text = localeContent(lang), at = (path) => localize(path, lang);
  const questions = published.map(text.question);
  const categories = knowledge.categories.map(text.category);
  // Each page carries the review date of what it says: a guide its own, a feature page its newest guide, the rest the newest of all.
  const siteModified = newest([knowledge.lastVerified, ...knowledge.features.filter((item) => item.publicDocumentable).map((item) => item.lastVerified), ...published.map((item) => item.lastVerified)]);
  const featureModified = (id) => newest([feature(id).lastVerified, ...published.filter((item) => item.relatedFeature === id).map((item) => item.lastVerified)]);
  const featurePages = FEATURE_PAGES.filter((id) => feature(id).publicDocumentable).map((id) => {
    const copy = text.featurePage(id), key = "/features/" + id + "/";
    return { ...copy, id, key, path: at(key), crumbs: [{ name: ui.features, path: at("/features/") }], modified: featureModified(id), body: sections(copy.sections) + section(ui.forAccount, [text.requirements(id)]) + '<section class="related"><h2>' + esc(ui.howTo) + "</h2>" + list(questions.filter((item) => item.relatedFeature === id).map((item) => [at("/help/" + item.id + "/"), item.question, ""]), lang) + "</section>" };
  });
  const discover = '<section class="related"><h2>' + esc(ui.discover) + "</h2>" + list([[at("/features/"), ...ui.discoverFeatures], [at("/help/"), ...ui.discoverHelp]], lang) + "</section>";
  const marketing = MARKETING.map((key) => { const copy = text.page(key); return { ...copy, key, path: at(key), body: sections(copy.sections) + discover }; });
  const featureIndex = { ...text.page("/features/"), key: "/features/", path: at("/features/"), body: list(featurePages.map((item) => [item.path, item.eyebrow, item.heading]), lang) };
  const help = { ...text.page("/help/"), key: "/help/", path: at("/help/"), guide: true, body: list(categories.map((item) => [at("/help/topics/" + item.id + "/"), item.title, item.description]), lang) + '<section class="related"><h2>' + esc(ui.startHere) + "</h2>" + list(["what-is-lockin", "start-active-study", "pdf-notes", "find-mistakes", "contact-support"].map((id) => { const item = questions.find((entry) => entry.id === id); return [at("/help/" + id + "/"), item.question, item.shortAnswer]; }), lang) + "</section>" };
  const topics = categories.map((category) => { const key = "/help/topics/" + category.id + "/"; return { key, path: at(key), title: category.title + ui.topicTitleSuffix, description: category.description + ui.topicDescriptionSuffix, eyebrow: ui.helpEyebrow, heading: category.title, lead: [category.description], guide: true, crumbs: [{ name: ui.helpCenter, path: at("/help/") }], body: list(questions.filter((item) => item.category === category.id).map((item) => [at("/help/" + item.id + "/"), item.question, item.shortAnswer]), lang) }; });
  // Guides link to their feature page and sibling answers, so readers and crawlers find the whole topic.
  const related = (item) => {
    const entries = questions.filter((entry) => entry.relatedFeature === item.relatedFeature && entry.id !== item.id).slice(0, 5).map((entry) => [at("/help/" + entry.id + "/"), entry.question, ""]);
    const page = featurePages.find((entry) => entry.id === item.relatedFeature);
    if (page) entries.unshift([page.path, page.eyebrow, page.heading]);
    return entries.length ? '<section class="related"><h2>' + esc(ui.relatedQuestions) + "</h2>" + list(entries, lang) + "</section>" : "";
  };
  const guides = questions.map((item) => {
    const category = categories.find((entry) => entry.id === item.category), key = "/help/" + item.id + "/";
    return { key, path: at(key), title: item.question + ui.guideTitleSuffix, description: item.shortAnswer, eyebrow: ui.helpEyebrow + " · " + category.title, heading: item.question, lead: [item.shortAnswer], guide: true, crumbs: [{ name: ui.helpCenter, path: at("/help/") }, { name: category.title, path: at("/help/topics/" + category.id + "/") }], modified: item.lastVerified, body: '<article class="guide-body">' + (item.detailedSteps.length ? "<h2>" + esc(ui.steps) + "</h2><ol>" + item.detailedSteps.map((step) => "<li>" + esc(step) + "</li>").join("") + "</ol>" : "") + "<h2>" + esc(ui.availability) + "</h2><p>" + esc(text.requirements(item.relatedFeature)) + '</p><p class="verified">' + esc(ui.verified) + ' <time datetime="' + item.lastVerified + '">' + item.lastVerified + "</time></p><p>" + link("/#/", ui.openApp) + " · " + link(at("/help/topics/" + item.category + "/"), ui.relatedGuides) + "</p></article>" + related(item) };
  });
  const pages = [...marketing, featureIndex, ...featurePages, help, ...topics, ...guides].map((page) => ({ ...page, modified: page.modified || siteModified }));
  const llms = "## " + ui.llmsSources + "\n\n" + [[at("/about/"), ui.nav.about], ...featurePages.map((page) => [page.path, page.eyebrow]), [at("/help/"), ui.helpCenter], ...categories.map((item) => [at("/help/topics/" + item.id + "/"), item.title])].map(([path, title]) => "- [" + title + "](" + origin + path + ")").join("\n") + "\n\n## " + ui.llmsQuestions + "\n\n" + guides.map((page) => "- [" + page.heading + "](" + origin + page.path + "): " + page.description).join("\n") + "\n";
  return { pages, llms };
}
export function buildPublicFiles() {
  const files = new Map();
  files.set("public-search-tokens.css", tokenCss);
  const published = knowledge.questions.filter((item) => item.status === "published" && feature(item.relatedFeature)?.publicDocumentable);
  const editions = LOCALES.map((lang) => ({ lang, ...buildLocale(lang, published) }));
  const pages = editions.flatMap(({ lang, pages: localized }) => localized.map((page) => ({ ...page, lang })));
  for (const page of pages) files.set(page.path.slice(1) + "index.html", renderPage(page, page.lang));
  const paths = pages.map((page) => page.path);
  files.set("public-search-routes.json", JSON.stringify(paths, null, 2) + "\n");
  files.set("sitemap.xml", '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n' + pages.map((page) => "  <url><loc>" + origin + page.path + "</loc><lastmod>" + page.modified + "</lastmod>" + LOCALES.map((code) => '<xhtml:link rel="alternate" hreflang="' + code + '" href="' + origin + localize(page.key, code) + '"/>').join("") + "</url>").join("\n") + "\n</urlset>\n");
  const agents = ["*", "Googlebot", "Bingbot", "Applebot", "OAI-SearchBot", "PerplexityBot", "Claude-SearchBot"];
  const rules = paths.map((path) => "Allow: " + path + "$").join("\n") + "\nAllow: /public-search.css$\nAllow: /public-search-tokens.css$\nAllow: /icons/\nAllow: /sitemap.xml$\nAllow: /llms.txt$\n";
  files.set("robots.txt", agents.map((agent) => "User-agent: " + agent + "\nDisallow: /\n" + rules).join("\n") + "\nUser-agent: GPTBot\nDisallow: /\n\nUser-agent: ClaudeBot\nDisallow: /\n\nUser-agent: Google-Extended\nDisallow: /\n\nSitemap: " + origin + "/sitemap.xml\n");
  files.set("llms.txt", "# Lockin\n\n> " + UI.ar.llmsSummary + "\n> " + UI.en.llmsSummary + "\n\nTelegram: " + officialProfiles[0] + "\n\n" + editions.map((edition) => edition.llms).join("\n") + "\n" + UI.ar.llmsNote + "\n" + UI.en.llmsNote + "\n");
  return { files, paths };
}
export function pruneWithdrawnPages(outputRoot, previousPaths, paths, check = false) {
  for (const path of previousPaths.filter((path) => !paths.includes(path))) {
    if (!/^\/(?:[a-z0-9-]+\/)+$/.test(path)) throw new Error("Invalid previous public route");
    const absolute = resolve(outputRoot, path.slice(1), "index.html");
    if (!absolute.startsWith(resolve(outputRoot) + sep)) throw new Error("Public route escapes output directory");
    if (check) throw new Error("Withdrawn guide must be removed: " + path);
    if (existsSync(absolute)) unlinkSync(absolute);
  }
}
export function writePublicKnowledge({ check = false } = {}) {
  verifyKnowledgeEvidence();
  const { files, paths } = buildPublicFiles();
  const manifest = resolve(publicRoot, "public-search-routes.json");
  const previousPaths = existsSync(manifest) ? JSON.parse(readFileSync(manifest, "utf8")) : [];
  pruneWithdrawnPages(publicRoot, previousPaths, paths, check);
  for (const [path, content] of files) {
    const absolute = resolve(publicRoot, path);
    if (check) { if (!existsSync(absolute) || readFileSync(absolute, "utf8").replace(/\r\n/g, "\n") !== content) throw new Error("Generated public content differs: " + path + ". Run node scripts/build-public-knowledge.mjs."); }
    else { mkdirSync(dirname(absolute), { recursive: true }); writeFileSync(absolute, content); }
  }
  const routes = paths.map((path) => path.slice(1, -1).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const block = '    # BEGIN GENERATED PUBLIC KNOWLEDGE\n    # Exact published routes only; no prefix grant to private/help/API paths.\n    location ~ ^/(' + routes + ')/$ {\n        set $lockin_robots "index, follow, max-image-preview:large";\n        try_files ${uri}index.html =404;\n    }\n    location ~ ^/(' + routes + ')(?:/index\\.html)?$ {\n        return 308 /$1/;\n    }\n    location = /llms.txt {\n        default_type text/plain;\n        try_files $uri =404;\n    }\n    # END GENERATED PUBLIC KNOWLEDGE\n';
  for (const path of ["frontend/nginx/default.conf", "deploy/container-host/nginx.conf.template"]) {
    const absolute = resolve(repoRoot, path), original = readFileSync(absolute, "utf8").replace(/\r\n/g, "\n");
    const pattern = /    # BEGIN GENERATED PUBLIC KNOWLEDGE[\s\S]*?    # END GENERATED PUBLIC KNOWLEDGE\n(?:\n)?|    # Only these static, account-independent pages[\s\S]*?(?=    location = \/sitemap\.xml)/;
    if (!pattern.test(original)) throw new Error("Public Nginx section missing: " + path);
    const updated = original.replace(pattern, block + "\n");
    if (check && original !== updated) throw new Error("Public Nginx route list is stale: " + path);
    if (!check) writeFileSync(absolute, updated);
  }
  return { paths, count: files.size };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = writePublicKnowledge({ check: process.argv.includes("--check") });
  console.log("Public knowledge: " + result.paths.length + " canonical pages; " + knowledge.questions.filter((item) => item.status === "published").length + " published answers; " + knowledge.pendingQuestions.length + " withheld drafts.");
}
