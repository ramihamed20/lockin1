import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Icon } from "../../lib/icons.jsx";
import { getStreakTier } from "../../lib/streakTier.js";
import { motivationApi } from "../../api/motivation.js";
import { isApiError } from "../../api/client.js";
import { isKnownNotificationRoute } from "../../lib/notificationRoutes.js";
import { notificationPresentation } from "../../lib/notificationPresentation.js";
import { PROGRESSION_UPDATED_EVENT } from "../../lib/progressionEvents.js";
import { COMPACT_SHELL_QUERY, navItems, themeOptions } from "../../lib/constants.js";
import { assets } from "../../lib/constants.js";
import { assetPath, cssVars } from "../../lib/utils.js";
import { PRODUCT_ROLES } from "../../api/contracts.js";
import { hasProductRole } from "../../lib/authz.js";
import { hasOperationalCapability } from "../../lib/authz.js";
import { useScrollOverflow } from "../../hooks/useScrollOverflow.js";
import { useSidebarDensity } from "../../hooks/useSidebarDensity.js";
import { useI18n } from "../I18nProvider.jsx";
import { routeMetadata } from "../../lib/routeMetadata.js";
import { formatNumber, greetingKey } from "../../lib/i18n.js";
import { Skeleton, SkeletonAvatar, SkeletonText } from "../ui/index.jsx";

// --- Brand ---

export function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark">
        <img src={assetPath("/icons/lockin-light-192-v2.png")} alt="Lock-in Logo" className="brand-logo-img" draggable="false" />
      </span>
      <strong>lock-in</strong>
    </div>
  );
}

// --- NavList ---

function roleNavigationItems(user, operationsSession) {
  const productCreator = hasProductRole(user, PRODUCT_ROLES.CREATOR) || hasProductRole(user, PRODUCT_ROLES.ADMINISTRATOR);
  const contentAdministrator = hasOperationalCapability(operationsSession, "content.manage");
  const assessmentAdministrator = hasOperationalCapability(operationsSession, "assessments.manage");
  const creatorItems = productCreator || contentAdministrator || assessmentAdministrator
    ? [{ path: contentAdministrator || productCreator ? "/creator/education" : "/creator/questions", label: productCreator ? "Content Studio" : "Content Administration", labelKey: productCreator ? "nav.creator" : "nav.contentAdmin", icon: "layers", group: "Workspace", groupKey: "group.workspace" }]
    : [];
  const operationsItems = hasOperationalCapability(operationsSession, "overview.view")
    ? [{ path: "/operations/admin/overview", label: "Creator Studio", labelKey: "nav.operations", icon: "settings", group: "Workspace", groupKey: "group.workspace" }]
    : [];
  const moderationItems = hasProductRole(user, PRODUCT_ROLES.MODERATOR)
    ? [{ path: "/moderation", label: "Moderation", labelKey: "nav.moderation", icon: "shield-alert", group: "Workspace", groupKey: "group.workspace" }]
    : [];
  return [...creatorItems, ...moderationItems, ...operationsItems];
}

// The dashboard answers to two paths, so matching "/" on equality alone left
// /dashboard with no highlighted nav item and no aria-current anywhere.
const DASHBOARD_PATHS = new Set(["/", "/dashboard"]);

function isNavigationItemActive(pathname, path) {
  return path === "/" ? DASHBOARD_PATHS.has(pathname) : pathname.startsWith(path);
}

export function NavList({ tabIndex = undefined, onNavigate = undefined, user, operationsSession }) {
  const location = useLocation();
  const { t } = useI18n();
  const scrollRef = useScrollOverflow();
  const visibleItems = [...navItems, ...roleNavigationItems(user, operationsSession)];
  let currentGroup = "";
  return (
    <nav className="nav-list" aria-label="Primary" ref={scrollRef}>
      {visibleItems.map((item) => {
        const showGroup = item.group !== currentGroup;
        currentGroup = item.group;
        const active = isNavigationItemActive(location.pathname, item.path);
        return (
          <div className="nav-entry" key={item.path}>
            {showGroup && <span className="nav-section-label">{t(item.groupKey || `group.${item.group.toLowerCase()}`)}</span>}
            <Link to={item.path} className={`nav-btn ${active ? "active" : ""}`} aria-label={t(item.labelKey || item.label)} title={t(item.labelKey || item.label)} aria-current={active ? "page" : undefined} tabIndex={tabIndex} onClick={onNavigate}>
              <Icon name={item.icon} size={19} />
              <span>{t(item.labelKey || item.label)}</span>
            </Link>
          </div>
        );
      })}
    </nav>
  );
}

// --- DrawerThemeSelector ---

