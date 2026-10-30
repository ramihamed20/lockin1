import { normalizeUserError } from "./errors.js";

// Stable codes are the contract. English validator matching is only a bridge
// for older servers which do not yet send field_codes.
const copy = {
  unknown: ["The request could not be completed. Try again, or describe the problem to support.", "تعذر إكمال العملية. حاول مجددًا، وإذا تكررت المشكلة أرسل وصف المشكلة للدعم."],
  offline: ["You’re offline. This action needs a connection before it can be confirmed.", "لا يوجد اتصال بالإنترنت. هذه العملية تحتاج اتصالًا لتأكيد نتيجتها."],
  network: ["Network error. Check your connection and try again.", "تعذر الاتصال بـ Lock-in حاليًا. حاول مجددًا بعد قليل."],
  timeout: ["The server took too long to answer. Check your connection and try again.", "استغرق تحميل البيانات وقتًا أطول من المعتاد. حاول مجددًا."],
  uncertain: ["No confirmation arrived. Check the operation’s status before sending it again.", "لم يصل تأكيد بنتيجة العملية. تحقّق من حالتها قبل إرسالها مرة أخرى."],
  invalidResponse: ["The server returned an incomplete response. Check the current state before trying again.", "وصل رد غير مكتمل من Lock-in. تحقّق من الحالة الحالية قبل المحاولة مجددًا."],
  secureSession: ["Unable to establish a secure session with the server. Try again.", "تعذر تجهيز اتصال آمن لإرسال الطلب. حاول مجددًا."],
  signIn: ["Your session has ended. Sign in again to continue.", "انتهت جلسة تسجيل الدخول. سجّل الدخول مجددًا للمتابعة."],
  credentials: ["The email or password is incorrect.", "البريد الإلكتروني أو كلمة المرور غير صحيحة. راجعهما وحاول مجددًا."],
  forbidden: ["Your account does not have access to this action. Check your access settings.", "حسابك لا يملك صلاحية هذا الإجراء. راجع حالة الوصول في حسابك."],
  notFound: ["This content is unavailable from this link. Open it from your materials list.", "هذا المحتوى غير متاح من هذا الرابط. افتحه من قائمة موادك."],
  conflict: ["This item changed in another session. Keep a copy of your changes and review the latest version before saving.", "تغير هذا العنصر من جلسة أخرى. احتفظ بنسخة من تعديلاتك وراجع أحدث نسخة قبل الحفظ."],
  rateLimit: ["Too many requests. Wait a little before trying again.", "طلبات كثيرة خلال وقت قصير. انتظر قليلًا قبل المحاولة مجددًا."],
  large: ["The uploaded data is too large. Choose a smaller file or send less data.", "حجم البيانات أكبر من الحد المسموح. اختر ملفًا أصغر أو أرسل بيانات أقل."],
  media: ["This file type is not supported here. Choose a supported file.", "نوع الملف غير مدعوم هنا. اختر ملفًا من الأنواع المسموحة."],
  service: ["Lock-in is temporarily unavailable. Try again shortly.", "خدمة Lock-in غير متاحة مؤقتًا. حاول بعد قليل."],
  required: ["This field is required.", "هذا الحقل مطلوب."],
  invalid: ["Check this field’s value and try again.", "قيمة هذا الحقل غير صالحة. راجعها وحاول مجددًا."],
  email: ["Enter a valid email address.", "أدخل بريدًا إلكترونيًا صحيحًا."],
  timezone: ["Choose a valid timezone.", "المنطقة الزمنية المحددة غير صالحة. اختر منطقة صحيحة."],
  duplicateDay: ["Choose each day once.", "اختر كل يوم مرة واحدة."],
  duplicateSubject: ["Choose each subject once.", "أضفت المادة نفسها أكثر من مرة. احتفظ بها مرة واحدة."],
  dayLimit: ["A day can contain at most 480 minutes and 48 sessions.", "الحد اليومي للخطة 480 دقيقة و48 جلسة. قلّل المدد أو انقل جلسة ليوم آخر."],
  future: ["You can complete this session on its planned date.", "يمكنك تسجيل إنجاز هذه الجلسة في يومها المحدد."],
  monday: ["Choose the Monday that starts this week.", "اختر يوم الإثنين الذي يبدأ به الأسبوع المطلوب."],
  codeFormat: ["Enter exactly 13 digits with no spaces or symbols.", "كود الشحن يجب أن يتكوّن من 13 رقمًا دون مسافات أو رموز."],
  duplicateCode: ["This code was already submitted. Check your payment requests before sending another.", "سبق إرسال هذا الكود. راجع طلبات الدفع قبل إرسال كود آخر."],
  file: ["The file is unavailable right now. Try later or contact support with its name.", "ملف الشيت غير متاح للعرض حاليًا. حاول لاحقًا أو أبلغ الدعم باسم الشيت."],
  sheetTitle: ["Give the sheet a valid name (up to 120 characters).", "اكتب اسمًا للشيت لا يتجاوز 120 حرفًا."],
  titleTaken: ["A sheet with this name already exists here. Choose another name.", "يوجد شيت بهذا الاسم ضمن النطاق نفسه. اختر اسمًا مختلفًا."],
  sheetLimit: ["You reached the personal sheet limit. Review your sheets before adding another.", "وصلت إلى الحد المسموح للشيتات الشخصية. راجع شيتاتك قبل إضافة شيت جديد."],
  summaryTitle: ["Give the summary a name (up to 120 characters).", "اكتب اسمًا للملخص لا يتجاوز 120 حرفًا."],
  summaryLimit: ["This sheet already has the maximum number of summaries. Back up what you need before removing one.", "وصلت إلى الحد المسموح للملخصات في هذا الشيت. احتفظ بنسخة مما تحتاجه قبل حذف أي ملخص."],
  summaryMode: ["Choose pen or keyboard for your summary.", "اختر طريقة كتابة الملخص: القلم أو لوحة المفاتيح."],
  summaryColor: ["Choose a colour from the summary palette.", "اختر لونًا متاحًا من قائمة ألوان الملخص."],
  summaryLong: ["The summary text is too long. Shorten it before saving.", "نص الملخص يتجاوز الحد المسموح. اختصره قبل الحفظ."],
  attemptClosed: ["This attempt is closed. Refresh its status to see the available result.", "أُغلقت هذه المحاولة ولم تعد تقبل تغييرات. حدّث حالتها لعرض النتيجة المتاحة."],
  answer: ["The answer could not be accepted in the current state. Refresh the question and check your answer’s status.", "تعذر قبول الإجابة في الحالة الحالية. حدّث السؤال وتحقق من نتيجة المحاولة."],
  study: ["This study action is not available in the current state. Refresh the session to continue.", "تعذر تنفيذ هذه الخطوة في حالة الدراسة الحالية. حدّث الجلسة للمتابعة."],
  review: ["This review action could not be completed. Refresh the question to continue.", "تعذر تنفيذ خطوة المراجعة في حالتها الحالية. حدّث السؤال للمتابعة."],
  outOfOrder: ["An earlier step has not synced yet. Sync the steps in order before continuing.", "توجد خطوة سابقة لم تُزامن بعد. أعد المزامنة بالترتيب قبل متابعة هذه الخطوة."],
  syncRejected: ["This change could not be synced. Review its details before retrying.", "تعذرت مزامنة هذا التغيير. راجع تفاصيله قبل إعادة المحاولة."],
  storage: ["Recent changes could not be saved on this device. Keep this page open and export a backup if possible.", "تعذر حفظ آخر تعديلاتك على هذا الجهاز. أبقِ الصفحة مفتوحة وصدّر نسخة احتياطية إذا أمكن."],
  quota: ["Storage allocated to Lock-in is full. Keep the page open and back up your work before removing any data.", "المساحة المخصصة لـ Lock-in ممتلئة. أبقِ الصفحة مفتوحة واحفظ نسخة احتياطية قبل إزالة أي بيانات."],
  storageBlocked: ["Your browser is blocking local storage. Keep the page open and back up your work before changing storage settings.", "المتصفح يمنع حفظ البيانات على هذا الجهاز. أبقِ الصفحة مفتوحة واحفظ نسخة من عملك قبل تغيير إعدادات التخزين."],
  registration: ["New registrations are temporarily unavailable.", "إنشاء الحسابات الجديدة متوقف مؤقتًا. حاول لاحقًا."],
  mail: ["Email could not be sent right now. Try again shortly.", "تعذر تجهيز إرسال البريد حاليًا. حاول بعد قليل."],
  provider: ["This sign-in method is unavailable. Choose another available method.", "طريقة تسجيل الدخول هذه غير متاحة حاليًا. اختر طريقة أخرى متاحة."],
  emailUnavailable: ["This email cannot be used for this request. Check the address or use another.", "تعذر استخدام هذا البريد لهذا الطلب. راجعه أو استخدم بريدًا آخر."],
  cohort: ["Your study path could not be changed. Check your selection and try again.", "تعذر تغيير المسار الدراسي. راجع اختيارك وحاول مجددًا."],
  deletion: ["The account deletion request could not be updated. Check its current status before retrying.", "تعذر تحديث طلب حذف الحساب. راجع حالته الحالية قبل إعادة المحاولة."],
  offlineContent: ["This content is not available offline on this device. Connect and download it first.", "هذا المحتوى غير متاح دون اتصال على هذا الجهاز. اتصل بالإنترنت ونزّله أولًا."],
  leaseExpired: ["This offline access lease is too old to sync saved work. Connect to renew access.", "انتهت صلاحية إثبات الوصول لهذه التغييرات. اتصل بالإنترنت وحدّث التحقق من الوصول قبل إعادة المزامنة."],
  leaseInvalid: ["A valid offline access lease is required to sync saved work. Connect to verify your access.", "تعذر التحقق من تصريح الوصول دون اتصال. اتصل بالإنترنت للتحقق من حسابك قبل إعادة المزامنة."],
  permissionRole: ["Your account cannot make this role change. Check the current permissions.", "حسابك لا يملك صلاحية تغيير الأدوار بهذه الطريقة. راجع الصلاحيات الحالية."],
};

