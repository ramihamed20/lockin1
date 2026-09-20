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
    <Page title="Materials" headingHandled>
      <section className="catalog-directory" aria-labelledby="cohort-materials-heading">
        <CatalogDirectoryHeader id="cohort-materials-heading" title={t("route.materials")} subtitle={t("materials.chooseSubject")} />
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

function CatalogDirectoryHeader({ id, title, subtitle = "", backTo = "", backLabel = "", breadcrumb = null }) {
  return (
    <header className="catalog-directory-header">
      {backTo && <Link className="catalog-back-link" to={backTo}><Icon name="arrow-left" size={18} aria-hidden="true" /><span dir="auto">{backLabel}</span></Link>}
      {breadcrumb}
      <div className="catalog-directory-title"><h1 id={id} dir="auto">{title}</h1>{subtitle && <p dir="auto">{subtitle}</p>}</div>
    </header>
  );
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
    <Page title={material.title} headingHandled>
      <section className="catalog-directory" aria-labelledby="catalog-subject-heading">
        <CatalogDirectoryHeader id="catalog-subject-heading" title={material.title} subtitle={t("materials.chooseSheet")} backTo="/materials" backLabel={t("route.materials")} />
        <section className="sheet-grid catalog-sheet-grid" aria-label={t("materials.sheetsOf", { name: material.title })}>
          {material.sheets.map((sheet) => (
            <CatalogSheetCard key={sheet.slug} material={material} sheet={sheet} to={`/materials/catalog/${material.slug}/sheets/${sheet.slug}`} />
          ))}
        </section>
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

  const workspace = `/materials/catalog/${material.slug}/sheets/${edition.slug}/workspace`;
  const navigationState = { returnTo: location.pathname, scrollY: window.scrollY };

  return (
    <Page title={sheet.title} headingHandled>
      <section className="catalog-sheet-entry" aria-labelledby="catalog-sheet-heading">
        <CatalogDirectoryHeader
          id="catalog-sheet-heading"
          title={sheet.title}
          subtitle={material.title}
          backTo={`/materials/catalog/${material.slug}`}
          backLabel={material.title}
          breadcrumb={<nav className="catalog-sheet-breadcrumb" aria-label={t("materials.breadcrumbs")}><Link to="/materials">{t("route.materials")}</Link><Icon name="chevron-right" size={14} aria-hidden="true" /><Link to={`/materials/catalog/${material.slug}`} dir="auto">{material.title}</Link><Icon name="chevron-right" size={14} aria-hidden="true" /><span dir="auto" aria-current="page">{sheet.title}</span></nav>}
        />
        <SheetEditionChooser material={material} editions={editions} current={edition} />
        <section className="catalog-sheet-section" aria-labelledby="catalog-study-heading">
          <div className="catalog-sheet-section-heading"><h2 id="catalog-study-heading">{t("materials.studySection")}</h2><p>{t(`materials.edition.${edition.edition || "university"}`)}</p></div>
          <div className="catalog-action-list">
            <Link className="catalog-action-row is-primary" title={t("materials.openWorkspace")} to={workspace} state={{ ...navigationState, studyMode: "normal" }}><span className="catalog-action-icon"><Icon name="book-open" size={20} /></span><span><strong>{t("materials.readSheet")}</strong><small>{t("materials.readSheetDescription")}</small></span><Icon name="chevron-right" size={18} aria-hidden="true" /></Link>
            {edition.hasActiveStudy
              ? <Link className="catalog-action-row" to={workspace} state={{ ...navigationState, studyMode: "active" }} aria-label={t("materials.openActiveStudy")}><span className="catalog-action-icon"><Icon name="target" size={20} /></span><span><strong>{t("materials.activeStudy")}</strong><small>{t("materials.activeStudyDescription")}</small></span><Icon name="chevron-right" size={18} aria-hidden="true" /></Link>
              : <p className="catalog-action-note"><Icon name="target" size={17} aria-hidden="true" />{t("materials.activeStudyUnavailable")}</p>}
          </div>
        </section>
        <section className="catalog-sheet-section" aria-labelledby="catalog-practice-heading">
          <div className="catalog-sheet-section-heading"><h2 id="catalog-practice-heading">{t("materials.practiceSection")}</h2></div>
          <div className="catalog-action-list"><Link className="catalog-action-row" to={`/questions/categories/ai-sheet/subjects/${material.slug}`}><span className="catalog-action-icon"><Icon name="help" size={20} /></span><span><strong>{t("materials.questions")}</strong><small>{t("materials.questionsDescription")}</small></span><Icon name="chevron-right" size={18} aria-hidden="true" /></Link></div>
        </section>
        {edition.summaryPdf?.viewUrl && <section className="catalog-sheet-section" aria-labelledby="catalog-resources-heading">
          <div className="catalog-sheet-section-heading"><h2 id="catalog-resources-heading">{t("materials.resourcesSection")}</h2></div>
          <div className="catalog-action-list"><Link className="catalog-action-row" to={`/materials/catalog/${material.slug}/sheets/${edition.slug}/summary`}><span className="catalog-action-icon"><Icon name="file" size={20} /></span><span><strong>{t("materials.sheetSummary")}</strong><small>{t("materials.summaryDescription")}</small></span><Icon name="chevron-right" size={18} aria-hidden="true" /></Link></div>
        </section>}
      </section>
    </Page>
  );
}

/** The two editions of one sheet, chosen before a study mode. */
function SheetEditionChooser({ material, editions, current }) {
  const { t } = useI18n();
  if (!editions.length) return null;
  return (
    <section className="catalog-edition-chooser" aria-label={t("materials.editionLabel")}>
      <div className="catalog-sheet-section-heading"><h2>{t("materials.editionLabel")}</h2></div>
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
                <small>{t(`materials.editionDescription.${item.edition}`)}{item.pageCount ? ` · ${t("materials.pageCount", { count: item.pageCount })}` : ""}</small>
              </span>
              <Icon name="check" size={18} aria-hidden="true" />
            </Link>
          );
        })}
      </div>
    </section>
  );
}
