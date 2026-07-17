import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";

import { ApiError } from "../../api/client";
import { Button } from "../../components/Button";
import { Alert, EmptyState, PageSkeleton } from "../../components/Feedback";
import { useAuth } from "../auth/AuthProvider";
import { useI18n } from "../../i18n/I18nProvider";
import { discussions, nextDiscussions, spaces } from "./api";
import { DiscussionCard } from "./components/DiscussionCard";
import { DiscussionComposer } from "./components/DiscussionComposer";
import { SpaceComposer } from "./components/SpaceComposer";
import type { CommunitySpace, Discussion, LearningContextType } from "./types";

const contextTypes: LearningContextType[] = ["lesson", "learning_object", "question", "quiz"];

export function CommunityPage() {
  const { contextType: rawContextType, contextId } = useParams();
  const [searchParams] = useSearchParams();
  const contextType = contextTypes.includes(rawContextType as LearningContextType)
    ? rawContextType as LearningContextType
    : undefined;
  const contextual = Boolean(contextType && contextId);
  const { user } = useAuth();
  const { t } = useI18n();
  const [items, setItems] = useState<Discussion[]>([]);
  const [availableSpaces, setAvailableSpaces] = useState<CommunitySpace[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const requestKey = `${contextType ?? "all"}:${contextId ?? "all"}`;
  const [loadedKey, setLoadedKey] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const filters = contextType && contextId ? { contextType, contextId } : {};
    void Promise.all([
      discussions(filters, controller.signal),
      spaces(controller.signal)
    ]).then(([discussionPage, spacePage]) => {
      if (controller.signal.aborted) return;
      setItems(discussionPage.results);
      setNext(discussionPage.next);
      setAvailableSpaces(spacePage.results);
      setError("");
    }).catch((caught) => {
      if (!controller.signal.aborted) {
        setError(caught instanceof ApiError ? caught.message : t("communityLoadError"));
      }
    }).finally(() => { if (!controller.signal.aborted) setLoadedKey(requestKey); });
    return () => controller.abort();
  }, [contextId, contextType, requestKey, t]);

  async function loadMore() {
    if (!next) return;
    setLoadingMore(true);
    try {
      const page = await nextDiscussions(next);
      setItems((current) => [...current, ...page.results]);
      setNext(page.next);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : t("communityLoadError"));
    } finally {
      setLoadingMore(false);
    }
  }

  if (loadedKey !== requestKey) return <PageSkeleton label={t("communityLoading")} />;
  const label = items[0]?.context_title ?? searchParams.get("label") ?? t("communityLearningContext");
  const contextSpaces = contextual
    ? availableSpaces.filter((space) => space.context_type === contextType && space.context_id === contextId)
    : availableSpaces;
  const canCreateSpace = contextual
    && (contextType === "lesson" || contextType === "learning_object")
    && Boolean(user?.roles.some((role) => role === "creator" || role === "administrator"));

  return (
    <div className="page community-page">
      <header className="community-hero">
        <div>
          <p className="eyebrow">{contextual ? t("communityContextOnly") : t("communityLearningNetwork")}</p>
          <h1>{contextual ? label : t("communityTitle")}</h1>
          <p>{contextual ? t("communityContextCopy") : t("communityCopy")}</p>
        </div>
        {contextual && contextType && contextId ? (
          <DiscussionComposer
            contextType={contextType}
            contextId={contextId}
            onCreated={(created) => setItems((current) => [created, ...current])}
          />
        ) : null}
      </header>
      {error ? <Alert>{error}</Alert> : null}

      <div className="community-layout">
        <section className="community-feed" aria-labelledby="community-discussions-title">
          <header className="study-section__heading">
            <h2 id="community-discussions-title">
              {contextual ? t("communityQuestionsHere") : t("communityRecentDiscussions")}
            </h2>
            <span>{items.length}</span>
          </header>
          {items.length ? (
            <div className="discussion-list">
              {items.map((item) => <DiscussionCard key={item.id} item={item} />)}
              {next ? (
                <Button variant="secondary" disabled={loadingMore} onClick={() => void loadMore()}>
                  {loadingMore ? t("loading") : t("communityLoadMore")}
                </Button>
              ) : null}
            </div>
          ) : (
            <EmptyState title={t("communityNoDiscussions")}>
              {contextual ? t("communityNoContextDiscussionsCopy") : t("communityNoDiscussionsCopy")}
            </EmptyState>
          )}
        </section>

        <aside className="community-spaces" aria-labelledby="community-spaces-title">
          <div>
            <p className="eyebrow">{t("communityGuidedSpaces")}</p>
            <h2 id="community-spaces-title">{t("communitySpaces")}</h2>
            <p>{t("communitySpacesCopy")}</p>
          </div>
          {contextSpaces.length ? (
            <ul>
              {contextSpaces.map((space) => (
                <li key={space.id}>
                  <Link to={`/community/spaces/${space.id}`}>
                    <strong>{space.title}</strong>
                    <span>{space.context_title}</span>
                    <small>{space.member_count} {t("communityMembers")}</small>
                  </Link>
                </li>
              ))}
            </ul>
          ) : <p className="muted-copy">{t("communityNoSpaces")}</p>}
          {canCreateSpace && contextType && contextId ? (
            <SpaceComposer
              contextType={contextType}
              contextId={contextId}
              onCreated={(space) => setAvailableSpaces((current) => [space, ...current])}
            />
          ) : null}
        </aside>
      </div>
    </div>
  );
}
