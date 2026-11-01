import { generalCompanionIdeas, companionReadyCopy } from "../../lib/companionTips.js";
import "./study-companion.css";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Bookmark, ChevronLeft, MoreHorizontal, Settings, Sparkles, X } from "lucide-react";
import { useI18n } from "../../components/I18nProvider.jsx";
import { studyAssistanceApi } from "../../api/studyAssistance.js";
import { assistanceForPage, assistanceScopeKey, readCompanionPreferences, saveCompanionPreferences, savedAssistanceForRange } from "../../lib/studyAssistance.js";
import { TypedExplanation } from "./TypedExplanation.jsx";
import { CompanionCharacter, companionCharacters } from "./CompanionCharacter.jsx";
import { useCompanionMotion } from "./useCompanionMotion.js";
const boy = companionCharacters.boy.still, girl = companionCharacters.girl.still;

function useReducedMotion() {
  const [reduced, setReduced] = useState(() => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(Boolean(query?.matches));
    query?.addEventListener("change", update);
    return () => query?.removeEventListener("change", update);
  }, []);
  return reduced;
}

function IdeaExplanation({ idea, motion, busy, error, onSave, onClose, onMotionPhase, readyCopy, onRetry, loadFailed, onNext, onPrevious, cardNumber, cardCount }) {
  const { t } = useI18n();
  const [explaining, setExplaining] = useState(false);
  const [complete, setComplete] = useState(false);
  const [solution, setSolution] = useState(false);
  const [solutionComplete, setSolutionComplete] = useState(false);
  const id = useId();
  const closeRef = useRef(null);
  useEffect(() => { closeRef.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => {
    const speaking = (explaining && !complete) || (solution && !solutionComplete);
    onMotionPhase(speaking ? "speaking" : solutionComplete && solution ? "idle" : "thinking");
  }, [explaining, complete, solution, solutionComplete, onMotionPhase]);
  return <section className="study-companion-panel" role="dialog" aria-modal="false" aria-labelledby={id}>
    <header><span><Sparkles size={17} aria-hidden="true" />{t("studyCompanion.name")}</span><button type="button" ref={closeRef} onClick={onClose} aria-label={t("studyCompanion.close")}><X size={18} /></button></header>
    <div className="study-companion-lesson">
      {idea.general && <div className="study-companion-ready-note"><p>{readyCopy.general}</p><p role="status">{loadFailed ? readyCopy.failed : readyCopy.empty}</p><button type="button" className="btn btn-soft" onClick={onRetry}>{readyCopy.retry}</button></div>}
      <h2 id={id} dir="auto">{idea.question}</h2>
      {!explaining && <button type="button" className="btn btn-primary study-companion-explain" onClick={() => setExplaining(true)}><Sparkles size={16} aria-hidden="true" />{t("studyCompanion.explain")}</button>}
      {explaining && <TypedExplanation text={idea.explanation} animate={motion} onComplete={() => setComplete(true)} />}
      {complete && idea.followup_question && <div className="study-companion-followup">
        <span>{t("studyCompanion.followup")}</span>
        <button type="button" aria-expanded={solution} aria-controls={id + "-solution"} onClick={() => { setSolutionComplete(false); setSolution((value) => !value); }}><span dir="auto">{idea.followup_question}</span><ChevronLeft size={16} aria-hidden="true" /></button>
        {solution && <div id={id + "-solution"}><TypedExplanation text={idea.followup_answer} animate={motion} onComplete={() => setSolutionComplete(true)} /></div>}
      </div>}
      {!idea.general && <div className="study-companion-save"><button type="button" className="btn btn-soft" disabled={busy} aria-busy={busy} aria-pressed={idea.saved} onClick={onSave}><Bookmark size={15} fill={idea.saved ? "currentColor" : "none"} aria-hidden="true" />{t(busy ? "studyCompanion.saving" : idea.saved ? "studyCompanion.saved" : "studyCompanion.save")}</button></div>}
      {error && <p className="study-companion-error" role="alert">{error}</p>}
      {cardCount > 1 && <nav className="study-companion-card-nav"><button type="button" disabled={busy} onClick={onPrevious}>{t("common.previous")}</button><span dir="ltr">{cardNumber} / {cardCount}</span><button type="button" disabled={busy} onClick={onNext}>{t("common.next")}</button></nav>}
      <span className="study-companion-status" role="status">{explaining ? t(complete ? "studyCompanion.complete" : "studyCompanion.typing") : ""}</span>
    </div>
  </section>;
}

/** Independent overlay; it never owns PDF navigation, annotations or quiz state. */
export default function StudyCompanion({ userId, documentId, versionId, edition = "university", view = "study", page, pageStart = 1, pageLimit = Infinity, active = true, portalRoot = null }) {
  const { t, direction, locale } = useI18n();
  const readyCopy = companionReadyCopy[locale] || companionReadyCopy.en;
  const [retry, setRetry] = useState(0);
  const reduced = useReducedMotion();
  const [preferences, setPreferences] = useState(() => readCompanionPreferences(userId));
  const [data, setData] = useState({ key: "", ideas: [] });
  const [selected, setSelected] = useState(0);
  const [surface, setSurface] = useState("");
  const [reviewIdea, setReviewIdea] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [savedList, setSavedList] = useState({ key: "", ideas: [], loading: false, failed: false });
  const loadedScope = useRef("");
  const rootRef = useRef(null), petRef = useRef(null), saveRequest = useRef(0);
  const key = assistanceScopeKey(userId, documentId, edition, view, versionId, page);
  const validPage = Number.isInteger(page) && page >= pageStart && page <= pageLimit && page > 0;
  const enabled = Boolean(active && userId && documentId && validPage);
  const ideas = useMemo(() => {
    if (data.key !== key) return [];
    const prepared = assistanceForPage(data.ideas, page, pageStart, pageLimit);
    return prepared.length ? prepared : generalCompanionIdeas(locale);
  }, [data, key, page, pageStart, pageLimit, locale]);
  const idea = reviewIdea || ideas[selected] || ideas[0];
  const motion = preferences.motion && !reduced;
  const characterMotion = useCompanionMotion(key + "/" + (idea?.id || ""), surface, motion && enabled && Boolean(idea));

  useEffect(() => { saveCompanionPreferences(userId, preferences); }, [preferences, userId]);
  useEffect(() => {
    if (loadedScope.current !== key) {
      setSurface(""); setReviewIdea(null); setSelected(0); setError(""); setBusy(false); saveRequest.current += 1;
      loadedScope.current = key;
    }
    if (!enabled) { setSurface(""); return undefined; }
    const controller = new AbortController();
    studyAssistanceApi.list(documentId, { page, view, signal: controller.signal }).then((body) => {
      if (!controller.signal.aborted) setData({ key, ideas: (!versionId || body.versionId === versionId) ? body.results : [], failed: false });
    }, () => { if (!controller.signal.aborted) setData({ key, ideas: [], failed: true }); });
    return () => controller.abort();
  }, [documentId, enabled, key, page, versionId, view, retry]);
  useEffect(() => {
    if (!surface) return undefined;
    function outside(event) { if (!rootRef.current?.contains(event.target)) setSurface(""); }
    function escape(event) { if (event.key === "Escape") { event.stopPropagation(); setSurface(""); petRef.current?.focus(); } }
    document.addEventListener("pointerdown", outside);
    rootRef.current?.addEventListener("keydown", escape);
    const root = rootRef.current;
    return () => { document.removeEventListener("pointerdown", outside); root?.removeEventListener("keydown", escape); };
  }, [surface]);
  useEffect(() => {
    if (surface !== "saved" || !enabled) return undefined;
    const controller = new AbortController();
    setSavedList({ key, ideas: [], loading: true, failed: false });
    studyAssistanceApi.list(documentId, { view, saved: true, signal: controller.signal }).then((body) => {
      if (!controller.signal.aborted) setSavedList({ key, loading: false, failed: false, ideas: (!versionId || body.versionId === versionId) ? savedAssistanceForRange(body.results, pageStart, pageLimit) : [] });
    }, () => { if (!controller.signal.aborted) setSavedList({ key, ideas: [], loading: false, failed: true }); });
    return () => controller.abort();
  }, [documentId, enabled, key, pageLimit, pageStart, surface, versionId, view, retry]);

  async function saveIdea() {
    if (busy || !idea || idea.general) return;
    const requestId = ++saveRequest.current;
    setBusy(true); setError("");
    try {
      const saved = await studyAssistanceApi.save(documentId, idea.id, view, !idea.saved);
      if (requestId === saveRequest.current) {
        setData((current) => ({ ...current, ideas: current.ideas.map((row) => row.id === saved.id ? saved : row) }));
        setReviewIdea((current) => current?.id === saved.id ? saved : current);
        if (saved.saved) characterMotion.saved();
      }
    } catch {
      if (requestId === saveRequest.current) setError(t("studyCompanion.saveFailed"));
    } finally { if (requestId === saveRequest.current) setBusy(false); }
  }
  function close() { setSurface(""); setReviewIdea(null); petRef.current?.focus({ preventScroll: true }); }
  function chooseSaved(row) {
    // Saved help is reviewed in place and never jumps around the student's PDF.
    setReviewIdea(row); setSurface("idea"); setError("");
  }

  if (!enabled) return null;
  const target = portalRoot || document.body;
  if (preferences.hidden) return createPortal(<button type="button" className="study-companion-restore" onClick={() => setPreferences((current) => ({ ...current, hidden: false }))}><Sparkles size={16} aria-hidden="true" />{t("studyCompanion.show")}</button>, target);
  return createPortal(<div ref={rootRef} dir={direction} className={"study-companion" + (motion ? " has-motion" : "")} data-motion-state={motion ? characterMotion.state : "idle"} onPointerDown={(event) => event.stopPropagation()}>
    <button type="button" className="study-companion-pet" ref={petRef} onClick={() => { setError(""); const targetSurface = idea ? "idea" : "saved"; setSurface(surface === targetSurface ? "" : targetSurface); }} aria-label={t(idea ? "studyCompanion.open" : "studyCompanion.savedIdeas")} aria-expanded={surface === "idea" || surface === "saved"}><CompanionCharacter character={preferences.character} state={characterMotion.state} sequenceKey={characterMotion.sequenceKey} motion={motion} /></button>
    <button type="button" className="study-companion-preferences" onClick={() => setSurface(surface === "settings" ? "" : "settings")} aria-label={t("studyCompanion.settings")} aria-expanded={surface === "settings"}><Settings size={15} aria-hidden="true" /></button>
    {!surface && idea && <div className="study-companion-bubble"><button type="button" onClick={() => setSurface("idea")}><Sparkles size={14} aria-hidden="true" /><strong dir="auto">{idea.teaser}</strong></button>{ideas.length > 1 && <button type="button" className="study-companion-next" onClick={() => { setSelected((selected + 1) % ideas.length); setError(""); }}><MoreHorizontal size={15} aria-hidden="true" />{t("studyCompanion.nextIdea")}</button>}</div>}
    {surface === "idea" && idea && <IdeaExplanation key={key + "/" + idea.id} idea={idea} motion={motion} busy={busy} error={error} onSave={() => void saveIdea()} onClose={close} onMotionPhase={characterMotion.phase} readyCopy={readyCopy} cardNumber={selected + 1} cardCount={reviewIdea ? 1 : ideas.length} onNext={() => { setSelected((selected + 1) % ideas.length); setError(""); }} onPrevious={() => { setSelected((selected + ideas.length - 1) % ideas.length); setError(""); }} loadFailed={Boolean(data.failed)} onRetry={() => setRetry(value => value + 1)} />}
    {surface === "settings" && <section className="study-companion-options" aria-label={t("studyCompanion.settings")}><header><strong>{t("studyCompanion.settings")}</strong><button type="button" onClick={close} aria-label={t("studyCompanion.close")}><X size={17} /></button></header><div className="study-companion-characters">{[["boy", boy], ["girl", girl]].map(([value, image]) => <button type="button" key={value} aria-pressed={preferences.character === value} onClick={() => setPreferences((current) => ({ ...current, character: value }))}><img src={image} alt="" /><span>{t("studyCompanion." + value)}</span></button>)}</div><button type="button" aria-pressed={preferences.motion} onClick={() => setPreferences((current) => ({ ...current, motion: !current.motion }))}>{t("studyCompanion.motion")}<span>{t(preferences.motion ? "studyCompanion.on" : "studyCompanion.off")}</span></button><button type="button" onClick={() => setSurface("saved")}><Bookmark size={16} aria-hidden="true" />{t("studyCompanion.savedIdeas")}</button><button type="button" onClick={() => { setSurface(""); setPreferences((current) => ({ ...current, hidden: true })); }}>{t("studyCompanion.hide")}</button></section>}
    {surface === "saved" && <section className="study-companion-options" aria-label={t("studyCompanion.savedIdeas")}><header><strong>{t("studyCompanion.savedIdeas")}</strong><button type="button" onClick={close} aria-label={t("studyCompanion.close")}><X size={17} /></button></header>{savedList.key !== key || savedList.loading ? <p role="status">{t("studyCompanion.loading")}</p> : savedList.failed ? <div><p role="alert">{t("studyCompanion.loadFailed")}</p><button type="button" className="btn btn-soft" onClick={() => setRetry(value => value + 1)}>{readyCopy.retry}</button></div> : savedList.ideas.length ? savedList.ideas.map((row) => <button type="button" key={row.id} onClick={() => chooseSaved(row)} dir="auto">{row.question}</button>) : <p>{t("studyCompanion.noSaved")}</p>}</section>}
  </div>, target);
}
