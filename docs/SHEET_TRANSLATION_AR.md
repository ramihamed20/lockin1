# ترجمة الشيتات صفحة بصفحة

ترجمة عربية كاملة ترفعها الإدارة؛ لا تحتاج API أو خدمة مدفوعة.

## الرفع من لوحة الإدارة

إدارة المحتوى ← الشيت ← Open control center ← Arabic translation.

- اختر University Sheet أو Lockin Sheet؛ لكل نسخة ترجمتها الخاصة.
- ألصق ترجمة الصفحة كاملة في المحرر ثم احفظ. تبقى المسودات أثناء التنقل بين صفحات المحرر نفسه؛ تغيير النسخة أو إغلاقه لا يحفظ النص غير المحفوظ تلقائيًا.
- أو اضغط «تنزيل قالب الصفحات»، واملأ `text` لكل صفحة، ثم ارفع ملف JSON واحدًا. تعرض الواجهة معاينة قبل الحفظ.
- رقم الصفحة هو رقمها الفعلي في PDF، بدءًا من 1، وليس الرقم المطبوع داخل الشيت.
- يمكن رفع بعض الصفحات فقط؛ الصفحات غير المذكورة تبقى محفوظة. احذف عناصر الصفحات غير المترجمة من القالب؛ الاستيراد يرفض النصوص الفارغة.
- حفظ صفحة فارغة من المحرر يزيل ترجمتها وحدها، مع الاحتفاظ برقم مراجعتها لمنع استبدال تعديل أحدث بالخطأ.

مثال مبسط:

```json
{
  "format": "lockin_translation_v1",
  "edition": "university",
  "pages": [
    { "page": 1, "text": "الترجمة العربية الكاملة للصفحة الأولى." },
    { "page": 2, "text": "الترجمة العربية الكاملة للصفحة الثانية." }
  ]
}
```

استخدم `lockin` للنسخة الأخرى. قالب الإدارة يتضمن كذلك معرّف الشيت ومعرّف PDF وبصمته لحمايته من خلط النسخ. يمكن إضافة `source_text` لكل صفحة عند الرغبة في عرض نصها الإنجليزي المكتوب أيضًا.

الحدود: ملف JSON حتى 5 ميغابايت؛ حتى 1000 صفحة في الدفعة؛ 60000 حرف لكل نص صفحة؛ مليون حرف نصي في الدفعة. قسّم الملفات الكبيرة إلى دفعات.

## تجربة الطالب

من المزيد في قارئ الشيت، افتح «الترجمة العربية». تتبع اللوحة الصفحة الحالية تلقائيًا، وتبقى صورة PDF الأصلية متاحة. عند غياب ترجمة الصفحة تظهر رسالة واضحة. تعرض اللوحة نصًا عربيًا كاملًا ولا تعيد رسم PDF. فتح الترجمات يحتاج اتصالًا؛ لا يتضمن هذا التغيير تنزيلها للاستخدام دون إنترنت.

## الحماية والتشغيل

تطبق قراءة الترجمة صلاحيات الشيت والاشتراك والمسار الجامعي وجاهزية الملف. يتطلب الرفع `content.manage`، ولا تكفي `content.view`. تبقى حماية الجلسة وCSRF فعالة.

يحفظ الخادم الترجمات لكل ملف PDF وبصمته وصفحته. تغيير الملف لا يستخدم ترجمة النسخة القديمة. تمنع مقارنة مراجعات الصفحات الكتابة فوق تعديل أحدث؛ الاستيراد ذري، فلا يحفظ جزءًا من دفعة مرفوضة. يتضمن كل حفظ سجل تدقيق، وتبقى النصوص الخاصة خارج التخزين العام والمتصفح.

شغّل الترحيلات المعتادة عند نشر الإصدار. لا ينشر رفع الفرع الميزة على VPS تلقائيًا.

## الترجمة الجماعية عبر Gemini وأداة `translate_sheets`

يتيح نظام الترجمة الجماعية إعطاء أوامر مباشرة لـ Gemini مثل:
«ترجم جميع شيتات Pathology واحفظها في الموقع» أو «ترجم شيت General Pathology — Introduction، نسخة University فقط، مع معاينة قبل الحفظ».

### القواعد الطبية الإلزامية

- ترجمة الشرح إلى العربية الأكاديمية الواضحة.
- الإبقاء على جميع المصطلحات الطبية والعلمية والتشريحية والاختصارات الإنجليزية كما هي داخل النص (مثل `Pathology`, `Apoptosis`, `Necrosis`, `Hypertrophy`, `Hyperplasia`, `Atrophy`, `Metaplasia`, `Ischemia`, `Hypoxia`, `ATP`, `ROS`, `Caspases`, `Cytochrome c`).
- فحص تلقائي لكل صفحة للتحقق من بقاء المصطلحات الإنجليزية المستخرجة من `source_text` محفوظة داخل `translated_text`.
- عدم الحفظ المباشر: يجب توليد معاينة موقّعة (`preview_token`) ومراجعتها قبل الحفظ النهائي، ولا يستخدم النظام أي API خارجي مدفوع تلقائيًا.