const codeKeys = {
  offline: "offline", network_error: "network", timeout: "timeout", invalid_response: "invalidResponse",
  server_html_error: "service",
  csrf_bootstrap_failed: "secureSession", csrf_token_missing: "secureSession", csrf_failed: "secureSession",
  not_authenticated: "signIn", invalid_credentials: "credentials", permission_denied: "forbidden",
  not_found: "notFound", file_unavailable: "file", too_many_attempts: "rateLimit", throttled: "rateLimit",
  payload_too_large: "large", unsupported_media_type: "media", service_unavailable: "service",
  registration_unavailable: "registration", email_delivery_unavailable: "mail", oauth_not_configured: "provider",
  unsupported_provider: "provider", account_changed: "conflict", cohort_change_failed: "cohort",
  email_unavailable: "emailUnavailable", deletion_request_rejected: "deletion", deletion_cancel_rejected: "deletion",
  duplicate_code: "duplicateCode", personal_sheet_title_invalid: "sheetTitle", personal_sheet_title_taken: "titleTaken",
  personal_sheet_limit_reached: "sheetLimit", sheet_summary_title: "summaryTitle", sheet_summary_limit: "summaryLimit",
  sheet_summary_mode: "summaryMode", sheet_summary_color: "summaryColor", sheet_summary_too_long: "summaryLong",
  focus_revision_conflict: "conflict", catalog_workspace_conflict: "conflict", knowledge_conflict: "conflict",
  revision_conflict: "conflict", answer_revision_conflict: "conflict", review_conflict: "conflict", plan_changed: "conflict",
  attempt_closed: "attemptClosed", answer_rejected: "answer", question_rule_rejected: "answer",
  focus_rule_rejected: "study", attempt_rule_rejected: "study", quiz_rule_rejected: "study", review_rule_rejected: "review",
  out_of_order: "outOfOrder", offline_unavailable: "offlineContent", role_change_rejected: "permissionRole",
  offline_lease_expired: "leaseExpired", offline_lease_invalid: "leaseInvalid",
  storage_quota: "quota", storage_blocked: "storageBlocked", storage_failed: "storage"
};