export function DrawerThemeSelector({ activeTheme, onThemeChange, tabIndex }) {
  const { t } = useI18n();
  return (
    <section className="drawer-theme-selector" aria-label={t("common.appearance")}>
      <div>
        <p className="nav-section-label">{t("common.appearance")}</p>
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

function drawerRoleLabel(user, t) {
  if (hasProductRole(user, PRODUCT_ROLES.ADMINISTRATOR)) return t("shell.administrator");
  if (hasProductRole(user, PRODUCT_ROLES.CREATOR)) return t("shell.creator");
  if (hasProductRole(user, PRODUCT_ROLES.MODERATOR)) return t("shell.moderator");
  return t("shell.student");
}

function DrawerProfile({ user, tabIndex, active, onNavigate }) {
  const { t } = useI18n();
  return (
    <section className={`drawer-profile ${active ? "active" : ""}`.trim()} aria-label={t("shell.signedInAccount")}>
      <img src={assetPath(assets.mascot)} alt="" aria-hidden="true" draggable="false" />
      <div className="drawer-profile-copy">
        <strong dir="auto">{user?.name || t("shell.yourProfile")}</strong>
        <span>{drawerRoleLabel(user, t)}</span>
        {user?.email && <small>{user.email}</small>}
      </div>
      <Link className="drawer-profile-action" to="/profile" aria-label="Open profile" aria-current={active ? "page" : undefined} tabIndex={tabIndex} onClick={onNavigate} draggable="false">
        <Icon name="chevron-right" size={17} />
      </Link>
    </section>
  );
}

function DrawerNavGroup({ label, items, pathname, tabIndex, onNavigate, children = null }) {
  const { t } = useI18n();
  const generatedId = useId();
  const labelId = `mobile-drawer-${generatedId.replace(/:/g, "")}`;
  return (
    <section className="drawer-nav-group" aria-labelledby={labelId}>
      <h3 className="nav-section-label" id={labelId}>{label}</h3>
      <div className="drawer-nav-items">
        {items.map((item) => {
          const active = isNavigationItemActive(pathname, item.path);
          return (
            <Link key={item.path} className={`nav-btn ${active ? "active" : ""}`.trim()} to={item.path} aria-current={active ? "page" : undefined} tabIndex={tabIndex} onClick={onNavigate} draggable="false">
              <Icon name={item.icon} size={19} />
              <span>{t(item.labelKey || item.label)}</span>
              {active && <span className="drawer-active-dot" aria-hidden="true" />}
            </Link>
          );
        })}
        {children}
      </div>
    </section>
  );
}

function MobileDrawerNavigation({ user, operationsSession, pathname, tabIndex, onNavigate, onLogout }) {
  const { t } = useI18n();
  const primaryPaths = new Set(["/", "/materials", "/questions", "/review"]);
  const primaryItems = [
    ...navItems.filter((item) => primaryPaths.has(item.path)),
    { path: "/search", label: "Search", labelKey: "nav.search", icon: "search" }
  ];
  const exploreItems = navItems.filter((item) => !primaryPaths.has(item.path));
  const workspaceItems = roleNavigationItems(user, operationsSession);
  const accountItems = [
    { path: "/notifications", label: "Notifications", labelKey: "nav.notifications", icon: "bell" },
    { path: "/achievements", label: "Achievements", labelKey: "nav.achievements", icon: "award" },
    { path: "/settings", label: "Settings", labelKey: "nav.settings", icon: "settings" }
  ];

  return (
    <nav className="drawer-navigation" aria-label={t("shell.mobileDestinations")}>
      <DrawerNavGroup label={t("common.primary")} items={primaryItems} pathname={pathname} tabIndex={tabIndex} onNavigate={onNavigate} />
      {workspaceItems.length > 0 && <DrawerNavGroup label={t("common.workspace")} items={workspaceItems} pathname={pathname} tabIndex={tabIndex} onNavigate={onNavigate} />}
      <DrawerNavGroup label={t("common.explore")} items={exploreItems} pathname={pathname} tabIndex={tabIndex} onNavigate={onNavigate} />
      <DrawerNavGroup label={t("common.account")} items={accountItems} pathname={pathname} tabIndex={tabIndex} onNavigate={onNavigate}>
        <button className="nav-btn drawer-logout" type="button" tabIndex={tabIndex} onClick={onLogout}>
          <Icon name="logout" size={19} />
          <span>{t("common.logout")}</span>
        </button>
      </DrawerNavGroup>
    </nav>
  );
}

// --- StreakCard ---

export function StreakCard() {
  const [state, setState] = useState({ loading: true, error: "", data: null });

  useEffect(() => {
    let active = true;
    const loadStreak = () => {
      motivationApi.streakSummary()
        .then((data) => { if (active) setState({ loading: false, error: "", data }); })
        .catch((error) => { if (active) setState({ loading: false, error: error.message || "Streak unavailable", data: null }); });
    };
    const refreshWhenVisible = () => {
      if (!document.hidden) loadStreak();
    };
    loadStreak();
    window.addEventListener(PROGRESSION_UPDATED_EVENT, loadStreak);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      active = false;
      window.removeEventListener(PROGRESSION_UPDATED_EVENT, loadStreak);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, []);

  if (state.loading) {
    return <div className="streak-card streak-card--loading" aria-label="Loading study streak" aria-busy="true"><div className="streak-card-heading"><Skeleton className="streak-skeleton-icon" /><Skeleton className="streak-skeleton-heading" /></div><Skeleton className="streak-skeleton-value" /><SkeletonText className="streak-skeleton-copy" lines={1} /><Skeleton className="streak-skeleton-track" /></div>;
  }

  if (state.error || !state.data) {
    return <Link className="streak-card streak-card--unavailable" to="/lock-in"><div className="streak-card-heading"><Icon name="flame" size={18} /><span>Study streak</span><small>30 days</small></div><strong className="streak-card-value">— <small>day</small></strong><span className="streak-card-track"><i style={{ width: "0%" }} /></span><FreezeRow /></Link>;
  }

  const currentDays = Number(state.data.current_days) || 0;
  const streakTier = getStreakTier(currentDays);
  const streakStyle = /** @type {import("react").CSSProperties & { "--streak-tier-color": string }} */ ({ "--streak-tier-color": streakTier.color });
  return (
    <Link className={`streak-card ${currentDays ? "streak-card--active" : "streak-card--ready"}`} to="/lock-in" aria-label={`${currentDays} day study streak. Open Lock In.`} style={streakStyle}>
      <div className="streak-card-heading"><Icon name="flame" size={18} /><span>Study streak</span><small>30 days</small></div>
      <strong className="streak-card-value">{currentDays} <small>day</small></strong>
      <span className="streak-card-track"><i style={{ width: `${streakTier.progress}%` }} /></span>
      <FreezeRow />
    </Link>
  );
}

function FreezeRow() {
  return <div className="streak-freeze"><span className="streak-freeze-icon"><Icon name="snowflake" size={16} /></span><div><strong>Freeze</strong><small>Protect your streak for 1 week</small></div><em>Soon</em></div>;
}

// --- Sidebar ---

export function Sidebar({ user, operationsSession, inert = false }) {
  const densityRef = useSidebarDensity();
  return (
    <aside className="sidebar" ref={densityRef} aria-label="Main navigation" inert={inert ? "" : undefined} aria-hidden={inert || undefined}>
      <Brand />
      <NavList user={user} operationsSession={operationsSession} />
      <StreakCard />
    </aside>
  );
}

// --- BottomNav ---

export function BottomNav({ onMore, menuOpen, inert = false }) {
  const location = useLocation();
  const { t } = useI18n();
  const items = navItems.filter((item) => ["/", "/materials", "/questions", "/review"].includes(item.path));
  return (
    <nav className="bottom-nav" aria-label={t("shell.mobileNavigation")} inert={inert ? "" : undefined} aria-hidden={inert || undefined}>
      {items.map((item) => {
        const active = isNavigationItemActive(location.pathname, item.path);
        return (
          <Link key={item.path} to={item.path} className={active ? "active" : ""} aria-current={active ? "page" : undefined}>
            <Icon name={item.icon} size={20} />
            <span>{t(item.labelKey || item.label)}</span>
          </Link>
        );
      })}
      <button type="button" onClick={onMore} aria-label={t("common.more")} aria-expanded={menuOpen} aria-controls="mobile-drawer">
        <Icon name="menu" size={20} />
        <span>{t("common.more")}</span>
      </button>
    </nav>
  );
}

// --- Topbar ---

export function Topbar({ user, theme, onThemeChange, onLogout, onMenu, menuOpen, menuButtonRef, onDropdownOpenChange, notificationVersion, onNotificationsChanged, storeCartCount = 0, lockBalance = 1250 }) {
  const { t, locale } = useI18n();
  const [profileMenuState, setProfileMenuState] = useState("closed");
  const [isPhone, setIsPhone] = useState(() => window.matchMedia(COMPACT_SHELL_QUERY).matches);
  const [profileMenuPosition, setProfileMenuPosition] = useState({ left: 12, top: 12 });
  const [searchQuery, setSearchQuery] = useState("");
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [notificationError, setNotificationError] = useState("");
  const [notificationBusy, setNotificationBusy] = useState("");
  const topbarRef = useRef(null);
  const profileMenuRef = useRef(null);
  const profileButtonRef = useRef(null);
  const profilePanelRef = useRef(null);
  const profileBackdropRef = useRef(null);
  const profileCloseTimerRef = useRef(null);
  const profilePositionFrameRef = useRef(0);
  const profileGestureRef = useRef(null);
  const suppressProfileClickRef = useRef(false);
  const searchRef = useRef(null);
  const notificationsRef = useRef(null);
  const location = useLocation();
  const navigate = useNavigate();
  const isStoreRoute = location.pathname === "/store";
  const isDashboardRoute = location.pathname === "/" || location.pathname === "/dashboard";
  const currentRoute = routeMetadata(location.pathname, t);
  const localizedGreeting = t(greetingKey());
  const profileMenuOpen = profileMenuState !== "closed";

  const updateProfileMenuPosition = useCallback(() => {
    const avatar = profileButtonRef.current;
    if (isPhone || !avatar) return;
    const anchor = avatar.getBoundingClientRect();
    const width = Math.min(312, Math.max(280, window.innerWidth * 0.3));
    const left = Math.min(Math.max(12, anchor.right - width), window.innerWidth - width - 12);
    const top = Math.max(12, Math.min(anchor.bottom + 10, window.innerHeight - 276));
    setProfileMenuPosition((current) => current.left === left && current.top === top ? current : { left, top });
  }, [isPhone]);

  const closeProfileMenu = useCallback(({ restoreFocus = true } = {}) => {
    if (!profileMenuOpen) return;
    window.clearTimeout(profileCloseTimerRef.current);
    setProfileMenuState("closing");
    profileCloseTimerRef.current = window.setTimeout(() => {
      setProfileMenuState("closed");
      if (restoreFocus) profileButtonRef.current?.focus();
    }, 180);
  }, [profileMenuOpen]);

  function openProfileMenu() {
    window.clearTimeout(profileCloseTimerRef.current);
    profilePanelRef.current?.classList.remove("is-dragging");
    profilePanelRef.current?.style.removeProperty("transform");
    profileBackdropRef.current?.classList.remove("is-dragging");
    profileBackdropRef.current?.style.removeProperty("opacity");
    updateProfileMenuPosition();
    setProfileMenuState("open");
  }

  function toggleProfileMenu() {
    if (profileMenuOpen) closeProfileMenu();
    else openProfileMenu();
  }

  useEffect(() => {
    closeProfileMenu({ restoreFocus: false });
    setNotificationsOpen(false);
    // Location is deliberately the only dependency: navigating must close an
    // account surface without sending focus back to an avatar on a new page.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- opening the menu must not trigger route cleanup
  }, [location.pathname, menuOpen]);

  useEffect(() => {
    onDropdownOpenChange?.(notificationsOpen);
  }, [notificationsOpen, onDropdownOpenChange]);

  useEffect(() => {
    const query = window.matchMedia(COMPACT_SHELL_QUERY);
    const update = () => setIsPhone(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  // Local navigation strips on Progress, Profile, Settings and the Store stick
  // directly under the top bar. Its height changes with the breakpoint and with
  // the safe-area inset, so publish the measured value rather than letting each
  // strip guess an offset and leave a slit for content to show through.
  useEffect(() => {
    const header = topbarRef.current;
    if (!header) return undefined;
    const publish = () => {
      const height = Math.round(header.getBoundingClientRect().height);
      if (height > 0) document.documentElement.style.setProperty("--app-header-height", `${height}px`);
    };
    publish();
    const observer = new window.ResizeObserver(publish);
    observer.observe(header);
    window.addEventListener("resize", publish, { passive: true });
    window.addEventListener("orientationchange", publish);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", publish);
      window.removeEventListener("orientationchange", publish);
    };
  }, []);

  useEffect(() => {
    if (!profileMenuOpen) return undefined;
    const handlePointerDown = (event) => {
      if (!profileMenuRef.current?.contains(event.target) && !profilePanelRef.current?.contains(event.target)) closeProfileMenu();
    };
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeProfileMenu();
      }
    };
    if (!isPhone) document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeProfileMenu, isPhone, profileMenuOpen]);

  useEffect(() => {
    if (!profileMenuOpen || isPhone) return undefined;
    const scheduleReposition = () => {
      if (profilePositionFrameRef.current) return;
      profilePositionFrameRef.current = window.requestAnimationFrame(() => {
        profilePositionFrameRef.current = 0;
        updateProfileMenuPosition();
      });
    };
    scheduleReposition();
    window.addEventListener("resize", scheduleReposition);
    window.addEventListener("scroll", scheduleReposition, { capture: true, passive: true });
    return () => {
      window.cancelAnimationFrame(profilePositionFrameRef.current);
      profilePositionFrameRef.current = 0;
      window.removeEventListener("resize", scheduleReposition);
      window.removeEventListener("scroll", scheduleReposition, true);
    };
  }, [isPhone, profileMenuOpen, updateProfileMenuPosition]);

  useEffect(() => {
    if (!profileMenuOpen || !isPhone) return undefined;
    const { body } = document;
    const previousOverflow = body.style.overflow;
    const previousTouchAction = body.style.touchAction;
    body.style.overflow = "hidden";
    body.style.touchAction = "none";
    window.setTimeout(() => profilePanelRef.current?.focus(), 0);
    return () => {
      body.style.overflow = previousOverflow;
      body.style.touchAction = previousTouchAction;
    };
  }, [isPhone, profileMenuOpen]);

  useEffect(() => {
    if (!profileMenuOpen) return undefined;
    const panel = profilePanelRef.current;
    const backdrop = profileBackdropRef.current;
    // Popover places this account surface in the browser's top layer. That is
    // stronger than any local z-index and escapes sticky/immersive stacks.
    const show = (element) => {
      if (element?.showPopover && !element.matches(":popover-open")) element.showPopover();
    };
    try {
      show(backdrop);
      show(panel);
    } catch {
      // The fixed, portalled surface remains the fallback for older browsers.
    }
    return () => {
      try {
        if (panel?.hidePopover && panel.matches(":popover-open")) panel.hidePopover();
        if (backdrop?.hidePopover && backdrop.matches(":popover-open")) backdrop.hidePopover();
      } catch { /* The browser may already have removed the top-layer entry. */ }
    };
  }, [profileMenuOpen]);

  useEffect(() => () => window.clearTimeout(profileCloseTimerRef.current), []);

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
    closeProfileMenu({ restoreFocus: false });
    onLogout();
  }

  function handleProfileMenuKeyDown(event) {
    const actions = [...profilePanelRef.current?.querySelectorAll("a, button") || []]
      .filter((element) => !element.disabled);
    if (event.key === "Tab" && isPhone && actions.length) {
      const first = actions[0];
      const last = actions[actions.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === profilePanelRef.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    if (!actions.length) return;
    event.preventDefault();
    const current = actions.indexOf(document.activeElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? actions.length - 1 : event.key === "ArrowDown"
      ? (current + 1 + actions.length) % actions.length
      : (current - 1 + actions.length) % actions.length;
    actions[next].focus();
  }

  function handleProfilePointerDown(event) {
    if (!isPhone || !profileMenuOpen || !event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return;
    const panel = profilePanelRef.current;
    if (!panel) return;
    profileGestureRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastDistance: 0,
      lastTime: event.timeStamp,
      velocity: 0,
      intent: "pending",
      rtl: document.documentElement.dir === "rtl",
      width: panel.getBoundingClientRect().width
    };
  }

  function handleProfilePointerMove(event) {
    const gesture = profileGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;

    const deltaX = event.clientX - gesture.startX;
    const deltaY = event.clientY - gesture.startY;
    const horizontal = Math.abs(deltaX);
    const vertical = Math.abs(deltaY);
    const closingDistance = gesture.rtl ? -deltaX : deltaX;

    if (gesture.intent === "pending") {
      if (Math.max(horizontal, vertical) < 8) return;
      if (vertical > horizontal * 1.15) {
        gesture.intent = "vertical";
        return;
      }
      if (horizontal > vertical * 1.15 && closingDistance > 0) {
        gesture.intent = "horizontal";
        profilePanelRef.current?.setPointerCapture?.(event.pointerId);
        profilePanelRef.current?.classList.add("is-dragging");
        profileBackdropRef.current?.classList.add("is-dragging");
      } else if (horizontal > vertical * 1.15) {
        gesture.intent = "rejected";
        return;
      } else return;
    }

    if (gesture.intent !== "horizontal") return;
    event.preventDefault();
    const distance = Math.min(gesture.width, Math.max(0, closingDistance));
    const progress = gesture.width ? distance / gesture.width : 0;
    const elapsed = Math.max(1, event.timeStamp - gesture.lastTime);
    const instantaneousVelocity = (distance - gesture.lastDistance) / elapsed;
    gesture.velocity = gesture.lastDistance === 0 ? instantaneousVelocity : gesture.velocity * 0.65 + instantaneousVelocity * 0.35;
    gesture.lastDistance = distance;
    gesture.lastTime = event.timeStamp;

    profilePanelRef.current?.style.setProperty("transform", `translate3d(${gesture.rtl ? -distance : distance}px, 0, 0)`);
    profileBackdropRef.current?.style.setProperty("opacity", String(1 - progress * 0.62));
  }

  function finishProfileGesture(event, cancelled = false) {
    const gesture = profileGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    profileGestureRef.current = null;
    if (gesture.intent !== "horizontal") return;

    suppressProfileClickRef.current = true;
    window.setTimeout(() => { suppressProfileClickRef.current = false; }, 0);
    const panel = profilePanelRef.current;
    if (panel?.hasPointerCapture?.(event.pointerId)) panel.releasePointerCapture(event.pointerId);
    panel?.classList.remove("is-dragging");
    profileBackdropRef.current?.classList.remove("is-dragging");

    const progress = gesture.width ? gesture.lastDistance / gesture.width : 0;
    const shouldClose = !cancelled && (progress >= 0.3 || (gesture.lastDistance >= Math.min(48, gesture.width * 0.12) && gesture.velocity >= 0.5));
    if (shouldClose) {
      panel?.style.removeProperty("transform");
      profileBackdropRef.current?.style.removeProperty("opacity");
      closeProfileMenu();
      return;
    }

    panel?.style.removeProperty("transform");
    profileBackdropRef.current?.style.removeProperty("opacity");
  }

  function handleProfileClickCapture(event) {
    if (!suppressProfileClickRef.current) return;
    event.preventDefault();
    event.stopPropagation();
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

  const profileMenuContent = profileMenuOpen ? <>
    {isPhone && <button className={`account-menu-backdrop ${profileMenuState === "closing" ? "is-closing" : ""}`} ref={profileBackdropRef} popover="manual" type="button" tabIndex={-1} aria-label="Close account menu" onClick={() => closeProfileMenu()} />}
    {/* The panel intentionally owns pointer gestures for swipe-to-dismiss. */}
    {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
    <section
      className={`profile-menu account-menu ${isPhone ? "account-menu--sidepanel" : "account-menu--popover"} ${profileMenuState === "closing" ? "is-closing" : ""}`}
      id="profile-menu"
      ref={profilePanelRef}
      popover="manual"
      role={isPhone ? "dialog" : "menu"}
      aria-modal={isPhone ? "true" : undefined}
      aria-labelledby="account-menu-name"
      tabIndex={-1}
      style={!isPhone ? cssVars({ "--account-menu-left": `${profileMenuPosition.left}px`, "--account-menu-top": `${profileMenuPosition.top}px` }) : undefined}
      onKeyDown={handleProfileMenuKeyDown}
      onPointerDown={handleProfilePointerDown}
      onPointerMove={handleProfilePointerMove}
      onPointerUp={finishProfileGesture}
      onPointerCancel={(event) => finishProfileGesture(event, true)}
      onClickCapture={handleProfileClickCapture}
    >
      {isPhone && (
        <div className="account-menu-drawer-head">
          <span>{t("shell.profileMenu")}</span>
          <button className="icon-btn account-menu-close" type="button" onClick={() => closeProfileMenu()} aria-label={t("common.close")}>
            <Icon name="x" size={19} />
          </button>
        </div>
      )}
      <div className="account-menu-identity">
        <img src={assetPath(assets.mascot)} alt="" aria-hidden="true" draggable="false" />
        <div>
          <strong id="account-menu-name" dir="auto">{user.name || t("shell.yourProfile")}</strong>
          <small dir="auto">{user.email || drawerRoleLabel(user, t)}</small>
        </div>
      </div>
      {isPhone && <p className="account-menu-section-label">{t("common.account")}</p>}
      <nav className="account-menu-actions" role={isPhone ? undefined : "none"} aria-label={isPhone ? t("shell.profileMenu") : undefined}>
        <Link to="/profile" role={isPhone ? undefined : "menuitem"} onClick={() => closeProfileMenu({ restoreFocus: false })}><span className="account-menu-icon"><Icon name="user" size={18} /></span><span><b>{t("common.profile")}</b><small>{t("shell.profileDescription")}</small></span><Icon className="account-menu-chevron" name="chevron-right" size={17} /></Link>
        <Link to="/settings" role={isPhone ? undefined : "menuitem"} onClick={() => closeProfileMenu({ restoreFocus: false })}><span className="account-menu-icon"><Icon name="settings" size={18} /></span><span><b>{t("common.settings")}</b><small>{t("shell.settingsDescription")}</small></span><Icon className="account-menu-chevron" name="chevron-right" size={17} /></Link>
      </nav>
      <div className="account-menu-separator" aria-hidden="true" />
      <button className="account-menu-signout" type="button" role={isPhone ? undefined : "menuitem"} onClick={logoutFromMenu}><span className="account-menu-icon"><Icon name="logout" size={18} /></span><span><b>{t("common.logout")}</b><small>{t("shell.logoutDescription")}</small></span></button>
    </section>
  </> : null;

  return (
    <>
    <header className={`topbar ${isStoreRoute ? "store-topbar" : ""}`} ref={topbarRef}>
      <button className="icon-btn mobile-menu" ref={menuButtonRef} onClick={onMenu} aria-label={t("shell.openNavigation")} aria-expanded={menuOpen} aria-controls="mobile-drawer">
        <Icon name="menu" />
      </button>
      {isDashboardRoute ? (
        <div className="page-title">
          <strong>{localizedGreeting}</strong>
        </div>
      ) : (
        <div className="page-title">
          <strong>{currentRoute.shellLabel}</strong>
          <p>{t("shell.greetingLine", { greeting: localizedGreeting, audience: t("shell.futureDentist") })}</p>
        </div>
      )}
      <label className="search-box">
        <Icon name="search" size={18} />
        <input
          ref={searchRef}
          type="search"
          placeholder={t("shell.searchPlaceholder")}
          aria-label={t("common.search")}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={handleSearch}
        />
      </label>
      <Link className="icon-btn topbar-search-action" to="/search" aria-label={t("common.search")}>
        <Icon name="search" size={19} />
      </Link>
      <button className="icon-btn" onClick={() => onThemeChange(theme === "night" ? "day" : "night")} aria-label={t("shell.toggleTheme")}>
        <Icon name={theme === "night" ? "sun" : "moon"} />
      </button>
      {isStoreRoute && <>
        <div className="store-balance" aria-label={`${formatNumber(lockBalance, {}, locale)} LOCK`}>
          <Icon name="coins" size={18} />
          <strong>{formatNumber(lockBalance, {}, locale)}</strong><span>LOCK</span>
        </div>
        <button className="icon-btn store-header-cart" type="button" onClick={() => window.dispatchEvent(new window.CustomEvent("lock-in:open-store-cart"))} aria-label={`Open cart, ${storeCartCount} item${storeCartCount === 1 ? "" : "s"}`}>
          <Icon name="shopping-bag" />
          {storeCartCount > 0 && <span className="store-cart-count">{storeCartCount}</span>}
        </button>
      </>}
      
      <div className="notifications-menu-wrap" ref={notificationsRef}>
        <button 
          className={`icon-btn ${unreadCount > 0 ? "active" : ""}`} 
          onClick={() => setNotificationsOpen(!notificationsOpen)}
          aria-label={t("common.notifications")}
          aria-expanded={notificationsOpen}
        >
          <Icon name="bell" />
          {unreadCount > 0 && <span className="dot" />}
        </button>
        {notificationsOpen && (
          <section className="notifications-dropdown" id="notifications-menu" aria-label={t("common.notifications")}>
            <div className="notifications-header">
              <div><p>{t("common.inbox")}</p><h3>{t("common.notifications")}</h3></div>
              {unreadCount > 0 && <button className="text-link" type="button" onClick={() => { void handleMarkAllRead(); }} disabled={notificationBusy === "all"}>{notificationBusy === "all" ? t("common.opening") : t("common.markAllRead")}</button>}
            </div>
            <div className="notifications-list">
              {notificationsLoading ? <div className="notifications-loading" aria-label="Loading notifications" aria-busy="true">{Array.from({ length: 3 }, (_, index) => <div className="notifications-loading-row" key={index}><SkeletonAvatar /><SkeletonText lines={2} /></div>)}</div> : notificationError ? <div className="notifications-empty"><Icon name="alert-triangle" size={20} /><p>{notificationError}</p></div> : notifications.length > 0 ? (
                notifications.map((n) => {
                  const presentation = notificationPresentation(n.category);
                  return <button key={n.id} className={`notification-item notification-item--${presentation.tone} ${n.read_at ? "read" : "unread"}`} type="button" disabled={notificationBusy === n.id} onClick={() => { void handleNotification(n); }}>
                    <span className="notification-item-icon"><Icon name={presentation.icon} size={17} /></span>
                    <span className="notification-item-copy" dir="auto"><span className="notification-item-heading"><strong>{n.title}</strong>{!n.read_at && <i aria-label={t("notifications.unread")} />}</span><small>{notificationBusy === n.id ? t("common.opening") : n.body}</small><em>{t(presentation.labelKey)}</em></span>
                  </button>;
                })
              ) : (
                <div className="notifications-empty">
                  <Icon name="sparkles" size={20} />
                  <p>{t("common.noNotifications")}</p>
                </div>
              )}
            </div>
            <div className="notifications-header"><Link className="text-link" to="/notifications" onClick={() => setNotificationsOpen(false)}>{t("common.viewAllNotifications")}</Link></div>
          </section>
        )}
      </div>

      <div className="profile-menu-wrap" ref={profileMenuRef}>
        <button className="avatar-btn" ref={profileButtonRef} onClick={toggleProfileMenu} aria-label={t("shell.openProfileMenu")} aria-haspopup={isPhone ? "dialog" : "menu"} aria-expanded={profileMenuOpen} aria-controls="profile-menu">
          <img src={assetPath(assets.mascot)} alt="Student avatar" />
        </button>
      </div>
    </header>
    {createPortal(profileMenuContent, document.body)}
    </>
  );
}

// --- Shell ---

export function Shell({ children, user, operationsSession, theme, onThemeChange, onLogout, notificationVersion, onNotificationsChanged, storeCartCount, lockBalance }) {
  const { t } = useI18n();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [dropdownActive, setDropdownActive] = useState(false);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const drawerRef = useRef(null);
  const drawerScrollRef = useScrollOverflow();
  const drawerBackdropRef = useRef(null);
  const drawerCloseRef = useRef(null);
  const topbarMenuRef = useRef(null);
  const drawerTriggerRef = useRef(null);
  const drawerGestureRef = useRef(null);
  const suppressDrawerClickRef = useRef(false);
  const restoreDrawerFocusRef = useRef(true);
  const drawerTabIndex = drawerOpen ? undefined : -1;
  const location = useLocation();

  function resetDrawerGestureStyles() {
    const drawer = drawerRef.current;
    const backdrop = drawerBackdropRef.current;
    drawer?.classList.remove("is-dragging");
    backdrop?.classList.remove("is-dragging");
    drawer?.style.setProperty("--drawer-drag-translate", "0px");
    backdrop?.style.setProperty("--drawer-backdrop-progress", "1");
  }

  function openDrawer(event) {
    drawerTriggerRef.current = event?.currentTarget || topbarMenuRef.current;
    restoreDrawerFocusRef.current = true;
    resetDrawerGestureStyles();
    setDrawerOpen(true);
  }

  function closeDrawer({ restoreFocus = true } = {}) {
    restoreDrawerFocusRef.current = restoreFocus;
    setDrawerOpen(false);
  }

  function handleDrawerPointerDown(event) {
    if (!drawerOpen || !event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return;
    const drawer = drawerRef.current;
    if (!drawer) return;
    drawerGestureRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastDistance: 0,
      lastTime: event.timeStamp,
      velocity: 0,
      intent: "pending",
      rtl: document.documentElement.dir === "rtl",
      width: drawer.getBoundingClientRect().width
    };
  }

  function handleDrawerPointerMove(event) {
    const gesture = drawerGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;

    const deltaX = event.clientX - gesture.startX;
    const deltaY = event.clientY - gesture.startY;
    const horizontal = Math.abs(deltaX);
    const vertical = Math.abs(deltaY);
    const closingDistance = gesture.rtl ? deltaX : -deltaX;

    if (gesture.intent === "pending") {
      if (Math.max(horizontal, vertical) < 8) return;
      if (vertical > horizontal * 1.15) {
        gesture.intent = "vertical";
        return;
      }
      if (horizontal > vertical * 1.15 && closingDistance > 0) {
        gesture.intent = "horizontal";
        drawerRef.current?.setPointerCapture?.(event.pointerId);
        drawerRef.current?.classList.add("is-dragging");
        drawerBackdropRef.current?.classList.add("is-dragging");
      } else if (horizontal > vertical * 1.15) {
        gesture.intent = "rejected";
        return;
      } else {
        return;
      }
    }

    if (gesture.intent !== "horizontal") return;
    event.preventDefault();

    const distance = Math.min(gesture.width, Math.max(0, closingDistance));
    const progress = gesture.width > 0 ? distance / gesture.width : 0;
    const elapsed = Math.max(1, event.timeStamp - gesture.lastTime);
    const instantaneousVelocity = (distance - gesture.lastDistance) / elapsed;
    gesture.velocity = gesture.lastDistance === 0
      ? instantaneousVelocity
      : gesture.velocity * 0.65 + instantaneousVelocity * 0.35;
    gesture.lastDistance = distance;
    gesture.lastTime = event.timeStamp;

    const translate = gesture.rtl ? distance : -distance;
    drawerRef.current?.style.setProperty("--drawer-drag-translate", `${translate}px`);
    drawerBackdropRef.current?.style.setProperty("--drawer-backdrop-progress", String(1 - progress));
  }

  function finishDrawerGesture(event, cancelled = false) {
    const gesture = drawerGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    drawerGestureRef.current = null;

    if (gesture.intent !== "horizontal") return;
    suppressDrawerClickRef.current = true;
    window.setTimeout(() => { suppressDrawerClickRef.current = false; }, 0);

    const drawer = drawerRef.current;
    if (drawer?.hasPointerCapture?.(event.pointerId)) drawer.releasePointerCapture(event.pointerId);
    drawer?.classList.remove("is-dragging");
    drawerBackdropRef.current?.classList.remove("is-dragging");

    const progress = gesture.width > 0 ? gesture.lastDistance / gesture.width : 0;
    const intentionalFlickDistance = Math.min(48, gesture.width * 0.12);
    const shouldClose = !cancelled && (
      progress >= 0.3 ||
      (gesture.lastDistance >= intentionalFlickDistance && gesture.velocity >= 0.5)
    );
    if (shouldClose) {
      closeDrawer();
      return;
    }

    // Read once on release so the browser commits the dragged position before
    // transitioning the two composited properties back to their open state.
    drawer?.getBoundingClientRect();
    resetDrawerGestureStyles();
  }

  function handleDrawerClickCapture(event) {
    if (!suppressDrawerClickRef.current) return;
    event.preventDefault();
    event.stopPropagation();
  }

  useEffect(() => {
    restoreDrawerFocusRef.current = false;
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
      if (event.key === "Escape") closeDrawer();
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
      const trigger = drawerTriggerRef.current;
      const shouldRestoreFocus = restoreDrawerFocusRef.current;
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      drawerGestureRef.current = null;
      resetDrawerGestureStyles();
      if (shouldRestoreFocus) window.setTimeout(() => trigger?.focus(), 0);
      restoreDrawerFocusRef.current = true;
    };
  }, [drawerOpen]);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return undefined;

    let frame = 0;
    const updateKeyboardState = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        // Browser controls can change the visual viewport by a few pixels.
        // A large layout-to-visual viewport delta, without page zoom, is the
        // reliable cross-browser signal for an on-screen keyboard.
        const layoutHeight = document.documentElement.clientHeight;
        const viewportDelta = layoutHeight - viewport.height - viewport.offsetTop;
        const scale = typeof viewport.scale === "number" ? viewport.scale : 1;
        const isPageZoomed = Math.abs(scale - 1) > 0.01;
        const activeElement = document.activeElement;
        const hasKeyboardTarget = activeElement instanceof HTMLElement && (
          activeElement.isContentEditable ||
          activeElement.matches("textarea, input:not([type]), input[type='text'], input[type='search'], input[type='email'], input[type='password'], input[type='tel'], input[type='url'], input[type='number']")
        );
        setKeyboardOpen(hasKeyboardTarget && !isPageZoomed && viewportDelta > 150);
      });
    };

    updateKeyboardState();
    viewport.addEventListener("resize", updateKeyboardState);
    window.addEventListener("resize", updateKeyboardState);
    document.addEventListener("focusin", updateKeyboardState);
    document.addEventListener("focusout", updateKeyboardState);
    return () => {
      window.cancelAnimationFrame(frame);
      viewport.removeEventListener("resize", updateKeyboardState);
      window.removeEventListener("resize", updateKeyboardState);
      document.removeEventListener("focusin", updateKeyboardState);
      document.removeEventListener("focusout", updateKeyboardState);
    };
  }, []);

  // Lock In Mode is a real immersive route, not an overlay. Keep the shared
  // shell mounted so authentication and route state remain intact, but do not
  // render any normal product navigation around the session.
  if (location.pathname === "/lock-in" || location.pathname.startsWith("/lock-in/") || location.pathname.endsWith("/workspace")) {
    return children;
  }

  // While a quiz is being answered the product chrome is a hazard: a mis-tap on
  // the bottom bar leaves the attempt. Both attempt screens carry their own
  // "Exit quiz", so the shell steps back and lets them own the viewport.
  const answeringQuiz = location.pathname.startsWith("/questions/attempts/")
    || location.pathname.startsWith("/questions/demo/");

  return (
      <div className={`app-shell ${keyboardOpen ? "keyboard-open" : ""} ${answeringQuiz ? "is-answering" : ""}`.trim()}>
        <Sidebar user={user} operationsSession={operationsSession} inert={drawerOpen} />
        <div className="content-frame" inert={drawerOpen ? "" : undefined} aria-hidden={drawerOpen || undefined}>
          <Topbar
            user={user}
            theme={theme}
            onThemeChange={onThemeChange}
            onLogout={onLogout}
            onMenu={openDrawer}
            menuOpen={drawerOpen}
            menuButtonRef={topbarMenuRef}
            onDropdownOpenChange={setDropdownActive}
            notificationVersion={notificationVersion}
            onNotificationsChanged={onNotificationsChanged}
            storeCartCount={storeCartCount}
            lockBalance={lockBalance}
          />
          <main className="page-shell" id="main-content" tabIndex={-1} aria-label="Lock-in page content">{children}</main>
        </div>
        <BottomNav onMore={openDrawer} menuOpen={drawerOpen} inert={drawerOpen} />
        <div className={`dropdown-backdrop ${dropdownActive ? "open" : ""}`} />
        <div className={`drawer-backdrop ${drawerOpen ? "open" : ""}`} ref={drawerBackdropRef} aria-hidden="true" onClick={() => closeDrawer()} />
        <aside
          className={`mobile-drawer ${drawerOpen ? "open" : ""}`}
          id="mobile-drawer"
          ref={drawerRef}
          aria-labelledby="mobile-drawer-title"
          aria-hidden={drawerOpen ? undefined : "true"}
          aria-modal={drawerOpen ? "true" : undefined}
          inert={drawerOpen ? undefined : ""}
          role="dialog"
          onPointerDown={handleDrawerPointerDown}
          onPointerMove={handleDrawerPointerMove}
          onPointerUp={finishDrawerGesture}
          onPointerCancel={(event) => finishDrawerGesture(event, true)}
          onClickCapture={handleDrawerClickCapture}
        >
          <h2 className="visually-hidden" id="mobile-drawer-title">{t("shell.mobileNavigation")}</h2>
          <div className="drawer-head">
            <Brand />
            <button className="icon-btn drawer-close" ref={drawerCloseRef} onClick={() => closeDrawer()} aria-label={t("shell.closeNavigation")} tabIndex={drawerTabIndex}>
              <Icon name="x" />
            </button>
          </div>
          <div className="drawer-scroll" ref={drawerScrollRef}>
            <DrawerProfile user={user} active={location.pathname.startsWith("/profile")} tabIndex={drawerTabIndex} onNavigate={() => closeDrawer({ restoreFocus: false })} />
            <MobileDrawerNavigation user={user} operationsSession={operationsSession} pathname={location.pathname} tabIndex={drawerTabIndex} onNavigate={() => closeDrawer({ restoreFocus: false })} onLogout={() => { closeDrawer({ restoreFocus: false }); onLogout(); }} />
            <DrawerThemeSelector activeTheme={theme} onThemeChange={onThemeChange} tabIndex={drawerTabIndex} />
          </div>
        </aside>
      </div>
  );
}
