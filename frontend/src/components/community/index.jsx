import { useState } from "react";
import { Link } from "react-router-dom";
import { COMMUNITY_CONTEXT_TYPES, REPORT_REASONS, SPACE_CONTEXT_TYPES, SPACE_MEMBER_ROLES, communityApi, moderationApi } from "../../api/community.js";
import { generateIdempotencyKey } from "../../api/pagination.js";
import { Icon } from "../../lib/icons.jsx";
import { relativeTime } from "../../lib/utils.js";
import { useI18n } from "../I18nProvider.jsx";

export function contextPath(contextType, contextId) {
  return COMMUNITY_CONTEXT_TYPES.includes(contextType) && typeof contextId === "string" && contextId
    ? `/community/context/${contextType}/${contextId}`
    : "/community";
}

export function fieldError(error, field) {
  const value = error?.fields?.[field];
  if (Array.isArray(value)) return value.find((item) => typeof item === "string") || "";
  return typeof value === "string" ? value : "";
}

function authorName(author, t) {
  return typeof author?.full_name === "string" && author.full_name ? author.full_name : t("community.member");
}

function detailTime(value, t) {
  return typeof value === "string" && value ? relativeTime(value) : t("community.recently");
}

function humanize(value, fallback = "Unavailable") {
  return typeof value === "string" && value ? value.replaceAll("_", " ") : fallback;
}

export function CommunityContextLink({ contextType, contextId, children, className = "" }) {
  return <Link className={className} to={contextPath(contextType, contextId)}>{children}</Link>;
}

export function DiscussionCard({ discussion, compact = false }) {
  const { t } = useI18n();
  const title = discussion?.title || t("community.discussionGone");
  const body = discussion?.body || t("community.discussionRemoved");
  const badges = Array.isArray(discussion?.author?.badges) ? discussion.author.badges : [];

  return (
    <article className="community-post">
      <div className="post-avatar">{authorName(discussion?.author, t).slice(0, 1).toUpperCase()}</div>
      <div>
        <div className="post-meta">
          <strong dir="auto">{authorName(discussion?.author, t)}</strong>
          {badges.map((badge) => <span key={badge} dir="auto">{humanize(badge)}</span>)}
          <small dir="auto">{detailTime(discussion?.last_activity_at || discussion?.created_at, t)}</small>
        </div>
        <h3 dir="auto">{title}</h3>
        {!compact && <p dir="auto">{body}</p>}
        <div className="post-actions">
          <span dir="auto"><Icon name="messages" size={16} /> {t("community.replyCount", { count: Number(discussion?.comment_count) || 0 })}</span>
          {discussion?.space_title && <span dir="auto"><Icon name="lock" size={15} /> {discussion.space_title}</span>}
          <CommunityContextLink contextType={discussion?.context_type} contextId={discussion?.context_id} className="btn btn-soft compact">
            {t("community.context")}
          </CommunityContextLink>
          <Link className="btn btn-soft compact" to={`/community/discussions/${discussion?.id}`}>{t("common.open")}</Link>
        </div>
      </div>
    </article>
  );
}

export function MutationNotice({ error = null, message = "", onRetry = null }) {
  const { t } = useI18n();
  if (!error && !message) return null;
  if (error) {
    return <p className="form-alert error" role="alert" dir="auto">{error.message || t("community.actionFailed")}{onRetry && <button className="text-link" type="button" onClick={onRetry}>{t("common.tryAgain")}</button>}</p>;
  }
  return <p className="form-alert success" role="status" dir="auto">{message}</p>;
}

