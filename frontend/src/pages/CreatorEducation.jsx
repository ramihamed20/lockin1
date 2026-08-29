import { useEffect, useState } from "react";
import { managementApi, EDUCATION_NODE_KINDS } from "../api/management.js";
import { Icon } from "../lib/icons.jsx";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { EmptyState, ErrorPanel, LoadingPanel, Page } from "../components/ui/index.jsx";
import { CreatorNotice, CreatorTabs, FieldError, humanize, NodePicker, WorkflowStatus } from "../components/creator/index.jsx";
import { cssVars } from "../lib/utils.js";

function mergeById(current, next) {
  const known = new Set(current.map((item) => item.id));
  return [...current, ...next.filter((item) => !known.has(item.id))];
}

function ancestryFor(node, nodes) {
  const byId = new Map(nodes.map((item) => [item.id, item]));
  const titles = [];
  const seen = new Set();
  let parentId = node.parent_id;
  while (parentId && !seen.has(parentId) && titles.length < 8) {
    seen.add(parentId);
    const parent = byId.get(parentId);
    if (!parent) break;
    titles.unshift(parent.title || humanize(parent.kind));
    parentId = parent.parent_id;
  }
  return titles;
}

async function loadEducation() {
  const allNodes = [];
  let optionPage = 1;
  let optionsRemain = true;
  while (optionsRemain) {
    const result = await managementApi.listNodes({ page: optionPage, pageSize: 100 });
    allNodes.push(...result.results);
    optionsRemain = result.hasNext;
    optionPage += 1;
  }
  const [nodes, scopes] = await Promise.all([
    managementApi.listNodes({ page: 1, pageSize: 25 }),
    managementApi.listScopes()
  ]);
  return { nodes, allNodes, scopes };
}

export default function CreatorEducation() {
  const workspace = useAsyncData(loadEducation, []);
  const [nodes, setNodes] = useState([]);
  const [nodeOptions, setNodeOptions] = useState([]);
  const [scopes, setScopes] = useState([]);
  const [nextPage, setNextPage] = useState(2);
  const [hasNext, setHasNext] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(null);
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState("");

  useEffect(() => {
    if (!workspace.data) return;
    setNodes(workspace.data.nodes.results);
    setNodeOptions(workspace.data.allNodes);
    setScopes(workspace.data.scopes);
    setHasNext(workspace.data.nodes.hasNext);
    setNextPage(2);
    setError(null);
  }, [workspace.data]);

  async function loadMore() {
    if (!hasNext || loadingMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      const page = await managementApi.listNodes({ page: nextPage, pageSize: 25 });
      setNodes((current) => mergeById(current, page.results));
      setHasNext(page.hasNext);
      setNextPage((pageNumber) => pageNumber + 1);
    } catch (requestError) {
      setError(requestError);
    } finally {
      setLoadingMore(false);
    }
  }

  if (workspace.loading) return <LoadingPanel />;
  if (workspace.error) return <ErrorPanel message={workspace.error} onRetry={workspace.reload} />;

  const normalizedQuery = query.trim().toLowerCase();
  const visibleNodes = nodes.filter((node) => {
    if (kindFilter && node.kind !== kindFilter) return false;
    if (!normalizedQuery) return true;
    const ancestry = ancestryFor(node, nodeOptions).join(" ");
    return [node.title, node.description, node.slug, ancestry]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(normalizedQuery));
  });

  function handleNodeChanged(updated, note, conflict) {
    if (updated) {
      setNodes((current) => current.map((item) => item.id === updated.id ? updated : item));
      setNodeOptions((current) => current.map((item) => item.id === updated.id ? updated : item));
      workspace.reload();
    }
    if (note) setMessage(note);
    if (conflict) workspace.reload();
  }

  return (
    <Page title="Creator studio" subtitle="Manage the education hierarchy available to your creator scope.">
      <CreatorTabs />
      <CreatorNotice error={error} message={message} onRetry={workspace.reload} />

      <section className="community-top">
        <article className="panel community-composer">
          <p className="eyebrow">Education hierarchy</p>
          <h2>Server-scoped hierarchy</h2>
          <p>Every create, edit, move, publish and archive action is checked against your current creator scope and revision.</p>
          <div className="focus-timer-actions">
            <button className="btn btn-primary" type="button" onClick={() => setCreateOpen((open) => !open)}>
              <Icon name="plus" size={16} /> {createOpen ? "Close form" : "Create node"}
            </button>
          </div>
          {createOpen && <NodeCreateForm nodes={nodeOptions} onCreated={(node) => {
            setNodes((current) => [node, ...current]);
            setNodeOptions((current) => [node, ...current]);
            setCreateOpen(false);
            setMessage("The education node was created.");
            workspace.reload();
          }} />}
        </article>

        <article className="panel announcement-panel">
          <div className="panel-title"><h2>Visible server scopes</h2><span>{scopes.length}</span></div>
          <div className="announcement-list">
            {scopes.length ? scopes.map((scope) => (
              <article className="announcement-item" key={scope.id}>
                <span className="stat-icon"><Icon name="lock" /></span>
                <div>
                  <h3>{scope.node_title}</h3>
                  <p>{["can_create_content", "can_review_content", "can_publish_content", "can_create_assessments", "can_review_assessments", "can_publish_assessments", "can_manage_hierarchy"].filter((key) => scope[key]).map((key) => humanize(key.replace("can_", ""))).join(" · ") || "No effective capabilities returned"}</p>
                  <small>{scope.user_email || "Current creator scope"}</small>
                </div>
              </article>
            )) : <p className="muted">No creator scopes are assigned to your account. Records you already own stay visible, but new scoped work can be refused.</p>}
          </div>
        </article>
      </section>

      <section className="panel creator-hierarchy">
        <div className="panel-title">
          <div><h2>Visible hierarchy nodes</h2><p>Expand a node only when you need actions or technical details.</p></div>
          <span>{visibleNodes.length}/{nodes.length}</span>
        </div>
        <div className="creator-hierarchy-filters">
          <label className="field"><span>Search hierarchy</span><input type="search" value={query} placeholder="Title, description, or parent" onChange={(event) => setQuery(event.target.value)} /></label>
          <label className="field"><span>Node type</span><select value={kindFilter} onChange={(event) => setKindFilter(event.target.value)}><option value="">All types</option>{EDUCATION_NODE_KINDS.map((kind) => <option key={kind} value={kind}>{humanize(kind)}</option>)}</select></label>
        </div>
        <div className="creator-node-list">
          {visibleNodes.length ? visibleNodes.map((node) => (
            <NodeRow key={`${node.id}-${node.revision}`} node={node} nodes={nodeOptions} ancestry={ancestryFor(node, nodeOptions)} onChanged={handleNodeChanged} />
          )) : <EmptyState title={nodes.length ? "No matching hierarchy nodes" : "No hierarchy nodes available"} text={nodes.length ? "Clear a filter or try another hierarchy title." : "No education hierarchy records are visible to this creator account."} />}
        </div>
        {hasNext && <button className="btn btn-soft" type="button" disabled={loadingMore} onClick={() => { void loadMore(); }}>{loadingMore ? "Loading…" : "Load more nodes"}</button>}
      </section>
    </Page>
  );
}

