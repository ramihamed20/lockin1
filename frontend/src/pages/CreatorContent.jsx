import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { CONTENT_TYPES, managementApi } from "../api/management.js";
import { PRODUCT_ROLES } from "../api/contracts.js";
import { hasOperationalCapability, hasProductRole } from "../lib/authz.js";
import { Icon } from "../lib/icons.jsx";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { EmptyState, ErrorPanel, LoadingPanel, Page } from "../components/ui/index.jsx";
import { CreatorNotice, CreatorTabs, FieldError, FileUploadField, humanize, isoDateTime, LifecycleActions, localDateTime, NodePicker, WorkflowStatus } from "../components/creator/index.jsx";

async function allNodes() {
  const items = [];
  let page = 1;
  let hasNext = true;
  while (hasNext) {
    const result = await managementApi.listNodes({ page, pageSize: 100 });
    items.push(...result.results);
    hasNext = result.hasNext;
    page += 1;
  }
  return items;
}

async function loadContent(status) {
  const [content, nodes] = await Promise.all([managementApi.listContent({ page: 1, pageSize: 25, status }), allNodes()]);
  return { content, nodes };
}

function contentFormState(item) {
  const version = item?.current_version;
  const primary = Array.isArray(version?.assets) ? version.assets.find((asset) => asset.role === "primary") : null;
  return {
    academicNodeId: version?.academic_node_id || "",
    contentType: version?.content_type || "pdf",
    title: version?.title || "",
    summary: version?.summary || "",
    language: version?.language || "en",
    allowDownload: version?.allow_download === true,
    availableFrom: localDateTime(version?.available_from),
    availableUntil: localDateTime(version?.available_until),
    primaryFileId: primary?.file_id || "",
    primaryName: primary?.original_name || ""
  };
}

export default function CreatorContent() {
  const [status, setStatus] = useState("");
  const data = useAsyncData(() => loadContent(status), [status]);
  const [items, setItems] = useState([]);
  const [nodes, setNodes] = useState([]);
  const [page, setPage] = useState(2);
  const [hasNext, setHasNext] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!data.data) return;
    setItems(data.data.content.results); setNodes(data.data.nodes); setHasNext(data.data.content.hasNext); setPage(2); setError(null);
  }, [data.data]);

  async function loadMore() {
    if (!hasNext || loadingMore) return;
    setLoadingMore(true); setError(null);
    try {
      const next = await managementApi.listContent({ page, pageSize: 25, status });
      setItems((current) => [...current, ...next.results.filter((item) => !current.some((known) => known.id === item.id))]);
      setHasNext(next.hasNext); setPage((value) => value + 1);
    } catch (requestError) { setError(requestError); } finally { setLoadingMore(false); }
  }

  if (data.loading) return <LoadingPanel />;
  if (data.error) return <ErrorPanel message={data.error} onRetry={data.reload} />;
  return <Page title="Creator studio" subtitle="Draft, review, publish, archive and transfer learning content through its scoped workflow.">
    <CreatorTabs />
    <CreatorNotice error={error} message={message} onRetry={data.reload} />
    <section className="community-top"><article className="panel community-composer"><p className="eyebrow">Content studio</p><h2>Learning content</h2><p>Files, availability, ownership, validation, scan state and publication are managed for you.</p><div className="focus-timer-actions"><button className="btn btn-primary" type="button" onClick={() => setCreateOpen((open) => !open)}><Icon name="plus" size={16} /> {createOpen ? "Close form" : "Create content"}</button></div>{createOpen && <ContentForm nodes={nodes} onSaved={(created) => { setItems((current) => [created, ...current]); setCreateOpen(false); setMessage("The content draft was created."); }} />}</article><article className="panel announcement-panel"><div className="panel-title"><h2>Workflow filter</h2><span>{items.length}</span></div><label className="field"><span>Visible server status</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">All statuses</option>{["draft", "in_review", "published", "rejected", "archived"].map((value) => <option key={value} value={value}>{humanize(value)}</option>)}</select></label><p className="save-hint">The status filter narrows only records already authorized for this account.</p></article></section>
    <section className="panel community-post-list"><div className="panel-title"><h2>Visible content</h2><span>{items.length}</span></div>{items.length ? items.map((item) => <article className="list-row" key={item.id}><span className="stat-icon"><Icon name="file" /></span><div><h2>{item.current_version?.title || "Untitled content"}</h2><p>{item.current_version?.academic_node_title || "Education scope"} · {humanize(item.current_version?.content_type)} · revision {item.revision}</p>{item.review_note && <small>Review note: {item.review_note}</small>}</div><div className="post-actions"><WorkflowStatus status={item.workflow_status} /><Link className="btn btn-soft compact" to={`/creator/content/${item.id}`}>Open</Link></div></article>) : <EmptyState title="No content visible" text="Nothing in this workflow matches your creator scope." />}{hasNext && <button className="btn btn-soft" type="button" disabled={loadingMore} onClick={() => { void loadMore(); }}>{loadingMore ? "Loading…" : "Load more content"}</button>}</section>
  </Page>;
}

