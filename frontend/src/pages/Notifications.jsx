import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motivationApi } from "../api/motivation.js";
import { isApiError } from "../api/client.js";
import { isKnownNotificationRoute } from "../lib/notificationRoutes.js";
import { Icon } from "../lib/icons.jsx";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { EmptyState, ErrorPanel, LoadingPanel, Page } from "../components/ui/index.jsx";

function dateLabel(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Server notification" : date.toLocaleString();
}

async function loadNotifications(unreadOnly) {
  const [feed, summary] = await Promise.all([
    motivationApi.listNotifications({ unreadOnly }),
    motivationApi.notificationSummary()
  ]);
  return { feed, summary };
}

export default function Notifications({ onNotificationsChanged }) {
  const navigate = useNavigate();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const feed = useAsyncData(() => loadNotifications(unreadOnly), [unreadOnly]);
  const [notifications, setNotifications] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [actionError, setActionError] = useState("");

  useEffect(() => {
    if (!feed.data) return;
    setNotifications(feed.data.feed.results);
    setNextCursor(feed.data.feed.nextCursor);
  }, [feed.data]);

  if (feed.loading) return <LoadingPanel />;
  if (feed.error) return <ErrorPanel message={feed.error} onRetry={feed.reload} />;

  function refresh() {
    feed.reload();
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
      setActionError(error.message || "More notifications could not be loaded.");
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
      setActionError(error.message || "Notifications could not be marked read.");
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
          setActionError("This notification refers to a screen that is not available in the current frontend integration.");
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
        setActionError("This notification target is no longer available.");
        onNotificationsChanged?.();
        refresh();
      } else {
        setActionError(error.message || "This notification could not be opened.");
      }
    } finally {
      setBusyId("");
    }
  }

  return (
    <Page title="Notifications" subtitle="Server-delivered activity for your account. Open a notification to mark it read and follow its Django-provided destination.">
      <section className="panel dashboard-review-card">
        <div className="panel-title"><div><p className="eyebrow">Inbox</p><h2>{feed.data.summary.unread_count || 0} unread</h2></div><span><Icon name="bell" size={16} /></span></div>
        <div className="focus-timer-actions">
          <button className={`btn btn-soft ${!unreadOnly ? "active" : ""}`} type="button" aria-pressed={!unreadOnly} onClick={() => setUnreadOnly(false)}>All</button>
          <button className={`btn btn-soft ${unreadOnly ? "active" : ""}`} type="button" aria-pressed={unreadOnly} onClick={() => setUnreadOnly(true)}>Unread</button>
          <button className="btn btn-soft" type="button" onClick={() => { void markAllRead(); }} disabled={!feed.data.summary.unread_count || busyId === "all"}>{busyId === "all" ? "Marking…" : "Mark all read"}</button>
        </div>
        {actionError && <ErrorPanel message={actionError} onRetry={feed.reload} />}
        {!notifications.length ? <EmptyState title={unreadOnly ? "No unread notifications" : "No notifications yet"} text={unreadOnly ? "Django has no unread notifications for this account." : "New server notifications will appear here."} /> : (
          <div className="list-panel">
            {notifications.map((notification) => (
              <article className="list-row" key={notification.id}>
                <span className="stat-icon"><Icon name={notification.read_at ? "bell" : "sparkles"} /></span>
                <div><h2>{notification.title}</h2><p>{notification.body}</p><small className="muted">{notification.category} · {dateLabel(notification.created_at)}</small></div>
                <button className="btn btn-soft" type="button" disabled={busyId === notification.id} onClick={() => { void openNotification(notification); }}>{busyId === notification.id ? "Opening…" : notification.has_target ? "Open" : notification.read_at ? "Read" : "Mark read"}</button>
              </article>
            ))}
          </div>
        )}
        {nextCursor && <button className="btn btn-soft" type="button" disabled={loadingMore} onClick={() => { void loadMore(); }}>{loadingMore ? "Loading…" : "Load more"}</button>}
      </section>
    </Page>
  );
}
