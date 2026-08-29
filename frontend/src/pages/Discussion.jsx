import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { communityApi } from "../api/community.js";
import { isApiError } from "../api/client.js";
import { generateIdempotencyKey } from "../api/pagination.js";
import { Icon } from "../lib/icons.jsx";
import { relativeTime } from "../lib/utils.js";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { EmptyState, ErrorPanel, LoadingPanel, Page } from "../components/ui/index.jsx";
import { ConfirmDialog } from "../components/shared/ConfirmDialog.jsx";
import { MutationNotice, ReportComposer, contextPath, fieldError } from "../components/community/index.jsx";

function mergeById(current, next) {
  const ids = new Set(current.map((item) => item.id));
  return [...current, ...next.filter((item) => !ids.has(item.id))];
}

function authorName(author) {
  return typeof author?.full_name === "string" && author.full_name ? author.full_name : "Community member";
}

function metaTime(value) {
  return typeof value === "string" && value ? relativeTime(value) : "Recently";
}

async function loadDiscussion(discussionId) {
  const [discussion, commentFeed] = await Promise.all([
    communityApi.getDiscussion(discussionId),
    communityApi.listComments(discussionId)
  ]);
  return { discussion, commentFeed };
}

export default function Discussion({ user }) {
  const { discussionId = "" } = useParams();
  const detail = useAsyncData(() => loadDiscussion(discussionId), [discussionId]);
  const [discussion, setDiscussion] = useState(null);
  const [comments, setComments] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [actionMessage, setActionMessage] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const [editingDiscussion, setEditingDiscussion] = useState(false);
  const [discussionDraft, setDiscussionDraft] = useState({ title: "", body: "" });
  const [editingCommentId, setEditingCommentId] = useState("");
  const [commentDraft, setCommentDraft] = useState("");
  const [replyingTo, setReplyingTo] = useState("");
  const [pending, setPending] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(null);

  useEffect(() => {
    if (!detail.data) return;
    setDiscussion(detail.data.discussion);
    setComments(detail.data.commentFeed.results);
    setNextCursor(detail.data.commentFeed.nextCursor);
    setActionError(null);
  }, [detail.data]);

  const threads = useMemo(() => {
    const roots = comments.filter((comment) => !comment.parent_id);
    return roots.map((root) => ({ root, replies: comments.filter((comment) => comment.parent_id === root.id) }));
  }, [comments]);

  async function reloadAfterConflict(message) {
    setActionMessage(message);
    detail.reload();
  }

  function handleMutationError(error, conflictMessage) {
    setActionError(error);
    if (isApiError(error) && error.status === 409) {
      void reloadAfterConflict(conflictMessage);
    }
  }

  async function saveDiscussion(event) {
    event.preventDefault();
    if (!discussion || pending) return;
    setPending("discussion");
    setActionError(null);
    try {
      const updated = await communityApi.updateDiscussion(discussion.id, {
        expectedRevision: discussion.revision,
        title: discussionDraft.title,
        body: discussionDraft.body
      });
      setDiscussion(updated);
      setEditingDiscussion(false);
      setActionMessage("Your server-saved discussion was updated.");
    } catch (error) {
      handleMutationError(error, "This discussion changed elsewhere. The latest server version is loading.");
    } finally {
      setPending("");
    }
  }

  async function saveComment(commentId) {
    const comment = comments.find((item) => item.id === commentId);
    if (!comment || pending) return;
    setPending(commentId);
    setActionError(null);
    try {
      const updated = await communityApi.updateComment(commentId, { expectedRevision: comment.revision, body: commentDraft });
      setComments((current) => current.map((item) => item.id === commentId ? updated : item));
      setEditingCommentId("");
      setCommentDraft("");
      setActionMessage("Your server-saved reply was updated.");
    } catch (error) {
      handleMutationError(error, "This reply changed elsewhere. The latest server version is loading.");
    } finally {
      setPending("");
    }
  }

  async function removeTarget() {
    if (!confirmDelete || pending) return;
    setPending(confirmDelete.type === "discussion" ? "discussion-delete" : confirmDelete.id);
    setActionError(null);
    try {
      if (confirmDelete.type === "discussion") {
        const deleted = await communityApi.deleteDiscussion(discussion.id, discussion.revision);
        setDiscussion(deleted);
      } else {
        const deleted = await communityApi.deleteComment(confirmDelete.id, confirmDelete.revision);
        setComments((current) => current.map((item) => item.id === deleted.id ? deleted : item));
        const freshDiscussion = await communityApi.getDiscussion(discussionId);
        setDiscussion(freshDiscussion);
      }
      setConfirmDelete(null);
      setActionMessage("The server recorded this removal.");
    } catch (error) {
      handleMutationError(error, "This item changed elsewhere. The latest server version is loading.");
    } finally {
      setPending("");
    }
  }

  async function createComment({ body, parentId = null, clientRequestId, onDone }) {
    if (!discussion || pending) return;
    setPending("comment-create");
    setActionError(null);
    try {
      const created = await communityApi.createComment(discussion.id, { parentId, body, clientRequestId });
      setComments((current) => mergeById(current, [created]));
      const freshDiscussion = await communityApi.getDiscussion(discussion.id);
      setDiscussion(freshDiscussion);
      setReplyingTo("");
      setActionMessage("Your reply was saved.");
      onDone?.();
    } catch (error) {
      handleMutationError(error, "This discussion changed elsewhere. The latest server version is loading.");
      throw error;
    } finally {
      setPending("");
    }
  }

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setActionError(null);
    try {
      const page = await communityApi.listComments(discussionId, { cursor: nextCursor });
      setComments((current) => mergeById(current, page.results));
      setNextCursor(page.nextCursor);
    } catch (error) {
      setActionError(error);
    } finally {
      setLoadingMore(false);
    }
  }

  if (detail.loading) return <LoadingPanel />;
  if (detail.error || !discussion) return <ErrorPanel message={detail.error || "This discussion could not be loaded."} onRetry={detail.reload} />;

  const deleted = !discussion.title || !discussion.body;
  const canReply = discussion.status === "active";
  const contextUrl = contextPath(discussion.context_type, discussion.context_id);

  return (
    <Page title={discussion.title || "Discussion unavailable"} subtitle="A contextual discussion and its replies.">
      <MutationNotice error={actionError} message={actionMessage} onRetry={detail.reload} />
      <section className="community-top">
        <article className="panel community-composer">
          <p className="eyebrow">{discussion.space_title || "Learning discussion"}</p>
          {!editingDiscussion ? <>
            <h2>{discussion.title || "This discussion is no longer available"}</h2>
            <div className="post-meta"><strong>{authorName(discussion.author)}</strong><small>{metaTime(discussion.updated_at || discussion.created_at)}</small><span>Revision {discussion.revision}</span></div>
            <p>{discussion.body || "The author or a moderator removed this discussion. Its original text is not displayed."}</p>
            <div className="focus-timer-actions">
              {discussion.can_edit && !deleted && <button className="btn btn-soft" type="button" onClick={() => { setDiscussionDraft({ title: discussion.title, body: discussion.body }); setEditingDiscussion(true); }}>Edit</button>}
              {discussion.can_delete && !deleted && <button className="btn btn-danger" type="button" disabled={pending === "discussion-delete"} onClick={() => setConfirmDelete({ type: "discussion", id: discussion.id, revision: discussion.revision })}>Delete</button>}
              {!deleted && discussion.author?.id !== user?.id && <ReportComposer targetType="discussion" targetId={discussion.id} onCreated={(report) => setActionMessage(`Report submitted. Its current status is ${report.status}.`)} />}
            </div>
          </> : <form className="composer-form" onSubmit={saveDiscussion}>
            <label className="field"><span>Discussion title</span><input value={discussionDraft.title} maxLength={220} required onChange={(event) => setDiscussionDraft((current) => ({ ...current, title: event.target.value }))} /></label>
            {fieldError(actionError, "title") && <p className="inline-error">{fieldError(actionError, "title")}</p>}
            <label className="field"><span>Discussion text</span><textarea value={discussionDraft.body} maxLength={10000} required onChange={(event) => setDiscussionDraft((current) => ({ ...current, body: event.target.value }))} /></label>
            {fieldError(actionError, "body") && <p className="inline-error">{fieldError(actionError, "body")}</p>}
            <div className="focus-timer-actions"><button className="btn btn-primary" type="submit" disabled={pending === "discussion"}>{pending === "discussion" ? "Saving…" : "Save changes"}</button><button className="btn btn-soft" type="button" disabled={pending === "discussion"} onClick={() => setEditingDiscussion(false)}>Cancel</button></div>
          </form>}
        </article>
        <article className="panel announcement-panel"><div className="panel-title"><h2>Discussion context</h2><span>{discussion.comment_count || 0} replies</span></div><div className="announcement-list"><article className="announcement-item"><span className="stat-icon"><Icon name="book-open" /></span><div><h3>{discussion.context_title || "Learning context"}</h3><p>{discussion.context_type?.replaceAll("_", " ") || "Contextual discussion"}</p><Link className="text-link" to={contextUrl}>View context discussions</Link></div></article>{discussion.space_id && <article className="announcement-item"><span className="stat-icon"><Icon name="lock" /></span><div><h3>{discussion.space_title || "Creator space"}</h3><Link className="text-link" to={`/community/spaces/${discussion.space_id}`}>Open space</Link></div></article>}</div></article>
      </section>
      <section className="panel community-post-list">
        <div className="panel-title"><h2>Replies</h2><span>{discussion.comment_count || 0}</span></div>
        {canReply && <CommentComposer onSubmit={createComment} pending={pending === "comment-create"} />}
        {!canReply && <p className="save-hint">This discussion is not accepting replies.</p>}
        {threads.length ? threads.map(({ root, replies }) => <CommentThread key={root.id} comment={root} replies={replies} canReply={canReply} user={user} editingCommentId={editingCommentId} commentDraft={commentDraft} setCommentDraft={setCommentDraft} setEditingCommentId={setEditingCommentId} replyingTo={replyingTo} setReplyingTo={setReplyingTo} pending={pending} actionError={actionError} onSave={saveComment} onDelete={(comment) => setConfirmDelete({ type: "comment", id: comment.id, revision: comment.revision })} onCreateReply={createComment} onReport={(report) => setActionMessage(`Report submitted. Its current status is ${report.status}.`)} />) : <EmptyState title="No replies yet" text="No replies are visible to your account." />}
        {nextCursor && <button className="btn btn-soft" type="button" disabled={loadingMore} onClick={() => { void loadMore(); }}>{loadingMore ? "Loading…" : "Load more replies"}</button>}
      </section>
      <ConfirmDialog open={Boolean(confirmDelete)} title={confirmDelete?.type === "discussion" ? "Delete this discussion?" : "Delete this reply?"} message="Lock-in will retain a tombstone instead of exposing the removed text." confirmLabel={pending ? "Removing…" : "Delete"} onConfirm={() => { void removeTarget(); }} onCancel={() => !pending && setConfirmDelete(null)} />
    </Page>
  );
}

