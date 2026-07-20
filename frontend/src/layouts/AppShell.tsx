import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";

import { useAuth } from "../features/auth/AuthProvider";
import { notificationApi, progressionApi } from "../features/motivation/api";
import type { NotificationItem, StreakSummary } from "../features/motivation/types";
import { useOperationalAccess } from "../features/operations/useOperationalAccess";
import { useI18n } from "../i18n/I18nProvider";
import { LegacyIcon } from "../legacy/LegacyIcon";

type Theme = "dawn" | "day" | "sunset" | "night";
type NavigationItem = {
  to: string;
  label: string;
  icon: Parameters<typeof LegacyIcon>[0]["name"];
  group: string;
  end?: boolean;
};

const themeOptions: Array<{ id: Theme; label: string }> = [
  { id: "dawn", label: "Dawn" },
  { id: "day", label: "Day" },
  { id: "sunset", label: "Sunset" },
  { id: "night", label: "Night" }
];

function LegacyBrand() {
  const { t } = useI18n();
  return (
    <Link className="brand" to="/" aria-label={t("brandHome")}>
      <span className="brand-mark">
        <img src="/assets/logo.jpg" alt="" className="brand-logo-img" />
      </span>
      <strong>lock-in</strong>
    </Link>
  );
}

function useLegacyTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem("lockin.theme");
    return themeOptions.some((option) => option.id === saved) ? saved as Theme : "night";
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("lockin.theme", theme);
  }, [theme]);

  return { theme, setTheme };
}

function firstName(fullName?: string) {
  return fullName?.trim().split(/\s+/)[0] || "";
}

function relativeDate(value: string, locale: "en" | "ar") {
  const difference = Date.now() - new Date(value).getTime();
  const minutes = Math.max(0, Math.round(difference / 60_000));
  if (minutes < 2) return locale === "ar" ? "الآن" : "Just now";
  if (minutes < 60) return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(-minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (hours < 24) return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(-hours, "hour");
  return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(-Math.round(hours / 24), "day");
}

function StreakCard() {
  const { locale } = useI18n();
  const [streak, setStreak] = useState<StreakSummary | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void progressionApi.streak(controller.signal).then((value) => {
      if (!controller.signal.aborted) setStreak(value);
    }).catch(() => undefined);
    return () => controller.abort();
  }, []);

  const days = streak?.current_days ?? 0;
  const progress = Math.min(100, Math.round((days / 30) * 100));
  const dayLabel = locale === "ar" ? "يوم متتالٍ" : days === 1 ? "day streak" : "day streak";

  return (
    <section className="streak-card" aria-label={locale === "ar" ? "تقدّم المواظبة" : "Streak progress"}>
      <div><LegacyIcon name="activity" size={18} /> {days > 0 ? (locale === "ar" ? "استمر!" : "Keep going!") : (locale === "ar" ? "ابدأ اليوم!" : "Start today!")}</div>
      <p>{days} {dayLabel}</p>
      <span aria-hidden="true"><i style={{ width: `${progress}%` }} /></span>
      <div className="streak-freeze-row">
        <small>
          {streak
            ? streak.policy.freeze_tokens_enabled
              ? `${streak.freeze_tokens_available} ${locale === "ar" ? "تجميد متاح" : "freeze available"}`
              : locale === "ar" ? "راجع سياسة المواظبة" : "Review streak policy"
            : locale === "ar" ? "جارٍ تحميل المواظبة" : "Loading streak"}
        </small>
        <Link to="/progression">{locale === "ar" ? "عرض" : "View"}</Link>
      </div>
    </section>
  );
}

function NavigationList({ items, onNavigate, tabIndex }: { items: NavigationItem[]; onNavigate?: () => void; tabIndex?: number | undefined }) {
  return (
    <nav className="nav-list" aria-label="Primary">
      {items.map((item, index) => {
        const showGroup = items[index - 1]?.group !== item.group;
        return (
          <div className="nav-entry" key={item.to}>
            {showGroup ? <span className="nav-section-label">{item.group}</span> : null}
            <NavLink
              to={item.to}
              end={item.end ?? false}
              className={({ isActive }) => `nav-btn${isActive ? " active" : ""}`}
              tabIndex={tabIndex}
              onClick={onNavigate}
            >
              <LegacyIcon name={item.icon} />
              <span>{item.label}</span>
            </NavLink>
          </div>
        );
      })}
    </nav>
  );
}

