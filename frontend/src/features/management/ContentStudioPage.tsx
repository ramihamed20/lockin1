import { useCallback, useEffect, useState, type FormEvent } from "react";

import { ApiError } from "../../api/client";
import { Button } from "../../components/Button";
import { Alert, EmptyState, PageSkeleton } from "../../components/Feedback";
import { FormField, SelectField } from "../../components/FormField";
import { formValue } from "../../components/formValue";
import { useI18n } from "../../i18n/I18nProvider";
import type { MessageKey } from "../../i18n/catalogs";
import type { EducationNode } from "../learning/types";
import { contentAction, managedContent, managedNodes, saveContentDraft, uploadManagedFile } from "./api";
import type { ManagedLearningObject } from "./types";

type SaveState = "idle" | "saving" | "saved" | "error";
const workflowLabels: Record<ManagedLearningObject["workflow_status"], MessageKey> = {
  draft: "workflow_draft",
  in_review: "workflow_in_review",
  published: "workflow_published",
  rejected: "workflow_rejected",
  archived: "workflow_archived"
};

function ContentEditor({
  nodes,
  current,
  onSaved,
  onCancel
}: {
  nodes: EducationNode[];
  current: ManagedLearningObject | null;
  onSaved: (item: ManagedLearningObject) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const version = current?.current_version;
  const [contentType, setContentType] = useState<"pdf" | "audio" | "video">(version?.content_type ?? "pdf");
  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<SaveState>("idle");
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const existingFile = version?.assets.find((asset) => asset.role === "primary")?.file_id;
    if (contentType !== "video" && !file && !existingFile) {
      setState("error");
      setMessage(t("contentFileRequired"));
      return;
    }
    setState("saving");
    setMessage("");
    try {
      const uploaded = file ? await uploadManagedFile(file, contentType as "pdf" | "audio") : null;
      const saved = await saveContentDraft({
        academic_node_id: formValue(form, "academic_node_id"),
        content_type: contentType,
        title: formValue(form, "title"),
        summary: formValue(form, "summary"),
        language: formValue(form, "language"),
        allow_download: form.get("allow_download") === "on",
        primary_file_id: contentType === "video" ? null : uploaded?.id ?? existingFile ?? null
      }, current ?? undefined);
      setState("saved");
      onSaved(saved);
      formElement.reset();
      setFile(null);
    } catch (error) {
      setState("error");
      setMessage(error instanceof ApiError ? error.message : t("genericError"));
    }
  }

  return (
    <form className="studio-editor" onSubmit={(event) => void submit(event)}>
      <header>
        <div><h2>{current ? t("reviseContent") : t("createContent")}</h2><p>{t("contentEditorCopy")}</p></div>
        {current ? <Button type="button" variant="quiet" onClick={onCancel}>{t("cancelEditing")}</Button> : null}
      </header>
      <div className="studio-editor__grid">
        <SelectField name="academic_node_id" label={t("learningLocation")} defaultValue={version?.academic_node_id ?? ""} required>
          <option value="" disabled>{t("chooseLearningLocation")}</option>
          {nodes.filter((node) => node.status !== "archived").map((node) => <option key={node.id} value={node.id}>{"—".repeat(node.depth)} {node.title}</option>)}
        </SelectField>
        <SelectField name="content_type" label={t("contentType")} value={contentType} onChange={(event) => setContentType(event.target.value as typeof contentType)}>
          <option value="pdf">{t("pdfDocument")}</option>
          <option value="audio">{t("audioLesson")}</option>
          <option value="video">{t("futureVideo")}</option>
        </SelectField>
        <FormField name="title" label={t("contentTitle")} defaultValue={version?.title ?? ""} maxLength={220} required />
        <SelectField name="language" label={t("contentLanguage")} defaultValue={version?.language ?? "en"}>
          <option value="en">{t("english")}</option><option value="ar">{t("arabic")}</option>
        </SelectField>
      </div>
      <div className="field"><label htmlFor="content-summary">{t("contentSummary")}</label><textarea id="content-summary" name="summary" rows={4} maxLength={6000} defaultValue={version?.summary ?? ""} /></div>
      {contentType !== "video" ? (
        <div className="field"><label htmlFor="content-file">{contentType === "pdf" ? t("pdfFile") : t("audioFile")}</label><input id="content-file" type="file" accept={contentType === "pdf" ? ".pdf,application/pdf" : "audio/*"} onChange={(event) => setFile(event.target.files?.[0] ?? null)} /><span className="field__hint">{version ? t("keepExistingFile") : t("secureUploadCopy")}</span></div>
      ) : <p className="future-content-note">{t("videoMetadataOnly")}</p>}
      <label className="check-control"><input name="allow_download" type="checkbox" defaultChecked={version?.allow_download ?? false} /><span>{t("allowStudentDownload")}</span></label>
      <div className="form-actions"><Button type="submit" disabled={state === "saving"}>{state === "saving" ? t("saving") : current ? t("saveRevision") : t("saveDraft")}</Button></div>
      {state === "saved" ? <p className="inline-success" role="status">{t("contentSaved")}</p> : null}
      {state === "error" ? <p className="inline-error" role="alert">{message}</p> : null}
    </form>
  );
}

