import { generalCompanionIdeas, companionReadyCopy, companionKindLabels, companionNudgeCopy, companionNudge } from "../../lib/companionTips.js";
import "./study-companion.css";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Bookmark, ChevronLeft, MoreHorizontal, Settings, Sparkles, X } from "lucide-react";
import { useI18n } from "../../components/I18nProvider.jsx";
import { studyAssistanceApi } from "../../api/studyAssistance.js";
import { assistanceForPage, assistanceScopeKey, savedAssistanceForRange } from "../../lib/studyAssistance.js";
import { useCompanionPreferences } from "../../hooks/useCompanionPreferences.js";
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

const PHONE_COMPANION_QUERY = "(max-width: 600px), (max-height: 500px) and (max-width: 900px)";
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

function usePhoneCompanionLayout() {
  const [isPhone, setIsPhone] = useState(() => Boolean(window.matchMedia?.(PHONE_COMPANION_QUERY).matches));
  useEffect(() => {
    const query = window.matchMedia?.(PHONE_COMPANION_QUERY);
    const update = () => setIsPhone(Boolean(query?.matches));
    query?.addEventListener?.("change", update);
    return () => query?.removeEventListener?.("change", update);
  }, []);
  return isPhone;
}

/** Pixel geometry is constrained to safe tappable screen space, not PDF units. */
function phoneCompanionBounds(viewport, width, height) {
  const minLeft = 8;
  const minTop = Math.min(56, Math.max(8, viewport.height - height - 8));
  return {
    minLeft, minTop,
    maxLeft: Math.max(minLeft, viewport.width - width - 8),
    maxTop: Math.max(minTop, viewport.height - height - 56)
  };
}

function companionPositionFromRatio(position, viewport) {
  if (!position) return null;
  const smallLandscape = viewport.height <= 550;
  const bounds = phoneCompanionBounds(viewport, smallLandscape ? 76 : 82, smallLandscape ? 90 : 100);
  return {
    left: bounds.minLeft + position.x * (bounds.maxLeft - bounds.minLeft),
    top: bounds.minTop + position.y * (bounds.maxTop - bounds.minTop)
  };
}

function IdeaExplanation({ idea, motion, busy, error, onSave, onClose, onMotionPhase, readyCopy, onRetry, loadFailed, onNext, onPrevious, cardNumber, cardCount }) {
  const { t, locale } = useI18n();
  const kindLabels = companionKindLabels[locale] || companionKindLabels.en;
  const nudgeCopy = companionNudgeCopy[locale] || companionNudgeCopy.en;
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
      {!idea.general && <p className="study-companion-kind"><span>{kindLabels[idea.kind]}</span>{idea.page !== null && <span>{locale === "ar" ? "صفحة" : "Page"} {idea.page}</span>}</p>}
      {idea.general && <div className="study-companion-ready-note"><p className="study-companion-ready-label"><Sparkles size={13} aria-hidden="true" />{readyCopy.general}</p><p role="status">{loadFailed ? readyCopy.failed : readyCopy.empty}</p><button type="button" className="study-companion-retry" onClick={onRetry}>{readyCopy.retry}</button></div>}
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
      <span className="study-companion-status" role="status">{explaining ? t(complete ? "studyCompanion.complete" : "studyCompanion.typing") : ""}</span>
    </div>
    {cardCount > 1 && <nav className="study-companion-card-nav" aria-label={t("studyCompanion.name")}><button type="button" disabled={busy} onClick={onPrevious}>{t("common.previous")}</button><span className="study-companion-card-step" dir="ltr">{cardNumber} / {cardCount}<progress aria-label={nudgeCopy.cards} max={cardCount} value={cardNumber} /></span><button type="button" disabled={busy} onClick={onNext}>{t("common.next")}</button></nav>}
  </section>;
}

