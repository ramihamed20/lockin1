import { useEffect } from "react";
import { Link } from "react-router-dom";
import { Brand } from "./layout/index.jsx";
import { useI18n } from "./I18nProvider.jsx";
import { TERMS } from "../lib/termsContent.js";

const legalConfig = {
  entity: import.meta.env.VITE_LEGAL_ENTITY?.trim() || "Lock-in",
  address: import.meta.env.VITE_LEGAL_ADDRESS?.trim() || "",
  jurisdiction: import.meta.env.VITE_LEGAL_JURISDICTION?.trim() || "",
  supportEmail: import.meta.env.VITE_SUPPORT_EMAIL?.trim() || "",
  policyVersion: import.meta.env.VITE_POLICY_VERSION?.trim() || "Current version"
};

function SupportEmail() {
  if (!legalConfig.supportEmail) {
    return <p className="public-info-notice" role="status">Support contact details are not configured in this environment.</p>;
  }
  return <a className="public-info-email" href={`mailto:${legalConfig.supportEmail}`}>{legalConfig.supportEmail}</a>;
}

const SUPPORT_TELEGRAM = "LockinTeam";

function SupportTelegram() {
  return <a className="public-info-email" href={`https://t.me/${SUPPORT_TELEGRAM}`} target="_blank" rel="noreferrer" dir="ltr">Telegram: @{SUPPORT_TELEGRAM}</a>;
}

function PublicInfoLayout({ title, intro, children }) {
  return (
    <main className="public-info-page">
      <section className="public-info-card" aria-labelledby="public-info-title">
        <div className="public-info-brand"><Brand /></div>
        <header className="public-info-header">
          <h1 id="public-info-title">{title}</h1>
          <p>{intro}</p>
        </header>
        {children}
        <footer className="public-info-footer">
          <Link to="/">Return to sign in</Link>
          <span aria-hidden="true">·</span>
          <Link to="/terms">Terms</Link>
          <span aria-hidden="true">·</span>
          <Link to="/privacy">Privacy</Link>
          <span aria-hidden="true">·</span>
          <Link to="/support">Support</Link>
        </footer>
      </section>
    </main>
  );
}

export function PublicInfoPage({ page }) {
  const { t } = useI18n();
  const title = page === "privacy" ? "Privacy Policy" : page === "support" ? "Support" : t("terms.title");

  useEffect(() => {
    document.title = `${title} — Lock-in`;
  }, [title]);

  if (page === "support") {
    return (
      <PublicInfoLayout title="Support" intro="Use the contact below for account access, privacy, and platform support.">
        <section className="public-info-section">
          <h2>Contact support</h2>
          <p>For account access, data requests, security concerns, or help using the study workspace, contact:</p>
          <SupportEmail />
          <SupportTelegram />
          <p className="public-info-meta">Please do not include your password, recovery token, or other sensitive credentials in an email.</p>
        </section>
      </PublicInfoLayout>
    );
  }

  if (page === "privacy") {
    return (
      <PublicInfoLayout title="Privacy Policy" intro={`Policy version: ${legalConfig.policyVersion}`}>
        <section className="public-info-section">
          <h2>Who is responsible</h2>
          <p>{legalConfig.entity} operates the Lock-in study workspace.</p>
          {legalConfig.address && <p>{legalConfig.address}</p>}
          <p>Privacy enquiries: <SupportEmail /></p>
        </section>
        <section className="public-info-section">
          <h2>Information the platform processes</h2>
          <p>We process account details, sign-in and security events, learning progress, study content, notifications, and community activity needed to provide, protect, and improve the workspace.</p>
        </section>
        <section className="public-info-section">
          <h2>How information is used</h2>
          <p>Information is used to authenticate accounts, deliver learning features, protect users and content, respond to support requests, meet legal obligations, and maintain the service. The application does not use third-party advertising trackers.</p>
        </section>
        <section className="public-info-section">
          <h2>Cookies and local device storage</h2>
          <p>The workspace uses essential session and CSRF cookies for secure sign-in, plus local device settings for preferences such as theme and reminders. These are not used for cross-site advertising.</p>
        </section>
        <section className="public-info-section">
          <h2>Your choices</h2>
          <p>You may contact support to ask about your account information, correct account details, or request help with deletion where applicable. We may retain limited information when required for security, fraud prevention, or legal obligations.</p>
        </section>
      </PublicInfoLayout>
    );
  }

  return <TermsOfService />;
}

// Public, so the rules -- account sharing, the 15-day refund window -- can be
// read before signing up and are the same page the sign-up consent links to.
function TermsOfService() {
  const { locale, direction, t } = useI18n();
  const terms = TERMS[locale] || TERMS.en;
  const arabic = locale === "ar";
  return (
    <div dir={direction}>
      <PublicInfoLayout title={t("terms.title")} intro={terms.updated}>
        {terms.sections.map((section) => (
          <section className="public-info-section" key={section.id} id={`terms-${section.id}`}>
            <h2>{section.title}</h2>
            <ul className="public-info-list">
              {section.items.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </section>
        ))}
        {legalConfig.jurisdiction && !arabic && <section className="public-info-section"><h2>Governing law</h2><p>These terms are governed by the laws of {legalConfig.jurisdiction}, subject to applicable consumer and data-protection rights.</p></section>}
        <section className="public-info-section">
          <h2>{arabic ? "التواصل" : "Contact"}</h2>
          <p>{arabic ? "للاستفسار عن هذه الشروط أو طلب استرداد:" : "Questions about these terms or a refund request:"}</p>
          <SupportEmail />
          <SupportTelegram />
        </section>
      </PublicInfoLayout>
    </div>
  );
}
