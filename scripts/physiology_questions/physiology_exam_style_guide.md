# دليل أسلوب أسئلة الفسيولوجي — سنة أولى طب أسنان (Physiology Exam-Style Guide)

> مبني على دليل أسلوب امتحان **Dental Anatomy** (`PRE EXAM 1 — Past Exam Questions`) مع تكييفه علمياً لمادة **Physiology (سنة أولى أسنان)** وتوافقه الكامل مع مدققات منصة **Lock-in** (`all_questions.py` و`active_study_questions.py` و`questions/importing.py`).

---

## 1) التوافق مع نظام Lock-in وأنواع الأسئلة

في دليل Dental Anatomy الأصلي، توزيع الأنواع هو:
- `MCQ` (4 خيارات A–D دائماً): ~66%
- `True / False`: ~18%
- `Complete` (أكمل الفراغ بإجابة قصيرة 1–6 كلمات): ~16%
- أسئلة مقالية / علل / شرح / رسم: **0%**

### التكييف المطلوب في Lock-in
مدققات Lock-in (`validate_all_questions` و`validate_active_study_questions` و`validate_question_import`) لا تقبل نوع `complete` كنص حر؛ الأنواع المعتمدة في `All Questions` هي **`mcq`** و**`true_false`** فقط:
- **النسبة المستهدفة في Lock-in:** **~82% `mcq`** (تضم ~66% MCQ مباشر + ~16% أسئلة إكمال مصطلح/تعريف محوّلة إلى `mcq` من 4 خيارات) + **~18% `true_false`**.
- **صفر** أسئلة مقالية، وصفر أسئلة "علل/Explain"، وصفر أسئلة معتمدة على صور غير موصوفة نصياً.
- يُحظر تماماً كتابة `"according to the sheet"` أو `"in the figure"`.

---

## 2) قواعد صياغة السؤال (Stem Patterns)

1. **طول السؤال ولغته:** إنجليزي، مباشر، قصير (غالباً **8–15 كلمة**)، دون مقدمات أو سيناريو سريري مطوّل.
2. **علامة الترقيم في MCQ:** ينتهي الـ Stem بنقطتين **` : `** (وليس علامة استفهام)، بصيغة تعريف أو إكمال جملة مباشرة.
3. **تكبير الكلمات المفتاحية (UPPERCASE):** لتمييز القيود والمفاتيح المنطقية مثل:
   `ONLY`, `NOT`, `EXCEPT`, `PRIMARY`, `MAIN`, `FIRST`, `HIGHEST`, `LOWEST`, `INCREASE`, `DECREASE`, `INTRACELLULAR`, `EXTRACELLULAR`, `MOST`.
4. **أوزان الصيغ في MCQ:**
   - **إكمال جملة / تعريف مباشر (~65%):** `The PRIMARY intracellular cation is:`, `The membrane potential at which net ion flux is zero is called:`
   - **`Which of the following ...` / `Which ... TRUE` (~17–20%):** `Which of the following factors DECREASES heart rate:`, `Which of the following statements is TRUE regarding resting membrane potential:`
   - **أرقام / قيم طبيعية / نسب / مدد (~20–25%):** `The normal resting membrane potential of a large nerve fiber is:`, `Total body water in an average 70-kg adult male represents:`
   - **تفضيل / حصر (`HIGHEST`, `FASTEST`, `MAIN`, `ONLY`):** ~15%
   - **`EXCEPT` / `NOT`:** **نادرة جداً (~3%)** — لا تُكثر منها.
   - **شرطية (`When ...`, `During ...`, `Following ...`):** ~5–6%.
5. **صيغة `True / False`:**
   - جملة خبرية واحدة واضحة تنتهي بنقطة `.` (بدون علل).
   - لصنع عبارة `false`: غيّر **تفصيلة واحدة دقيقة فقط** (اتجاه الزيادة/النقصان، أيون/موضع داخل الخلية مقابل خارجها، رقم مرجعي، أو إضافة كلمة حصر خاطئة مثل `ONLY` أو `ALL`).
   - العبارات الصحيحة (`true`) حقائق مباشرة بدون كلمات حصر مطلقة قدر الإمكان.

---

## 3) بناء الخيارات والمشتتات الفسيولوجية (4 خيارات A–D دائماً)

