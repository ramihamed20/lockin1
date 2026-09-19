import { useEffect } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { Icon } from "../lib/icons.jsx";
import { rememberLastOpenedCatalogSheet, resolveSheetEdition } from "../lib/materialCatalog.js";
import { useCatalogMaterials } from "../hooks/useCatalogMaterials.js";
import { EmptyState, ErrorPanel, LoadingPanel, Page } from "../components/ui/index.jsx";
import { CatalogSheetCard } from "../components/learning/CatalogSheetCard.jsx";
import { CatalogTile } from "../components/learning/CatalogTile.jsx";
import { useI18n } from "../components/I18nProvider.jsx";

export default function Materials({ user = null }) {
  const { t } = useI18n();
  const { materials, loading, error, reload } = useCatalogMaterials(user);

  // A directory that has not arrived is not a directory that is empty. Telling a
  // student "you have no subjects" while the request is still in flight -- or
  // because it failed -- is how a transient error reads as lost content.
  if (loading) return <Page title="Materials"><LoadingPanel variant="material-list" /></Page>;
  if (error) return <Page title="Materials"><ErrorPanel message={error} onRetry={reload} /></Page>;

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
  const { materials, loading, error, reload } = useCatalogMaterials(user);
  const material = materials.find((item) => item.slug === materialSlug) || null;

  if (loading) return <Page title={t("materials.coreCatalogTitle")}><LoadingPanel variant="card-list" /></Page>;
  if (error) return <Page title={t("materials.notFoundTitle")}><ErrorPanel message={error} onRetry={reload} /></Page>;
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
  const { materials, loading, error, reload } = useCatalogMaterials(user);
  const material = materials.find((item) => item.slug === materialSlug) || null;
  const { sheet, edition, editions } = resolveSheetEdition(material, sheetSlug);

  useEffect(() => {
    if (edition?.deliverable !== false) rememberLastOpenedCatalogSheet(materialSlug, sheetSlug);
  }, [materialSlug, edition?.deliverable, sheetSlug]);

  if (loading) return <Page title={t("materials.coreCatalogTitle")}><LoadingPanel variant="sheet" /></Page>;
  if (error) return <Page title={t("materials.sheetNotFoundTitle")}><ErrorPanel message={error} onRetry={reload} /></Page>;
  if (!material || !sheet || !edition) return <Page title={t("materials.sheetNotFoundTitle")}><ErrorPanel message={t("materials.sheetNotFoundText")} /></Page>;
  if (edition.deliverable === false) return <Page title={sheet.title}><ErrorPanel message={t("materials.sheetNotFoundText")} /></Page>;

  return (
    <Page title={sheet.title}>
      <section className="catalog-sheet-entry">
        <nav className="catalog-sheet-breadcrumb" aria-label={t("materials.breadcrumbs")}>
          <Link to="/materials">{t("materials.allMaterials")}</Link><Icon name="chevron-right" size={14} aria-hidden="true" />
          <Link to={`/materials/catalog/${material.slug}`} dir="auto">{material.title}</Link><Icon name="chevron-right" size={14} aria-hidden="true" />
          <span dir="auto" aria-current="page">{sheet.title}</span>
        </nav>
        <article className="panel catalog-sheet-actions catalog-sheet-actions--primary">
          <div className="catalog-sheet-entry-heading">
            <span className="catalog-sheet-entry-icon"><Icon name="file" size={22} /></span>
            <div><p className="eyebrow" dir="auto">{material.title}</p><h2 dir="auto">{sheet.title}</h2>{edition.pageCount && <p id="catalog-sheet-file-status" dir="auto">{t("materials.pageCount", { count: edition.pageCount })} · {t(`materials.edition.${edition.edition || "university"}`)}</p>}</div>
          </div>
          <Link className="btn btn-primary catalog-sheet-focus-action" title={t("materials.openWorkspace")} to={`/materials/catalog/${material.slug}/sheets/${edition.slug}/workspace`} state={{ returnTo: location.pathname, scrollY: window.scrollY }}><Icon name="book-open" size={17} /> {t("materials.readSheet")}</Link>
        </article>
        <SheetEditionChooser material={material} editions={editions} current={edition} />
        <article className="catalog-lockin-card" aria-label={t("materials.lockInSoonLabel")}>
          <span><Icon name="lock" size={18} /></span><div><strong>{t("materials.lockInMode")}</strong><small>{t("common.soon")}</small></div>
        </article>
        <article className="catalog-active-study-card" data-available={edition.hasActiveStudy ? "true" : "false"} aria-label={t("materials.activeStudy")}>
          <span><Icon name="target" size={18} /></span><div><strong>{t("materials.activeStudy")}</strong><small>{t(edition.hasActiveStudy ? "materials.activeStudyAvailable" : "materials.activeStudyUnavailable")}</small></div>
          {edition.hasActiveStudy && <Link to={`/materials/catalog/${material.slug}/sheets/${edition.slug}/workspace`} state={{ returnTo: location.pathname, scrollY: window.scrollY }} aria-label={t("materials.openActiveStudy")}><Icon name="chevron-right" size={17} /></Link>}
        </article>
        {edition.summaryPdf?.viewUrl ? (
          <Link className="catalog-summary-card is-available" to={`/materials/catalog/${material.slug}/sheets/${edition.slug}/summary`}>
            <span><Icon name="book-open" size={18} /></span>
            <div><strong>{t("materials.sheetSummary")}</strong><small>{t("materials.summaryAvailable")}</small></div>
            <Icon name="chevron-right" size={17} aria-hidden="true" />
          </Link>
        ) : (
          <div className="catalog-summary-card is-unavailable" aria-disabled="true">
            <span><Icon name="book-open" size={18} /></span>
            <div><strong>{t("materials.sheetSummary")}</strong><small>{t(edition.summaryStatus === "processing" ? "materials.summaryProcessing" : "materials.summaryUnavailable")}</small></div>
          </div>
        )}
        <Link className="catalog-questions-card" to={`/questions/categories/practice/subjects/${material.slug}`}>
          <span><Icon name="help" size={18} /></span><div><strong>{t("materials.questions")}</strong><small>{t("materials.questionsDescription")}</small></div><Icon name="chevron-right" size={17} aria-hidden="true" />
        </Link>
        <Link className="btn btn-soft compact catalog-sheet-back" to={`/materials/catalog/${material.slug}`}><Icon name="arrow-left" size={16} /> {t("materials.backToSheets")}</Link>
      </section>
    </Page>
  );
}

/** The two editions of one sheet, chosen before a study mode. */
function SheetEditionChooser({ material, editions, current }) {
  const { t } = useI18n();
  if (editions.length < 2) return null;
  return (
    <section className="catalog-edition-chooser" aria-label={t("materials.editionLabel")}>
      <p className="eyebrow">{t("materials.editionLabel")}</p>
      <div className="catalog-edition-options" role="group">
        {editions.map((item) => {
          const active = item.slug === current.slug;
          return (
            <Link
              key={item.edition}
              className={`catalog-edition-option${active ? " is-active" : ""}`}
              aria-current={active ? "true" : undefined}
              to={`/materials/catalog/${material.slug}/sheets/${item.slug}`}
              replace
            >
              <Icon name={item.edition === "lockin" ? "lock" : "file"} size={17} />
              <span>
                <strong>{t(`materials.edition.${item.edition}`)}</strong>
                {item.pageCount ? <small>{t("materials.pageCount", { count: item.pageCount })}</small> : null}
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
