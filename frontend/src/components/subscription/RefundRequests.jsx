import { useRef, useState } from "react";
import { refundClaimsApi } from "../../api/refundClaims.js";
import { generateIdempotencyKey } from "../../api/pagination.js";
import { useAsyncData } from "../../hooks/useAsyncData.js";
import { formatDateTime } from "../../lib/i18n.js";
import { ErrorPanel, LoadingPanel } from "../ui/index.jsx";

const labels = { requested: "قيد المراجعة", needs_info: "نحتاج معلومات إضافية", approved: "معتمد للتحويل", completed: "تم تسجيل التحويل", rejected: "مرفوض — يمكنك طلب المراجعة", compensating: "وصول تعويضي حتى عودة الخدمة", resolved: "تمت المعالجة" };
const kinds = { voluntary: "تغيير الرأي", platform_error: "خطأ من المنصة أو خدمة غير متاحة", payment_error: "مشكلة في البطاقات أو الدفع", termination: "إنهاء اتفاق الأقساط" };
function amount(item) {
  const value = item.approved_amount_minor ?? item.quoted_amount_minor;
  return `${Number(value) / (10 ** Number(item.currency_exponent))} ${item.currency}`;
}

export function RefundRequests({ payments = [], onChanged, finance = false }) {
  const [page, setPage] = useState(1);
  const [scope, setScope] = useState("open");
  const list = useAsyncData(() => refundClaimsApi.list(finance, page, scope), [finance, page, scope]);
  const [paymentId, setPaymentId] = useState("");
  const [kind, setKind] = useState("voluntary");
  const [remedy, setRemedy] = useState("refund");
  const [reason, setReason] = useState("");
  const [phone, setPhone] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [channel, setChannel] = useState("telegram");
  const [received, setReceived] = useState("");
  const key = useRef("");
  async function submit(event) {
    event.preventDefault();
    if (pending) return;
    setPending(true); setError(""); setNotice("");
    if (!key.current) key.current = generateIdempotencyKey();
    try {
      const body = { payment_id: paymentId || payments[0]?.id, kind, remedy, reason, receiver_phone: phone };
      const result = finance
        ? await refundClaimsApi.recordExternal({ ...body, channel, received_at: new Date(received).toISOString() }, key.current)
        : await refundClaimsApi.create(body, key.current);
      key.current = "";
      setReason(""); setPhone("");
      setNotice(`تم حفظ الطلب. وقت وصوله: ${formatDateTime(result.received_at)}. مهلة الاسترداد المستحق: ${formatDateTime(result.due_at)}.`);
      if (page === 1) list.reload(); else setPage(1);
      onChanged?.();
    } catch (e) { setError(e.message || "تعذر حفظ الطلب."); }
    finally { setPending(false); }
  }
  return <section className="subscription-secondary policy-requests" lang="ar" dir="rtl" aria-labelledby={finance ? "finance-refunds" : "my-refunds"}>
    <h2 id={finance ? "finance-refunds" : "my-refunds"}>{finance ? "متابعة الاسترداد والتعويض" : "الاسترداد وإنهاء الأقساط"}</h2>
    <p>الاسترداد المستحق خلال 48 ساعة من وصول الطلب، بما فيها العطلات، برصيد ليبيانا صافٍ. تُستكمل البيانات الناقصة دون إعادة حساب وقت الاستلام. <a href="#/refunds">اقرأ السياسة</a>.</p>
    <form className="ops-form" onSubmit={submit}>
      <label className="field"><span>{finance ? "مرجع عملية الدفع للطلب الوارد" : "عملية الدفع"}</span>{finance
        ? <input value={paymentId} onChange={(e) => setPaymentId(e.target.value)} required />
        : <select value={paymentId || payments[0]?.id || ""} onChange={(e) => setPaymentId(e.target.value)} required><option value="" disabled>اختر عملية الدفع</option>{payments.map((p) => <option key={p.id} value={p.id}>{p.price_snapshot?.plan_title} — {formatDateTime(p.created_at)}</option>)}</select>}</label>
      <label className="field"><span>نوع الطلب</span><select value={kind} onChange={(e) => { setKind(e.target.value); setRemedy(e.target.value === "termination" ? "terminate" : "refund"); }}>{Object.entries(kinds).map(([id, text]) => <option key={id} value={id}>{text}</option>)}</select></label>
      {kind === "platform_error" && <label className="field"><span>اختر المعالجة</span><select value={remedy} onChange={(e) => setRemedy(e.target.value)}><option value="refund">استرداد كامل المبلغ المدفوع</option><option value="extension">تمديد تعويضي مجاني حتى عودة الخدمة</option></select></label>}
      <label className="field"><span>وصف الطلب</span><textarea value={reason} onChange={(e) => setReason(e.target.value)} minLength={3} maxLength={1000} required /></label>
      <label className="field"><span>رقم ليبيانا لاستقبال الرصيد (يمكن استكماله لاحقًا)</span><input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} dir="ltr" maxLength={20} /></label>
      {finance && <><label className="field"><span>قناة وصول الطلب</span><select value={channel} onChange={(e) => setChannel(e.target.value)}><option value="telegram">Telegram</option><option value="email">البريد</option><option value="support">الدعم</option></select></label><label className="field"><span>وقت الوصول الأصلي (بتوقيت جهازك)</span><input type="datetime-local" value={received} onChange={(e) => setReceived(e.target.value)} required /></label></>}
      <p>يُراجع الطلب وفق السياسة والحقوق القانونية. الاسترداد أو إنهاء الأقساط ينهي الوصول المرتبط بالشراء عند اعتماد الإلغاء، وتبقى أعمالك محفوظة. التقدير المالي يخضع للتحقق من المبالغ المحصلة.</p>
      <button className="btn btn-primary" disabled={pending || (!finance && !payments.length)} type="submit">{pending ? "جارٍ الحفظ…" : finance ? "تسجيل الطلب بوقت وصوله الأصلي" : "إرسال الطلب"}</button>
    </form>
    {error && <p className="form-alert error" role="alert">{error}</p>}
    {notice && <p className="form-alert success" role="status">{notice}</p>}
    {finance && <label className="field"><span>عرض الطلبات</span><select value={scope} onChange={(e) => { setScope(e.target.value); setPage(1); }}><option value="open">طلبات تحتاج إجراء</option><option value="all">كل الطلبات والسجل</option></select></label>}
    {list.loading ? <LoadingPanel /> : list.error ? <ErrorPanel message={list.error} onRetry={list.reload} /> : (list.data?.results || []).map((item) => <Claim key={item.id} item={item} finance={finance} onChanged={() => { list.reload(); onChanged?.(); }} />)}
    {list.data && (list.data.next || list.data.previous) && <nav aria-label="صفحات طلبات الاسترداد"><button className="btn btn-outline" type="button" disabled={!list.data.previous || list.loading} onClick={() => setPage(page - 1)}>السابق</button><span> {page} </span><button className="btn btn-outline" type="button" disabled={!list.data.next || list.loading} onClick={() => setPage(page + 1)}>التالي</button></nav>}
  </section>;
}

