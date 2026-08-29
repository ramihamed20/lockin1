import { useEffect } from "react";
import { Link } from "react-router-dom";
import { Brand } from "./layout/index.jsx";

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
  const title = page === "privacy" ? "Privacy Policy" : page === "support" ? "Support" : "Terms of Service";

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

  return (
    <PublicInfoLayout title="Terms of Service" intro={`Terms version: ${legalConfig.policyVersion}`}>
      <section className="public-info-section">
        <h2>Using Lock-in</h2>
        <p>Lock-in provides a private study workspace. Keep your account credentials confidential, use the service lawfully, and do not interfere with other users, platform security, or content rights.</p>
      </section>
      <section className="public-info-section">
        <h2>Accounts and content</h2>
        <p>You are responsible for activity under your account. Creator and community content must be lawful, accurate where presented as educational material, and respectful of others’ rights. The platform may restrict content or accounts to protect users and the service.</p>
      </section>
      <section className="public-info-section">
        <h2>Availability and changes</h2>
        <p>We work to keep the workspace available and secure, but maintenance, security events, or external service failures can affect availability. Material changes to these terms will be presented with an updated policy version.</p>
      </section>
      {legalConfig.jurisdiction && <section className="public-info-section"><h2>Governing law</h2><p>These terms are governed by the laws of {legalConfig.jurisdiction}, subject to applicable consumer and data-protection rights.</p></section>}
      <section className="public-info-section">
        <h2>Contact</h2>
        <p>Questions about these terms: <SupportEmail /></p>
      </section>
    </PublicInfoLayout>
  );
}
