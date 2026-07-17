import { useCallback, useEffect, useState, type CSSProperties, type FormEvent } from "react";

import { ApiError } from "../../api/client";
import { Button } from "../../components/Button";
import { Alert, EmptyState, PageSkeleton } from "../../components/Feedback";
import { FormField, SelectField } from "../../components/FormField";
import { formValue } from "../../components/formValue";
import { useI18n } from "../../i18n/I18nProvider";
import type { MessageKey } from "../../i18n/catalogs";
import type { EducationNode } from "../learning/types";
import { adminUsers, createNode, creatorScopes, grantScope, managedNodes, revokeScope, setNodeStatus } from "./api";
import type { CreatorScope, ManagedUser } from "./types";

const nodeKinds: EducationNode["kind"][] = ["institution", "college", "department", "academic_year", "semester", "subject", "unit", "lesson"];
const nodeKindLabels: Record<EducationNode["kind"], MessageKey> = {
  institution: "node_institution",
  college: "node_college",
  department: "node_department",
  academic_year: "node_academic_year",
  semester: "node_semester",
  subject: "node_subject",
  unit: "node_unit",
  lesson: "node_lesson"
};

function NodeCreator({ nodes, onCreated }: { nodes: EducationNode[]; onCreated: (node: EducationNode) => void }) {
  const { t } = useI18n();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const data = new FormData(formElement);
    setPending(true);
    setMessage("");
    try {
      const node = await createNode({
        parent_id: formValue(data, "parent_id") || null,
        kind: formValue(data, "kind") as EducationNode["kind"],
        title: formValue(data, "title"),
        description: formValue(data, "description"),
        position: Number(data.get("position") || 0)
      });
      onCreated(node);
      formElement.reset();
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : t("genericError"));
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="admin-editor" onSubmit={(event) => void submit(event)}>
      <header><h2>{t("addHierarchyNode")}</h2><p>{t("addHierarchyCopy")}</p></header>
      <div className="studio-editor__grid">
        <SelectField name="parent_id" label={t("parentLocation")} defaultValue="">
          <option value="">{t("topLevel")}</option>
          {nodes.filter((node) => node.status !== "archived").map((node) => <option key={node.id} value={node.id}>{"—".repeat(node.depth)} {node.title}</option>)}
        </SelectField>
        <SelectField name="kind" label={t("hierarchyType")} defaultValue="subject">
          {nodeKinds.map((kind) => <option key={kind} value={kind}>{t(nodeKindLabels[kind])}</option>)}
        </SelectField>
        <FormField name="title" label={t("hierarchyTitle")} maxLength={180} required />
        <FormField name="position" label={t("displayOrder")} type="number" min={0} defaultValue={0} />
      </div>
      <div className="field"><label htmlFor="node-description">{t("hierarchyDescription")}</label><textarea id="node-description" name="description" rows={3} maxLength={4000} /></div>
      <Button type="submit" disabled={pending}>{pending ? t("saving") : t("saveHierarchyNode")}</Button>
      {message ? <p className="inline-error" role="alert">{message}</p> : null}
    </form>
  );
}

