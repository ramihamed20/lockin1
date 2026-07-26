import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Icon } from "../../lib/icons.jsx";
import { motivationApi } from "../../api/motivation.js";
import { isApiError } from "../../api/client.js";
import { isKnownNotificationRoute } from "../../lib/notificationRoutes.js";
import { navItems, themeOptions } from "../../lib/constants.js";
import { assets } from "../../lib/constants.js";
import { assetPath, greeting } from "../../lib/utils.js";
import { PRODUCT_ROLES } from "../../api/contracts.js";
import { hasProductRole } from "../../lib/authz.js";
import { hasOperationalCapability } from "../../lib/authz.js";

// --- Brand ---

export function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark">
        <img src={assetPath("/assets/logo.jpg")} alt="Lock-in Logo" className="brand-logo-img" />
      </span>
      <strong>lock-in</strong>
    </div>
  );
}

// --- NavList ---

export function NavList({ tabIndex, onNavigate, user, operationsSession } = {}) {
  const location = useLocation();
  const productCreator = hasProductRole(user, PRODUCT_ROLES.CREATOR) || hasProductRole(user, PRODUCT_ROLES.ADMINISTRATOR);
  const contentAdministrator = hasOperationalCapability(operationsSession, "content.manage");
  const assessmentAdministrator = hasOperationalCapability(operationsSession, "assessments.manage");
  const creatorItems = productCreator || contentAdministrator || assessmentAdministrator
    ? [{ path: contentAdministrator || productCreator ? "/creator/education" : "/creator/questions", label: productCreator ? "Creator Studio" : "Content Administration", icon: "layers", group: "Workspace" }]
    : [];
  const operationsItems = hasOperationalCapability(operationsSession, "overview.view")
    ? [{ path: "/operations/admin/overview", label: "Operations Console", icon: "settings", group: "Workspace" }]
    : [];
  const visibleItems = [...navItems, ...creatorItems, ...operationsItems];
  let currentGroup = "";
  return (
    <nav className="nav-list" aria-label="Primary">
      {visibleItems.map((item) => {
        const showGroup = item.group !== currentGroup;
        currentGroup = item.group;
        const active = item.path === "/" ? location.pathname === "/" : location.pathname.startsWith(item.path);
        return (
          <div className="nav-entry" key={item.path}>
            {showGroup && <span className="nav-section-label">{item.group}</span>}
            <Link to={item.path} className={`nav-btn ${active ? "active" : ""}`} aria-current={active ? "page" : undefined} tabIndex={tabIndex} onClick={onNavigate}>
              <Icon name={item.icon} size={19} />
              <span>{item.label}</span>
            </Link>
          </div>
        );
      })}
    </nav>
  );
}

// --- DrawerThemeSelector ---

export function DrawerThemeSelector({ activeTheme, onThemeChange, tabIndex }) {
  return (
    <section className="drawer-theme-selector" aria-label="Theme selector">
      <div>
        <p className="nav-section-label">Theme</p>
        <strong>{themeOptions.find((item) => item.id === activeTheme)?.label || "Theme"}</strong>
      </div>
      <div className="drawer-theme-options">
        {themeOptions.map((option) => (
          <button
            key={option.id}
            type="button"
            className={activeTheme === option.id ? "active" : ""}
            onClick={() => onThemeChange(option.id)}
            aria-pressed={activeTheme === option.id}
            aria-label={`Use ${option.label} theme`}
            tabIndex={tabIndex}
          >
            <span aria-hidden="true" />
            {option.label}
          </button>
        ))}
      </div>
    </section>
  );
}

// --- StreakCard ---

