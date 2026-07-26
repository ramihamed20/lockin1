import { useEffect, useState } from "react";
import { managementApi, EDUCATION_NODE_KINDS } from "../api/management.js";
import { Icon } from "../lib/icons.jsx";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { EmptyState, ErrorPanel, LoadingPanel, Page } from "../components/ui/index.jsx";
import { CreatorNotice, CreatorTabs, FieldError, humanize, NodePicker, WorkflowStatus } from "../components/creator/index.jsx";

function mergeById(current, next) {
  const known = new Set(current.map((item) => item.id));
  return [...current, ...next.filter((item) => !known.has(item.id))];
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
  const [nodes, scopes] = await Promise.all([managementApi.listNodes({ page: 1, pageSize: 25 }), managementApi.listScopes()]);
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

  return <Page title="Creator studio" subtitle="Manage only the education hierarchy Django has made available to your creator scope.">
    <CreatorTabs />
    <CreatorNotice error={error} message={message} onRetry={workspace.reload} />
    <section className="community-top">
      <article className="panel community-composer"><p className="eyebrow">Education hierarchy</p><h2>Server-scoped hierarchy</h2><p>Every create, edit, move, publish, and archive action is checked by Django against your current creator scope and revision.</p><div className="focus-timer-actions"><button className="btn btn-primary" type="button" onClick={() => setCreateOpen((open) => !open)}><Icon name="plus" size={16} /> {createOpen ? "Close form" : "Create node"}</button></div>{createOpen && <NodeCreateForm nodes={nodeOptions} onCreated={(node) => { setNodes((current) => [node, ...current]); setNodeOptions((current) => [node, ...current]); setCreateOpen(false); setMessage("Django created the education node."); workspace.reload(); }} />}</article>
      <article className="panel announcement-panel"><div className="panel-title"><h2>Visible server scopes</h2><span>{scopes.length}</span></div><div className="announcement-list">{scopes.length ? scopes.map((scope) => <article className="announcement-item" key={scope.id}><span className="stat-icon"><Icon name="lock" /></span><div><h3>{scope.node_title}</h3><p>{["can_create_content", "can_review_content", "can_publish_content", "can_create_assessments", "can_review_assessments", "can_publish_assessments", "can_manage_hierarchy"].filter((key) => scope[key]).map((key) => humanize(key.replace("can_", ""))).join(" · ") || "No effective capabilities returned"}</p><small>{scope.user_email || "Current creator scope"}</small></div></article>) : <p className="muted">Django returned no creator scopes. Existing owned records may still be visible, but new scoped work can be denied by the server.</p>}</div></article>
    </section>
    <section className="panel community-post-list"><div className="panel-title"><h2>Visible hierarchy nodes</h2><span>{nodes.length}</span></div>{nodes.length ? nodes.map((node) => <NodeRow key={`${node.id}-${node.revision}`} node={node} nodes={nodeOptions} onChanged={(updated, note, conflict) => { if (updated) { setNodes((current) => current.map((item) => item.id === updated.id ? updated : item)); setNodeOptions((current) => current.map((item) => item.id === updated.id ? updated : item)); workspace.reload(); } if (note) setMessage(note); if (conflict) workspace.reload(); }} />) : <EmptyState title="No hierarchy nodes available" text="Django has not made education hierarchy records visible to this creator account." />}{hasNext && <button className="btn btn-soft" type="button" disabled={loadingMore} onClick={() => { void loadMore(); }}>{loadingMore ? "Loading…" : "Load more nodes"}</button>}</section>
  </Page>;
}

function NodeCreateForm({ nodes, onCreated }) {
  const [form, setForm] = useState({ parentId: "", kind: "lesson", title: "", slug: "", description: "", position: 0 });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  async function submit(event) {
    event.preventDefault();
    if (pending) return;
    setPending(true); setError(null);
    try { onCreated?.(await managementApi.createNode(form)); } catch (requestError) { setError(requestError); } finally { setPending(false); }
  }
  return <form className="composer-form" onSubmit={submit}><NodePicker nodes={nodes} value={form.parentId} required={false} label="Parent node (leave empty for a root institution)" onChange={(parentId) => setForm((current) => ({ ...current, parentId }))} /><label className="field"><span>Node type</span><select value={form.kind} onChange={(event) => setForm((current) => ({ ...current, kind: event.target.value }))}>{EDUCATION_NODE_KINDS.map((kind) => <option key={kind} value={kind}>{humanize(kind)}</option>)}</select></label><label className="field"><span>Title</span><input value={form.title} maxLength="180" required onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} /></label><FieldError error={error} field="title" /><label className="field"><span>Slug (optional)</span><input value={form.slug} maxLength="180" onChange={(event) => setForm((current) => ({ ...current, slug: event.target.value }))} /></label><FieldError error={error} field="slug" /><label className="field"><span>Description (optional)</span><textarea value={form.description} maxLength="4000" onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} /></label><label className="field"><span>Position</span><input type="number" min="0" max="1000000" value={form.position} onChange={(event) => setForm((current) => ({ ...current, position: event.target.value }))} /></label><CreatorNotice error={error} /><button className="btn btn-primary" type="submit" disabled={pending}>{pending ? "Creating…" : "Create node"}</button></form>;
}

