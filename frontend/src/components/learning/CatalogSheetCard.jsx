import { Link } from "react-router-dom";
import { Icon } from "../../lib/icons.jsx";
import { useI18n } from "../I18nProvider.jsx";

/** Shared sheet affordance for Materials and Questions catalogue routes. */
export function CatalogSheetCard({ material, sheet, to, actionLabel = "", detail = "" }) {
  const { t } = useI18n();
  const title = sheet.title || `${material.title} Sheet ${sheet.number}`;
  const action = actionLabel || t("materials.openSheet");
  return (
    <Link className="sheet-card catalog-sheet-card" to={to} aria-label={`${action}: ${title}`}>
      <span className="catalog-sheet-icon"><Icon name="file" size={20} /></span>
      <span className="catalog-sheet-copy"><strong dir="auto">{title}</strong><small dir="auto">{detail || (sheet.pageCount ? t("materials.pageCount", { count: sheet.pageCount }) : t("materials.studySheet"))}</small></span>
      <span className="catalog-sheet-end" aria-hidden="true"><Icon name="chevron-right" size={18} /></span>
    </Link>
  );
}
