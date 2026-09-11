import { useEffect } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { Icon } from "../lib/icons.jsx";
import { rememberLastOpenedCatalogSheet } from "../lib/materialCatalog.js";
import { useCatalogMaterials } from "../hooks/useCatalogMaterials.js";
import { EmptyState, ErrorPanel, Page } from "../components/ui/index.jsx";
import { CatalogSheetCard } from "../components/learning/CatalogSheetCard.jsx";
import { CatalogTile } from "../components/learning/CatalogTile.jsx";
import { useI18n } from "../components/I18nProvider.jsx";

export default function Materials({ user = null }) {
  const { t } = useI18n();
  const { materials } = useCatalogMaterials(user);

  return (
    <Page title="Materials">
      <section aria-labelledby="cohort-materials-heading">
        <div className="panel-title">
          <div>
            <p className="eyebrow">{t("materials.coreCatalogTitle")}</p>
            <h2 id="cohort-materials-heading">{t("materials.coreCatalogHeading")}</h2>
            <p className="muted">{t("materials.coreCatalogSubtitle")}</p>
          </div>
        </div>
        {materials.length === 0
          ? <EmptyState icon="study" title={t("materials.noCohortMaterialsTitle")} text={t("materials.noCohortMaterialsText")} />
          : (
            <section className="material-grid catalog-material-grid" aria-label={t("materials.catalogLabel")}>
              {materials.map((material) => <CatalogMaterialCard key={material.slug} material={material} />)}
            </section>
          )}
      </section>
    </Page>
  );
}

function CatalogMaterialCard({ material }) {
  const { t } = useI18n();
  return <CatalogTile title={material.title} meta={t("materials.sheetCount", { count: material.sheets.length })} icon="book-open" to={`/materials/catalog/${material.slug}`} />;
}

export function CatalogMaterialSheets({ user = null }) {
  const { materialSlug } = useParams();
  const { t } = useI18n();
  const { materials } = useCatalogMaterials(user);
  const material = materials.find((item) => item.slug === materialSlug) || null;

  if (!material) return <Page title={t("materials.notFoundTitle")}><ErrorPanel message={t("materials.notFoundText")} /></Page>;

  if (!material.sheets.length) {
    return <Page title={material.title}><EmptyState icon="study" title={t("materials.noSheetsTitle")} text={t("materials.noSheetsText")} /></Page>;
  }

  return (
    <Page title={material.title}>
      <section className="sheet-grid catalog-sheet-grid" aria-label={t("materials.sheetsOf", { name: material.title })}>
        {material.sheets.map((sheet) => (
          <CatalogSheetCard key={sheet.slug} material={material} sheet={sheet} to={`/materials/catalog/${material.slug}/sheets/${sheet.slug}`} />
        ))}
      </section>
    </Page>
  );
}

export function CatalogSheetStudy({ user = null }) {
  const { materialSlug, sheetSlug } = useParams();
  const location = useLocation();
  const { t } = useI18n();
  const { materials } = useCatalogMaterials(user);
  const material = materials.find((item) => item.slug === materialSlug) || null;
  const sheet = material?.sheets.find((item) => item.slug === sheetSlug) || null;

  useEffect(() => {
    rememberLastOpenedCatalogSheet(materialSlug, sheetSlug);
  }, [materialSlug, sheetSlug]);

  if (!material || !sheet) return <Page title={t("materials.sheetNotFoundTitle")}><ErrorPanel message={t("materials.sheetNotFoundText")} /></Page>;

  return (
    <Page title={sheet.title}>
      <section className="catalog-sheet-entry">
        <article className="panel catalog-sheet-actions">
          <div className="catalog-sheet-entry-heading">
            <span className="catalog-sheet-entry-icon"><Icon name="file" size={22} /></span>
            <div><h2>{sheet.title}</h2>{sheet.pageCount && <p id="catalog-sheet-file-status" dir="auto">{t("materials.pageCount", { count: sheet.pageCount })}</p>}</div>
          </div>
          <Link className="btn btn-primary catalog-sheet-focus-action" to={`/materials/catalog/${material.slug}/sheets/${sheet.slug}/workspace`} state={{ returnTo: location.pathname, scrollY: window.scrollY }}><Icon name="expand" size={17} /> {t("materials.openWorkspace")}</Link>
        </article>
        <article className="catalog-lockin-card" aria-label={t("materials.lockInSoonLabel")}>
          <span><Icon name="lock" size={18} /></span><div><strong>{t("materials.lockInMode")}</strong><small>{t("common.soon")}</small></div>
        </article>
        <Link className="btn btn-soft compact catalog-sheet-back" to={`/materials/catalog/${material.slug}`}><Icon name="arrow-left" size={16} /> {t("materials.backToSheets")}</Link>
      </section>
    </Page>
  );
}