function NodeCreateForm({ nodes, onCreated }) {
  const [form, setForm] = useState({ parentId: "", kind: "lesson", title: "", slug: "", description: "", position: 0 });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  async function submit(event) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      onCreated?.(await managementApi.createNode(form));
    } catch (requestError) {
      setError(requestError);
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="composer-form" onSubmit={submit}>
      <NodePicker nodes={nodes} value={form.parentId} required={false} label="Parent node (leave empty for a root institution)" onChange={(parentId) => setForm((current) => ({ ...current, parentId }))} />
      <label className="field"><span>Node type</span><select value={form.kind} onChange={(event) => setForm((current) => ({ ...current, kind: event.target.value }))}>{EDUCATION_NODE_KINDS.map((kind) => <option key={kind} value={kind}>{humanize(kind)}</option>)}</select></label>
      <label className="field"><span>Title</span><input value={form.title} maxLength={180} required onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} /></label>
      <FieldError error={error} field="title" />
      <label className="field"><span>Slug (optional)</span><input value={form.slug} maxLength={180} onChange={(event) => setForm((current) => ({ ...current, slug: event.target.value }))} /></label>
      <FieldError error={error} field="slug" />
      <label className="field"><span>Description (optional)</span><textarea value={form.description} maxLength={4000} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} /></label>
      <label className="field"><span>Position</span><input type="number" min="0" max="1000000" value={form.position} onChange={(event) => setForm((current) => ({ ...current, position: Number(event.target.value) }))} /></label>
      <CreatorNotice error={error} />
      <button className="btn btn-primary" type="submit" disabled={pending}>{pending ? "Creating…" : "Create node"}</button>
    </form>
  );
}

