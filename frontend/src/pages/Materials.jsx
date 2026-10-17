import { useEffect, useState } from "react";
import { catalogWorkspaceApi } from "../api/catalogWorkspace.js";
import { Link, useLocation, useParams } from "react-router-dom";
import { Icon } from "../lib/icons.jsx";
import { rememberLastOpenedCatalogSheet, resolveSheetEdition } from "../lib/materialCatalog.js";
import { useCatalogMaterials } from "../hooks/useCatalogMaterials.js";
import { preloadCatalogDocument } from "../hooks/useCatalogDocument.js";
import { EmptyState, ErrorPanel, LoadingPanel, Page } from "../components/ui/index.jsx";
import { CatalogSheetCard } from "../components/learning/CatalogSheetCard.jsx";
import { CatalogTile } from "../components/learning/CatalogTile.jsx";
import { useI18n } from "../components/I18nProvider.jsx";
import OfflineSheetAction from "../offline/OfflineSheetAction.jsx";
import { PersonalSheetsBranch } from "../components/learning/PersonalSheets.jsx";
import { canAddSubjects } from "../components/learning/AddedSubjectsSettings.jsx";

export { PersonalSheetsPage } from "../components/learning/PersonalSheets.jsx";

export default function Materials({ user = null }) {
  const { t } = useI18n();
  const { materials, loading, error, reload, refresh } = useCatalogMaterials(user);

  // A directory that has not arrived is not a directory that is empty. Telling a
  // student "you have no subjects" while the request is still in flight -- or
  // because it failed -- is how a transient error reads as lost content.
  if (loading) return <Page width="reading" title="Materials"><LoadingPanel variant="material-list" /></Page>;
  if (error) return <Page width="reading" title="Materials"><ErrorPanel message={error} onRetry={reload} /></Page>;

  return (
    <Page width="reading" title="Materials" headingHandled>
      <section className="catalog-directory" aria-labelledby="cohort-materials-heading">
        <CatalogDirectoryHeader id="cohort-materials-heading" title={t("route.materials")} />
        {materials.length === 0
          ? <EmptyState icon="study" title={t("materials.noCohortMaterialsTitle")} text={t("materials.noCohortMaterialsText")} />
          : (
            <section className="material-grid catalog-material-grid" aria-label={t("materials.catalogLabel")}>
              {materials.map((material) => <CatalogMaterialCard key={material.slug} material={material} />)}
            </section>
          )}
        {canAddSubjects(user) && <AddFirstYearSubject onChange={refresh} />}
      </section>
    </Page>
  );
}

function CatalogMaterialCard({ material }) {
  const { t } = useI18n();
  const count = t("materials.sheetCount", { count: material.sheets.length });
  const meta = material.added ? `${t("materials.addedFromFirstYear")} · ${count}` : count;
  return <CatalogTile title={material.title} meta={meta} icon="book-open" to={`/materials/catalog/${material.slug}`} />;
}