function CommentComposer({ onSubmit, parentId = null, onCancel = null, pending = false }) {
  const [body, setBody] = useState("");
  const [error, setError] = useState(null);
  const [clientRequestId, setClientRequestId] = useState(generateIdempotencyKey);

  async function submit(event) {
    event.preventDefault();
    setError(null);
    try {
      await onSubmit({ body, parentId, clientRequestId, onDone: () => { setBody(""); setClientRequestId(generateIdempotencyKey()); } });
    } catch (requestError) {
      setError(requestError);
    }
  }

  return <form className="composer-form" onSubmit={submit}><label className="field"><span>{parentId ? "Reply" : "Add a reply"}</span><textarea value={body} maxLength={6000} required onChange={(event) => setBody(event.target.value)} placeholder="Write a respectful, context-specific reply..." /></label><MutationNotice error={error} />{onCancel ? <div className="focus-timer-actions"><button className="btn btn-primary" type="submit" disabled={pending}>{pending ? "Saving…" : "Reply"}</button><button className="btn btn-soft" type="button" disabled={pending} onClick={onCancel}>Cancel</button></div> : <button className="btn btn-primary" type="submit" disabled={pending}>{pending ? "Saving…" : "Post reply"}</button>}</form>;
}

function CommentThread({ comment, replies, canReply, user, editingCommentId, commentDraft, setCommentDraft, setEditingCommentId, replyingTo, setReplyingTo, pending, actionError, onSave, onDelete, onCreateReply, onReport }) {
  return <article className="community-post"><div className="post-avatar">{authorName(comment.author).slice(0, 1).toUpperCase()}</div><div><div className="post-meta"><strong>{authorName(comment.author)}</strong><small>{metaTime(comment.updated_at || comment.created_at)}</small><span>Revision {comment.revision}</span></div>{editingCommentId === comment.id ? <form className="composer-form" onSubmit={(event) => { event.preventDefault(); void onSave(comment.id); }}><label className="field"><span>Edit reply</span><textarea value={commentDraft} maxLength={6000} required onChange={(event) => setCommentDraft(event.target.value)} /></label>{fieldError(actionError, "body") && <p className="inline-error">{fieldError(actionError, "body")}</p>}<div className="focus-timer-actions"><button className="btn btn-primary" type="submit" disabled={pending === comment.id}>{pending === comment.id ? "Saving…" : "Save"}</button><button className="btn btn-soft" type="button" disabled={pending === comment.id} onClick={() => setEditingCommentId("")}>Cancel</button></div></form> : <><p>{comment.body || "The author or a moderator removed this reply. Its original text is not displayed."}</p><div className="post-actions">{canReply && comment.body && !comment.parent_id && <button className="btn btn-soft compact" type="button" onClick={() => setReplyingTo(comment.id)}>Reply</button>}{comment.can_edit && comment.body && <button className="btn btn-soft compact" type="button" onClick={() => { setEditingCommentId(comment.id); setCommentDraft(comment.body); }}>Edit</button>}{comment.can_delete && comment.body && <button className="btn btn-danger compact" type="button" disabled={pending === comment.id} onClick={() => onDelete(comment)}>Delete</button>}{comment.body && comment.author?.id !== user?.id && <ReportComposer targetType="comment" targetId={comment.id} onCreated={onReport} />}</div></>}{replyingTo === comment.id && <CommentComposer parentId={comment.id} pending={pending === "comment-create"} onSubmit={onCreateReply} onCancel={() => setReplyingTo("")} />}{replies.length ? <div className="list-panel">{replies.map((reply) => <CommentThread key={reply.id} comment={reply} replies={[]} canReply={false} user={user} editingCommentId={editingCommentId} commentDraft={commentDraft} setCommentDraft={setCommentDraft} setEditingCommentId={setEditingCommentId} replyingTo="" setReplyingTo={setReplyingTo} pending={pending} actionError={actionError} onSave={onSave} onDelete={onDelete} onCreateReply={onCreateReply} onReport={onReport} />)}</div> : null}</div></article>;
}
