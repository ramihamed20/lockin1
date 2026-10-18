import { Link } from "react-router-dom";
import { useI18n } from "../components/I18nProvider.jsx";
import { Icon } from "../lib/icons.jsx";

const ABOUT_LINKS = [
  ["/about/", "settings.public.aboutLink", "globe"],
  ["/features/", "settings.public.features", "layers"],
  ["/medicine/", "settings.public.medicine", "microscope"],
  ["/dentistry/", "settings.public.dentistry", "book-open"]
];
const STUDY_LINKS = [
  ["/help/start-active-study/", "settings.public.active", "brain"],
  ["/help/pdf-notes/", "settings.public.notes", "pencil"],
  ["/help/find-mistakes/", "settings.public.review", "target"]
];
/** The public pages have an English edition under /en/; app routes (/#/…) are shared. */
export function publicPagePath(path, locale) {
  return locale === "en" && path.startsWith("/") && !path.startsWith("/#") ? "/en" + path : path;
}

const SUPPORT_LINKS = [
  ["/help/topics/getting-started/", "settings.public.start", "book-open"],
  ["/help/topics/troubleshooting/", "settings.public.troubleshooting", "help"],
  ["/#/support", "settings.public.contact", "messages"]
];

function KnowledgeRows({ items }) {
  const { t, locale } = useI18n();
  return <ul className="ui-group">
    {items.map(([href, key, icon]) => <li key={href}>
      <a className="ui-row" href={publicPagePath(href, locale)}>
        <span className="ui-row-icon settings-public-icon"><Icon name={icon} size={17} /></span>
        <span className="ui-row-body"><span>{t(key)}</span></span>
        <Icon className="ui-row-chevron" name="chevron-right" size={17} />
      </a>
    </li>)}
  </ul>;
}

export default function PublicKnowledgeSettings({ section }) {
  const { t, locale } = useI18n();
  const about = section === "about";
  return (
    <section className="settings-v2-section settings-public" id={"settings-" + section} aria-labelledby={"settings-" + section + "-heading"}>
      {about ? <>
        <div className="settings-public-intro">
          <p className="settings-public-eyebrow">{t("settings.public.eyebrow")}</p>
          <h3>{t("settings.public.headline")}</h3>
          <p>{t("settings.public.lead")}</p>
          <p className="settings-public-brandline" lang="en" dir="ltr">Everything in sync.</p>
        </div>
        <div className="ui-group-block settings-v2-block">
          <KnowledgeRows items={ABOUT_LINKS} />
          <p className="ui-group-footer">{t("settings.public.available")}</p>
        </div>
      </> : <>
        <div className="ui-group-block settings-v2-block">
          <h3 className="ui-group-title">{t("settings.public.helpHeadline")}</h3>
          <ul className="ui-group settings-public-primary">
            <li><a className="ui-row" href={publicPagePath("/help/", locale)} aria-label={t("settings.public.help")} aria-describedby="settings-public-help-summary">
              <span className="ui-row-icon"><Icon name="book-open" size={17} /></span>
              <span className="ui-row-body"><span>{t("settings.public.help")}</span><small id="settings-public-help-summary">{t("settings.public.helpLead")}</small></span>
              <Icon className="ui-row-chevron" name="chevron-right" size={17} />
            </a></li>
          </ul>
        </div>
        <div className="ui-group-block settings-v2-block">
          <h3 className="ui-group-title">{t("settings.public.studying")}</h3>
          <KnowledgeRows items={STUDY_LINKS} />
        </div>
        <div className="ui-group-block settings-v2-block">
          <h3 className="ui-group-title">{t("settings.public.supportGroup")}</h3>
          <KnowledgeRows items={SUPPORT_LINKS} />
          <div className="ui-group"><Link className="ui-row" to="/settings?section=suggest">
            <span className="ui-row-icon settings-public-icon"><Icon name="flag" size={17} /></span>
            <span className="ui-row-body"><span>{t("settings.public.report")}</span></span>
            <Icon className="ui-row-chevron" name="chevron-right" size={17} />
          </Link></div>
        </div>
      </>}
    </section>
  );
}