function NodeRow({ node, nodes, onChanged }) {
  const [editor, setEditor] = useState("");
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);
  const [draft, setDraft] = useState({ title: node.title || "", slug: node.slug || "", description: node.description || "", position: node.position ?? 0, parentId: node.parent_id || "", status: node.status || "draft" });

  async function update(event) {
    event.preventDefault(); if (pending) return; setPending(true); setError(null);
    try { const updated = await managementApi.updateNode(node.id, { expectedRevision: node.revision, title: draft.title, slug: draft.slug, description: draft.description, position: draft.position }); onChanged?.(updated, "Django saved the node revision."); setEditor(""); } catch (requestError) { setError(requestError); if (requestError?.status === 409) onChanged?.(null, "This node changed elsewhere. Reload the current server hierarchy.", true); } finally { setPending(false); }
  }
  async function move(event) {
    event.preventDefault(); if (pending) return; setPending(true); setError(null);
    try { const updated = await managementApi.moveNode(node.id, { expectedRevision: node.revision, parentId: draft.parentId, position: draft.position }); onChanged?.(updated, "Django moved the node."); setEditor(""); } catch (requestError) { setError(requestError); if (requestError?.status === 409) onChanged?.(null, "This node changed elsewhere. Reload the current server hierarchy.", true); } finally { setPending(false); }
  }
  async function status(event) {
    event.preventDefault(); if (pending) return; setPending(true); setError(null);
    try { const updated = await managementApi.setNodeStatus(node.id, { expectedRevision: node.revision, status: draft.status }); onChanged?.(updated, "Django updated the node status."); setEditor(""); } catch (requestError) { setError(requestError); if (requestError?.status === 409) onChanged?.(null, "This node changed elsewhere. Reload the current server hierarchy.", true); } finally { setPending(false); }
  }
  return <article className="list-row"><span className="stat-icon"><Icon name="layers" /></span><div><h2>{node.title}</h2><p>{humanize(node.kind)} · {node.path || "Server path pending"} · revision {node.revision}</p>{node.description && <small>{node.description}</small>}{editor === "edit" && <form className="composer-form" onSubmit={update}><label className="field"><span>Title</span><input value={draft.title} required maxLength="180" onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} /></label><label className="field"><span>Slug</span><input value={draft.slug} maxLength="180" onChange={(event) => setDraft((current) => ({ ...current, slug: event.target.value }))} /></label><label className="field"><span>Description</span><textarea value={draft.description} maxLength="4000" onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} /></label><label className="field"><span>Position</span><input type="number" min="0" max="1000000" value={draft.position} onChange={(event) => setDraft((current) => ({ ...current, position: event.target.value }))} /></label><FieldError error={error} field="title" /><CreatorNotice error={error} /><div className="focus-timer-actions"><button className="btn btn-primary" disabled={pending}>{pending ? "Saving…" : "Save revision"}</button><button className="btn btn-soft" type="button" disabled={pending} onClick={() => setEditor("")}>Cancel</button></div></form>}{editor === "move" && <form className="composer-form" onSubmit={move}><NodePicker nodes={nodes.filter((item) => item.id !== node.id)} value={draft.parentId} required={false} label="New parent (empty requests root placement)" onChange={(parentId) => setDraft((current) => ({ ...current, parentId }))} /><label className="field"><span>Position</span><input type="number" min="0" max="1000000" value={draft.position} onChange={(event) => setDraft((current) => ({ ...current, position: event.target.value }))} /></label><CreatorNotice error={error} /><div className="focus-timer-actions"><button className="btn btn-primary" disabled={pending}>{pending ? "Moving…" : "Move node"}</button><button className="btn btn-soft" type="button" disabled={pending} onClick={() => setEditor("")}>Cancel</button></div></form>}{editor === "status" && <form className="composer-form" onSubmit={status}><label className="field"><span>Server status</span><select value={draft.status} onChange={(event) => setDraft((current) => ({ ...current, status: event.target.value }))}><option value="published">Published</option><option value="archived">Archived</option></select></label><CreatorNotice error={error} /><div className="focus-timer-actions"><button className="btn btn-primary" disabled={pending}>{pending ? "Updating…" : "Update status"}</button><button className="btn btn-soft" type="button" disabled={pending} onClick={() => setEditor("")}>Cancel</button></div></form>}</div><div className="post-actions"><WorkflowStatus status={node.status} /><button className="btn btn-soft compact" type="button" onClick={() => { setError(null); setEditor("edit"); }}>Edit</button><button className="btn btn-soft compact" type="button" onClick={() => { setError(null); setEditor("move"); }}>Move</button><button className="btn btn-soft compact" type="button" onClick={() => { setError(null); setEditor("status"); }}>Status</button></div></article>;
}