export function DiscussionComposer({ contextType, contextId, spaceId = null, onCreated }) {
  const { t } = useI18n();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const [clientRequestId, setClientRequestId] = useState(generateIdempotencyKey);

  const ready = COMMUNITY_CONTEXT_TYPES.includes(contextType) && typeof contextId === "string" && contextId;

  async function submit(event) {
    event.preventDefault();
    if (!ready || pending) return;
    setPending(true);
    setError(null);
    try {
      const created = await communityApi.createDiscussion({ contextType, contextId, spaceId, title, body, clientRequestId });
      setTitle("");
      setBody("");
      setClientRequestId(generateIdempotencyKey());
      onCreated?.(created);
    } catch (requestError) {
      setError(requestError);
    } finally {
      setPending(false);
    }
  }

  if (!ready) {
    return <p className="save-hint">{t("community.chooseContext")}</p>;
  }

  return (
    <form className="composer-form" onSubmit={submit}>
      <label className="field"><span>{t("community.discussionTitle")}</span><input value={title} maxLength={220} required onChange={(event) => setTitle(event.target.value)} aria-describedby={fieldError(error, "title") ? "discussion-title-error" : undefined} /></label>
      {fieldError(error, "title") && <p className="inline-error" id="discussion-title-error" dir="auto">{fieldError(error, "title")}</p>}
      <label className="field"><span>{t("community.questionOrNote")}</span><textarea value={body} maxLength={10000} required onChange={(event) => setBody(event.target.value)} placeholder={t("community.bodyPlaceholder")} aria-describedby={fieldError(error, "body") ? "discussion-body-error" : undefined} /></label>
      {fieldError(error, "body") && <p className="inline-error" id="discussion-body-error" dir="auto">{fieldError(error, "body")}</p>}
      <MutationNotice error={error} />
      <button className="btn btn-primary" type="submit" disabled={pending}>{t(pending ? "community.posting" : "community.startDiscussion")}</button>
    </form>
  );
}

export function SpaceComposer({ contextType, contextId, onCreated }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const canCreate = SPACE_CONTEXT_TYPES.includes(contextType) && typeof contextId === "string" && contextId;

  async function submit(event) {
    event.preventDefault();
    if (!canCreate || pending) return;
    setPending(true);
    setError(null);
    try {
      const created = await communityApi.createSpace({ contextType, contextId, title, description });
      setTitle("");
      setDescription("");
      setOpen(false);
      onCreated?.(created);
    } catch (requestError) {
      setError(requestError);
    } finally {
      setPending(false);
    }
  }

  if (!canCreate) return null;
  if (!open) return <button className="btn btn-soft" type="button" onClick={() => setOpen(true)}><Icon name="plus" size={16} /> {t("community.createSpace")}</button>;

  return (
    <form className="composer-form" onSubmit={submit}>
      <label className="field"><span>{t("community.spaceName")}</span><input value={title} maxLength={180} required onChange={(event) => setTitle(event.target.value)} /></label>
      {fieldError(error, "title") && <p className="inline-error" dir="auto">{fieldError(error, "title")}</p>}
      <label className="field"><span>{t("community.descriptionOptional")}</span><textarea value={description} maxLength={4000} onChange={(event) => setDescription(event.target.value)} /></label>
      {fieldError(error, "description") && <p className="inline-error" dir="auto">{fieldError(error, "description")}</p>}
      <MutationNotice error={error} />
      <div className="focus-timer-actions"><button className="btn btn-primary" type="submit" disabled={pending}>{t(pending ? "community.creating" : "community.createSpace")}</button><button className="btn btn-soft" type="button" disabled={pending} onClick={() => setOpen(false)}>{t("common.cancel")}</button></div>
    </form>
  );
}

