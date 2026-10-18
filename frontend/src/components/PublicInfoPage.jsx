import { request } from "../api/client.js";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Brand } from "./layout/index.jsx";
import { useI18n } from "./I18nProvider.jsx";
import { POLICY_CONTACT, POLICY_PDF, POLICY_SECTIONS, POLICY_VERSION } from "../lib/policyContent.js";

export function PublicInfoPage({ page }) {
  const { locale } = useI18n();
  const [effectiveAt, setEffectiveAt] = useState("");
  useEffect(() => {
    let active = true;
    request("/policies").then((data) => { if (active && data.version === POLICY_VERSION) setEffectiveAt(data.effective_at || ""); }).catch(() => {});
    return () => { active = false; };
  }, []);
  const arabic = locale === "ar";
  const titles = arabic
    ? { terms: "شروط الاستخدام والاشتراك", privacy: "سياسة الخصوصية", refunds: "سياسة الاسترداد والتعويض", support: "الدعم والتواصل" }
    : { terms: "Terms and refund policy", privacy: "Privacy Policy", refunds: "Refund policy", support: "Support" };
  const title = titles[page] || titles.terms;
  useEffect(() => { document.title = `${title} — Lock-in`; }, [title]);
  const sections = POLICY_SECTIONS.filter((section) => section.group === page || (page === "terms" && section.group === "refunds") || (page === "support" && ["refund-request", "privacy-rights", "copyright-report", "complaints"].includes(section.id)));
  return (
    <main className="public-info-page" dir={arabic ? "rtl" : "ltr"}>
      <article className="public-info-card" aria-labelledby="public-info-title">
        <div className="public-info-brand"><Brand /></div>
        <header className="public-info-header">
          <h1 id="public-info-title">{title}</h1>
          <p>{arabic ? "إصدار" : "Version"}: {POLICY_VERSION} · 16 October 2026</p>
          <a href={POLICY_PDF} download>{arabic ? "تنزيل السياسات كاملة بصيغة PDF" : "Download the complete Arabic policies (PDF)"}</a>
        </header>
        <div lang="ar" dir="rtl">
          {effectiveAt && <p className="public-info-meta">تاريخ بدء السريان المعلن: <time dateTime={effectiveAt}>{new Date(effectiveAt).toLocaleString("ar-LY", { timeZone: "Africa/Tripoli" })}</time> (توقيت ليبيا).</p>}
          <p className="public-info-notice">تسري هذه النسخة مع إطلاق تحديث السياسات وإعلان تاريخ التطبيق داخل الموقع. لا تُطبق تغييرات أقل فائدة بأثر رجعي على معاملات سابقة وتبقى الحقوق القانونية الإلزامية محفوظة. النص الكامل المعتمد متاح في ملف PDF أعلاه.</p>
          <section className="public-info-section">
            <h2>من يدير Lock-in؟ وكيف تتواصل معنا؟</h2>
            <p>يدير المنصة {POLICY_CONTACT.owner} بصفته الفردية. هذه السياسات مكملة لبيانات الخطة المعروضة قبل الشراء.</p>
            <p><a href={`mailto:${POLICY_CONTACT.email}`} dir="ltr">{POLICY_CONTACT.email}</a></p>
            <p><a href={POLICY_CONTACT.telegram} target="_blank" rel="noreferrer" dir="ltr">Telegram: @LockinTeam</a></p>
            <p><a href={`tel:${POLICY_CONTACT.phone}`} dir="ltr">{POLICY_CONTACT.phone}</a></p>
          </section>
          {sections.map((section) => <section className="public-info-section" key={section.id} id={`terms-${section.id}`}>
            <h2>{section.title}</h2>
            {section.items.map((item) => <p key={item}>{item}</p>)}
          </section>)}
          {page === "support" && <section className="public-info-section"><h2>حماية حسابك</h2><p>لا ترسل كلمة المرور أو رموز التحقق أو استعادة الحساب إلى الدعم عبر البريد أو Telegram.</p></section>}
        </div>
        <footer className="public-info-footer">
          <Link to="/">{arabic ? "العودة للموقع" : "Return to sign in"}</Link>
          <Link to="/terms">{arabic ? "الشروط" : "Terms"}</Link>
          <Link to="/privacy">{arabic ? "الخصوصية" : "Privacy"}</Link>
          <Link to="/refunds">{arabic ? "الاسترداد" : "Refunds"}</Link>
          <Link to="/support">{arabic ? "الدعم" : "Support"}</Link>
        </footer>
      </article>
    </main>
  );
}
