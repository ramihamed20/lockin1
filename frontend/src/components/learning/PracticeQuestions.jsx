import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { practiceApi } from "../../api/practice.js";
import { useAsyncData } from "../../hooks/useAsyncData.js";
import { normalizeUserError } from "../../lib/errors.js";
import { formatDate, formatNumber } from "../../lib/i18n.js";
import { Icon } from "../../lib/icons.jsx";
import { EmptyState, ErrorPanel, LoadingPanel, Page } from "../ui/index.jsx";
import { CatalogTile } from "./CatalogTile.jsx";
import { DirectoryState, QuestionBreadcrumbs, QuestionDirectoryHeader } from "./QuestionDirectory.jsx";
import { useI18n } from "../I18nProvider.jsx";
import { PracticeMark } from "./PracticeMark.jsx";
import "./practice-questions.css";

/**
 * Practice: a slide is shown and the student types its name.
 *
 * The only differences forgiven are letter case and spaces; the server makes
 * that call and reveals the expected name only after the attempt, so the page
 * never holds an answer it could leak. Progress, review dates and XP are the
 * server's too; the page only chooses the queue and its order.
 */

function usePracticeDirectory(userId) {
  const data = useAsyncData((signal) => practiceApi.directory({ signal }), [userId || ""]);
  const subjects = useMemo(() => (Array.isArray(data.data) ? data.data : []), [data.data]);
  return { ...data, subjects };
}

const BACK_TO_QUESTIONS = "/questions";

export function PracticeCategory({ user = null, category }) {
  const { t } = useI18n();
  const { subjects, loading, error, reload } = usePracticeDirectory(user?.id);
  const back = { backTo: BACK_TO_QUESTIONS, backLabel: t("route.questions") };
  if (!category) return <DirectoryState title={t("questions.sourceNotFoundTitle")} {...back}><ErrorPanel message={t("questions.sourceNotFoundText")} /></DirectoryState>;
  if (loading) return <DirectoryState title={t(category.titleKey)} {...back}><LoadingPanel variant="material-list" /></DirectoryState>;
  if (error) return <DirectoryState title={t(category.titleKey)} {...back}><ErrorPanel message={error} onRetry={reload} /></DirectoryState>;
  if (!subjects.length) return <DirectoryState title={t(category.titleKey)} {...back}><EmptyState icon="brain" title={t("practice.emptyTitle")} text={t("practice.emptyText")} /></DirectoryState>;

  return (
    <Page width="reading" title={t(category.titleKey)} headingHandled>
      <section className="question-directory" aria-labelledby="question-category-heading">
        <QuestionDirectoryHeader id="question-category-heading" title={t(category.titleKey)} backTo={BACK_TO_QUESTIONS} backLabel={t("route.questions")} breadcrumbs={<QuestionBreadcrumbs category={category} />} />
        <section className="material-grid catalog-material-grid" aria-label={t("questions.subjectsLabel")}>
          {subjects.map((subject) => (
            <CatalogTile
              key={subject.slug}
              title={subject.title}
              meta={t("practice.slideCount", { count: subject.slideCount })}
              icon="book-open"
              to={`/questions/categories/${category.id}/subjects/${subject.slug}`}
            />
          ))}
        </section>
      </section>
    </Page>
  );
}

export function PracticeSubject({ user = null, category }) {
  const { subjectId } = useParams();
  const { t } = useI18n();
  const { subjects, loading, error, reload } = usePracticeDirectory(user?.id);
  const subject = subjects.find((item) => item.slug === subjectId) || null;
  const back = category ? { backTo: `/questions/categories/${category.id}`, backLabel: t(category.titleKey) } : { backTo: BACK_TO_QUESTIONS, backLabel: t("route.questions") };
  if (!category) return <DirectoryState title={t("materials.notFoundTitle")} {...back}><ErrorPanel message={t("questions.subjectUnavailable")} /></DirectoryState>;
  if (loading) return <DirectoryState title={t(category.titleKey)} {...back}><LoadingPanel variant="card-list" /></DirectoryState>;
  if (error) return <DirectoryState title={t(category.titleKey)} {...back}><ErrorPanel message={error} onRetry={reload} /></DirectoryState>;
  if (!subject) return <DirectoryState title={t("materials.notFoundTitle")} {...back}><ErrorPanel message={t("questions.subjectUnavailable")} /></DirectoryState>;

  return (
    <Page width="reading" title={subject.title} headingHandled>
      <section className="question-directory" aria-labelledby="question-subject-heading">
        <QuestionDirectoryHeader id="question-subject-heading" title={subject.title} backTo={back.backTo} backLabel={back.backLabel} breadcrumbs={<QuestionBreadcrumbs category={category} material={subject} />} />
        <section className="material-grid catalog-material-grid" aria-label={t("practice.setsLabel")}>
          {subject.sets.map((set) => (
            <CatalogTile
              key={set.id}
              title={set.title}
              meta={[t("practice.slideCount", { count: set.slideCount }), set.stats.review > 0 ? t("practice.tileReview", { count: set.stats.review }) : ""].filter(Boolean).join(" · ")}
              icon="brain"
              kind="question"
              to={`/questions/categories/${category.id}/subjects/${subject.slug}/sheets/${set.id}`}
            />
          ))}
        </section>
      </section>
    </Page>
  );
}

