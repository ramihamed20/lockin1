import { useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";

import { Brand } from "../components/Brand";
import { Button } from "../components/Button";
import { useAuth } from "../features/auth/AuthProvider";
import { useI18n } from "../i18n/I18nProvider";

const icons = {
  dashboard: "M5 5h6v6H5zM15 5h4v10h-4zM5 15h6v4H5zM15 19v-2h4v2",
  profile: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21c0-4 3-6 8-6s8 2 8 6",
  security: "M12 3 5 6v5c0 5 3 8 7 10 4-2 7-5 7-10V6zM9 12l2 2 4-5",
  people: "M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8-1a2.5 2.5 0 1 0 0-5M2 20c0-4 2-6 6-6s6 2 6 6m1-6c4 0 6 2 6 6"
};

function Icon({ path }: { path: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

export function AppShell() {
  const { user, logout } = useAuth();
  const { t, toggleLocale } = useI18n();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const isAdmin = user?.roles.includes("administrator") ?? false;
  const navItems = [
    { to: "/", label: t("navDashboard"), icon: icons.dashboard, end: true },
    { to: "/profile", label: t("navProfile"), icon: icons.profile },
    { to: "/security", label: t("navSecurity"), icon: icons.security },
    ...(isAdmin ? [{ to: "/admin/people", label: t("navAdmin"), icon: icons.people }] : [])
  ];

  return (
    <div className="workspace-shell">
      <a className="skip-link" href="#main-content">{t("skip")}</a>
      <header className="workspace-header">
        <Brand />
        <div className="workspace-header__actions">
          <Button variant="quiet" onClick={toggleLocale}>{t("language")}</Button>
          <button
            className="menu-trigger"
            type="button"
            aria-expanded={menuOpen}
            aria-controls="primary-navigation"
            aria-label={menuOpen ? t("closeMenu") : t("openMenu")}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span /><span /><span />
          </button>
        </div>
      </header>
      <aside className={`workspace-rail${menuOpen ? " workspace-rail--open" : ""}`}>
        <Brand />
        <nav id="primary-navigation" aria-label={t("primaryNavigation")}>
          {navItems.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end ?? false} onClick={() => setMenuOpen(false)}>
              <Icon path={item.icon} />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="workspace-rail__account">
          <span className="avatar" aria-hidden="true">{user?.full_name.slice(0, 1).toUpperCase()}</span>
          <div><strong>{user?.full_name}</strong><small>{user?.email}</small></div>
          <Button variant="quiet" onClick={() => void logout()}>{t("logout")}</Button>
        </div>
      </aside>
      <div className="route-announcer sr-only" aria-live="polite">{location.pathname}</div>
      <main id="main-content" className="workspace-main" tabIndex={-1}>
        <Outlet />
      </main>
      <nav className="mobile-nav" aria-label={t("mobileNavigation")}>
        {navItems.slice(0, 3).map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end ?? false}>
            <Icon path={item.icon} />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