export function errorCopy(key, locale = "en") {
  return (copy[key] || copy.unknown)[String(locale).startsWith("ar") ? 1 : 0];
}

function leaves(value) {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(leaves);
  return [];
}

function fieldMessage(message, code, locale) {
  const text = normalizeUserError(message, "");
  if (!text) return "";
  const arabic = String(locale).startsWith("ar");
  if (!arabic) return text;
  if (/[\u0600-\u06ff]/.test(text)) return text;
  const fieldKeys = { invalid_timezone: "timezone", duplicate_day: "duplicateDay", duplicate_subject: "duplicateSubject", day_limit_exceeded: "dayLimit", future_session: "future", week_start_required: "monday" };
  if (fieldKeys[code]) return errorCopy(fieldKeys[code], locale);
  const known = [
    [/valid email/i, "email"], [/valid timezone/i, "timezone"], [/each day once/i, "duplicateDay"],
    [/each subject once/i, "duplicateSubject"], [/480 minutes and 48 sessions/i, "dayLimit"],
    [/future sessions cannot/i, "future"], [/Monday that starts/i, "monday"], [/exactly 13 digits/i, "codeFormat"]
  ].find(([pattern]) => /** @type {RegExp} */ (pattern).test(text));
  if (known) return errorCopy(/** @type {string} */ (known[1]), locale);
  if (["required", "blank", "null"].includes(code) || /required|may not be blank|may not be null/i.test(text)) return errorCopy("required", locale);
  const number = text.match(/(?:greater than or equal to|less than or equal to|at least|at most|more than|less than|under|maximum of|minimum of)\s+(\d+)/i)?.[1];
  if (number && (code === "max_length" || /characters.*(?:max|long)|under \d+ characters|no more than \d+ characters/i.test(text))) return `استخدم ${number} حرفًا أو أقل لهذا الحقل.`;
  if (number && code === "min_length") return /elements|items|entries/i.test(text) ? `أضف ${number} عناصر على الأقل لهذا الحقل.` : `استخدم ${number} أحرف على الأقل لهذا الحقل.`;
  if (number && code === "max_value") return `قيمة هذا الحقل يجب ألا تتجاوز ${number}.`;
  if (number && code === "min_value") return `قيمة هذا الحقل يجب ألا تقل عن ${number}.`;
  if (number && code === "max_length") return `قلّل عدد العناصر إلى ${number} أو أقل.`;
  return errorCopy("invalid", locale);
}