export function StreakCard() {
  const [state, setState] = useState({ loading: true, error: "", data: null });

  useEffect(() => {
    let active = true;
    motivationApi.streakSummary()
      .then((data) => { if (active) setState({ loading: false, error: "", data }); })
      .catch((error) => { if (active) setState({ loading: false, error: error.message || "Streak unavailable", data: null }); });
    return () => { active = false; };
  }, []);

  if (state.loading) {
    return <div className="streak-card" aria-busy="true"><div><Icon name="activity" size={18} /> Server-managed progress</div><p>Loading streak…</p><span><i style={{ width: "0%" }} /></span></div>;
  }

  if (state.error || !state.data) {
    return <div className="streak-card"><div><Icon name="activity" size={18} /> Server-managed progress</div><p>Streak unavailable</p><span><i style={{ width: "0%" }} /></span><small>{state.error || "Django did not return a streak summary."}</small></div>;
  }

  const currentDays = Number(state.data.current_days) || 0;
  const longestDays = Number(state.data.longest_days) || 0;
  const personalBestPercent = longestDays > 0 ? Math.min(100, Math.round((currentDays / longestDays) * 100)) : 0;
  return (
    <div className="streak-card" aria-label="Server managed streak summary">
      <div><Icon name="activity" size={18} /> Server-managed progress</div>
      <p>{currentDays} day{currentDays === 1 ? "" : "s"} · personal best {longestDays} day{longestDays === 1 ? "" : "s"}</p>
      <span><i style={{ width: `${personalBestPercent}%` }} /></span>
      <div className="streak-freeze-row">
        <small>{state.data.freeze_tokens_available ?? 0} freeze token{Number(state.data.freeze_tokens_available) === 1 ? "" : "s"} reported. No consume action is available.</small>
        <button type="button" disabled>Unavailable</button>
      </div>
    </div>
  );
}

// --- Sidebar ---

export function Sidebar({ user, operationsSession }) {
  return (
    <aside className="sidebar" aria-label="Main navigation">
      <Brand />
      <NavList user={user} operationsSession={operationsSession} />
      <StreakCard user={user} />
    </aside>
  );
}

// --- BottomNav ---