export function ReportComposer({ targetType, targetId, onCreated }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("spam");
  const [description, setDescription] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const [clientRequestId, setClientRequestId] = useState(generateIdempotencyKey);

  async function submit(event) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const created = await moderationApi.createReport({ targetType, targetId, reason, description, clientRequestId });
      setDescription("");
      setOpen(false);
      setClientRequestId(generateIdempotencyKey());
      onCreated?.(created);
    } catch (requestError) {
      setError(requestError);
    } finally {
      setPending(false);
    }
  }

  if (!open) return <button className="btn btn-soft compact" type="button" onClick={() => setOpen(true)}>{t("community.report")}</button>;
  return (
    <form className="composer-form" onSubmit={submit}>
      <label className="field"><span>{t("community.reason")}</span><select value={reason} onChange={(event) => setReason(event.target.value)}>{REPORT_REASONS.map((option) => <option value={option} key={option}>{humanize(option)}</option>)}</select></label>
      {fieldError(error, "reason") && <p className="inline-error" dir="auto">{fieldError(error, "reason")}</p>}
      <label className="field"><span>{t("community.whatHappened")}</span><textarea value={description} minLength={10} maxLength={4000} required onChange={(event) => setDescription(event.target.value)} /></label>
      {fieldError(error, "description") && <p className="inline-error" dir="auto">{fieldError(error, "description")}</p>}
      <MutationNotice error={error} />
      <div className="focus-timer-actions"><button className="btn btn-primary" type="submit" disabled={pending}>{t(pending ? "community.sending" : "community.sendReport")}</button><button className="btn btn-soft" type="button" disabled={pending} onClick={() => setOpen(false)}>{t("common.cancel")}</button></div>
    </form>
  );
}

export function EditableText({ label, value, maxLength, onSave, onCancel, saving, error }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(value || "");
  return (
    <form className="composer-form" onSubmit={(event) => { event.preventDefault(); onSave?.(draft); }}>
      <label className="field"><span>{label}</span><textarea value={draft} maxLength={maxLength} required onChange={(event) => setDraft(event.target.value)} /></label>
      <MutationNotice error={error} />
      <div className="focus-timer-actions"><button className="btn btn-primary" type="submit" disabled={saving}>{t(saving ? "community.saving" : "community.save")}</button><button className="btn btn-soft" type="button" disabled={saving} onClick={onCancel}>{t("common.cancel")}</button></div>
    </form>
  );
}

export function SpaceMemberForm({ spaceId, onChanged }) {
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const [addedMember, setAddedMember] = useState(null);

  async function invite(event) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const membership = await communityApi.addSpaceMember(spaceId, { email, role });
      setEmail("");
      setAddedMember(membership);
      onChanged?.();
    } catch (requestError) {
      setError(requestError);
    } finally {
      setPending(false);
    }
  }

  async function revokeNewest() {
    if (!addedMember?.user_id || pending) return;
    setPending(true);
    setError(null);
    try {
      await communityApi.removeSpaceMember(spaceId, addedMember.user_id);
      setAddedMember(null);
      onChanged?.();
    } catch (requestError) {
      setError(requestError);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="composer-form">
      <form onSubmit={invite}>
        <label className="field"><span>{t("community.universityEmail")}</span><input type="email" value={email} required autoComplete="off" onChange={(event) => setEmail(event.target.value)} /></label>
        {fieldError(error, "email") && <p className="inline-error" dir="auto">{fieldError(error, "email")}</p>}
        <label className="field"><span>{t("community.membershipRole")}</span><select value={role} onChange={(event) => setRole(event.target.value)}>{SPACE_MEMBER_ROLES.map((option) => <option value={option} key={option}>{humanize(option)}</option>)}</select></label>
        {fieldError(error, "role") && <p className="inline-error" dir="auto">{fieldError(error, "role")}</p>}
        <MutationNotice error={error} />
        <button className="btn btn-primary" type="submit" disabled={pending}>{t(pending ? "community.saving" : "community.addMember")}</button>
      </form>
      {addedMember?.user_id && <div className="focus-timer-actions"><span className="pill">{t("community.memberAdded")}</span><button className="btn btn-danger compact" type="button" disabled={pending} onClick={() => { void revokeNewest(); }}><Icon name="x" size={15} /> {t("community.revokeInvite")}</button></div>}
      <p className="save-hint">{t("community.memberListNote")}</p>
    </div>
  );
}

export function statusText(value) {
  return humanize(value, "Pending");
}
