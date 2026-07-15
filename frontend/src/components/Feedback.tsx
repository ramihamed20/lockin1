import type { ReactNode } from "react";

export function Alert({ tone = "error", children }: { tone?: "error" | "success"; children: ReactNode }) {
  return (
    <div className={`alert alert--${tone}`} role={tone === "error" ? "alert" : "status"}>
      {children}
    </div>
  );
}

export function PageSkeleton({ label }: { label: string }) {
  return (
    <div className="page-skeleton" role="status" aria-label={label}>
      <span />
      <span />
      <span />
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty-state">
      <span className="empty-state__line" aria-hidden="true" />
      <h2>{title}</h2>
      {children ? <p>{children}</p> : null}
    </div>
  );
}
