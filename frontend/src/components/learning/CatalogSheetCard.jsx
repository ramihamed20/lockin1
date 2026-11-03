import { Link } from "react-router-dom";
import { Icon } from "../../lib/icons.jsx";
import { useI18n } from "../I18nProvider.jsx";
import { sheetCoverTone } from "../../lib/sheetPresentation.js";

/** Shared sheet affordance for Materials and Questions catalogue routes. */
export function CatalogSheetCard({ material, sheet, to, actionLabel = "", detail = "" }) {
  const { t } = useI18n();
  const title = sheet.title || `${material.title} Sheet ${sheet.number}`;
  const action = actionLabel || t("materials.openSheet");
  const editions = sheet.editions?.length ? sheet.editions : [sheet];
  const university = editions.find((item) => item.edition === "university") || editions[0];
  const lockin = editions.find((item) => item.edition === "lockin");
  const hasUniversity = university?.deliverable !== false;
  const hasLockin = Boolean(lockin && lockin.deliverable !== false);
  const availability = hasUniversity && hasLockin
    ? t("materials.editionsAvailable.both")
    : hasLockin
      ? t("materials.editionsAvailable.lockin")
      : hasUniversity
        ? t("materials.editionsAvailable.university")
        : t("materials.editionsAvailable.none");
  const meta = detail || availability;
  const unavailable = sheet.deliverable === false;
  const contents = <>
    <span className="sheet-library-cover" data-tone={sheetCoverTone(material)}>
      <span className="sheet-library-file" aria-hidden="true"><Icon name="file" size={25} /></span>
      {Number.isInteger(sheet.pageCount) && sheet.pageCount > 0 && <span className="sheet-library-pages">{t("materials.coverPages", { count: sheet.pageCount })}</span>}
    </span>
    <span className="sheet-library-body">
      <span className="sheet-library-subject" dir="auto">{material.title}</span>
      <strong className="sheet-library-title" dir="auto">{title}</strong>
      <span className="sheet-library-description" dir="auto">{unavailable ? t("materials.sheetNotFoundText") : (sheet.summary || availability)}</span>
      <span className="sheet-library-footer">
        <span className="sheet-library-detail"><Icon name="book-open" size={16} aria-hidden="true" /><span dir="auto">{detail || (sheet.summary ? meta : (sheet.number ? t("materials.coverSheet", { number: sheet.number }) : meta))}</span></span>
        <span className="sheet-library-open" aria-hidden="true"><Icon name={unavailable ? "lock" : "chevron-right"} size={19} /></span>
      </span>
    </span>
  </>;
  const className = `sheet-card catalog-sheet-card sheet-library-card${unavailable ? " is-unavailable" : ""}`;
  return unavailable
    ? <article className={className} data-unavailable="true">{contents}</article>
    : <Link className={className} to={to} aria-label={`${action}: ${title}`}>{contents}</Link>;
}
