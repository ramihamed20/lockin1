import { useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { managementApi } from "../../api/management.js";
import { PRODUCT_ROLES } from "../../api/contracts.js";
import { hasOperationalCapability, hasProductRole } from "../../lib/authz.js";
import { Icon } from "../../lib/icons.jsx";
import { ConfirmDialog } from "../shared/ConfirmDialog.jsx";
import { ErrorPanel, NavItem } from "../ui/index.jsx";

export function creatorRoleAllowed(user, operationsSession = null) {
  return hasProductRole(user, PRODUCT_ROLES.CREATOR) || hasProductRole(user, PRODUCT_ROLES.ADMINISTRATOR) || hasOperationalCapability(operationsSession, "content.manage") || hasOperationalCapability(operationsSession, "assessments.manage");
}

export function CreatorRoute({ user, operationsSession = null, children }) {
  if (!creatorRoleAllowed(user, operationsSession)) {
    return <ErrorPanel message="This content workspace requires a creator, content administrator or product administrator role." />;
  }
  return children;
}

export function CreatorTabs() {
  const location = useLocation();
  const items = [
    ["/creator/education", "Education", "layers"],
    ["/creator/content", "Content", "file"],
    ["/creator/questions", "Questions", "help"],
    ["/creator/quizzes", "Quizzes", "target"]
  ];
  return <nav className="tabs-row creator-tabs" aria-label="Creator studio">{items.map(([path, label, icon]) => {
    const current = location.pathname === path || (path !== "/creator/education" && location.pathname.startsWith(path + "/"));
    return <NavItem key={path} to={path} current={current} className={current ? "active" : ""}><Icon name={icon} size={16} />&nbsp;{label}</NavItem>;
  })}</nav>;
}

export function CreatorNotice({ error = null, message = "", onRetry = null }) {
  if (error) return <ErrorPanel message={error.message || error || "This creator action could not be completed."} onRetry={onRetry} />;
  return message ? <p className="form-alert success" role="status">{message}</p> : null;
}

export function FieldError({ error, field }) {
  const value = error?.fields?.[field];
  const message = Array.isArray(value) ? value.find((item) => typeof item === "string") : typeof value === "string" ? value : "";
  return message ? <p className="inline-error">{message}</p> : null;
}

export function humanize(value, fallback = "Unavailable") {
  return typeof value === "string" && value ? value.replaceAll("_", " ") : fallback;
}

export function WorkflowStatus({ status }) {
  return <span className={`pill${status === "published" ? " success" : ""}`}>{humanize(status)}</span>;
}

export function NodePicker({ nodes, value, onChange, label = "Education node", required = true, disabled = false }) {
  return <label className="field"><span>{label}</span><select value={value || ""} required={required} disabled={disabled} onChange={(event) => onChange(event.target.value)}><option value="">Choose a server-visible education node</option>{nodes.map((node) => <option value={node.id} key={node.id}>{node.title} · {humanize(node.kind)}</option>)}</select></label>;
}

function safeFile(file) {
  return Boolean(file && file.validation_status === "ready" && !["quarantined", "failed"].includes(file.scan_status));
}

export function FileUploadField({ kind, uploadedFile, onUploaded }) {
  const [file, setFile] = useState(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const inputId = `creator-file-${kind}`;

  async function upload() {
    if (!file || pending) return;
    setPending(true);
    setError(null);
    try {
      const uploaded = await managementApi.uploadFile({ kind, file });
      onUploaded?.(uploaded);
      setFile(null);
    } catch (requestError) {
      setError(requestError);
    } finally {
      setPending(false);
    }
  }

  return <section className="settings-panel compact">
    <div className="panel-title"><div><h2>Primary {kind.toUpperCase()} file</h2><p className="muted">This file is validated and scanned before it can be published.</p></div><Icon name="file" size={20} /></div>
    <label className="field" htmlFor={inputId}><span>Choose {kind} file</span><input id={inputId} type="file" accept={kind === "pdf" ? "application/pdf" : "audio/*"} onChange={(event) => setFile(event.target.files?.[0] || null)} /></label>
    {file && <p className="save-hint">Selected: {file.name}</p>}
    <CreatorNotice error={error} />
    <div className="focus-timer-actions"><button className="btn btn-soft" type="button" disabled={!file || pending} onClick={() => { void upload(); }}>{pending ? "Uploading…" : "Upload"}</button></div>
    {uploadedFile && <div className="settings-row"><div><h2>{uploadedFile.original_name || "Uploaded file"}</h2><p>{humanize(uploadedFile.validation_status)} validation · {humanize(uploadedFile.scan_status)} scan</p></div><WorkflowStatus status={safeFile(uploadedFile) ? "ready" : uploadedFile.validation_status} /></div>}
    {uploadedFile && !safeFile(uploadedFile) && <p className="save-hint">This file cannot be attached while it is rejected, quarantined or failed.</p>}
  </section>;
}

export function QuestionOptionsEditor({ options, onChange, error }) {
  function update(index, updateValue) {
    onChange(options.map((option, itemIndex) => itemIndex === index ? { ...option, ...updateValue } : option));
  }
  function markCorrect(index) {
    onChange(options.map((option, itemIndex) => ({ ...option, isCorrect: itemIndex === index })));
  }
  function addOption() {
    if (options.length < 12) onChange([...options, { text: "", isCorrect: false }]);
  }
  function removeOption(index) {
    if (options.length <= 2) return;
    const next = options.filter((_, itemIndex) => itemIndex !== index);
    const hasCorrect = next.some((option) => option.isCorrect);
    onChange(next.map((option, itemIndex) => ({ ...option, isCorrect: hasCorrect ? option.isCorrect : itemIndex === 0 })));
  }
  return <section className="composer-form" aria-label="Question options">
    <div className="panel-title"><h2>Answer options</h2><span>{options.length}/12</span></div>
    {options.map((option, index) => <div className="settings-row" key={`option-${index}`}>
      <label className="check-row"><input type="radio" name="creator-correct-option" checked={option.isCorrect === true} onChange={() => markCorrect(index)} /><span>Correct</span></label>
      <label className="field"><span>Option {index + 1}</span><input value={option.text} maxLength={2000} required onChange={(event) => update(index, { text: event.target.value })} /></label>
      <button className="icon-btn danger" type="button" aria-label={`Remove option ${index + 1}`} disabled={options.length <= 2} onClick={() => removeOption(index)}><Icon name="trash" size={16} /></button>
    </div>)}
    <FieldError error={error} field="options" />
    <button className="btn btn-soft" type="button" disabled={options.length >= 12} onClick={addOption}><Icon name="plus" size={16} /> Add option</button>
  </section>;
}

export function QuizQuestionPicker({ questions, selectedIds, onChange, selectionMode, error }) {
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  if (selectionMode !== "fixed") return <p className="save-hint">Pool selection uses the published question pool and its selected difficulty filters. No fixed question identifiers are sent.</p>;
  function toggle(id) {
    onChange(selected.has(id) ? selectedIds.filter((value) => value !== id) : [...selectedIds, id]);
  }
  return <section className="composer-form"><div className="panel-title"><h2>Fixed questions</h2><span>{selectedIds.length} selected</span></div>{questions.length ? questions.map((question) => <label className="settings-row" key={question.id}><span className="stat-icon"><Icon name="help" /></span><div><h2>{question.current_version?.prompt || "Question"}</h2><p>{question.current_version?.academic_node_title || "Education scope"} · {humanize(question.workflow_status)}</p></div><input type="checkbox" checked={selected.has(question.id)} onChange={() => toggle(question.id)} /></label>) : <p className="save-hint">No management questions are visible to your account. Create or publish the required questions first.</p>}<FieldError error={error} field="question_ids" /></section>;
}

export function localDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function isoDateTime(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

export function LifecycleActions({ domain, record, isAdministrator = false, onUpdated }) {
  const [error, setError] = useState(null);
  const [message, setMessage] = useState("");
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reviewNote, setReviewNote] = useState("");
  const [transferOpen, setTransferOpen] = useState(false);
  const [ownerId, setOwnerId] = useState("");
  const [pending, setPending] = useState("");
  const [confirmAction, setConfirmAction] = useState("");
  const retireLabel = domain === "content" ? "Archive" : "Retire";

  async function run(action, values = {}) {
    if (!record || pending) return;
    setPending(action);
    setError(null);
    setMessage("");
    try {
      const updated = await managementApi.lifecycle(domain, record.id, action, { expectedRevision: record.revision, ...values });
      setRejectOpen(false);
      setTransferOpen(false);
      setReviewNote("");
      setOwnerId("");
      setMessage(`This ${humanize(action)} action was recorded.`);
      onUpdated?.(updated);
    } catch (requestError) {
      setError(requestError);
      if (requestError?.status === 409) onUpdated?.(null, true);
    } finally {
      setPending("");
      setConfirmAction("");
    }
  }

  const status = record?.workflow_status;
  return <section className="composer-form"><div className="panel-title"><h2>Server workflow</h2><WorkflowStatus status={status} /></div><p className="save-hint">Every action is checked against your creator scope, publishing authority, ownership, and the latest revision.</p>
    <CreatorNotice error={error} message={message} />
    <div className="focus-timer-actions">
      {(status === "draft" || status === "rejected") && <button className="btn btn-soft" type="button" disabled={Boolean(pending)} onClick={() => { void run("submit"); }}>{pending === "submit" ? "Submitting…" : "Submit for review"}</button>}
      {status === "in_review" && <button className="btn btn-primary" type="button" disabled={Boolean(pending)} onClick={() => { void run("publish"); }}>{pending === "publish" ? "Publishing…" : "Publish"}</button>}
      {status === "in_review" && <button className="btn btn-soft" type="button" disabled={Boolean(pending)} onClick={() => setRejectOpen((open) => !open)}>Reject with note</button>}
      {status === "published" && <button className="btn btn-danger" type="button" disabled={Boolean(pending)} onClick={() => setConfirmAction(domain === "content" ? "archive" : "retire")}>{retireLabel}</button>}
      {domain === "content" && isAdministrator && <button className="btn btn-soft" type="button" disabled={Boolean(pending)} onClick={() => setTransferOpen((open) => !open)}>Transfer owner</button>}
    </div>
    {rejectOpen && <form className="composer-form" onSubmit={(event) => { event.preventDefault(); void run("reject", { reviewNote }); }}><label className="field"><span>Required review note</span><textarea value={reviewNote} maxLength={4000} required onChange={(event) => setReviewNote(event.target.value)} /></label><FieldError error={error} field="review_note" /><div className="focus-timer-actions"><button className="btn btn-danger" type="submit" disabled={Boolean(pending)}>{pending === "reject" ? "Rejecting…" : "Reject"}</button><button className="btn btn-soft" type="button" disabled={Boolean(pending)} onClick={() => setRejectOpen(false)}>Cancel</button></div></form>}
    {transferOpen && <form className="composer-form" onSubmit={(event) => { event.preventDefault(); void run("transfer", { ownerId }); }}><label className="field"><span>New owner user identifier</span><input value={ownerId} required onChange={(event) => setOwnerId(event.target.value)} /></label><p className="save-hint">There is no user picker yet, so this administrator-only action needs the exact user identifier.</p><FieldError error={error} field="owner_id" /><div className="focus-timer-actions"><button className="btn btn-primary" type="submit" disabled={Boolean(pending)}>{pending === "transfer" ? "Transferring…" : "Transfer owner"}</button><button className="btn btn-soft" type="button" disabled={Boolean(pending)} onClick={() => setTransferOpen(false)}>Cancel</button></div></form>}
    <ConfirmDialog open={Boolean(confirmAction)} title={`${retireLabel} this ${domain}?`} message="Lock-in will apply this workflow change only if your scope and revision are current." confirmLabel={pending ? "Working…" : retireLabel} onCancel={() => !pending && setConfirmAction("")} onConfirm={() => { void run(confirmAction); }} />
  </section>;
}
