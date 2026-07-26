import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { educationApi, learningApi } from "../api/learning.js";
import { Icon } from "../lib/icons.jsx";
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
  const [page, setPage] = useState(1);
  const nodes = useAsyncData(() => educationApi.listNodes({ page }), [page]);

  if (nodes.loading) return <LoadingPanel />;
  if (nodes.error) return <ErrorPanel message={nodes.error} onRetry={nodes.reload} />;

  return (
    <Page title="Materials" subtitle="Browse the published academic path and open the materials available to your account.">
      {!nodes.data.results.length ? (
        <EmptyState title="No study areas are available" text="Published subjects will appear here when they are available to your account." />
      ) : (
        <section className="material-grid">
          {nodes.data.results.map((node) => <MaterialCard key={node.id} node={node} />)}
        </section>
      )}
      <PaginationControls page={page} pageData={nodes.data} onPageChange={setPage} label="Study-area pages" />
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
