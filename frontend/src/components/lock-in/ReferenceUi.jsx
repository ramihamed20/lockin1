import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { UserAvatar } from "../shared/UserAvatar.jsx";

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

export function ReferenceProgress({ value, className = "", indicatorClassName = "", label = "Progress" }) {
  const safeValue = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <div className={cn("li-h-2 li-w-full li-overflow-hidden li-rounded-full li-bg-[var(--lockin-progress-track,#2b3853)]", className)} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={safeValue}>
      <div className={cn("li-h-full li-rounded-full li-bg-[var(--lockin-progress-indicator,#58dbc4)] li-transition-[width] li-duration-300", indicatorClassName)} style={{ width: `${safeValue}%` }} />
    </div>
  );
}

export function ReferenceAvatar({ initials, avatar, userId, tone = "violet", className = "" }) {
  return (
    <span className={cn("lockin-reference-avatar", `lockin-reference-avatar--${tone}`, className)} aria-hidden="true">
      {avatar ? <UserAvatar avatar={avatar} user={{ id: userId }} alt="" /> : initials}
    </span>
  );
}
