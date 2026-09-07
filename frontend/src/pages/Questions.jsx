import { useParams } from "react-router-dom";
import { getCohortMaterials, getCohortQuestionCategories } from "../lib/materialCatalog.js";
import { EmptyState, ErrorPanel, Page } from "../components/ui/index.jsx";
import { CatalogTile } from "../components/learning/CatalogTile.jsx";
import { useI18n } from "../components/I18nProvider.jsx";

/**
 * Question sources, in display order. "AI sheet" is the only one that opens a
 * subject list today; the rest stay closed until their content is published.
 */
const QUESTION_CATEGORIES = [
  { id: "practice", titleKey: "questions.practice", metaKey: "questions.practiceMeta", icon: "brain", available: false },
  { id: "years", titleKey: "questions.years", metaKey: "questions.yearsMeta", icon: "calendar", available: false },
  { id: "ai-sheet", titleKey: "questions.aiSheet", metaKey: "questions.aiSheetMeta", icon: "file-question", available: true },
  { id: "mix", titleKey: "questions.mix", metaKey: "questions.mixMeta", icon: "shuffle", available: false }
];

/** A category the cohort is not enrolled in is not reachable at all. */
function cohortCategories(user) {
  const allowed = getCohortQuestionCategories(user);
  return QUESTION_CATEGORIES.filter((category) => allowed.includes(category.id));
}

function categoryEmptyState(category, t) {
  return <EmptyState title={t(category.titleKey)} text={t("common.soon")} />;
}

export default function Questions({ user = null }) {
  const { t } = useI18n();
  const categories = cohortCategories(user);

  return (
    <Page title="Questions">
      <section aria-labelledby="question-sources-heading">
        <div className="panel-title">
          <div>
            <p className="eyebrow">{t("questions.sourcesLabel")}</p>
            <h2 id="question-sources-heading">{t("questions.sourcesTitle")}</h2>
            <p className="muted">{t("questions.sourcesSubtitle")}</p>
          </div>
        </div>
        <section className="questions-category-grid" aria-label={t("questions.categoriesLabel")}>
          {categories.map((category) => <CategoryCard key={category.id} category={category} />)}
        </section>
      </section>
    </Page>
  );
}

function CategoryCard({ category }) {
  const { t } = useI18n();
  return <CatalogTile title={t(category.titleKey)} meta={t(category.metaKey)} icon={category.icon} kind="question" to={category.available ? `/questions/categories/${category.id}` : ""} status={category.available ? "" : t("common.soon")} />;
}

export function QuestionCategory({ user = null }) {
  const { categoryId } = useParams();
  const { t } = useI18n();
  const category = cohortCategories(user).find((item) => item.id === categoryId);
  if (!category) return <Page title={t("questions.sourceNotFoundTitle")}><ErrorPanel message={t("questions.sourceNotFoundText")} /></Page>;
  if (!category.available) return <Page title={t(category.titleKey)}>{categoryEmptyState(category, t)}</Page>;

  const materials = getCohortMaterials(user);
  if (!materials.length) return <Page title={t(category.titleKey)}><EmptyState icon="study" title={t("materials.noCohortMaterialsTitle")} text={t("materials.noCohortMaterialsText")} /></Page>;

  return (
    <Page title={t(category.titleKey)} subtitle={t("questions.chooseSubject")}>
      <section className="material-grid catalog-material-grid" aria-label={t("questions.subjectsLabel")}>
        {materials.map((material) => (
          <CatalogTile key={material.slug} title={material.title} meta={t("common.soon")} icon="book-open" to={`/questions/categories/${category.id}/subjects/${material.slug}`} />
        ))}
      </section>
    </Page>
  );
}

/** Subjects are listed before their questions exist, so this is an empty state
 * rather than a missing route. */
export function QuestionSubjectQuestions({ user = null }) {
  const { categoryId, subjectId } = useParams();
  const { t } = useI18n();
  const category = cohortCategories(user).find((item) => item.id === categoryId);
  const material = getCohortMaterials(user).find((item) => item.slug === subjectId) || null;
  if (!category?.available || !material) return <Page title={t("materials.notFoundTitle")}><ErrorPanel message={t("questions.subjectUnavailable")} /></Page>;

  return (
    <Page title={material.title} subtitle={t(category.titleKey)}>
      <EmptyState icon="study" title={t("questions.noQuestionsTitle")} text={t("questions.noQuestionsText")} />
    </Page>
  );
}
