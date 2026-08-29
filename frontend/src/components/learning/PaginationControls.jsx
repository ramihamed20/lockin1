import { Icon } from "../../lib/icons.jsx";
import { useI18n } from "../I18nProvider.jsx";

/** Follows the published `previous` and `next` page links, never an inferred total. */
export function PaginationControls({ page, pageData, onPageChange, label }) {
  const { t } = useI18n();
  if (!pageData?.previous && !pageData?.next) return null;
  return (
    <nav className="focus-timer-actions" aria-label={label || t("common.pagination")}>
      <button className="btn btn-soft" type="button" disabled={!pageData.previous} onClick={() => onPageChange(page - 1)}>
        <Icon name="chevron-left" size={16} /> {t("common.previous")}
      </button>
      <span className="pill" dir="auto">{t("common.pageNumber", { page })}</span>
      <button className="btn btn-soft" type="button" disabled={!pageData.next} onClick={() => onPageChange(page + 1)}>
        {t("common.next")} <Icon name="chevron-right" size={16} />
      </button>
    </nav>
  );
}

