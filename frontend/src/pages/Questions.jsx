import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { catalogWorkspaceApi } from "../api/catalogWorkspace.js";
import { getCohortQuestionCategories } from "../lib/materialCatalog.js";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { Icon } from "../lib/icons.jsx";
import { EmptyState, ErrorPanel, LoadingPanel, Page } from "../components/ui/index.jsx";
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

/**
 * The Questions directory, served by the same catalog Materials is.
 *
 * This list used to be the client's own hard-coded subject table, which is why
 * questions an administrator published were never reachable: the page knew the
 * subject names but had no sheet and no request behind them, so every subject
 * ended at "no questions yet". Reading `/catalog/questions` means a sheet
 * appears here under the exact title Materials and the Questions admin show,
 * for the cohort that owns it and no other.
 */
function useQuestionMaterials(user) {
  const key = [user?.id || "", user?.cohort?.id || ""].join("|");
  const data = useAsyncData(() => catalogWorkspaceApi.questionMaterials(), [key]);
  const materials = useMemo(() => (Array.isArray(data.data?.results) ? data.data.results : []), [data.data]);
  return { ...data, materials };
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
  const { materials, loading, error, reload } = useQuestionMaterials(user);

  if (!category) return <Page title={t("questions.sourceNotFoundTitle")}><ErrorPanel message={t("questions.sourceNotFoundText")} /></Page>;
  if (!category.available) return <Page title={t(category.titleKey)}>{categoryEmptyState(category, t)}</Page>;
  // A directory still in flight is not an empty directory, and a failed one is
  // not a curriculum with nothing in it.
  if (loading) return <Page title={t(category.titleKey)}><LoadingPanel /></Page>;
  if (error) return <Page title={t(category.titleKey)}><ErrorPanel message={error} onRetry={reload} /></Page>;
  if (!materials.length) return <Page title={t(category.titleKey)}><EmptyState icon="study" title={t("questions.noQuestionsTitle")} text={t("questions.noQuestionsText")} /></Page>;

  return (
    <Page title={t(category.titleKey)} subtitle={t("questions.chooseSubject")}>
      <section className="material-grid catalog-material-grid" aria-label={t("questions.subjectsLabel")}>
        {materials.map((material) => (
          <CatalogTile
            key={material.slug}
            title={material.title}
            meta={t("questions.questionCount", { count: material.questionCount || 0 })}
            icon="book-open"
            to={`/questions/categories/${category.id}/subjects/${material.slug}`}
          />
        ))}
      </section>
    </Page>
  );
}

/** The sheets of one subject that carry questions, under their own names. */
export function QuestionSubjectSheets({ user = null }) {
  const { categoryId, subjectId } = useParams();
  const { t } = useI18n();
  const category = cohortCategories(user).find((item) => item.id === categoryId);
  const { materials, loading, error, reload } = useQuestionMaterials(user);
  const material = materials.find((item) => item.slug === subjectId) || null;

  if (!category?.available) return <Page title={t("materials.notFoundTitle")}><ErrorPanel message={t("questions.subjectUnavailable")} /></Page>;
  if (loading) return <Page title={t(category.titleKey)}><LoadingPanel /></Page>;
  if (error) return <Page title={t(category.titleKey)}><ErrorPanel message={error} onRetry={reload} /></Page>;
  if (!material) return <Page title={t("materials.notFoundTitle")}><ErrorPanel message={t("questions.subjectUnavailable")} /></Page>;
  if (!material.sheets.length) return <Page title={material.title}><EmptyState icon="study" title={t("questions.noQuestionsTitle")} text={t("questions.noQuestionsText")} /></Page>;

  return (
    <Page title={material.title} subtitle={t("questions.chooseSheet")}>
      <section className="material-grid catalog-material-grid" aria-label={t("questions.sheetsLabel")}>
        {material.sheets.map((sheet) => (
          <CatalogTile
            key={sheet.id}
            title={sheet.title}
            meta={t("questions.questionCount", { count: sheet.questionCount || 0 })}
            icon="file-question"
            kind="question"
            to={`/questions/categories/${category.id}/subjects/${material.slug}/sheets/${sheet.id}`}
          />
        ))}
      </section>
    </Page>
  );
}