/** Independent overlay; it never owns PDF navigation, annotations or quiz state. */
export default function StudyCompanion({ userId, documentId, versionId, edition = "university", view = "study", page, pageStart = 1, pageLimit = Infinity, active = true, portalRoot = null, phoneAddFromToolbar = false }) {
  const { t, direction, locale } = useI18n();
  const readyCopy = companionReadyCopy[locale] || companionReadyCopy.en;
  const nudgeCopy = companionNudgeCopy[locale] || companionNudgeCopy.en;
  const [retry, setRetry] = useState(0);
  const [nudgeIndex, setNudgeIndex] = useState(0);
  const reduced = useReducedMotion();
  const [preferences, setPreferences] = useCompanionPreferences(userId);
  const isPhone = usePhoneCompanionLayout();
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const [dragPosition, setDragPosition] = useState(null);
  const dragPointerRef = useRef(null);
  const dragPositionRef = useRef(null);
  const suppressPetClickRef = useRef(false);
  useEffect(() => {
    const update = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", update, { passive: true });
    return () => window.removeEventListener("resize", update);
  }, []);
  const position = isPhone ? (dragPosition || companionPositionFromRatio(preferences.position, viewport)) : null;
  function beginPetPointer(event) {
    if (!isPhone || event.button > 0 || dragPointerRef.current) return;
    const bounds = rootRef.current?.getBoundingClientRect();
    if (!bounds) return;
    suppressPetClickRef.current = false;
    dragPointerRef.current = {
      id: event.pointerId, x: event.clientX, y: event.clientY,
      left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height, moved: false
    };
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Pointer capture is progressive. */ }
  }
  function movePetPointer(event) {
    const drag = dragPointerRef.current;
    if (!drag || drag.id !== event.pointerId) return;
    if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 8) return;
    drag.moved = true;
    event.preventDefault();
    const bounds = phoneCompanionBounds(viewport, drag.width, drag.height);
    const next = {
      left: clamp(drag.left + event.clientX - drag.x, bounds.minLeft, bounds.maxLeft),
      top: clamp(drag.top + event.clientY - drag.y, bounds.minTop, bounds.maxTop)
    };
    dragPositionRef.current = next;
    setDragPosition(next);
  }
  function finishPetPointer(event, cancelled = false) {
    const drag = dragPointerRef.current;
    if (!drag || drag.id !== event.pointerId) return;
    dragPointerRef.current = null;
    if (!drag.moved || cancelled) {
      if (cancelled) { dragPositionRef.current = null; setDragPosition(null); }
      return;
    }
    suppressPetClickRef.current = true;
    const bounds = phoneCompanionBounds(viewport, drag.width, drag.height);
    const placed = dragPositionRef.current;
    if (placed) setPreferences((current) => ({
      ...current,
      position: {
        x: (placed.left - bounds.minLeft) / Math.max(1, bounds.maxLeft - bounds.minLeft),
        y: (placed.top - bounds.minTop) / Math.max(1, bounds.maxTop - bounds.minTop)
      }
    }));
    dragPositionRef.current = null;
    setDragPosition(null);
  }
  const [data, setData] = useState({ key: "", ideas: [], failed: false });
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
  useEffect(() => {
    // The same original artwork expresses a short welcome; no new sprites,
    // API calls or background nudges are required.
    if (surface === "nudge") characterMotion.phase("speaking");
  }, [surface, characterMotion.phase]);

  useEffect(() => {
    if (loadedScope.current !== key) {
      setSurface(""); setReviewIdea(null); setSelected(0); setNudgeIndex(0); setError(""); setBusy(false); saveRequest.current += 1;
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
  // The Focus + menu is the only place to add or restore a hidden companion
  // on phones, tablets and desktops. Never overlay a separate restore button.
  if (preferences.hidden || (phoneAddFromToolbar && !preferences.phoneAdded)) return null;
  return createPortal(<div ref={rootRef} dir={direction}
    className={"study-companion" + (motion ? " has-motion" : "") + (surface ? " is-expanded" : "") + (isPhone ? " is-phone-draggable" : "") + (phoneAddFromToolbar ? " is-toolbar-companion" : "") + (position ? " is-positioned" : "") + (dragPosition ? " is-dragging" : "")}
    style={position ? { left: position.left + "px", top: position.top + "px" } : undefined}
    data-motion-state={motion ? characterMotion.state : "idle"} onPointerDown={(event) => event.stopPropagation()}>
    <button type="button" className="study-companion-pet" ref={petRef}
      onPointerDown={beginPetPointer}
      onPointerMove={movePetPointer}
      onPointerUp={(event) => finishPetPointer(event)}
      onPointerCancel={(event) => finishPetPointer(event, true)}
      onClick={() => {
        if (suppressPetClickRef.current) { suppressPetClickRef.current = false; return; }
        setError("");
        const targetSurface = idea ? "idea" : "saved";
        setSurface(surface === targetSurface ? "" : targetSurface);
      }}
      aria-label={t(idea ? "studyCompanion.open" : "studyCompanion.savedIdeas")} aria-expanded={surface === "idea" || surface === "saved"}><CompanionCharacter character={preferences.character} state={characterMotion.state} sequenceKey={characterMotion.sequenceKey} motion={motion} /></button>
    <button type="button" className="study-companion-preferences" onClick={() => setSurface(surface === "settings" ? "" : "settings")} aria-label={t("studyCompanion.settings")} aria-expanded={surface === "settings"}><Settings size={15} aria-hidden="true" /></button>
    {!surface && idea && !preferences.quiet && <div className="study-companion-bubble"><button type="button" onClick={() => setSurface("idea")}><Sparkles size={14} aria-hidden="true" /><strong dir="auto">{idea.teaser}</strong></button>{ideas.length > 1 && <button type="button" className="study-companion-next" onClick={() => { setSelected((selected + 1) % ideas.length); setError(""); }}><MoreHorizontal size={15} aria-hidden="true" />{t("studyCompanion.nextIdea")}</button>}<button type="button" className="study-companion-next study-companion-boost" onClick={() => setSurface("nudge")}><Sparkles size={15} aria-hidden="true" />{nudgeCopy.action}</button></div>}
    {surface === "idea" && idea && <IdeaExplanation key={key + "/" + idea.id} idea={idea} motion={motion} busy={busy} error={error} onSave={() => void saveIdea()} onClose={close} onMotionPhase={characterMotion.phase} readyCopy={readyCopy} cardNumber={selected + 1} cardCount={reviewIdea ? 1 : ideas.length} onNext={() => { setSelected((selected + 1) % ideas.length); setError(""); }} onPrevious={() => { setSelected((selected + ideas.length - 1) % ideas.length); setError(""); }} loadFailed={Boolean(data.failed)} onRetry={() => setRetry(value => value + 1)} />}
    {surface === "settings" && <section className="study-companion-options study-companion-settings" role="dialog" aria-modal="false" aria-label={t("studyCompanion.settings")}><header><strong>{t("studyCompanion.settings")}</strong><button type="button" onClick={close} aria-label={t("studyCompanion.close")}><X size={17} /></button></header><div className="study-companion-characters">{[["boy", boy], ["girl", girl]].map(([value, image]) => <button type="button" key={value} aria-pressed={preferences.character === value} onClick={() => setPreferences((current) => ({ ...current, character: value }))}><img src={image} alt="" /><span>{t("studyCompanion." + value)}</span></button>)}</div><button type="button" aria-pressed={preferences.motion} onClick={() => setPreferences((current) => ({ ...current, motion: !current.motion }))}>{t("studyCompanion.motion")}<span>{t(preferences.motion ? "studyCompanion.on" : "studyCompanion.off")}</span></button><button type="button" onClick={() => setSurface("saved")}><Bookmark size={16} aria-hidden="true" />{t("studyCompanion.savedIdeas")}</button><button type="button" onClick={() => setSurface("nudge")}><Sparkles size={16} aria-hidden="true" />{nudgeCopy.action}</button><button type="button" role="switch" aria-checked={Boolean(preferences.quiet)} onClick={() => setPreferences((current) => ({ ...current, quiet: !current.quiet }))}>{nudgeCopy.quiet}<span>{preferences.quiet ? nudgeCopy.quietOn : nudgeCopy.quietOff}</span></button><button type="button" onClick={() => { setSurface(""); setPreferences((current) => ({ ...current, hidden: true })); }}>{t("studyCompanion.hide")}</button></section>}
    {surface === "nudge" && <section className="study-companion-options study-companion-nudge" role="dialog" aria-modal="false" aria-label={nudgeCopy.title}><header><strong>{nudgeCopy.title}</strong><button type="button" onClick={close} aria-label={t("studyCompanion.close")}><X size={17} /></button></header><p className="study-companion-nudge-source">{nudgeCopy.source}</p><p className="study-companion-nudge-text" dir="auto">{companionNudge(locale, nudgeIndex + page - pageStart)}</p><button type="button" onClick={() => { setNudgeIndex((index) => index + 1); characterMotion.phase("speaking"); }}><Sparkles size={16} aria-hidden="true" />{nudgeCopy.next}</button><button type="button" onClick={() => setSurface("idea")}>{nudgeCopy.back}</button></section>}
    {surface === "saved" && <section className="study-companion-options study-companion-saved" role="dialog" aria-modal="false" aria-label={t("studyCompanion.savedIdeas")}><header><strong>{t("studyCompanion.savedIdeas")}</strong><button type="button" onClick={close} aria-label={t("studyCompanion.close")}><X size={17} /></button></header>{savedList.key !== key || savedList.loading ? <p role="status">{t("studyCompanion.loading")}</p> : savedList.failed ? <div><p role="alert">{t("studyCompanion.loadFailed")}</p><button type="button" className="btn btn-soft" onClick={() => setRetry(value => value + 1)}>{readyCopy.retry}</button></div> : savedList.ideas.length ? savedList.ideas.map((row) => <button type="button" key={row.id} onClick={() => chooseSaved(row)} dir="auto">{row.question}</button>) : <p>{t("studyCompanion.noSaved")}</p>}</section>}
  </div>, target);
}
