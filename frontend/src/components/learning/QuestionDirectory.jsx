import { Link } from "react-router-dom";
import { Icon } from "../../lib/icons.jsx";
import { Page } from "../ui/index.jsx";
import { useI18n } from "../I18nProvider.jsx";

export function QuestionDirectoryHeader({ id, title, subtitle = "", backTo = "", backLabel = "", breadcrumbs = null }) {
  return <header className="catalog-directory-header">
    {backTo && <Link className="catalog-back-link" to={backTo}><Icon name="arrow-left" size={18} aria-hidden="true" /><span dir="auto">{backLabel}</span></Link>}
    {breadcrumbs}
    <div className="catalog-directory-title"><h1 id={id} dir="auto">{title}</h1>{subtitle && <p dir="auto">{subtitle}</p>}</div>
  </header>;
}

/**
 * Loading, empty and failed directories keep the heading and the way back the
 * loaded page has, so a state never leaves the student on a titleless screen.
 */
export function DirectoryState({ title, backTo = "", backLabel = "", children }) {
  return <Page width="reading" title={title} headingHandled>
    <section className="question-directory" aria-labelledby="question-state-heading">
      <QuestionDirectoryHeader id="question-state-heading" title={title} backTo={backTo} backLabel={backLabel} />
      {children}
    </section>
  </Page>;
}

export function QuestionBreadcrumbs({ category, material = null, sheetTitle = "" }) {
  const { t } = useI18n();
  return <nav className="question-breadcrumb" aria-label={t("questions.breadcrumbs")}>
    <Link to="/questions">{t("route.questions")}</Link>
    <Icon name="chevron-right" size={14} aria-hidden="true" />
    {material ? <Link to={`/questions/categories/${category.id}`}>{t(category.titleKey)}</Link> : <span aria-current="page">{t(category.titleKey)}</span>}
    {material && <><Icon name="chevron-right" size={14} aria-hidden="true" />{sheetTitle ? <Link to={`/questions/categories/${category.id}/subjects/${material.slug}`} dir="auto">{material.title}</Link> : <span aria-current="page" dir="auto">{material.title}</span>}</>}
    {sheetTitle && <><Icon name="chevron-right" size={14} aria-hidden="true" /><span aria-current="page" dir="auto">{sheetTitle}</span></>}
  </nav>;
}