function NotificationsMenu({ unreadCount, onCountChange }: { unreadCount: number; onCountChange: (count: number) => void }) {
  const { locale } = useI18n();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || items) return;
    const controller = new AbortController();
    void notificationApi.list(controller.signal).then((page) => {
      if (!controller.signal.aborted) setItems(page.results);
    }).catch(() => {
      if (!controller.signal.aborted) setFailed(true);
    });
    return () => controller.abort();
  }, [items, open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  async function markAllRead() {
    await notificationApi.markAllRead();
    const readAt = new Date().toISOString();
    setItems((current) => current?.map((item) => ({ ...item, read_at: item.read_at ?? readAt })) ?? current);
    onCountChange(0);
  }

  async function openNotification(item: NotificationItem) {
    try {
      const response = await notificationApi.open(item.id);
      setItems((current) => current?.map((candidate) => candidate.id === item.id ? { ...candidate, read_at: candidate.read_at ?? new Date().toISOString() } : candidate) ?? current);
      if (!item.read_at) onCountChange(Math.max(0, unreadCount - 1));
      setOpen(false);
      void navigate(response.route);
    } catch {
      setFailed(true);
    }
  }

  return (
    <div className="notifications-menu-wrap" ref={menuRef}>
      <button className={`icon-btn${unreadCount ? " active" : ""}`} type="button" onClick={() => setOpen((value) => !value)} aria-label={locale === "ar" ? "الإشعارات" : "Notifications"} aria-expanded={open} aria-controls="notifications-menu">
        <LegacyIcon name="bell" />
        {unreadCount ? <span className="dot" /> : null}
      </button>
      {open ? (
        <section className="notifications-dropdown" id="notifications-menu" aria-label={locale === "ar" ? "الإشعارات" : "Notifications"}>
          <header className="notifications-header">
            <h3>{locale === "ar" ? "الإشعارات" : "Notifications"}</h3>
            {unreadCount ? <button className="text-link compact" type="button" onClick={() => void markAllRead()}>{locale === "ar" ? "تحديد الكل كمقروء" : "Mark all read"}</button> : null}
          </header>
          <div className="notifications-list">
            {failed ? <p className="notification-item">{locale === "ar" ? "تعذر تحميل الإشعارات." : "Notifications could not be loaded."}</p> : null}
            {!failed && !items ? <p className="notification-item">{locale === "ar" ? "جارٍ التحميل…" : "Loading…"}</p> : null}
            {!failed && items?.length === 0 ? <div className="notifications-empty"><LegacyIcon name="bell" size={20} /><p>{locale === "ar" ? "لا توجد إشعارات جديدة" : "All caught up!"}</p></div> : null}
            {items?.slice(0, 5).map((item) => (
              <button className={`notification-item${item.read_at ? " read" : " unread"}`} key={item.id} type="button" onClick={() => void openNotification(item)}>
                <p>{item.title}</p>
                <div className="notification-meta"><small>{relativeDate(item.created_at, locale)}</small></div>
              </button>
            ))}
          </div>
          <Link className="notifications-view-all" to="/notifications" onClick={() => setOpen(false)}>{locale === "ar" ? "عرض جميع الإشعارات" : "View all notifications"}</Link>
        </section>
      ) : null}
    </div>
  );
}

