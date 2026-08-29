import { Link } from "react-router-dom";
import { Icon } from "../../lib/icons.jsx";
import { useI18n } from "../I18nProvider.jsx";

/** Shared Lock In tile language for study content and upcoming study features. */
export function CatalogTile({ title, meta, icon, to = "", kind = "material", status = "" }) {
  const { t } = useI18n();
  const content = <>
    <span className="catalog-tile__icon"><Icon name={icon} size={20} /></span>
    <span className="catalog-tile__copy"><strong dir="auto">{title}</strong><small dir="auto">{meta}</small></span>
    <span className={`catalog-tile__end ${status ? "is-status" : ""}`} aria-hidden="true">
      {status ? <><Icon name="lock" size={13} /><span>{status}</span></> : <Icon name="chevron-right" size={18} />}
    </span>
  </>;

  return (
    <article className={`catalog-tile catalog-tile--${kind} ${to ? "is-actionable" : "is-pending"}`}>
      {to
        ? <Link className="catalog-tile__surface" to={to} aria-label={t("materials.openNamed", { name: title })}>{content}</Link>
        : <div className="catalog-tile__surface" aria-disabled="true" aria-label={`${title}. ${meta}. ${status}`}>{content}</div>}
    </article>
  );
}
