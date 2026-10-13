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
const list = (entries) => '<ul class="guide-list">' + entries.map(([path, title, detail]) => '<li><a href="' + esc(path) + '" aria-label="' + esc(title) + '"><span class="guide-list-body"><span class="guide-list-title">' + esc(title) + '</span>' + (detail ? '<span class="guide-list-summary">' + esc(detail) + '</span>' : '') + '</span><svg class="guide-chevron" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg></a></li>').join("") + "</ul>";
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
const nav = (currentPath) => '<nav aria-label="الصفحات العامة">' + [["/about/", "عن Lockin"], ["/medicine/", "الطب البشري"], ["/dentistry/", "طب الأسنان"], ["/features/", "الميزات"], ["/help/", "الدعم"]].map(([path, title]) => '<a href="' + path + '"' + (currentPath === path || currentPath.startsWith(path) ? ' aria-current="page"' : '') + '>' + esc(title) + '</a>').join("") + "</nav>";
const footer = '<footer class="site-footer"><div itemscope itemtype="https://schema.org/Organization"><a itemprop="url" href="/about/"><span itemprop="name" lang="en" dir="ltr">Lockin</span></a><span itemprop="description">بيئة دراسية مترابطة لطلبة الطب البشري وطب الأسنان في <span itemprop="areaServed">ليبيا</span>.</span></div><nav aria-label="معلومات الحساب">' + [["/help/", "مركز المساعدة"], ["/#/terms", "الشروط"], ["/#/privacy", "الخصوصية"], ["/#/support", "التواصل والدعم"], ["/#/", "الدخول إلى Lockin"]].map(([path, text]) => link(path, text)).join("") + "</nav></footer>";
function renderPage(page) {
  const url = origin + page.path;
  const crumbs = [{ name: "Lockin", path: "/about/" }, ...(page.crumbs || [])];
  if (page.path !== "/about/") crumbs.push({ name: page.heading, path: page.path });
  const graph = [
    { "@type": "Organization", "@id": origin + "/#organization", name: "Lockin", url: origin + "/about/", logo: origin + "/icons/lockin-light-512-v2.png", areaServed: { "@type": "Country", name: "Libya" } },
    { "@type": "WebSite", "@id": origin + "/#website", name: "Lockin", url: origin + "/about/", inLanguage: "ar", publisher: { "@id": origin + "/#organization" } },
    { "@type": "BreadcrumbList", "@id": url + "#breadcrumb", itemListElement: crumbs.map((item, index) => ({ "@type": "ListItem", position: index + 1, name: item.name, item: origin + item.path })) },
    { "@type": "WebPage", "@id": url + "#page", url, name: page.title, description: page.description, inLanguage: "ar", isPartOf: { "@id": origin + "/#website" }, breadcrumb: { "@id": url + "#breadcrumb" } }
  ];
  if (page.path === "/about/") graph.push({ "@type": "WebApplication", name: "Lockin", url, applicationCategory: "EducationalApplication", operatingSystem: "Web browser", description: "بيئة دراسية مترابطة لطلبة الطب البشري وطب الأسنان في ليبيا.", publisher: { "@id": origin + "/#organization" } });
  const ld = JSON.stringify({ "@context": "https://schema.org", "@graph": graph }).replace(/</g, "\\u003c");
  const breadcrumb = page.crumbs?.length ? '<nav class="breadcrumbs" aria-label="مسار الصفحة">' + crumbs.map((item) => link(item.path, item.name)).join('<span aria-hidden="true"> / </span>') + "</nav>" : "";
  return '<!doctype html>\n<html lang="ar" dir="rtl">\n<head>\n<meta charset="UTF-8" />\n<meta name="viewport" content="width=device-width, initial-scale=1" />\n<meta name="theme-color" content="' + themeColor + '" />\n<title>' + esc(page.title) + '</title>\n<meta name="description" content="' + esc(page.description) + '" />\n<meta name="robots" content="index, follow, max-image-preview:large" />\n<link rel="canonical" href="' + url + '" />\n<meta property="og:locale" content="ar_LY" />\n<meta property="og:site_name" content="Lockin" />\n<meta property="og:type" content="website" />\n<meta property="og:url" content="' + url + '" />\n<meta property="og:title" content="' + esc(page.title) + '" />\n<meta property="og:description" content="' + esc(page.description) + '" />\n<meta property="og:image" content="' + origin + '/icons/lockin-light-512-v2.png" />\n<meta property="og:image:alt" content="شعار Lockin" />\n<meta name="twitter:card" content="summary" />\n<meta name="twitter:title" content="' + esc(page.title) + '" />\n<meta name="twitter:description" content="' + esc(page.description) + '" />\n<link rel="icon" href="/icons/lockin-light-32-v2.png" />\n<link rel="stylesheet" href="/public-search-tokens.css" />\n<link rel="stylesheet" href="/public-search.css" />\n<script type="application/ld+json">' + ld + '</script>\n</head>\n<body itemscope itemtype="https://schema.org/WebPage"><a class="skip-link" href="#content">انتقل إلى المحتوى</a><header class="site-header"><a class="brand" href="/about/" lang="en" dir="ltr">Lockin</a>' + nav(page.path) + '</header><main id="content">' + breadcrumb + '<header class="intro' + (page.guide ? " intro-guide" : "") + '"><p class="eyebrow">' + esc(page.eyebrow) + '</p><h1 itemprop="name">' + esc(page.heading) + '</h1>' + page.lead.map((text) => '<p class="lead">' + esc(text) + "</p>").join("") + (page.english ? '<p class="brand-line" lang="en" dir="ltr">' + esc(page.english) + "</p>" : "") + (page.guide ? "" : '<a class="primary-link" href="/#/">ابدأ الدراسة <span aria-hidden="true">←</span></a>') + '</header>' + page.body + '</main>' + footer + "</body>\n</html>\n";
}
const marketing = [
  { path: "/about/", title: "Lockin | بيئة دراسية مترابطة لطلبة الطب وطب الأسنان في ليبيا", description: "اكتشف Lockin، بيئة دراسية تجمع الشيتات والأسئلة والملاحظات وActive Study ومراجعة الأخطاء، في تجربة مترابطة لطلبة الطب البشري وطب الأسنان في ليبيا.", eyebrow: knowledge.brand.eyebrow, heading: knowledge.brand.headline, lead: ["من أول شيت، إلى آخر مراجعة.", "كل خطوة تكمل اللي قبلها."], english: "Lockin. Everything in sync.", body: section("كل شيء يبدأ من شيتك.", ["تقرأ، تكتب ملاحظاتك، وتختبر فهمك. بدون ما تتنقل بين أدوات منفصلة كل مرة."]) + section("اقرأ. اختبر. تقدّم.", ["مع Active Study، الدراسة ما توقف عند آخر صفحة. كل مرحلة تعطيك فرصة تعرف شنو فهمت، وشنو يحتاج منك مراجعة. متاحة للشيتات والمستويات الجاهزة."]) + section("حتى أخطاؤك لها مكان.", ["أخطاء الأسئلة المدعومة بالمراجعة ما تضيع بعد الاختبار. ترجع لها وقت المراجعة، وتتابع تقدمك خطوة بخطوة."]) + section("أشياء كثيرة. تجربة واحدة.", ["مش الفكرة في عدد الأدوات.", "الفكرة إنها تشتغل مع بعض."]) + section("متاحة حاليًا في ليبيا.", ["بدأت Lockin مع طلبة الطب البشري وطب الأسنان في ليبيا. المحتوى المتاح يتحدد حسب الجامعة والمسار الدراسي المدعوم وصلاحيات الحساب."]) },
  { path: "/medicine/", title: "Lockin للطب البشري في ليبيا | شيتات وأسئلة ومراجعة", description: "ادرس شيتات الطب البشري، اختبر فهمك باستخدام Active Study، وراجع أخطاءك وتابع تقدمك مع Lockin، في المسارات الدراسية المدعومة داخل ليبيا.", eyebrow: "Lockin للطب البشري", heading: "معلومات كثيرة. خطوات أوضح.", lead: ["من المحاضرة إلى السؤال. ومن السؤال إلى المراجعة.", "كل شيء يكمل الثاني."], body: section("اقرأ جزءًا. واختبر فهمك.", ["مع Active Study، تتحول دراسة الشيت الجاهز إلى مراحل قصيرة تتبعها أسئلة تساعدك تعرف مستواك قبل ما تكمل."]) + section("الغلط مش نهاية السؤال.", ["أخطاؤك في الأسئلة المدعومة تبقى محفوظة، عشان ترجع لها بدل ما تبدأ المراجعة من الصفر."]) + section("وقت أقل في التنقل.", ["شيتاتك، أسئلتك، وملاحظاتك في تجربة واحدة، تخليك تركز على المادة اللي قدامك."]) + section("المسارات المدعومة.", ["متاحة حاليًا لطلبة الطب البشري في الجامعات والمسارات المدعومة داخل Lockin."]) },
  { path: "/dentistry/", title: "Lockin لطب الأسنان في ليبيا | شيتات وأسئلة النظري والعملي", description: "Lockin لطلبة طب الأسنان في ليبيا. ادرس الشيتات، استخدم أدوات الملاحظات، واختبر نفسك بالأسئلة النظرية والعملية المتاحة، مع مراجعة أخطائك وتقدمك.", eyebrow: "Lockin لطب الأسنان", heading: "النظري والعملي. بتناغم.", lead: ["تفاصيل كثيرة، من المحاضرات إلى المواد العملية.", "مش لازم تكون دراستك متفرقة."], body: section("شيتك. بطريقتك.", ["اقرأ، حدّد المهم، واكتب ملاحظاتك. كل هذا داخل مساحة صُممت للدراسة."]) + section("من القراءة إلى الاختبار.", ["راجع ما درست، واختبر فهمك من خلال الأسئلة المتاحة لموادك، واستخدم Active Study للدراسة على مراحل عندما يكون الشيت جاهزًا."]) + section("كل إجابة تعلّمك شيئًا.", ["إجاباتك الخاطئة في المصادر المدعومة تبقى محفوظة للمراجعة. وتقدمك يبقى واضحًا قدامك."]) + section("المسارات المدعومة.", ["متاحة حاليًا لطلبة طب الأسنان في الجامعات والمسارات المدعومة داخل Lockin."]) }
];
const featurePages = [
  { id: "notes", title: "الكتابة على PDF والملاحظات الدراسية | Lockin", description: "دوّن ملاحظاتك على شيتاتك الدراسية، وحدد النقاط المهمة واستخدم أدوات الكتابة داخل مساحة الدراسة في Lockin.", eyebrow: "أدوات الملاحظات", heading: "فكرتك. في مكانها.", lead: ["لما تكتب ملاحظة، المفروض تبقى قريبة من الشيء اللي تدرسه."], body: section("مساحة تدرس فيها.", ["مع أدوات Lockin للكتابة والتحديد، تقدر تتفاعل مع صفحات شيتك بطريقتك. مش مجرد ملف تقرأه. مساحة تدرس فيها."]) + section("قلم وتحديد ونص.", ["افتح الشيت في مساحة الدراسة، واختر القلم أو التحديد أو النص. العلامات مرتبطة بمساحة العمل الخاصة بك، مع حالة حفظ ومزامنة يجب متابعتها."]) + section("مثال من جلسة دراسة.", ["تقرأ فقرة، تحدد موضعًا مهمًا وتكتب بجانبه سؤالًا للمراجعة. ترجع للملاحظة مع الصفحة نفسها بدل البحث في ملف منفصل."]) },
  { id: "active-study", title: "Active Study | دراسة تفاعلية واختبارات على الشيتات – Lockin", description: "ادرس الشيت على مراحل مع Active Study في Lockin، واختبر فهمك بين الأجزاء، ثم أكمل إلى الاختبار النهائي في الشيتات الجاهزة.", eyebrow: "Active Study", heading: "لا تكتفي بأنك قرأته.", lead: ["اقرأ جزءًا. اختبر نفسك. واعرف شنو فهمت قبل ما تكمل."], body: section("كل مرحلة تكمل اللي قبلها.", ["مع Active Study، يتحول الشيت الجاهز إلى مراحل، وكل مرحلة تعطيك فرصة تختبر فهمك. وفي النهاية، اختبار شامل يجمع اللي درسته."]) + section("ابدأ من شيت جاهز.", ["افتح الشيت، اختر Active Study ومستوى الصعوبة، ثم ابدأ الدراسة النشطة عندما يكون الخيار متاحًا. الإتاحة تعتمد على تجهيز أسئلة الشيت والمستوى، لا على وجود PDF فقط."]) + section("مثال من جلسة دراسة.", ["تقرأ الجزء الأول وتجيب عن اختبار مرحلته، ثم تتابع الجزء التالي وفق نتيجة الدراسة. عند العودة إلى الشيت نفسه، استخدم التقدم المحفوظ للمستوى الذي اخترته."]) },
  { id: "review", title: "مراجعة الأخطاء والأسئلة الدراسية | Lockin", description: "اكتشف كيف تساعدك Lockin على مراجعة إجاباتك الخاطئة المدعومة، والرجوع إلى النقاط التي تحتاج اهتمامًا أكثر.", eyebrow: "المراجعة", heading: "أخطاؤك. ما تضيع.", lead: ["انتهى الاختبار. لكن في أشياء تستحق ترجع لها."], body: section("ارجع لما يحتاج اهتمامك.", ["Lockin تحتفظ بإجاباتك الخاطئة في المصادر المدعومة بالمراجعة، عشان تعرف شنو يحتاج منك اهتمامًا أكثر. كل مراجعة تبدأ من شيء تعلمته عن نفسك."]) + section("من بنك المراجعة.", ["افتح مركز المراجعة ثم البنك أو جلسة المادة. الإجابة الصحيحة تخرج السؤال من المراجعة النشطة وتؤهله لاسترجاع لاحق؛ الخطأ يبقيه للمراجعة."]) + section("مثال من جلسة مراجعة.", ["أخطأت في سؤال مدعوم، فتعود إليه في بنك المادة. بعد تصحيحه قد يظهر لاحقًا في اختبار الذاكرة عندما يستوفي شروط الإتاحة."]) },
  { id: "questions", title: "أسئلة الطب البشري وطب الأسنان في ليبيا | Lockin", description: "اختبر فهمك بالأسئلة الدراسية المتاحة لمواد الطب البشري وطب الأسنان في Lockin، بما فيها الأسئلة النظرية والعملية حسب المسار والمحتوى المنشور.", eyebrow: "الأسئلة", heading: "كل سؤال يكشف لك شيئًا.", lead: ["مش كفاية تعرف المعلومة لما تقراها. المهم تعرف إذا تقدر ترجع لها وقت السؤال."], body: section("من الدراسة إلى الاختبار.", ["مع Lockin، تختبر فهمك بالأسئلة المتاحة لموادك، وتعرف أخطاءك، وترجع لها وقت المراجعة. من الدراسة إلى الاختبار. في نفس المكان."]) + section("اختر المصدر المتاح.", ["قسم الأسئلة يعرض مصادر التدريب والسنوات وأسئلة الشيت بحسب المسار والمحتوى المنشور. قد تتضمن بعض المواد أسئلة صور أو تحديد موضع، بينما Mix غير متاحة حاليًا."]) + section("مثال من مادة تدرسها.", ["تفتح مصدرًا متاحًا، ثم مادة ومجموعة أسئلة منشورة، وتجيب عن أسئلتها. عرض شيت للقراءة لا يثبت توفر أسئلة له؛ النشران منفصلان."]) }
].filter((page) => feature(page.id).publicDocumentable).map((page) => ({ ...page, path: "/features/" + page.id + "/", crumbs: [{ name: "الميزات", path: "/features/" }], body: page.body + section("حسب ما يتاح لحسابك.", [feature(page.id).requirements]) + '<section class="related"><h2>طريقة الاستخدام</h2>' + list(knowledge.questions.filter((item) => item.status === "published" && item.relatedFeature === page.id).map((item) => ["/help/" + item.id + "/", item.question, ""])) + "</section>" }));
export function buildPublicFiles() {
  const files = new Map();
  files.set("public-search-tokens.css", tokenCss);
  const published = knowledge.questions.filter((item) => item.status === "published" && feature(item.relatedFeature)?.publicDocumentable);
  const featureIndex = { path: "/features/", title: "ميزات Lockin | دراسة وملاحظات وأسئلة ومراجعة", description: "تعرّف على أدوات Lockin المتاحة وكيف ترتبط الشيتات والملاحظات والدراسة النشطة والأسئلة والمراجعة داخل بيئة واحدة.", eyebrow: "بيئة دراسية مترابطة", heading: "كل خطوة تكمل اللي قبلها.", lead: ["من القراءة إلى السؤال، ومن السؤال إلى المراجعة."], body: list(featurePages.map((item) => [item.path, item.eyebrow, item.heading])) };
  const help = { path: "/help/", title: "مركز مساعدة Lockin | دليل الميزات والحساب والدراسة", description: "تعرّف على طريقة استخدام Lockin وActive Study والملاحظات والمراجعة وخصوصية الحساب من خلال الأدلة الرسمية للميزات المتاحة.", eyebrow: "Lockin Help", heading: "كل إجابة. في مكانها.", lead: ["تعرّف على الأدوات، وطريقة استخدامها، وكل ما تحتاج معرفته عن Lockin."], guide: true, body: list(knowledge.categories.map((item) => ["/help/topics/" + item.id + "/", item.title, item.description])) + '<section class="related"><h2>ابدأ من هنا</h2>' + list(["what-is-lockin", "start-active-study", "pdf-notes", "find-mistakes", "contact-support"].map((id) => { const item = published.find((entry) => entry.id === id); return ["/help/" + id + "/", item.question, item.shortAnswer]; })) + "</section>" };
  const topics = knowledge.categories.map((category) => ({ path: "/help/topics/" + category.id + "/", title: category.title + " | مركز مساعدة Lockin", description: category.description + " أدلة رسمية مختصرة لاستخدام Lockin.", eyebrow: "Lockin Help", heading: category.title, lead: [category.description], guide: true, crumbs: [{ name: "مركز المساعدة", path: "/help/" }], body: list(published.filter((item) => item.category === category.id).map((item) => ["/help/" + item.id + "/", item.question, item.shortAnswer])) }));
  const guides = published.map((item) => {
    const category = knowledge.categories.find((entry) => entry.id === item.category);
    return { path: "/help/" + item.id + "/", title: item.question + " | مساعدة Lockin", description: item.shortAnswer, eyebrow: "Lockin Help · " + category.title, heading: item.question, lead: [item.shortAnswer], guide: true, crumbs: [{ name: "مركز المساعدة", path: "/help/" }, { name: category.title, path: "/help/topics/" + category.id + "/" }], body: '<article class="guide-body">' + (item.detailedSteps.length ? "<h2>الخطوات</h2><ol>" + item.detailedSteps.map((step) => "<li>" + esc(step) + "</li>").join("") + "</ol>" : "") + "<h2>الإتاحة</h2><p>" + esc(feature(item.relatedFeature).requirements) + '</p><p class="verified">آخر مراجعة للدليل: <time datetime="' + item.lastVerified + '">' + item.lastVerified + "</time></p><p>" + link("/#/", "افتح Lockin") + " · " + link("/help/topics/" + item.category + "/", "أدلة مرتبطة") + "</p></article>" };
  });
  const pages = [...marketing, featureIndex, ...featurePages, help, ...topics, ...guides].map((page) => page.path.startsWith("/help/") || page.path.startsWith("/features/") ? page : ({ ...page, body: page.body + '<section class="related"><h2>تعرّف على بيئتك الدراسية.</h2>' + list([["/features/", "أدوات تعمل مع بعض", "كيف ترتبط القراءة بالملاحظات والأسئلة والمراجعة."], ["/help/", "كل إجابة. في مكانها.", "أدلة الاستخدام والمساعدة."]]) + "</section>" }));
  for (const page of pages) files.set(page.path.slice(1) + "index.html", renderPage(page));
  const paths = pages.map((page) => page.path);
  files.set("public-search-routes.json", JSON.stringify(paths, null, 2) + "\n");
  files.set("sitemap.xml", '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + paths.map((path) => "  <url><loc>" + origin + path + "</loc></url>").join("\n") + "\n</urlset>\n");
  const agents = ["*", "Googlebot", "Bingbot", "Applebot", "OAI-SearchBot", "PerplexityBot", "Claude-SearchBot"];
  const rules = paths.map((path) => "Allow: " + path + "$").join("\n") + "\nAllow: /public-search.css$\nAllow: /public-search-tokens.css$\nAllow: /icons/\nAllow: /sitemap.xml$\nAllow: /llms.txt$\n";
  files.set("robots.txt", agents.map((agent) => "User-agent: " + agent + "\nDisallow: /\n" + rules).join("\n") + "\nUser-agent: GPTBot\nDisallow: /\n\nUser-agent: ClaudeBot\nDisallow: /\n\nUser-agent: Google-Extended\nDisallow: /\n\nSitemap: " + origin + "/sitemap.xml\n");
  files.set("llms.txt", "# Lockin\n\n> بيئة دراسية مترابطة لطلبة الطب البشري وطب الأسنان في ليبيا، ضمن المسارات والمحتوى المدعومين.\n\n## المصادر الرسمية\n\n" + [["/about/", "عن Lockin"], ...featurePages.map((page) => [page.path, page.eyebrow]), ["/help/", "مركز المساعدة"], ...knowledge.categories.map((item) => ["/help/topics/" + item.id + "/", item.title])].map(([path, title]) => "- [" + title + "](" + origin + path + ")").join("\n") + "\n\nالفهرس مساعد اختياري. صفحات HTML هي المصدر؛ لا يشمل ملفات الطلاب أو حساباتهم. لا يثبت الفهرس ترتيبًا أو توصية من أي محرك بحث.\n");
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