export function AppShell() {
  const { user, logout } = useAuth();
  const { locale, t, toggleLocale } = useI18n();
  const location = useLocation();
  const navigate = useNavigate();
  const operationsAllowed = useOperationalAccess();
  const { theme, setTheme } = useLegacyTheme();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [unreadCount, setUnreadCount] = useState(0);
  const drawerRef = useRef<HTMLElement>(null);
  const drawerCloseRef = useRef<HTMLButtonElement>(null);
  const drawerTriggerRef = useRef<HTMLButtonElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const isAdmin = user?.roles.includes("administrator") ?? false;
  const isCreator = isAdmin || (user?.roles.includes("creator") ?? false);
  const canModerate = isCreator || (user?.roles.includes("moderator") ?? false);
  const navItems = useMemo<NavigationItem[]>(() => [
    { to: "/", label: t("navDashboard"), icon: "home", group: locale === "ar" ? "الدراسة" : "Study", end: true },
    { to: "/learn", label: t("navLearn"), icon: "book-open", group: locale === "ar" ? "الدراسة" : "Study" },
    { to: "/assessments", label: t("navAssessments"), icon: "help", group: locale === "ar" ? "الدراسة" : "Study" },
    { to: "/progression", label: t("navProgression"), icon: "activity", group: locale === "ar" ? "المراجعة" : "Review" },
    { to: "/notifications", label: t("navNotifications"), icon: "bell", group: locale === "ar" ? "المراجعة" : "Review" },
    { to: "/community", label: t("navCommunity"), icon: "messages", group: locale === "ar" ? "المجتمع" : "Community" },
    { to: "/subscription", label: t("navBilling"), icon: "trophy", group: locale === "ar" ? "الحساب" : "Account" },
    { to: "/profile", label: t("navProfile"), icon: "user", group: locale === "ar" ? "الحساب" : "Account" },
    { to: "/security", label: t("navSecurity"), icon: "shield", group: locale === "ar" ? "الحساب" : "Account" },
    ...(operationsAllowed ? [{ to: "/operations", label: t("navOperations"), icon: "settings" as const, group: locale === "ar" ? "الإدارة" : "Management" }] : []),
    ...(isCreator ? [
      { to: "/management/content", label: t("navContentStudio"), icon: "file" as const, group: locale === "ar" ? "الإدارة" : "Management" },
      { to: "/management/assessments", label: t("navAssessmentStudio"), icon: "help" as const, group: locale === "ar" ? "الإدارة" : "Management" }
    ] : []),
    ...(canModerate ? [{ to: "/moderation", label: t("navModeration"), icon: "shield" as const, group: locale === "ar" ? "الإدارة" : "Management" }] : []),
    ...(isAdmin ? [
      { to: "/admin/education", label: t("navEducationAdmin"), icon: "book-open" as const, group: locale === "ar" ? "الإدارة" : "Management" },
      { to: "/admin/people", label: t("navAdmin"), icon: "user" as const, group: locale === "ar" ? "الإدارة" : "Management" }
    ] : [])
  ], [canModerate, isAdmin, isCreator, locale, operationsAllowed, t]);

  useEffect(() => {
    const controller = new AbortController();
    void notificationApi.summary(controller.signal).then((summary) => {
      if (!controller.signal.aborted) setUnreadCount(summary.unread_count);
    }).catch(() => undefined);
    return () => controller.abort();
  }, [location.pathname]);

  useEffect(() => {
    document.getElementById("main-content")?.focus({ preventScroll: true });
  }, [location.pathname]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName ?? "")) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!profileOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!profileRef.current?.contains(event.target as Node)) setProfileOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setProfileOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [profileOpen]);

  useEffect(() => {
    if (!drawerOpen) return;
    const previousOverflow = document.body.style.overflow;
    const drawerTrigger = drawerTriggerRef.current;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawerOpen(false);
      if (event.key !== "Tab") return;
      const focusable = Array.from(drawerRef.current?.querySelectorAll<HTMLElement>("a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])") ?? []);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);
    window.setTimeout(() => drawerCloseRef.current?.focus(), 0);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      window.setTimeout(() => drawerTrigger?.focus(), 0);
    };
  }, [drawerOpen]);

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!search.trim()) return;
    void navigate(`/learn?search=${encodeURIComponent(search.trim())}`);
    setSearch("");
    searchRef.current?.blur();
  }

  const drawerTabIndex = drawerOpen ? undefined : -1;
  const mobileItems = navItems.filter((item) => ["/", "/learn", "/assessments", "/progression", "/community"].includes(item.to));

  return (
    <>
      <a className="skip-link" href="#main-content">{t("skip")}</a>
      <div className="app-shell">
        <aside className="sidebar" aria-label={t("primaryNavigation")}>
          <LegacyBrand />
          <NavigationList items={navItems} />
          <StreakCard />
        </aside>

        <div className="content-frame">
          <header className="topbar">
            <button className="icon-btn mobile-menu" ref={drawerTriggerRef} type="button" onClick={() => setDrawerOpen(true)} aria-label={t("openMenu")} aria-expanded={drawerOpen} aria-controls="mobile-drawer">
              <LegacyIcon name="menu" />
            </button>
            <div className="page-title">
              <h1>{`${t("dashboardGreeting")}, ${firstName(user?.full_name)}`}</h1>
              <p>{t("dashboardCommandCopy")}</p>
            </div>
            <form className="search-box" role="search" onSubmit={submitSearch}>
              <LegacyIcon name="search" size={18} />
              <input ref={searchRef} type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={locale === "ar" ? "ابحث في Lock-in (/)" : "Search Lock-in (/)"} aria-label={locale === "ar" ? "البحث في Lock-in" : "Search Lock-in"} />
            </form>
            <button className="icon-btn" type="button" onClick={() => setTheme(theme === "night" ? "day" : "night")} aria-label={theme === "night" ? (locale === "ar" ? "استخدام المظهر النهاري" : "Use day theme") : (locale === "ar" ? "استخدام المظهر الليلي" : "Use night theme")}>
              <LegacyIcon name={theme === "night" ? "sun" : "moon"} />
            </button>
            <button className="icon-btn" type="button" onClick={toggleLocale} aria-label={locale === "ar" ? "Use English" : "استخدم العربية"}>
              <LegacyIcon name="globe" />
            </button>
            <NotificationsMenu unreadCount={unreadCount} onCountChange={setUnreadCount} />
            <div className="profile-menu-wrap" ref={profileRef}>
              <button className="avatar-btn" type="button" onClick={() => setProfileOpen((value) => !value)} aria-label={locale === "ar" ? "فتح قائمة الملف الشخصي" : "Open profile menu"} aria-expanded={profileOpen} aria-controls="profile-menu">
                <img src="/assets/mascot-study.png" alt="" />
              </button>
              {profileOpen ? (
                <div className="profile-menu" id="profile-menu" role="menu" aria-label={locale === "ar" ? "قائمة الملف الشخصي" : "Profile menu"}>
                  <strong>{user?.full_name}</strong>
                  <small>{user?.email}</small>
                  <Link to="/profile" role="menuitem" onClick={() => setProfileOpen(false)}><LegacyIcon name="user" size={17} /> {t("navProfile")}</Link>
                  <Link to="/progression" role="menuitem" onClick={() => setProfileOpen(false)}><LegacyIcon name="award" size={17} /> {t("navProgression")}</Link>
                  <Link to="/security" role="menuitem" onClick={() => setProfileOpen(false)}><LegacyIcon name="settings" size={17} /> {t("navSecurity")}</Link>
                  <button role="menuitem" type="button" onClick={() => void logout()}><LegacyIcon name="log-out" size={17} /> {t("logout")}</button>
                </div>
              ) : null}
            </div>
          </header>
          <main className="page-shell" id="main-content" tabIndex={-1} aria-label="Lock-in page content">
            <Outlet />
          </main>
        </div>

        <nav className="bottom-nav" aria-label={t("mobileNavigation")}>
          {mobileItems.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end ?? false} className={({ isActive }) => isActive ? "active" : ""}>
              <LegacyIcon name={item.icon} size={20} />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className={`drawer-backdrop${drawerOpen ? " open" : ""}`} onClick={() => setDrawerOpen(false)} />
        <aside className={`mobile-drawer${drawerOpen ? " open" : ""}`} id="mobile-drawer" ref={drawerRef} aria-label={t("mobileNavigation")} aria-hidden={drawerOpen ? undefined : "true"} aria-modal={drawerOpen ? "true" : undefined} role="dialog">
          <div className="drawer-head">
            <LegacyBrand />
            <button className="icon-btn" ref={drawerCloseRef} type="button" onClick={() => setDrawerOpen(false)} aria-label={t("closeMenu")} tabIndex={drawerTabIndex}>
              <LegacyIcon name="x" />
            </button>
          </div>
          <section className="drawer-theme-selector" aria-label={locale === "ar" ? "اختيار المظهر" : "Theme selector"}>
            <div><p className="nav-section-label">{locale === "ar" ? "المظهر" : "Theme"}</p><strong>{themeOptions.find((option) => option.id === theme)?.label}</strong></div>
            <div className="drawer-theme-options">
              {themeOptions.map((option) => <button key={option.id} type="button" className={theme === option.id ? "active" : ""} onClick={() => setTheme(option.id)} aria-pressed={theme === option.id} tabIndex={drawerTabIndex}><span aria-hidden="true" />{option.label}</button>)}
            </div>
          </section>
          <NavigationList items={navItems} onNavigate={() => setDrawerOpen(false)} tabIndex={drawerTabIndex} />
        </aside>
      </div>
    </>
  );
}
