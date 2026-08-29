import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { communityApi, moderationApi, COMMUNITY_CONTEXT_TYPES } from "../api/community.js";
import { PRODUCT_ROLES } from "../api/contracts.js";
import { hasProductRole } from "../lib/authz.js";
import { Icon } from "../lib/icons.jsx";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { EmptyState, ErrorPanel, LoadingPanel, Page } from "../components/ui/index.jsx";
import { DiscussionCard, DiscussionComposer, SpaceComposer, statusText } from "../components/community/index.jsx";

function mergeById(current, next) {
  const ids = new Set(current.map((item) => item.id));
  return [...current, ...next.filter((item) => !ids.has(item.id))];
}

async function loadCommunityHome() {
  const [discussionFeed, spaceFeed, reportFeed] = await Promise.all([
    communityApi.listDiscussions(),
    communityApi.listSpaces(),
    moderationApi.listReports()
  ]);
  return { discussionFeed, spaceFeed, reportFeed };
}

export default function Community() {
  const home = useAsyncData(loadCommunityHome, []);
  const [discussions, setDiscussions] = useState([]);
  const [nextDiscussionCursor, setNextDiscussionCursor] = useState(null);
  const [spaces, setSpaces] = useState([]);
  const [nextSpaceCursor, setNextSpaceCursor] = useState(null);
  const [reports, setReports] = useState([]);
  const [nextReportCursor, setNextReportCursor] = useState(null);
  const [loadingMore, setLoadingMore] = useState("");
  const [actionError, setActionError] = useState("");

  useEffect(() => {
    if (!home.data) return;
    setDiscussions(home.data.discussionFeed.results);
    setNextDiscussionCursor(home.data.discussionFeed.nextCursor);
    setSpaces(home.data.spaceFeed.results);
    setNextSpaceCursor(home.data.spaceFeed.nextCursor);
    setReports(home.data.reportFeed.results);
    setNextReportCursor(home.data.reportFeed.nextCursor);
  }, [home.data]);

  async function loadMore(kind) {
    const cursor = kind === "discussions" ? nextDiscussionCursor : kind === "spaces" ? nextSpaceCursor : nextReportCursor;
    if (!cursor || loadingMore) return;
    setLoadingMore(kind);
    setActionError("");
    try {
      if (kind === "discussions") {
        const page = await communityApi.listDiscussions({ cursor });
        setDiscussions((current) => mergeById(current, page.results));
        setNextDiscussionCursor(page.nextCursor);
      } else if (kind === "spaces") {
        const page = await communityApi.listSpaces({ cursor });
        setSpaces((current) => mergeById(current, page.results));
        setNextSpaceCursor(page.nextCursor);
      } else {
        const page = await moderationApi.listReports({ cursor });
        setReports((current) => mergeById(current, page.results));
        setNextReportCursor(page.nextCursor);
      }
    } catch (error) {
      setActionError(error.message || "More community data could not be loaded.");
    } finally {
      setLoadingMore("");
    }
  }

  if (home.loading) return <LoadingPanel />;
  if (home.error) return <ErrorPanel message={home.error} onRetry={home.reload} />;

  return (
    <Page title="Community" subtitle="Contextual learning conversations, creator-led spaces, and server-managed reports visible to your account.">
      {actionError && <ErrorPanel message={actionError} onRetry={home.reload} />}
      <section className="community-top">
        <article className="panel community-composer">
          <p className="eyebrow">Contextual learning</p>
          <h2>Start with a published material or quiz.</h2>
          <p className="muted">Public posts, likes, tags and announcements are not part of the community. Choose a learning context to start a discussion.</p>
          <div className="focus-timer-actions"><Link className="btn btn-primary" to="/materials"><Icon name="book-open" size={17} /> Browse materials</Link><Link className="btn btn-soft" to="/questions"><Icon name="help" size={17} /> Browse quizzes</Link></div>
        </article>
        <article className="panel announcement-panel">
          <div className="panel-title"><h2>Visible reports</h2><span>{reports.length}</span></div>
          <div className="announcement-list">
            {reports.length ? reports.map((report) => (
              <article className="announcement-item" key={report.id}>
                <span className="stat-icon"><Icon name="help" /></span>
                <div><h3>{report.target_label || `${report.target_type} report`}</h3><p>{statusText(report.status)} · {statusText(report.reason)}</p><Link className="text-link" to={`/community/reports/${report.id}`}>View report status</Link></div>
              </article>
            )) : <p className="muted">You have not submitted any community reports.</p>}
          </div>
          {nextReportCursor && <button className="btn btn-soft" type="button" disabled={loadingMore === "reports"} onClick={() => { void loadMore("reports"); }}>{loadingMore === "reports" ? "Loading…" : "Load more reports"}</button>}
        </article>
      </section>
      <section className="community-grid">
        <article className="panel community-post-list">
          <div className="panel-title"><h2>Visible discussions</h2><span>{discussions.length}</span></div>
          {discussions.length ? discussions.map((discussion) => <DiscussionCard key={discussion.id} discussion={discussion} />) : <EmptyState title="No discussions yet" text="Contextual discussions visible to your account will appear here." />}
          {nextDiscussionCursor && <button className="btn btn-soft" type="button" disabled={loadingMore === "discussions"} onClick={() => { void loadMore("discussions"); }}>{loadingMore === "discussions" ? "Loading…" : "Load more discussions"}</button>}
        </article>
        <aside className="community-rail">
          <article className="study-buddy-card">
            <div><p className="eyebrow">Creator spaces</p><h2>Private study spaces</h2><p>Only spaces visible to your account are shown. Membership and management rights decide what you see.</p></div>
            <div className="announcement-list">
              {spaces.length ? spaces.map((space) => <Link className="announcement-item" key={space.id} to={`/community/spaces/${space.id}`}><span className="stat-icon"><Icon name="lock" /></span><div><h3>{space.title}</h3><p>{space.context_title || "Learning context"}</p><small>{space.member_count || 0} members</small></div></Link>) : <p className="muted">No creator spaces are visible to this account.</p>}
            </div>
            {nextSpaceCursor && <button className="btn btn-soft" type="button" disabled={loadingMore === "spaces"} onClick={() => { void loadMore("spaces"); }}>{loadingMore === "spaces" ? "Loading…" : "Load more spaces"}</button>}
          </article>
        </aside>
      </section>
    </Page>
  );
}

