import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
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

async function loadNotifications(unreadOnly) {
  const [feed, summary] = await Promise.all([
    motivationApi.listNotifications({ unreadOnly }),
    motivationApi.notificationSummary()
  ]);
  return { feed, summary };
}

export default function Notifications({ onNotificationsChanged }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const feed = useAsyncData(() => loadNotifications(unreadOnly), [unreadOnly]);
  const [notifications, setNotifications] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [actionError, setActionError] = useState("");
  const [visibleCount, setVisibleCount] = useState(5);
  const compactFeed = useMediaQuery("(max-width: 639px)");

  useEffect(() => {
    if (!feed.data) return;
    setNotifications(feed.data.feed.results);
    setNextCursor(feed.data.feed.nextCursor);
    setVisibleCount(5);
  }, [feed.data]);

  if (feed.loading) return <LoadingPanel />;
  if (feed.error) return <ErrorPanel message={feed.error} onRetry={feed.reload} />;

  function refresh() {
    feed.reload();
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
    <Page title="Notifications" subtitle={t("notifications.subtitle")}>
      <section className="panel notifications-inbox-card">
        <header className="notifications-inbox-header">
          <div className="notifications-inbox-title">
            <span className="notifications-inbox-icon"><Icon name="bell" size={19} /></span>
            <div><p className="eyebrow">{t("common.inbox")}</p><h2>{t("notifications.activityForYou")}</h2><p>{t("notifications.inboxHint")}</p></div>
          </div>
          <div className="notifications-inbox-actions">
            <span className={`notifications-unread-summary ${feed.data.summary.unread_count ? "has-unread" : ""}`} dir="auto"><i />{t("notifications.unreadCount", { count: feed.data.summary.unread_count || 0 })}</span>
            {feed.data.summary.unread_count > 0 && <button className="btn btn-soft compact" type="button" onClick={() => { void markAllRead(); }} disabled={busyId === "all"}>{busyId === "all" ? t("notifications.marking") : t("common.markAllRead")}</button>}
          </div>
        </header>
        {/* A filter is one-of-N, not two independent toggles: `aria-pressed`
            made both buttons announce as pressed toggles and let both carry a
            selected look at once. */}
        <TabList className="notification-filter-actions" label={t("notifications.filterLabel")} variant="tint" value={unreadOnly ? "unread" : "all"} onChange={(next) => setUnreadOnly(next === "unread")}>
          <Tab className="btn btn-soft" value="all">{t("notifications.all")}</Tab>
          <Tab className="btn btn-soft" value="unread">{t("notifications.unread")}</Tab>
        </TabList>
        {actionError && <ErrorPanel message={actionError} onRetry={feed.reload} />}
        {!notifications.length ? <EmptyState title={t(unreadOnly ? "notifications.noUnreadTitle" : "notifications.emptyTitle")} text={t(unreadOnly ? "notifications.noUnreadText" : "notifications.emptyText")} /> : (
          <div className="notification-feed">
            {visibleNotifications.map((notification) => {
              const presentation = notificationPresentation(notification.category);
              const isRead = Boolean(notification.read_at);
              const isBusy = busyId === notification.id;
              const canMarkRead = !isRead || notification.has_target;
              return <article className={`notification-feed-item notification-tone-${presentation.tone} ${isRead ? "is-read" : "is-unread"}`} key={notification.id}>
                <span className="notification-category-icon" aria-label={t("notifications.categoryLabel", { name: t(presentation.labelKey) })}><Icon name={presentation.icon} size={19} /></span>
                <div className="notification-feed-content">
                  <div className="notification-feed-meta"><span>{t(presentation.labelKey)}</span>{!isRead && <b>{t("notifications.new")}</b>}<time dateTime={notification.created_at} dir="auto">{dateLabel(notification.created_at, t)}</time></div>
                  <h2 dir="auto">{notification.title}</h2>
                  <p dir="auto">{notification.body}</p>
                </div>
                <button className="btn btn-soft compact" type="button" disabled={isBusy || !canMarkRead} onClick={() => { void openNotification(notification); }}>{isBusy ? t("common.opening") : notification.has_target ? t("common.open") : isRead ? t("notifications.read") : t("notifications.markRead")}</button>
              </article>;
            })}
          </div>
        )}
        {compactFeed && visibleCount < notifications.length && <button className="btn btn-soft compact notification-load-more" type="button" onClick={() => setVisibleCount((current) => current + 5)}>{t("notifications.showMore")}</button>}
        {nextCursor && <button className="btn btn-soft compact notification-load-more" type="button" disabled={loadingMore} onClick={() => { void loadMore(); }}>{loadingMore ? t("notifications.loadingMore") : t("notifications.loadMore")}</button>}
      </section>
    </Page>
  );
}
