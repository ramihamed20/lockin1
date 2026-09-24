import { useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { catalogWorkspaceApi } from "../api/catalogWorkspace.js";
import { getCohortQuestionCategories } from "../lib/materialCatalog.js";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { Icon } from "../lib/icons.jsx";
import { EmptyState, ErrorPanel, LoadingPanel, Page } from "../components/ui/index.jsx";
import { CatalogTile } from "../components/learning/CatalogTile.jsx";
import { useI18n } from "../components/I18nProvider.jsx";

/**
 * Exam and AI sheet questions share the player, but use separate published banks.
 */
const QUESTION_CATEGORIES = [
  { id: "practice", titleKey: "questions.practice", metaKey: "questions.practiceMeta", icon: "brain", available: false },
  { id: "years", titleKey: "questions.years", metaKey: "questions.yearsMeta", icon: "calendar", available: true },
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
function sourceForCategory(categoryId) { return categoryId === "years" ? "exam" : "ai-sheet"; }

function useQuestionMaterials(user, categoryId) {
  const key = [user?.id || "", user?.cohort?.id || "", categoryId].join("|");
  const data = useAsyncData(() => catalogWorkspaceApi.questionMaterials(sourceForCategory(categoryId)), [key]);
  const materials = useMemo(() => (Array.isArray(data.data?.results) ? data.data.results : []), [data.data]);
  return { ...data, materials };
}

export default function Questions({ user = null }) {
  const { t } = useI18n();
  const categories = cohortCategories(user);

  return (
    <Page title="Questions" headingHandled>
      <section className="question-directory" aria-labelledby="question-sources-heading">
        <QuestionDirectoryHeader id="question-sources-heading" title={t("route.questions")} />
        <section className="questions-category-grid" aria-label={t("questions.categoriesLabel")}>
          {categories.map((category) => <CategoryCard key={category.id} category={category} />)}
        </section>
      </section>
    </Page>
  );
}

function QuestionDirectoryHeader({ id, title, subtitle = "", backTo = "", backLabel = "", breadcrumbs = null }) {
  return <header className="catalog-directory-header">
    {backTo && <Link className="catalog-back-link" to={backTo}><Icon name="arrow-left" size={18} aria-hidden="true" /><span dir="auto">{backLabel}</span></Link>}
    {breadcrumbs}
    <div className="catalog-directory-title"><h1 id={id} dir="auto">{title}</h1>{subtitle && <p dir="auto">{subtitle}</p>}</div>
  </header>;
}

function CategoryCard({ category }) {
  const { t } = useI18n();
  return <CatalogTile title={t(category.titleKey)} meta={t(category.metaKey)} icon={category.icon} kind="question" to={category.available ? `/questions/categories/${category.id}` : ""} status={category.available ? "" : t("common.soon")} />;
}

function QuestionBreadcrumbs({ category, material = null, sheetTitle = "" }) {
  const { t } = useI18n();
  return <nav className="question-breadcrumb" aria-label={t("questions.breadcrumbs")}>
    <Link to="/questions">{t("route.questions")}</Link>
    <Icon name="chevron-right" size={14} aria-hidden="true" />
    {material ? <Link to={`/questions/categories/${category.id}`}>{t(category.titleKey)}</Link> : <span aria-current="page">{t(category.titleKey)}</span>}
    {material && <><Icon name="chevron-right" size={14} aria-hidden="true" />{sheetTitle ? <Link to={`/questions/categories/${category.id}/subjects/${material.slug}`} dir="auto">{material.title}</Link> : <span aria-current="page" dir="auto">{material.title}</span>}</>}
    {sheetTitle && <><Icon name="chevron-right" size={14} aria-hidden="true" /><span aria-current="page" dir="auto">{sheetTitle}</span></>}
  </nav>;
}

export function QuestionCategory({ user = null }) {
  const { categoryId } = useParams();
  const { t } = useI18n();
  const category = cohortCategories(user).find((item) => item.id === categoryId);
  const { materials, loading, error, reload } = useQuestionMaterials(user, categoryId);

  if (!category) return <Page title={t("questions.sourceNotFoundTitle")}><ErrorPanel message={t("questions.sourceNotFoundText")} /></Page>;
  if (!category.available) return <Page title={t(category.titleKey)}>{categoryEmptyState(category, t)}</Page>;
  // A directory still in flight is not an empty directory, and a failed one is
  // not a curriculum with nothing in it.
  if (loading) return <Page title={t(category.titleKey)}><LoadingPanel variant="material-list" /></Page>;
  if (error) return <Page title={t(category.titleKey)}><ErrorPanel message={error} onRetry={reload} /></Page>;
  if (!materials.length) return <Page title={t(category.titleKey)}><EmptyState icon="study" title={t("questions.noQuestionsTitle")} text={t("questions.noQuestionsText")} /></Page>;

  return (
    <Page title={t(category.titleKey)} headingHandled>
      <section className="question-directory" aria-labelledby="question-category-heading">
        <QuestionDirectoryHeader id="question-category-heading" title={t(category.titleKey)} backTo="/questions" backLabel={t("route.questions")} breadcrumbs={<QuestionBreadcrumbs category={category} />} />
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
      </section>
    </Page>
  );
}

/** The sheets of one subject that carry questions, under their own names. */
export function QuestionSubjectSheets({ user = null }) {
  const { categoryId, subjectId } = useParams();
  const { t } = useI18n();
  const category = cohortCategories(user).find((item) => item.id === categoryId);
  const { materials, loading, error, reload } = useQuestionMaterials(user, categoryId);
  const material = materials.find((item) => item.slug === subjectId) || null;

  if (!category?.available) return <Page title={t("materials.notFoundTitle")}><ErrorPanel message={t("questions.subjectUnavailable")} /></Page>;
  if (loading) return <Page title={t(category.titleKey)}><LoadingPanel variant="card-list" /></Page>;
  if (error) return <Page title={t(category.titleKey)}><ErrorPanel message={error} onRetry={reload} /></Page>;
  if (!material) return <Page title={t("materials.notFoundTitle")}><ErrorPanel message={t("questions.subjectUnavailable")} /></Page>;
  if (!material.sheets.length) return <Page title={material.title}><EmptyState icon="study" title={t("questions.noQuestionsTitle")} text={t("questions.noQuestionsText")} /></Page>;

  return (
    <Page title={material.title} headingHandled>
      <section className="question-directory" aria-labelledby="question-subject-heading">
        <QuestionDirectoryHeader id="question-subject-heading" title={material.title} backTo={`/questions/categories/${category.id}`} backLabel={t(category.titleKey)} breadcrumbs={<QuestionBreadcrumbs category={category} material={material} />} />
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
      </section>
    </Page>
  );
}

/**
 * One sheet's published questions, one at a time.
 *
 * The server grades every answer: the payload carries no correct choice and no
 * explanation until the student has answered, and the reply to that answer is
 * what reveals both along with the XP it earned. An answered question comes
 * back answered on every later visit, so reopening a sheet can neither re-grade
 * nor re-award it.
 */
export function QuestionSheetQuestions({ user = null }) {
  const { categoryId, subjectId, sheetId } = useParams();
  const { t } = useI18n();
  const category = cohortCategories(user).find((item) => item.id === categoryId);
  const data = useAsyncData((signal) => catalogWorkspaceApi.sheetQuestions(sheetId, { signal, source: sourceForCategory(categoryId) }), [sheetId, categoryId]);
  const questions = useMemo(() => (Array.isArray(data.data?.results) ? data.data.results : []), [data.data]);
  const sheetTitle = data.data?.sheet?.title || t("questions.aiSheet");

  if (!category?.available) return <Page title={t("materials.notFoundTitle")}><ErrorPanel message={t("questions.subjectUnavailable")} /></Page>;
  if (data.loading) return <Page title={t(category.titleKey)}><LoadingPanel variant="quiz" /></Page>;
  if (data.error) return <Page title={t(category.titleKey)}><ErrorPanel message={data.error} onRetry={data.reload} /></Page>;
  if (!questions.length) return <Page title={sheetTitle}><EmptyState icon="study" title={t("questions.noQuestionsTitle")} text={t("questions.noQuestionsText")} /></Page>;

  const subjectTitle = data.data?.sheet?.subject_title || t("questions.aiSheet");
  const backTo = `/questions/categories/${categoryId}/subjects/${subjectId}`;
  return (
    <Page title={sheetTitle} headingHandled>
      <section className="question-session-shell" aria-labelledby="question-sheet-heading">
        <QuestionDirectoryHeader id="question-sheet-heading" title={sheetTitle} subtitle={subjectTitle} backTo={backTo} backLabel={subjectTitle} breadcrumbs={<QuestionBreadcrumbs category={category} material={{ slug: subjectId, title: subjectTitle }} sheetTitle={sheetTitle} />} />
        <QuestionPlayer
          key={`${categoryId}:${sheetId}`}
          sheetId={sheetId}
          questions={questions}
          backTo={backTo}
        />
      </section>
    </Page>
  );
}

function initialAnswers(questions) {
  return Object.fromEntries(questions.filter((question) => question.answer).map((question) => [question.id, question.answer]));
}

function QuestionPlayer({ sheetId, questions, backTo }) {
  const { t } = useI18n();
  const [answers, setAnswers] = useState(() => initialAnswers(questions));
  const [started, setStarted] = useState(false);
  // A reopened sheet resumes at the first question still to answer.
  const [index, setIndex] = useState(() => Math.max(questions.findIndex((question) => !question.answer), 0));
  const [finished, setFinished] = useState(false);
  const total = questions.length;
  const question = questions[index];
  const position = index + 1;

  function record(questionId, answer) {
    setAnswers((current) => (current[questionId] ? current : { ...current, [questionId]: answer }));
  }

  if (!started) {
    return <section className="question-session-intro" aria-labelledby="question-session-intro-title">
      <span className="question-session-intro-icon"><Icon name="file-question" size={22} /></span>
      <div><h2 id="question-session-intro-title">{t("questions.readyTitle")}</h2><p>{t("questions.sessionIntro", { count: total })}</p></div>
      <button className="btn btn-primary" type="button" onClick={() => setStarted(true)}>{t("questions.startQuestions")}</button>
    </section>;
  }

  if (finished) {
    const results = Object.values(answers);
    const correct = results.filter((answer) => answer.is_correct).length;
    const xp = results.reduce((sum, answer) => sum + (answer.xp_awarded || 0), 0);
    return (
      <section className="question-player question-player-summary" aria-live="polite">
        <span className="stat-icon"><Icon name="check" /></span>
        <h2>{t("questions.sheetComplete")}</h2>
        <p className="muted">{t("questions.sheetScore", { correct, total })}</p>
        {xp > 0 && <span className="question-xp-chip">{t("questions.xpEarned", { count: xp })}</span>}
        <div className="question-player-actions">
          <button className="btn btn-soft" type="button" onClick={() => { setFinished(false); setIndex(0); }}>{t("questions.reviewAnswers")}</button>
          <Link className="btn btn-primary" to={backTo}>{t("questions.backToSheets")}</Link>
        </div>
      </section>
    );
  }

  return (
    <section className="question-player" aria-label={t("questions.sheetQuestionsLabel")}>
      <header className="question-progress">
        <div className="question-progress-meta">
          <strong aria-live="polite">{t("questions.progress", { index: position, total })}</strong>
          <span className="muted">{t("questions.remaining", { count: total - position })}</span>
        </div>
        <div
          className="question-progress-track"
          role="progressbar"
          aria-label={t("questions.progressLabel")}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={position}
        >
          <span style={{ transform: `scaleX(${position / total})` }} />
        </div>
      </header>
      <PracticeItem
        key={question.id}
        sheetId={sheetId}
        question={question}
        answer={answers[question.id] || null}
        onAnswered={record}
      />
      <nav className="question-player-actions" aria-label={t("questions.navigationLabel")}>
        <button className="btn btn-soft" type="button" disabled={index === 0} onClick={() => setIndex(index - 1)}>
          <Icon name="chevron-left" size={17} /> {t("questions.previousQuestion")}
        </button>
        {position < total ? (
          <button className={`btn ${answers[question.id] ? "btn-primary" : "btn-soft"}`} type="button" onClick={() => setIndex(index + 1)}>
            {t("questions.nextQuestion")} <Icon name="chevron-right" size={17} />
          </button>
        ) : (
          <button className="btn btn-primary" type="button" disabled={!Object.keys(answers).length} onClick={() => setFinished(true)}>
            {t("questions.finishSheet")}
          </button>
        )}
      </nav>
    </section>
  );
}

/**
 * A question card. A single-answer question is submitted by the tap that picks
 * it; a multiple-select question needs the student to say when the set is
 * complete, so only that type keeps a check button. The card locks while the
 * request is in flight and for good once the server has graded it.
 */
function PracticeItem({ sheetId, question, answer, onAnswered }) {
  const { t } = useI18n();
  const [selected, setSelected] = useState([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const multiple = question.question_type === "multiple_select";
  const choices = Array.isArray(question.choices) ? question.choices : [];
  const locked = Boolean(answer) || pending;
  const picked = answer ? answer.selected_choice_ids : selected;
  const correctIds = answer?.correct_choice_ids || [];

  async function submit(choiceIds) {
    if (answer || inFlight.current || !choiceIds.length) return;
    inFlight.current = true;
    setPending(true);
    setError("");
    try {
      const response = await catalogWorkspaceApi.answerQuestion(sheetId, question.id, choiceIds);
      if (response?.answer) onAnswered(question.id, response.answer);
    } catch (reason) {
      setSelected([]);
      setError(reason?.message || t("questions.answerFailed"));
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  function choose(id) {
    if (locked) return;
    if (!multiple) {
      setSelected([id]);
      submit([id]);
      return;
    }
    setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  const tone = answer ? (answer.is_correct ? " answered-correct" : " answered-wrong") : "";
  return (
    <article className={`question-card question-player-card${tone}`} aria-busy={pending}>
      <div className="question-card-meta">
        <span className={`question-difficulty is-${question.difficulty}`}>{t(`questions.difficulty.${question.difficulty}`)}</span>
        {question.xp_value > 0 && !answer && <span className="muted">{t("questions.xpValue", { count: question.xp_value })}</span>}
      </div>
      <h2 dir="auto">{question.prompt}</h2>
      {multiple && !answer && <p className="save-hint">{t("assessment.selectEvery")}</p>}
      <div className="choices">
        {choices.map((choice, choiceIndex) => {
          const isSelected = picked.includes(choice.id);
          const isCorrect = correctIds.includes(choice.id);
          // The existing answer vocabulary, so a practice card reads exactly
          // like a released attempt result rather than inventing a second one.
          const state = answer ? (isCorrect ? " correct" : isSelected ? " wrong" : "") : "";
          return (
            <button
              key={choice.id}
              type="button"
              // Once graded, the pick is shown as right or wrong, not as a selection.
              className={answer ? state.trim() : isSelected ? "selected" : ""}
              aria-pressed={isSelected}
              disabled={locked}
              onClick={() => choose(choice.id)}
            >
              <span className="choice-prefix">{String.fromCharCode(65 + choiceIndex)}</span>
              <span dir="auto">{choice.text}</span>
              {answer && isCorrect && <Icon name="check" size={18} aria-hidden="true" />}
            </button>
          );
        })}
      </div>
      {multiple && !answer && (
        <button className="btn btn-primary compact" type="button" disabled={!selected.length || pending} onClick={() => submit(selected)}>
          {t("questions.checkAnswer")}
        </button>
      )}
      {pending && <p className="muted question-pending" role="status">{t("questions.submitting")}</p>}
      {error && <p className="question-error" role="alert">{error}</p>}
      {answer && (
        <div className={`answer-note ${answer.is_correct ? "correct" : "wrong"}`} role="status">
          <div className="question-answer-head">
            <strong>{answer.is_correct ? t("questions.answerCorrect") : t("questions.answerIncorrect")}</strong>
            {answer.xp_awarded > 0 && <span className="question-xp-chip">{t("questions.xpEarned", { count: answer.xp_awarded })}</span>}
          </div>
          {answer.explanation && <p dir="auto">{answer.explanation}</p>}
        </div>
      )}
    </article>
  );
}
