import { Link } from "react-router-dom";
import { useI18n } from "../components/I18nProvider.jsx";
import { Icon } from "../lib/icons.jsx";

const ABOUT_LINKS = [
  ["/about/", "settings.public.aboutLink"],
  ["/features/", "settings.public.features"],
  ["/medicine/", "settings.public.medicine"],
  ["/dentistry/", "settings.public.dentistry"]
];
const HELP_LINKS = [
  ["/help/", "settings.public.help"],
  ["/help/topics/getting-started/", "settings.public.start"],
  ["/help/start-active-study/", "settings.public.active"],
  ["/help/pdf-notes/", "settings.public.notes"],
  ["/help/find-mistakes/", "settings.public.review"],
  ["/help/topics/troubleshooting/", "settings.public.troubleshooting"],
  ["/#/support", "settings.public.contact"]
];

export default function PublicKnowledgeSettings({ section }) {
  const { t } = useI18n();
  const about = section === "about";
  return (
    <section className="settings-v2-section" id={`settings-${section}`} aria-labelledby={`settings-${section}-heading`}>
      <div className="ui-group-block settings-v2-block">
        {about && <p className="ui-group-footer">{t("settings.public.eyebrow")}</p>}
        <h3 className="ui-group-title">{t(about ? "settings.public.headline" : "settings.public.helpHeadline")}</h3>
        <p className="ui-group-footer">{t(about ? "settings.public.lead" : "settings.public.helpLead")}</p>
        {about && <p className="ui-group-footer" lang="en" dir="ltr">Everything in sync.</p>}
        <ul className="ui-group">
          {(about ? ABOUT_LINKS : HELP_LINKS).map(([href, key]) => (
            <li key={href}>
              <a className="ui-row" href={href}>
                <span className="ui-row-body"><span>{t(key)}</span></span>
                <Icon className="ui-row-chevron" name="chevron-right" size={17} />
              </a>
            </li>
          ))}
          {!about && <li><Link className="ui-row" to="/settings?section=suggest">
            <span className="ui-row-body"><span>{t("settings.public.report")}</span></span>
            <Icon className="ui-row-chevron" name="chevron-right" size={17} />
          </Link></li>}
        </ul>
        {about && <p className="ui-group-footer">{t("settings.public.available")}</p>}
      </div>
    </section>
  );
}
