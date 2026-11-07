import { Fragment, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motivationApi } from "../api/motivation.js";
import { isApiError } from "../api/client.js";
import { isKnownNotificationRoute } from "../lib/notificationRoutes.js";
import { notificationPresentation } from "../lib/notificationPresentation.js";
import { Icon } from "../lib/icons.jsx";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { EmptyState, ErrorPanel, LoadingPanel, Page, Tab, TabList } from "../components/ui/index.jsx";
import { formatDateTime } from "../lib/i18n.js";
import { useMediaQuery } from "../hooks/useMediaQuery.js";
import { useI18n } from "../components/I18nProvider.jsx";

function dateLabel(value, t) {
  const formatted = formatDateTime(value);
  return formatted === "—" ? t("notifications.dateFallback") : formatted;
}

export default function Notifications({ user = null, onNotificationsChanged }) {
  const { t, locale } = useI18n();
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

  // Background refresh without sockets, even after returning from another app.
  // useAsyncData.reload keeps the current cards visible during the request.
  useEffect(() => {
    const reloadOnResume = () => {
      if (document.visibilityState !== "visible") return;
      feed.reload();
      summary.reload();
    };
    const interval = window.setInterval(reloadOnResume, 60_000);
    document.addEventListener("visibilitychange", reloadOnResume);
    window.addEventListener("online", reloadOnResume);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", reloadOnResume);
      window.removeEventListener("online", reloadOnResume);
    };
  }, [feed.reload, summary.reload, user?.id]);

  const dateFormatter = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long" });

  // Loading and failure keep the page's title and column, so nothing moves
  // when the feed arrives.
  if (feed.loading) return <Page width="reading" title="Notifications"><LoadingPanel variant="list" /></Page>;
  if (feed.error) return <Page width="reading" title="Notifications"><ErrorPanel message={feed.errorDetails || feed.error} onRetry={feed.reload} /></Page>;

  function refresh() {
    feed.reload();
    summary.reload();
  }

  const visibleNotifications = compactFeed ? notifications.slice(0, visibleCount) : notifications;

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
        // An announcement without a destination is simply marked as read.
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
      <p><Link className="btn btn-soft compact" to="/settings?section=notifications">{t("notifications.manage")}</Link></p>
      {/* The page title already says what this is: the list starts with its
          filter and the one bulk action, then the notifications themselves as
          one grouped list. */}
      {summary.error && <ErrorPanel message={summary.errorDetails || summary.error} onRetry={summary.reload} />}
      <section className="notifications-inbox-card notifications-v2">
        <div className="notifications-v2-bar">
          {/* A filter is one-of-N, not two independent toggles: `aria-pressed`
              made both buttons announce as pressed toggles and let both carry a
              selected look at once. */}
          <TabList className="notification-filter-actions ui-segmented" label={t("notifications.filterLabel")} variant="thumb" value={unreadOnly ? "unread" : "all"} onChange={(next) => setUnreadOnly(next === "unread")}>
            <Tab value="all">{t("notifications.all")}</Tab>
            <Tab value="unread">{summary.data?.unread_count ? t("notifications.unreadCount", { count: summary.data?.unread_count }) : t("notifications.unread")}</Tab>
          </TabList>
          <div className="notifications-v2-actions">
            <button className="notifications-v2-refresh" type="button" onClick={refresh} disabled={feed.refreshing || summary.refreshing} aria-label={t("notifications.refresh")}>
              <Icon name="refresh-cw" size={16} aria-hidden="true" /><span>{t("notifications.refresh")}</span>
            </button>
            {summary.data?.unread_count > 0 && <button className="notifications-v2-mark" type="button" onClick={() => { void markAllRead(); }} disabled={busyId === "all"}>{busyId === "all" ? t("notifications.marking") : t("common.markAllRead")}</button>}
          </div>
        </div>
        {actionError && <ErrorPanel message={actionError} onRetry={feed.reload} />}
        {!notifications.length ? <EmptyState title={t(unreadOnly ? "notifications.noUnreadTitle" : "notifications.emptyTitle")} text={t(unreadOnly ? "notifications.noUnreadText" : "notifications.emptyText")} /> : (
          <div className="notification-feed">
            {visibleNotifications.map((notification, index) => {
              const presentation = notificationPresentation(notification.category);
              const currentDate = new Date(notification.created_at);
              const currentDay = Number.isNaN(currentDate.getTime()) ? "unknown" : currentDate.toDateString();
              const previousDate = index ? new Date(visibleNotifications[index - 1].created_at) : null;
              const previousDay = previousDate && !Number.isNaN(previousDate.getTime()) ? previousDate.toDateString() : "unknown";
              const showDay = index === 0 || currentDay !== previousDay;
              const isRead = Boolean(notification.read_at);
              const isBusy = busyId === notification.id;
              const canMarkRead = !isRead || notification.has_target;
              return <Fragment key={notification.id}>
                {showDay && <h2 className="notification-date-group">{currentDay === "unknown" ? t("notifications.dateFallback") : dateFormatter.format(currentDate)}</h2>}
                <article className={`notification-feed-item notification-tone-${presentation.tone} ${isRead ? "is-read" : "is-unread"}`}>
                <span className="notification-category-icon" aria-label={t("notifications.categoryLabel", { name: t(presentation.labelKey) })}><Icon name={presentation.icon} size={19} /></span>
                <div className="notification-feed-content">
                  <div className="notification-feed-meta"><span>{t(presentation.labelKey)}</span>{!isRead && <b>{t("notifications.new")}</b>}<time dateTime={notification.created_at} dir="auto">{dateLabel(notification.created_at, t)}</time></div>
                  <h2 dir="auto">{notification.title}</h2>
                  <p dir="auto">{notification.body}</p>
                </div>
                <button className="btn btn-soft compact" type="button" disabled={isBusy || !canMarkRead} onClick={() => { void openNotification(notification); }}>{isBusy ? t("common.opening") : notification.has_target ? t("common.open") : isRead ? t("notifications.read") : t("notifications.markRead")}</button>
                </article>
              </Fragment>;
            })}
          </div>
        )}
        {compactFeed && visibleCount < notifications.length && <button className="btn btn-soft compact notification-load-more" type="button" onClick={() => setVisibleCount((current) => current + 5)}>{t("notifications.showMore")}</button>}
        {nextCursor && <button className="btn btn-soft compact notification-load-more" type="button" disabled={loadingMore} onClick={() => { void loadMore(); }}>{loadingMore ? t("notifications.loadingMore") : t("notifications.loadMore")}</button>}
      </section>
    </Page>
  );
}
