import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { communityApi, moderationApi, COMMUNITY_CONTEXT_TYPES } from "../api/community.js";
import { PRODUCT_ROLES } from "../api/contracts.js";
import { hasProductRole } from "../lib/authz.js";
import { Icon } from "../lib/icons.jsx";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { EmptyState, ErrorPanel, LoadingPanel, Page } from "../components/ui/index.jsx";
import { DiscussionCard, DiscussionComposer, SpaceComposer, statusText } from "../components/community/index.jsx";
import { useI18n } from "../components/I18nProvider.jsx";

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
  const { t } = useI18n();
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
      setActionError(error.message || t("community.loadMoreError"));
    } finally {
      setLoadingMore("");
    }
  }

  if (home.loading) return <LoadingPanel />;
  if (home.error) return <ErrorPanel message={home.error} onRetry={home.reload} />;

  return (
    <Page title="Community" subtitle={t("community.subtitle")}>
      {actionError && <ErrorPanel message={actionError} onRetry={home.reload} />}
      <section className="community-top">
        <article className="panel community-composer">
          <p className="eyebrow">{t("community.contextualLearning")}</p>
          <h2>{t("community.startWith")}</h2>
          <p className="muted">{t("community.noPublicPosts")}</p>
          <div className="focus-timer-actions"><Link className="btn btn-primary" to="/materials"><Icon name="book-open" size={17} /> {t("dashboard.browseMaterials")}</Link><Link className="btn btn-soft" to="/questions"><Icon name="help" size={17} /> {t("community.browseQuizzes")}</Link></div>
        </article>
        <article className="panel announcement-panel">
          <div className="panel-title"><h2>{t("community.visibleReports")}</h2><span>{reports.length}</span></div>
          <div className="announcement-list">
            {reports.length ? reports.map((report) => (
              <article className="announcement-item" key={report.id}>
                <span className="stat-icon"><Icon name="help" /></span>
                <div><h3 dir="auto">{report.target_label || t("community.reportOf", { type: report.target_type })}</h3><p dir="auto">{statusText(report.status)} · {statusText(report.reason)}</p><Link className="text-link" to={`/community/reports/${report.id}`}>{t("community.viewReportStatus")}</Link></div>
              </article>
            )) : <p className="muted">{t("community.noReports")}</p>}
          </div>
          {nextReportCursor && <button className="btn btn-soft" type="button" disabled={loadingMore === "reports"} onClick={() => { void loadMore("reports"); }}>{t(loadingMore === "reports" ? "notifications.loadingMore" : "community.loadMoreReports")}</button>}
        </article>
      </section>
      <section className="community-grid">
        <article className="panel community-post-list">
          <div className="panel-title"><h2>{t("community.visibleDiscussions")}</h2><span>{discussions.length}</span></div>
          {discussions.length ? discussions.map((discussion) => <DiscussionCard key={discussion.id} discussion={discussion} />) : <EmptyState title={t("community.noDiscussionsTitle")} text={t("community.noDiscussionsText")} />}
          {nextDiscussionCursor && <button className="btn btn-soft" type="button" disabled={loadingMore === "discussions"} onClick={() => { void loadMore("discussions"); }}>{t(loadingMore === "discussions" ? "notifications.loadingMore" : "community.loadMoreDiscussions")}</button>}
        </article>
        <aside className="community-rail">
          <article className="study-buddy-card">
            <div><p className="eyebrow">{t("community.creatorSpaces")}</p><h2>{t("community.privateSpaces")}</h2><p>{t("community.spacesNote")}</p></div>
            <div className="announcement-list">
              {spaces.length ? spaces.map((space) => <Link className="announcement-item" key={space.id} to={`/community/spaces/${space.id}`}><span className="stat-icon"><Icon name="lock" /></span><div><h3 dir="auto">{space.title}</h3><p dir="auto">{space.context_title || t("community.learningContext")}</p><small dir="auto">{t("community.memberCount", { count: space.member_count || 0 })}</small></div></Link>) : <p className="muted">{t("community.noSpaces")}</p>}
            </div>
            {nextSpaceCursor && <button className="btn btn-soft" type="button" disabled={loadingMore === "spaces"} onClick={() => { void loadMore("spaces"); }}>{t(loadingMore === "spaces" ? "notifications.loadingMore" : "community.loadMoreSpaces")}</button>}
          </article>
        </aside>
      </section>
    </Page>
  );
}

export function CommunityContext({ user }) {
  const { t } = useI18n();
  const { contextType = "", contextId = "" } = useParams();
  const validContext = COMMUNITY_CONTEXT_TYPES.includes(contextType) && Boolean(contextId);
  const context = useAsyncData(
    async () => {
      if (!validContext) throw new Error(t("community.contextUnsupported"));
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
  const contextTitle = discussions.find((item) => item.context_title)?.context_title || t("community.learningContext");

  async function loadMore() {
    if (!nextDiscussionCursor || loadingMore) return;
    setLoadingMore(true);
    setMessage("");
    try {
      const page = await communityApi.listDiscussions({ contextType, contextId, cursor: nextDiscussionCursor });
      setDiscussions((current) => mergeById(current, page.results));
      setNextDiscussionCursor(page.nextCursor);
    } catch (error) {
      setMessage(error.message || t("community.moreDiscussionsError"));
    } finally {
      setLoadingMore(false);
    }
  }

  if (context.loading) return <LoadingPanel />;
  if (context.error) return <ErrorPanel message={context.error} onRetry={context.reload} />;

  return (
    <Page title="Community" subtitle={t("community.contextSubtitle")}>
      <Link className="back-link" to="/community"><Icon name="chevron-left" size={16} /> {t("nav.community")}</Link>
      {message && <ErrorPanel message={message} onRetry={context.reload} />}
      <section className="community-top">
        <article className="panel community-composer"><p className="eyebrow" dir="auto">{contextType.replaceAll("_", " ")}</p><h2 dir="auto">{contextTitle}</h2><p className="muted">{t("community.keepTied")}</p><DiscussionComposer contextType={contextType} contextId={contextId} onCreated={(created) => setDiscussions((current) => [created, ...current])} /></article>
        <article className="panel announcement-panel"><div className="panel-title"><h2>{t("community.creatorLedSpaces")}</h2><span>{spaces.length}</span></div><div className="announcement-list">{spaces.length ? spaces.map((space) => <Link className="announcement-item" key={space.id} to={`/community/spaces/${space.id}`}><span className="stat-icon"><Icon name="lock" /></span><div><h3 dir="auto">{space.title}</h3><p dir="auto">{space.description || t("community.privateStudySpace")}</p><small dir="auto">{t("community.memberCount", { count: space.member_count || 0 })}</small></div></Link>) : <p className="muted">{t("community.noSpacesForContext")}</p>}</div>{canCreateSpace && <SpaceComposer contextType={contextType} contextId={contextId} onCreated={(space) => setSpaces((current) => [space, ...current])} />}</article>
      </section>
      <section className="panel community-post-list"><div className="panel-title"><h2>{t("community.contextDiscussions")}</h2><span>{discussions.length}</span></div>{discussions.length ? discussions.map((discussion) => <DiscussionCard key={discussion.id} discussion={discussion} />) : <EmptyState title={t("community.noContextDiscussionsTitle")} text={t("community.noContextDiscussionsText")} />}{nextDiscussionCursor && <button className="btn btn-soft" type="button" disabled={loadingMore} onClick={() => { void loadMore(); }}>{t(loadingMore ? "notifications.loadingMore" : "community.loadMoreDiscussions")}</button>}</section>
    </Page>
  );
}
