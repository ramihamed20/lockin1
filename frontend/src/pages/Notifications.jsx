import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motivationApi } from "../api/motivation.js";
import { isApiError } from "../api/client.js";
import { isKnownNotificationRoute, notificationFallbackRoute } from "../lib/notificationRoutes.js";
import { notificationPresentation } from "../lib/notificationPresentation.js";
import { Icon } from "../lib/icons.jsx";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { EmptyState, ErrorPanel, LoadingPanel, Page, Tab, TabList } from "../components/ui/index.jsx";
import { formatDate, formatDateTime, formatNumber } from "../lib/i18n.js";
import { useMediaQuery } from "../hooks/useMediaQuery.js";
import { useI18n } from "../components/I18nProvider.jsx";
import "./notifications-inbox.css";

export default function Notifications({ user = null, onNotificationsChanged }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const feed = useAsyncData(() => motivationApi.listNotifications({ unreadOnly }), [user?.id, unreadOnly], { cacheKey: `notifications:${user?.id}:${unreadOnly}` });
  const summary = useAsyncData(() => motivationApi.notificationSummary(), [user?.id], { cacheKey: `notification-summary:${user?.id}` });
  const [notifications, setNotifications] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [actionError, setActionError] = useState("");
  const [visibleCount, setVisibleCount] = useState(5);
  const compactFeed = useMediaQuery("(max-width: 639px)");

  useEffect(() => {
    if (!feed.data) return;
    setNotifications(feed.data.results);
    setNextCursor(feed.data.nextCursor);
    setVisibleCount(5);
  }, [feed.data]);

  // Loading and failure keep the page's title and column, so nothing moves
  // when the feed arrives.
  if (feed.loading) return <Page width="reading" title="Notifications"><LoadingPanel variant="notifications" /></Page>;
  if (feed.error) return <Page width="reading" title="Notifications"><ErrorPanel message={feed.errorDetails || feed.error} onRetry={feed.reload} /></Page>;

  function refresh() {
    feed.reload();
    summary.reload();
  }

  const visibleNotifications = compactFeed ? notifications.slice(0, visibleCount) : notifications;
  const notificationsByDay = new Map();
  for (const notification of visibleNotifications) {
    const date = formatDate(notification.created_at, { dateStyle: "full" });
    const label = date === "—" ? t("notifications.dateFallback") : date;
    if (!notificationsByDay.has(label)) notificationsByDay.set(label, []);
    notificationsByDay.get(label).push(notification);
  }

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setActionError("");
    try {
      const next = await motivationApi.listNotifications({ cursor: nextCursor, unreadOnly });
      setNotifications((current) => [...current, ...next.results.filter((item) => !current.some((existing) => existing.id === item.id))]);
      setNextCursor(next.nextCursor);
    } catch (error) {
      setActionError(error.message || t("notifications.loadMoreError"));
    } finally {
      setLoadingMore(false);
    }
  }

  async function markAllRead() {
    setBusyId("all");
    setActionError("");
    try {
      await motivationApi.markAllNotificationsRead();
      onNotificationsChanged?.();
      refresh();
    } catch (error) {
      setActionError(error.message || t("notifications.markAllError"));
    } finally {
      setBusyId("");
    }
  }

  async function openNotification(notification) {
    setBusyId(notification.id);
    setActionError("");
    try {
      if (notification.has_target) {
        const result = await motivationApi.openNotification(notification.id);
        onNotificationsChanged?.();
        refresh();
        if (!isKnownNotificationRoute(result.route)) {
          setActionError(t("notifications.unknownRoute"));
          return;
        }
        navigate(result.route);
      } else {
        await motivationApi.markNotificationRead(notification.id);
        onNotificationsChanged?.();
        refresh();
        navigate(notificationFallbackRoute(notification));
      }
    } catch (error) {
      if (isApiError(error) && error.status === 410) {
        setActionError(t("notifications.targetGone"));
        onNotificationsChanged?.();
        refresh();
      } else {
        setActionError(error.message || t("notifications.openError"));
      }
    } finally {
      setBusyId("");
    }
  }

  return (
    <Page width="reading" title="Notifications">
      {summary.error && <ErrorPanel message={summary.errorDetails || summary.error} onRetry={summary.reload} />}
      <section className="notifications-inbox-card notifications-v2 notifications-inbox-refined">
        <div className="notifications-v2-bar">
          <TabList className="notification-filter-actions ui-segmented" label={t("notifications.filterLabel")} variant="thumb" value={unreadOnly ? "unread" : "all"} onChange={(next) => setUnreadOnly(next === "unread")}>
            <Tab value="all">{t("notifications.all")}</Tab>
            <Tab value="unread">{summary.data?.unread_count ? t("notifications.unreadCount", { count: formatNumber(summary.data.unread_count) }) : t("notifications.unread")}</Tab>
          </TabList>
          <div className="notifications-toolbar-actions">
            {summary.data?.unread_count > 0 && (
              <button className="notifications-v2-mark" type="button" onClick={() => { void markAllRead(); }} disabled={Boolean(busyId)}>
                <Icon name="check" size={16} />
                {busyId === "all" ? t("notifications.marking") : t("common.markAllRead")}
              </button>
            )}
            <Link className="notifications-settings-link" to="/settings?section=notifications" aria-label={t("notifications.manage")}>
              <Icon name="settings" size={16} />
            </Link>
          </div>
        </div>
        {actionError && <ErrorPanel message={actionError} onRetry={feed.reload} />}
        {!notifications.length ? <EmptyState title={t(unreadOnly ? "notifications.noUnreadTitle" : "notifications.emptyTitle")} text={t(unreadOnly ? "notifications.noUnreadText" : "notifications.emptyText")} /> : (
          <div className="notification-feed">
            {[...notificationsByDay].map(([day, items]) => (
              <section className="notification-day" key={day}>
                <h2>{day}</h2>
                <ul>
                  {items.map((notification) => {
                    const presentation = notificationPresentation(notification.category);
                    const isRead = Boolean(notification.read_at);
                    const canActivate = !isRead || notification.has_target;
                    const Row = canActivate ? "button" : "div";
                    return (
                      <li key={notification.id}>
                        <Row
                          className={`notification-row notification-tone-${presentation.tone}`}
                          {...(canActivate ? {
                            type: "button",
                            disabled: Boolean(busyId),
                            "aria-busy": busyId === notification.id,
                            onClick: () => { void openNotification(notification); }
                          } : {})}
                        >
                          <span className="notification-category-icon" aria-hidden="true"><Icon name={presentation.icon} size={16} /></span>
                          <span className="notification-row-copy">
                            <span className="visually-hidden">
                              {t(presentation.labelKey)}{!isRead && ` · ${t("notifications.new")}`}
                            </span>
                            <strong dir="auto">{notification.title}</strong>
                            {notification.body && <span className="notification-row-body" dir="auto">{notification.body}</span>}
                            <time dateTime={notification.created_at}>{formatDateTime(notification.created_at, { dateStyle: undefined, timeStyle: "short" })}</time>
                          </span>
                          {!isRead && <span className="notification-unread-dot" aria-hidden="true" />}
                        </Row>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
        {compactFeed && visibleCount < notifications.length && <button className="btn btn-soft compact notification-load-more" type="button" onClick={() => setVisibleCount((current) => current + 5)}>{t("notifications.showMore")}</button>}
        {nextCursor && <button className="btn btn-soft compact notification-load-more" type="button" disabled={loadingMore} onClick={() => { void loadMore(); }}>{loadingMore ? t("notifications.loadingMore") : t("notifications.loadMore")}</button>}
      </section>
    </Page>
  );
}