export function BottomNav() {
  const location = useLocation();
  const items = navItems.filter((item) => ["/", "/materials", "/questions", "/review", "/bookmarks"].includes(item.path));
  return (
    <nav className="bottom-nav" aria-label="Mobile navigation">
      {items.map((item) => {
        const active = item.path === "/" ? location.pathname === "/" : location.pathname.startsWith(item.path);
        return (
          <Link key={item.path} to={item.path} className={active ? "active" : ""} aria-current={active ? "page" : undefined}>
            <Icon name={item.icon} size={20} />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

// --- Topbar ---

export function Topbar({ user, theme, onThemeChange, onLogout, onMenu, menuOpen, menuButtonRef, onDropdownOpenChange, notificationVersion, onNotificationsChanged }) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [notificationError, setNotificationError] = useState("");
  const [notificationBusy, setNotificationBusy] = useState("");
  const profileMenuRef = useRef(null);
  const searchRef = useRef(null);
  const notificationsRef = useRef(null);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    setOpen(false);
    setNotificationsOpen(false);
  }, [location.pathname, menuOpen]);

  useEffect(() => {
    onDropdownOpenChange?.(open || notificationsOpen);
  }, [open, notificationsOpen, onDropdownOpenChange]);

  useEffect(() => {
    if (!open) return undefined;
    const handlePointerDown = (event) => {
      if (!profileMenuRef.current?.contains(event.target)) setOpen(false);
    };
    const handleKeyDown = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!notificationsOpen) return undefined;
    let active = true;
    setNotificationsLoading(true);
    setNotificationError("");
    Promise.all([motivationApi.listNotifications(), motivationApi.notificationSummary()])
      .then(([feed, summary]) => {
        if (!active) return;
        setNotifications(feed.results);
        setUnreadCount(Number(summary.unread_count) || 0);
      })
      .catch((error) => {
        if (active) setNotificationError(error.message || "Notifications could not be loaded.");
      })
      .finally(() => { if (active) setNotificationsLoading(false); });
    const handlePointerDown = (event) => {
      if (!notificationsRef.current?.contains(event.target)) setNotificationsOpen(false);
    };
    const handleKeyDown = (event) => {
      if (event.key === "Escape") setNotificationsOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      active = false;
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [notificationsOpen]);

  useEffect(() => {
    let active = true;
    motivationApi.notificationSummary()
      .then((summary) => { if (active) setUnreadCount(Number(summary.unread_count) || 0); })
      .catch(() => { if (active) setUnreadCount(0); });
    return () => { active = false; };
  }, [notificationVersion]);

  // Keyboard shortcut: press / to focus search
  useEffect(() => {
    function onGlobalKey(event) {
      if (event.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    }
    document.addEventListener("keydown", onGlobalKey);
    return () => document.removeEventListener("keydown", onGlobalKey);
  }, []);

  function handleSearch(event) {
    if (event.key === "Enter" && searchQuery.trim()) {
      navigate(`/search?q=${encodeURIComponent(searchQuery.trim())}`);
      setSearchQuery("");
      searchRef.current?.blur();
    }
  }

  function logoutFromMenu() {
    setOpen(false);
    onLogout();
  }

  async function refreshNotifications() {
    const [feed, summary] = await Promise.all([motivationApi.listNotifications(), motivationApi.notificationSummary()]);
    setNotifications(feed.results);
    setUnreadCount(Number(summary.unread_count) || 0);
  }

  async function handleNotification(notification) {
    if (!notification || notificationBusy) return;
    setNotificationBusy(notification.id);
    setNotificationError("");
    try {
      if (notification.has_target) {
        const result = await motivationApi.openNotification(notification.id);
        await refreshNotifications();
        onNotificationsChanged?.();
        if (!isKnownNotificationRoute(result.route)) {
          setNotificationError("This notification refers to a screen that is not available in the current frontend integration.");
          return;
        }
        navigate(result.route);
      } else {
        await motivationApi.markNotificationRead(notification.id);
        await refreshNotifications();
        onNotificationsChanged?.();
      }
    } catch (error) {
      setNotificationError(isApiError(error) && error.status === 410 ? "This notification target is no longer available." : error.message || "This notification could not be opened.");
      try { await refreshNotifications(); } catch { /* Keep the actionable server error visible. */ }
    } finally {
      setNotificationBusy("");
    }
  }

  async function handleMarkAllRead() {
    if (!unreadCount || notificationBusy) return;
    setNotificationBusy("all");
    setNotificationError("");
    try {
      await motivationApi.markAllNotificationsRead();
      await refreshNotifications();
      onNotificationsChanged?.();
    } catch (error) {
      setNotificationError(error.message || "Notifications could not be marked read.");
    } finally {
      setNotificationBusy("");
    }
  }

  return (
    <header className="topbar">
      <button className="icon-btn mobile-menu" ref={menuButtonRef} onClick={onMenu} aria-label="Open navigation" aria-expanded={menuOpen} aria-controls="mobile-drawer">
        <Icon name="menu" />
      </button>
      <div className="page-title">
        <h1>{greeting()}, future dentist!</h1>
        <p>Let's continue your journey.</p>
      </div>
      <label className="search-box">
        <Icon name="search" size={18} />
        <input
          ref={searchRef}
          type="search"
          placeholder="Search Dentify (press /)"
          aria-label="Search Dentify"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={handleSearch}
        />
      </label>
      <button className="icon-btn" onClick={() => onThemeChange(theme === "night" ? "day" : "night")} aria-label="Toggle theme">
        <Icon name={theme === "night" ? "sun" : "moon"} />
      </button>
      
      <div className="notifications-menu-wrap" ref={notificationsRef}>
        <button 
          className={`icon-btn ${unreadCount > 0 ? "active" : ""}`} 
          onClick={() => setNotificationsOpen(!notificationsOpen)}
          aria-label="Notifications"
          aria-expanded={notificationsOpen}
        >
          <Icon name="bell" />
          {unreadCount > 0 && <span className="dot" />}
        </button>
        {notificationsOpen && (
          <div className="notifications-dropdown" id="notifications-menu" role="menu">
            <div className="notifications-header">
              <h3>Notifications</h3>
              {unreadCount > 0 && <button className="text-link" type="button" onClick={() => { void handleMarkAllRead(); }} disabled={notificationBusy === "all"}>{notificationBusy === "all" ? "Marking…" : "Mark all read"}</button>}
            </div>
            <div className="notifications-list">
              {notificationsLoading ? <div className="notifications-empty"><Icon name="bell" size={20} /><p>Loading server notifications…</p></div> : notificationError ? <div className="notifications-empty"><Icon name="alert-triangle" size={20} /><p>{notificationError}</p></div> : notifications.length > 0 ? (
                notifications.map((n) => (
                  <div key={n.id} className={`notification-item ${n.read_at ? "read" : "unread"}`} role="menuitem" tabIndex={0} aria-disabled={notificationBusy === n.id} onClick={() => { void handleNotification(n); }} onKeyDown={(event) => { if ((event.key === "Enter" || event.key === " ") && notificationBusy !== n.id) { event.preventDefault(); void handleNotification(n); } }}>
                    <p>{n.title}</p>
                    <div className="notification-meta">
                      <small>{notificationBusy === n.id ? "Opening…" : n.body}</small>
                    </div>
                  </div>
                ))
              ) : (
                <div className="notifications-empty">
                  <Icon name="sparkles" size={20} />
                  <p>No server notifications yet.</p>
                </div>
              )}
            </div>
            <div className="notifications-header"><Link className="text-link" to="/notifications" onClick={() => setNotificationsOpen(false)}>View all notifications</Link></div>
          </div>
        )}
      </div>

      <div className="profile-menu-wrap" ref={profileMenuRef}>
        <button className="avatar-btn" onClick={() => setOpen(!open)} aria-label="Open profile menu" aria-expanded={open} aria-controls="profile-menu">
          <img src={assetPath(assets.mascot)} alt="Student avatar" />
        </button>
        {open && (
          <div className="profile-menu" id="profile-menu" role="menu" aria-label="Profile menu">
            <strong>{user.name}</strong>
            <small>{user.email}</small>
            <Link to="/profile" role="menuitem" onClick={() => setOpen(false)}><Icon name="user" size={17} /> My Profile</Link>
            <Link to="/achievements" role="menuitem" onClick={() => setOpen(false)}><Icon name="award" size={17} /> Achievements</Link>
            <Link to="/settings" role="menuitem" onClick={() => setOpen(false)}><Icon name="settings" size={17} /> Settings</Link>
            <button role="menuitem" onClick={logoutFromMenu}><Icon name="logout" size={17} /> Logout</button>
          </div>
        )}
      </div>
    </header>
  );
}

// --- Shell ---

export function Shell({ children, user, operationsSession, theme, onThemeChange, onLogout, notificationVersion, onNotificationsChanged }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [dropdownActive, setDropdownActive] = useState(false);
  const drawerRef = useRef(null);
  const drawerCloseRef = useRef(null);
  const drawerTriggerRef = useRef(null);
  const drawerTabIndex = drawerOpen ? undefined : -1;
  const location = useLocation();

  useEffect(() => {
    setDrawerOpen(false);
    // Focus management: scroll to top and focus main content on navigation
    window.scrollTo(0, 0);
    const main = document.getElementById("main-content");
    if (main) {
      main.scrollTo(0, 0);
      main.focus({ preventScroll: true });
    }
  }, [location.pathname]);

  useEffect(() => {
    if (!drawerOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    window.setTimeout(() => drawerCloseRef.current?.focus(), 0);
    const handleKeyDown = (event) => {
      if (event.key === "Escape") setDrawerOpen(false);
      if (event.key === "Tab") {
        const focusable = Array.from(
          drawerRef.current?.querySelectorAll("a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])") || []
        );
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      window.setTimeout(() => drawerTriggerRef.current?.focus(), 0);
    };
  }, [drawerOpen]);

  return (
    <>
      <a className="skip-link" href="#main-content">Skip to content</a>
      <div className="app-shell">
        <Sidebar user={user} operationsSession={operationsSession} />
        <div className="content-frame">
          <Topbar
            user={user}
            theme={theme}
            onThemeChange={onThemeChange}
            onLogout={onLogout}
            onMenu={() => setDrawerOpen(true)}
            menuOpen={drawerOpen}
            menuButtonRef={drawerTriggerRef}
            onDropdownOpenChange={setDropdownActive}
            notificationVersion={notificationVersion}
            onNotificationsChanged={onNotificationsChanged}
          />
          <main className="page-shell" id="main-content" tabIndex={-1} aria-label="Dentify page content">{children}</main>
        </div>
        <BottomNav />
        <div className={`dropdown-backdrop ${dropdownActive ? "open" : ""}`} />
        <div className={`drawer-backdrop ${drawerOpen ? "open" : ""}`} onClick={() => setDrawerOpen(false)} />
        <aside className={`mobile-drawer ${drawerOpen ? "open" : ""}`} id="mobile-drawer" ref={drawerRef} aria-label="Mobile navigation" aria-hidden={drawerOpen ? undefined : "true"} aria-modal={drawerOpen ? "true" : undefined} role="dialog">
          <div className="drawer-head">
            <Brand />
            <button className="icon-btn" ref={drawerCloseRef} onClick={() => setDrawerOpen(false)} aria-label="Close navigation" tabIndex={drawerTabIndex}>
              <Icon name="x" />
            </button>
          </div>
          <DrawerThemeSelector activeTheme={theme} onThemeChange={onThemeChange} tabIndex={drawerTabIndex} />
          <NavList user={user} operationsSession={operationsSession} tabIndex={drawerTabIndex} onNavigate={() => setDrawerOpen(false)} />
        </aside>
      </div>
    </>
  );
}
