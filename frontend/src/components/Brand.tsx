import { Link } from "react-router-dom";

import { useI18n } from "../i18n/I18nProvider";

export function Brand({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n();
  return (
    <Link className="brand" to="/" aria-label={t("brandHome")}>
      <svg className="brand__mark" viewBox="0 0 40 40" aria-hidden="true">
        <path d="M11 8v18c0 4 3 6 7 6h11" />
        <path d="M16 13h13v14H16" />
        <path d="m23 18 3 2-3 2" />
      </svg>
      {compact ? null : <span>Lock-in</span>}
    </Link>
  );
}
