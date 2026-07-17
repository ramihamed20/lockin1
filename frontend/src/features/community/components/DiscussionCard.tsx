import { Link } from "react-router-dom";

import { useI18n } from "../../../i18n/I18nProvider";
import type { Discussion } from "../types";
import { AuthorLine } from "./AuthorLine";

export function DiscussionCard({ item }: { item: Discussion }) {
  const { t } = useI18n();
  const removed = !item.title || !item.body;
  return (
    <article className="discussion-card">
      <div className="discussion-card__context">
        <Link to={item.context_route}>{item.context_title}</Link>
        {item.space_title ? <span>{item.space_title}</span> : null}
      </div>
      {removed ? (
        <p className="community-tombstone">{t("communityContentUnavailable")}</p>
      ) : (
        <>
          <h2><Link to={`/community/discussions/${item.id}`}>{item.title}</Link></h2>
          <p>{item.body}</p>
        </>
      )}
      <footer>
        <AuthorLine author={item.author} date={item.created_at} />
        <span>{item.comment_count} {t("communityReplies")}</span>
      </footer>
    </article>
  );
}
