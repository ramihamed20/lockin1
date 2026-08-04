import { useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { educationApi, learningApi } from "../api/learning.js";
import { Icon } from "../lib/icons.jsx";
import { MATERIAL_CATALOG, getCatalogMaterial, getCatalogSheet } from "../lib/materialCatalog.js";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { BreadcrumbBar, EmptyState, ErrorPanel, LoadingPanel, Page } from "../components/ui/index.jsx";
import { LearningObjectCard } from "../components/learning/LearningObjectCard.jsx";
import { PaginationControls } from "../components/learning/PaginationControls.jsx";

const CONTENT_TYPE_OPTIONS = [
  ["", "All content types"],
  ["pdf", "PDF documents"],
  ["audio", "Audio"],
  ["video", "Video"]
];

function nodeKindLabel(kind) {
  return typeof kind === "string" ? kind.replaceAll("_", " ") : "Study area";
}

export default function Materials() {
  return (
    <Page title="Materials" subtitle="Choose a subject, then open one of its study sheets.">
      <section className="material-grid" aria-label="Study materials">
        {MATERIAL_CATALOG.map((material) => <CatalogMaterialCard key={material.slug} material={material} />)}
      </section>
    </Page>
  );
}

function CatalogMaterialCard({ material }) {
  return (
    <article className="material-card">
      <div className="card-head">
        <div><h2>{material.title}</h2><p>Three study sheets are ready to open.</p></div>
        <span className="stat-icon"><Icon name="book-open" /></span>
      </div>
      <div className="progress-meta"><span>Study material</span><strong>{material.sheets.length} sheets</strong></div>
      <Link className="btn btn-soft" to={`/materials/catalog/${material.slug}`}>Open sheets</Link>
    </article>
  );
}

export function CatalogMaterialSheets() {
  const { materialSlug } = useParams();
  const material = getCatalogMaterial(materialSlug);

  if (!material) return <Page title="Material not found"><ErrorPanel message="This material is not available in your study list." /></Page>;

  return (
    <Page title={material.title} subtitle="Choose a sheet to continue studying.">
      <BreadcrumbBar items={[["Materials", "/materials"]]} current={material.title} />
      <section className="sheet-grid" aria-label={`${material.title} sheets`}>
        {material.sheets.map((sheet) => (
          <article className="sheet-card" key={sheet.slug}>
            <div className="card-head">
              <div><span className="pill">Sheet {sheet.number}</span><h2>{sheet.title}</h2><p>{sheet.summary}</p></div>
              <span className="stat-icon"><Icon name="file" /></span>
            </div>
            <div className="progress-meta"><span>Study sheet</span><strong>Ready</strong></div>
            <Link className="btn btn-primary" to={`/materials/catalog/${material.slug}/sheets/${sheet.slug}`}>Open sheet</Link>
          </article>
        ))}
      </section>
    </Page>
  );
}

export function CatalogSheetStudy() {
  const { materialSlug, sheetSlug } = useParams();
  const location = useLocation();
  const { material, sheet } = getCatalogSheet(materialSlug, sheetSlug);

  if (!material || !sheet) return <Page title="Sheet not found"><ErrorPanel message="This study sheet is not available in your materials." /></Page>;

  return (
    <Page title={sheet.title} subtitle={`${material.title} · Sheet ${sheet.number}`}>
      <BreadcrumbBar items={[["Materials", "/materials"], [material.title, `/materials/catalog/${material.slug}`]]} current={`Sheet ${sheet.number}`} />
      <section className="dashboard-main catalog-sheet-layout catalog-sheet-layout--actions-only">
        <aside className="dashboard-right">
          <article className="panel study-table-card catalog-sheet-actions">
            <div className="panel-title"><div><p className="eyebrow">Focus workspace</p><h2>Ready to focus?</h2></div><span><Icon name="expand" size={18} /></span></div>
            <p className="muted">Open Lock In Mode for a server-saved focus session, timer, notes, and safe return to this sheet.</p>
            <div className="focus-timer-actions" aria-label="Study actions">
              <Link className="btn btn-soft" to={`/materials/catalog/${material.slug}/sheets/${sheet.slug}/workspace`} state={{ returnTo: location.pathname, scrollY: window.scrollY }}><Icon name="expand" size={16} /> Open Focus Workspace</Link>
              <Link className="btn btn-soft" to="/lock-in" state={{ returnTo: location.pathname, scrollY: window.scrollY }}><Icon name="clock" size={16} /> Enter Lock In Mode</Link>
              <button className="btn btn-soft" type="button" disabled aria-describedby="catalog-sheet-file-status"><Icon name="save" size={16} /> Save progress</button>
              <button className="btn btn-soft" type="button" disabled aria-describedby="catalog-sheet-file-status"><Icon name="arrow-up-right" size={16} /> Download</button>
              <button className="btn btn-soft" type="button" disabled aria-describedby="catalog-sheet-file-status"><Icon name="bookmark" size={16} /> Bookmark</button>
              <button className="btn btn-soft" type="button" disabled aria-describedby="catalog-sheet-file-status"><Icon name="messages" size={16} /> Discuss material</button>
            </div>
            <p className="save-hint" id="catalog-sheet-file-status">Saving, downloading, bookmarking, and discussion become available when this visual sheet is attached to its published Django file.</p>
            <Link className="btn btn-soft" to={`/materials/catalog/${material.slug}`}>Back to sheets</Link>
          </article>
        </aside>
      </section>
    </Page>
  );
}

export function MaterialCard({ node }) {
  return (
    <article className="material-card">
      <div className="card-head">
        <div><h2>{node.title}</h2><p>{node.description || "Browse published study material in this academic area."}</p></div>
        <span className="stat-icon"><Icon name="layers" /></span>
      </div>
      <div className="progress-meta"><span>{nodeKindLabel(node.kind)}</span><strong>Browse</strong></div>
      <Link className="btn btn-soft" to={`/materials/${node.id}`}>Open materials</Link>
    </article>
  );
}

export function MaterialSheets() {
  const { materialId } = useParams();
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
  const breadcrumbs = [
    ["Materials", "/materials"],
    ...node.data.breadcrumbs.map((item) => [item.title, `/materials/${item.id}`])
  ];

  return (
    <Page title={currentNode.title} subtitle="Browse the published learning objects and continue from server-saved progress.">
      <BreadcrumbBar items={breadcrumbs.slice(0, -1)} current={currentNode.title} />

      <section className="material-grid">
        {children.loading && <LoadingPanel />}
        {children.error && <ErrorPanel message={children.error} />}
        {!children.loading && !children.error && children.data.results.map((child) => <MaterialCard key={child.id} node={child} />)}
      </section>
      {!children.loading && !children.error && !children.data.results.length && <p className="muted">No further published study areas are available below this point.</p>}
      {!children.loading && !children.error && <PaginationControls page={childPage} pageData={children.data} onPageChange={setChildPage} label="Child study-area pages" />}

      <section className="panel study-table-card">
        <div className="panel-title"><div><p className="eyebrow">Published materials</p><h2>{currentNode.title}</h2></div></div>
        <label className="field">
          <span>Content type</span>
          <select value={contentType} onChange={(event) => changeContentType(event.target.value)}>
            {CONTENT_TYPE_OPTIONS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
          </select>
        </label>
      </section>

      {learningObjects.loading && <LoadingPanel />}
      {learningObjects.error && <ErrorPanel message={learningObjects.error} />}
      {!learningObjects.loading && !learningObjects.error && !learningObjects.data.results.length && (
        <EmptyState title="No matching materials" text="There are no published learning objects for this filter yet." />
      )}
      {!learningObjects.loading && !learningObjects.error && learningObjects.data.results.length > 0 && (
        <section className="sheet-grid">
          {learningObjects.data.results.map((learningObject) => (
            <LearningObjectCard key={learningObject.id} learningObject={{ ...learningObject, is_bookmarked: bookmarkOverrides[learningObject.id] ?? learningObject.is_bookmarked }} onBookmarkChanged={applyBookmarkChange} />
          ))}
        </section>
      )}
      {!learningObjects.loading && !learningObjects.error && <PaginationControls page={objectPage} pageData={learningObjects.data} onPageChange={setObjectPage} label="Learning-object pages" />}
    </Page>
  );
}
