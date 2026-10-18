# Capability inventory

Reviewed 2026-10-12 against branch codex/public-search-visibility. Availability is based on implemented routes and existing tests; it does not certify current live content or outbound email. See public-knowledge.json for exact evidence digests and conditions.

| Capability | Status | Student entry | Conditions | Evidence |
|---|---|---|---|---|
| Lockin | available | /#/ | المحتوى يتحدد حسب المسار والصلاحيات؛ لا يعني توفر كل مادة لكل طالب. | frontend/src/App.jsx, frontend/src/lib/materialCatalog.js, frontend/tests/materials-catalog.test.js |
| الشيتات وقارئ PDF | conditional | /#/materials | شيت منشور وقابل للتسليم وصلاحية المحتوى بحسب الحساب. | frontend/src/pages/Materials.jsx, frontend/src/components/learning/CatalogSheetCard.jsx, backend/apps/content/tests/test_catalog_workspace.py |
| أدوات الملاحظات والكتابة | available | /#/materials | داخل مساحة PDF المسموح بها؛ الحفظ والمزامنة يتأثران بالاتصال. | frontend/src/pages/CatalogFocusWorkspace.jsx, backend/apps/focus/annotation_services.py, backend/apps/focus/tests/test_annotation_document_scope.py, frontend/e2e/focus-workspace-persistence.spec.js |
| Active Study | conditional | /#/materials | شيت جاهز بأسئلة منشورة للمستوى المختار؛ ليست متاحة لكل شيت. | frontend/src/pages/CatalogFocusWorkspace.jsx, backend/apps/focus/managed_active_study.py, backend/apps/focus/tests/test_managed_active_study.py |
| الأسئلة | conditional | /#/questions | مصادر وأسئلة منشورة ضمن المسار؛ Mix غير متاحة. | frontend/src/pages/Questions.jsx, frontend/src/components/learning/PracticeQuestions.jsx, backend/apps/content/tests/test_catalog_questions.py |
| بنك المراجعة | available | /#/review | الإجابات المدعومة التي يسجلها نظام المراجعة فقط. | frontend/src/pages/Review.jsx, backend/apps/review/services.py, backend/apps/review/tests/test_api.py, frontend/e2e/review-bank.spec.js |
| Weekly Recall | conditional | /#/review/weekly | يتطلب وجود أسئلة متقنة مؤهلة؛ لا يظهر اختبار فارغ. | frontend/src/pages/Review.jsx, backend/apps/review/policy.py, backend/apps/review/views.py, backend/apps/review/tests/test_review.py |
| التقدم | available | /#/progress | بيانات النشاط المسجلة؛ لا ضمان لتحسن أكاديمي أو ترتيب. | frontend/src/pages/Progress.jsx, frontend/src/api/motivation.js |
| التقارير الدورية | conditional | /#/weekly-summary | تقرير مولد ومتاح للحساب؛ نشاط كافٍ وفق سياسة التقارير. | frontend/src/pages/Biweekly.jsx, backend/apps/biweekly/services.py, backend/apps/biweekly/tests/test_biweekly.py |
| الحساب وتسجيل الدخول | available | /#/settings?section=account | حساب صالح وصلاحيات الخدمة؛ وصول البريد الفعلي يحتاج فحصًا منفصلًا. | frontend/src/components/auth/AuthPage.jsx, frontend/src/pages/Settings.jsx, frontend/src/api/accounts.js, backend/apps/accounts/tests/test_api.py |
| الدعم والملاحظات | available | /#/settings?section=support | مركز معرفة عام، ونموذج الاقتراحات للمستخدم المسجل. | frontend/src/pages/Settings.jsx, frontend/src/pages/Feedback.jsx, backend/apps/feedback/tests/test_api.py |
| تغيير كلمة المرور | needs_verification | /#/settings?section=account | يوجد نموذج وAPI واختبارات؛ تعليمات التنفيذ معلقة حتى التحقق من التدفق الحالي. | frontend/src/pages/Settings.jsx, backend/apps/accounts/tests/test_security_regressions.py |
| استعادة كلمة المرور | needs_verification | /#/ | لم يُختبر استلام رسالة استعادة حقيقية؛ لا ننشر خطوات تفترض وصولها. | frontend/src/components/auth/AuthPage.jsx, backend/apps/accounts/tests/test_email_delivery.py |
| تغيير البريد | needs_verification | /#/profile | يحتاج تحقق واجهة واستلام رسالة تأكيد حقيقية. | frontend/src/pages/Profile.jsx, frontend/src/api/accounts.js |
| حذف الحساب | partial | /#/settings?section=account | طلب وتأكيد متاحان برمجيًا؛ المعالجة النهائية مرتبطة بسياسة الاحتفاظ المعتمدة. | frontend/src/pages/Settings.jsx, docs/ACCOUNT_DELETION_RETENTION.md |
| الدراسة الجماعية | coming_soon | /#/lock-in | محجوبة بسجل إتاحة المنتج؛ My Group هو جدول مجموعات وليس دراسة جماعية مباشرة. | frontend/src/lib/featureAvailability.js, frontend/src/pages/MyGroup.jsx |
| الترتيب بين الطلاب | coming_soon | /#/ranked | محجوبة بسجل إتاحة المنتج. | frontend/src/lib/featureAvailability.js |
| خطة الدراسة | coming_soon | /#/study-plan | محجوبة بسجل إتاحة المنتج. | frontend/src/lib/featureAvailability.js |
| المجتمع | coming_soon | /#/community | محجوبة بسجل إتاحة المنتج. | frontend/src/lib/featureAvailability.js |
| Flashcards | needs_verification | No verified route | لم يُعثر على مسار طالب عامل؛ عناصر Card في القارئ ليست دليلًا على Flashcards. |  |
| Pomodoro | needs_verification | No verified route | لم يُعثر على تدفق طالب مستقل مثبت؛ مؤقت التركيز ليس إثباتًا لهذه الميزة. |  |
| اختبارات شفوية | needs_verification | No verified route | لم يُثبت مسار طالب عامل؛ لا صفحة تسويقية. |  |