export function CommunityContext({ user }) {
  const { contextType = "", contextId = "" } = useParams();
  const validContext = COMMUNITY_CONTEXT_TYPES.includes(contextType) && Boolean(contextId);
  const context = useAsyncData(
    async () => {
      if (!validContext) throw new Error("This community context is not supported.");
      const [discussionFeed, spaceFeed] = await Promise.all([
        communityApi.listDiscussions({ contextType, contextId }),
        communityApi.listSpaces()
      ]);
      return { discussionFeed, spaceFeed };
    },
    [contextType, contextId, validContext]
  );
  const [discussions, setDiscussions] = useState([]);
  const [nextDiscussionCursor, setNextDiscussionCursor] = useState(null);
  const [spaces, setSpaces] = useState([]);
  const [message, setMessage] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    if (!context.data) return;
    setDiscussions(context.data.discussionFeed.results);
    setNextDiscussionCursor(context.data.discussionFeed.nextCursor);
    setSpaces(context.data.spaceFeed.results.filter((space) => space.context_type === contextType && space.context_id === contextId));
  }, [context.data, contextType, contextId]);

  const canCreateSpace = (hasProductRole(user, PRODUCT_ROLES.CREATOR) || hasProductRole(user, PRODUCT_ROLES.ADMINISTRATOR)) && ["lesson", "learning_object"].includes(contextType);
  const contextTitle = discussions.find((item) => item.context_title)?.context_title || "Learning context";

  async function loadMore() {
    if (!nextDiscussionCursor || loadingMore) return;
    setLoadingMore(true);
    setMessage("");
    try {
      const page = await communityApi.listDiscussions({ contextType, contextId, cursor: nextDiscussionCursor });
      setDiscussions((current) => mergeById(current, page.results));
      setNextDiscussionCursor(page.nextCursor);
    } catch (error) {
      setMessage(error.message || "More discussions could not be loaded.");
    } finally {
      setLoadingMore(false);
    }
  }

  if (context.loading) return <LoadingPanel />;
  if (context.error) return <ErrorPanel message={context.error} onRetry={context.reload} />;

  return (
    <Page title="Community" subtitle="A conversation tied to one published learning context.">
      <Link className="back-link" to="/community"><Icon name="chevron-left" size={16} /> Community</Link>
      {message && <ErrorPanel message={message} onRetry={context.reload} />}
      <section className="community-top">
        <article className="panel community-composer"><p className="eyebrow">{contextType.replaceAll("_", " ")}</p><h2>{contextTitle}</h2><p className="muted">Keep this discussion tied to its published learning context.</p><DiscussionComposer contextType={contextType} contextId={contextId} onCreated={(created) => setDiscussions((current) => [created, ...current])} /></article>
        <article className="panel announcement-panel"><div className="panel-title"><h2>Creator-led spaces</h2><span>{spaces.length}</span></div><div className="announcement-list">{spaces.length ? spaces.map((space) => <Link className="announcement-item" key={space.id} to={`/community/spaces/${space.id}`}><span className="stat-icon"><Icon name="lock" /></span><div><h3>{space.title}</h3><p>{space.description || "Private study space"}</p><small>{space.member_count || 0} members</small></div></Link>) : <p className="muted">No private spaces are visible for this context.</p>}</div>{canCreateSpace && <SpaceComposer contextType={contextType} contextId={contextId} onCreated={(space) => setSpaces((current) => [space, ...current])} />}</article>
      </section>
      <section className="panel community-post-list"><div className="panel-title"><h2>Context discussions</h2><span>{discussions.length}</span></div>{discussions.length ? discussions.map((discussion) => <DiscussionCard key={discussion.id} discussion={discussion} />) : <EmptyState title="No context discussions" text="Start the first server-validated conversation for this learning context." />}{nextDiscussionCursor && <button className="btn btn-soft" type="button" disabled={loadingMore} onClick={() => { void loadMore(); }}>{loadingMore ? "Loading…" : "Load more discussions"}</button>}</section>
    </Page>
  );
}