function WorkflowActions({ item, onUpdated, onEdit }: { item: ManagedLearningObject; onUpdated: (item: ManagedLearningObject) => void; onEdit: () => void }) {
  const { t } = useI18n();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function run(action: "submit" | "publish" | "archive" | "reject") {
    setPending(true);
    setError("");
    try {
      const note = action === "reject" ? window.prompt(t("reviewNotePrompt")) ?? undefined : undefined;
      if (action === "reject" && !note) return;
      onUpdated(await contentAction(item, action, note));
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : t("genericError"));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="workflow-actions">
      <Button variant="secondary" disabled={pending} onClick={onEdit}>{t("editContent")}</Button>
      {item.workflow_status === "draft" || item.workflow_status === "rejected" ? <Button disabled={pending} onClick={() => void run("submit")}>{t("submitReview")}</Button> : null}
      {item.workflow_status === "in_review" ? <><Button disabled={pending} onClick={() => void run("publish")}>{t("publishContent")}</Button><Button variant="danger" disabled={pending} onClick={() => void run("reject")}>{t("requestChanges")}</Button></> : null}
      {item.workflow_status === "published" ? <Button variant="danger" disabled={pending} onClick={() => void run("archive")}>{t("archiveContent")}</Button> : null}
      {error ? <span className="inline-error" role="alert">{error}</span> : null}
    </div>
  );
}

export function ContentStudioPage() {
  const { t } = useI18n();
  const [items, setItems] = useState<ManagedLearningObject[] | null>(null);
  const [nodes, setNodes] = useState<EducationNode[]>([]);
  const [editing, setEditing] = useState<ManagedLearningObject | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(() => {
    const controller = new AbortController();
    void Promise.all([managedContent(controller.signal), managedNodes(controller.signal)])
      .then(([content, hierarchy]) => { setItems(content.results); setNodes(hierarchy.results); })
      .catch(() => setFailed(true));
    return () => controller.abort();
  }, []);

  useEffect(() => load(), [load]);

  function upsert(item: ManagedLearningObject) {
    setItems((current) => current ? [item, ...current.filter((entry) => entry.id !== item.id)] : [item]);
    setEditing(null);
  }

  return (
    <div className="page studio-page">
      <header className="page-heading page-heading--wide"><h1>{t("contentStudioTitle")}</h1><p>{t("contentStudioCopy")}</p></header>
      {failed ? <Alert><span>{t("genericError")}</span> <Button variant="secondary" onClick={() => { setFailed(false); load(); }}>{t("retry")}</Button></Alert> : null}
      <ContentEditor key={editing?.id ?? "new"} nodes={nodes} current={editing} onSaved={upsert} onCancel={() => setEditing(null)} />
      <section className="study-section" aria-labelledby="content-workflow-title">
        <header className="study-section__heading"><h2 id="content-workflow-title">{t("contentWorkflow")}</h2><span>{items?.length ?? 0}</span></header>
        {!items && !failed ? <PageSkeleton label={t("loadingContentStudio")} /> : items?.length === 0 ? <EmptyState title={t("noManagedContent")}>{t("noManagedContentCopy")}</EmptyState> : (
          <ul className="workflow-list">{items?.map((item) => <li key={item.id}><header><div><span className={`status-badge status-badge--${item.workflow_status}`}>{t(workflowLabels[item.workflow_status])}</span><h3>{item.current_version.title}</h3><p>{item.current_version.academic_node_title} · {item.current_version.content_type}</p></div><small>{t("versionLabel")} {item.current_version.version_number}</small></header>{item.review_note ? <p className="review-note">{item.review_note}</p> : null}<WorkflowActions item={item} onEdit={() => setEditing(item)} onUpdated={upsert} /></li>)}</ul>
        )}
      </section>
    </div>
  );
}
