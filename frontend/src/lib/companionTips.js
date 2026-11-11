// Labels for the six persisted card kinds. Teaching angles (common confusions,
// comparisons, short clinical examples) reuse these kinds without a migration.
export const companionKindLabels = {
 en: { understand:'Understand', fact:'Side fact', simplify:'Simplify', memory:'Memory aid', organize:'Organize', connection:'Connect ideas', general:'General study tip' },
 ar: { understand:'شرح سريع', fact:'معلومة إضافية', simplify:'تبسيط', memory:'طريقة حفظ', organize:'تنظيم', connection:'ربط أفكار', general:'نصيحة دراسية' }
};

// General study coaching only; these are never presented as explanations of a PDF.
const tips = {
 en: [
  ['Recall first','Read one short section, cover it, then explain it in your own words.','What could you recall without looking?','Return to the missing points, then try once more.'],
  ['One small goal','Choose a small section to finish before switching tasks.','What will you finish next?','Pick a page range you can study comfortably.'],
  ['Compare concepts','Write one similarity and one difference between two concepts on this page.','Where can you verify the difference?','Check the wording in your sheet.'],
  ['Turn headings into questions','Turn a heading into a question before reading its paragraph.','Can you answer it now?','Check your answer against the paragraph.'],
  ['Use a short example','Create an example using only information in your sheet.','Does every part fit the definition?','Revise the example if it contradicts the source.'],
  ['Review an error','After a wrong answer, identify why your choice seemed plausible.','What detail did you miss?','Write a short reminder and check it next time.'],
  ['Take a pause','If you keep rereading without understanding, pause briefly and return to a smaller section.','What is the next small step?','Choose a single idea to work through.'],
  ['Build a simple map','Connect three important terms with short, meaningful relationships.','Can you explain each connection?','Verify unclear links against the sheet.'],
  ['Explain aloud','Explain a small idea as if teaching it to a classmate.','Where did your explanation become unclear?','Reread that part before continuing.'],
  ['Return later','Choose a few points from today to review in a later session.','Which points need another look?','Use your own recall and mistakes to choose them.']
 ],
 ar: [
  ['استرجع من ذاكرتك','اقرأ فقرة قصيرة، غطّها، ثم اشرحها بكلماتك.','شنو قدرت تتذكر دون النظر؟','ارجع للنقاط الناقصة ثم جرّب مرة ثانية.'],
  ['هدف صغير','اختر جزءًا صغيرًا تكمله قبل الانتقال لمهمة أخرى.','شنو بتكمل توّا؟','حدد نطاق صفحات يناسب قدرتك الحالية.'],
  ['قارن فكرتين','اكتب وجه تشابه ووجه اختلاف بين مفهومين في الصفحة.','وين تتأكد من الفرق؟','راجع الصياغة الموجودة في الشيت.'],
  ['حوّل العنوان لسؤال','قبل قراءة الفقرة، حوّل عنوانها إلى سؤال.','تقدر تجاوب عليه بعد القراءة؟','قارن إجابتك بما ورد في الفقرة.'],
  ['مثال بسيط','كوّن مثالًا باستخدام المعلومات الموجودة في الشيت فقط.','هل المثال يطابق التعريف؟','عدّل المثال إذا خالف المصدر.'],
  ['افهم سبب الخطأ','بعد إجابة خاطئة، حدد لماذا بدا اختيارك مقنعًا.','شنو التفصيل اللي فاتك؟','اكتب تذكيرًا قصيرًا وراجعه عند المحاولة القادمة.'],
  ['استراحة قصيرة','لو تكرر القراءة دون فهم، توقف قليلًا ثم ارجع لجزء أصغر.','شنو الخطوة الصغيرة القادمة؟','اختر فكرة واحدة تركز عليها.'],
  ['خريطة بسيطة','اربط ثلاثة مصطلحات مهمة بعلاقات قصيرة وواضحة.','تقدر تشرح كل علاقة؟','تأكد من الروابط غير الواضحة في الشيت.'],
  ['اشرح بصوتك','اشرح فكرة صغيرة كأنك تعلّم زميلًا.','وين صار شرحك غير واضح؟','راجع هذا الجزء قبل أن تكمل.'],
  ['ارجع لها لاحقًا','اختر نقاطًا من دراسة اليوم لمراجعتها في جلسة لاحقة.','أي نقاط تحتاج رجعة؟','اخترها بناءً على ما تذكرته والأخطاء التي وقعت فيها.']
 ]
};
export const companionReadyCopy = {
 en: { general: 'General study tip — not an explanation of this page.', retry: 'Retry page help', empty: 'No prepared explanation for this page yet. General study tips are available.', failed: 'Page help could not be loaded. General study tips still work.' },
 ar: { general: 'نصيحة دراسية عامة، وليست شرحًا لمحتوى الصفحة.', retry: 'إعادة تحميل شرح الصفحة', empty: 'لم يُجهّز شرح لهذه الصفحة بعد. يمكنك استخدام النصائح الدراسية العامة.', failed: 'تعذّر تحميل شرح الصفحة. النصائح الدراسية العامة متاحة.' }
};
export function generalCompanionIdeas(locale = 'en') {
 return (tips[locale] || tips.en).map(([question, explanation, followup_question, followup_answer], index) => ({
  id: `general-study-tip-${index}`, general: true, page: null, kind: 'organize', teaser: question, question, explanation, followup_question, followup_answer, saved: false
 }));
}


// Original-character enhancements: practical, local coaching only. These
// messages are deliberately NOT explanations or claims about a PDF page.
export const companionNudgeCopy = {
 en: {
  title: "A small study boost",
  source: "General study tip — check your sheet for the actual facts.",
  next: "Another tip",
  back: "Back to page help",
  action: "Quick study boost",
  quiet: "Quiet suggestions",
  quietOn: "On · bubbles hidden",
  quietOff: "Off · show bubbles",
  cards: "Idea progress"
 },
 ar: {
  title: "دفعة دراسية صغيرة",
  source: "نصيحة عامة وليست شرحًا لمعلومات الشيت. ارجع للصفحة للتأكد.",
  next: "نصيحة ثانية",
  back: "الرجوع لشرح الصفحة",
  action: "تشجيع سريع",
  quiet: "اقتراحات هادئة",
  quietOn: "مفعّل · الفقاعة مخفية",
  quietOff: "غير مفعّل · الفقاعة ظاهرة",
  cards: "تقدم بطاقات الشرح"
 }
};

const microCoaching = {
 en: [
  "Read two important lines, cover them and explain the idea from memory.",
  "Choose a term from your sheet and recall its meaning before checking.",
  "Compare two similar ideas, then write one clear difference.",
  "After this page, ask yourself which point you could recall without looking.",
  "Break a difficult section into two small parts, then check each against the sheet."
 ],
 ar: [
  "اقرأ سطرين مهمين، ثم غطّهما وحاول تشرح الفكرة من ذاكرتك.",
  "اختر مصطلحًا من الشيت وحاول تتذكر معناه قبل ما ترجع للنص.",
  "قارن بين فكرتين متشابهتين، واكتب فرقًا واحدًا واضحًا.",
  "بعد الصفحة، اسأل نفسك: شنو أهم نقطة تذكرتها من غير ما تنظر؟",
  "لو جزء صعب، قسمه لخطوتين صغيرتين وتأكد من كل خطوة في الشيت."
 ]
};

export function companionNudge(locale = "en", index = 0) {
 const ideas = microCoaching[locale] || microCoaching.en;
 const safeIndex = Number.isSafeInteger(index) && index >= 0 ? index : 0;
 return ideas[safeIndex % ideas.length];
}