/** One sheet's published questions, answered at the reader's own pace. */
export function QuestionSheetQuestions({ user = null }) {
  const { categoryId, sheetId } = useParams();
  const { t } = useI18n();
  const category = cohortCategories(user).find((item) => item.id === categoryId);
  const data = useAsyncData((signal) => catalogWorkspaceApi.sheetQuestions(sheetId, { signal }), [sheetId]);
  const questions = Array.isArray(data.data?.results) ? data.data.results : [];
  const sheetTitle = data.data?.sheet?.title || t("questions.aiSheet");

  if (!category?.available) return <Page title={t("materials.notFoundTitle")}><ErrorPanel message={t("questions.subjectUnavailable")} /></Page>;
  if (data.loading) return <Page title={t(category.titleKey)}><LoadingPanel /></Page>;
  if (data.error) return <Page title={t(category.titleKey)}><ErrorPanel message={data.error} onRetry={data.reload} /></Page>;
  if (!questions.length) return <Page title={sheetTitle}><EmptyState icon="study" title={t("questions.noQuestionsTitle")} text={t("questions.noQuestionsText")} /></Page>;

  return (
    // The sheet name is shown here rather than hidden: nothing else on this
    // page names the sheet, so a student would otherwise have no way to
    // confirm which one they opened.
    <Page
      title={sheetTitle}
      subtitle={t("questions.questionCount", { count: questions.length })}
      showHeading
    >
      <section className="questions-practice-list" aria-label={t("questions.sheetQuestionsLabel")}>
        {questions.map((question, index) => (
          <PracticeItem key={question.id} question={question} number={index + 1} />
        ))}
      </section>
    </Page>
  );
}

/**
 * A practice card: the reader answers, and only then sees whether they were
 * right and why. Correctness is in the payload because this is practice rather
 * than a graded attempt, so the card reveals it on the reader's own action and
 * never before.
 */
function PracticeItem({ question, number }) {
  const { t } = useI18n();
  const [selected, setSelected] = useState([]);
  const [revealed, setRevealed] = useState(false);
  const multiple = question.question_type === "multiple_select";
  const choices = Array.isArray(question.choices) ? question.choices : [];

  function choose(id) {
    if (revealed) return;
    setSelected((current) => {
      if (!multiple) return [id];
      return current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
    });
  }

  const correctIds = choices.filter((choice) => choice.is_correct).map((choice) => choice.id);
  const wasCorrect = revealed
    && selected.length === correctIds.length
    && correctIds.every((id) => selected.includes(id));

  return (
    <article className={`question-card${revealed ? (wasCorrect ? " answered-correct" : " answered-wrong") : ""}`}>
      <div className="card-head">
        <div>
          <span className="pill" dir="auto">{`${t("questions.questionLabel", { number })} · ${question.difficulty}`}</span>
          <h2 dir="auto">{question.prompt}</h2>
        </div>
        <span className="stat-icon"><Icon name="help" /></span>
      </div>
      {multiple && <p className="save-hint">{t("assessment.selectEvery")}</p>}
      <div className="choices">
        {choices.map((choice, index) => {
          const isSelected = selected.includes(choice.id);
          // The existing answer vocabulary, so a practice card reads exactly
          // like a released attempt result rather than inventing a second one.
          const tone = revealed ? (choice.is_correct ? " correct" : isSelected ? " wrong" : "") : "";
          return (
            <button
              key={choice.id}
              type="button"
              className={`${isSelected ? "selected" : ""}${tone}`}
              aria-pressed={isSelected}
              disabled={revealed}
              onClick={() => choose(choice.id)}
            >
              <span className="choice-prefix">{String.fromCharCode(65 + index)}</span>
              <span dir="auto">{choice.text}</span>
              {revealed && choice.is_correct && <Icon name="check" size={18} aria-hidden="true" />}
            </button>
          );
        })}
      </div>
      {!revealed && (
        <button className="btn btn-primary compact" type="button" disabled={!selected.length} onClick={() => setRevealed(true)}>
          {t("questions.checkAnswer")}
        </button>
      )}
      {revealed && (
        <div className={`answer-note ${wasCorrect ? "correct" : "wrong"}`} role="status">
          <strong>{wasCorrect ? t("questions.answerCorrect") : t("questions.answerIncorrect")}</strong>
          {question.explanation && <p dir="auto">{question.explanation}</p>}
          <button className="btn btn-soft compact" type="button" onClick={() => { setRevealed(false); setSelected([]); }}>
            {t("questions.tryAgain")}
          </button>
        </div>
      )}
    </article>
  );
}
