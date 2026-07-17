import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { ApiError } from "../../api/client";
import { Button } from "../../components/Button";
import { Alert, EmptyState, PageSkeleton } from "../../components/Feedback";
import { useAuth } from "../auth/AuthProvider";
import { useI18n } from "../../i18n/I18nProvider";
import {
  comments,
  deleteComment,
  deleteDiscussion,
  discussion,
  nextComments
} from "./api";
import { AuthorLine } from "./components/AuthorLine";
import { CommentComposer } from "./components/CommentComposer";
import { ReportComposer } from "./components/ReportComposer";
import type { Comment, Discussion } from "./types";

export function DiscussionPage() {
  const { discussionId = "" } = useParams();
  const { user } = useAuth();
  const { t } = useI18n();
  const [item, setItem] = useState<Discussion | null>(null);
  const [replies, setReplies] = useState<Comment[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      discussion(discussionId, controller.signal),
      comments(discussionId, controller.signal)
    ]).then(([loadedDiscussion, page]) => {
      if (controller.signal.aborted) return;
      setItem(loadedDiscussion);
      setReplies(page.results);
      setNext(page.next);
    }).catch((caught) => {
      if (!controller.signal.aborted) {
        setError(caught instanceof ApiError ? caught.message : t("communityLoadError"));
      }
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [discussionId, t]);

  const threads = useMemo(() => replies.filter((reply) => !reply.parent_id).map((root) => ({
    root,
    children: replies.filter((reply) => reply.parent_id === root.id)
  })), [replies]);

  async function removeDiscussion() {
    if (!item || !window.confirm(t("communityDeleteConfirm"))) return;
    try {
      setItem(await deleteDiscussion(item));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : t("genericError"));
    }
  }

  async function removeComment(comment: Comment) {
    if (!window.confirm(t("communityDeleteReplyConfirm"))) return;
    try {
      const deleted = await deleteComment(comment);
      setReplies((current) => current.map((candidate) => candidate.id === deleted.id ? deleted : candidate));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : t("genericError"));
    }
  }

  async function loadMore() {
    if (!next) return;
    try {
      const page = await nextComments(next);
      setReplies((current) => [...current, ...page.results]);
      setNext(page.next);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : t("communityLoadError"));
    }
  }

  if (loading) return <PageSkeleton label={t("communityLoadingDiscussion")} />;
  if (!item) return <div className="page"><Alert>{error || t("communityLoadError")}</Alert></div>;
  const unavailable = !item.title || !item.body;
  const canReply = item.status === "active";

  return (
    <div className="page page--narrow discussion-page">
      <nav className="breadcrumbs" aria-label={t("breadcrumbs")}>
        <Link to="/community">{t("navCommunity")}</Link>
        <Link to={item.context_route}>{item.context_title}</Link>
      </nav>
      {error ? <Alert>{error}</Alert> : null}
      <article className="discussion-thread__opening">
        <p className="eyebrow">{item.space_title ?? t("communityPublicLearningDiscussion")}</p>
        <h1>{item.title ?? t("communityContentUnavailable")}</h1>
        <AuthorLine author={item.author} date={item.created_at} />
        {item.body ? <p className="discussion-thread__body">{item.body}</p> : <p className="community-tombstone">{t("communityContentUnavailableCopy")}</p>}
        <footer className="discussion-actions">
          {item.can_delete ? <Button variant="danger" onClick={() => void removeDiscussion()}>{t("communityDeleteOwn")}</Button> : null}
          {user?.id !== item.author.id && !unavailable ? <ReportComposer targetType="discussion" targetId={item.id} compact /> : null}
        </footer>
      </article>

      <section className="comment-section" aria-labelledby="community-replies-title">
        <header className="study-section__heading">
          <h2 id="community-replies-title">{t("communityReplies")}</h2>
          <span>{item.comment_count}</span>
        </header>
        {canReply ? (
          <CommentComposer
            discussionId={item.id}
            onCreated={(comment) => setReplies((current) => [...current, comment])}
          />
        ) : <p className="community-locked-note">{t("communityDiscussionLocked")}</p>}
        {threads.length ? (
          <ol className="comment-list">
            {threads.map(({ root, children }) => (
              <li key={root.id} className="comment-thread">
                <article className="comment-card">
                  <AuthorLine author={root.author} date={root.created_at} />
                  {root.body ? <p>{root.body}</p> : <p className="community-tombstone">{t("communityReplyUnavailable")}</p>}
                  <footer>
                    {canReply && root.body ? <Button variant="quiet" onClick={() => setReplyingTo(root.id)}>{t("communityReply")}</Button> : null}
                    {root.can_delete ? <Button variant="quiet" onClick={() => void removeComment(root)}>{t("communityDeleteOwn")}</Button> : null}
                    {user?.id !== root.author.id && root.body ? <ReportComposer targetType="comment" targetId={root.id} compact /> : null}
                  </footer>
                </article>
                {replyingTo === root.id ? (
                  <CommentComposer
                    discussionId={item.id}
                    parentId={root.id}
                    onCancel={() => setReplyingTo(null)}
                    onCreated={(comment) => setReplies((current) => [...current, comment])}
                  />
                ) : null}
                {children.length ? (
                  <ol className="comment-replies">
                    {children.map((child) => (
                      <li key={child.id}>
                        <article className="comment-card comment-card--reply">
                          <AuthorLine author={child.author} date={child.created_at} />
                          {child.body ? <p>{child.body}</p> : <p className="community-tombstone">{t("communityReplyUnavailable")}</p>}
                          <footer>
                            {child.can_delete ? <Button variant="quiet" onClick={() => void removeComment(child)}>{t("communityDeleteOwn")}</Button> : null}
                            {user?.id !== child.author.id && child.body ? <ReportComposer targetType="comment" targetId={child.id} compact /> : null}
                          </footer>
                        </article>
                      </li>
                    ))}
                  </ol>
                ) : null}
              </li>
            ))}
          </ol>
        ) : <EmptyState title={t("communityNoReplies")}>{t("communityNoRepliesCopy")}</EmptyState>}
        {next ? <Button variant="secondary" onClick={() => void loadMore()}>{t("communityLoadMoreReplies")}</Button> : null}
      </section>
    </div>
  );
}
