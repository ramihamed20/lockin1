import { Icon } from "../../lib/icons.jsx";
import { SessionConfetti } from "../ui/index.jsx";
import { assetPath } from "../../lib/utils.js";
export { ForbiddenState } from "./ForbiddenState.jsx";

export function FullScreenState({ message, actionLabel, onAction }) {
  return (
    <main className="screen-state">
      <span className="brand-mark">
        <img src={assetPath("/assets/lock-in-logo.jpg")} alt="Lock-in Logo" className="brand-logo-img" />
      </span>
      <p>{message}</p>
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

export function LevelUpToast({ level, title, onDismiss }) {
  return (
    <div className="level-up-toast" role="status" aria-live="polite">
      <SessionConfetti />
      <div className="level-badge compact">
        <span>LVL</span>
        <strong>{level}</strong>
      </div>
      <div>
        <p className="eyebrow">Level up</p>
        <h2>{title}</h2>
        <p>Your XP crossed into a new Lock-in level.</p>
      </div>
      <button className="icon-btn" onClick={onDismiss} aria-label="Dismiss level up notification"><Icon name="x" size={17} /></button>
    </div>
  );
}
