import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";

import { Brand } from "../components/Brand";
import { Button } from "../components/Button";
import { useAuth } from "../features/auth/AuthProvider";
import { notificationApi } from "../features/motivation/api";
import { useI18n } from "../i18n/I18nProvider";

const icons = {
  dashboard: "M5 5h6v6H5zM15 5h4v10h-4zM5 15h6v4H5zM15 19v-2h4v2",
  learn: "M4 5.5A3.5 3.5 0 0 1 7.5 2H11v17H7.5A3.5 3.5 0 0 0 4 22ZM20 5.5A3.5 3.5 0 0 0 16.5 2H13v17h3.5A3.5 3.5 0 0 1 20 22Z",
  profile: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21c0-4 3-6 8-6s8 2 8 6",
  security: "M12 3 5 6v5c0 5 3 8 7 10 4-2 7-5 7-10V6zM9 12l2 2 4-5",
  people: "M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8-1a2.5 2.5 0 1 0 0-5M2 20c0-4 2-6 6-6s6 2 6 6m1-6c4 0 6 2 6 6",
  studio: "M4 4h16v12H8l-4 4Zm4 4h8M8 12h5",
  hierarchy: "M12 4v5M6 20v-5h12v5M6 15v-3h12v3M12 9v3",
  assessment: "M7 3h10v3H7zM5 6h14v15H5zM8 11l2 2 3-4M8 17h8",
  community: "M4 5h16v11H9l-5 4Zm4 4h8m-8 3h5",
  moderation: "M12 3 5 6v5c0 5 3 8 7 10 4-2 7-5 7-10V6zM9 12l2 2 4-5",
  progression: "M5 19V9m7 10V5m7 14v-7M3 19h18",
  notification: "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"
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
  const [unreadCount, setUnreadCount] = useState(0);
  const isAdmin = user?.roles.includes("administrator") ?? false;
  const isCreator = isAdmin || (user?.roles.includes("creator") ?? false);
  const canModerate = isCreator || (user?.roles.includes("moderator") ?? false);
  const navItems = [
    { to: "/", label: t("navDashboard"), icon: icons.dashboard, end: true },
    { to: "/learn", label: t("navLearn"), icon: icons.learn },
    { to: "/assessments", label: t("navAssessments"), icon: icons.assessment },
    { to: "/progression", label: t("navProgression"), icon: icons.progression },
    { to: "/community", label: t("navCommunity"), icon: icons.community },
    { to: "/notifications", label: t("navNotifications"), icon: icons.notification },
    { to: "/profile", label: t("navProfile"), icon: icons.profile },
    { to: "/security", label: t("navSecurity"), icon: icons.security },
    ...(isCreator ? [
      { to: "/management/content", label: t("navContentStudio"), icon: icons.studio },
      { to: "/management/assessments", label: t("navAssessmentStudio"), icon: icons.assessment }
    ] : []),
    ...(canModerate ? [
      { to: "/moderation", label: t("navModeration"), icon: icons.moderation }
    ] : []),
    ...(isAdmin ? [
      { to: "/admin/education", label: t("navEducationAdmin"), icon: icons.hierarchy },
      { to: "/admin/people", label: t("navAdmin"), icon: icons.people }
    ] : [])
  ];

  useEffect(() => {
    const controller = new AbortController();
    void notificationApi.summary(controller.signal).then((summary) => {
      if (!controller.signal.aborted) setUnreadCount(summary.unread_count);
    }).catch(() => undefined);
    return () => controller.abort();
  }, [location.pathname]);

  return (
    <div className="workspace-shell">
      <a className="skip-link" href="#main-content">{t("skip")}</a>
      <header className="workspace-header">
        <Brand />
        <div className="workspace-header__actions">
          <Link className="notification-link" to="/notifications" aria-label={`${t("navNotifications")}: ${unreadCount} ${t("unreadNotifications")}`}>
            <Icon path={icons.notification} />
            {unreadCount ? <span>{unreadCount > 99 ? "99+" : unreadCount}</span> : null}
          </Link>
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
        {navItems.slice(0, 4).map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end ?? false}>
            <Icon path={item.icon} />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
