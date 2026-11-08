# تشغيل Lock-in كتجريبية مستقلة

الحالة: ملفات إعداد قابلة للمراجعة. لا تعني وجود سيرفر شغال أو DNS مفعّل.

العنوان المستهدف `https://staging.lockin.ly`، من الدومين الحالي. اخترنا Cloudflare
Tunnel لهذه النسخة حتى لا تحتاج إعادة ضبط حاوية edge التي تخدم الطلاب على 80/443.
لا تضف سجل A للعنوان نفسه مع Tunnel؛ إعداد Public Hostname ينشئ مسار DNS الخاص بالنفق.

## الحدود

- نفس React/Django/PostgreSQL الفعلي. البيانات تبدأ بقاعدة جديدة، وليست نسخة من حسابات الطلاب.
- حاويات وشبكات وvolumes وأسرار مستقلة تحت مشروع `lockin-staging`.
- لا توجد منافذ منشورة على السيرفر. الوصول عبر Tunnel فقط، ثم كلمة دخول خارجية، ثم تسجيل دخول الموقع.
- مفاتيح Offline جديدة، ومفتاح التحقق العام يجب أن يطابق بناء واجهة التجريبية.
- البريد إلى Mailpit داخل الشبكة؛ أكواد OTP تظهر على `/__mail/` خلف كلمة الدخول الخارجية.
- Google/Apple وTelegram والإشعارات الخارجية غير مهيأة. لا تستخدم مفاتيح الإنتاج.
- ماسح الملفات غير مفعّل، ورفع الملفات محصور بالمجرّبين الموثوقين.
- مزامنة بيانات الإنتاج أو نسخها، ترقية main، ونشر الأساسية ليست ضمن هذه الإجراءات.

## المطلوب على السيرفر

Docker Compose 2.24.4 أو أحدث، Python 3، OpenSSL، صلاحية sudo، ومساحة وذاكرة تكفي
للنسختين. أمر التشغيل يرفض إن كانت MemAvailable أقل من 1800 MiB. هذا حد بداية
للتجربة وليس ضمان أداء. إن لم تتوفر السعة استخدم سيرفرًا منفصلًا.
يجب ألا تتعارض شبكة `172.30.88.0/24` مع شبكة أخرى موجودة.

## 1 — Checkout مستقل

لا تغيّر فرع المجلد الذي تستخدمه لنشر الأساسية. من حساب السيرفر العادي:

```sh
git clone --branch staging/lockin-preview https://github.com/ramihamed20/lockin1.git lockin-staging
cd lockin-staging
git rev-parse HEAD
sudo python3 scripts/staging/prepare.py --commit "$(git rev-parse HEAD)"
```

الأمر يولّد أسرارًا جديدة على السيرفر، ويرفض استبدال إعداد موجود. يحفظ كلمة الدخول
الخارجية في `.runtime/staging/access.txt`؛ لا ترسل هذا الملف أو أسرارًا في المحادثة.
الاسم الخارجي `preview` وكلمة السر التي في الملف، إضافة إلى حساب المستخدم داخل الموقع.

## 2 — بناء الصور خارج السيرفر

انسخ المفتاح **العام فقط** الذي طبعه prepare.py إلى Repository variable في GitHub:

`Settings → Secrets and variables → Actions → Variables → New repository variable`

الاسم `LOCKIN_STAGING_OFFLINE_LEASE_PUBLIC_KEY`، والقيمة المفتاح العام المطبوع.
Workflow `Staging images (no production deployment)` يعمل عند push لفرع `staging/**`.
إن كانت أول محاولة فشلت بسبب غياب المتغير، أعد تشغيل نفس المحاولة بعد إضافته.
يجب نجاح البناء للصورة `staging-<full commit SHA>` قبل التشغيل. لا تضع مفتاحًا خاصًا في GitHub.
لا نغيّر workflow الجودة أو صور main أو كاش بناء الإنتاج.

إذا كانت حزم GHCR خاصة، سجّل دخول Docker لحساب يستطيع قراءتها باستخدام
`docker login ghcr.io` بالطريقة التفاعلية. عند استعمال sudo تكون بيانات Docker
للمستخدم root؛ استخدم `sudo docker login ghcr.io` إن لزم. لا ترسل رمز الدخول في المحادثة.

## 3 — التشغيل الداخلي

```sh
sudo sh scripts/staging/control.sh start
sudo sh scripts/staging/control.sh status
sudo sh scripts/staging/control.sh admin
```

الأمر الأخير تفاعلي: أنشئ حساب إدارة جديدًا للتجريبية. أضف حسابات الطلاب والشيتات
من التجريبية نفسها؛ لا توجد حسابات بكلمات مرور افتراضية ولا نسخ لقاعدة الإنتاج.
راجع أن backend أصبح healthy في status قبل ربط النفق.

## 4 — Cloudflare

من حساب الدومين، افتح صفحة إدارة Tunnels واختر نفق Cloudflared جديدًا باسم
`lockin-staging`. احفظ token النفق الجديد **على السيرفر فقط**؛ لا تشارك رمز الحساب العام.
Public Hostname:

- Subdomain: `staging`
- Domain: `lockin.ly`
- Service type: `HTTP`
- URL: `edge:8080`

في Terminal على السيرفر، من مجلد lockin-staging، احفظ الرمز بإدخال مخفي:

```sh
sudo bash -c 'umask 077; read -rsp "Staging tunnel token: " token; printf "\n"; printf "%s\n" "$token" > .runtime/staging/tunnel_token; chmod 0444 .runtime/staging/tunnel_token'
sudo sh scripts/staging/control.sh connect
```

TLS ينتهي عند Cloudflare؛ الرابط الخارجي HTTPS، والمسار الداخلي غير منشور.
لا تستخدم Quick Tunnel أو noTLSVerify ولا تربط النفق بـ localhost الخاص بحاوية أخرى.
أي Cache Rule قديمة تتسع لكل subdomains يجب استثناء `staging.lockin.ly` منها، خصوصًا API.

## 5 — التحقق والتحديث

افتح الرابط بعد ظهور النفق Healthy. يجب أن يطلب كلمة الدخول الخارجية، ثم يظهر
Lock-in مع علامة «نسخة تجريبية». جرّب حسابًا جديدًا وأكواد التحقق عبر صندوق البريد،
ورفع PDF، والملاحظات، والأسئلة، والمراجعة، والخطة، ثم الهاتف والآيباد وOffline.

للتحديث: احفظ مفاتيح التجريبية الحالية، حدّث checkout التجريبي إلى commit البناء
المطلوب، وعدّل `LOCKIN_IMAGE_TAG` في `.env.staging` إلى `staging-<SHA>` مطابق للبناء،
ثم شغّل start. لا تعِد prepare.py ولا تغيّر مفتاح Offline إلا إذا كنت تقصد تدويره وبناء الواجهة من جديد.
لا تشغّل تحديث checkout أثناء وجود اختبار جارٍ، لأن إعداد Nginx مربوط منه.

لإيقاف التجريبية مع إبقاء بياناتها:

```sh
sudo sh scripts/staging/control.sh stop
```

لا يوجد أمر حذف volumes في هذه الأدوات. اعتمد التعديل بعد الاختبار ثم افتح PR للدمج
وفق دورة النشر المعتادة. نجاح بناء التجريبية ليس اعتمادًا لنشر الإنتاج.

## تصحيح رمز نفق غير صالح

إذا كانت الحاوية موجودة لكن سجلها يعرض `Provided Tunnel token is not valid`، نفّذ:

```sh
sudo python3 scripts/staging/save_tunnel_token.py
```

عندما يطلب الإدخال، الصق أمر Docker كاملًا من صفحة تثبيت النفق في Cloudflare.
الأداة لا تنفذ الأمر المنسوخ؛ تستخرج الرمز وتتحقق من بنيته وتخزنه دون طباعته،
ثم تعيد تشغيل حاوية النفق التابعة لمشروع `lockin-staging` فقط.

## رابط مؤقت بدون حساب Cloudflare

إذا تعطل رمز النفق، يمكن عرض نفس تطبيق التجربة عبر HTTPS مؤقت:

```sh
cd ~/lockin-staging && git pull --ff-only && sudo sh scripts/staging/control.sh preview
```

الأمر يستخرج عنوان `trycloudflare.com`، ويضبط نطاق Django وCSRF عليه، ثم يعيد تهيئة حاويات التطبيق التجريبي فقط باستخدام الصور الموجودة. لا يعيد المهاجرات ولا يغير مفاتيح التوقيع أو بيانات الإنتاج. تبقى بوابة اسم المستخدم وكلمة المرور مفعلة. لعرض بياناتها محليًا:

```sh
sudo cat ~/lockin-staging/.runtime/staging/access.txt
```

لا ترسل كلمة المرور في المحادثة. الرابط مؤقت ويعمل ما دام النفق يعمل؛ تشغيل أمر `preview` مرة أخرى ينشئ رابطًا جديدًا. يتوقف نفق Cloudflare المسمى للتجربة بعد نجاح تجهيز الرابط المؤقت. هذا الخيار مخصص للمراجعة؛ بعض الميزات مثل بث SSE لا تدعمها Quick Tunnels.

## تطوير الواجهة مباشرة عند الحفظ

لتشغيل Vite داخل حاوية مستقلة خلف بوابة التجربة ونفس قاعدة بيانات التجربة:

```sh
cd ~/lockin-staging && git pull --ff-only && sudo sh scripts/staging/control.sh dev
```

التثبيت الأول للمكتبات قد يستغرق عدة دقائق. يظهر رابط HTTPS مؤقت عند اكتمال التجهيز. افتحه في المتصفح، ثم عدّل ملفات `~/lockin-staging/frontend/src` على السيرفر؛ الحفظ يرسل تحديث HMR دون بناء صورة Docker. لا توجد منافذ عامة جديدة، ولا مفاتيح خاصة داخل حاوية الواجهة. تظل API على backend التجريبي ولا يتغير الإنتاج. يلزم توفر نحو 768 MiB إضافية لحاوية التطوير؛ لها حد ذاكرة مستقل.

إذا وصلت التعديلات عبر GitHub بدل تحرير الملفات على السيرفر، اسحبها أولًا:

```sh
cd ~/lockin-staging && git pull --ff-only
```

التغييرات في React وCSS تظهر مباشرة. تعديل ملفات المكتبات يستلزم إعادة أمر `dev` لتثبيتها، وتغييرات backend لا تستفيد من HMR وتحتاج تحديث صورته. لا تثبت هذه النسخة على الشاشة الرئيسية؛ استخدم المتصفح لاختبار التطوير.

للعودة إلى واجهة التجربة المبنية، مع الاحتفاظ بالرابط والبيانات:

```sh
sudo sh ~/lockin-staging/scripts/staging/control.sh dev-off
```