function ScopeManager({ users, nodes, scopes, onGranted, onRevoked }: { users: ManagedUser[]; nodes: EducationNode[]; scopes: CreatorScope[]; onGranted: (scope: CreatorScope) => void; onRevoked: (scopeId: string) => void }) {
  const { t } = useI18n();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const creators = users.filter((user) => user.roles.includes("creator") || user.roles.includes("administrator"));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setPending(true);
    setMessage("");
    try {
      onGranted(await grantScope({
        user_id: formValue(data, "user_id"),
        node_id: formValue(data, "node_id"),
        can_create_content: data.get("can_create_content") === "on",
        can_review_content: data.get("can_review_content") === "on",
        can_publish_content: data.get("can_publish_content") === "on",
        can_create_assessments: data.get("can_create_assessments") === "on",
        can_review_assessments: data.get("can_review_assessments") === "on",
        can_publish_assessments: data.get("can_publish_assessments") === "on",
        can_manage_hierarchy: data.get("can_manage_hierarchy") === "on"
      }));
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : t("genericError"));
    } finally {
      setPending(false);
    }
  }

  async function remove(scopeId: string) {
    setPending(true);
    setMessage("");
    try {
      await revokeScope(scopeId);
      onRevoked(scopeId);
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : t("genericError"));
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="scope-manager" aria-labelledby="scope-title">
      <header><h2 id="scope-title">{t("creatorScopes")}</h2><p>{t("creatorScopesCopy")}</p></header>
      <form onSubmit={(event) => void submit(event)}>
        <SelectField name="user_id" label={t("contentCreator")} required defaultValue=""><option value="" disabled>{t("chooseCreator")}</option>{creators.map((user) => <option key={user.id} value={user.id}>{user.full_name} · {user.email}</option>)}</SelectField>
        <SelectField name="node_id" label={t("scopeLocation")} required defaultValue=""><option value="" disabled>{t("chooseLearningLocation")}</option>{nodes.filter((node) => node.status !== "archived").map((node) => <option key={node.id} value={node.id}>{"—".repeat(node.depth)} {node.title}</option>)}</SelectField>
        <fieldset><legend>{t("capabilities")}</legend>
          <label className="check-control"><input type="checkbox" name="can_create_content" defaultChecked /><span>{t("canCreateContent")}</span></label>
          <label className="check-control"><input type="checkbox" name="can_review_content" /><span>{t("canReviewContent")}</span></label>
          <label className="check-control"><input type="checkbox" name="can_publish_content" /><span>{t("canPublishContent")}</span></label>
          <label className="check-control"><input type="checkbox" name="can_create_assessments" /><span>{t("canCreateAssessments")}</span></label>
          <label className="check-control"><input type="checkbox" name="can_review_assessments" /><span>{t("canReviewAssessments")}</span></label>
          <label className="check-control"><input type="checkbox" name="can_publish_assessments" /><span>{t("canPublishAssessments")}</span></label>
          <label className="check-control"><input type="checkbox" name="can_manage_hierarchy" /><span>{t("canManageHierarchy")}</span></label>
        </fieldset>
        <Button type="submit" disabled={pending || !creators.length}>{t("grantScope")}</Button>
      </form>
      {message ? <p className="inline-error" role="alert">{message}</p> : null}
      {scopes.length ? <ul className="scope-list">{scopes.map((scope) => <li key={scope.id}><div><strong>{scope.user_name}</strong><span>{scope.node_title}</span></div><span>{[
        scope.can_create_content && t("createShort"),
        scope.can_review_content && t("reviewShort"),
        scope.can_publish_content && t("publishShort"),
        scope.can_create_assessments && t("assessmentCreateShort"),
        scope.can_review_assessments && t("assessmentReviewShort"),
        scope.can_publish_assessments && t("assessmentPublishShort"),
        scope.can_manage_hierarchy && t("hierarchyShort")
      ].filter(Boolean).join(" · ")}</span><Button variant="quiet" disabled={pending} onClick={() => void remove(scope.id)}>{t("revokeScope")}</Button></li>)}</ul> : <EmptyState title={t("noCreatorScopes")}>{t("noCreatorScopesCopy")}</EmptyState>}
    </section>
  );
}

export function EducationAdminPage() {
  const { t } = useI18n();
  const [nodes, setNodes] = useState<EducationNode[] | null>(null);
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [scopes, setScopes] = useState<CreatorScope[]>([]);
  const [failed, setFailed] = useState(false);
  const [actionError, setActionError] = useState("");
  const load = useCallback(() => {
    const controller = new AbortController();
    void Promise.all([managedNodes(controller.signal), adminUsers(controller.signal), creatorScopes(controller.signal)])
      .then(([hierarchy, people, permissions]) => { setNodes(hierarchy.results); setUsers(people.results); setScopes(permissions.scopes); })
      .catch(() => setFailed(true));
    return () => controller.abort();
  }, []);

  useEffect(() => load(), [load]);

  async function changeStatus(node: EducationNode, status: "published" | "archived") {
    setActionError("");
    try {
      const updated = await setNodeStatus(node, status);
      setNodes((current) => current?.map((entry) => entry.id === updated.id ? updated : entry) ?? []);
    } catch (error) {
      setActionError(error instanceof ApiError ? error.message : t("genericError"));
    }
  }

  return (
    <div className="page education-admin-page">
      <header className="page-heading page-heading--wide"><h1>{t("educationAdminTitle")}</h1><p>{t("educationAdminCopy")}</p></header>
      {failed ? <Alert><span>{t("genericError")}</span> <Button variant="secondary" onClick={() => { setFailed(false); load(); }}>{t("retry")}</Button></Alert> : null}
      {!nodes && !failed ? <PageSkeleton label={t("loadingHierarchy")} /> : nodes ? <>
        <NodeCreator nodes={nodes} onCreated={(node) => setNodes((current) => [...(current ?? []), node])} />
        <section className="study-section" aria-labelledby="hierarchy-title">
          <header className="study-section__heading"><h2 id="hierarchy-title">{t("learningHierarchy")}</h2><span>{nodes.length}</span></header>
          {actionError ? <p className="inline-error" role="alert">{actionError}</p> : null}
          {nodes.length ? <ul className="hierarchy-list">{nodes.map((node) => <li key={node.id} style={{ "--node-depth": node.depth } as CSSProperties}><div><span className="resource-type">{t(nodeKindLabels[node.kind])}</span><strong>{node.title}</strong><small>{node.status}</small></div>{node.status === "draft" ? <Button variant="secondary" onClick={() => void changeStatus(node, "published")}>{t("publishNode")}</Button> : node.status === "published" ? <Button variant="quiet" onClick={() => void changeStatus(node, "archived")}>{t("archiveNode")}</Button> : null}</li>)}</ul> : <EmptyState title={t("noHierarchy")}>{t("noHierarchyCopy")}</EmptyState>}
        </section>
        <ScopeManager users={users} nodes={nodes} scopes={scopes} onGranted={(scope) => setScopes((current) => [scope, ...current.filter((entry) => entry.id !== scope.id)])} onRevoked={(scopeId) => setScopes((current) => current.filter((scope) => scope.id !== scopeId))} />
      </> : null}
    </div>
  );
}