- جميع الخيارات قصيرة (**1–6 كلمات** غالباً)، ما عدا أسئلة `Which statement is TRUE` النادرة.
- يجب أن تكون الخيارات الأربعة متجانسة ومن **نفس الفئة العلمية** (لا مشتتات عشوائية).

### الأساليب السبعة للمشتتات في Physiology:
1. **قلب الاتجاه أو الآلية (Opposite direction / mechanism):**
   - `Increases` ↔ `Decreases` · `Depolarization` ↔ `Hyperpolarization` · `Stimulates` ↔ `Inhibits` · `Intracellular` ↔ `Extracellular`.
2. **تبديل عناصر من نفس المجموعة (Sibling physiological entities):**
   - أيونات: `Na+ / K+ / Ca2+ / Cl-`
   - عضيات/مكونات غشاء: `Rough ER / Smooth ER / Golgi apparatus / Lysosome`
   - مستقبلات/نواقل: `Nicotinic / Muscarinic / Alpha-1 / Beta-2`
3. **مصطلحات متقاربة تلتبس على الطالب (Confusable terms):**
   - `Osmolarity / Osmolality / Tonicity / Oncotic pressure`
   - `Primary active transport / Secondary active transport / Facilitated diffusion / Simple diffusion`
   - `Negative feedback / Positive feedback / Feedforward control`
4. **أرقام وقيم مجاورة (Adjacent numerical values):**
   - مثلاً: `-90 mV / -70 mV / -55 mV / +35 mV` أو `60% / 40% / 20% / 15%`.
5. **نمط المقارنة الرباعي (`Greater / Less / Equal / None`):**
   - مثلاً: `Higher than ... / Lower than ... / Equal to ... / None of the above` (الإجابة الصحيحة تكون غالباً `A` أو `B`، بينما `Equal/Same` و`None` نادراً ما تكون صحيحة).
6. **تبديل الترتيب في العلاقة (Permutation):**
   - مثلاً في تدرج التراكيز أو التسلسل: `Higher inside and lower outside` مقابل `Lower inside and higher outside`.
7. **مشتتات من جزئية مجاورة في نفس الشيت:** استثمار المفاهيم القريبة في نفس الصفحة/الفقرة لتوليد مشتتات واقعية دون تكرار السؤال حرفياً.

---

## 4) الخيارات الخاصة (Meta Options) وتوزيع الإجابات

- **الموضع:** خيارات الميتا (`None of the above`, `All of the above`, `A and B`, `A and C`, `B and C`) تُوضع **في الخيار `D` فقط** ولا تُوضع أبداً في A أو B أو C.
- **النسبة:** تظهر في **~25% (حتى ~27%)** من أسئلة الـ MCQ.
  - `None of the above` هي الأكثر، وتكون صحيحة نادراً (~5–10% من ظهورها).
  - التركيبات مثل `A and B` أو `B and C` تظهر مع أسئلة الاختيار المتعدد الخصائص وتكون صحيحة في نحو نصف حالاتها.
  - `All of the above` نادرة جداً (~2% من الأسئلة).
  - **إجمالاً:** عندما يكون `D` خيار ميتا، لا يكون هو الإجابة الصحيحة في **~80–82%** من الحالات (أي يصح في ~18–20% فقط).
- **توازن حروف الإجابة الصحيحة (A / B / C / D):**
  - النسب المستهدفة: **`A ≈ 27% · B ≈ 31% · C ≈ 22% · D ≈ 20%`** (تقريباً متوازنة مع زيادة طفيفة في B وتقليل طفيف في D بسبب الميتا، وبحيث لا يتجاوز أي حرف 31% ولا يقل عن 18%).
  - يُمنع تكرار نفس الحرف الصحيح **3 مرات متتالية** (`AAA` أو `BBB` مرفوض).
- **توازن `True / False`:** قريب من **50% `true` / 50% `false`**.

---

## 5) تكييف مستويات الصعوبة في Lock-in بنفس الأسلوب

| المستوى | التركيز العلمي | أسلوب الصياغة |
|---|---|---|
| **Easy** | التذكّر المباشر: التعريفات، القيم الطبيعية، الأيونات/المستقبلات الأساسية | `The X is:` · `Normal value of X is:` · `T/F` مباشرة (بدون تعقيد) |
| **Medium** | الفهم والمقارنة والتفسير: آليات النقل، المقارنات بين طورين أو حجرتين، تأثير التغيرات | `Which of the following INCREASES/DECREASES X:` · مقارنات + `T/F` بتبديل تفصيلة |
| **Hard** | التمييز الدقيق والربط متعدد الخطوات داخل نفس الشيت (بدون معلومات خارجية) | علاقات سببية مركّبة، تفاعلات أيونية/فسيولوجية متقابلة، `Which statement is TRUE`, `EXCEPT` النادرة |