const fieldLabels = {
  title: ["Title", "العنوان"], timezone: ["Timezone", "المنطقة الزمنية"], email: ["Email", "البريد الإلكتروني"],
  new_email: ["New email", "البريد الجديد"], password: ["Password", "كلمة المرور"], current_password: ["Current password", "كلمة المرور الحالية"],
  new_password: ["New password", "كلمة المرور الجديدة"], full_name: ["Name", "الاسم"], username: ["Username", "اسم المستخدم"],
  weekdays: ["Study days", "أيام الدراسة"], subjects: ["Subjects", "المواد"], duration_minutes: ["Session minutes", "مدة الجلسة"],
  daily_minutes: ["Daily minutes", "الدقائق اليومية"], session_minutes: ["Session minutes", "مدة الجلسة"],
  scheduled_date: ["Session date", "تاريخ الجلسة"], status: ["Status", "الحالة"], subject: ["Subject", "المادة"],
  file: ["File", "الملف"], choice_ids: ["Answer", "الإجابة"], recharge_codes: ["Recharge codes", "أكواد الشحن"],
  code: ["Code", "الرمز"], mode: ["Mode", "الوضع"], start_date: ["Week start", "بداية الأسبوع"],
  questions_per_checkpoint: ["Question count", "عدد الأسئلة"], pages_per_checkpoint: ["Page count", "عدد الصفحات"],
  payment: ["Payment", "طلب الدفع"], body: ["Message", "نص الرسالة"]
};

