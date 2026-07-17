import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";

import { ApiError } from "../../api/client";
import { Button } from "../../components/Button";
import { Alert, EmptyState, PageSkeleton } from "../../components/Feedback";
import { FormField, SelectField } from "../../components/FormField";
import { formValue } from "../../components/formValue";
import { useI18n } from "../../i18n/I18nProvider";
import { discussions, inviteSpaceMember, space } from "./api";
import { DiscussionCard } from "./components/DiscussionCard";
import { DiscussionComposer } from "./components/DiscussionComposer";
import type { CommunitySpace, Discussion } from "./types";

export function SpacePage() {
  const { spaceId = "" } = useParams();
  const { t } = useI18n();
  const [item, setItem] = useState<CommunitySpace | null>(null);
  const [feed, setFeed] = useState<Discussion[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([space(spaceId, controller.signal), discussions({ spaceId }, controller.signal)])
      .then(([loadedSpace, page]) => {
        if (controller.signal.aborted) return;
        setItem(loadedSpace);
        setFeed(page.results);
      })
      .catch((caught) => {
        if (!controller.signal.aborted) {
          setFailed(true);
          setMessage(caught instanceof ApiError ? caught.message : t("communityLoadError"));
        }
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [spaceId, t]);

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setPending(true);
    setMessage("");
    setFailed(false);
    try {
      await inviteSpaceMember(
        spaceId,
        formValue(data, "email"),
        formValue(data, "role") as "member" | "moderator"
      );
      form.reset();
      setMessage(t("communityMemberInvited"));
      setItem((current) => current ? { ...current, member_count: current.member_count + 1 } : current);
    } catch (caught) {
      setFailed(true);
      setMessage(caught instanceof ApiError ? caught.message : t("genericError"));
    } finally {
      setPending(false);
    }
  }

  if (loading) return <PageSkeleton label={t("communityLoadingSpace")} />;
  if (!item) return <div className="page"><Alert>{message || t("communityLoadError")}</Alert></div>;

  return (
    <div className="page community-space-page">
      <nav className="breadcrumbs" aria-label={t("breadcrumbs")}>
        <Link to="/community">{t("navCommunity")}</Link>
        <Link to={item.context_route}>{item.context_title}</Link>
      </nav>
      <header className="community-hero community-hero--space">
        <div>
          <p className="eyebrow">{t("communityPrivateCreatorSpace")}</p>
          <h1>{item.title}</h1>
          <p>{item.description || t("communitySpacesCopy")}</p>
          <small>{item.member_count} {t("communityMembers")} · {t("communityLedBy")} {item.owner.full_name}</small>
        </div>
        <DiscussionComposer
          contextType={item.context_type}
          contextId={item.context_id}
          spaceId={item.id}
          onCreated={(created) => setFeed((current) => [created, ...current])}
        />
      </header>
      {message ? <Alert tone={failed ? "error" : "success"}>{message}</Alert> : null}
      <div className="community-layout">
        <section className="community-feed" aria-labelledby="space-discussions-title">
          <header className="study-section__heading"><h2 id="space-discussions-title">{t("communitySpaceDiscussions")}</h2><span>{feed.length}</span></header>
          {feed.length ? <div className="discussion-list">{feed.map((discussion) => <DiscussionCard key={discussion.id} item={discussion} />)}</div> : <EmptyState title={t("communityNoDiscussions")}>{t("communityNoContextDiscussionsCopy")}</EmptyState>}
        </section>
        {item.can_manage ? (
          <aside className="community-member-panel">
            <p className="eyebrow">{t("communitySpaceAccess")}</p>
            <h2>{t("communityInviteStudent")}</h2>
            <p>{t("communityInviteStudentCopy")}</p>
            <form onSubmit={(event) => void invite(event)}>
              <FormField name="email" type="email" label={t("email")} required autoComplete="off" />
              <SelectField name="role" label={t("communitySpaceRole")} defaultValue="member">
                <option value="member">{t("communityRoleMember")}</option>
                <option value="moderator">{t("communityRoleSpaceModerator")}</option>
              </SelectField>
              <Button type="submit" disabled={pending}>{pending ? t("saving") : t("communitySendInvite")}</Button>
            </form>
          </aside>
        ) : null}
      </div>
    </div>
  );
}
