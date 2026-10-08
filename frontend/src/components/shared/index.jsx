import { Icon } from "../../lib/icons.jsx";
import { assetPath } from "../../lib/utils.js";
export { ForbiddenState } from "./ForbiddenState.jsx";
export { PwaUpdatePrompt } from "./PwaUpdatePrompt.jsx";
export { ConnectionStatus } from "./ConnectionStatus.jsx";

export function FullScreenState({ message, actionLabel = "", onAction = null, startup = false }) {
  return (
    <main
      className={`screen-state startup-shell startup-shell--${startup ? "continuation" : "settled"}`}
      aria-busy={startup || undefined}
    >
      <span className="startup-emblem" aria-hidden="true">
        <span className="startup-halo" />
        <span className="startup-logo-frame">
          <img
            src={assetPath("/icons/lockin-light-192-v2.png")}
            alt=""
            width="96"
            height="96"
            className="startup-logo"
          />
        </span>
      </span>
      <p className="startup-message" role="status" aria-live="polite">{message}</p>
      {startup && <span className="startup-progress" aria-hidden="true"><span /></span>}
      {actionLabel && onAction && <button className="btn btn-soft" type="button" onClick={onAction}>{actionLabel}</button>}
    </main>
  );
}

export function ReminderToast({ message, onDismiss, title = "Study reminder", icon = "bell" }) {
  return (
    <div className="reminder-toast" role="status" aria-live="polite">
      <span className="stat-icon"><Icon name={icon} size={16} /></span>
      <div>
        <p className="eyebrow">{title}</p>
        <strong>{message}</strong>
      </div>
      <button className="icon-btn" onClick={onDismiss} aria-label="Dismiss reminder"><Icon name="x" size={17} /></button>
    </div>
  );
}