export function PracticePlayerPage({ category }) {
  const { subjectId, sheetId } = useParams();
  const { t } = useI18n();
  const data = useAsyncData((signal) => practiceApi.get(sheetId, { signal }), [sheetId]);
  const backTo = `/questions/categories/practice/subjects/${subjectId}`;
  const back = { backTo, backLabel: t("practice.backToSets") };
  if (!category) return <DirectoryState title={t("materials.notFoundTitle")} backTo={BACK_TO_QUESTIONS} backLabel={t("route.questions")}><ErrorPanel message={t("questions.subjectUnavailable")} /></DirectoryState>;
  if (data.loading) return <DirectoryState title={t(category.titleKey)} {...back}><LoadingPanel variant="quiz" /></DirectoryState>;
  if (data.error) return <DirectoryState title={t(category.titleKey)} {...back}><ErrorPanel message={data.error} onRetry={data.reload} /></DirectoryState>;
  const set = data.data;
  if (!set?.slides.length) return <DirectoryState title={set?.title || t(category.titleKey)} {...back}><EmptyState icon="brain" title={t("practice.emptyTitle")} text={t("practice.emptyText")} /></DirectoryState>;

  return (
    <Page width="reading" title={set.title} headingHandled>
      <section className="question-session-shell" aria-labelledby="practice-heading">
        <QuestionDirectoryHeader id="practice-heading" title={set.title} subtitle={set.subject.title} backTo={backTo} backLabel={set.subject.title || t("practice.backToSets")} breadcrumbs={<QuestionBreadcrumbs category={category} material={{ slug: subjectId, title: set.subject.title }} sheetTitle={set.title} />} />
        <PracticePlayer key={set.id} set={set} backTo={backTo} onRoundEnd={data.reload} />
      </section>
    </Page>
  );
}

const SHUFFLE_KEY = "lock-in.practice.shuffle";

function readShufflePreference() {
  try { return window.localStorage.getItem(SHUFFLE_KEY) === "1"; } catch { return false; }
}

function writeShufflePreference(value) {
  try { window.localStorage.setItem(SHUFFLE_KEY, value ? "1" : "0"); } catch { /* the preference is a convenience only */ }
}

/** @template T @param {T[]} items @returns {T[]} */
function shuffled(items) {
  const copy = items.slice();
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[other]] = [copy[other], copy[index]];
  }
  return copy;
}

const REVIEW_ORDER = { missed: 0, due: 1 };

/** Missed slides first, then the ones whose review is due. */
function reviewQueue(slides) {
  return slides
    .filter((slide) => slide.state in REVIEW_ORDER)
    .sort((a, b) => REVIEW_ORDER[a.state] - REVIEW_ORDER[b.state] || a.position - b.position);
}

/** @param {{ stats: ReturnType<typeof import("../../api/practice.js").parseSet>["stats"] }} props */
function PracticeStats({ stats }) {
  const { t, locale } = useI18n();
  const items = [
    ["learned", stats.learned],
    ["due", stats.due],
    ["missed", stats.missed],
    ["new", stats.newCount]
  ];
  return (
    <div className="practice-stats">
      <dl>
        {items.map(([key, value]) => <div key={key} data-kind={key}><dt>{t(`practice.stat.${key}`)}</dt><dd>{formatNumber(Number(value), {}, locale)}</dd></div>)}
      </dl>
      <p className="muted">{stats.lastPracticedAt ? t("practice.lastPracticed", { date: formatDate(stats.lastPracticedAt, { dateStyle: "medium" }, locale) }) : t("practice.neverPracticed")}</p>
    </div>
  );
}

/**
 * Where a round starts: what to practise and in which order. Nothing here
 * grades anything; it only decides the queue.
 * @param {{ set: NonNullable<ReturnType<typeof import("../../api/practice.js").parseSet>>, onStart: (slides: any[]) => void }} props
 */
