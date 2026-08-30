import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { communityApi } from "../api/community.js";
import { Icon } from "../lib/icons.jsx";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { EmptyState, ErrorPanel, LoadingPanel, Page } from "../components/ui/index.jsx";
import { CommunityContextLink, DiscussionCard, DiscussionComposer, SpaceMemberForm } from "../components/community/index.jsx";
import { useI18n } from "../components/I18nProvider.jsx";

function mergeById(current, next) {
  const ids = new Set(current.map((item) => item.id));
  return [...current, ...next.filter((item) => !ids.has(item.id))];
}

async function loadSpace(spaceId) {
  const [space, discussionFeed] = await Promise.all([
    communityApi.getSpace(spaceId),
    communityApi.listDiscussions({ spaceId })
  ]);
  return { space, discussionFeed };
}

export default function CommunitySpace() {
  const { t } = useI18n();
  const { spaceId = "" } = useParams();
  const spaceData = useAsyncData(() => loadSpace(spaceId), [spaceId]);
  const [space, setSpace] = useState(null);
  const [discussions, setDiscussions] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [actionError, setActionError] = useState("");

  useEffect(() => {
    if (!spaceData.data) return;
    setSpace(spaceData.data.space);
    setDiscussions(spaceData.data.discussionFeed.results);
    setNextCursor(spaceData.data.discussionFeed.nextCursor);
    setActionError("");
  }, [spaceData.data]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setActionError("");
    try {
      const page = await communityApi.listDiscussions({ spaceId, cursor: nextCursor });
      setDiscussions((current) => mergeById(current, page.results));
      setNextCursor(page.nextCursor);
    } catch (error) {
      setActionError(error.message || t("community.spaceMoreError"));
    } finally {
      setLoadingMore(false);
    }
  }

  if (spaceData.loading) return <LoadingPanel />;
  if (spaceData.error || !space) return <ErrorPanel message={spaceData.error || t("community.spaceLoadError")} onRetry={spaceData.reload} />;

  return (
    <Page title={space.title} subtitle={t("community.spaceSubtitle")}>
      {actionError && <ErrorPanel message={actionError} onRetry={spaceData.reload} />}
      <section className="community-top">
        <article className="panel community-composer">
          <p className="eyebrow">{t("community.privateCreatorSpace")}</p>
          <h2 dir="auto">{space.title}</h2>
          <p dir="auto">{space.description || t("community.spaceFallbackDesc")}</p>
          <div className="post-meta"><span dir="auto">{t("community.memberCount", { count: space.member_count || 0 })}</span><span dir="auto">{space.membership_role || t("community.visibleMember")}</span><small dir="auto">{space.status}</small></div>
          <CommunityContextLink contextType={space.context_type} contextId={space.context_id} className="btn btn-soft"><Icon name="book-open" size={16} /> {t("community.viewLearningContext")}</CommunityContextLink>
        </article>
        <article className="panel announcement-panel">
          <div className="panel-title"><h2>{t("community.startSpaceDiscussion")}</h2><span><Icon name="messages" size={16} /></span></div>
          {space.status === "active" ? <DiscussionComposer contextType={space.context_type} contextId={space.context_id} spaceId={space.id} onCreated={(created) => setDiscussions((current) => [created, ...current])} /> : <p className="save-hint">{t("community.spaceClosed")}</p>}
        </article>
      </section>
      <section className="community-grid">
        <article className="panel community-post-list"><div className="panel-title"><h2>{t("community.spaceDiscussions")}</h2><span>{discussions.length}</span></div>{discussions.length ? discussions.map((discussion) => <DiscussionCard key={discussion.id} discussion={discussion} />) : <EmptyState title={t("community.noSpaceDiscussionsTitle")} text={t("community.noSpaceDiscussionsText")} />}{nextCursor && <button className="btn btn-soft" type="button" disabled={loadingMore} onClick={() => { void loadMore(); }}>{t(loadingMore ? "notifications.loadingMore" : "community.loadMoreDiscussions")}</button>}</article>
        {space.can_manage && <aside className="community-rail"><article className="study-buddy-card"><div><p className="eyebrow">{t("community.spaceMembership")}</p><h2>{t("community.inviteMember")}</h2><p>{t("community.inviteNote")}</p></div><SpaceMemberForm spaceId={space.id} onChanged={spaceData.reload} /></article></aside>}
      </section>
    </Page>
  );
}