function NodeRow({ node, nodes, ancestry, onChanged }) {
  const [editor, setEditor] = useState("");
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);
  const [draft, setDraft] = useState({ title: node.title || "", slug: node.slug || "", description: node.description || "", position: node.position ?? 0, parentId: node.parent_id || "", status: node.status || "draft" });

  async function update(event) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const updated = await managementApi.updateNode(node.id, { expectedRevision: node.revision, title: draft.title, slug: draft.slug, description: draft.description, position: draft.position });
      onChanged?.(updated, "The node revision was saved.");
      setEditor("");
    } catch (requestError) {
      setError(requestError);
      if (requestError?.status === 409) onChanged?.(null, "This node changed elsewhere. Reload the current server hierarchy.", true);
    } finally {
      setPending(false);
    }
  }

  async function move(event) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const updated = await managementApi.moveNode(node.id, { expectedRevision: node.revision, parentId: draft.parentId, position: draft.position });
      onChanged?.(updated, "The node was moved.");
      setEditor("");
    } catch (requestError) {
      setError(requestError);
      if (requestError?.status === 409) onChanged?.(null, "This node changed elsewhere. Reload the current server hierarchy.", true);
    } finally {
      setPending(false);
    }
  }

  async function status(event) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const updated = await managementApi.setNodeStatus(node.id, { expectedRevision: node.revision, status: draft.status });
      onChanged?.(updated, "The node status was updated.");
      setEditor("");
    } catch (requestError) {
      setError(requestError);
      if (requestError?.status === 409) onChanged?.(null, "This node changed elsewhere. Reload the current server hierarchy.", true);
    } finally {
      setPending(false);
    }
  }

  const parentLabel = ancestry.length ? ancestry.join(" / ") : "Root level";
  return (
    <details className="creator-node-row" style={cssVars({ "--node-depth": Math.min(ancestry.length, 4) })}>
      <summary>
        <span className="stat-icon"><Icon name="layers" /></span>
        <span className="creator-node-summary"><strong>{node.title}</strong><small>{humanize(node.kind)} · {parentLabel}</small></span>
        <WorkflowStatus status={node.status} />
        <Icon name="chevron-right" size={18} />
      </summary>
      <div className="creator-node-detail">
        {node.description && <p>{node.description}</p>}
        <div className="creator-node-meta">
          <span>Revision {node.revision}</span>
          <span>Position {node.position ?? 0}</span>
          <details><summary>Technical ID</summary><code>{node.id}</code><button className="text-link" type="button" onClick={() => navigator.clipboard?.writeText(node.id)}>Copy ID</button></details>
        </div>
        <div className="post-actions">
          <button className="btn btn-soft compact" type="button" onClick={() => { setError(null); setEditor("edit"); }}>Edit</button>
          <button className="btn btn-soft compact" type="button" onClick={() => { setError(null); setEditor("move"); }}>Move</button>
          <button className="btn btn-soft compact" type="button" onClick={() => { setError(null); setEditor("status"); }}>Status</button>
        </div>
        {editor === "edit" && <form className="composer-form" onSubmit={update}>
          <label className="field"><span>Title</span><input value={draft.title} required maxLength={180} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} /></label>
          <label className="field"><span>Slug</span><input value={draft.slug} maxLength={180} onChange={(event) => setDraft((current) => ({ ...current, slug: event.target.value }))} /></label>
          <label className="field"><span>Description</span><textarea value={draft.description} maxLength={4000} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} /></label>
          <label className="field"><span>Position</span><input type="number" min="0" max="1000000" value={draft.position} onChange={(event) => setDraft((current) => ({ ...current, position: event.target.value }))} /></label>
          <FieldError error={error} field="title" />
          <CreatorNotice error={error} />
          <div className="focus-timer-actions"><button className="btn btn-primary" disabled={pending}>{pending ? "Saving…" : "Save revision"}</button><button className="btn btn-soft" type="button" disabled={pending} onClick={() => setEditor("")}>Cancel</button></div>
        </form>}
        {editor === "move" && <form className="composer-form" onSubmit={move}>
          <NodePicker nodes={nodes.filter((item) => item.id !== node.id)} value={draft.parentId} required={false} label="New parent (empty requests root placement)" onChange={(parentId) => setDraft((current) => ({ ...current, parentId }))} />
          <label className="field"><span>Position</span><input type="number" min="0" max="1000000" value={draft.position} onChange={(event) => setDraft((current) => ({ ...current, position: event.target.value }))} /></label>
          <CreatorNotice error={error} />
          <div className="focus-timer-actions"><button className="btn btn-primary" disabled={pending}>{pending ? "Moving…" : "Move node"}</button><button className="btn btn-soft" type="button" disabled={pending} onClick={() => setEditor("")}>Cancel</button></div>
        </form>}
        {editor === "status" && <form className="composer-form" onSubmit={status}>
          <label className="field"><span>Server status</span><select value={draft.status} onChange={(event) => setDraft((current) => ({ ...current, status: event.target.value }))}><option value="published">Published</option><option value="archived">Archived</option></select></label>
          <CreatorNotice error={error} />
          <div className="focus-timer-actions"><button className="btn btn-primary" disabled={pending}>{pending ? "Updating…" : "Update status"}</button><button className="btn btn-soft" type="button" disabled={pending} onClick={() => setEditor("")}>Cancel</button></div>
        </form>}
      </div>
    </details>
  );
}