### آلية عمل Gemini عبر اشتراك Google AI Pro (`agy`) دون API مدفوع

- تستخدم أداة `manage.py translate_sheets --action translate` (أو `--translate-with-gemini`) أداة **Antigravity CLI (`agy`)** المثبتة محليًا والمرتبطة باشتراك **Google AI Pro** الخاص بك مباشرةً.
- **لا يتم استخدام أي مفتاح Gemini API منفصل أو فوترة API مدفوعة (Zero Paid API Billing)**.
- تقوم الأداة باستخراج النص الإنجليزي (`source_text`) والمصطلحات الطبية الإلزامية (`required_medical_terms`) لكل صفحة من ملف الـ PDF، ثم ترسلها على دفعات (`--batch-size 5`) إلى Gemini عبر `agy` لترجمتها تلقائيًا إلى العربية مع الحفاظ على جميع المصطلحات الطبية الإنجليزية والرسوم (`[Diagram]`) والجداول (`[Table]`) والأرقام، ثم تُنشئ معاينة كاملة (`preview_token` + تقرير Markdown) دون حفظ أي شيء في الإنتاج قبل المراجعة.

### أوامر سطر الأوامر (`manage.py translate_sheets`)

1. **فحص الشيتات المتاحة لمادة أو شيت محدد**:
   ```bash
   python manage.py translate_sheets --subject "Pathology" --edition university --action inspect
   ```
2. **استخراج نصوص PDF والمصطلحات الطبية لكل صفحة (Manifest)**:
   ```bash
   python manage.py translate_sheets \
     --subject "Pathology" \
     --edition university \
     --action extract \
     --output /tmp/pathology_manifest.json
   ```
3. **الترجمة التلقائية الكاملة عبر Gemini (`--action translate`) وإنتاج معاينة قبل الحفظ دون إدخال ترجمة يدوية**:
   ```bash
   python manage.py translate_sheets \
     --sheet "General Pathology — Introduction" \
     --edition university \
     --action translate \
     --single-format \
     --batch-size 5 \
     --effort low \
     --output /tmp/general_pathology_intro_gemini_translated.json \
     --preview-markdown docs/previews/GENERAL_PATHOLOGY_INTRODUCTION_UNIVERSITY_PREVIEW_AR.md
   ```
4. **إنتاج معاينة لملف ترجمة JSON جاهز (مع رمز معاينة موقّع وتقرير Markdown)**:
   ```bash
   python manage.py translate_sheets \
     --sheet "General Pathology — Introduction" \
     --edition university \
     --action preview \
     --input /tmp/general_pathology_intro_gemini_translated.json \
     --output /tmp/preview.json \
     --preview-markdown docs/previews/GENERAL_PATHOLOGY_INTRODUCTION_UNIVERSITY_PREVIEW_AR.md
   ```
5. **الحفظ النهائي بعد اعتماد المعاينة (`preview_token`)**:
   ```bash
   python manage.py translate_sheets \
     --sheet "General Pathology — Introduction" \
     --edition university \
     --action save \
     --input /tmp/general_pathology_intro_gemini_translated.json \
     --preview-token "<PREVIEW_TOKEN>"
   ```

### نقطة نهاية الاستيراد والمعاينة في الخادم

- `GET /api/v1/operations/admin/content/sheets/<sheet_id>/translations/import?edition=university`
  تُرجع قالب الشيت مع استخراج نص PDF (`source_text`) والمصطلحات الطبية المكتشفة لكل صفحة، وتدعم `?subject=<subject>` لاستخراج جميع شيتات المادة دفعة واحدة (`lockin_translation_batch_v1`).
- `POST /api/v1/operations/admin/content/sheets/<sheet_id>/translations/import`
  - عند الإرسال **دون `preview_token`** (أو مع `confirm: false`): يتحقق الخادم من الصلاحيات وبصمة الملف (`checksum`) ومراجعات الصفحات (`expected_revision`) والمصطلحات الطبية، ويُرجع معاينة كاملة (`saved: false`) مع `preview_token` موقّع دون تعديل قاعدة البيانات.
  - عند الإرسال **مع `preview_token` و`confirm: true`**: يتحقق الخادم من تطابق البصمة والـ `preview_token` ويحفظ الترجمات ذريًا مع تسجيل حدث التدقيق.

## التحقق

نجح 27 اختبارًا لنظام ترجمة الشيتات في الخادم (`test_sheet_translation.py` و`test_sheet_translation_batch.py`) و37 اختبارًا للواجهة، مع فحص الأنواع (`mypy`) والتنسيق (`ruff`) وفحص Django. اختبار SQLite يثبت السلوك والصلاحيات ولا يثبت أقفال PostgreSQL تحت التزامن. لقطات الواجهة السابقة استخدمت بيانات تجريبية محلية، ولا تمثل اعتمادًا على أجهزة حقيقية أو إثبات نشر.