export function userFieldErrors(error, locale = "en") {
  const fields = error?.fields && typeof error.fields === "object" ? error.fields : {};
  return Object.entries(fields).flatMap(([field, values]) => {
    // Metadata such as current_answer is not a validation message.
    const codes = leaves(error.fieldCodes?.[field] || error.field_codes?.[field]);
    return leaves(values).map((text, index) => ({ field, label: fieldLabels[field]?.[String(locale).startsWith("ar") ? 1 : 0] || "", message: fieldMessage(text, codes[index] || "", locale) })).filter(item => item.message);
  });
}

export function userErrorMessage(error, { locale = "en", fallback = "" } = {}) {
  if (!error) return fallback || errorCopy("unknown", locale);
  if (typeof error === "string") return normalizeUserError(error, fallback || errorCopy("unknown", locale));
  if (/^CSRF Failed:/.test(error.rawMessage || error.message || "")) return errorCopy("secureSession", locale);
  const key = codeKeys[error.code];
  if (key) {
    if (["timeout", "network_error", "invalid_response", "server_html_error"].includes(error.code) && error.requestSent && !["GET", "HEAD", "OPTIONS"].includes(error.method)) return errorCopy("uncertain", locale);
    if (error.code === "invalid_response" && !String(locale).startsWith("ar") && normalizeUserError(error.rawMessage, "")) return error.rawMessage;
    return errorCopy(key, locale);
  }
  const legacyLease = {
    "This offline access lease is too old to sync saved work.": "leaseExpired",
    "A valid offline access lease is required to sync saved work.": "leaseInvalid"
  }[error.rawMessage || error.message];
  if (legacyLease) return errorCopy(legacyLease, locale);
  const fields = userFieldErrors(error, locale);
  if (fields.length) return [fields[0].label, fields[0].message].filter(Boolean).join(": ");
  const status = Number(error.status);
  if (status >= 500 && error.requestSent && !["GET", "HEAD", "OPTIONS"].includes(error.method)) return errorCopy("uncertain", locale);
  const statusKey = status === 401 ? "signIn" : status === 403 ? "forbidden" : status === 404 || status === 410 ? "notFound" : status === 409 ? "conflict" : status === 413 ? "large" : status === 415 ? "media" : status === 429 ? "rateLimit" : status >= 500 ? "service" : "";
  if (statusKey) return errorCopy(statusKey, locale);
  const raw = normalizeUserError(error.rawMessage || error.message, "");
  if (raw && (!String(locale).startsWith("ar") || /[\u0600-\u06ff]/.test(raw)) && !/^The request could not be completed\.?$/i.test(raw)) return raw;
  return fallback || errorCopy("unknown", locale);
}

export function localSaveError(error, locale = "en") {
  const code = error?.name === "QuotaExceededError" ? "storage_quota" : error?.name === "SecurityError" ? "storage_blocked" : "storage_failed";
  return userErrorMessage({ code }, { locale });
}

export function offlineOperationMessage(operation, locale = "en") {
  return userErrorMessage({ ...operation, code: operation.reason_code || operation.code, rawMessage: operation.reason }, { locale, fallback: errorCopy("syncRejected", locale) });
}