export function CreatorContentDetail({ user, operationsSession = null }) {
  const { contentId = "" } = useParams();
  const data = useAsyncData(async () => ({ item: await managementApi.getContent(contentId), nodes: await allNodes() }), [contentId]);
  const [item, setItem] = useState(null);
  const [nodes, setNodes] = useState([]);
  const [message, setMessage] = useState("");

  useEffect(() => { if (data.data) { setItem(data.data.item); setNodes(data.data.nodes); } }, [data.data]);
  if (data.loading) return <LoadingPanel />;
  if (data.error || !item) return <ErrorPanel message={data.error || "This content record could not be loaded."} onRetry={data.reload} />;
  const isAdministrator = hasProductRole(user, PRODUCT_ROLES.ADMINISTRATOR) || hasOperationalCapability(operationsSession, "content.manage");
  return <Page title={item.current_version?.title || "Content detail"} subtitle="Edit the complete current version; each revision is created and validated for you."><CreatorTabs /><Link className="back-link" to="/creator/content"><Icon name="chevron-left" size={16} /> Content</Link>{message && <CreatorNotice message={message} />}<section className="community-top"><article className="panel community-composer"><p className="eyebrow">Revision {item.revision}</p><ContentForm key={`${item.id}-${item.revision}`} item={item} nodes={nodes} onSaved={(updated) => { setItem(updated); setMessage("A new content revision was saved."); }} /></article><article className="panel announcement-panel"><LifecycleActions domain="content" record={item} isAdministrator={isAdministrator} onUpdated={(updated, conflict) => { if (updated) { setItem(updated); setMessage("The content workflow was updated."); } if (conflict) { setMessage("This content changed elsewhere. The latest server version is loading."); data.reload(); } }} /><div className="announcement-list"><article className="announcement-item"><span className="stat-icon"><Icon name="user" /></span><div><h3>{item.owner_name || "Content owner"}</h3><p>{item.owner_email || "Account without an email on file"}</p></div></article>{item.review_note && <article className="announcement-item"><span className="stat-icon"><Icon name="help" /></span><div><h3>Review note</h3><p>{item.review_note}</p></div></article>}</div></article></section></Page>;
}

function ContentForm({ item = null, nodes, onSaved }) {
  const [form, setForm] = useState(() => contentFormState(item));
  const [uploaded, setUploaded] = useState(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const needsFile = form.contentType === "pdf" || form.contentType === "audio";
  const uploadBlocked = uploaded && (uploaded.validation_status !== "ready" || ["quarantined", "failed"].includes(uploaded.scan_status));
  function change(key, value) { setForm((current) => ({ ...current, [key]: value })); }
  async function submit(event) {
    event.preventDefault(); if (pending || uploadBlocked) return; setPending(true); setError(null);
    const data = { ...form, availableFrom: isoDateTime(form.availableFrom), availableUntil: isoDateTime(form.availableUntil), ...(item ? { expectedRevision: item.revision } : {}) };
    try { const saved = item ? await managementApi.updateContent(item.id, data) : await managementApi.createContent(data); onSaved?.(saved); } catch (requestError) { setError(requestError); } finally { setPending(false); }
  }
  return <form className="composer-form" onSubmit={submit}><NodePicker nodes={nodes} value={form.academicNodeId} onChange={(value) => change("academicNodeId", value)} /><FieldError error={error} field="academic_node_id" /><label className="field"><span>Content type</span><select value={form.contentType} onChange={(event) => { const nextType = event.target.value; change("contentType", nextType); change("primaryFileId", ""); change("primaryName", ""); setUploaded(null); }}>{CONTENT_TYPES.map((type) => <option value={type} key={type}>{humanize(type)}</option>)}</select></label><label className="field"><span>Title</span><input value={form.title} maxLength={220} required onChange={(event) => change("title", event.target.value)} /></label><FieldError error={error} field="title" /><label className="field"><span>Summary (optional)</span><textarea value={form.summary} maxLength={6000} onChange={(event) => change("summary", event.target.value)} /></label><label className="field"><span>Language</span><input value={form.language} maxLength={12} required onChange={(event) => change("language", event.target.value)} /></label><label className="check-row"><input type="checkbox" checked={form.allowDownload} onChange={(event) => change("allowDownload", event.target.checked)} /> Allow download once this version is published</label><label className="field"><span>Available from (optional)</span><input type="datetime-local" value={form.availableFrom} onChange={(event) => change("availableFrom", event.target.value)} /></label><label className="field"><span>Available until (optional)</span><input type="datetime-local" value={form.availableUntil} onChange={(event) => change("availableUntil", event.target.value)} /></label>{needsFile && <><FileUploadField kind={form.contentType} uploadedFile={uploaded} onUploaded={(file) => { setUploaded(file); change("primaryFileId", file.id); change("primaryName", file.original_name || ""); }} />{form.primaryFileId && <p className="save-hint">Primary file: {uploaded?.original_name || form.primaryName || form.primaryFileId}</p>}</>}{form.contentType === "video" && <p className="save-hint">Video metadata can be stored, but video delivery is not implemented yet. No primary file is attached.</p>}<FieldError error={error} field="primary_file_id" /><CreatorNotice error={error} /><button className="btn btn-primary" type="submit" disabled={pending || uploadBlocked}>{pending ? "Saving…" : item ? "Save new revision" : "Create content draft"}</button></form>;
}
