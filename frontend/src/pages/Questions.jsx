import { useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { reviewApi } from "../api/review.js";
import { Icon } from "../lib/icons.jsx";
import { MATERIAL_CATALOG, getCatalogMaterial } from "../lib/materialCatalog.js";
import { getDemoQuiz } from "../lib/demoQuizCatalog.js";
import { EmptyState, ErrorPanel, Page, RadioGroup, RadioOption } from "../components/ui/index.jsx";
import { CatalogSheetCard } from "../components/learning/CatalogSheetCard.jsx";
import { CatalogTile } from "../components/learning/CatalogTile.jsx";
import { useI18n } from "../components/I18nProvider.jsx";

const QUESTION_CATEGORIES = [
  { id: "practice", titleKey: "questions.practice", metaKey: "questions.practiceMeta", icon: "brain", available: false },
  { id: "years", titleKey: "questions.years", metaKey: "questions.yearsMeta", icon: "calendar", available: false },
  { id: "ai-sheet", titleKey: "questions.aiSheet", metaKey: "questions.aiSheetMeta", icon: "file-question", available: false },
  { id: "quizzes", titleKey: "questions.quizzes", metaKey: "questions.quizzesMeta", icon: "list-checks", available: true },
  { id: "mix", titleKey: "questions.mix", metaKey: "questions.mixMeta", icon: "shuffle", available: false }
];

function categoryFor(id) {
  return QUESTION_CATEGORIES.find((category) => category.id === id) || null;
}

function categoryEmptyState(category, t) {
  return <EmptyState title={t(category.titleKey)} text={t("common.soon")} />;
}

export default function Questions() {
  const { t } = useI18n();

  return (
    <Page title="Questions">
      <section aria-labelledby="question-previews-heading">
        <div className="panel-title">
          <div>
            <p className="eyebrow">{t("questions.previewLabel")}</p>
            <h2 id="question-previews-heading">{t("questions.previewTitle")}</h2>
            <p className="muted">{t("questions.previewSubtitle")}</p>
          </div>
        </div>
        <section className="questions-category-grid" aria-label={t("questions.categoriesLabel")}>
          {QUESTION_CATEGORIES.map((category) => <CategoryCard key={category.id} category={category} />)}
        </section>
      </section>
    </Page>
  );
}

function CategoryCard({ category }) {
  const { t } = useI18n();
  return <CatalogTile title={t(category.titleKey)} meta={t(category.metaKey)} icon={category.icon} kind="question" to={category.available ? `/questions/categories/${category.id}` : ""} status={category.available ? "" : t("common.soon")} />;
}

export function QuestionCategory() {
  const { categoryId } = useParams();
  const { t } = useI18n();
  const category = categoryFor(categoryId);
  if (!category) return <Page title={t("questions.sourceNotFoundTitle")}><ErrorPanel message={t("questions.sourceNotFoundText")} /></Page>;
  if (!category.available) return <Page title={t(category.titleKey)}>{categoryEmptyState(category, t)}</Page>;

  return (
    <Page title={t("questions.quizzes")} subtitle={t("questions.quizzesSubtitle")}>
      <section className="material-grid catalog-material-grid" aria-label={t("questions.quizMaterialsLabel")}>{MATERIAL_CATALOG.map((material) => <DemoMaterialCard key={material.slug} material={material} />)}</section>
    </Page>
  );
}

function DemoMaterialCard({ material }) {
  const { t } = useI18n();
  return <CatalogTile title={material.title} meta={t("materials.sheetCount", { count: material.sheets.length })} icon="book-open" to={`/questions/categories/quizzes/subjects/${material.slug}`} />;
}

export function QuestionSubjectQuizzes() {
  const { categoryId, subjectId } = useParams();
  const { t } = useI18n();
  const category = categoryFor(categoryId);
  const material = getCatalogMaterial(subjectId);
  if (!category?.available || category.id !== "quizzes" || !material) return <Page title={t("materials.notFoundTitle")}><ErrorPanel message={t("questions.quizMaterialUnavailable")} /></Page>;

  return (
    <Page title={material.title} subtitle={t("questions.chooseSheet")}>
      <section className="sheet-grid catalog-sheet-grid" aria-label={t("questions.quizSheetsOf", { name: material.title })}>
        {material.sheets.map((sheet) => <DemoSheetCard key={sheet.slug} material={material} sheet={sheet} />)}
      </section>
    </Page>
  );
}

function DemoSheetCard({ material, sheet }) {
  const { t } = useI18n();
  return <CatalogSheetCard material={material} sheet={sheet} to={`/questions/demo/${material.slug}/${sheet.slug}`} actionLabel={t("questions.openQuiz")} />;
}

export function DemoQuiz() {
  const { materialSlug, sheetSlug } = useParams();
  const navigate = useNavigate();
  const { t } = useI18n();
  const quiz = getDemoQuiz(materialSlug, sheetSlug);
  const [activeIndex, setActiveIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [tracking, setTracking] = useState({});
  const attemptKeys = useRef(new Map());
  if (!quiz) return <Page title={t("questions.notFoundTitle")}><ErrorPanel message={t("questions.notFoundText")} /></Page>;

  const question = quiz.questions[activeIndex];
  const selectedAnswer = answers[question.id];
  const answered = Object.keys(answers).length;
  const isCorrect = selectedAnswer === question.answerIndex;
  const progress = quiz.questions.length ? Math.round(((activeIndex + 1) / quiz.questions.length) * 100) : 0;
  const resultPath = `/questions/categories/quizzes/subjects/${quiz.material.slug}`;

  async function trackAnswer(item, selectedIndex) {
    let idempotencyKey = attemptKeys.current.get(item.id);
    if (!idempotencyKey) {
      idempotencyKey = globalThis.crypto.randomUUID();
      attemptKeys.current.set(item.id, idempotencyKey);
    }
    const isMistake = selectedIndex !== item.answerIndex;
    setTracking((current) => ({ ...current, [item.id]: { state: "saving", error: "" } }));
    try {
      await reviewApi.trackAttempt({
        idempotencyKey,
        questionKey: `demo:${quiz.material.slug}:${quiz.sheet.slug}:${item.id}`,
        subjectKey: `catalog:${quiz.material.slug}`,
        subjectLabel: quiz.material.title,
        sourceType: "sheet",
        sourceId: `${quiz.material.slug}:${quiz.sheet.slug}`,
        sourceLabel: quiz.sheet.title,
        sourceQuestionIndex: quiz.questions.findIndex((candidate) => candidate.id === item.id) + 1,
        prompt: item.prompt,
        explanation: item.explanation,
        options: item.options.map((text, index) => ({ id: String(index), text })),
        selectedOptionIds: [String(selectedIndex)],
        correctOptionIds: [String(item.answerIndex)]
      });
      setTracking((current) => ({ ...current, [item.id]: { state: "saved", error: "" } }));
    } catch (error) {
      setTracking((current) => ({
        ...current,
        [item.id]: {
          state: "error",
          error: isMistake
            ? (error?.message || t("questions.trackError"))
            : ""
        }
      }));
    }
  }

  function selectAnswer(item, selectedIndex) {
    if (answers[item.id] != null) return;
    setAnswers((current) => ({ ...current, [item.id]: selectedIndex }));
    void trackAnswer(item, selectedIndex);
  }

  function resetQuiz() {
    attemptKeys.current = new Map();
    setTracking({});
    setAnswers({});
    setActiveIndex(0);
    setSubmitted(false);
  }

  if (submitted) {
    const correct = quiz.questions.filter((item) => answers[item.id] === item.answerIndex).length;
    const incorrect = Object.keys(answers).filter((id) => answers[id] !== quiz.questions.find((item) => item.id === id)?.answerIndex).length;
    const percentage = quiz.questions.length ? Math.round((correct / quiz.questions.length) * 100) : 0;
    return <Page title={t("questions.resultsTitle", { name: quiz.sheet.title })} subtitle={t("questions.resultsSubtitle")}><section className="session-result"><div className="session-top"><div><p className="eyebrow">{t("questions.resultsEyebrow")}</p><h2 dir="auto">{quiz.sheet.title}</h2></div><Link className="btn btn-soft" to={resultPath}>{t("questions.exitResults")}</Link></div><article className="result-hero"><div><p className="eyebrow">{t("questions.score")}</p><h2 dir="auto">{percentage}%</h2><p>{t("questions.scoreNote")}</p></div><div className="result-stats"><div className="xp-card"><span>{t("questions.correct")}</span><strong dir="auto">{correct}</strong></div><div className="xp-card"><span>{t("questions.incorrect")}</span><strong dir="auto">{incorrect}</strong></div><div className="xp-card"><span>{t("questions.total")}</span><strong dir="auto">{quiz.questions.length}</strong></div></div></article><div className="result-actions"><Link className="btn btn-primary" to={resultPath}>{t("materials.backToSheets")}</Link><button className="btn btn-soft" type="button" onClick={resetQuiz}>{t("common.tryAgain")}</button></div></section></Page>;
  }

  return (
    <Page title={quiz.sheet.title} subtitle={t("questions.quizSubtitle")}>
      <section className="demo-quiz-shell" aria-label={t("questions.demoQuizLabel", { name: quiz.sheet.title })}>
        <header className="demo-quiz-toolbar">
          <button className="demo-quiz-exit" type="button" onClick={() => navigate(resultPath)} aria-label={t("questions.exitQuiz")}><Icon name="x" size={20} /></button>
          <div className="demo-quiz-context"><span>{t("questions.demoQuiz")}</span><strong dir="auto">{t("questions.materialSheet", { name: quiz.material.title, number: quiz.sheet.number })}</strong></div>
          <div className="demo-quiz-counter" aria-label={t("questions.questionOf", { index: activeIndex + 1, total: quiz.questions.length })}><strong>{activeIndex + 1}</strong><span>/{quiz.questions.length}</span></div>
        </header>
        <div className="demo-quiz-progress" role="progressbar" aria-label={t("questions.quizProgress")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><span style={{ width: `${progress}%` }} /></div>
        <article className="demo-question-stage">
          <div className="demo-question-heading"><span dir="auto">{t("questions.questionNumber", { number: String(activeIndex + 1).padStart(2, "0") })}</span><h2 dir="auto">{question.prompt}</h2></div>
          <RadioGroup className="demo-answer-list" orientation="vertical" label={t("questions.answerChoices")} value={selectedAnswer == null ? "" : String(selectedAnswer)} onChange={(value) => selectAnswer(question, Number(value))}>{question.options.map((option, index) => { const chosen = selectedAnswer === index; const evaluated = selectedAnswer != null; const state = evaluated && index === question.answerIndex ? "correct" : evaluated && chosen ? "wrong" : chosen ? "selected" : ""; return <RadioOption key={option} value={String(index)} className={`demo-answer ${state}`} disabled={evaluated}><span className="demo-answer-letter">{String.fromCharCode(65 + index)}</span><span className="demo-answer-copy" dir="auto">{option}</span>{evaluated && index === question.answerIndex && <Icon name="check" size={20} aria-label={t("questions.correctAnswer")} />}{evaluated && chosen && !isCorrect && <Icon name="alert-triangle" size={20} aria-label={t("questions.incorrectAnswer")} />}</RadioOption>; })}</RadioGroup>
          {/* The answer buttons already carry the verdict visually and in their
              icon labels, so the callout that repeated it is gone. Screen
              readers still need it announced, hence the hidden live region. */}
          {selectedAnswer != null && <p className="visually-hidden" role="status" aria-live="polite">{isCorrect ? t("questions.correctAnswer") : t("questions.incorrectAnswer")}</p>}
          {selectedAnswer != null && !isCorrect && tracking[question.id]?.state === "saving" && <p className="save-hint" role="status">{t("questions.savingMistake")}</p>}
          {selectedAnswer != null && !isCorrect && tracking[question.id]?.state === "saved" && <p className="save-hint" role="status">{t("questions.savedMistake")}</p>}
          {selectedAnswer != null && !isCorrect && tracking[question.id]?.state === "error" && <div className="demo-review-save-error" role="alert"><p dir="auto">{tracking[question.id].error}</p><button className="btn btn-soft compact" type="button" onClick={() => void trackAnswer(question, selectedAnswer)}>{t("questions.retrySaving")}</button></div>}
          {selectedAnswer != null && !isCorrect && <details className="demo-explanation"><summary>{t("questions.explain")} <Icon name="chevron-right" size={18} /></summary><p dir="auto">{question.explanation}</p></details>}
        </article>
        <footer className="demo-quiz-controls"><p dir="auto">{t("questions.answeredOf", { answered, total: quiz.questions.length })}</p><div><button className="demo-nav-button demo-nav-button--previous" type="button" disabled={activeIndex === 0} onClick={() => setActiveIndex((index) => index - 1)}><Icon name="chevron-left" size={19} /> {t("common.previous")}</button>{activeIndex === quiz.questions.length - 1 ? <button className="demo-nav-button demo-nav-button--primary" type="button" onClick={() => setSubmitted(true)}>{t("questions.submit")}</button> : <button className="demo-nav-button demo-nav-button--primary" type="button" onClick={() => setActiveIndex((index) => index + 1)}>{t("common.next")} <Icon name="chevron-right" size={19} /></button>}</div></footer>
      </section>
    </Page>
  );
}