function PracticeStart({ set, onStart }) {
  const { t } = useI18n();
  const reviewCount = set.slides.filter((slide) => slide.state in REVIEW_ORDER).length;
  const [mode, setMode] = useState(reviewCount ? "review" : "all");
  const [shuffle, setShuffle] = useState(readShufflePreference);

  function start() {
    const base = mode === "review" && reviewCount ? reviewQueue(set.slides) : set.slides;
    onStart(shuffle ? shuffled(base) : base);
  }

  return (
    <section className="question-player practice-start" aria-label={t("practice.startLabel")}>
      {set.preview && <p className="practice-preview" role="note"><Icon name="eye" size={16} aria-hidden="true" />{t("practice.preview")}</p>}
      {!set.preview && <PracticeStats stats={set.stats} />}
      <fieldset className="practice-modes">
        <legend>{t("practice.modeLabel")}</legend>
        <label>
          <input type="radio" name="practice-mode" value="all" checked={mode === "all"} onChange={() => setMode("all")} />
          <strong>{t("practice.modeAll")}</strong>
          <small>{t("practice.slideCount", { count: set.slides.length })}</small>
        </label>
        <label data-disabled={reviewCount ? undefined : ""}>
          <input type="radio" name="practice-mode" value="review" checked={mode === "review"} disabled={!reviewCount} onChange={() => setMode("review")} />
          <strong>{t("practice.modeReview")}</strong>
          <small>{reviewCount ? t("practice.slideCount", { count: reviewCount }) : t("practice.reviewEmpty")}</small>
        </label>
      </fieldset>
      <label className="practice-shuffle">
        <input type="checkbox" checked={shuffle} onChange={(event) => { setShuffle(event.target.checked); writeShufflePreference(event.target.checked); }} />
        <Icon name="shuffle" size={16} aria-hidden="true" />
        <span>{t("practice.shuffle")}</span>
      </label>
      <p className="muted practice-xp-note">{t("practice.xpNote", { slide: 5, set: 20 })}</p>
      {set.mostMissed.length > 0 && <section className="practice-most-missed" aria-label={t("practice.mostMissedLabel")}>
        <h3>{t("practice.mostMissedLabel")}</h3>
        <ul className="practice-missed">
          {set.mostMissed.map((item) => <li key={item.id}>
            <img src={item.imageUrl} alt="" loading="lazy" draggable={false} />
            <span className="practice-missed-text">
              <strong dir="auto">{item.expected}</strong>
              <span className="muted">{t("practice.missCount", { count: item.misses })}</span>
            </span>
          </li>)}
        </ul>
      </section>}
      <div className="question-player-actions">
        <button className="btn btn-primary" type="button" onClick={start}>{t("practice.start")} <Icon name="chevron-right" size={17} aria-hidden="true" /></button>
      </div>
    </section>
  );
}

/** @param {{ set: NonNullable<ReturnType<typeof import("../../api/practice.js").parseSet>>, backTo: string, onRoundEnd: () => void }} props */
function PracticePlayer({ set, backTo, onRoundEnd }) {
  const [queue, setQueue] = useState(/** @type {typeof set.slides | null} */ (null));
  const [round, setRound] = useState(0);
  const [sessionXp, setSessionXp] = useState(0);
  if (!queue) return <PracticeStart set={set} onStart={(slides) => { setQueue(slides); setRound(1); }} />;
  return (
    <PracticeRound
      key={round}
      set={set}
      backTo={backTo}
      slides={queue}
      sessionXp={sessionXp}
      onXp={(points) => setSessionXp((current) => current + points)}
      onRestart={(slides) => { setQueue(slides); setRound((current) => current + 1); }}
      onFinish={onRoundEnd}
      onChangeMode={() => setQueue(null)}
    />
  );
}

/**
 * One pass through a queue of slides. A retry or restart is a new round, so a
 * round never has to reset its own state.
 * @param {{ set: NonNullable<ReturnType<typeof import("../../api/practice.js").parseSet>>, backTo: string, slides: any[], sessionXp: number, onXp: (points: number) => void, onRestart: (slides: any[]) => void, onFinish: () => void, onChangeMode: () => void }} props
 */
