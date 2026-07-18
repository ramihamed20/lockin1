import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { ApiError } from "../../api/client";
import { Button } from "../../components/Button";
import { Alert, EmptyState, PageSkeleton } from "../../components/Feedback";
import { useI18n } from "../../i18n/I18nProvider";
import { notificationApi } from "./api";
import type { NotificationItem, NotificationPreference } from "./types";

const categoryKeys = {
  account: "category_account",
  learning: "category_learning",
  achievement: "category_achievement",
  community: "category_community",
  moderation: "category_moderation",
  platform: "category_platform"
} as const;

export function NotificationsPage() {
  const { locale, t } = useI18n();
  const navigate = useNavigate();
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [preferences, setPreferences] = useState<NotificationPreference[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [targetUnavailable, setTargetUnavailable] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    const controller = new AbortController();
    void Promise.all([
      notificationApi.list(controller.signal),
      notificationApi.preferences(controller.signal)
    ])
      .then(([page, loadedPreferences]) => {
        if (!controller.signal.aborted) {
          setItems(page.results);
          setPreferences(loadedPreferences);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => load(), [load]);

  if ((!items || !preferences) && !failed) {
    return <PageSkeleton label={t("loadingNotifications")} />;
  }
  if (!items || !preferences) {
    return (
      <Alert>
        {t("genericError")} <Button onClick={() => { setFailed(false); load(); }}>{t("retry")}</Button>
      </Alert>
    );
  }

  const unread = items.filter((item) => item.read_at === null).length;
  const markAll = async () => {
    await notificationApi.markAllRead();
    const readAt = new Date().toISOString();
    setItems((current) => current?.map((item) => ({ ...item, read_at: item.read_at ?? readAt })) ?? current);
  };
  const markOne = async (item: NotificationItem) => {
    await notificationApi.markRead(item.id);
    setItems((current) =>
      current?.map((candidate) =>
        candidate.id === item.id ? { ...candidate, read_at: new Date().toISOString() } : candidate
      ) ?? current
    );
  };
  const open = async (item: NotificationItem) => {
    setTargetUnavailable(false);
    try {
      const { route } = await notificationApi.open(item.id);
      void navigate(route);
    } catch (error) {
      if (error instanceof ApiError && error.status === 410) setTargetUnavailable(true);
      else setFailed(true);
    }
  };
  const savePreferences = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const updated = await notificationApi.savePreferences(preferences.filter((item) => item.available));
      setPreferences(updated);
      setSaved(true);
    } finally {
      setSaving(false);
    }
  };
  const date = (value: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
      new Date(value)
    );

  return (
    <div className="page notifications-page">
      <header className="page-heading page-heading--wide notifications-heading">
        <div>
          <h1>{t("notificationsTitle")}</h1>
          <p>{t("notificationsCopy")}</p>
        </div>
        <div>
          <span aria-live="polite">{unread} {t("unreadNotifications")}</span>
          <Button variant="secondary" onClick={() => void markAll()} disabled={unread === 0}>
            {t("markAllRead")}
          </Button>
        </div>
      </header>
      {targetUnavailable ? <Alert>{t("notificationUnavailable")}</Alert> : null}
      {failed ? <Alert>{t("genericError")}</Alert> : null}

      {items.length ? (
        <ol className="notification-list">
          {items.map((item) => (
            <li key={item.id} className={item.read_at ? "is-read" : "is-unread"}>
              <span className="notification-signal" aria-hidden="true" />
              <div>
                <span className="notification-meta">
                  {t(categoryKeys[item.category as keyof typeof categoryKeys] ?? "category_platform")}
                  <time dateTime={item.created_at}>{date(item.created_at)}</time>
                </span>
                <h2>{item.title}</h2>
                <p>{item.body}</p>
                {item.actor_name ? <small>{item.actor_name}</small> : null}
              </div>
              <div className="notification-actions">
                {item.has_target ? (
                  <Button variant="secondary" onClick={() => void open(item)}>{t("openNotification")}</Button>
                ) : null}
                {!item.read_at ? (
                  <Button variant="quiet" onClick={() => void markOne(item)}>{t("markRead")}</Button>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <EmptyState title={t("noNotifications")}>{t("noNotificationsCopy")}</EmptyState>
      )}

      <section className="notification-preferences" aria-labelledby="preferences-heading">
        <header>
          <h2 id="preferences-heading">{t("notificationPreferences")}</h2>
          <p>{t("notificationPreferencesCopy")}</p>
        </header>
        <div className="preference-list">
          {preferences.filter((preference) => preference.channel === "in_app").map((preference) => (
            <label key={`${preference.category}-${preference.channel}`}>
              <span>
                <strong>{t(categoryKeys[preference.category as keyof typeof categoryKeys] ?? "category_platform")}</strong>
                <small>{preference.required ? t("required") : t("inAppChannel")}</small>
              </span>
              <input
                type="checkbox"
                checked={preference.enabled}
                disabled={preference.required}
                onChange={(event) =>
                  setPreferences((current) =>
                    current?.map((candidate) =>
                      candidate.category === preference.category && candidate.channel === preference.channel
                        ? { ...candidate, enabled: event.target.checked }
                        : candidate
                    ) ?? current
                  )
                }
              />
            </label>
          ))}
        </div>
        <p className="future-channel-note">{t("futureChannels")}</p>
        <div className="form-actions">
          <Button onClick={() => void savePreferences()} disabled={saving}>
            {saving ? t("saving") : t("savePreferences")}
          </Button>
          {saved ? <span className="inline-success" role="status">{t("preferencesSaved")}</span> : null}
        </div>
      </section>
    </div>
  );
}
