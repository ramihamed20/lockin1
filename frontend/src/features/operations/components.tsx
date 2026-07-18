import type { ReactNode } from "react";

import { EmptyState } from "../../components/Feedback";
import { useI18n } from "../../i18n/I18nProvider";

export function MetricStrip({ children }: { children: ReactNode }) {
  return <div className="operations-metric-strip">{children}</div>;
}

export function Metric({ label, value, detail }: { label: string; value: number | string; detail?: string }) {
  return <div><span>{label}</span><strong>{value}</strong>{detail ? <small>{detail}</small> : null}</div>;
}

export function StatusList({ values }: { values: Record<string, number> }) {
  const { t } = useI18n();
  const entries = Object.entries(values);
  if (!entries.length) return <EmptyState title={t("noOperationalData")} />;
  return (
    <dl className="operations-status-list">
      {entries.map(([label, value]) => (
        <div key={label}><dt>{label.replaceAll("_", " ")}</dt><dd>{value}</dd></div>
      ))}
    </dl>
  );
}

export function OperationsSection({ title, copy, children, id }: { title: string; copy?: string; children: ReactNode; id: string }) {
  return (
    <section className="operations-section" aria-labelledby={id}>
      <header><div><h2 id={id}>{title}</h2>{copy ? <p>{copy}</p> : null}</div></header>
      {children}
    </section>
  );
}
