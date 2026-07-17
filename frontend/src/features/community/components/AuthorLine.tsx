import { useI18n } from "../../../i18n/I18nProvider";
import type { MessageKey } from "../../../i18n/catalogs";
import type { CommunityAuthor } from "../types";

const badgeLabels: Record<CommunityAuthor["badges"][number], MessageKey> = {
  moderator: "roleModerator",
  creator: "roleCreator",
  administrator: "roleAdministrator"
};

export function AuthorLine({ author, date }: { author: CommunityAuthor; date: string }) {
  const { locale, t } = useI18n();
  return (
    <div className="community-author">
      <span className="community-author__avatar" aria-hidden="true">
        {author.full_name.slice(0, 1).toUpperCase()}
      </span>
      <span className="community-author__identity">
        <strong>{author.full_name}</strong>
        <small>{new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(date))}</small>
      </span>
      {author.badges.map((badge) => (
        <span className="role-badge" key={badge}>{t(badgeLabels[badge])}</span>
      ))}
    </div>
  );
}