function Claim({ item, finance, onChanged }) {
  const actions = ["requested", "needs_info"].includes(item.status) ? ["needs_info", item.remedy === "extension" ? "compensate" : "approve", "reject"] : item.status === "approved" ? ["complete"] : item.status === "compensating" ? ["restore"] : [];
  const [action, setAction] = useState(actions[0] || "");
  const effectiveAction = actions.includes(action) ? action : actions[0];
  const [reason, setReason] = useState("");
  const [reference, setReference] = useState("");
  const [alternative, setAlternative] = useState(false);
  const [agreementReference, setAgreementReference] = useState("");
  const [transferredTo, setTransferredTo] = useState(item.receiver_phone || "");
  const [transferredAmount, setTransferredAmount] = useState(String(Number(item.approved_amount_minor || 0) / (10 ** Number(item.currency_exponent))));
  const [phone, setPhone] = useState(item.receiver_phone || "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function save(event) {
    event.preventDefault(); if (pending) return;
    setPending(true); setError("");
    try {
      if (finance) await refundClaimsApi.review(item.id, { action: effectiveAction, reason, transfer_reference: reference, ...(effectiveAction === "complete" ? { transferred_to: transferredTo, transferred_amount_minor: Math.round(Number(transferredAmount) * (10 ** Number(item.currency_exponent))), agreed_alternative: alternative, alternative_agreement_reference: agreementReference } : {}) });
      else await refundClaimsApi.contact(item.id, phone);
      onChanged();
    } catch (e) { setError(e.message || "تعذر تحديث الطلب."); }
    finally { setPending(false); }
  }
  return <article className="public-info-section">
    <h3>{labels[item.status]} — {kinds[item.kind]}</h3>
    <p>مرجع الطلب: <bdi>{item.id}</bdi></p><p>الاستلام: {formatDateTime(item.received_at)} · المهلة: {formatDateTime(item.due_at)}</p>
    {item.remedy === "extension" ? <p>اختيار المستخدم: وصول تعويضي حتى عودة الخدمة.</p> : <p>{item.approved_amount_minor == null ? "التقدير قبل المراجعة" : "المبلغ الصافي المعتمد"}: {amount(item)}</p>}
    <p>رقم استقبال الرصيد: <bdi>{item.receiver_phone || "لم يستكمل بعد"}</bdi></p>
    {item.transfer_details?.channel === "agreed_alternative" && <p>أُنجز الرد بوسيلة بديلة متفق عليها معك.</p>}
    <p>{item.reason}</p>{item.decision_reason && <p>{item.decision_reason}</p>}
    {((finance && actions.length > 0) || (!finance && ["requested", "needs_info", "approved"].includes(item.status))) && <form className="ops-form" onSubmit={save}>
      {finance ? <>
        <label className="field"><span>الإجراء</span><select value={effectiveAction} onChange={(e) => setAction(e.target.value)}>{actions.map((value) => <option value={value} key={value}>{{ needs_info: "طلب معلومات مع حفظ وقت الاستلام", approve: "اعتماد الاسترداد أو إنهاء الأقساط", complete: "توثيق التحويل المنفذ بالفعل", compensate: "بدء التعويض الذي اختاره المستخدم", restore: "تأكيد عودة الخدمة وإنهاء التعويض", reject: "رفض مسبب مع إتاحة المراجعة" }[value]}</option>)}</select></label>
        <label className="field"><span>سبب واضح للمستخدم</span><textarea value={reason} onChange={(e) => setReason(e.target.value)} minLength={8} maxLength={1000} required /></label>
        {effectiveAction === "complete" && <><label className="field"><span>جهة الاستقبال التي حُول إليها فعليًا</span><input dir="ltr" type="text" maxLength={160} value={transferredTo} onChange={(e) => setTransferredTo(e.target.value)} required /></label><label className="field"><span>المبلغ الصافي المحول فعليًا ({item.currency})</span><input type="number" min="0.001" step="0.001" value={transferredAmount} onChange={(e) => setTransferredAmount(e.target.value)} required /></label><label><input type="checkbox" checked={alternative} onChange={(e) => setAlternative(e.target.checked)} /> تعذر تحويل الرصيد واتفق المستخدم معنا على وسيلة بديلة.</label>{alternative && <label className="field"><span>مرجع موافقة المستخدم على الوسيلة البديلة</span><input value={agreementReference} onChange={(e) => setAgreementReference(e.target.value)} minLength={8} maxLength={160} required /></label>}<label className="field"><span>مرجع التحويل الفعلي للمبلغ الصافي كاملًا</span><input value={reference} onChange={(e) => setReference(e.target.value)} required maxLength={160} /></label><label><input type="checkbox" required /> أؤكد تنفيذ التحويل بالفعل دون خصم رسوم من المستخدم.</label></>}
      </> : <label className="field"><span>استكمال رقم الاستقبال</span><input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} required dir="ltr" /></label>}
      <button className="btn btn-outline" disabled={pending} type="submit">{pending ? "جارٍ الحفظ…" : "حفظ"}</button>
      {error && <p role="alert">{error}</p>}
    </form>}
  </article>;
}
