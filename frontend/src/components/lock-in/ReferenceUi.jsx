import { cva } from "class-variance-authority";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

const buttonVariants = cva(
  "li-inline-flex li-items-center li-justify-center li-gap-2 li-rounded-xl li-border li-border-transparent li-font-lockin li-text-sm li-font-semibold li-transition li-duration-150 focus-visible:li-outline-none focus-visible:li-ring-2 focus-visible:li-ring-[var(--lockin-focus,#a88aff)] focus-visible:li-ring-offset-2 focus-visible:li-ring-offset-[var(--lockin-ring-offset,#0b1325)] disabled:li-pointer-events-none disabled:li-opacity-50",
  {
    variants: {
      variant: {
        ghost: "li-bg-[var(--lockin-control-bg,#151f34)] li-text-[var(--lockin-control-text,#d8deee)] hover:li-bg-[var(--lockin-control-hover,#202b45)]",
        quiet: "li-bg-transparent li-text-[var(--lockin-quiet-text,#c8d1e5)] hover:li-bg-[var(--lockin-control-bg,#151f34)]",
        violet: "li-bg-[var(--lockin-accent,#6449df)] li-text-[var(--lockin-on-accent,#fff)] hover:li-bg-[var(--lockin-accent-hover,#755de8)]",
        icon: "li-h-10 li-w-10 li-p-0 li-bg-[var(--lockin-control-bg,#151f34)] li-text-[var(--lockin-control-text,#d8deee)] hover:li-bg-[var(--lockin-control-hover,#202b45)]"
      },
      size: {
        default: "li-h-10 li-px-4",
        compact: "li-h-9 li-px-3",
        icon: "li-h-10 li-w-10 li-p-0"
      }
    },
    defaultVariants: {
      variant: "ghost",
      size: "default"
    }
  }
);

/** @param {import("react").ButtonHTMLAttributes<HTMLButtonElement> & {variant?: "ghost" | "quiet" | "violet" | "icon", size?: "default" | "compact" | "icon"}} props */
export function ReferenceButton({ className, variant, size, type = "button", ...props }) {
  return <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export function ReferenceProgress({ value, className = "", indicatorClassName = "", label = "Progress" }) {
  const safeValue = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <div className={cn("li-h-2 li-w-full li-overflow-hidden li-rounded-full li-bg-[var(--lockin-progress-track,#2b3853)]", className)} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={safeValue}>
      <div className={cn("li-h-full li-rounded-full li-bg-[var(--lockin-progress-indicator,#58dbc4)] li-transition-[width] li-duration-300", indicatorClassName)} style={{ width: `${safeValue}%` }} />
    </div>
  );
}

export function ReferenceAvatar({ initials, tone = "violet", className = "" }) {
  return <span className={cn("lockin-reference-avatar", `lockin-reference-avatar--${tone}`, className)} aria-hidden="true">{initials}</span>;
}