/** The "+" under a Second Year student's subjects: add up to two First Year subjects. */
function AddFirstYearSubject({ onChange }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    catalogWorkspaceApi.addedSubjects()
      .then((payload) => { if (active) setState(payload); })
      .catch(() => { if (active) setState(null); });
    return () => { active = false; };
  }, []);

  const [confirming, setConfirming] = useState("");

  // Choices are final, so once both are chosen the "+" goes away. A change is
  // a request from Settings.
  if (!state?.eligible || !state.available?.length || state.added.length >= state.limit) return null;

  const addedCount = state.added.length;

  async function add(subject) {
    // The first tap asks; the second commits, since a choice cannot be undone here.
    if (confirming !== subject.slug) {
      setConfirming(subject.slug);
      return;
    }
    setBusy(subject.slug);
    setError("");
    try {
      setState(await catalogWorkspaceApi.addSubject(subject.slug));
      setConfirming("");
      onChange();
    } catch {
      setError(t("materials.addSubjectFailed"));
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="catalog-add-subject" aria-label={t("materials.addSubject")}>
      <button type="button" className="catalog-add-subject__toggle" aria-expanded={open} aria-controls="catalog-add-subject-panel" onClick={() => setOpen((value) => !value)}>
        <span className="catalog-add-subject__icon" aria-hidden="true"><Icon name={open ? "x" : "plus"} size={20} /></span>
        <span className="catalog-add-subject__copy">
          <strong dir="auto">{t("materials.addSubject")}</strong>
          <small dir="auto">{t("materials.addSubjectCount", { count: addedCount, limit: state.limit })}</small>
        </span>
      </button>
      {open && (
        <div id="catalog-add-subject-panel" className="catalog-add-subject__panel">
          <p dir="auto" className="catalog-add-subject__hint">{t("materials.addSubjectHint", { limit: state.limit })}</p>
          <ul className="catalog-add-subject__list">
            {state.available.map((subject) => {
              if (subject.added) {
                return (
                  <li key={subject.slug} className="is-added">
                    <span dir="auto">{subject.title}</span>
                    <span className="catalog-add-subject__added"><Icon name="check" size={16} aria-hidden="true" />{t("materials.addedSubject")}</span>
                  </li>
                );
              }
              const asking = confirming === subject.slug;
              const label = asking ? t("materials.confirmAddSubject") : t("materials.addSubjectAction");
              return (
                <li key={subject.slug}>
                  <span dir="auto">{subject.title}</span>
                  <button type="button" className={asking ? "btn btn-primary compact" : "btn btn-soft compact"} disabled={Boolean(busy)} aria-busy={busy === subject.slug} aria-label={`${label} ${subject.title}`} onClick={() => add(subject)}>
                    <Icon name={asking ? "check" : "plus"} size={16} aria-hidden="true" />
                    <span>{label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p dir="auto" className="catalog-add-subject__hint">{t("materials.addSubjectFinal")} <Link to="/settings?section=subjects">{t("materials.changeSubjectsLink")}</Link></p>
          {error && <p role="alert" className="catalog-add-subject__error" dir="auto">{error}</p>}
        </div>
      )}
    </section>
  );
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

  if (loading) return <Page width="reading" title={t("materials.coreCatalogTitle")}><LoadingPanel variant="card-list" /></Page>;
  if (error) return <Page width="reading" title={t("materials.notFoundTitle")}><ErrorPanel message={error} onRetry={reload} /></Page>;
  if (!material) return <Page width="reading" title={t("materials.notFoundTitle")}><ErrorPanel message={t("materials.notFoundText")} /></Page>;

  return (
    <Page width="reading" title={material.title} headingHandled>
      <section className="catalog-directory" aria-labelledby="catalog-subject-heading">
        <CatalogDirectoryHeader id="catalog-subject-heading" title={material.title} backTo="/materials" backLabel={t("route.materials")} />
        {/* The student's own sheets are a branch of every subject, so the
            subject is never a dead end even before anything is published. */}
        <PersonalSheetsBranch material={material} user={user} />
        {material.sheets.length
          ? (
            <section className="sheet-grid catalog-sheet-grid" aria-label={t("materials.sheetsOf", { name: material.title })}>
              {material.sheets.map((sheet) => (
                <CatalogSheetCard key={sheet.slug} material={material} sheet={sheet} to={`/materials/catalog/${material.slug}/sheets/${sheet.slug}`} />
              ))}
            </section>
          )
          : <EmptyState icon="study" title={t("materials.noSheetsTitle")} text={t("materials.noSheetsText")} />}
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
    if (edition?.deliverable !== false) rememberLastOpenedCatalogSheet(materialSlug, sheetSlug, { material, sheet }, user?.id);
  }, [materialSlug, edition?.deliverable, sheetSlug, material, sheet, user?.id]);

  useEffect(() => {
    if (!material || !editions.length) return;
    // Focus is the primary action from this page. Warm its route and each
    // available edition's protected-document resolution while the student is
    // reading the choices, so Open does not begin from two cold loads.
    void import("./CatalogFocusWorkspace.jsx");
    editions.forEach((item) => { void preloadCatalogDocument(material.slug, item.slug, "", user?.id || ""); });
  }, [editions, material, user?.id]);

  if (loading) return <Page width="reading" title={t("materials.coreCatalogTitle")}><LoadingPanel variant="sheet" /></Page>;
  if (error) return <Page width="reading" title={t("materials.sheetNotFoundTitle")}><ErrorPanel message={error} onRetry={reload} /></Page>;
  if (!material || !sheet || !edition) return <Page width="reading" title={t("materials.sheetNotFoundTitle")}><ErrorPanel message={t("materials.sheetNotFoundText")} /></Page>;
  if (edition.deliverable === false) return <Page width="reading" title={sheet.title}><ErrorPanel message={t("materials.sheetNotFoundText")} /></Page>;

  const navigationState = { returnTo: location.pathname, scrollY: window.scrollY };

  return (
    <Page width="reading" title={sheet.title} headingHandled>
      <section className="catalog-sheet-entry" aria-labelledby="catalog-sheet-heading">
        <CatalogDirectoryHeader
          id="catalog-sheet-heading"
          title={sheet.title}
          subtitle={material.title}
          backTo={`/materials/catalog/${material.slug}`}
          backLabel={material.title}
          breadcrumb={<nav className="catalog-sheet-breadcrumb" aria-label={t("materials.breadcrumbs")}><Link to="/materials">{t("route.materials")}</Link><Icon name="chevron-right" size={14} aria-hidden="true" /><Link to={`/materials/catalog/${material.slug}`} dir="auto">{material.title}</Link><Icon name="chevron-right" size={14} aria-hidden="true" /><span dir="auto" aria-current="page">{sheet.title}</span></nav>}
        />
        <SheetEditionChooser material={material} editions={editions} navigationState={navigationState} userId={user?.id || ""} />
        {edition.summaryPdf?.viewUrl && <section className="catalog-sheet-section" aria-labelledby="catalog-resources-heading">
          <div className="catalog-sheet-section-heading"><h2 id="catalog-resources-heading">{t("materials.resourcesSection")}</h2></div>
          <div className="catalog-action-list"><Link className="catalog-action-row" to={`/materials/catalog/${material.slug}/sheets/${edition.slug}/summary`}><span className="catalog-action-icon"><Icon name="file" size={20} /></span><span><strong>{t("materials.sheetSummary")}</strong><small>{t("materials.summaryDescription")}</small></span><Icon name="chevron-right" size={18} aria-hidden="true" /></Link></div>
        </section>}
      </section>
    </Page>
  );
}

/** Each available edition opens its Focus Workspace directly. */
function SheetEditionChooser({ material, editions, navigationState, userId }) {
  const { t } = useI18n();
  if (!editions.length) return null;
  return (
    <section className={`catalog-edition-chooser ${editions.length > 1 ? "has-choice" : "is-single"}`} aria-label={t("materials.editionLabel")}>
      {/* "Choose" is only printed when there is a choice to make. */}
      {editions.length > 1 && <div className="catalog-sheet-section-heading"><h2>{t("materials.editionLabel")}</h2></div>}
      <div className="catalog-edition-options" role="group">
        {editions.map((item) => {
          return (
            <div key={item.edition} className="catalog-edition-offline-row">
            <Link
              className="catalog-edition-option"
              to={`/materials/catalog/${material.slug}/sheets/${item.slug}/workspace`}
              state={{ ...navigationState, studyMode: "normal" }}
            >
              <Icon name={item.edition === "lockin" ? "lock" : "file"} size={17} />
              <span>
                <strong>{t(`materials.edition.${item.edition}`)}</strong>
                <small>{t(`materials.editionDescription.${item.edition}`)}{item.pageCount ? ` · ${t("materials.pageCount", { count: item.pageCount })}` : ""}</small>
              </span>
              <span className="catalog-edition-open">{t("common.open")}</span>
            </Link>
            <OfflineSheetAction userId={userId} materialSlug={material.slug} sheetSlug={item.slug} edition={item.edition} />
            </div>
          );
        })}
      </div>
    </section>
  );
}
