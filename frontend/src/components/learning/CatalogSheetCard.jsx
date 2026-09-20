import { Link } from "react-router-dom";
import { Icon } from "../../lib/icons.jsx";
import { useI18n } from "../I18nProvider.jsx";

/** Shared sheet affordance for Materials and Questions catalogue routes. */
export function CatalogSheetCard({ material, sheet, to, actionLabel = "", detail = "" }) {
  const { t } = useI18n();
  const title = sheet.title || `${material.title} Sheet ${sheet.number}`;
  const action = actionLabel || t("materials.openSheet");
  const editions = sheet.editions?.length ? sheet.editions : [sheet];
  const university = editions.find((item) => item.edition === "university") || editions[0];
  const lockin = editions.find((item) => item.edition === "lockin");
  const hasSummary = editions.some((item) => Boolean(item.summaryPdf?.viewUrl));
  const hasActiveStudy = editions.some((item) => Boolean(item.hasActiveStudy));
  const capabilities = [
    { label: t("materials.universityPdf"), available: university?.deliverable !== false },
    { label: t("materials.lockinEdition"), available: Boolean(lockin && lockin.deliverable !== false) },
    { label: t("materials.sheetSummary"), available: hasSummary },
    { label: t("materials.activeStudy"), available: hasActiveStudy }
  ];
  const details = <>
    <small className="catalog-sheet-meta" dir="auto">{detail || (sheet.pageCount ? t("materials.pageCount", { count: sheet.pageCount }) : t("materials.studySheet"))}</small>
    <span className="catalog-sheet-capabilities" aria-label={t("materials.availabilityLabel")}>
      {capabilities.map((item) => <span key={item.label} className={item.available ? "is-available" : "is-unavailable"}><i aria-hidden="true" />{item.label}</span>)}
    </span>
  </>;
  if (sheet.deliverable === false) {
    return (
      <article className="sheet-card catalog-sheet-card is-unavailable" data-unavailable="true">
        <span className="catalog-sheet-icon"><Icon name="file" size={20} /></span>
        <span className="catalog-sheet-copy"><strong dir="auto">{title}</strong><small dir="auto">{t("materials.sheetNotFoundText")}</small></span>
        <span className="catalog-sheet-end" aria-hidden="true"><Icon name="lock" size={18} /></span>
      </article>
    );
  }
  return (
    <Link className="sheet-card catalog-sheet-card" to={to} aria-label={`${action}: ${title}`}>
      <span className="catalog-sheet-icon"><Icon name="file" size={20} /></span>
      <span className="catalog-sheet-copy"><strong dir="auto">{title}</strong>{details}</span>
      <span className="catalog-sheet-end" aria-hidden="true"><Icon name="chevron-right" size={18} /></span>
    </Link>
  );
}
