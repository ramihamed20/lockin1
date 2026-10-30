# تجربة Lockin على الهاتف عبر GitHub Codespaces

هذه بيئة تطوير **منفصلة تمامًا عن الإنتاج**، وليست نسخة متصلة بقاعدة بيانات الطلاب.

## تشغيلها من الهاتف

1. افتح هذا الرابط وسجّل الدخول لحساب GitHub الخاص بك:
   https://codespaces.new/ramihamed20/lockin1/tree/codex/lockin0.1.5
2. اضغط **Create codespace**. يحتاج حسابك سماح GitHub Codespaces.
3. يبدأ إعداد Docker وPostgreSQL وDjango وReact وتحميل بيانات تجريبية تلقائيًا.
4. في تبويب **PORTS** افتح منفذ **5173 — Lockin (private phone preview)** ثم **Open in Browser**.
5. تسجيل الدخول بحساب تجريبي فقط: **student@lockin.local** وكلمة المرور **Student123!**
6. افتح **Study Plan** أو الرابط `/#/study-plan`. ستحصل على 3 مواد و12 شيتًا تقريبيًا وامتحان تجريبي. قد تختلف أعداد الشيتات إذا تغيّر محتوى seed_demo.

**مهم:** منفذ 5173 يجب أن يبقى **Private**. لا تضف حسابك الحقيقي أو أسرار موقع الإنتاج. على الأجهزة المحمولة قد تكون واجهة VS Code ثقيلة؛ بعد بدء Codespace افتح رابط المنفذ مباشرة في Safari.

## حالة الأعطال

- إن كان 5173 غير ظاهر، افتح **PORTS** وأضف `5173`.
- إذا توقف التشغيل، نفّذ `bash .devcontainer/start.sh` من طرفية Codespace.
- إن ظهرت مشكلة في Docker، اختر **Rebuild Container** في Codespaces.
- سجلات الخدمات: `docker compose ps` و`docker compose logs --tail 80 backend frontend db`.
- الإيقاف: `docker compose stop`. لا تجعل منفذ التطبيق Public لأن بيانات الدخول التجريبية معروفة.
- Codespaces قد يُوقف آليًا عند الخمول، وقد يخضع لحدود استخدام/فوترة GitHub.

لا يشغّل GitHub connector أكواد Codespaces نيابة عن مالك الحساب؛ إنشاء Codespace وضبط موارد الحوسبة يتطلبان إجراءك من حساب GitHub.
