import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { communityApi } from "../api/community.js";
import { Icon } from "../lib/icons.jsx";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { EmptyState, ErrorPanel, LoadingPanel, Page } from "../components/ui/index.jsx";
import { CommunityContextLink, DiscussionCard, DiscussionComposer, SpaceMemberForm } from "../components/community/index.jsx";

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
      setActionError(error.message || "More space discussions could not be loaded.");
    } finally {
      setLoadingMore(false);
    }
  }

  if (spaceData.loading) return <LoadingPanel />;
  if (spaceData.error || !space) return <ErrorPanel message={spaceData.error || "This creator space could not be loaded."} onRetry={spaceData.reload} />;

  return (
    <Page title={space.title} subtitle="A creator space with private membership and contextual discussion.">
      {actionError && <ErrorPanel message={actionError} onRetry={spaceData.reload} />}
      <section className="community-top">
        <article className="panel community-composer">
          <p className="eyebrow">Private creator space</p>
          <h2>{space.title}</h2>
          <p>{space.description || "A server-controlled private learning space."}</p>
          <div className="post-meta"><span>{space.member_count || 0} members</span><span>{space.membership_role || "visible member"}</span><small>{space.status}</small></div>
          <CommunityContextLink contextType={space.context_type} contextId={space.context_id} className="btn btn-soft"><Icon name="book-open" size={16} /> View learning context</CommunityContextLink>
        </article>
        <article className="panel announcement-panel">
          <div className="panel-title"><h2>Start a space discussion</h2><span><Icon name="messages" size={16} /></span></div>
          {space.status === "active" ? <DiscussionComposer contextType={space.context_type} contextId={space.context_id} spaceId={space.id} onCreated={(created) => setDiscussions((current) => [created, ...current])} /> : <p className="save-hint">This space is not accepting new discussions. Its moderators set that.</p>}
        </article>
      </section>
      <section className="community-grid">
        <article className="panel community-post-list"><div className="panel-title"><h2>Space discussions</h2><span>{discussions.length}</span></div>{discussions.length ? discussions.map((discussion) => <DiscussionCard key={discussion.id} discussion={discussion} />) : <EmptyState title="No space discussions" text="No discussions in this space are visible to you yet." />}{nextCursor && <button className="btn btn-soft" type="button" disabled={loadingMore} onClick={() => { void loadMore(); }}>{loadingMore ? "Loading…" : "Load more discussions"}</button>}</article>
        {space.can_manage && <aside className="community-rail"><article className="study-buddy-card"><div><p className="eyebrow">Space membership</p><h2>Invite a member</h2><p>This checks your space management permission and resolves the supplied university email without exposing a user directory.</p></div><SpaceMemberForm spaceId={space.id} onChanged={spaceData.reload} /></article></aside>}
      </section>
    </Page>
  );
}
