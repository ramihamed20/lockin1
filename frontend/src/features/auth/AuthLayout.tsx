import { Outlet, useLocation } from "react-router-dom";

import { Brand } from "../../components/Brand";
import { Button } from "../../components/Button";
import { useI18n } from "../../i18n/I18nProvider";

export function AuthLayout() {
  const { t, toggleLocale } = useI18n();
  const location = useLocation();
  if (location.pathname === "/login") return <Outlet />;
  return (
    <div className="auth-shell">
      <a className="skip-link" href="#main-content">
        {t("skip")}
      </a>
      <header className="auth-header">
        <Brand />
        <Button variant="quiet" onClick={toggleLocale} lang={t("language") === "العربية" ? "ar" : "en"}>
          {t("language")}
        </Button>
      </header>
      <aside className="auth-scene" aria-hidden="true">
        <div className="auth-scene__copy">
          <span>{t("authEyebrow")}</span>
          <p>01:47</p>
        </div>
        <img src="/assets/mascot-study.png" alt="" />
        <div className="auth-scene__desk" />
      </aside>
      <main id="main-content" className="auth-main">
        <Outlet />
      </main>
    </div>
  );
}
