import { useState } from "react";
import { Link } from "react-router-dom";
import { accountsApi } from "../api/accounts.js";
import { POLICY_VERSION } from "../lib/policyContent.js";

export function PolicyNotice({ user, onAccepted }) {
  const [checked, setChecked] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  if (user.policyVersion === POLICY_VERSION && user.policyAcceptedAt) return null;
  async function accept(event) {
    event.preventDefault();
    if (!checked || pending) return;
    setPending(true); setError("");
    try { onAccepted(await accountsApi.acceptPolicies(POLICY_VERSION)); }
    catch { setError("تعذر حفظ الموافقة. حاول مجددًا."); }
    finally { setPending(false); }
  }
  return <section className="form-notice policy-notice" lang="ar" dir="rtl" aria-labelledby="policy-notice-title">
    <h2 id="policy-notice-title">تحديث السياسات — إصدار {POLICY_VERSION}</h2>
    <p>تتضمن النسخة الجديدة حقوق الاسترداد والخصوصية وحفظ أعمالك بعد انتهاء الاشتراك. تبقى حقوق المعاملات السابقة محفوظة. اقرأ <Link to="/terms">الشروط</Link> و<Link to="/privacy">الخصوصية</Link> و<Link to="/refunds">الاسترداد</Link> قبل الموافقة.</p>
    <form onSubmit={accept}>
      <label><input type="checkbox" checked={checked} onChange={(event) => setChecked(event.target.checked)} required /> قرأت السياسات وأوافق عليها.</label>
      <button className="btn btn-primary" type="submit" disabled={!checked || pending}>{pending ? "جارٍ الحفظ…" : "حفظ الموافقة"}</button>
      {error && <p role="alert">{error}</p>}
    </form>
  </section>;
}