---

## 6) نص جاهز للصق في خانة `Exam-Style Reference` داخل Lock-in Admin (أقل من 6000 حرف)

```text
PHYSIOLOGY EXAM STYLE (Adapted from the supplied Dental Anatomy Past-Exam Style Guide for 1st-Year Dentistry):

1) QUESTION MIX & STRICT FORMAT COMPATIBILITY
- Generate ONLY "mcq" (~82%) and "true_false" (~18%). Never emit "complete", fill-in-the-blank, essay, or "why/explain" questions.
- Convert completion-style recall items (originally ~16% of past exams) into 4-option MCQs with short 1–6 word term/value options.
- Target per-bank mix: ~82% MCQ and ~18% True/False (keep T/F balanced roughly 50% true / 50% false).

2) STEM RULES (SHORT, DIRECT, NO CLINICAL VIGNETTES)
- Write short, direct English stems (typically 8–15 words). No long scenarios, no "according to the sheet", no image-dependent phrasing.
- End MCQ stems with a colon ":" instead of a question mark (e.g., "The PRIMARY intracellular cation is:").
- Capitalize key constraints and qualifiers in UPPERCASE: ONLY, NOT, EXCEPT, PRIMARY, MAIN, HIGHEST, LOWEST, INTRACELLULAR, EXTRACELLULAR, INCREASE, DECREASE, FIRST, LAST.
- Dominant stem patterns:
  * ~65%: Direct sentence completion / definition ("The X is:", "The process of X is called:", "The normal value of X is:")
  * ~17–20%: "Which of the following ..." / "Which statement is TRUE regarding ..."
  * ~15%: Superlatives/exclusives (HIGHEST, MAIN, ONLY, PRIMARY)
  * ~3%: Negative stems (EXCEPT / NOT) — keep rare!
- Focus on high-yield definitions/terminology (~28%), numerical values/concentrations/thresholds (~25%), comparisons between compartments/mechanisms/ions (~25%), classification/counts (~10%), and physiological mechanisms/cause-effect (~12%, kept concise and strictly grounded in the sheet).

3) MCQ OPTIONS & DISTRACTORS (ALWAYS 4 OPTIONS A–D)
- All four options A–D must be short (1–6 words when possible; longer only for rare "Which statement is true" stems) and belong to the SAME physiological category:
  1. Opposite direction/compartment (increase vs decrease; depolarization vs hyperpolarization; ICF vs ECF).
  2. Sibling physiological entities (Na+/K+/Ca2+/Cl-; Golgi/ER/lysosome/mitochondria; alpha/beta/muscarinic/nicotinic).
  3. Confusable terms (osmolarity vs osmolality vs tonicity; facilitated diffusion vs active transport).
  4. Plausible adjacent numbers/units from the same physiological scale.
  5. Comparison pattern ("Higher than...", "Lower than...", "Equal to...", "None of the above") where A or B is usually correct.
  6. Order/relationship permutations (e.g., inside/outside gradients reversed).

4) META OPTIONS & ANSWER DISTRIBUTION
- Meta options ("None of the above", "A and B", "A and C", "B and C", rare "All of the above") MUST ONLY appear in option "D", never in A, B, or C.
- Include a meta option in D in ~25% of MCQs (mostly "None of the above" for comparison items or "A and B"/"B and C" for multi-property items; keep "All of the above" very rare).
- When D is a meta option, make D the correct answer only ~18–20% of the time (~80% of meta D options are distractors).
- Overall correct MCQ letter distribution target: ~27% A, ~31% B, ~22% C, ~20% D (balanced, no letter exceeding 31%, and NEVER repeat the same correct letter 3 times in a row).

5) TRUE/FALSE RULES
- Single declarative sentence ending with a period ".".
- Balance TRUE (~50%) and FALSE (~50%).
- Construct FALSE statements by changing ONE specific physiological detail from a true sheet fact (direction, ion/compartment, value, or adding an unwarranted qualifier like ONLY/ALL).
- Include a concise 1-sentence scientific explanation for every MCQ and True/False item.
```
