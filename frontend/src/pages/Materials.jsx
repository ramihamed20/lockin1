import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { educationApi, learningApi } from "../api/learning.js";
import { Icon } from "../lib/icons.jsx";
import { MATERIAL_CATALOG, getCatalogMaterial, getCatalogSheet, rememberLastOpenedCatalogSheet } from "../lib/materialCatalog.js";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { EmptyState, ErrorPanel, LoadingPanel, Page } from "../components/ui/index.jsx";
import { LearningObjectCard } from "../components/learning/LearningObjectCard.jsx";
import { PaginationControls } from "../components/learning/PaginationControls.jsx";
import { CatalogSheetCard } from "../components/learning/CatalogSheetCard.jsx";
import { CatalogTile } from "../components/learning/CatalogTile.jsx";
import { useI18n } from "../components/I18nProvider.jsx";

const CONTENT_TYPE_KEYS = [
  ["", "materials.allContentTypes"],
  ["pdf", "materials.pdfDocuments"],
  ["audio", "materials.audio"],
  ["video", "materials.video"]
];

/** Published kinds arrive from the catalogue as their own labels; only the
 * fallback is ours to translate. */
function nodeKindLabel(kind, t) {
  return typeof kind === "string" ? kind.replaceAll("_", " ") : t("materials.studyArea");
}

export default function Materials() {
  const { t } = useI18n();

  return (
    <Page title="Materials">
      <section aria-labelledby="demo-materials-heading">
        <div className="panel-title">
          <div>
            <p className="eyebrow">{t("materials.demoCatalogTitle")}</p>
            <h2 id="demo-materials-heading">{t("materials.demoCatalogHeading")}</h2>
            <p className="muted">{t("materials.demoCatalogSubtitle")}</p>
          </div>
        </div>
        <section className="material-grid catalog-material-grid" aria-label={t("materials.catalogLabel")}>
          {MATERIAL_CATALOG.map((material) => <CatalogMaterialCard key={material.slug} material={material} />)}
        </section>
      </section>
    </Page>
  );
}

function CatalogMaterialCard({ material }) {
  const { t } = useI18n();
  return <CatalogTile title={material.title} meta={t("materials.sheetCount", { count: material.sheets.length })} icon="book-open" to={`/materials/catalog/${material.slug}`} />;
}

export function CatalogMaterialSheets() {
  const { materialSlug } = useParams();
  const { t } = useI18n();
  const material = getCatalogMaterial(materialSlug);

  if (!material) return <Page title={t("materials.notFoundTitle")}><ErrorPanel message={t("materials.notFoundText")} /></Page>;

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

export function CatalogSheetStudy() {
  const { materialSlug, sheetSlug } = useParams();
  const location = useLocation();
  const { t } = useI18n();
  const { material, sheet } = getCatalogSheet(materialSlug, sheetSlug);

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

export function MaterialCard({ node }) {
  const { t } = useI18n();
  return (
    <article className="material-card">
      <div className="card-head">
        <div><h2 dir="auto">{node.title}</h2><p dir="auto">{node.description || t("materials.areaFallbackSummary")}</p></div>
        <span className="stat-icon"><Icon name="layers" /></span>
      </div>
      <div className="progress-meta"><span dir="auto">{nodeKindLabel(node.kind, t)}</span><strong>{t("materials.browse")}</strong></div>
      <Link className="btn btn-soft" to={`/materials/${node.id}`}>{t("materials.openArea")}</Link>
    </article>
  );
}

export function MaterialSheets() {
  const { materialId } = useParams();
  const { t } = useI18n();
  const [childPage, setChildPage] = useState(1);
  const [objectPage, setObjectPage] = useState(1);
  const [contentType, setContentType] = useState("");
  const [bookmarkOverrides, setBookmarkOverrides] = useState({});
  const node = useAsyncData(() => educationApi.getNode(materialId), [materialId]);
  const children = useAsyncData(
    () => educationApi.listNodes({ parentId: materialId, page: childPage }),
    [materialId, childPage]
  );
  const learningObjects = useAsyncData(
    () => learningApi.listLearningObjects({ nodeId: materialId, contentType, page: objectPage }),
    [materialId, contentType, objectPage]
  );

  function changeContentType(nextType) {
    setContentType(nextType);
    setObjectPage(1);
  }

  function applyBookmarkChange(learningObjectId, isBookmarked) {
    // The response list is server-sourced; keep only the confirmed local
    // representation until this page is fetched again.
    setBookmarkOverrides((current) => ({ ...current, [learningObjectId]: isBookmarked }));
  }

  if (node.loading) return <LoadingPanel />;
  if (node.error) return <ErrorPanel message={node.error} />;

  const currentNode = node.data.node;
  return (
    <Page title={currentNode.title} subtitle={t("materials.areaSubtitle")}>
      <section className="material-grid">
        {children.loading && <LoadingPanel />}
        {children.error && <ErrorPanel message={children.error} />}
        {!children.loading && !children.error && children.data.results.map((child) => <MaterialCard key={child.id} node={child} />)}
      </section>
      {!children.loading && !children.error && !children.data.results.length && <p className="muted">{t("materials.noChildAreas")}</p>}
      {!children.loading && !children.error && <PaginationControls page={childPage} pageData={children.data} onPageChange={setChildPage} label={t("materials.childPages")} />}

      <section className="panel study-table-card">
        <div className="panel-title"><div><p className="eyebrow">{t("materials.published")}</p><h2 dir="auto">{currentNode.title}</h2></div></div>
        <label className="field">
          <span>{t("materials.contentType")}</span>
          <select value={contentType} onChange={(event) => changeContentType(event.target.value)}>
            {CONTENT_TYPE_KEYS.map(([value, labelKey]) => <option value={value} key={value}>{t(labelKey)}</option>)}
          </select>
        </label>
      </section>

      {learningObjects.loading && <LoadingPanel />}
      {learningObjects.error && <ErrorPanel message={learningObjects.error} />}
      {!learningObjects.loading && !learningObjects.error && !learningObjects.data.results.length && (
        <EmptyState title={t("materials.noMatchTitle")} text={t("materials.noMatchText")} />
      )}
      {!learningObjects.loading && !learningObjects.error && learningObjects.data.results.length > 0 && (
        <section className="sheet-grid">
          {learningObjects.data.results.map((learningObject) => (
            <LearningObjectCard key={learningObject.id} learningObject={{ ...learningObject, is_bookmarked: bookmarkOverrides[learningObject.id] ?? learningObject.is_bookmarked }} onBookmarkChanged={applyBookmarkChange} />
          ))}
        </section>
      )}
      {!learningObjects.loading && !learningObjects.error && <PaginationControls page={objectPage} pageData={learningObjects.data} onPageChange={setObjectPage} label={t("materials.objectPages")} />}
    </Page>
  );
}
