import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Icon } from "../lib/icons.jsx";
import { useI18n } from "./I18nProvider.jsx";
import { acquireBodyScrollLock } from "../lib/bodyScrollLock.js";
import { usePresence } from "../lib/motion.js";
import { WHATS_NEW, readSeenRelease, whatsNewDecision, whatsNewText, writeSeenRelease } from "../lib/whatsNew.js";
import "./whats-new.css";

const TELEGRAM_URL = "https://t.me/lock_in_official";

export const OPEN_WHATS_NEW_EVENT = "lock-in:open-whats-new";

// Automated browsers skip the panel so it never covers unrelated end-to-end
// flows; a test that exercises the panel opts in with this storage key.
function automatedBrowserWithoutOptIn() {
  try {
    return Boolean(navigator.webdriver) && window.localStorage.getItem("lock-in.whats-new.e2e") !== "1";
  } catch {
    return Boolean(navigator.webdriver);
  }
}

/**
 * The release notes dialog. "after" is the panel shown once the new version is
 * running; "before" explains a waiting update and offers Update now / Later.
 */
export function ReleaseNotesDialog({ open, release = WHATS_NEW, mode = "after", onClose, onConfirm = undefined }) {
  const { t, locale } = useI18n();
  const ref = useRef(null);
  const presence = usePresence(open, 180);
  const titleId = `whats-new-title-${useId()}`;
  const before = mode === "before";

  useEffect(() => {
    if (!open) return undefined;
    const returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const releaseScrollLock = acquireBodyScrollLock();
    ref.current?.querySelector("[data-whats-new-done]")?.focus();

    function onKey(event) {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab") return;
      const focusable = Array.from(ref.current?.querySelectorAll("button:not(:disabled), [href]") || []);
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
    document.addEventListener("keydown", onKey);
    return () => {
      releaseScrollLock();
      document.removeEventListener("keydown", onKey);
      returnTo?.focus?.();
    };
  }, [open, onClose]);

  if (!presence.mounted) return null;

  return (
    <div className={`confirm-backdrop ${presence.closing ? "is-closing" : ""}`.trim()} inert={presence.closing ? "" : undefined} aria-hidden={presence.closing || undefined}>
      <button className="confirm-backdrop-dismiss" type="button" tabIndex={-1} aria-label={t("confirm.close")} onClick={onClose} />
      <div className="confirm-dialog whats-new" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref}>
        <header className="whats-new__head">
          <span className="whats-new__badge" aria-hidden="true"><Icon name="sparkles" size={22} /></span>
          <div>
            <h2 id={titleId} dir="auto">{before ? t("whatsNew.beforeTitle", { version: release.version }) : t("whatsNew.title")}</h2>
            <p dir="auto">{before ? t("whatsNew.beforeSubtitle") : t("whatsNew.subtitle")}</p>
          </div>
          <button className="whats-new__close" type="button" aria-label={t("confirm.close")} onClick={onClose}><Icon name="x" size={18} /></button>
        </header>
        <ul className="whats-new__list">
          {release.items.map((item) => (
            <li className="whats-new__item" key={item.icon + item.title.en}>
              <span className="whats-new__icon" aria-hidden="true"><Icon name={item.icon} size={18} /></span>
              <span className="whats-new__text">
                <strong dir="auto">{whatsNewText(item.title, locale)}</strong>
                <span dir="auto">{whatsNewText(item.body, locale)}</span>
              </span>
            </li>
          ))}
        </ul>
        {!before && (
          <p className="whats-new__follow">
            <span>{t("whatsNew.follow")}</span>
            <a href={TELEGRAM_URL} target="_blank" rel="noopener noreferrer" dir="ltr">@lock_in_official</a>
          </p>
        )}
        {before ? (
          <div className="whats-new__actions">
            <button className="btn btn-outline whats-new__done" type="button" onClick={onClose}>{t("pwa.update.later")}</button>
            <button className="btn btn-primary whats-new__done" type="button" data-whats-new-done onClick={onConfirm}>{t("pwa.update.now")}</button>
          </div>
        ) : (
          <button className="btn btn-primary whats-new__done" type="button" data-whats-new-done onClick={onClose}>{t("whatsNew.gotIt")}</button>
        )}
      </div>
    </div>
  );
}

/** Shows this version's notes once per account; Settings can reopen them. */
export function WhatsNew({ user, suppressed = false }) {
  const [open, setOpen] = useState(false);
  const userId = user?.id;
  const dateJoined = user?.dateJoined;

  useEffect(() => {
    if (!userId || suppressed || automatedBrowserWithoutOptIn()) return;
    const decision = whatsNewDecision({ seenId: readSeenRelease(userId), dateJoined });
    if (decision === "skip") writeSeenRelease(userId);
    if (decision === "show") setOpen(true);
  }, [userId, dateJoined, suppressed]);

  useEffect(() => {
    const reopen = () => setOpen(true);
    window.addEventListener(OPEN_WHATS_NEW_EVENT, reopen);
    return () => window.removeEventListener(OPEN_WHATS_NEW_EVENT, reopen);
  }, []);

  const close = useCallback(() => {
    if (userId) writeSeenRelease(userId);
    setOpen(false);
  }, [userId]);

  return <ReleaseNotesDialog open={open} onClose={close} />;
}