function PracticeRound({ set, backTo, slides: queue, sessionXp, onXp, onRestart, onFinish, onChangeMode }) {
  const { t } = useI18n();
  const [index, setIndex] = useState(0);
  const [results, setResults] = useState(/** @type {Record<string, { correct: boolean, expected: string, typed: string, nearMiss: boolean, hinted: boolean, xpAwarded: number, setXpAwarded: number }>} */ ({}));
  const [hints, setHints] = useState(/** @type {Record<string, string>} */ ({}));
  const [typed, setTyped] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [finished, setFinished] = useState(false);
  const inFlight = useRef(false);
  const inputRef = useRef(null);
  const nextRef = useRef(null);
  const total = queue.length;
  const slide = queue[index];
  const result = slide ? results[slide.id] : undefined;
  const hint = slide ? hints[slide.id] : undefined;

  // The next image is fetched while the student is still typing this one.
  useEffect(() => {
    const upcoming = queue[index + 1];
    if (!upcoming) return;
    const image = new window.Image();
    image.src = upcoming.imageUrl;
  }, [queue, index]);

  useEffect(() => {
    if (finished) return;
    (result ? nextRef : inputRef).current?.focus({ preventScroll: true });
  }, [index, result, finished]);

  async function submit(event) {
    event.preventDefault();
    if (inFlight.current || result || !slide) return;
    if (!typed.trim()) { setError(t("practice.typeFirst")); inputRef.current?.focus(); return; }
    inFlight.current = true;
    setPending(true);
    setError("");
    try {
      const verdict = await practiceApi.check(set.id, slide.id, typed);
      setResults((current) => ({ ...current, [slide.id]: { ...verdict, typed } }));
      if (verdict.xpAwarded + verdict.setXpAwarded > 0) onXp(verdict.xpAwarded + verdict.setXpAwarded);
    } catch (failure) {
      setError(normalizeUserError(failure, t("practice.checkFailed")));
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  async function revealHint() {
    if (inFlight.current || result || hint || !slide) return;
    inFlight.current = true;
    setPending(true);
    setError("");
    try {
      const letter = await practiceApi.hint(set.id, slide.id);
      if (letter) setHints((current) => ({ ...current, [slide.id]: letter }));
    } catch (failure) {
      setError(normalizeUserError(failure, t("practice.hintFailed")));
    } finally {
      inFlight.current = false;
      setPending(false);
      inputRef.current?.focus({ preventScroll: true });
    }
  }

  function advance() {
    setTyped("");
    setError("");
    if (index < total - 1) { setIndex(index + 1); return; }
    setFinished(true);
    onFinish();
  }

  if (finished) {
    const correct = queue.filter((item) => results[item.id]?.correct).length;
    const missed = queue.filter((item) => results[item.id] && !results[item.id].correct);
    const hinted = queue.filter((item) => results[item.id]?.hinted).length;
    const score = total ? Math.round((correct / total) * 100) : 0;
    return (
      <section className="question-player question-player-summary practice-summary" aria-live="polite">
        <div className="question-score" style={/** @type {import("react").CSSProperties} */ ({ "--score": score })} aria-hidden="true">
          <strong>{score}<small>%</small></strong>
        </div>
        <h2>{correct === total ? t("practice.allCorrect") : t("practice.complete")}</h2>
        <p className="muted">{t("practice.score", { correct, total })}</p>
        {(sessionXp > 0 || hinted > 0) && <p className="practice-earned">
          {sessionXp > 0 && <strong className="practice-xp">{t("practice.xpEarned", { xp: sessionXp })}</strong>}
          {hinted > 0 && <span className="muted">{t("practice.hintsUsed", { count: hinted })}</span>}
        </p>}
        {missed.length > 0 && <ul className="practice-missed" aria-label={t("practice.missedLabel")}>
          {missed.map((item) => <li key={item.id}>
            <img src={item.imageUrl} alt="" loading="lazy" draggable={false} />
            <span className="practice-missed-text">
              <strong dir="auto">{results[item.id].expected}</strong>
              <span dir="auto" className="muted">{t("practice.youTyped", { text: results[item.id].typed.trim() || "—" })}</span>
            </span>
          </li>)}
        </ul>}
        <div className="question-player-actions">
          {missed.length > 0 && <button className="btn btn-soft" type="button" onClick={() => onRestart(missed)}>{t("practice.retryMistakes", { count: missed.length })}</button>}
          <button className="btn btn-soft" type="button" onClick={onChangeMode}><Icon name="reset" size={16} />{t("practice.playAgain")}</button>
          <Link className="btn btn-primary" to={backTo}>{t("practice.backToSets")}</Link>
        </div>
      </section>
    );
  }

  const position = index + 1;
  const mark = slide.hotspot;
  const slideAlt = mark
    ? t("practice.slideAltMarked", { index: position, shape: t(`practice.shape.${mark.shape}`) })
    : t("practice.slideAlt", { index: position });
  const nearMiss = result && !result.correct && result.nearMiss;
  return (
    <section className="question-player practice-player" aria-label={t("practice.playerLabel")}>
      <header className="question-progress">
        <div className="question-progress-meta">
          <strong aria-live="polite">{t("questions.progress", { index: position, total })}</strong>
          <span className="muted">{t("questions.remaining", { count: total - position })}</span>
        </div>
        <div className="question-progress-track" role="progressbar" aria-label={t("questions.progressLabel")} aria-valuemin={0} aria-valuemax={total} aria-valuenow={position}>
          <span style={{ transform: `scaleX(${position / total})` }} />
          {total <= 60 && <span className="question-rail" aria-hidden="true">{queue.map((item, itemIndex) => {
            const outcome = results[item.id];
            return <i key={item.id} data-state={outcome ? (outcome.correct ? "correct" : "wrong") : "open"} data-current={itemIndex === index ? "" : undefined} />;
          })}</span>}
        </div>
      </header>
      <form className="question-player-card practice-card" onSubmit={submit} noValidate>
        {set.preview && <p className="practice-preview" role="note"><Icon name="eye" size={16} aria-hidden="true" />{t("practice.preview")}</p>}
        <figure className="practice-slide">
          <span className="practice-frame">
            <img key={slide.id} src={slide.imageUrl} alt={slideAlt} draggable={false} onContextMenu={(event) => event.preventDefault()} />
            {mark && <PracticeMark mark={mark} />}
          </span>
        </figure>
        <label className="practice-field">
          <span>{t("practice.prompt")}</span>
          <input
            ref={inputRef}
            type="text"
            value={typed}
            dir="auto"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            enterKeyHint={result ? "next" : "done"}
            maxLength={400}
            disabled={pending || Boolean(result)}
            data-state={result ? (result.correct ? "correct" : "wrong") : undefined}
            aria-invalid={result ? !result.correct : undefined}
            aria-describedby="practice-feedback"
            placeholder={t("practice.placeholder")}
            onChange={(event) => { setTyped(event.target.value); if (error) setError(""); }}
          />
        </label>
        <div id="practice-feedback" className="practice-feedback" role="status" aria-live="polite">
          {error && <p className="practice-error" role="alert">{error}</p>}
          {hint && !result && <p className="practice-hint-text"><Icon name="sparkles" size={16} aria-hidden="true" />{t("practice.hintLetter", { letter: hint })}</p>}
          {result?.correct && <p className="practice-verdict is-correct"><Icon name="check" size={18} aria-hidden="true" />{t("practice.correct")}</p>}
          {result && !result.correct && <div className="practice-verdict is-wrong" data-near={nearMiss ? "" : undefined}>
            <p><Icon name={nearMiss ? "target" : "x"} size={18} aria-hidden="true" />{nearMiss ? t("practice.nearMiss") : t("practice.incorrect")}</p>
            <p className="practice-expected"><span className="muted">{t("practice.expected")}</span><strong dir="auto">{result.expected}</strong></p>
            <p className="muted practice-rule">{nearMiss ? t("practice.nearMissText") : t("practice.rule")}</p>
          </div>}
          {result && result.xpAwarded + result.setXpAwarded > 0 && <p className="practice-xp-gain">
            <strong>{t("practice.xpGain", { xp: result.xpAwarded })}</strong>
            {result.hinted && result.xpAwarded > 0 && <span className="muted">{t("practice.xpHinted")}</span>}
            {result.setXpAwarded > 0 && <span>{t("practice.setBonus", { xp: result.setXpAwarded })}</span>}
          </p>}
        </div>
        <div className="practice-actions">
          {result
            ? <button ref={nextRef} className="btn btn-primary" type="button" onClick={advance}>{position < total ? t("questions.nextQuestion") : t("questions.finishSheet")} <Icon name="chevron-right" size={17} aria-hidden="true" /></button>
            : <>
              <button className="btn btn-soft practice-hint-button" type="button" onClick={revealHint} disabled={pending || Boolean(hint)} title={t("practice.hintCost")}>
                <Icon name="sparkles" size={16} aria-hidden="true" />{t("practice.hint")}
              </button>
              <button className="btn btn-primary" type="submit" disabled={pending}>{pending ? t("practice.checking") : t("questions.checkAnswer")}</button>
            </>}
        </div>
      </form>
    </section>
  );
}
